// Pollen and air quality, shown on the weather screen during the pollen season only.
// Pollen counts are grains per cubic metre (Open-Meteo, from CAMS; Europe only). Air quality
// is the European AQI, which CAMS models worldwide.

export type PollenKind = 'grass' | 'tree' | 'weed';
export type Level = 'Low' | 'Moderate' | 'High' | 'Very high';

export interface AirInfo {
  /** European AQI, 0 upwards; lower is cleaner. */
  aqi?: number;
  aqiLabel?: string;
  /** Today's peak pollen, when there is any data for this place. */
  pollen?: { level: Level; kind: PollenKind };
}

/** April to September in the north, October to March in the south: pollen season. */
export function inPollenSeason(lat: number, date = new Date()): boolean {
  const month = date.getUTCMonth() + 1;
  const northern = month >= 4 && month <= 9;
  return lat >= 0 ? northern : !northern;
}

const SPECIES: Record<string, PollenKind> = {
  grass_pollen: 'grass',
  birch_pollen: 'tree', alder_pollen: 'tree', olive_pollen: 'tree',
  mugwort_pollen: 'weed', ragweed_pollen: 'weed',
};
export const POLLEN_FIELDS = Object.keys(SPECIES);

// Counts at which each kind becomes Moderate, High and Very high (after UK Met Office bands).
const BANDS: Record<PollenKind, [number, number, number]> = {
  grass: [30, 50, 150],
  tree: [30, 90, 200],
  weed: [10, 30, 60],
};
const LEVELS: Level[] = ['Low', 'Moderate', 'High', 'Very high'];

export function pollenLevel(kind: PollenKind, count: number): number {
  return BANDS[kind].filter(t => count >= t).length;
}

/** The worst pollen in the given hourly counts; undefined when no species has any data. */
export function peakPollen(hourly: Record<string, Array<number | null> | undefined>): AirInfo['pollen'] {
  let best: { rank: number; count: number; kind: PollenKind } | undefined;
  for (const [field, kind] of Object.entries(SPECIES)) {
    const counts = (hourly[field] ?? []).filter((n): n is number => typeof n === 'number');
    if (!counts.length) continue;
    const count = Math.max(...counts);
    const rank = pollenLevel(kind, count);
    if (!best || rank > best.rank || (rank === best.rank && count > best.count)) best = { rank, count, kind };
  }
  return best && { level: LEVELS[best.rank], kind: best.kind };
}

export function aqiLabel(aqi: number): string {
  return aqi < 20 ? 'Good' : aqi < 40 ? 'Fair' : aqi < 60 ? 'Moderate' : aqi < 80 ? 'Poor' : aqi < 100 ? 'Very poor' : 'Extremely poor';
}
