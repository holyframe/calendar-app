// Whitelist and normalize the small subset of Google event data used by the
// Today schedule. Locations, attendees, conferencing, and attachments are
// intentionally never copied into the returned object.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_COLOR = '#4285f4';

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizeScheduleEvent(event, calendar, accountEmail) {
  const allDay = Boolean(event?.start?.date);
  let start = null;
  let end = null;
  let startDate = null;
  let endDate = null;
  let sortStart;
  let occurrence;

  if (allDay) {
    startDate = text(event.start.date, 10);
    endDate = text(event?.end?.date, 10);
    if (
      !DATE_ONLY.test(startDate) ||
      !DATE_ONLY.test(endDate) ||
      endDate <= startDate
    ) {
      return null;
    }
    sortStart = Date.parse(startDate + 'T00:00:00.000Z');
    occurrence = startDate;
  } else {
    start = Date.parse(event?.start?.dateTime);
    end = Date.parse(event?.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    sortStart = start;
    occurrence = String(start);
  }

  const title = text(event?.summary, 500) || 'Busy';
  const description = text(event?.description, 10000);
  const calendarName =
    text(calendar?.summaryOverride, 200) ||
    text(calendar?.summary, 200) ||
    'Calendar';
  const calendarColor = /^#[0-9a-f]{6}$/i.test(calendar?.backgroundColor || '')
    ? calendar.backgroundColor
    : DEFAULT_COLOR;
  const uid = text(event?.iCalUID, 500);
  const sourceKey = [
    text(accountEmail, 320),
    text(calendar?.id, 500),
    text(event?.id, 500),
    occurrence,
  ].join('\u0000');

  return {
    title,
    description,
    allDay,
    start,
    end,
    startDate,
    endDate,
    calendarName,
    calendarColor,
    _dedupeKey: uid ? uid + '\u0000' + occurrence : sourceKey,
    _sortStart: sortStart,
  };
}

export function dedupeAndSortScheduleEvents(events) {
  const unique = new Map();
  for (const event of events) {
    if (event && !unique.has(event._dedupeKey)) {
      unique.set(event._dedupeKey, event);
    }
  }

  return [...unique.values()]
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a._sortStart - b._sortStart || a.title.localeCompare(b.title);
    })
    .map(({ _dedupeKey, _sortStart, ...event }) => event);
}

export function layoutScheduleEvents(
  events,
  hourHeight = 52,
  rangeStart = 0,
  rangeEnd = 1440
) {
  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart
  ) {
    return [];
  }

  const sorted = events
    .filter(
      (event) =>
        Number.isFinite(event.startMinute) &&
        Number.isFinite(event.endMinute) &&
        event.endMinute > event.startMinute
    )
    .map((event) => ({
      ...event,
      startMinute: Math.max(rangeStart, Math.min(rangeEnd, event.startMinute)),
      endMinute: Math.max(rangeStart, Math.min(rangeEnd, event.endMinute)),
    }))
    .filter((event) => event.endMinute > event.startMinute)
    .sort(
      (a, b) =>
        a.startMinute - b.startMinute ||
        b.endMinute - a.endMinute ||
        a.title.localeCompare(b.title)
    );

  const result = [];
  let group = [];
  let groupEnd = -Infinity;

  function placeGroup() {
    if (group.length === 0) return;
    const columnEnds = [];

    for (const event of group) {
      let column = columnEnds.findIndex((end) => end <= event.startMinute);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(event.endMinute);
      } else {
        columnEnds[column] = event.endMinute;
      }
      event.column = column;
    }

    const columns = columnEnds.length;
    for (const event of group) {
      result.push({
        ...event,
        columns,
        top: ((event.startMinute - rangeStart) / 60) * hourHeight,
        height: Math.max(
          ((event.endMinute - event.startMinute) / 60) * hourHeight,
          20
        ),
      });
    }
  }

  for (const event of sorted) {
    if (group.length > 0 && event.startMinute >= groupEnd) {
      placeGroup();
      group = [];
      groupEnd = -Infinity;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMinute);
  }
  placeGroup();

  return result;
}
