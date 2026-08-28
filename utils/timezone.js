// Timezone utilities built on the browser-native Intl API.

export const PINNED_TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern Time (ET)' },
  { id: 'America/Chicago', label: 'Central Time (CT)' },
  { id: 'America/Denver', label: 'Mountain Time (MT)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { id: 'UTC', label: 'UTC' },
];

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimezone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function getAllTimezones() {
  if (typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  return PINNED_TIMEZONES.map((item) => item.id);
}

const dtfCache = new Map();

function getFormatter(timeZone) {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'long',
        hourCycle: 'h23',
      })
    );
  }
  return dtfCache.get(timeZone);
}

export function getZonedParts(date, timeZone) {
  const raw = {};
  for (const part of getFormatter(timeZone).formatToParts(date)) raw[part.type] = part.value;
  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour: Number(raw.hour),
    minute: Number(raw.minute),
    weekday: raw.weekday,
  };
}

export function getOffsetMs(timeZone, epochMs) {
  const minuteEpoch = Math.floor(epochMs / 60000) * 60000;
  const parts = getZonedParts(new Date(minuteEpoch), timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    minuteEpoch
  );
}

function invalidLocalTimeError(year, month, day, hour, minute, timeZone) {
  const error = new RangeError('The selected local time does not exist in this timezone.');
  error.code = 'INVALID_LOCAL_TIME';
  error.userMessage =
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ` +
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} does not exist in ` +
    `${timeZone} because of a timezone clock change. Choose a different time.`;
  return error;
}

// Converts a wall-clock time to an instant. Candidate offsets are checked by
// round-tripping through Intl. This rejects nonexistent DST times instead of
// silently moving them backward or forward. Ambiguous fall-back times resolve
// to the earlier matching instant.
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  if (!isValidTimezone(timeZone)) {
    const error = new RangeError(`Unknown timezone: ${timeZone}`);
    error.code = 'INVALID_TIMEZONE';
    error.userMessage = 'The selected timezone is no longer available. Choose another timezone.';
    throw error;
  }

  const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const target = {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: normalized.getUTCHours(),
    minute: normalized.getUTCMinutes(),
  };
  const wallEpoch = normalized.getTime();

  const offsets = new Set();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 6) {
    offsets.add(getOffsetMs(timeZone, wallEpoch + deltaHours * 60 * 60 * 1000));
  }

  const candidates = [];
  for (const offset of offsets) {
    const candidate = wallEpoch - offset;
    const parts = getZonedParts(new Date(candidate), timeZone);
    if (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute
    ) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    throw invalidLocalTimeError(
      target.year,
      target.month,
      target.day,
      target.hour,
      target.minute,
      timeZone
    );
  }

  return new Date(Math.min(...candidates));
}

export function offsetLabel(timeZone) {
  try {
    const minutes = getOffsetMs(timeZone, Date.now()) / 60000;
    const sign = minutes < 0 ? '-' : '+';
    const absolute = Math.abs(minutes);
    const hours = Math.floor(absolute / 60);
    const remainder = absolute % 60;
    return `UTC${sign}${hours}${remainder ? `:${String(remainder).padStart(2, '0')}` : ''}`;
  } catch {
    return 'UTC';
  }
}

export function friendlyTzName(timeZone) {
  const pinned = PINNED_TIMEZONES.find((item) => item.id === timeZone);
  if (pinned) return pinned.label;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (name && !/^GMT/.test(name)) return name;
  } catch {
    // Fall through to the IANA identifier.
  }
  return timeZone.replace(/_/g, ' ');
}

function fullLabel(timeZone) {
  const pinned = PINNED_TIMEZONES.find((item) => item.id === timeZone);
  if (pinned) return `${pinned.label} (${offsetLabel(timeZone)})`;
  return `${timeZone.replace(/_/g, ' ')} (${offsetLabel(timeZone)})`;
}

