// Private OAuth and Google Calendar gateway.
//
// Security boundaries:
// - Access tokens live only in chrome.storage.session (memory-backed).
// - Tokens are never returned to side-panel code.
// - Schedule queries whitelist only event titles, descriptions, and times.
// - Account and preference records stay in device-local extension storage.

import { groupWindowsForQueries } from '../utils/query_ranges.js';
import {
  dedupeAndSortScheduleEvents,
  normalizeScheduleEvent,
} from '../utils/schedule.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

const ACCOUNT_KEY = 'accountEmails';
const TOKEN_PREFIX = 'oauthToken::';
const CALENDAR_PREFIX = 'calChecked::';
const MAX_WINDOWS = 92;
const MAX_WINDOW_MS = 26 * 60 * 60 * 1000;
const FREEBUSY_BATCH_SIZE = 50;
const EVENT_LIST_CONCURRENCY = 5;

class PublicError extends Error {
  constructor(code, userMessage) {
    super(userMessage);
    this.name = 'PublicError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

class ApiError extends Error {
  constructor(status) {
    super(`Google API request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function configureStorageAccess() {
  const trusted = { accessLevel: 'TRUSTED_CONTEXTS' };
  return Promise.all([
    chrome.storage.local.setAccessLevel(trusted),
    chrome.storage.session.setAccessLevel(trusted),
  ]);
}

configureStorageAccess().catch(() => {
  // Older Chromium versions may not support setAccessLevel. There are no
  // content scripts in this extension, so storage still remains internal.
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Could not configure the side panel.', error));

function getOAuthConfig() {
  return chrome.runtime.getManifest().oauth2 || {};
}

function assertOAuthConfigured() {
  const { client_id: clientId, scopes } = getOAuthConfig();
  if (
    !clientId ||
    clientId.includes('REPLACE_WITH_') ||
    !clientId.endsWith('.apps.googleusercontent.com')
  ) {
    throw new PublicError(
      'OAUTH_NOT_CONFIGURED',
      `OAuth is not configured yet. Copy extension ID ${chrome.runtime.id} and follow README.md.`
    );
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new PublicError('OAUTH_NOT_CONFIGURED', 'No OAuth scopes are configured.');
  }
  return { clientId, scopes };
}

function randomState() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function buildAuthUrl({ interactive, email, state }) {
  const { clientId, scopes } = assertOAuthConfigured();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: scopes.join(' '),
    state,
    include_granted_scopes: 'true',
  });

  if (interactive) {
    params.set('prompt', 'select_account');
  } else {
    params.set('prompt', 'none');
    if (email) params.set('login_hint', email);
  }
  return `${AUTH_ENDPOINT}?${params}`;
}

async function runAuthFlow({ interactive, email }) {
  const state = randomState();
  const url = buildAuthUrl({ interactive, email, state });
  let redirectUrl;
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({
      url,
      interactive,
    });
  } catch {
    throw new PublicError(
      interactive ? 'AUTH_CANCELLED' : 'SESSION_EXPIRED',
      interactive
        ? 'Google sign-in was cancelled or could not be completed.'
        : `Session expired for ${email}. Please re-add this account in Settings.`
    );
  }

  if (!redirectUrl) {
    throw new PublicError('AUTH_CANCELLED', 'Google sign-in was cancelled.');
  }

  const responseUrl = new URL(redirectUrl);
  const expectedUrl = new URL(chrome.identity.getRedirectURL());
  if (responseUrl.origin !== expectedUrl.origin) {
    throw new PublicError('AUTH_INVALID_RESPONSE', 'Google returned an unexpected sign-in response.');
  }

  const params = new URLSearchParams(responseUrl.hash.slice(1));
  if (params.get('state') !== state) {
    throw new PublicError('AUTH_INVALID_STATE', 'Google sign-in state validation failed.');
  }
  if (params.get('error')) {
    throw new PublicError('AUTH_REJECTED', `Google sign-in failed: ${params.get('error')}.`);
  }

  const token = params.get('access_token');
  if (!token) {
    throw new PublicError('AUTH_NO_TOKEN', 'Google did not return an access token.');
  }

  const expiresIn = Number(params.get('expires_in') || 3600);
  return {
    token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
}

async function apiRequest(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

async function fetchEmail(token) {
  try {
    const info = await apiRequest(token, USERINFO_ENDPOINT);
    if (!info.email) throw new Error('Missing email');
    return String(info.email);
  } catch {
    throw new PublicError('ACCOUNT_INFO_FAILED', 'Could not read the signed-in Google account email.');
  }
}

async function revokeToken(token) {
  if (!token) return true;
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const tokenKey = (email) => `${TOKEN_PREFIX}${email}`;
const calendarKey = (email) => `${CALENDAR_PREFIX}${email}`;

async function getAccounts() {
  const result = await chrome.storage.local.get(ACCOUNT_KEY);
  const accounts = result[ACCOUNT_KEY];
  return Array.isArray(accounts) ? accounts.filter((email) => typeof email === 'string') : [];
}

async function saveAccounts(accounts) {
  const unique = [...new Set(accounts)];
  await chrome.storage.local.set({ [ACCOUNT_KEY]: unique });
  return unique;
}

async function getStoredToken(email) {
  const key = tokenKey(email);
  return (await chrome.storage.session.get(key))[key] || null;
}

function saveStoredToken(email, record) {
  return chrome.storage.session.set({ [tokenKey(email)]: record });
}

function removeStoredToken(email) {
  return chrome.storage.session.remove(tokenKey(email));
}

async function ensureToken(email) {
  const stored = await getStoredToken(email);
  if (stored?.token && stored.expiresAt > Date.now()) return stored.token;

  let refreshed;
  try {
    refreshed = await runAuthFlow({ interactive: false, email });
    const actualEmail = await fetchEmail(refreshed.token);
    if (actualEmail.toLowerCase() !== email.toLowerCase()) {
      await revokeToken(refreshed.token);
      throw new PublicError(
        'ACCOUNT_MISMATCH',
        `Google returned ${actualEmail} instead of ${email}. Please re-add the account.`
      );
    }
  } catch (error) {
    await removeStoredToken(email);
    if (error instanceof PublicError) throw error;
    throw new PublicError(
      'SESSION_EXPIRED',
      `Session expired for ${email}. Please re-add this account in Settings.`
    );
  }

  await saveStoredToken(email, refreshed);
  return refreshed.token;
}

async function withAccountToken(email, operation) {
  let token = await ensureToken(email);
  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await removeStoredToken(email);
    token = await ensureToken(email);
    return operation(token);
  }
}

async function handleAddAccount() {
  assertOAuthConfigured();
  const auth = await runAuthFlow({ interactive: true });
  const email = await fetchEmail(auth.token);
  const oldToken = await getStoredToken(email);
  if (oldToken?.token && oldToken.token !== auth.token) {
    await revokeToken(oldToken.token);
  }

  await saveStoredToken(email, auth);
  const accounts = await getAccounts();
  if (!accounts.includes(email)) accounts.push(email);
  await saveAccounts(accounts);
  return { ok: true, email, accounts };
}

async function handleRemoveAccount({ email }) {
  if (typeof email !== 'string') {
    throw new PublicError('INVALID_ACCOUNT', 'A valid account is required.');
  }

  const stored = await getStoredToken(email);
  const revoked = await revokeToken(stored?.token);
  await removeStoredToken(email);
  const accounts = await saveAccounts((await getAccounts()).filter((item) => item !== email));
  await chrome.storage.local.remove(calendarKey(email));

  return {
    ok: true,
    accounts,
    warning: revoked ? null : 'The account was removed locally, but Google token revocation could not be confirmed.',
  };
}

async function handleSignOut() {
  const accounts = await getAccounts();
  const records = await Promise.all(accounts.map((email) => getStoredToken(email)));
  const results = await Promise.all(records.map((record) => revokeToken(record?.token)));

  if (accounts.length > 0) {
    await chrome.storage.session.remove(accounts.map(tokenKey));
  }
  await chrome.storage.local.remove([ACCOUNT_KEY, ...accounts.map(calendarKey)]);

  return {
    ok: true,
    warning: results.every(Boolean)
      ? null
      : 'Signed out locally, but one or more Google token revocations could not be confirmed.',
  };
}

async function handleGetAuth() {
  const accounts = await getAccounts();
  let configured = true;
  try {
    assertOAuthConfigured();
  } catch {
    configured = false;
  }
  return {
    signedIn: accounts.length > 0,
    accounts,
    configured,
    extensionId: chrome.runtime.id,
  };
}

async function fetchCalendarList(token) {
  const items = [];
  let pageToken;
  do {
    const url = new URL(`${CALENDAR_BASE}/users/me/calendarList`);
    url.searchParams.set('maxResults', '250');
    url.searchParams.set(
      'fields',
      'items(id,summary,summaryOverride,backgroundColor,primary,accessRole),nextPageToken'
    );
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await apiRequest(token, url);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items.map((calendar) => ({
    id: calendar.id,
    summary: calendar.summary,
    summaryOverride: calendar.summaryOverride,
    backgroundColor: calendar.backgroundColor,
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole,
  }));
}

async function getCheckedCalendars(token, email) {
  const calendars = await fetchCalendarList(token);
  const key = calendarKey(email);
  const stored = (await chrome.storage.local.get(key))[key] || {};
  return {
    calendars,
    checked: calendars.filter((calendar) => stored[calendar.id] !== false),
  };
}

function userMessageForApiError(error) {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 403) {
    return 'Google denied Calendar access. Confirm the Calendar API and the required OAuth scopes are enabled.';
  }
  if (error.status === 429) return 'Google Calendar is rate-limiting requests. Please try again shortly.';
  if (error.status >= 500) return 'Google Calendar is temporarily unavailable. Please try again.';
  return `Google Calendar request failed (${error.status}).`;
}

async function handleListCalendars() {
  const accounts = await getAccounts();
  const results = await Promise.all(
    accounts.map(async (email) => {
      try {
        const calendars = await withAccountToken(email, fetchCalendarList);
        return { email, calendars };
      } catch (error) {
        return {
          email,
          error: error.userMessage || userMessageForApiError(error) || 'Could not load calendars.',
        };
      }
    })
  );
  return { ok: true, accounts: results };
}

function normalizeWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > MAX_WINDOWS) {
    throw new PublicError(
      'INVALID_WINDOWS',
      `Choose between 1 and ${MAX_WINDOWS} date windows.`
    );
  }

  return windows.map((window) => {
    const start = Number(window?.start);
    const end = Number(window?.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > MAX_WINDOW_MS
    ) {
      throw new PublicError('INVALID_WINDOW', 'One of the selected time windows is invalid.');
    }
    return { start, end };
  });
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchFreeBusy(token, calendarIds, range, timeZone) {
  const busy = [];
  for (const batch of chunk(calendarIds, FREEBUSY_BATCH_SIZE)) {
    const data = await apiRequest(token, `${CALENDAR_BASE}/freeBusy`, {
      method: 'POST',
      body: JSON.stringify({
        timeMin: new Date(range.start).toISOString(),
        timeMax: new Date(range.end).toISOString(),
        timeZone,
        calendarExpansionMax: FREEBUSY_BATCH_SIZE,
        items: batch.map((id) => ({ id })),
      }),
    });

    const failed = [];
    for (const id of batch) {
      const result = data.calendars?.[id];
      if (result?.errors?.length) {
        failed.push(id);
        continue;
      }
      for (const interval of result?.busy || []) {
        const start = Date.parse(interval.start);
        const end = Date.parse(interval.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          busy.push({ start, end });
        }
      }
    }

    if (failed.length) {
      throw new PublicError(
        'CALENDAR_QUERY_FAILED',
        `Google could not check ${failed.length} selected calendar${failed.length === 1 ? '' : 's'}. Review the calendar selection in Settings.`
      );
    }
  }
  return busy;
}

async function fetchCalendarEvents(token, email, calendar, range, timeZone) {
  const events = [];
  let pageToken;

  do {
    const calendarId = encodeURIComponent(calendar.id);
    const url = new URL(`${CALENDAR_BASE}/calendars/${calendarId}/events`);
    url.searchParams.set('timeMin', new Date(range.start).toISOString());
    url.searchParams.set('timeMax', new Date(range.end).toISOString());
    url.searchParams.set('timeZone', timeZone);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('maxResults', '250');
    url.searchParams.set(
      'fields',
      'items(id,iCalUID,summary,description,start(date,dateTime),end(date,dateTime)),nextPageToken'
    );
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await apiRequest(token, url);
    for (const event of data.items || []) {
      const normalized = normalizeScheduleEvent(event, calendar, email);
      if (normalized) events.push(normalized);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

async function fetchAccountBusy(email, ranges, timeZone) {
  return withAccountToken(email, async (token) => {
    const { checked } = await getCheckedCalendars(token, email);
    if (checked.length === 0) return { busy: [], count: 0 };

    const busy = [];
    const calendarIds = checked.map((calendar) => calendar.id);
    for (const range of ranges) {
      busy.push(...(await fetchFreeBusy(token, calendarIds, range, timeZone)));
    }
    return { busy, count: checked.length };
  });
}

async function fetchAccountSchedule(email, range, timeZone) {
  return withAccountToken(email, async (token) => {
    const calendars = await fetchCalendarList(token);
    const readable = calendars.filter((calendar) =>
      ['reader', 'writer', 'owner'].includes(calendar.accessRole)
    );
    const events = [];

    for (const batch of chunk(readable, EVENT_LIST_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map((calendar) =>
          fetchCalendarEvents(token, email, calendar, range, timeZone)
        )
      );
      events.push(...results.flat());
    }

    return {
      events,
      calendarCount: calendars.length,
      readableCount: readable.length,
    };
  });
}

async function handleGetBusy({ windows, timeZone }) {
  const normalized = normalizeWindows(windows);
  if (typeof timeZone !== 'string' || timeZone.length > 100) {
    throw new PublicError('INVALID_TIMEZONE', 'A valid timezone is required.');
  }

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    throw new PublicError('NO_ACCOUNTS', 'Add at least one Google account first.');
  }

  const ranges = groupWindowsForQueries(normalized);
  try {
    const results = await Promise.all(
      accounts.map((email) => fetchAccountBusy(email, ranges, timeZone))
    );
    return {
      ok: true,
      busy: results.flatMap((result) => result.busy),
      checkedCount: results.reduce((total, result) => total + result.count, 0),
    };
  } catch (error) {
    const message = error.userMessage || userMessageForApiError(error);
    if (message) throw new PublicError(error.code || 'CALENDAR_ERROR', message);
    throw error;
  }
}

async function handleGetTodaySchedule({ window, timeZone }) {
  const [range] = normalizeWindows([window]);
  if (typeof timeZone !== 'string' || timeZone.length > 100) {
    throw new PublicError('INVALID_TIMEZONE', 'A valid timezone is required.');
  }

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    throw new PublicError('NO_ACCOUNTS', 'Add at least one Google account first.');
  }

  try {
    const results = await Promise.all(
      accounts.map((email) => fetchAccountSchedule(email, range, timeZone))
    );
    return {
      ok: true,
      events: dedupeAndSortScheduleEvents(
        results.flatMap((result) => result.events)
      ),
      calendarCount: results.reduce(
        (total, result) => total + result.calendarCount,
        0
      ),
      readableCount: results.reduce(
        (total, result) => total + result.readableCount,
        0
      ),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new PublicError(
        'EVENT_SCOPE_REQUIRED',
        'Google denied event access. Add the read-only event scope in Google Cloud, then use + Add Google account in Settings to reconnect each account.'
      );
    }
    const message = error.userMessage || userMessageForApiError(error);
    if (message) throw new PublicError(error.code || 'CALENDAR_ERROR', message);
    throw error;
  }
}

const handlers = {
  SIGN_IN: handleAddAccount,
  ADD_ACCOUNT: handleAddAccount,
  REMOVE_ACCOUNT: handleRemoveAccount,
  SIGN_OUT: handleSignOut,
  GET_AUTH: handleGetAuth,
  LIST_CALENDARS: handleListCalendars,
  GET_BUSY: handleGetBusy,
  GET_TODAY_SCHEDULE: handleGetTodaySchedule,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        error: error.userMessage || 'The request could not be completed.',
        code: error.code || 'UNEXPECTED_ERROR',
      })
    );
  return true;
});
