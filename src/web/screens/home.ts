import type { AgendaEvent, AgendaResponse, AgendaTask, HubConfig } from '../../shared/types';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// The agenda follows the household board's look: slate cards, rows tinted toward their
// source's colour (--own), tabular time pills, amber for anything overdue, and the aurora
// gradient reserved for marking today's next thing. It is sized to be read across a room:
// the next thing today is the largest line on the screen after the clock, the rest of today
// is a few rows, and the coming days are a single strip along the bottom.

let clockTimer: number | undefined;
let refreshTimer: number | undefined;
let redrawTimer: number | undefined;

const UPCOMING_DAYS = 3;
/** Rows on the Today card, the next thing included; the rest are counted. */
const TODAY_ROWS = 4;
const OVERDUE_ROWS = 2;
const DAY_ROWS = 2;
/** A timed event without an end is taken to last this long before it drops off Today. */
const DEFAULT_LENGTH_MS = 60 * 60_000;

function dayKey(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function renderClock(el: HTMLElement, tz: string) {
  const now = new Date();
  el.querySelector('.time-now')!.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now);
  el.querySelector('.date-now')!.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

const startKey = (e: AgendaEvent, tz: string) => (e.allDay ? e.start.slice(0, 10) : dayKey(new Date(e.start), tz));
const dayLabel = (k: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(`${k}T12:00:00Z`));

function row(title: string, pill: string, pillKind: 'time' | 'day', own?: string, location?: string) {
  const ev = h('div', 'ev');
  if (own) ev.style.setProperty('--own', own);
  const ring = h('span', 'tick');
  ring.setAttribute('aria-hidden', 'true');
  const body = h('div', 'body');
  const t = h('div', 't');
  t.append(h('span', pillKind === 'day' ? 'time day' : 'time', pill), document.createTextNode(title));
  body.append(t);
  // Only the next thing carries its place: it's the one someone is about to leave for.
  if (location) body.append(h('div', 'evloc', location));
  ev.append(ring, body);
  return ev;
}

const clockTime = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function eventRow(e: AgendaEvent, colors: Map<string, string | undefined>, tz: string, withLocation = false) {
  return row(e.title, e.allDay ? 'All day' : clockTime(e.start, tz), e.allDay ? 'day' : 'time', colors.get(e.source), withLocation ? e.location : undefined);
}

const finished = (e: AgendaEvent, now: number) =>
  !e.allDay && (e.end ? Date.parse(e.end) : Date.parse(e.start) + DEFAULT_LENGTH_MS) <= now;

const more = (n: number, what: string) => h('p', 'more', `+${n} more${what}`);

function taskRow(t: AgendaTask, colors: Map<string, string | undefined>, today: string) {
  const overdue = !!t.due && t.due < today;
  const pill = !t.due ? 'Anytime' : overdue ? dayLabel(t.due, { day: 'numeric', month: 'short' }) : 'Today';
  return row(t.title, pill, 'day', overdue ? undefined : colors.get(t.source));
}

function card(...children: Node[]) {
  const c = h('section', 'card');
  c.append(...children);
  return c;
}

function renderAgenda(list: HTMLElement, strip: HTMLElement, data: AgendaResponse, tz: string) {
  list.replaceChildren();
  strip.replaceChildren();
  // Nothing connected: the Home screen is just the clock (Settings is one tap away on the gear).
  list.closest('.screen')?.classList.toggle('clock-only', !data.configured);
  if (!data.configured) return;
  const colors = new Map(data.sources.map(s => [s.id, s.color]));
  const now = Date.now();
  const today = dayKey(new Date(now), tz);

  const byDay = new Map<string, AgendaEvent[]>();
  for (const e of [...data.events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))) {
    // All-day events that started earlier but are still running count as today.
    const k = startKey(e, tz) < today && e.allDay && (e.end ?? '') > today ? today : startKey(e, tz);
    if (k < today) continue;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  // Today: what's still to come. Timed events first (the next one leads), then all-day ones and tasks.
  const todayCard = card(h('h2', 'todayhead', 'Today'));
  todayCard.classList.add('today');
  const todays = byDay.get(today) ?? [];
  const timed = todays.filter(e => !e.allDay && !finished(e, now));
  const rows = [
    ...timed.map((e, i) => eventRow(e, colors, tz, i === 0)),
    ...todays.filter(e => e.allDay).map(e => eventRow(e, colors, tz)),
    ...data.tasks.filter(t => t.due === today || !t.due).map(t => taskRow(t, colors, today)),
  ];
  if (timed.length) rows[0].classList.add('next');
  todayCard.append(...rows.slice(0, TODAY_ROWS));
  if (rows.length > TODAY_ROWS) todayCard.append(more(rows.length - TODAY_ROWS, ' today'));
  if (!rows.length) todayCard.append(h('p', 'muted', todays.length ? 'Nothing else today.' : 'Nothing planned today.'));
  list.append(todayCard);

  // Overdue
  const overdue = data.tasks.filter(t => t.due && t.due < today).sort((a, b) => a.due!.localeCompare(b.due!));
  if (overdue.length) {
    const box = h('section', 'overdue');
    box.append(h('h2', 'overdueheading', `Overdue · ${overdue.length}`));
    overdue.slice(0, OVERDUE_ROWS).forEach(t => box.append(taskRow(t, colors, today)));
    list.append(box);
  }

  // Coming up: a strip along the bottom, a line or two a day.
  const upcoming = [...byDay].filter(([k]) => k > today).sort(([a], [b]) => a.localeCompare(b)).slice(0, UPCOMING_DAYS);
  for (const [k, events] of upcoming) {
    const day = h('section', 'day card');
    const title = h('h3', undefined, dayLabel(k, { weekday: 'long' }));
    title.append(h('small', undefined, dayLabel(k, { day: 'numeric', month: 'short' })));
    day.append(title);
    events.slice(0, DAY_ROWS).forEach(e => day.append(eventRow(e, colors, tz)));
    if (events.length > DAY_ROWS) day.append(more(events.length - DAY_ROWS, ''));
    strip.append(day);
  }
}

export const homeScreen: Screen = {
  id: 'home',
  title: 'Home',
  quiet: true,
  ownClock: true,
  mount(el: HTMLElement, config: HubConfig) {
    const clock = h('div', 'clock');
    clock.append(h('div', 'time-now'), h('div', 'date-now'));
    const list = h('div', 'agenda');
    const strip = h('div', 'days');
    el.append(clock, list, strip);

    renderClock(clock, config.timezone);
    clockTimer = window.setInterval(() => renderClock(clock, config.timezone), 1000);

    let latest: AgendaResponse | undefined;
    const draw = () => { if (latest) renderAgenda(list, strip, latest, config.timezone); };
    const load = () => getJson<AgendaResponse>('/api/agenda')
      .then(data => { latest = data; draw(); })
      // Can't reach the calendars: keep what's showing, or just the clock if nothing is yet.
      .catch(() => { if (!list.childElementCount) list.closest('.screen')?.classList.add('clock-only'); });
    load();
    refreshTimer = window.setInterval(load, 5 * 60 * 1000);
    // Finished events drop off and the next one moves up between fetches too.
    redrawTimer = window.setInterval(draw, 60_000);
  },
  unmount() {
    clearInterval(clockTimer);
    clearInterval(refreshTimer);
    clearInterval(redrawTimer);
  },
};
