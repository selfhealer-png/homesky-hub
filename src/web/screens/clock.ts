import type { HubConfig } from '../../shared/types';
import { FlapRow } from '../flap';
import { motionLevel } from '../motion';
import { h, type Screen } from '../screen';
import { mountWordClock } from './wordclock';

// The clock screen. Its style is chosen in /setup: word clock, large digital, analogue, or a
// split-flap clock that shares the overhead board's tiles and theme.

let stop: (() => void) | undefined;

function timeParts(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { h: Number(p.hour), m: Number(p.minute), s: Number(p.second) };
}
const dateLine = (tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date());
const pad = (n: number) => String(n).padStart(2, '0');

function mountDigital(el: HTMLElement, config: HubConfig) {
  const time = h('div', 'dc-time');
  const date = h('div', 'dc-date');
  const box = h('div', 'dc');
  box.append(time, date);
  el.append(box);
  const render = () => {
    const t = timeParts(config.timezone);
    time.textContent = `${pad(t.h)}:${pad(t.m)}`;
    date.textContent = dateLine(config.timezone);
  };
  render();
  const timer = window.setInterval(render, 1000);
  return () => clearInterval(timer);
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function mountAnalogue(el: HTMLElement, config: HubConfig) {
  const face = svg('svg', { viewBox: '-100 -100 200 200', class: 'ac-face', role: 'img' });
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    face.append(svg('line', {
      x1: 0, y1: -94, x2: 0, y2: hour ? -80 : -88,
      class: hour ? 'ac-tick hour' : 'ac-tick',
      transform: `rotate(${i * 6})`,
    }));
  }
  const hourHand = svg('line', { x1: 0, y1: 10, x2: 0, y2: -48, class: 'ac-hand hour' });
  const minuteHand = svg('line', { x1: 0, y1: 12, x2: 0, y2: -76, class: 'ac-hand minute' });
  const secondHand = svg('line', { x1: 0, y1: 18, x2: 0, y2: -84, class: 'ac-hand second' });
  face.append(hourHand, minuteHand, secondHand, svg('circle', { r: 4, class: 'ac-pin' }));
  const date = h('div', 'ac-date');
  const box = h('div', 'ac');
  box.append(face, date);
  el.append(box);

  const render = () => {
    const t = timeParts(config.timezone);
    hourHand.setAttribute('transform', `rotate(${(t.h % 12) * 30 + t.m * 0.5})`);
    minuteHand.setAttribute('transform', `rotate(${t.m * 6 + t.s * 0.1})`);
    secondHand.setAttribute('transform', `rotate(${t.s * 6})`);
    // A ticking second hand is the busiest thing on the screen; only show it at full motion.
    secondHand.style.display = motionLevel() === 'full' ? '' : 'none';
    face.setAttribute('aria-label', `${pad(t.h)}:${pad(t.m)}`);
    date.textContent = dateLine(config.timezone, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  render();
  const timer = window.setInterval(render, 1000);
  return () => clearInterval(timer);
}

function mountFlip(el: HTMLElement, config: HubConfig) {
  // Uses the board's theme, so the two split-flap screens always match.
  let theme = 'splitflap';
  try { theme = localStorage.getItem('hub.boardTheme') ?? config.boardTheme; } catch { theme = config.boardTheme; }
  el.dataset.theme = theme;
  const time = new FlapRow(5, 'xl');
  const date = new FlapRow(14, 'sm');
  const box = h('div', 'flipclock');
  box.append(time.el, date.el);
  el.append(box);
  const render = () => {
    const t = timeParts(config.timezone);
    time.set(`${pad(t.h)}:${pad(t.m)}`, 'center');
    date.set(dateLine(config.timezone, { weekday: 'short', day: 'numeric', month: 'short' }), 'center');
  };
  render();
  const timer = window.setInterval(render, 1000);
  return () => clearInterval(timer);
}

export const clockScreen: Screen = {
  id: 'clock',
  title: 'Clock',
  quiet: true,
  ownClock: true,
  mount(el: HTMLElement, config: HubConfig) {
    el.classList.add(`clock-${config.clock}`);
    stop = config.clock === 'digital' ? mountDigital(el, config)
      : config.clock === 'analogue' ? mountAnalogue(el, config)
      : config.clock === 'flip' ? mountFlip(el, config)
      : mountWordClock(el, config);
  },
  unmount() {
    stop?.();
    stop = undefined;
  },
};
