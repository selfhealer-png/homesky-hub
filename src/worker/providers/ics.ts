import ICAL from 'ical.js';
import type { AgendaEvent } from '../../shared/types';
import type { IcsConnection } from '../../shared/settings';
import { agendaWindow, fetchUserUrl, ProviderError, type ProviderResult } from './common';

// Read-only calendars from iCal (ICS) links: Google's "secret address in iCal format",
// iCloud public calendars, Outlook published calendars, and so on.
//
// Calendars can hold years of history, and the Workers free plan allows ~10 ms of CPU per
// request, so the text is pre-filtered with plain string checks before ical.js parses it:
// one-off events that ended before the window are dropped, and so are recurring series whose
// UNTIL is in the past. Only what's left is parsed and expanded.

const MAX_OCCURRENCES_PER_SERIES = 5000;

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

function prefilter(text: string, windowStart: Date): string {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const first = unfolded.indexOf('BEGIN:VEVENT');
  if (first < 0) return unfolded;
  const header = unfolded.slice(0, first);
  const startKey = ymd(windowStart);

  const kept: string[] = [];
  const re = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  for (const [block] of unfolded.matchAll(re)) {
    const date = (prop: string) => block.match(new RegExp(`^${prop}[^:\\r\\n]*:(\\d{8})`, 'm'))?.[1];
    const rrule = block.match(/^RRULE:(.*)$/m)?.[1];
    if (rrule) {
      const until = rrule.match(/UNTIL=(\d{8})/)?.[1];
      if (!until || until >= startKey) kept.push(block);
      continue;
    }
    const last = date('DTEND') ?? date('RECURRENCE-ID') ?? date('DTSTART');
    if (!last || last >= startKey) kept.push(block);
  }
  return `${header}${kept.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

const toAgendaTime = (t: ICAL.Time) => (t.isDate ? t.toString().slice(0, 10) : t.toJSDate().toISOString());

export function parseIcs(text: string, sourceId: string, now = Date.now()): AgendaEvent[] {
  const window = agendaWindow(now);
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(prefilter(text, window.start)));
  } catch {
    throw new ProviderError('That link did not return a calendar (iCal) file.');
  }
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const startT = ICAL.Time.fromJSDate(window.start, true);
  const endT = ICAL.Time.fromJSDate(window.end, true);

  // Pair each moved/edited occurrence with its series.
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else masters.set(`${ex.uid}:${ex.recurrenceId}`, ex);
  }

  const out: AgendaEvent[] = [];
  const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    if (end.compare(startT) <= 0 || start.compare(endT) >= 0) return;
    out.push({
      id: `${sourceId}:${item.uid}:${toAgendaTime(start)}`,
      source: sourceId,
      title: item.summary || '(No title)',
      start: toAgendaTime(start),
      end: toAgendaTime(end),
      allDay: start.isDate,
      location: item.location || undefined,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate ?? ev.startDate);
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, t = it.next(); t && n < MAX_OCCURRENCES_PER_SERIES; t = it.next(), n++) {
      if (t.compare(endT) >= 0) break;
      const d = ev.getOccurrenceDetails(t);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export async function readIcs(conn: IcsConnection, url: string): Promise<ProviderResult> {
  const res = await fetchUserUrl(url, { headers: { accept: 'text/calendar, */*' } });
  const events = parseIcs(await res.text(), conn.id);
  return { sources: [{ id: conn.id, name: conn.name, color: conn.color }], events, tasks: [] };
}
