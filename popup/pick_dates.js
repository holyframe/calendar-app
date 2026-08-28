// Pick Dates mode: select up to 31 individual dates and one daily time range.

import { computeFreeIntervals } from '../utils/availability.js';
import { fetchAllAccountsBusy } from '../utils/calendar_api.js';
import { getZonedParts, zonedTimeToUtc } from '../utils/timezone.js';

const $ = (id) => document.getElementById(id);
const MAX_SELECTED_DATES = 31;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getTrailingMonthDates(year, monthIndex) {
  const firstDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const trailingCount = (7 - ((firstDow + daysInMonth) % 7)) % 7;
  const nextMonth = new Date(year, monthIndex + 1, 1);

  return Array.from({ length: trailingCount }, (_, index) => ({
    year: nextMonth.getFullYear(),
    monthIndex: nextMonth.getMonth(),
    day: index + 1,
  }));
}

function parseTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute, minutes: hour * 60 + minute };
}

export function initPickDates(context) {
  const grid = $('cal-grid');
  const selected = new Set();
  let operatingTimeZone = 'UTC';
  let todayIso = '';
  let viewYear;
  let viewMonth;
  let dragging = false;
  let paintMode = true;

  function setTodayForTimezone(timeZone, { resetView = false } = {}) {
    const today = getZonedParts(new Date(), timeZone);
    todayIso = isoDate(today.year, today.month - 1, today.day);
    if (resetView || viewYear == null) {
      viewYear = today.year;
      viewMonth = today.month - 1;
    }
  }

  function updateCount() {
    $('sel-count').textContent =
      `${selected.size} date${selected.size === 1 ? '' : 's'} selected`;
  }

  function render() {
    if (viewYear == null) return;
    $('cal-label').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    grid.innerHTML = '';

    for (const day of DOW) {
      const element = document.createElement('div');
      element.className = 'cal-dow';
      element.textContent = day;
      element.setAttribute('aria-hidden', 'true');
      grid.appendChild(element);
    }

    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const appendDateCell = (year, monthIndex, day, { adjacent = false } = {}) => {
      const iso = isoDate(year, monthIndex, day);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cal-cell';
      if (adjacent) element.classList.add('adjacent');
      element.textContent = day;
      element.dataset.date = iso;
      element.setAttribute('aria-label', `${MONTHS[monthIndex]} ${day}, ${year}`);

      if (iso < todayIso) {
        element.classList.add('disabled');
        element.disabled = true;
      }
      if (iso === todayIso) element.classList.add('today');
      if (selected.has(iso)) element.classList.add('selected');
      element.setAttribute('aria-pressed', String(selected.has(iso)));
      grid.appendChild(element);
    };

    for (let index = 0; index < firstDow; index++) {
      const blank = document.createElement('div');
      blank.className = 'cal-cell blank';
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      appendDateCell(viewYear, viewMonth, day);
    }

    for (const date of getTrailingMonthDates(viewYear, viewMonth)) {
      appendDateCell(date.year, date.monthIndex, date.day, { adjacent: true });
    }
  }

  function paintableCell(target) {
    const cell = target.closest('.cal-cell');
    if (!cell || cell.classList.contains('blank') || cell.disabled) return null;
    return cell;
  }

  function showError(message) {
    const element = $('pick-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  function applyCell(cell) {
    const iso = cell.dataset.date;
    if (paintMode && !selected.has(iso) && selected.size >= MAX_SELECTED_DATES) {
      showError(`Choose no more than ${MAX_SELECTED_DATES} dates at a time.`);
      return;
    }

    if (paintMode) selected.add(iso);
    else selected.delete(iso);
    cell.classList.toggle('selected', paintMode);
    cell.setAttribute('aria-pressed', String(paintMode));
    updateCount();
  }

  grid.addEventListener('pointerdown', (event) => {
    const cell = paintableCell(event.target);
    if (!cell) return;
    event.preventDefault();
    dragging = true;
    paintMode = !selected.has(cell.dataset.date);
    applyCell(cell);
  });

  grid.addEventListener('pointerover', (event) => {
    if (!dragging) return;
    const cell = paintableCell(event.target);
    if (cell) applyCell(cell);
  });

  grid.addEventListener('click', (event) => {
    // Native keyboard activation fires click with detail 0. Pointer selection
    // was already handled by pointerdown and must not be toggled twice.
    if (event.detail !== 0) return;
    const cell = paintableCell(event.target);
    if (!cell) return;
    paintMode = !selected.has(cell.dataset.date);
    applyCell(cell);
  });

  document.addEventListener('pointerup', () => {
    dragging = false;
  });
  document.addEventListener('pointercancel', () => {
    dragging = false;
  });

  $('cal-prev').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    }
    render();
  });

  $('cal-next').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    render();
  });

  $('clear-all').addEventListener('click', (event) => {
    event.preventDefault();
    selected.clear();
    showError('');
    render();
    updateCount();
  });

  context.getPrefs().then((prefs) => {
    operatingTimeZone = prefs.operatingTz;
    setTodayForTimezone(operatingTimeZone, { resetView: true });
    $('pick-start').value = prefs.timeStart;
    $('pick-end').value = prefs.timeEnd;
    render();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.operatingTz?.newValue) return;
    operatingTimeZone = changes.operatingTz.newValue;
    setTodayForTimezone(operatingTimeZone);
    render();
  });

  $('pick-start').addEventListener('change', async () => {
    await context.setPref('timeStart', $('pick-start').value);
  });
  $('pick-end').addEventListener('change', async () => {
    await context.setPref('timeEnd', $('pick-end').value);
  });

  $('pick-find').addEventListener('click', async () => {
    showError('');

    if (selected.size === 0) {
      showError('Please select at least one date.');
      return;
    }

    const startValue = $('pick-start').value;
    const endValue = $('pick-end').value;
    if (!startValue || !endValue) {
      showError('Please choose a start and end time.');
      return;
    }

    const startTime = parseTime(startValue);
    const endTime = parseTime(endValue);
    if (endTime.minutes <= startTime.minutes) {
      showError('End time must be after start time.');
      return;
    }

    const button = $('pick-find');
    button.disabled = true;
    button.textContent = 'Finding…';

    try {
      const prefs = await context.getPrefs();
      const timeZone = prefs.operatingTz;
      const windows = [...selected].sort().map((iso) => {
        const [year, month, day] = iso.split('-').map(Number);
        const start = zonedTimeToUtc(
          year,
          month,
          day,
          startTime.hour,
          startTime.minute,
          timeZone
        ).getTime();
        const end = zonedTimeToUtc(
          year,
          month,
          day,
          endTime.hour,
          endTime.minute,
          timeZone
        ).getTime();
        if (end <= start) {
          const error = new Error('The selected time window is invalid after timezone conversion.');
          error.userMessage = 'The selected time window is invalid because of a timezone clock change.';
          throw error;
        }
        return { start, end };
      });

      const { busy, checkedCount } = await fetchAllAccountsBusy(windows, timeZone);
      if (checkedCount === 0) {
        showError('Please select at least one calendar in Settings.');
        return;
      }

      const free = windows.flatMap((window) =>
        computeFreeIntervals(window.start, window.end, busy)
      );
      await context.renderOutput(free);
    } catch (error) {
      showError(error.userMessage || "Couldn't load calendar availability. Please try again.");
    } finally {
      button.disabled = false;
      button.textContent = 'Find Availability';
    }
  });

  setTodayForTimezone(operatingTimeZone, { resetView: true });
  render();
  updateCount();
}
