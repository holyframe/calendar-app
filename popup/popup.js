// Popup entry point: auth state, navigation, preferences, and shared output.

import { initPickDates } from './pick_dates.js';
import { initDateRange } from './date_range.js';
import { initSettings } from './settings.js';
import {
  createTimezoneDropdown,
  friendlyTzName,
  detectTimezone,
} from '../utils/timezone.js';
import {
  formatAvailability,
  resolveFormat,
} from '../utils/formatter.js';

const $ = (id) => document.getElementById(id);

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

const state = {
  auth: {
    signedIn: false,
    accounts: [],
    configured: false,
    extensionId: '',
  },
  intervals: null,
  displayTz: null,
  convertDropdown: null,
};

const PREF_DEFAULTS = {
  operatingTz: detectTimezone(),
  convertTz: null,
  lastTab: 'pick',
  timeStart: '09:00',
  timeEnd: '17:00',
  minIntervalValue: 30,
  minIntervalUnit: 'minutes',
  outputPreset: 'custom',
  outputTemplate: '{Dow3} {Do} : {times}',
  outputTimeStyle: 'spacedDots',
};

async function getPrefs() {
  return chrome.storage.local.get(PREF_DEFAULTS);
}

function setPref(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

function showView(name) {
  for (const id of ['signin-view', 'main-view', 'settings-view']) {
    $(id).classList.toggle('hidden', id !== name);
  }
}

function showSignInMessage(message) {
  const element = $('signin-error');
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function updateSetupState() {
  $('extension-id').textContent = state.auth.extensionId || chrome.runtime.id;
  $('redirect-uri').textContent = chrome.identity.getRedirectURL();
  $('setup-notice').classList.toggle('hidden', state.auth.configured);

  const button = $('signin-btn');
  button.disabled = !state.auth.configured;
  button.textContent = state.auth.configured
    ? 'Sign in with Google'
    : 'Finish OAuth setup first';
}

function accountSummary(accounts) {
  if (accounts.length === 0) return '';
  if (accounts.length === 1) return accounts[0];
  return `${accounts[0]} +${accounts.length - 1} more`;
}

function setAccounts(accounts) {
  state.auth = {
    ...state.auth,
    signedIn: accounts.length > 0,
    accounts,
  };
  $('account-email').textContent = accountSummary(accounts);

  if (!state.auth.signedIn) {
    state.intervals = null;
    $('output').classList.add('hidden');
    showView('signin-view');
  }
}

async function renderOutput(intervals) {
  state.intervals = intervals.slice().sort((a, b) => a.start - b.start);
  const prefs = await getPrefs();
  state.displayTz = prefs.convertTz || prefs.operatingTz;
  state.convertDropdown.setValue(state.displayTz, { silent: true });
  await rerenderOutput(prefs);
  $('output').classList.remove('hidden');
  $('output').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function rerenderOutput(prefetchedPrefs = null) {
  const prefs = prefetchedPrefs || (await getPrefs());
  const timeZone = state.displayTz || prefs.operatingTz;
  $('tz-name').textContent = friendlyTzName(timeZone);

  const hasResults = Boolean(state.intervals?.length);
  $('output-text').classList.toggle('hidden', !hasResults);
  $('no-avail').classList.toggle('hidden', hasResults);
  $('copy-btn').disabled = !hasResults;

  $('output-text').value = hasResults
    ? formatAvailability(state.intervals, timeZone, resolveFormat(prefs))
    : '';
}

async function refreshOutputFromPrefs() {
  if (!state.intervals) return;
  const prefs = await getPrefs();
  if (!prefs.convertTz) {
    state.displayTz = prefs.operatingTz;
    state.convertDropdown.setValue(state.displayTz, { silent: true });
  }
  await rerenderOutput(prefs);
}

function initOutput(initialTimeZone) {
  state.displayTz = initialTimeZone;
  state.convertDropdown = createTimezoneDropdown($('convert-tz'), {
    value: initialTimeZone,
    onChange: async (timeZone) => {
      state.displayTz = timeZone;
      await setPref('convertTz', timeZone);
      if (state.intervals) await rerenderOutput();
    },
  });

  let copiedTimer;
  $('copy-btn').addEventListener('click', async () => {
    const copied = $('copied');
    try {
      await navigator.clipboard.writeText($('output-text').value);
      copied.textContent = 'Copied!';
      copied.classList.remove('copy-error');
    } catch {
      copied.textContent = 'Copy failed';
      copied.classList.add('copy-error');
    }
    copied.classList.remove('hidden');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => copied.classList.add('hidden'), 1800);
  });
}

function selectTab(name) {
  const selected = name === 'range' ? 'range' : 'pick';
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === selected;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('tab-pick').classList.toggle('hidden', selected !== 'pick');
  $('tab-range').classList.toggle('hidden', selected !== 'range');
}

function initTabs(lastTab) {
  selectTab(lastTab);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', async () => {
      selectTab(tab.dataset.tab);
      await setPref('lastTab', tab.dataset.tab);
    });
  }
}

async function signIn() {
  const button = $('signin-btn');
  showSignInMessage('');
  button.disabled = true;
  button.textContent = 'Signing in…';

  try {
    const response = await sendMessage({ type: 'SIGN_IN' });
    if (response?.ok) {
      setAccounts(response.accounts);
      showView('main-view');
    } else {
      showSignInMessage(response?.error || 'Sign-in failed. Please try again.');
    }
  } catch {
    showSignInMessage('The extension service worker could not be reached. Reload the extension.');
  } finally {
    updateSetupState();
  }
}

async function signOut() {
  try {
    const response = await sendMessage({ type: 'SIGN_OUT' });
    if (response?.error) {
      showSignInMessage(response.error);
      return;
    }
    setAccounts([]);
    showSignInMessage(response?.warning || '');
  } catch {
    showSignInMessage('The extension service worker could not be reached. Reload the extension.');
  }
}

async function init() {
  let auth;
  let prefs;
  try {
    [auth, prefs] = await Promise.all([
      sendMessage({ type: 'GET_AUTH' }),
      getPrefs(),
    ]);
  } catch {
    const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
    auth = {
      signedIn: false,
      accounts: [],
      configured:
        clientId.endsWith('.apps.googleusercontent.com') &&
        !clientId.includes('REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID'),
      extensionId: chrome.runtime.id,
    };
    prefs = await getPrefs();
  }

  state.auth = {
    signedIn: Boolean(auth?.signedIn),
    accounts: auth?.accounts || [],
    configured: Boolean(auth?.configured),
    extensionId: auth?.extensionId || chrome.runtime.id,
  };

  initOutput(prefs.convertTz || prefs.operatingTz);
  initTabs(prefs.lastTab);

  const context = {
    getPrefs,
    setPref,
    renderOutput,
    refreshOutputFromPrefs,
    sendMessage,
    getAuth: () => state.auth,
    setAccounts,
  };

  initPickDates(context);
  initDateRange(context);
  initSettings(context, {
    onShow: () => showView('settings-view'),
    onBack: () => showView('main-view'),
  });

  $('signin-btn').addEventListener('click', signIn);
  $('signout-link').addEventListener('click', (event) => {
    event.preventDefault();
    signOut();
  });

  setAccounts(state.auth.signedIn ? state.auth.accounts : []);
  updateSetupState();
  showView(state.auth.signedIn ? 'main-view' : 'signin-view');
}

init();
