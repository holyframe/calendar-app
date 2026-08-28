import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getZonedParts,
  zonedTimeToUtc,
} from '../utils/timezone.js';
import {
  formatAvailability,
  FORMAT_PRESETS,
} from '../utils/formatter.js';

test('round-trips an ordinary wall-clock time', () => {
  const instant = zonedTimeToUtc(2026, 7, 9, 9, 0, 'America/New_York');
  assert.equal(instant.toISOString(), '2026-07-09T13:00:00.000Z');
  assert.deepEqual(
    getZonedParts(instant, 'America/New_York'),
    {
      year: 2026,
      month: 7,
      day: 9,
      hour: 9,
      minute: 0,
      weekday: 'Thursday',
    }
  );
});

test('rejects a nonexistent spring-forward time', () => {
  assert.throws(
    () => zonedTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York'),
    (error) => error.code === 'INVALID_LOCAL_TIME'
  );
});

test('uses the earlier occurrence of an ambiguous fall-back time', () => {
  const instant = zonedTimeToUtc(2026, 11, 1, 1, 30, 'America/New_York');
  assert.equal(instant.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(getZonedParts(instant, 'America/New_York').hour, 1);
});

test('formats availability in the requested timezone', () => {
  const start = zonedTimeToUtc(2026, 7, 9, 9, 0, 'America/New_York').getTime();
  assert.equal(
    formatAvailability(
      [{ start, end: start + 2 * 60 * 60 * 1000 }],
      'America/New_York',
      FORMAT_PRESETS.default
    ),
    '(7/9) Thursday, 9–11am'
  );
});

test('formats spaced lowercase times with dot-separated minutes', () => {
  const firstStart = zonedTimeToUtc(2026, 7, 9, 13, 0, 'America/New_York').getTime();
  const secondStart = zonedTimeToUtc(2026, 7, 9, 16, 30, 'America/New_York').getTime();

  assert.equal(
    formatAvailability(
      [
        { start: firstStart, end: firstStart + 2 * 60 * 60 * 1000 },
        { start: secondStart, end: secondStart + 90 * 60 * 1000 },
      ],
      'America/New_York',
      { template: '{times}', timeStyle: 'spacedDots' }
    ),
    '1 pm - 3 pm, 4.30 pm - 6 pm'
  );
});
