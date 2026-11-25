import { heightAt } from '../../shared/tides';
import type { HubConfig, TideResponse, TideTurn } from '../../shared/types';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// The tide at a place by the sea: whether it's coming in or going out and when it turns, the
// curve from a few hours ago to tomorrow, and the next high and low waters. Heights are from
// mean sea level, from a global model: a guide to the day, not a harbour tide table.

const REFRESH_MS = 30 * 60_000;
const HOUR = 3_600_000;
const AHEAD = 24 * HOUR;
const BEHIND = 3 * HOUR;
const SVG = 'http://www.w3.org/2000/svg';

let timer: number | undefined;
let clock: number | undefined;

const metres = (m: number) => `${m < 0 ? '−' : m > 0 ? '+' : ''}${Math.abs(m).toFixed(1)} m`;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function formatters(tz: string) {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const dayKey = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t);
  const day = (t: number) => {
    const now = Date.now();
    if (dayKey(t) === dayKey(now)) return 'Today';
    if (dayKey(t) === dayKey(now + 86_400_000)) return 'Tomorrow';
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: tz }).format(t);
  };
  return { time: (t: number) => time.format(t), day };
}

/** The headline: which way the tide is going, and when it turns. */
function headline(d: TideResponse, now: number, time: (t: number) => string): string {
  const next = d.turns.find(t => Date.parse(t.time) > now);
  if (!next) return 'Tide times aren’t available';
  const mins = (Date.parse(next.time) - now) / 60_000;
  if (mins < 20) return `${next.type === 'high' ? 'High' : 'Low'} water about now`;
  return next.type === 'high' ? `Coming in: high water at ${time(Date.parse(next.time))}` : `Going out: low water at ${time(Date.parse(next.time))}`;
}

/** The curve, from a few hours ago to a day ahead, with now and the turns marked. */
function chart(box: HTMLElement, d: TideResponse, now: number, f: ReturnType<typeof formatters>) {
  const { width, height } = box.getBoundingClientRect();
  if (!width || !height) return;
  const from = now - BEHIND, to = now + AHEAD;
  const pts = d.heights.map(([t, v]) => [Date.parse(t), v] as const).filter(([t]) => t >= from && t <= to);
  if (pts.length < 2) return;
  const vals = pts.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(0.2, hi - lo);
  // Room above for the high-water times and Now, below for the low-water times and the hours.
  const top = 44, bottom = 56;
  const x = (t: number) => ((t - from) / (to - from)) * width;
  const y = (v: number) => top + (1 - (v - lo) / span) * (height - top - bottom);

  const svg = svgEl('svg', { class: 'tide-chart', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  // Hours on the axis, every six, and the turn of the day.
  for (let t = Math.ceil(from / (6 * HOUR)) * 6 * HOUR; t <= to; t += 6 * HOUR) {
    const label = f.time(t);
    svg.append(svgEl('line', { x1: x(t), x2: x(t), y1: top - 10, y2: height - bottom + 4, class: label === '00:00' ? 'tide-midnight' : 'tide-grid' }));
    const text = svgEl('text', { x: x(t), y: height - 10, class: 'tide-axis', 'text-anchor': 'middle' });
    text.textContent = label === '00:00' ? f.day(t + 1) : label;
    svg.append(text);
  }
  const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  svg.append(
    svgEl('path', { d: `${line}L${x(pts[pts.length - 1][0]).toFixed(1)} ${height - bottom}L${x(pts[0][0]).toFixed(1)} ${height - bottom}Z`, class: 'tide-water' }),
    svgEl('path', { d: line, class: 'tide-line' }),
  );
  for (const turn of d.turns) {
    const t = Date.parse(turn.time);
    if (t < from || t > to) continue;
    const label = svgEl('text', { x: Math.min(width - 30, Math.max(30, x(t))), y: turn.type === 'high' ? y(turn.height) - 14 : y(turn.height) + 24, class: `tide-turn ${turn.type}`, 'text-anchor': 'middle' });
    label.textContent = f.time(t);
    svg.append(svgEl('circle', { cx: x(t), cy: y(turn.height), r: 4.5, class: `tide-dot ${turn.type}` }), label);
  }
  const nowH = heightAt(d.heights, now);
  svg.append(svgEl('line', { x1: x(now), x2: x(now), y1: top - 16, y2: height - bottom, class: 'tide-now' }));
  if (nowH !== undefined) svg.append(svgEl('circle', { cx: x(now), cy: y(nowH), r: 8, class: 'tide-now-dot' }));
  // Now is labelled unless a high-water time is right beside it; the line and dot say it anyway.
  const crowded = d.turns.some(t => t.type === 'high' && Math.abs(x(Date.parse(t.time)) - x(now)) < 56);
  if (!crowded) {
    const nowLabel = svgEl('text', { x: x(now), y: top - 22, class: 'tide-now-label', 'text-anchor': 'middle' });
    nowLabel.textContent = 'Now';
    svg.append(nowLabel);
  }
  box.replaceChildren(svg);
}

function turnCard(t: TideTurn, f: ReturnType<typeof formatters>) {
  const at = Date.parse(t.time);
  const li = h('li', `tide-card ${t.type}`);
  li.append(h('span', 'tide-kind', t.type === 'high' ? 'High water' : 'Low water'), h('b', undefined, f.time(at)),
    h('span', 'tide-sub', `${f.day(at)} · ${metres(t.height)}`));
  return li;
}

function render(el: HTMLElement, config: HubConfig, d: TideResponse) {
  const now = Date.now();
  const f = formatters(config.timezone);
  const head = h('header', 'tide-head');
  const nowH = heightAt(d.heights, now);
  head.append(h('h1', undefined, headline(d, now, f.time)),
    h('p', undefined, [d.place, nowH !== undefined ? `${metres(nowH)} now` : ''].filter(Boolean).join(' · ')));
  const box = h('div', 'tide-box');
  const list = h('ol', 'tide-turns');
  for (const t of d.turns.filter(t => Date.parse(t.time) > now).slice(0, 4)) list.append(turnCard(t, f));
  const note = h('p', 'tide-note', 'Heights from mean sea level, from Open-Meteo’s marine model. A guide, not for navigation.');
  el.replaceChildren(head, box, list, note);
  chart(box, d, now, f);
}

export const tidesScreen: Screen = {
  id: 'tides',
  title: 'Tides',
  isAvailable: config => !!config.tidePlace,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'wx-loading', 'Reading the tide…'));
    let data: TideResponse | undefined;
    const load = async () => {
      try {
        data = await getJson<TideResponse>('/api/tides');
        render(el, config, data);
      } catch {
        if (!data) el.replaceChildren(h('p', 'wx-loading', `Tide times for ${config.tidePlace?.name ?? 'your place'} aren’t available. Choose a place right by the sea in Settings.`));
      }
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
    // The curve slides along and the headline keeps up, without asking the hub again.
    clock = window.setInterval(() => { if (data) render(el, config, data); }, 5 * 60_000);
  },
  unmount() {
    clearInterval(timer);
    clearInterval(clock);
  },
};
