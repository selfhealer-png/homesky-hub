import { nightPhase, type NightPhase } from '../shared/night';
import type { HubConfig } from '../shared/types';
import { skyHome } from './location';

// Puts the display into its night look (see shared/night.ts) by setting data-night on <html>;
// styles.css does the rest. In quiet hours a touch lifts the dimming for a couple of minutes,
// so someone who walks up in the dark can read it.

const AWAKE_MS = 2 * 60_000;

let phase: NightPhase = 'day';
let config: HubConfig;
let onChange: (phase: NightPhase) => void = () => {};
let awakeTimer: number | undefined;

export const currentNight = () => phase;

let home: { lat: number; lon: number } | undefined;

/** Re-checks now with the last known place, then again once this display's own location is known. */
export function updateNight() {
  apply();
  skyHome(config).then(h => { home = h; apply(); }, () => {});
}

function apply() {
  const at = home ?? config.home;
  const next = nightPhase(Date.now(), at.lat, at.lon, config.timezone, config.night);
  if (next === phase) return;
  phase = next;
  if (phase === 'day') delete document.documentElement.dataset.night;
  else document.documentElement.dataset.night = phase;
  onChange(phase);
}

export function startNight(hub: HubConfig, changed: (phase: NightPhase) => void) {
  config = hub;
  onChange = changed;
  const veil = document.createElement('div');
  veil.id = 'night';
  veil.setAttribute('aria-hidden', 'true');
  document.body.append(veil);
  document.addEventListener('pointerdown', () => {
    document.documentElement.dataset.awake = '';
    clearTimeout(awakeTimer);
    awakeTimer = window.setTimeout(() => delete document.documentElement.dataset.awake, AWAKE_MS);
  }, { capture: true, passive: true });
  window.setInterval(updateNight, 60_000);
  updateNight();
}
