import type { PlaceName } from '../shared/types';

// Town and village names around a place, for labelling the radar. They come from files built
// with the app from GeoNames (CC BY 4.0; see scripts/build-places.mjs), so there's nothing
// live to go wrong: a display fetches the two-degree squares around it and keeps them.

type Row = [name: string, lat: number, lon: number, population: number];

let index: Promise<{ cell: number; cells: Set<string> }> | undefined;

function loadIndex() {
  index ??= fetch('/places/index.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`places index ${r.status}`))))
    .then((d: { cell: number; cells: string[] }) => ({ cell: d.cell, cells: new Set(d.cells) }))
    .catch(err => { index = undefined; throw err; });
  return index;
}

const kind = (population: number): PlaceName['kind'] => (population >= 50_000 ? 'city' : population >= 2_500 ? 'town' : 'village');

/** Places within radiusNm of a point, biggest first. */
export async function placesAround(lat: number, lon: number, radiusNm: number): Promise<PlaceName[]> {
  const { cell, cells } = await loadIndex();
  const dLat = radiusNm / 60, dLon = radiusNm / (60 * Math.cos((lat * Math.PI) / 180));
  const keys: string[] = [];
  for (let a = Math.floor((lat - dLat) / cell) * cell; a <= lat + dLat; a += cell) {
    for (let o = Math.floor((lon - dLon) / cell) * cell; o <= lon + dLon; o += cell) {
      if (cells.has(`${a}_${o}`)) keys.push(`${a}_${o}`);
    }
  }
  const lists = await Promise.all(keys.map(k => fetch(`/places/${k}.json`).then(r => (r.ok ? (r.json() as Promise<Row[]>) : []))));
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return lists.flat()
    .filter(([, pLat, pLon]) => Math.hypot((pLon - lon) * 60 * cosLat, (pLat - lat) * 60) <= radiusNm)
    .sort((a, b) => b[3] - a[3])
    .map(([name, pLat, pLon, population]) => ({ name, lat: pLat, lon: pLon, population, kind: kind(population) }));
}
