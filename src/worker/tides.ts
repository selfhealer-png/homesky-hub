import { tideTurns } from '../shared/tides';
import type { TideResponse } from '../shared/types';
import { cached } from './cache';
import { json, type Env } from './env';
import { loadSettings } from './settings';
import { getText } from './tonight';

// The tide at the place chosen for the Tides screen, from Open-Meteo's marine model (free,
// keyless): sea level every 15 minutes, tides included. It's a global model, good for the
// shape and times of the tide; it isn't a harbour tide table, and the screen says so.
// Inland there's no sea, and the model answers with nothing but nulls.

const HOUR = 3_600_000;

export async function handleTides(env: Env): Promise<Response> {
  const place = (await loadSettings(env)).sky?.tidePlace;
  if (!place) return json({ error: 'No place chosen for the tides. Choose one in /setup.' }, { status: 404 });
  const all = await cached(env, `tides:v1:${place.lat}:${place.lon}`, 3 * 3600, async () => {
    const u = `https://marine-api.open-meteo.com/v1/marine?latitude=${place.lat}&longitude=${place.lon}&minutely_15=sea_level_height_msl&past_days=1&forecast_days=3&timezone=UTC`;
    const d = JSON.parse(await getText(u)) as { minutely_15?: { time: string[]; sea_level_height_msl: Array<number | null> } };
    const m = d.minutely_15;
    if (!m) return [];
    return m.time.flatMap((t, i): Array<[string, number]> => {
      const v = m.sea_level_height_msl[i];
      return v === null || v === undefined ? [] : [[`${t}:00Z`, Math.round(v * 100) / 100]];
    });
  }).catch(() => null);
  if (!all) return json({ error: 'The tide forecast isn’t available right now.' }, { status: 502 });
  if (!all.length) return json({ error: `No tide data for ${place.name}. Choose a place right by the sea.` }, { status: 422 });

  // A few hours back, so the curve shows where the tide came from, and a day and a half ahead.
  const now = Date.now();
  const heights = all.filter(([t]) => Date.parse(t) >= now - 6 * HOUR && Date.parse(t) <= now + 36 * HOUR);
  // Turns are found on the whole series, so the first and last in the window aren't cut short.
  const turns = tideTurns(all).filter(t => Date.parse(t.time) >= now - 6 * HOUR && Date.parse(t.time) <= now + 36 * HOUR);
  return json({ place: place.name, heights, turns } satisfies TideResponse);
}
