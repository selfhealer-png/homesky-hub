import type { HubConfig, WeatherResponse } from '../../shared/types';
import { isWet, type WeatherHour } from '../../shared/wear';
import { getJson } from '../api';
import { skyHome, skyQuery } from '../location';
import { mountRainRadar } from '../rainRadar';
import { h, setCaption, type Screen } from '../screen';

// The rain map: the last hour of radar over the region, big enough to see what's coming, with
// a plain answer beside it ("Rain likely from 15:00") and the chance of rain hour by hour.

const REFRESH_MS = 10 * 60_000;
const HOURS = 6;
let timer: number | undefined;
let stopRadar: (() => void) | undefined;

const hourLabel = (iso: string) => iso.slice(11, 16);
const wetHour = (hr: WeatherHour) => hr.rain >= 40 || isWet(hr.code);

/** One line on the next few hours, from the forecast. */
export function rainOutlook(data: WeatherResponse): string {
  const next = data.hours.slice(0, HOURS);
  if (isWet(data.now.code) || data.now.precipitation > 0) {
    const dry = next.find(hr => !wetHour(hr) && hr.rain < 30);
    return dry ? `Raining now, drier from ${hourLabel(dry.time)}` : 'Raining now, and for the next few hours';
  }
  const wet = next.find(wetHour);
  return wet ? `Rain likely from ${hourLabel(wet.time)}` : 'Dry for the next six hours';
}

function render(el: HTMLElement, data: WeatherResponse | null, home: { name: string; lat: number; lon: number }) {
  stopRadar?.();
  setCaption(`Rain · ${home.name}`);
  const map = h('div', 'wx-radar rain-map');
  const panel = h('section', 'rain-panel');
  panel.append(h('h2', undefined, data ? rainOutlook(data) : 'Rain radar'));
  if (data) {
    const list = h('ol', 'rain-hours');
    list.setAttribute('aria-label', 'Chance of rain by hour');
    for (const hr of data.hours.slice(0, HOURS)) {
      const li = h('li');
      const bar = h('span', 'rain-bar');
      bar.style.setProperty('--p', `${Math.round(hr.rain)}%`);
      li.append(h('span', 'rain-time', hourLabel(hr.time)), bar, h('span', 'rain-pct', `${Math.round(hr.rain)}%`));
      li.classList.toggle('wet', wetHour(hr));
      list.append(li);
    }
    panel.append(list);
  }
  el.replaceChildren(map, panel);
  stopRadar = mountRainRadar(map, home.lat, home.lon);
}

export const rainScreen: Screen = {
  id: 'rain',
  title: 'Rain map',
  durationSec: 40,
  mount(el: HTMLElement, config: HubConfig) {
    el.append(h('p', 'wx-loading', 'Looking for rain…'));
    const load = async () => {
      const home = await skyHome(config).catch(() => null);
      if (!home) return el.replaceChildren(h('p', 'wx-loading', 'The rain map needs a location. Add a place in Settings.'));
      // The map works without the forecast; the outlook beside it is a bonus.
      const data = await getJson<WeatherResponse>(`/api/weather?${skyQuery(home)}`).catch(() => null);
      render(el, data, home);
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
