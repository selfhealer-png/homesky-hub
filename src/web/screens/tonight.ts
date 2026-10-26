import type { HubConfig, IssPass, TonightResponse } from '../../shared/types';
import { getJson } from '../api';
import { skyHome, skyQuery } from '../location';
import { h, type Screen } from '../screen';

// Tonight's sky: is it worth looking up? A one-line verdict first (cloud and moon decide
// most of it), then the moon, the night's times, the aurora, and the space station.

const REFRESH_MS = 15 * 60_000;
let timer: number | undefined;

const SVG = 'http://www.w3.org/2000/svg';

/** The moon as it looks: lit on the right while waxing (in the north), on the left while waning. */
function moonDisc(phase: number, fraction: number, south: boolean): SVGSVGElement {
  const r = 50;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-56 -56 112 112');
  svg.setAttribute('class', 'tn-moon');
  svg.setAttribute('aria-hidden', 'true');
  const disc = document.createElementNS(SVG, 'circle');
  disc.setAttribute('r', String(r));
  disc.setAttribute('class', 'tn-moon-dark');
  const lit = document.createElementNS(SVG, 'path');
  const rx = r * Math.abs(2 * fraction - 1);
  // Outer edge down the lit side, then the terminator back up: bulging into the lit side for
  // a crescent, into the dark side once it's more than half lit.
  lit.setAttribute('d', `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx} ${r} 0 0 ${fraction > 0.5 ? 1 : 0} 0 ${-r}Z`);
  lit.setAttribute('class', 'tn-moon-lit');
  const waning = phase > 0.5;
  if (waning !== south) lit.setAttribute('transform', 'scale(-1 1)');
  svg.append(disc, lit);
  return svg;
}

function verdict(d: TonightResponse): string {
  const cloud = d.cloud;
  const bright = d.moon.fraction > 0.6;
  if (d.night.allDay) return 'No night tonight: the sun doesn’t set';
  if (cloud !== undefined && cloud >= 75) return 'Cloudy tonight';
  if (cloud !== undefined && cloud >= 45) return 'Some clear spells tonight';
  if (!d.night.dark) return bright ? 'Clear, but light all night and a bright moon' : 'Clear, but it never gets fully dark';
  if (bright) return 'Clear, with a bright moon';
  return 'Clear and dark: a good night for stars';
}

function cloudLabel(c: number) {
  return c < 20 ? 'Clear' : c < 45 ? 'Mostly clear' : c < 75 ? 'Partly cloudy' : c < 92 ? 'Mostly cloudy' : 'Overcast';
}

const AURORA: Record<string, [string, string]> = {
  unlikely: ['Unlikely', 'quiet'],
  possible: ['Possible, low in the north', 'maybe'],
  good: ['Good chance', 'good'],
};

function render(el: HTMLElement, d: TonightResponse, home: { name: string; lat: number }, config: HubConfig) {
  const tz = config.timezone || undefined;
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)) : '');
  const dayKey = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t);
  const hourOf = (t: Date) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(t));
  /** "Tonight" runs from 5pm to 6am; otherwise today, tomorrow, or the weekday. */
  const dayName = (iso: string) => {
    const t = new Date(iso), now = new Date();
    const sameDay = dayKey(t) === dayKey(now);
    const nextDay = dayKey(t) === dayKey(new Date(now.getTime() + 86_400_000));
    if ((sameDay && hourOf(t) >= 17) || (sameDay && hourOf(t) < 6) || (nextDay && hourOf(t) < 6 && hourOf(now) >= 17)) return 'Tonight';
    if (sameDay) return 'Today';
    if (nextDay) return 'Tomorrow';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz }).format(t);
  };

  // Left: the verdict, the moon, the night's times.
  const left = h('section', 'tn-main');
  left.append(h('p', 'tn-kicker', `Tonight · ${home.name}`), h('h1', 'tn-verdict', verdict(d)));

  const moon = h('div', 'tn-moon-row');
  const words = h('div');
  words.append(h('p', 'tn-moon-name', d.moon.name), h('p', 'tn-moon-lit-pct', `${Math.round(d.moon.fraction * 100)}% lit`));
  const rs = [d.moon.rise && `Rises ${time(d.moon.rise)}`, d.moon.set && `sets ${time(d.moon.set)}`].filter(Boolean).join(' · ');
  if (rs) words.append(h('p', 'tn-moon-times', rs.charAt(0).toUpperCase() + rs.slice(1)));
  moon.append(moonDisc(d.moon.phase, d.moon.fraction, home.lat < 0), words);
  left.append(moon);

  const times = h('dl', 'tn-times');
  const n = d.night;
  const add = (label: string, iso?: string) => {
    if (!iso) return;
    const box = h('div');
    box.append(h('dt', undefined, label), h('dd', undefined, time(iso)));
    times.append(box);
  };
  add('Sunset', n.sunset);
  add('Dark', n.dark);
  add('Dawn', n.darkEnds);
  add('Sunrise', n.sunrise);
  if (n.sunset && !n.dark) times.append(Object.assign(h('div', 'tn-note'), { textContent: 'Never fully dark: summer twilight all night' }));
  left.append(times);

  // Right: cloud, aurora, and the space station.
  const right = h('section', 'tn-side');
  if (d.cloud !== undefined) {
    const card = h('div', 'tn-card');
    card.append(h('h2', undefined, 'Cloud'), h('p', 'tn-big', cloudLabel(d.cloud)), h('p', 'tn-sub', `${d.cloud}% cover this evening`));
    right.append(card);
  }
  if (d.aurora) {
    const [label, tone] = AURORA[d.aurora.chance];
    const card = h('div', `tn-card tn-aurora tone-${tone}`);
    card.append(h('h2', undefined, 'Aurora'), h('p', 'tn-big', label), h('p', 'tn-sub', `Activity ${d.aurora.kp} of 9 · NOAA forecast`));
    right.append(card);
  }
  if (d.iss) {
    const card = h('div', 'tn-card tn-iss');
    card.append(h('h2', undefined, 'Space Station'));
    if (!d.iss.length) card.append(h('p', 'tn-sub', 'No visible passes in the next three days.'));
    const list = h('ul');
    for (const p of d.iss.slice(0, 3)) list.append(passRow(p, dayName(p.start), time(p.start)));
    card.append(list);
    right.append(card);
  }

  el.replaceChildren(left, right);
}

function passRow(p: IssPass, day: string, at: string) {
  const mins = Math.max(1, Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000));
  const height = p.maxElev >= 60 ? 'overhead' : p.maxElev >= 30 ? 'high' : 'low';
  const li = h('li');
  li.append(h('b', undefined, `${day} ${at}`), h('span', undefined, `${mins} min · ${height} · ${p.from} → ${p.to}`));
  return li;
}

export const tonightScreen: Screen = {
  id: 'tonight',
  title: 'Tonight',
  durationSec: 35,
  quiet: true,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'tn-loading', 'Looking at tonight’s sky…'));
    const load = async () => {
      try {
        const home = await skyHome(config);
        render(el, await getJson<TonightResponse>(`/api/tonight?${skyQuery(home)}`), home, config);
      } catch {
        if (!el.querySelector('.tn-main')) el.replaceChildren(h('p', 'tn-loading', 'Tonight’s sky isn’t available right now.'));
      }
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
  },
  unmount() {
    clearInterval(timer);
  },
};
