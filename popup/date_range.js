// Date Range mode: scan each date in a bounded range and retain free
// intervals that meet the requested minimum duration.

import { computeFreeIntervals } from '../utils/availability.js';
import { fetchAllAccountsBusy } from '../utils/calendar_api.js';
import { getZonedParts, zonedTimeToUtc } from '../utils/timezone.js';

const $ = (id) => document.getElementById(id);
const MAX_RANGE_DAYS = 92;

function parseTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute, minutes: hour * 60 + minute };
}

function eachDate(startString, endString) {
  const [startYear, startMonth, startDay] = startString.split('-').map(Number);
  const [endYear, endMonth, endDay] = endString.split('-').map(Number);
  const dates = [];
  let cursor = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);

  while (cursor <= end) {
    const date = new Date(cursor);
    dates.push([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]);
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}

function dateString(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addCalendarDays(year, month, day, amount) {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

export function initDateRange(context) {
  function showError(message) {
    const element = $('range-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  context.getPrefs().then((prefs) => {
    const today = getZonedParts(new Date(), prefs.operatingTz);
    const start = dateString(today.year, today.month, today.day);
    const weekEnd = addCalendarDays(today.year, today.month, today.day, 6);
    const end = dateString(...weekEnd);

    $('range-start-date').value = start;
    $('range-end-date').value = end;
    $('range-start-date').min = start;
    $('range-end-date').min = start;
    $('range-start-time').value = prefs.timeStart;
    $('range-end-time').value = prefs.timeEnd;
    $('min-value').value = prefs.minIntervalValue;
    $('min-unit').value = prefs.minIntervalUnit;
  });

  $('range-start-time').addEventListener('change', async () => {
    await context.setPref('timeStart', $('range-start-time').value);
  });
  $('range-end-time').addEventListener('change', async () => {
    await context.setPref('timeEnd', $('range-end-time').value);
  });
  $('min-value').addEventListener('change', async () => {
    await context.setPref('minIntervalValue', Number($('min-value').value));
  });
  $('min-unit').addEventListener('change', async () => {
    await context.setPref('minIntervalUnit', $('min-unit').value);
  });

  $('range-start-date').addEventListener('change', () => {
    $('range-end-date').min = $('range-start-date').value;
  });

  $('range-find').addEventListener('click', async () => {
    showError('');

    const startDate = $('range-start-date').value;
    const endDate = $('range-end-date').value;
    if (!startDate || !endDate) {
      showError('Please choose a start and end date.');
      return;
    }
    if (endDate < startDate) {
      showError('End date must be on or after the start date.');
      return;
    }

    const startValue = $('range-start-time').value;
    const endValue = $('range-end-time').value;
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

    const minimumValue = Number($('min-value').value);
    if (!Number.isFinite(minimumValue) || minimumValue <= 0) {
      showError('Minimum interval must be a positive number.');
      return;
    }
    const minimumMs =
      minimumValue * ($('min-unit').value === 'hours' ? 60 * 60 * 1000 : 60 * 1000);

    const dates = eachDate(startDate, endDate);
    if (dates.length > MAX_RANGE_DAYS) {
      showError(`Please choose a date range of ${MAX_RANGE_DAYS} days or fewer.`);
      return;
    }

    const button = $('range-find');
    button.disabled = true;
    button.textContent = 'Finding…';

    try {
      const prefs = await context.getPrefs();
      const timeZone = prefs.operatingTz;
      const windows = dates.map(([year, month, day]) => {
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
        computeFreeIntervals(window.start, window.end, busy, minimumMs)
      );
      await context.renderOutput(free);
    } catch (error) {
      showError(error.userMessage || "Couldn't load calendar availability. Please try again.");
    } finally {
      button.disabled = false;
      button.textContent = 'Find Availability';
    }
  });
}

