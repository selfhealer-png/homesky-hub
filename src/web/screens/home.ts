import type { AgendaEvent, AgendaResponse, AgendaTask, HubConfig } from '../../shared/types';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// The agenda follows the household board's look: slate cards, rows tinted toward their
// source's colour (--own), small tabular time pills, amber for anything overdue, and the
// aurora gradient reserved for marking "today".

let clockTimer: number | undefined;
let refreshTimer: number | undefined;

const UPCOMING_DAYS = 3;

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
  if (location) t.append(h('span', 'evloc', location));
  body.append(t);
  ev.append(ring, body);
  return ev;
}

function eventRow(e: AgendaEvent, colors: Map<string, string | undefined>, tz: string) {
  const time = e.allDay ? 'All day' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(e.start));
  return row(e.title, time, e.allDay ? 'day' : 'time', colors.get(e.source), e.location);
}

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

function renderAgenda(list: HTMLElement, data: AgendaResponse, tz: string) {
  list.replaceChildren();
  // Nothing connected: the Home screen is just the clock (Settings is one tap away on the gear).
  list.closest('.screen')?.classList.toggle('clock-only', !data.configured);
  if (!data.configured) return;
  const colors = new Map(data.sources.map(s => [s.id, s.color]));
  const today = dayKey(new Date(), tz);

  const byDay = new Map<string, AgendaEvent[]>();
  for (const e of [...data.events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))) {
    // All-day events that started earlier but are still running count as today.
    const k = startKey(e, tz) < today && e.allDay && (e.end ?? '') > today ? today : startKey(e, tz);
    if (k < today) continue;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  // Today
  const head = h('div', 'todayhead');
  head.append(h('b', undefined, 'Today'), h('span', 'todaytag', dayLabel(today, { weekday: 'short', day: 'numeric', month: 'short' })));
  const todayCard = card(head);
  const todays = byDay.get(today) ?? [];
  const dueTasks = data.tasks.filter(t => t.due === today || !t.due).slice(0, 4);
  todays.forEach(e => todayCard.append(eventRow(e, colors, tz)));
  dueTasks.forEach(t => todayCard.append(taskRow(t, colors, today)));
  if (!todays.length && !dueTasks.length) todayCard.append(h('p', 'muted', 'Nothing planned today.'));
  list.append(todayCard);

  // Overdue
  const overdue = data.tasks.filter(t => t.due && t.due < today).sort((a, b) => a.due!.localeCompare(b.due!));
  if (overdue.length) {
    const box = h('section', 'overdue');
    box.append(h('h2', 'overdueheading', `⚠ Overdue · ${overdue.length}`));
    overdue.slice(0, 3).forEach(t => box.append(taskRow(t, colors, today)));
    list.append(box);
  }

  // Coming up
  const upcoming = [...byDay].filter(([k]) => k > today).sort(([a], [b]) => a.localeCompare(b)).slice(0, UPCOMING_DAYS);
  if (upcoming.length) {
    const days = h('div', 'days');
    for (const [k, events] of upcoming) {
      const day = h('section', 'day card');
      const title = h('h3', undefined, dayLabel(k, { weekday: 'long' }));
      title.append(h('small', undefined, dayLabel(k, { day: 'numeric', month: 'short' })));
      day.append(title);
      events.slice(0, 4).forEach(e => day.append(eventRow(e, colors, tz)));
      if (events.length > 4) day.append(h('p', 'more', `+${events.length - 4} more`));
      days.append(day);
    }
    list.append(days);
  }
}

export const homeScreen: Screen = {
  id: 'home',
  title: 'Home',
  durationSec: 60,
  mount(el: HTMLElement, config: HubConfig) {
    const clock = h('div', 'clock');
    clock.append(h('div', 'time-now'), h('div', 'date-now'));
    const list = h('div', 'agenda');
    el.append(clock, list);

    renderClock(clock, config.timezone);
    clockTimer = window.setInterval(() => renderClock(clock, config.timezone), 1000);

    const load = () => getJson<AgendaResponse>('/api/agenda')
      .then(data => renderAgenda(list, data, config.timezone))
      // Can't reach the calendars: keep what's showing, or just the clock if nothing is yet.
      .catch(() => { if (!list.childElementCount) list.closest('.screen')?.classList.add('clock-only'); });
    load();
    refreshTimer = window.setInterval(load, 5 * 60 * 1000);
  },
  unmount() {
    clearInterval(clockTimer);
    clearInterval(refreshTimer);
  },
};
