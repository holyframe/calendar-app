// Groups nearby daily windows into efficient FreeBusy query ranges.
// A long gap starts a new query, preventing two scattered dates from causing
// a request for every busy interval between them.

export const DEFAULT_MAX_GAP_MS = 36 * 60 * 60 * 1000;
export const DEFAULT_MAX_SPAN_MS = 93 * 24 * 60 * 60 * 1000;

export function groupWindowsForQueries(
  windows,
  {
    maxGapMs = DEFAULT_MAX_GAP_MS,
    maxSpanMs = DEFAULT_MAX_SPAN_MS,
  } = {}
) {
  const sorted = windows
    .map((window) => ({ start: Number(window.start), end: Number(window.end) }))
    .sort((a, b) => a.start - b.start);

  const ranges = [];
  for (const window of sorted) {
    const current = ranges[ranges.length - 1];
    const closeEnough = current && window.start - current.end <= maxGapMs;
    const withinSpan = current && Math.max(current.end, window.end) - current.start <= maxSpanMs;

    if (closeEnough && withinSpan) {
      current.end = Math.max(current.end, window.end);
    } else {
      ranges.push({ ...window });
    }
  }
  return ranges;
}

