// Today mode: show the day's title/time schedule and find free intervals in
// the operating timezone.

import { computeFreeIntervals } from '../utils/availability.js';
import {
  fetchAllAccountsBusy,
  fetchTodaySchedule,
} from '../utils/calendar_api.js';
import { layoutScheduleEvents } from '../utils/schedule.js';
import { getZonedParts, zonedTimeToUtc } from '../utils/timezone.js';

const $ = (id) => document.getElementById(id);
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOUR_HEIGHT = 52;
const MINUTES_PER_DAY = 24 * 60;
const MAX_CACHED_SCHEDULES = 14;

function parseTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute, minutes: hour * 60 + minute };
}

export function normalizeHourRange(startValue, endValue) {
  const startMinutes = parseTime(String(startValue || '08:00')).minutes;
  const endMinutes = parseTime(String(endValue || '20:00')).minutes;
  let startHour = Number.isFinite(startMinutes)
    ? Math.max(0, Math.min(23, Math.floor(startMinutes / 60)))
    : 8;
  let endHour = Number.isFinite(endMinutes)
    ? Math.max(1, Math.min(24, Math.ceil(endMinutes / 60)))
    : 20;

  if (endHour <= startHour) {
    startHour = Math.min(startHour, 23);
    endHour = startHour + 1;
  }

  return { startHour, endHour };
}

function hourToTimeValue(hour) {
  return String(hour).padStart(2, '0') + ':00';
}

export function getZonedDateForOffset(now, timeZone, dayOffset = 0) {
  const base = getZonedParts(now, timeZone);
  const normalized = new Date(
    Date.UTC(
      base.year,
      base.month - 1,
      base.day + Math.trunc(Number(dayOffset) || 0),
      12
    )
  );
  const localNoon = zonedTimeToUtc(
    normalized.getUTCFullYear(),
    normalized.getUTCMonth() + 1,
    normalized.getUTCDate(),
    12,
    0,
    timeZone
  );
  return getZonedParts(localNoon, timeZone);
}

export function getTodayWindow(
  now,
  timeZone,
  startValue,
  endValue,
  dayOffset = 0
) {
  const date = getZonedDateForOffset(now, timeZone, dayOffset);
  const startTime = parseTime(startValue);
  const endTime = parseTime(endValue);

  return {
    date,
    startMinute: startTime.minutes,
    endMinute: endTime.minutes,
    start: zonedTimeToUtc(
      date.year,
      date.month,
      date.day,
      startTime.hour,
      startTime.minute,
      timeZone
    ).getTime(),
    end: zonedTimeToUtc(
      date.year,
      date.month,
      date.day,
      endTime.hour,
      endTime.minute,
      timeZone
    ).getTime(),
  };
}

export function getTodayDayWindow(now, timeZone, dayOffset = 0) {
  const date = getZonedDateForOffset(now, timeZone, dayOffset);
  return {
    date,
    start: zonedTimeToUtc(
      date.year,
      date.month,
      date.day,
      0,
      0,
      timeZone
    ).getTime(),
    end: zonedTimeToUtc(
      date.year,
      date.month,
      date.day + 1,
      0,
      0,
      timeZone
    ).getTime(),
  };
}

export function formatTodayDate(date) {
  return [
    date.weekday + ',',
    MONTHS[date.month - 1],
    date.day + ',',
    date.year,
  ].join(' ');
}

export function formatScheduleTime(event, timeZone) {
  if (event.allDay) return 'All day';

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    formatter.format(new Date(event.start)) +
    '–' +
    formatter.format(new Date(event.end))
  );
}

export function getEventMinutesForDay(event, dayWindow, timeZone) {
  const startParts = getZonedParts(new Date(event.start), timeZone);
  const endParts = getZonedParts(new Date(event.end), timeZone);
  const startMinute =
    event.start <= dayWindow.start
      ? 0
      : startParts.hour * 60 + startParts.minute;
  let endMinute =
    event.end >= dayWindow.end
      ? MINUTES_PER_DAY
      : endParts.hour * 60 + endParts.minute;

  if (endMinute <= startMinute) {
    endMinute = Math.min(
      MINUTES_PER_DAY,
      startMinute + Math.max(15, (event.end - event.start) / (60 * 1000))
    );
  }
  return { startMinute, endMinute };
}

