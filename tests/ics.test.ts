import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIcs } from '../src/worker/providers/ics';

const NOW = Date.parse('2026-10-23T10:00:00Z'); // window: 22 Oct → 13 Nov

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VTIMEZONE', 'TZID:Europe/London',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
  // Weekly on Fridays at 18:00 London time, since 2020.
  'BEGIN:VEVENT', 'UID:swim', 'SUMMARY:Swimming', 'DTSTART;TZID=Europe/London:20200103T180000', 'DTEND;TZID=Europe/London:20200103T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=FR', 'EXDATE;TZID=Europe/London:20261106T180000', 'END:VEVENT',
  // The 30 Oct occurrence moved to 17:00.
  'BEGIN:VEVENT', 'UID:swim', 'RECURRENCE-ID;TZID=Europe/London:20261030T180000', 'SUMMARY:Swimming (early)',
  'DTSTART;TZID=Europe/London:20261030T170000', 'DTEND;TZID=Europe/London:20261030T180000', 'END:VEVENT',
  // A series that ended years ago: dropped by the prefilter.
  'BEGIN:VEVENT', 'UID:old-series', 'SUMMARY:Old club', 'DTSTART:20150101T090000Z', 'DTEND:20150101T100000Z', 'RRULE:FREQ=DAILY;UNTIL=20151231T000000Z', 'END:VEVENT',
  // A one-off in the past.
  'BEGIN:VEVENT', 'UID:past', 'SUMMARY:Past thing', 'DTSTART:20250101T090000Z', 'DTEND:20250101T100000Z', 'END:VEVENT',
  // An all-day multi-day event, with a folded long line.
  'BEGIN:VEVENT', 'UID:half-term', 'SUMMARY:Half', '  term', 'DTSTART;VALUE=DATE:20261026', 'DTEND;VALUE=DATE:20261031', 'END:VEVENT',
  // Cancelled.
  'BEGIN:VEVENT', 'UID:cancelled', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'DTSTART:20261024T090000Z', 'DTEND:20261024T100000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('expands recurring events inside the window, with exceptions applied', () => {
  const events = parseIcs(ICS, 'cal', NOW);
  const swims = events.filter(e => e.title.startsWith('Swimming'));
  assert.deepEqual(swims.map(e => [e.title, e.start]), [
    ['Swimming', '2026-10-23T17:00:00.000Z'], // 18:00 BST
    ['Swimming (early)', '2026-10-30T17:00:00.000Z'], // moved to 17:00 GMT (clocks went back on 25 Oct)
    // 6 Nov is an EXDATE; 13 Nov 18:00 is after the window ends at 10:00 that day.
  ]);
});

test('handles all-day, cancelled and old events', () => {
  const events = parseIcs(ICS, 'cal', NOW);
  const titles = events.map(e => e.title);
  assert.ok(titles.includes('Half term'), 'folded all-day event is kept');
  const half = events.find(e => e.title === 'Half term')!;
  assert.equal(half.allDay, true);
  assert.equal(half.start, '2026-10-26');
  assert.equal(half.end, '2026-10-31');
  assert.ok(!titles.includes('Cancelled thing'));
  assert.ok(!titles.includes('Old club'));
  assert.ok(!titles.includes('Past thing'));
});
