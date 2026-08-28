import test from 'node:test';
import assert from 'node:assert/strict';

import { getTrailingMonthDates } from '../popup/pick_dates.js';

test('fills the final August 2026 week with September dates', () => {
  assert.deepEqual(
    getTrailingMonthDates(2026, 7),
    [1, 2, 3, 4, 5].map((day) => ({
      year: 2026,
      monthIndex: 8,
      day,
    }))
  );
});

test('does not add dates when a month ends on Saturday', () => {
  assert.deepEqual(getTrailingMonthDates(2026, 0), []);
});

test('rolls trailing December dates into the next year', () => {
  assert.deepEqual(getTrailingMonthDates(2026, 11), [
    { year: 2027, monthIndex: 0, day: 1 },
    { year: 2027, monthIndex: 0, day: 2 },
  ]);
});
