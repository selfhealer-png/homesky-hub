import type { HubConfig, WeatherResponse } from '../../shared/types';
import { describe, laterToday, recommend } from '../../shared/wear';
import { getJson } from '../api';
import { weatherIcon } from '../icons';
import { skyHome, skyQuery } from '../location';
import { h, type Screen } from '../screen';

// Weather now, the next few hours and days, and what to wear for it. The clothing advice is
// the point of the screen, so it gets the right half and the largest text after the
// temperature itself.

const REFRESH_MS = 10 * 60_000;
let timer: number | undefined;

const deg = (n: number) => `${Math.round(n)}°`;

function hourLabel(iso: string) {
  const hr = Number(iso.slice(11, 13));
  return hr === 0 ? '12am' : hr === 12 ? '12pm' : hr < 12 ? `${hr}am` : `${hr - 12}pm`;
}

function isNight(iso: string, sunrise?: string, sunset?: string) {
  if (!sunrise || !sunset) return false;
  return iso < sunrise || iso >= sunset;
}

function render(el: HTMLElement, data: WeatherResponse, place: string, config: HubConfig) {
  const now = data.now;
  const today = data.days[0];
  const info = describe(now.code, now.isDay);
  const rec = recommend(now, data.hours, config.warmth);

  // Now
  const left = h('section', 'wx-now');
  left.append(h('p', 'wx-place', place));
  const big = h('div', 'wx-big');
  big.append(weatherIcon(info.icon, 'wx-icon wx-icon-big'), h('span', 'wx-temp', deg(now.temp)));
  left.append(big);
  const feels = Math.abs(now.feels - now.temp) >= 1 ? ` · feels like ${deg(now.feels)}` : '';
  left.append(h('p', 'wx-cond', `${info.label}${feels}`));
  if (today) left.append(h('p', 'wx-range', `High ${deg(today.max)} · Low ${deg(today.min)}`));

  // Next hours: every third hour
  const hours = h('ol', 'wx-hours');
  for (const hr of data.hours.filter((_, i) => i % 3 === 0).slice(0, 6)) {
    const day = data.days.find(d => d.date === hr.time.slice(0, 10));
    const li = h('li');
    li.append(h('span', 'wx-h-time', hourLabel(hr.time)), weatherIcon(describe(hr.code, !isNight(hr.time, day?.sunrise, day?.sunset)).icon), h('span', 'wx-h-temp', deg(hr.temp)));
    if (hr.rain >= 30) li.append(h('span', 'wx-rain', `${Math.round(hr.rain)}%`));
    hours.append(li);
  }

  // Coming days
  const days = h('ol', 'wx-days');
  for (const d of data.days.slice(1, 5)) {
    const li = h('li');
    const name = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T12:00:00Z`));
    li.append(h('span', 'wx-d-name', name), weatherIcon(describe(d.code).icon), h('span', 'wx-d-temp', `${deg(d.max)}`), h('span', 'wx-d-min', deg(d.min)));
    if (d.rain >= 30) li.append(h('span', 'wx-rain', `${Math.round(d.rain)}%`));
    days.append(li);
  }
  left.append(hours, days);

  // What to wear
  const right = h('section', 'wx-wear');
  right.append(h('h2', undefined, 'What to wear'), h('p', 'wx-headline', rec.headline));
  const list = h('ul', 'wx-items');
  for (const item of rec.items) {
    const li = h('li');
    li.append(h('span', undefined, item.text));
    if (item.why) li.append(h('small', undefined, item.why));
    list.append(li);
  }
  right.append(list, h('p', 'wx-later', laterToday(now, data.hours, rec)));

  el.replaceChildren(left, right);
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
        render(el, data, home.name, config);
      } catch {
        if (!el.querySelector('.wx-now')) el.replaceChildren(h('p', 'wx-loading', 'The forecast isn’t available right now.'));
      }
    };
    load();
    timer = window.setInterval(load, REFRESH_MS);
  },
  unmount() {
    clearInterval(timer);
  },
};
