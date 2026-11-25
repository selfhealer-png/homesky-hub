import { TILE_SOURCES } from './mapTiles';
import { motionLevel } from './motion';

// A small rain radar for the weather screen: RainViewer's radar over OpenStreetMap, both free
// with a credit and no key. The map is drawn light; CSS darkens it to sit in the room. RainViewer's free tiles stop at zoom 7, a regional view about 300 km across,
// which is the useful one anyway: it shows the rain that's on its way.

const ZOOM = 7;
const TILE = 256;
const FRAMES = 7; // the last hour, ten minutes apart
const STEP_MS = 650;
const HOLD_MS = 2600; // pause on the latest frame before looping again

interface Maps { host: string; radar: { past: Array<{ time: number; path: string }> } }

let known: { at: number; maps: Maps } | undefined;

async function maps(): Promise<Maps> {
  if (known && Date.now() - known.at < 5 * 60_000) return known.maps;
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error(`RainViewer answered ${res.status}`);
  known = { at: Date.now(), maps: (await res.json()) as Maps };
  return known.maps;
}

/** Home's position in world pixels at ZOOM (Web Mercator). */
function worldPixel(lat: number, lon: number) {
  const size = TILE * 2 ** ZOOM;
  const φ = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * size,
  };
}

/** One layer of tiles covering the box, centred on home. */
function layer(box: { w: number; h: number }, centre: { x: number; y: number }, url: (x: number, y: number) => string, className: string) {
  const left = centre.x - box.w / 2, top = centre.y - box.h / 2;
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + box.w) / TILE);
  const y0 = Math.floor(top / TILE), y1 = Math.floor((top + box.h) / TILE);
  const el = document.createElement('div');
  el.className = className;
  el.style.transform = `translate(${x0 * TILE - left}px, ${y0 * TILE - top}px)`;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const img = document.createElement('img');
      img.src = url(x, y);
      img.alt = '';
      img.decoding = 'async';
      img.style.left = `${(x - x0) * TILE}px`;
      img.style.top = `${(y - y0) * TILE}px`;
      el.append(img);
    }
  }
  return el;
}

const clock = (unix: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000));

/** Fills the box with the radar. Returns a function that stops the animation. */
export function mountRainRadar(box: HTMLElement, lat: number, lon: number): () => void {
  let timer: number | undefined;
  let stopped = false;
  const size = { w: box.clientWidth || 440, h: box.clientHeight || 440 };
  const centre = worldPixel(lat, lon);

  box.append(
    layer(size, centre, (x, y) => TILE_SOURCES.map.url(ZOOM, x, y), 'rr-layer rr-base'),
    Object.assign(document.createElement('span'), { className: 'rr-home', ariaHidden: 'true' }),
  );
  const label = Object.assign(document.createElement('span'), { className: 'rr-time' });
  const credit = Object.assign(document.createElement('span'), { className: 'rr-credit', textContent: 'RainViewer · © OpenStreetMap contributors' });
  box.append(label, credit);

  maps().then(m => {
    if (stopped) return;
    const still = motionLevel() !== 'full';
    const past = m.radar.past.slice(still ? -1 : -FRAMES);
    if (!past.length) return;
    const layers = past.map(f => layer(size, centre, (x, y) => `${m.host}${f.path}/${TILE}/${ZOOM}/${x}/${y}/2/1_1.png`, 'rr-layer rr-rain'));
    box.querySelector('.rr-home')!.before(...layers);

    let i = layers.length - 1;
    const show = () => {
      layers.forEach((l, n) => l.classList.toggle('on', n === i));
      label.textContent = `Rain · ${clock(past[i].time)}`;
    };
    show();
    if (still || layers.length < 2) return;
    // Loop through the last hour, pausing on the latest frame.
    const tick = () => {
      i = (i + 1) % layers.length;
      show();
      timer = window.setTimeout(tick, i === layers.length - 1 ? HOLD_MS : STEP_MS);
    };
    timer = window.setTimeout(tick, HOLD_MS);
  }).catch(() => { label.textContent = 'Rain radar unavailable'; });

  return () => { stopped = true; clearTimeout(timer); };
}
