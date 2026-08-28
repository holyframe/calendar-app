// Output formatting with customizable per-line templates.
//
// A format is { template, timeStyle }. The template is applied once per
// date line, with these tokens:
//   {Dow} Thursday   {Dow3} Thu     {Month} July   {Mon3} Jul
//   {M} 7   {MM} 07   {D} 9   {DD} 09   {Do} 9th
//   {YYYY} 2026   {YY} 26
//   {times} the free time ranges, comma-separated
//   {tz} timezone abbreviation at that date (EDT, GMT+9, ...)
//
// Time styles control how each range is written:
//   compact  4–5pm, 4:30–6pm, 11am–1pm   (drop :00, collapse meridiem)
//   full     1:00-3:00pm, 11:00am-1:00pm (always minutes)
//   caps     1:00 PM – 3:00 PM           (always minutes + meridiem)
//   spacedDots 1 pm - 3 pm, 4.30 pm - 6 pm (dot minutes + repeated meridiem)

import { getZonedParts, zonedTimeToUtc } from './timezone.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const FORMAT_PRESETS = {
  default: {
    label: 'Availical default',
    example: '(7/9) Thursday, 1–3pm',
    template: '({M}/{D}) {Dow}, {times}',
    timeStyle: 'compact',
  },
  verbose: {
    label: 'Verbose',
    example: 'Thursday 7/9 from 1:00-3:00pm EDT',
    template: '{Dow} {M}/{D} from {times} {tz}',
    timeStyle: 'full',
  },
  short: {
    label: 'Short',
    example: 'Thu 7/9: 1–3pm',
    template: '{Dow3} {M}/{D}: {times}',
    timeStyle: 'compact',
  },
  iso: {
    label: 'ISO date',
    example: '2026-07-09 (Thu): 1:00 PM – 3:00 PM',
    template: '{YYYY}-{MM}-{DD} ({Dow3}): {times}',
    timeStyle: 'caps',
  },
};

export const TIME_STYLE_LABELS = {
  compact: 'Compact (1–3pm)',
  full: 'Full (1:00-3:00pm)',
  caps: 'Uppercase (1:00 PM – 3:00 PM)',
  spacedDots: 'Spaced lowercase (1 pm - 3 pm)',
};

// Resolves stored prefs into a concrete { template, timeStyle }.
export function resolveFormat(prefs) {
  if (prefs.outputPreset === 'custom') {
    return {
      template: prefs.outputTemplate || FORMAT_PRESETS.default.template,
      timeStyle: TIME_STYLES[prefs.outputTimeStyle] ? prefs.outputTimeStyle : 'compact',
    };
  }
  return FORMAT_PRESETS[prefs.outputPreset] || FORMAT_PRESETS.default;
}

const pad = (n) => String(n).padStart(2, '0');
const ordinal = (n) => {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return String(n) + 'th';

  return String(n) + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
};
const meridiem = (p) => (p.hour < 12 ? 'am' : 'pm');
const hour12 = (p) => p.hour % 12 || 12;
const timeCompact = (p) => (p.minute ? `${hour12(p)}:${pad(p.minute)}` : `${hour12(p)}`);
const timeFull = (p) => `${hour12(p)}:${pad(p.minute)}`;
const timeDots = (p) => (p.minute ? `${hour12(p)}.${pad(p.minute)}` : `${hour12(p)}`);

const TIME_STYLES = {
  compact(s, e) {
    const a = timeCompact(s);
    const b = timeCompact(e);
    return meridiem(s) === meridiem(e)
      ? `${a}–${b}${meridiem(e)}`
      : `${a}${meridiem(s)}–${b}${meridiem(e)}`;
  },
  full(s, e) {
    const a = timeFull(s);
    const b = timeFull(e);
    return meridiem(s) === meridiem(e)
      ? `${a}-${b}${meridiem(e)}`
      : `${a}${meridiem(s)}-${b}${meridiem(e)}`;
  },
  caps(s, e) {
    return `${timeFull(s)} ${meridiem(s).toUpperCase()} – ${timeFull(e)} ${meridiem(e).toUpperCase()}`;
  },
  spacedDots(s, e) {
    return `${timeDots(s)} ${meridiem(s)} - ${timeDots(e)} ${meridiem(e)}`;
  },
};

// Timezone abbreviation (EDT, CST, GMT+9...) at a specific instant, so
// DST is reflected correctly per date.
function tzAbbrev(tz, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
}

function buildLine(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(ctx, key) ? String(ctx[key]) : match
  );
}

// Formats free intervals ({ start, end } epoch ms) as text in the given
// timezone. Intervals crossing midnight in that timezone are split across
// the correct dates. Days with no free time simply produce no line.
export function formatAvailability(intervals, tz, format = FORMAT_PRESETS.default) {
  const timeStyle = TIME_STYLES[format.timeStyle] || TIME_STYLES.compact;

  // Split each interval at local midnight boundaries
  const pieces = [];
  for (const iv of intervals) {
    let s = iv.start;
    while (s < iv.end) {
      const p = getZonedParts(new Date(s), tz);
      const nextMidnight = zonedTimeToUtc(p.year, p.month, p.day + 1, 0, 0, tz).getTime();
      const e = Math.min(iv.end, nextMidnight);
      if (e > s) pieces.push({ start: s, end: e, parts: p });
      s = e;
    }
  }

  pieces.sort((a, b) => a.start - b.start);

  // Group by date, one line per date, chronological
  const lines = new Map();
  for (const pc of pieces) {
    const sp = pc.parts;
    const ep = getZonedParts(new Date(pc.end), tz);
    const key = `${sp.year}-${sp.month}-${sp.day}`;
    if (!lines.has(key)) lines.set(key, { sp, start: pc.start, ranges: [] });
    lines.get(key).ranges.push(timeStyle(sp, ep));
  }

  return [...lines.values()]
    .map(({ sp, start, ranges }) =>
      buildLine(format.template, {
        Dow: sp.weekday,
        Dow3: sp.weekday.slice(0, 3),
        Month: MONTHS[sp.month - 1],
        Mon3: MONTHS[sp.month - 1].slice(0, 3),
        M: sp.month,
        MM: pad(sp.month),
        D: sp.day,
        DD: pad(sp.day),
        Do: ordinal(sp.day),
        YYYY: sp.year,
        YY: String(sp.year).slice(-2),
        times: ranges.join(', '),
        tz: tzAbbrev(tz, new Date(start)),
      })
    )
    .join('\n');
}
