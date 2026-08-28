import test from 'node:test';
import assert from 'node:assert/strict';

import { groupWindowsForQueries } from '../utils/query_ranges.js';

const hour = 60 * 60 * 1000;
const day = 24 * hour;

test('groups consecutive daily working windows into one FreeBusy query', () => {
  assert.deepEqual(
    groupWindowsForQueries([
      { start: 9 * hour, end: 17 * hour },
      { start: day + 9 * hour, end: day + 17 * hour },
      { start: 2 * day + 9 * hour, end: 2 * day + 17 * hour },
    ]),
    [{ start: 9 * hour, end: 2 * day + 17 * hour }]
  );
});

test('keeps widely separated picked dates in separate queries', () => {
  assert.deepEqual(
    groupWindowsForQueries([
      { start: 9 * hour, end: 17 * hour },
      { start: 30 * day + 9 * hour, end: 30 * day + 17 * hour },
    ]),
    [
      { start: 9 * hour, end: 17 * hour },
      { start: 30 * day + 9 * hour, end: 30 * day + 17 * hour },
    ]
  );
});

test('sorts unsorted windows before grouping', () => {
  assert.deepEqual(
    groupWindowsForQueries([
      { start: day + 9 * hour, end: day + 17 * hour },
      { start: 9 * hour, end: 17 * hour },
    ]),
    [{ start: 9 * hour, end: day + 17 * hour }]
  );
});

