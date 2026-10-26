import type { HubConfig, WeatherResponse } from '../../shared/types';
import { describe, essentials, isWet, laterToday, recommend } from '../../shared/wear';
import { getJson } from '../api';
import { wearIcon, weatherIcon } from '../icons';
import { mountRainRadar } from '../rainRadar';
import { skyHome, skyQuery } from '../location';
import { h, setCaption, type Screen } from '../screen';

// Weather now and what to wear for it on the left; the next hours and days on the right, with
// the rain radar under them only when rain is around. What to wear is a few pictures, not a
// paragraph: it should be read in a glance on the way out of the door.

const REFRESH_MS = 10 * 60_000;
let timer: number | undefined;
let stopRadar: (() => void) | undefined;

const deg = (n: number) => `${Math.round(n)}°`;

/** The hub's other screens all use the 24-hour clock. Forecast times are already local. */
const hourLabel = (iso: string) => iso.slice(11, 16);

/** Rain is around: falling now, or likely in the next six hours. Only then is the radar shown. */
const rainAround = (data: WeatherResponse) =>
  isWet(data.now.code) || data.now.precipitation > 0 || data.hours.slice(0, 6).some(h => h.rain >= 40 || isWet(h.code));

function isNight(iso: string, sunrise?: string, sunset?: string) {
  if (!sunrise || !sunset) return false;
  return iso < sunrise || iso >= sunset;
}

const LEVEL_TONE: Record<string, string> = { Good: 'ok', Fair: 'ok', Low: 'ok', Moderate: 'mid', High: 'high', Poor: 'high', 'Very high': 'bad', 'Very poor': 'bad', 'Extremely poor': 'bad' };

function chip(name: string, value: string, tone: string) {
  const li = h('li', `wx-chip tone-${tone}`);
  li.append(h('span', 'wx-chip-dot'), h('span', 'wx-chip-name', name), h('b', undefined, value));
  return li;
}

function render(el: HTMLElement, data: WeatherResponse, home: { name: string; lat: number; lon: number }, config: HubConfig) {
  stopRadar?.();
  const now = data.now;
  const today = data.days[0];
  const info = describe(now.code, now.isDay);
  const rec = recommend(now, data.hours, config.warmth);

  // Now
  const left = h('section', 'wx-now');
  setCaption(`Weather · ${home.name}`);
  const big = h('div', 'wx-big');
  big.append(weatherIcon(info.icon, 'wx-icon wx-icon-big'), h('span', 'wx-temp', deg(now.temp)));
  left.append(big);
  const feels = Math.abs(now.feels - now.temp) >= 1 ? ` · feels like ${deg(now.feels)}` : '';
  left.append(h('p', 'wx-cond', `${info.label}${feels}`));
  if (today) left.append(h('p', 'wx-range', `High ${deg(today.max)} · Low ${deg(today.min)}`));

  // What to wear: the four items that decide how you go out, as pictures readable from across
  // the room. Anything else is named underneath for a closer look.
  const wear = h('section', 'wx-wear');
  const kit = h('ul', 'wx-kit');
  kit.setAttribute('aria-label', 'What to wear');
  const { shown, also } = essentials(rec.items);
  for (const item of shown) {
    const li = h('li');
    li.title = item.why ? `${item.text} (${item.why})` : item.text;
    li.setAttribute('aria-label', li.title);
    li.append(wearIcon(item.icon), h('span', undefined, item.short));
    kit.append(li);
  }
  wear.append(kit);
  if (also.length) wear.append(h('p', 'wx-also', `Also ${also.map(i => i.short.toLowerCase()).join(', ')}`));
  const later = laterToday(now, data.hours, rec);
  if (later) wear.append(h('p', 'wx-later', later));
  left.append(wear);

  // Next hours: every third hour
  const hours = h('ol', 'wx-hours');
  for (const hr of data.hours.filter((_, i) => i % 3 === 0).slice(0, 6)) {
    const day = data.days.find(d => d.date === hr.time.slice(0, 10));
    const li = h('li');
    li.append(h('span', 'wx-h-time', hourLabel(hr.time)), weatherIcon(describe(hr.code, !isNight(hr.time, day?.sunrise, day?.sunset)).icon), h('span', 'wx-h-temp', deg(hr.temp)));
    if (hr.rain >= 30) li.append(h('span', 'wx-rain', `${Math.round(hr.rain)}% rain`));
    hours.append(li);
  }

  // Coming days
  const days = h('ol', 'wx-days');
  for (const d of data.days.slice(1, 5)) {
    const li = h('li');
    const name = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T12:00:00Z`));
    li.append(h('span', 'wx-d-name', name), weatherIcon(describe(d.code).icon), h('span', 'wx-d-temp', `${deg(d.max)}`), h('span', 'wx-d-min', deg(d.min)));
    if (d.rain >= 30) li.append(h('span', 'wx-rain', `${Math.round(d.rain)}% rain`));
    days.append(li);
  }

  // Pollen and air quality, in the pollen season.
  const air = data.air;
  if (air && (air.pollen || air.aqiLabel)) {
    const chips = h('ul', 'wx-chips');
    if (air.pollen) chips.append(chip('Pollen', `${air.pollen.level}${air.pollen.level === 'Low' ? '' : ` · ${air.pollen.kind}`}`, LEVEL_TONE[air.pollen.level]));
    if (air.aqiLabel) chips.append(chip('Air', air.aqiLabel, LEVEL_TONE[air.aqiLabel] ?? 'mid'));
    left.append(chips);
  }

  // The forecast, and the rain radar under it when there's rain to watch. On a dry day the
  // forecast has the column to itself.
  const right = h('section', 'wx-side');
  right.append(hours, days);
  const wet = rainAround(data);
  right.classList.toggle('dry', !wet);
  const radar = wet ? h('div', 'wx-radar') : null;
  if (radar) right.append(radar);

  el.replaceChildren(left, right);
  if (radar) stopRadar = mountRainRadar(radar, home.lat, home.lon);
}

export const weatherScreen: Screen = {
  id: 'weather',
  title: 'Weather',
  durationSec: 45,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'wx-loading', 'Checking the weather…'));
    const load = async () => {
      try {
        const home = await skyHome(config);
        const data = await getJson<WeatherResponse>(`/api/weather?${skyQuery(home)}`);
        render(el, data, home, config);
      } catch {
        if (!el.querySelector('.wx-now')) el.replaceChildren(h('p', 'wx-loading', 'The forecast isn’t available right now.'));
      }
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
  },
  unmount() {
    clearInterval(timer);
    stopRadar?.();
    stopRadar = undefined;
  },
};
