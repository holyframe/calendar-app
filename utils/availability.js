// Gap-finding: subtract busy intervals from a time window.
// All intervals are { start, end } in epoch ms.

// Returns the free intervals within [windowStart, windowEnd), dropping any
// shorter than minMs (a floor: a gap exactly minMs long passes).
export function computeFreeIntervals(windowStart, windowEnd, busyIntervals, minMs = 0) {
  // 1. Clip events to the window
  const clipped = busyIntervals
    .filter((b) => b.end > windowStart && b.start < windowEnd)
    .map((b) => ({
      start: Math.max(b.start, windowStart),
      end: Math.min(b.end, windowEnd),
    }))
    // 2. Sort by start time
    .sort((a, b) => a.start - b.start);

  // 3. Merge overlapping/adjacent events into contiguous busy blocks
  const merged = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  }

  // 4. Subtract busy blocks from the window
  const free = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < windowEnd) free.push({ start: cursor, end: windowEnd });

  // 5. Apply the minimum-interval floor
  return free.filter((f) => f.end - f.start > 0 && f.end - f.start >= minMs);
}
