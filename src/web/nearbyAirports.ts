// Airports with scheduled flights around a place, for marking on the radar. They come from the
// list built with the app from OurAirports (public domain; see scripts/build-airports.mjs), the
// same one /setup searches, so there's nothing live to go wrong.

export interface NearbyAirport { icao: string; iata: string; name: string; lat: number; lon: number; size: 'l' | 'm' | 's' }

type Row = [icao: string, iata: string, name: string, city: string, country: string, lat: number, lon: number, size?: string];

let list: Promise<Row[]> | undefined;

/** Airports within radiusNm of a point, the big ones first, then nearest first. */
export async function airportsAround(lat: number, lon: number, radiusNm: number): Promise<NearbyAirport[]> {
  list ??= fetch('/airports.json')
    .then(r => (r.ok ? (r.json() as Promise<Row[]>) : Promise.reject(new Error(`airports.json answered ${r.status}`))))
    .catch(err => { list = undefined; throw err; });
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dist = (r: Row) => Math.hypot((r[6] - lon) * 60 * cosLat, (r[5] - lat) * 60);
  const rank = { l: 0, m: 1, s: 2 };
  // Lists built before the size was added say nothing; those airports count as medium.
  const size = (r: Row) => (r[7] === 'l' || r[7] === 's' ? r[7] : 'm');
  return (await list)
    .filter(r => dist(r) <= radiusNm)
    .sort((a, b) => rank[size(a)] - rank[size(b)] || dist(a) - dist(b))
    .map(r => ({ icao: r[0], iata: r[1], name: r[2], lat: r[5], lon: r[6], size: size(r) }));
}
