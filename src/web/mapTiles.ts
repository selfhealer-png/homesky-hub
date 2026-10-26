import type { RadarMap } from '../shared/settings';

// Background maps for the radar. Both are free, keyless and credited on screen, and suitable
// for this open-source, non-commercial hub at a few dozen tiles per load:
//   map        OpenStreetMap's own tiles (light use only, per the OSM tile policy)
//   satellite  EOX Sentinel-2 cloudless 2024 (10 m imagery; free for non-commercial use)
// A commercial build needs licensed sources instead (Esri, MapTiler, Mapbox…): change them here.

export interface TileSource {
  url: (z: number, x: number, y: number) => string;
  maxZoom: number;
  credit: string;
}

export const TILE_SOURCES: Record<Exclude<RadarMap, 'plain'>, TileSource> = {
  map: {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    maxZoom: 18,
    credit: '© OpenStreetMap contributors',
  },
  satellite: {
    url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`,
    maxZoom: 15,
    credit: 'Sentinel-2 cloudless 2024 by EOX · Copernicus data',
  },
};

const TILE = 256;

/** Home's position in world pixels at a zoom (Web Mercator). */
export function worldPixel(lat: number, lon: number, zoom: number) {
  const size = TILE * 2 ** zoom;
  const φ = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * size, y: ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * size };
}

/**
 * Fills a circle of radius r pixels with map tiles, centred on lat/lon, at pxPerNm pixels per
 * nautical mile: the same scale as the radar drawn over it, so planes sit over the right places.
 */
export function tileDisc(source: TileSource, lat: number, lon: number, r: number, pxPerNm: number): HTMLElement {
  // At zoom z a degree of longitude is 256·2^z/360 px; a nautical mile east is 1/(60·cos φ) of a degree.
  const zoom = Math.log2((pxPerNm * 360 * 60 * Math.cos((lat * Math.PI) / 180)) / TILE);
  // Fetch one level sharper on high-density screens, then scale tiles to fit exactly.
  const z = Math.max(1, Math.min(source.maxZoom, Math.ceil(zoom) + (window.devicePixelRatio >= 2 ? 1 : 0)));
  const k = 2 ** (zoom - z);
  const size = TILE * k;
  const centre = worldPixel(lat, lon, z);
  const reach = r / k;
  const x0 = Math.floor((centre.x - reach) / TILE), x1 = Math.floor((centre.x + reach) / TILE);
  const y0 = Math.floor((centre.y - reach) / TILE), y1 = Math.floor((centre.y + reach) / TILE);
  const max = 2 ** z;

  const disc = document.createElement('div');
  disc.className = 'radar-map';
  disc.setAttribute('aria-hidden', 'true');
  for (let x = x0; x <= x1; x++) {
    for (let y = Math.max(0, y0); y <= Math.min(max - 1, y1); y++) {
      // Skip tiles wholly outside the circle.
      const left = (x * TILE - centre.x) * k + r, top = (y * TILE - centre.y) * k + r;
      const nx = Math.max(left, Math.min(r, left + size)), ny = Math.max(top, Math.min(r, top + size));
      if (Math.hypot(nx - r, ny - r) > r) continue;
      const img = document.createElement('img');
      img.src = source.url(z, ((x % max) + max) % max, y);
      img.alt = '';
      img.decoding = 'async';
      img.style.cssText = `left:${left}px;top:${top}px;width:${size + 0.5}px;height:${size + 0.5}px`;
      disc.append(img);
    }
  }
  return disc;
}
