// Settings: account management, local calendar selection, output format,
// and operating timezone.

import { fetchCalendarGroups } from '../utils/calendar_api.js';
import { createTimezoneDropdown, zonedTimeToUtc } from '../utils/timezone.js';
import {
  formatAvailability,
  resolveFormat,
  FORMAT_PRESETS,
  TIME_STYLE_LABELS,
} from '../utils/formatter.js';

const $ = (id) => document.getElementById(id);
const calendarKey = (email) => `calChecked::${email}`;

export function initSettings(context, navigation) {
  let timezoneDropdown = null;
  let formatInitialized = false;
  const calendarsByAccount = new Map();

  function showSettingsError(message) {
    const element = $('cal-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  $('settings-btn').addEventListener('click', () => {
    navigation.onShow();
    load();
  });

  $('back-btn').addEventListener('click', async () => {
    navigation.onBack();
    await context.refreshOutputFromPrefs();
  });

  async function load() {
    const prefs = await context.getPrefs();

    if (!timezoneDropdown) {
      timezoneDropdown = createTimezoneDropdown($('operating-tz'), {
        value: prefs.operatingTz,
        onChange: async (timeZone) => {
          await context.setPref('operatingTz', timeZone);
          await updateFormatPreview();
        },
      });
    } else {
      timezoneDropdown.setValue(prefs.operatingTz, { silent: true });
    }

    if (!formatInitialized) {
      initFormatSection(prefs);
      formatInitialized = true;
    }

    renderAccounts();
    await loadCalendars();
  }

  function renderAccounts() {
    const list = $('account-list');
    list.innerHTML = '';

    for (const email of context.getAuth().accounts) {
      const row = document.createElement('div');
      row.className = 'account-row';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = email;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${email}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        showSettingsError('');
        try {
          const response = await context.sendMessage({ type: 'REMOVE_ACCOUNT', email });
          if (response?.error) {
            showSettingsError(response.error);
            return;
          }
          context.setAccounts(response.accounts || []);
          renderAccounts();
          await loadCalendars();
          showSettingsError(response.warning || '');
        } finally {
          remove.disabled = false;
        }
      });

      row.append(name, remove);
      list.appendChild(row);
    }
  }

  $('add-account').addEventListener('click', async () => {
    const button = $('add-account');
    button.disabled = true;
    button.textContent = 'Waiting for Google…';
    showSettingsError('');

    try {
      const response = await context.sendMessage({ type: 'ADD_ACCOUNT' });
      if (response?.ok) {
        context.setAccounts(response.accounts);
        renderAccounts();
        await loadCalendars();
      } else {
        showSettingsError(response?.error || 'The account could not be added.');
      }
    } catch {
      showSettingsError('The extension service worker could not be reached.');
    } finally {
      button.disabled = false;
      button.textContent = '+ Add Google account';
    }
  });

  async function getStoredState(email) {
    const key = calendarKey(email);
    return (await chrome.storage.local.get(key))[key] || {};
  }

  function saveState(email, stored) {
    return chrome.storage.local.set({ [calendarKey(email)]: stored });
  }

  async function loadCalendars() {
    const list = $('cal-list');
    showSettingsError('');
    calendarsByAccount.clear();

    const emails = context.getAuth().accounts;
    if (emails.length === 0) {
      list.innerHTML = '<div class="empty">No accounts signed in.</div>';
      return;
    }

    list.innerHTML = '<div class="loading">Loading&hellip;</div>';

    let results;
    try {
      results = await fetchCalendarGroups();
    } catch (error) {
      list.innerHTML = '';
      showSettingsError(error.userMessage || 'Could not load calendars.');
      return;
    }

    list.innerHTML = '';
    for (const result of results) {
      if (!result.error) calendarsByAccount.set(result.email, result.calendars);
      await renderAccountGroup(list, result);
    }
  }

  async function renderAccountGroup(list, { email, calendars, error }) {
    const header = document.createElement('div');
    header.className = 'cal-group-header';
    header.textContent = email;
    list.appendChild(header);

    if (error) {
      const element = document.createElement('div');
      element.className = 'error';
      element.textContent = error;
      list.appendChild(element);
      return;
    }

    const stored = await getStoredState(email);
    for (const calendar of calendars) {
      const row = document.createElement('label');
      row.className = 'cal-row';

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(calendar.backgroundColor || '')
        ? calendar.backgroundColor
        : '#4285f4';
      dot.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent =
        calendar.summaryOverride || calendar.summary || calendar.id;
      if (calendar.primary) {
        const primary = document.createElement('span');
        primary.className = 'primary-label';
        primary.textContent = 'Primary';
        name.append(' ', primary);
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = stored[calendar.id] !== false;
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        const current = await getStoredState(email);
        current[calendar.id] = checkbox.checked;
        await saveState(email, current);
        checkbox.disabled = false;
      });

      row.append(dot, name, checkbox);
      list.appendChild(row);
    }
  }

  async function setAll(checked) {
    const writes = [];
    for (const [email, calendars] of calendarsByAccount) {
      const stored = await getStoredState(email);
      for (const calendar of calendars) stored[calendar.id] = checked;
      writes.push(saveState(email, stored));
    }
    await Promise.all(writes);
    await loadCalendars();
  }

  $('select-all').addEventListener('click', async (event) => {
    event.preventDefault();
    await setAll(true);
  });

  $('deselect-all').addEventListener('click', async (event) => {
    event.preventDefault();
    await setAll(false);
  });

  function initFormatSection(prefs) {
    const presets = $('format-presets');
    const options = [
      ...Object.entries(FORMAT_PRESETS),
      ['custom', { label: 'Custom' }],
    ];

    for (const [id, preset] of options) {
      const row = document.createElement('label');
      row.className = 'format-option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'format-preset';
      radio.value = id;
      radio.checked = prefs.outputPreset === id;
      radio.addEventListener('change', async () => {
        await context.setPref('outputPreset', id);
        $('custom-format').classList.toggle('hidden', id !== 'custom');
        await updateFormatPreview();
      });

      const text = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = preset.label;
      text.appendChild(title);

      if (preset.example) {
        const example = document.createElement('span');
        example.className = 'format-example';
        example.textContent = preset.example;
        text.appendChild(example);
      }

      row.append(radio, text);
      presets.appendChild(row);
    }

    $('custom-format').classList.toggle('hidden', prefs.outputPreset !== 'custom');
    $('format-template').value = prefs.outputTemplate;

    const style = $('format-time-style');
    for (const [id, label] of Object.entries(TIME_STYLE_LABELS)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      style.appendChild(option);
    }
    style.value = prefs.outputTimeStyle;

    $('format-template').addEventListener('input', async () => {
      await context.setPref('outputTemplate', $('format-template').value);
      await updateFormatPreview();
    });

    style.addEventListener('change', async () => {
      await context.setPref('outputTimeStyle', style.value);
      await updateFormatPreview();
    });

    updateFormatPreview();
  }

  async function updateFormatPreview() {
    const prefs = await context.getPrefs();
    const timeZone = prefs.operatingTz;
    const sample = [
      {
        start: zonedTimeToUtc(2026, 7, 9, 13, 0, timeZone).getTime(),
        end: zonedTimeToUtc(2026, 7, 9, 15, 0, timeZone).getTime(),
      },
      {
        start: zonedTimeToUtc(2026, 7, 9, 16, 30, timeZone).getTime(),
        end: zonedTimeToUtc(2026, 7, 9, 18, 0, timeZone).getTime(),
      },
    ];

    $('format-preview').textContent = formatAvailability(
      sample,
      timeZone,
      resolveFormat(prefs)
    );
  }
}
