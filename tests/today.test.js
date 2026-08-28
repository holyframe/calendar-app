import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatScheduleTime,
  formatTodayDate,
  getEventMinutesForDay,
  getTodayDayWindow,
  getTodayWindow,
  normalizeHourRange,
} from '../popup/today.js';

test('normalizes the timeline bar to whole-hour bounds', () => {
  assert.deepEqual(normalizeHourRange('08:30', '19:15'), {
    startHour: 8,
    endHour: 20,
  });
  assert.deepEqual(normalizeHourRange('23:30', '23:45'), {
    startHour: 23,
    endHour: 24,
  });
  assert.deepEqual(normalizeHourRange('invalid', ''), {
    startHour: 8,
    endHour: 20,
  });
});

test('builds today in the operating timezone near a UTC date boundary', () => {
  const now = new Date('2026-08-29T02:00:00.000Z');
  const todayWindow = getTodayWindow(now, 'America/New_York', '09:00', '17:00');

  assert.equal(formatTodayDate(todayWindow.date), 'Friday, August 28, 2026');
  assert.equal(todayWindow.startMinute, 9 * 60);
  assert.equal(todayWindow.endMinute, 17 * 60);
  assert.equal(new Date(todayWindow.start).toISOString(), '2026-08-28T13:00:00.000Z');
  assert.equal(new Date(todayWindow.end).toISOString(), '2026-08-28T21:00:00.000Z');
});

test('uses the next local date when the operating timezone is ahead of UTC', () => {
  const now = new Date('2026-08-29T02:00:00.000Z');
  const todayWindow = getTodayWindow(now, 'Asia/Tokyo', '09:00', '17:00');

  assert.equal(formatTodayDate(todayWindow.date), 'Saturday, August 29, 2026');
  assert.equal(new Date(todayWindow.start).toISOString(), '2026-08-29T00:00:00.000Z');
  assert.equal(new Date(todayWindow.end).toISOString(), '2026-08-29T08:00:00.000Z');
});

test('moves the displayed day across month boundaries in the operating timezone', () => {
  const now = new Date('2026-08-29T02:00:00.000Z');
  const dayWindow = getTodayWindow(
    now,
    'America/New_York',
    '08:00',
    '20:00',
    4
  );

  assert.equal(formatTodayDate(dayWindow.date), 'Tuesday, September 1, 2026');
  assert.equal(new Date(dayWindow.start).toISOString(), '2026-09-01T12:00:00.000Z');
  assert.equal(new Date(dayWindow.end).toISOString(), '2026-09-02T00:00:00.000Z');
});

test('builds a full local day across a daylight-saving transition', () => {
  const dayWindow = getTodayDayWindow(
    new Date('2026-03-08T12:00:00.000Z'),
    'America/New_York'
  );

  assert.equal(new Date(dayWindow.start).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(dayWindow.end).toISOString(), '2026-03-09T04:00:00.000Z');
});

test('positions events by local wall-clock time on a DST day', () => {
  const timeZone = 'America/New_York';
  const dayWindow = getTodayDayWindow(
    new Date('2026-03-08T12:00:00.000Z'),
    timeZone
  );

  assert.deepEqual(
    getEventMinutesForDay(
      {
        start: Date.parse('2026-03-08T07:00:00.000Z'),
        end: Date.parse('2026-03-08T08:00:00.000Z'),
      },
      dayWindow,
      timeZone
    ),
    { startMinute: 180, endMinute: 240 }
  );
});

test('clips spanning events to the visible day timeline', () => {
  const timeZone = 'America/New_York';
  const dayWindow = getTodayDayWindow(
    new Date('2026-08-28T12:00:00.000Z'),
    timeZone
  );

  assert.deepEqual(
    getEventMinutesForDay(
      {
        start: dayWindow.start - 60 * 60 * 1000,
        end: dayWindow.end + 60 * 60 * 1000,
      },
      dayWindow,
      timeZone
    ),
    { startMinute: 0, endMinute: 1440 }
  );
});

test('formats schedule times in the operating timezone', () => {
  assert.equal(
    formatScheduleTime(
      {
        allDay: false,
        start: Date.parse('2026-08-28T13:00:00.000Z'),
        end: Date.parse('2026-08-28T14:30:00.000Z'),
      },
      'America/New_York'
    ),
    '9:00 AM–10:30 AM'
  );
  assert.equal(formatScheduleTime({ allDay: true }, 'America/New_York'), 'All day');
});