function minuteLabel(minute) {
  const hour = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return (
    (hour % 12 || 12) +
    (minutes ? ':' + String(minutes).padStart(2, '0') : '') +
    (hour < 12 ? ' AM' : ' PM')
  );
}

function timeZoneAbbreviation(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(new Date(instant));
  return parts.find((part) => part.type === 'timeZoneName')?.value || timeZone;
}

function descriptionToPlainText(value) {
  if (!value) return '';
  const withBreaks = String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|p)>/gi, '\n');
  const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
  for (const element of parsed.querySelectorAll('script, style')) element.remove();
  return parsed.body.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function initToday(context) {
  let scheduleRequestId = 0;
  let currentTimeTimer = null;
  let eventDetailsTrigger = null;
  let renderedScheduleKey = null;
  let selectedDayOffset = 0;
  const scheduleCache = new Map();

  function showError(message) {
    const element = $('today-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  function updateDate(timeZone) {
    const date = getZonedDateForOffset(
      new Date(),
      timeZone,
      selectedDayOffset
    );
    $('today-date').textContent = formatTodayDate(date);
    $('today-date-label').textContent =
      selectedDayOffset === 0
        ? 'Today'
        : selectedDayOffset === -1
          ? 'Yesterday'
          : selectedDayOffset === 1
            ? 'Tomorrow'
            : 'Selected day';
  }

  function todayIsActive() {
    return document
      .querySelector('.tab[data-tab="today"]')
      ?.classList.contains('active');
  }

  function hideEventDetails({ restoreFocus = false } = {}) {
    $('today-event-details').classList.add('hidden');
    if (restoreFocus && eventDetailsTrigger?.isConnected) {
      eventDetailsTrigger.focus();
    }
    eventDetailsTrigger = null;
  }

  function showEventDetails(event, timeZone, trigger) {
    eventDetailsTrigger = trigger;
    $('today-event-details-title').textContent = event.title;
    $('today-event-details-meta').textContent =
      formatScheduleTime(event, timeZone) + ' · ' + event.calendarName;

    const description = descriptionToPlainText(event.description);
    const descriptionElement = $('today-event-details-description');
    descriptionElement.textContent = description || 'No description provided.';
    descriptionElement.classList.toggle('empty-description', !description);

    const panel = $('today-event-details');
    panel.classList.remove('hidden');
    panel.focus();
  }

  function syncTimelineRange(changedHandle = '') {
    const startInput = $('today-view-start');
    const endInput = $('today-view-end');
    let startHour = Number(startInput.value);
    let endHour = Number(endInput.value);

    if (startHour >= endHour) {
      if (changedHandle === 'start') startHour = Math.max(0, endHour - 1);
      else endHour = Math.min(24, startHour + 1);
    }

    startInput.value = String(startHour);
    endInput.value = String(endHour);
    startInput.max = String(endHour - 1);
    endInput.min = String(startHour + 1);
    startInput.setAttribute('aria-valuetext', minuteLabel(startHour * 60));
    endInput.setAttribute('aria-valuetext', minuteLabel(endHour * 60));

    const bar = $('today-view-range-bar');
    bar.style.setProperty('--range-start', (startHour / 24) * 100 + '%');
    bar.style.setProperty('--range-end', (endHour / 24) * 100 + '%');
    $('today-view-range-output').textContent =
      minuteLabel(startHour * 60) + ' – ' + minuteLabel(endHour * 60);

    return {
      startHour,
      endHour,
      startValue: hourToTimeValue(startHour),
      endValue: hourToTimeValue(endHour),
    };
  }

  async function saveTimelineRange(changedHandle) {
    const range = syncTimelineRange(changedHandle);
    await context.setPref('todayViewStart', range.startValue);
    await context.setPref('todayViewEnd', range.endValue);
    await loadSchedule();
  }

  function setScheduleMessage(message, className = 'empty') {
    clearInterval(currentTimeTimer);
    currentTimeTimer = null;
    renderedScheduleKey = null;
    hideEventDetails();
    $('today-schedule-zone').textContent = '';
    const schedule = $('today-schedule');
    schedule.innerHTML = '';
    const element = document.createElement('div');
    element.className = className;
    element.setAttribute('role', 'status');
    element.textContent = message;
    schedule.appendChild(element);
  }

  function setScheduleNote(message = '', isError = false) {
    const note = $('today-schedule-note');
    note.textContent = message;
    note.className = message ? (isError ? 'error' : 'hint') : 'hint hidden';
  }

  function scheduleKey(timeZone, viewWindow) {
    const { year, month, day } = viewWindow.date;
    const accounts = [...context.getAuth().accounts].sort().join(',');
    return [
      accounts,
      timeZone,
      year,
      month,
      day,
      viewWindow.startMinute,
      viewWindow.endMinute,
    ].join('|');
  }

  function rememberSchedule(key, value) {
    scheduleCache.delete(key);
    scheduleCache.set(key, value);
    while (scheduleCache.size > MAX_CACHED_SCHEDULES) {
      scheduleCache.delete(scheduleCache.keys().next().value);
    }
  }

  function renderSchedule(events, timeZone, dayWindow, viewWindow) {
    clearInterval(currentTimeTimer);
    currentTimeTimer = null;
    hideEventDetails();
    renderedScheduleKey = scheduleKey(timeZone, viewWindow);
    const schedule = $('today-schedule');
    schedule.innerHTML = '';
    $('today-schedule-zone').textContent = timeZoneAbbreviation(
      timeZone,
      dayWindow.start
    );

    const allDayEvents = events.filter((event) => event.allDay);
    if (allDayEvents.length > 0) {
      const allDay = document.createElement('div');
      allDay.className = 'timeline-all-day';

      const label = document.createElement('span');
      label.className = 'timeline-all-day-label';
      label.textContent = 'All day';

      const items = document.createElement('div');
      items.className = 'timeline-all-day-events';
      for (const event of allDayEvents) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'timeline-all-day-event';
        item.style.setProperty('--event-color', event.calendarColor);
        item.textContent = event.title;
        item.title = event.title + ' · ' + event.calendarName;
        item.setAttribute(
          'aria-label',
          event.title + ', all day, ' + event.calendarName + ', show details'
        );
        item.addEventListener('click', () =>
          showEventDetails(event, timeZone, item)
        );
        items.appendChild(item);
      }

      allDay.append(label, items);
      schedule.appendChild(allDay);
    }

    const scroll = document.createElement('div');
    scroll.className = 'timeline-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute(
      'aria-label',
      'Schedule from ' +
        minuteLabel(viewWindow.startMinute) +
        ' to ' +
        minuteLabel(viewWindow.endMinute)
    );

    const canvas = document.createElement('div');
    canvas.className = 'timeline-canvas';
    const rangeStart = viewWindow.startMinute;
    const rangeEnd = viewWindow.endMinute;
    canvas.style.height =
      ((rangeEnd - rangeStart) / 60) * HOUR_HEIGHT + 'px';

    const markers = [rangeStart];
    let nextHour = Math.ceil(rangeStart / 60) * 60;
    if (nextHour === rangeStart) nextHour += 60;
    while (nextHour < rangeEnd) {
      markers.push(nextHour);
      nextHour += 60;
    }
    markers.push(rangeEnd);

    for (const minute of markers) {
      const marker = document.createElement('div');
      marker.className = 'timeline-hour';
      marker.style.top =
        ((minute - rangeStart) / 60) * HOUR_HEIGHT + 'px';
      marker.setAttribute('aria-hidden', 'true');

      if (minute < rangeEnd) {
        const label = document.createElement('span');
        label.className = 'timeline-hour-label';
        label.textContent = minuteLabel(minute);
        marker.appendChild(label);
      }

      const line = document.createElement('span');
      line.className = 'timeline-hour-line';
      marker.appendChild(line);
      canvas.appendChild(marker);
    }

    const eventLayer = document.createElement('div');
    eventLayer.className = 'timeline-events';
    const timedEvents = events
      .filter((event) => !event.allDay)
      .map((event) => ({
        ...event,
        ...getEventMinutesForDay(event, dayWindow, timeZone),
      }));
    const positioned = layoutScheduleEvents(
      timedEvents,
      HOUR_HEIGHT,
      rangeStart,
      rangeEnd
    );

    for (const event of positioned) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'timeline-event';
      item.style.setProperty('--event-color', event.calendarColor);
      item.style.top = event.top + 'px';
      item.style.height = event.height + 'px';
      item.style.left = (event.column / event.columns) * 100 + '%';
      item.style.width = 'calc(' + 100 / event.columns + '% - 3px)';
      const formattedTime = formatScheduleTime(event, timeZone);
      item.title =
        event.title + '\n' + formattedTime + '\n' + event.calendarName;
      item.setAttribute(
        'aria-label',
        event.title +
          ', ' +
          formattedTime +
          ', ' +
          event.calendarName +
          ', show details'
      );
      item.addEventListener('click', () =>
        showEventDetails(event, timeZone, item)
      );

      const title = document.createElement('span');
      title.className = 'timeline-event-title';
      title.textContent = event.title;

      const time = document.createElement('span');
      time.className = 'timeline-event-time';
      time.textContent = formattedTime;

      item.append(title, time);
      eventLayer.appendChild(item);
    }
    canvas.appendChild(eventLayer);

    const nowLine = document.createElement('div');
    nowLine.className = 'timeline-now';
    nowLine.setAttribute('aria-hidden', 'true');
    canvas.appendChild(nowLine);

    function updateCurrentTime() {
      const now = Date.now();
      const visible = now >= viewWindow.start && now < viewWindow.end;
      nowLine.classList.toggle('hidden', !visible);
      if (!visible) return null;
      const parts = getZonedParts(new Date(now), timeZone);
      const minute = parts.hour * 60 + parts.minute;
      const top = ((minute - rangeStart) / 60) * HOUR_HEIGHT;
      nowLine.style.top = top + 'px';
      return top;
    }

    scroll.appendChild(canvas);
    schedule.appendChild(scroll);
    const nowTop = updateCurrentTime();
    currentTimeTimer = setInterval(updateCurrentTime, 60 * 1000);

    requestAnimationFrame(() => {
      const focusTop = nowTop ?? positioned[0]?.top ?? 0;
      scroll.scrollTop = Math.max(0, focusTop - scroll.clientHeight * 0.35);
    });
  }

  async function loadSchedule() {
    const requestId = ++scheduleRequestId;
    const refresh = $('today-refresh');
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    $('today-schedule').setAttribute('aria-busy', 'true');

    try {
      const prefs = await context.getPrefs();
      const timeZone = prefs.operatingTz;
      const dayWindow = getTodayDayWindow(
        new Date(),
        timeZone,
        selectedDayOffset
      );
      const range = syncTimelineRange();
      const viewWindow = getTodayWindow(
        new Date(),
        timeZone,
        range.startValue,
        range.endValue,
        selectedDayOffset
      );
      const viewKey = scheduleKey(timeZone, viewWindow);
      if (renderedScheduleKey !== viewKey) {
        const cached = scheduleCache.get(viewKey);
        setScheduleNote(cached?.note || '');
        renderSchedule(cached?.events || [], timeZone, dayWindow, viewWindow);
      }
      const result = await fetchTodaySchedule(
        { start: viewWindow.start, end: viewWindow.end },
        timeZone
      );
      if (requestId !== scheduleRequestId) return;

      if (result.calendarCount === 0) {
        setScheduleMessage('No calendars were found for the connected accounts.');
        return;
      }
      if (result.readableCount === 0) {
        setScheduleMessage('Your calendars only share free/busy details.');
        return;
      }

      const note =
        result.readableCount < result.calendarCount
          ? 'Some calendars only share free/busy details, so their events cannot be shown.'
          : '';
      rememberSchedule(viewKey, { events: result.events, note });
      setScheduleNote(note);
      renderSchedule(result.events, timeZone, dayWindow, viewWindow);
    } catch (error) {
      if (requestId !== scheduleRequestId) return;
      setScheduleNote(
        error.userMessage || "Couldn't load today’s schedule. Please try again.",
        true
      );
    } finally {
      if (requestId === scheduleRequestId) {
        refresh.disabled = false;
        refresh.textContent = 'Refresh';
        $('today-schedule').setAttribute('aria-busy', 'false');
      }
    }
  }

  context.getPrefs().then((prefs) => {
    $('today-start').value = prefs.timeStart;
    $('today-end').value = prefs.timeEnd;
    const range = normalizeHourRange(prefs.todayViewStart, prefs.todayViewEnd);
    $('today-view-start').value = String(range.startHour);
    $('today-view-end').value = String(range.endHour);
    syncTimelineRange();
    updateDate(prefs.operatingTz);
    if (todayIsActive()) loadSchedule();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.operatingTz?.newValue) return;
    updateDate(changes.operatingTz.newValue);
    if (todayIsActive()) loadSchedule();
  });

  document
    .querySelector('.tab[data-tab="today"]')
    .addEventListener('click', loadSchedule);
  $('today-refresh').addEventListener('click', loadSchedule);
  $('today-prev-day').addEventListener('click', async () => {
    selectedDayOffset -= 1;
    const prefs = await context.getPrefs();
    updateDate(prefs.operatingTz);
    await loadSchedule();
  });
  $('today-next-day').addEventListener('click', async () => {
    selectedDayOffset += 1;
    const prefs = await context.getPrefs();
    updateDate(prefs.operatingTz);
    await loadSchedule();
  });
  $('today-event-details-close').addEventListener('click', () =>
    hideEventDetails({ restoreFocus: true })
  );
  $('today-event-details').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideEventDetails({ restoreFocus: true });
  });

  $('today-view-start').addEventListener('input', () => syncTimelineRange('start'));
  $('today-view-end').addEventListener('input', () => syncTimelineRange('end'));
  $('today-view-start').addEventListener('change', () => saveTimelineRange('start'));
  $('today-view-end').addEventListener('change', () => saveTimelineRange('end'));

  $('today-view-range-bar').addEventListener('pointerdown', (event) => {
    if (event.target.matches('input')) return;
    const bar = $('today-view-range-bar');
    const rect = bar.getBoundingClientRect();
    const hour = Math.round(
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 24
    );
    const startInput = $('today-view-start');
    const endInput = $('today-view-end');
    const useStart =
      Math.abs(hour - Number(startInput.value)) <=
      Math.abs(hour - Number(endInput.value));
    const input = useStart ? startInput : endInput;
    input.value = String(hour);
    syncTimelineRange(useStart ? 'start' : 'end');
    input.focus();
    input.dispatchEvent(new Event('change'));
  });

  $('today-start').addEventListener('change', async () => {
    await context.setPref('timeStart', $('today-start').value);
  });
  $('today-end').addEventListener('change', async () => {
    await context.setPref('timeEnd', $('today-end').value);
  });

  $('today-find').addEventListener('click', async () => {
    showError('');

    const startValue = $('today-start').value;
    const endValue = $('today-end').value;
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

    const button = $('today-find');
    button.disabled = true;
    button.textContent = 'Finding…';

    try {
      const prefs = await context.getPrefs();
      const timeZone = prefs.operatingTz;
      const todayWindow = getTodayWindow(
        new Date(),
        timeZone,
        startValue,
        endValue,
        selectedDayOffset
      );
      if (todayWindow.end <= todayWindow.start) {
        const error = new Error('The selected time window is invalid after timezone conversion.');
        error.userMessage = 'The selected time window is invalid because of a timezone clock change.';
        throw error;
      }

      const queryWindow = { start: todayWindow.start, end: todayWindow.end };
      const { busy, checkedCount } = await fetchAllAccountsBusy([queryWindow], timeZone);
      if (checkedCount === 0) {
        showError('Please select at least one calendar in Settings.');
        return;
      }

      const free = computeFreeIntervals(todayWindow.start, todayWindow.end, busy);
      await context.renderOutput(free);
    } catch (error) {
      showError(error.userMessage || "Couldn't load calendar availability. Please try again.");
    } finally {
      button.disabled = false;
      button.textContent = 'Find This Day’s Availability';
    }
  });
}
