import {
  DEFAULT_DISPLAY,
  type AdminState, type DisplaySettings, type ScreenId, type Settings, type SkySettings,
} from '../../shared/settings';
import { api, toast } from './ui';

// What the setup page knows about the hub, and the saves every page shares. Pages read `state`
// and call render() after a change; main.ts decides which page that draws.

export let state: AdminState;
export function setState(s: AdminState) { state = s; }

let renderer = () => {};
export function onRender(fn: () => void) { renderer = fn; }
export function render() { renderer(); }

export function setSettings(s: Settings) {
  state.settings = s;
  render();
}

export const SAVED = 'Saved. The display picks this up within five minutes.';

export function displaySettings(): DisplaySettings {
  return state.settings.display ?? DEFAULT_DISPLAY;
}

export async function saveDisplay(next: DisplaySettings, message = SAVED) {
  setSettings(await api<Settings>('/api/admin/display', next));
  toast(message);
}

export function skySettings(): SkySettings {
  return state.settings.sky ?? { places: [], active: 'default', radiusNm: 25 };
}

export async function saveSky(next: SkySettings, message = 'Saved.') {
  setSettings(await api<Settings>('/api/admin/sky', next));
  toast(message);
}

export const isScreenOn = (id: ScreenId) => !(displaySettings().screensOff ?? []).includes(id);

export function setScreenOn(id: ScreenId, on: boolean, name: string) {
  const d = displaySettings();
  const off = (d.screensOff ?? []).filter(s => s !== id);
  return saveDisplay({ ...d, screensOff: on ? off : [...off, id] }, on ? `${name} is back in the rotation.` : `${name} is off. The display drops it within five minutes.`);
}

/** Where the sky, weather and Tonight screens are centred, in a few words. */
export function placeName(): string {
  const sky = skySettings();
  if (sky.active === 'device') return 'Each display’s own location';
  return sky.places.find(p => p.id === sky.active)?.name ?? sky.places[0]?.name ?? 'Each display’s own location';
}

export const km = (nm: number) => `${Math.round(nm * 1.852)} km`;
