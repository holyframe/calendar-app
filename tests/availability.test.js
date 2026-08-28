import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFreeIntervals } from '../utils/availability.js';

test('clips, merges, and subtracts overlapping busy intervals', () => {
  assert.deepEqual(
    computeFreeIntervals(0, 100, [
      { start: -10, end: 5 },
      { start: 20, end: 30 },
      { start: 25, end: 50 },
      { start: 90, end: 110 },
    ]),
    [
      { start: 5, end: 20 },
      { start: 50, end: 90 },
    ]
  );
});

test('keeps a gap exactly equal to the minimum duration', () => {
  assert.deepEqual(
    computeFreeIntervals(0, 60, [{ start: 30, end: 60 }], 30),
    [{ start: 0, end: 30 }]
  );
});

test('does not mutate caller intervals', () => {
  const busy = [{ start: 20, end: 40 }, { start: 30, end: 50 }];
  computeFreeIntervals(0, 100, busy);
  assert.deepEqual(busy, [{ start: 20, end: 40 }, { start: 30, end: 50 }]);
});