export function createTimezoneDropdown(root, { value, onChange }) {
  root.classList.add('tzdd');
  root.innerHTML = `
    <button type="button" class="tzdd-toggle" aria-haspopup="listbox" aria-expanded="false"></button>
    <div class="tzdd-panel hidden">
      <input type="text" class="tzdd-search" aria-label="Search timezones" placeholder="Search timezones&hellip;">
      <div class="tzdd-list" role="listbox" aria-label="Timezones"></div>
    </div>`;

  const toggle = root.querySelector('.tzdd-toggle');
  const panel = root.querySelector('.tzdd-panel');
  const search = root.querySelector('.tzdd-search');
  const list = root.querySelector('.tzdd-list');

  const pinnedIds = new Set(PINNED_TIMEZONES.map((item) => item.id));
  const zones = getAllTimezones().filter((timeZone) => !pinnedIds.has(timeZone));
  let current = isValidTimezone(value) ? value : detectTimezone();

  function updateToggle() {
    toggle.textContent = fullLabel(current);
  }

  function addHeader(text) {
    const element = document.createElement('div');
    element.className = 'tzdd-header';
    element.textContent = text;
    list.appendChild(element);
  }

  function addOption(timeZone, label) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'tzdd-opt' + (timeZone === current ? ' selected' : '');
    element.dataset.tz = timeZone;
    element.setAttribute('role', 'option');
    element.setAttribute('aria-selected', String(timeZone === current));
    element.textContent = label;
    list.appendChild(element);
  }

  function buildList(filter = '') {
    list.innerHTML = '';
    const query = filter.trim().toLowerCase();
    const matches = (timeZone, extra = '') =>
      !query ||
      timeZone.toLowerCase().includes(query) ||
      timeZone.replace(/_/g, ' ').toLowerCase().includes(query) ||
      extra.toLowerCase().includes(query);

    const pinnedHits = PINNED_TIMEZONES.filter((item) => matches(item.id, item.label));
    if (pinnedHits.length) {
      addHeader('Common');
      for (const item of pinnedHits) {
        addOption(item.id, `${item.label} — ${item.id} (${offsetLabel(item.id)})`);
      }
    }

    const groups = new Map();
    for (const timeZone of zones) {
      if (!matches(timeZone)) continue;
      const region = timeZone.includes('/') ? timeZone.split('/')[0] : 'Other';
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push(timeZone);
    }

    for (const [region, items] of [...groups.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      addHeader(region);
      for (const timeZone of items) addOption(timeZone, fullLabel(timeZone));
    }

    if (!list.children.length) {
      const element = document.createElement('div');
      element.className = 'tzdd-empty';
      element.textContent = 'No matching timezones';
      list.appendChild(element);
    }
  }

  function open() {
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    search.value = '';
    buildList();
    list.querySelector('.tzdd-opt.selected')?.scrollIntoView({ block: 'center' });
    search.focus();
  }

  function close({ restoreFocus = false } = {}) {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }

  function selectTimezone(timeZone) {
    current = timeZone;
    updateToggle();
    close({ restoreFocus: true });
    onChange(timeZone);
  }

  toggle.addEventListener('click', () => {
    panel.classList.contains('hidden') ? open() : close();
  });
  search.addEventListener('input', () => buildList(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close({ restoreFocus: true });
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list.querySelector('.tzdd-opt')?.focus();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = list.querySelector('.tzdd-opt');
      if (first) selectTimezone(first.dataset.tz);
    }
  });
  list.addEventListener('click', (event) => {
    const option = event.target.closest('.tzdd-opt');
    if (option) selectTimezone(option.dataset.tz);
  });
  list.addEventListener('keydown', (event) => {
    const options = [...list.querySelectorAll('.tzdd-opt')];
    const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') close({ restoreFocus: true });
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (index >= 0) selectTimezone(options[index].dataset.tz);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      options[Math.min(options.length - 1, Math.max(0, index + direction))]?.focus();
    }
  });
  document.addEventListener('mousedown', (event) => {
    if (!root.contains(event.target)) close();
  });

  updateToggle();

  return {
    getValue: () => current,
    setValue(timeZone, { silent = false } = {}) {
      current = isValidTimezone(timeZone) ? timeZone : detectTimezone();
      updateToggle();
      if (!silent) onChange(current);
    },
  };
}

