import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeAndSortScheduleEvents,
  layoutScheduleEvents,
  normalizeScheduleEvent,
} from '../utils/schedule.js';

const calendar = {
  id: 'primary@example.com',
  summary: 'Work',
  backgroundColor: '#1a73e8',
};

test('whitelists the event description but excludes other meeting details', () => {
  const normalized = normalizeScheduleEvent(
    {
      id: 'event-1',
      iCalUID: 'uid-1',
      summary: 'Planning',
      description: '<p>Review the launch plan.</p>',
      location: 'must not leave the background',
      attendees: [{ email: 'hidden@example.com' }],
      conferenceData: { entryPoints: [] },
      attachments: [{ title: 'hidden' }],
      start: { dateTime: '2026-08-28T09:00:00-04:00' },
      end: { dateTime: '2026-08-28T10:00:00-04:00' },
    },
    calendar,
    'me@example.com'
  );

  assert.deepEqual(dedupeAndSortScheduleEvents([normalized]), [
    {
      title: 'Planning',
      description: '<p>Review the launch plan.</p>',
      allDay: false,
      start: Date.parse('2026-08-28T09:00:00-04:00'),
      end: Date.parse('2026-08-28T10:00:00-04:00'),
      startDate: null,
      endDate: null,
      calendarName: 'Work',
      calendarColor: '#1a73e8',
    },
  ]);
});

test('sorts all-day events first and deduplicates shared event copies', () => {
  const allDay = normalizeScheduleEvent(
    {
      id: 'all-day',
      summary: 'Company holiday',
      start: { date: '2026-08-28' },
      end: { date: '2026-08-29' },
    },
    calendar,
    'me@example.com'
  );
  const firstCopy = normalizeScheduleEvent(
    {
      id: 'copy-1',
      iCalUID: 'shared-uid',
      summary: 'Shared meeting',
      start: { dateTime: '2026-08-28T14:00:00Z' },
      end: { dateTime: '2026-08-28T15:00:00Z' },
    },
    calendar,
    'first@example.com'
  );
  const secondCopy = normalizeScheduleEvent(
    {
      id: 'copy-2',
      iCalUID: 'shared-uid',
      summary: 'Shared meeting',
      start: { dateTime: '2026-08-28T14:00:00Z' },
      end: { dateTime: '2026-08-28T15:00:00Z' },
    },
    calendar,
    'second@example.com'
  );

  const result = dedupeAndSortScheduleEvents([firstCopy, secondCopy, allDay]);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Company holiday');
  assert.equal(result[1].title, 'Shared meeting');
});

test('uses Busy without a description when Google withholds private details', () => {
  const normalized = normalizeScheduleEvent(
    {
      id: 'private',
      start: { dateTime: '2026-08-28T11:00:00Z' },
      end: { dateTime: '2026-08-28T12:00:00Z' },
    },
    calendar,
    'me@example.com'
  );

  const [event] = dedupeAndSortScheduleEvents([normalized]);
  assert.equal(event.title, 'Busy');
  assert.equal(event.description, '');
});

test('lays overlapping timed events into separate timeline columns', () => {
  const result = layoutScheduleEvents([
    { title: 'Long', startMinute: 60, endMinute: 180 },
    { title: 'Overlap', startMinute: 90, endMinute: 120 },
    { title: 'Later', startMinute: 180, endMinute: 240 },
  ]);

  assert.deepEqual(
    result.map(({ title, column, columns, top, height }) => ({
      title,
      column,
      columns,
      top,
      height,
    })),
    [
      { title: 'Long', column: 0, columns: 2, top: 52, height: 104 },
      { title: 'Overlap', column: 1, columns: 2, top: 78, height: 26 },
      { title: 'Later', column: 0, columns: 1, top: 156, height: 52 },
    ]
  );
});

test('clips timeline events to the visible day', () => {
  const [event] = layoutScheduleEvents([
    { title: 'Spanning', startMinute: -30, endMinute: 1470 },
  ]);

  assert.equal(event.top, 0);
  assert.equal(event.height, 24 * 52);
});

test('filters and positions events within an adjustable timeline range', () => {
  const result = layoutScheduleEvents(
    [
      { title: 'Before', startMinute: 480, endMinute: 510 },
      { title: 'Clipped', startMinute: 510, endMinute: 600 },
      { title: 'Visible', startMinute: 660, endMinute: 720 },
    ],
    52,
    540,
    1020
  );

  assert.deepEqual(
    result.map(({ title, top, height }) => ({ title, top, height })),
    [
      { title: 'Clipped', top: 0, height: 52 },
      { title: 'Visible', top: 104, height: 52 },
    ]
  );
});
