import type { HubConfig } from '../shared/types';

// Where this display's sky and weather screens are centred. The setup page picks the default:
// a saved place, or "each display uses its own location" (also what a new hub does). If the
// device won't share its location, config.home is the hub's estimate from the internet
// connection. On the display, tapping the middle of the radar steps through the saved places;
// that choice is remembered on this display only.

export interface SkyHome { lat: number; lon: number; name: string }

const OVERRIDE_KEY = 'hub.place';
let devicePosition: Promise<SkyHome | null> | null = null;
let deviceAt = 0;

function readOverride(): string | null {
  try { return localStorage.getItem(OVERRIDE_KEY); } catch { return null; }
}
function writeOverride(id: string | null) {
  try { id ? localStorage.setItem(OVERRIDE_KEY, id) : localStorage.removeItem(OVERRIDE_KEY); } catch { /* not remembered */ }
}

function locateDevice(): Promise<SkyHome | null> {
  // Re-ask every 15 minutes at most; a tablet on a shelf doesn't move much.
  if (devicePosition && Date.now() - deviceAt < 15 * 60_000) return devicePosition;
  deviceAt = Date.now();
  devicePosition = new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'This display' }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15 * 60_000 },
    );
  });
  return devicePosition;
}

export async function skyHome(config: HubConfig): Promise<SkyHome> {
  const override = readOverride();
  const chosen = override ?? config.activePlace;
  if (chosen === 'device') {
    const here = await locateDevice();
    if (here) return here;
  }
  const place = config.places.find(p => p.id === chosen);
  if (place) return { lat: place.lat, lon: place.lon, name: place.name };
  return config.home;
}

/** Query string that tells the server which centre this display wants. */
export const skyQuery = (home: SkyHome) => `lat=${home.lat.toFixed(4)}&lon=${home.lon.toFixed(4)}`;

/** Steps to the next saved place (and "this display" when that mode is available). */
export function nextPlace(config: HubConfig): string | null {
  const ids = [...config.places.map(p => p.id), ...(config.activePlace === 'device' ? ['device'] : [])];
  if (ids.length < 2) return null;
  const current = readOverride() ?? config.activePlace;
  const next = ids[(ids.indexOf(current) + 1) % ids.length];
  // Landing back on the default clears the override, so a later change in /setup takes effect.
  writeOverride(next === config.activePlace ? null : next);
  return next;
}
