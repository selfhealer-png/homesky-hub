import { worldPixel, type TileSource } from './mapTiles';

// A rectangular map of tiles at any zoom, for the Flight tracker and the Space Station: a box
// filled with tiles, and project() to place things over it. The world repeats left and right,
// so a view across the date line (or of the whole world) has no edge.

const TILE = 256;

export interface MapView {
  el: HTMLElement;
  width: number;
  height: number;
  /** Where a place is in the box, in CSS pixels: the copy of the world nearest the centre. */
  project(lat: number, lon: number): { x: number; y: number };
  /** The width of the whole world in pixels: a line jumping more than half of it crossed the date line. */
  worldPx: number;
}

/** Tiles covering a width × height box centred on lat/lon, at a zoom that needn't be whole. */
export function mapView(source: TileSource, kind: string, lat: number, lon: number, zoom: number, width: number, height: number): MapView {
  const el = document.createElement('div');
  el.className = 'map-view';
  el.dataset.map = kind;
  el.setAttribute('aria-hidden', 'true');

  // Photos: a sharper level, scaled down. Maps with names drawn in: near their natural size.
  const level = source.text ? Math.floor(zoom + 0.25) : Math.ceil(zoom) + (window.devicePixelRatio >= 2 ? 1 : 0);
  const z = Math.max(0, Math.min(source.maxZoom, level));
  const k = 2 ** (zoom - z);
  const size = TILE * k;
  const centre = worldPixel(lat, lon, z);
  const max = 2 ** z;
  const x0 = Math.floor((centre.x - width / 2 / k) / TILE), x1 = Math.floor((centre.x + width / 2 / k) / TILE);
  const y0 = Math.floor((centre.y - height / 2 / k) / TILE), y1 = Math.floor((centre.y + height / 2 / k) / TILE);
  for (let x = x0; x <= x1; x++) {
    for (let y = Math.max(0, y0); y <= Math.min(max - 1, y1); y++) {
      const img = document.createElement('img');
      img.src = source.url(z, ((x % max) + max) % max, y);
      img.alt = '';
      img.decoding = 'async';
      img.style.cssText = `left:${(x * TILE - centre.x) * k + width / 2}px;top:${(y * TILE - centre.y) * k + height / 2}px;width:${size + 0.5}px;height:${size + 0.5}px`;
      el.append(img);
    }
  }

  const c = worldPixel(lat, lon, zoom);
  const worldPx = TILE * 2 ** zoom;
  const project = (pLat: number, pLon: number) => {
    const p = worldPixel(Math.max(-85, Math.min(85, pLat)), pLon, zoom);
    let dx = p.x - c.x;
    dx -= Math.round(dx / worldPx) * worldPx;
    return { x: dx + width / 2, y: p.y - c.y + height / 2 };
  };
  return { el, width, height, project, worldPx };
}

/** Latitude from a Web Mercator y at zoom 0. */
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILE))) * 180) / Math.PI;

/** The centre and zoom that fit these places in a box, with a margin, no closer than maxZoom. */
export function fitView(points: Array<{ lat: number; lon: number }>, width: number, height: number, pad: number, maxZoom: number) {
  // Longitudes are taken relative to the first, so a route across the Pacific isn't the long way round.
  const lon0 = points[0].lon;
  const px = points.map(p => {
    const lon = lon0 + ((((p.lon - lon0) % 360) + 540) % 360) - 180;
    return worldPixel(p.lat, lon, 0);
  });
  const xs = px.map(p => p.x), ys = px.map(p => p.y);
  const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
  const zoom = Math.min(maxZoom, Math.log2(Math.min((width - 2 * pad) / Math.max(dx, 1e-6), (height - 2 * pad) / Math.max(dy, 1e-6))));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { lat: latOf(cy), lon: (cx / TILE) * 360 - 180, zoom: Math.max(0, zoom) };
}

/** Points along the great circle between two places, for drawing a route. */
export function greatCircle(a: { lat: number; lon: number }, b: { lat: number; lon: number }, steps = 64): Array<{ lat: number; lon: number }> {
  const r = Math.PI / 180;
  const v = (p: { lat: number; lon: number }) => [Math.cos(p.lat * r) * Math.cos(p.lon * r), Math.cos(p.lat * r) * Math.sin(p.lon * r), Math.sin(p.lat * r)];
  const [p, q] = [v(a), v(b)];
  const ω = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (ω < 1e-6) return [a, b];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * ω) / Math.sin(ω), s2 = Math.sin(t * ω) / Math.sin(ω);
    const [x, y, z] = [0, 1, 2].map(j => s1 * p[j] + s2 * q[j]);
    return { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
  });
}

/** An SVG path through projected points, lifting the pen where it jumps across the world's edge. */
export function pathThrough(view: MapView, points: Array<{ lat: number; lon: number }>): string {
  let d = '';
  let last: { x: number; y: number } | undefined;
  for (const p of points) {
    const { x, y } = view.project(p.lat, p.lon);
    d += `${!last || Math.abs(x - last.x) > view.worldPx / 2 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    last = { x, y };
  }
  return d;
}
