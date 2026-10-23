import type { HubConfig } from '../../shared/types';
import type { PhotoInfo } from '../../shared/settings';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// The photo frame. Two styles, chosen in /setup:
//   fill    edge to edge with a slow drift; the time and caption sit on a soft scrim
//   framed  prints in a dark frame with a cream mount, hung on a dim wall, each with a small
//           gallery label underneath (place or collection, and the date)
// Portrait photos are paired: a landscape screen holds two portraits side by side far better
// than one portrait with empty space either side. The deck is shuffled once and carries on
// where it left off each time the screen comes round.

const PHOTO_MS = 15_000;
const FADE_MS = 1600;
const LIST_TTL = 10 * 60_000;

let library: { photos: PhotoInfo[]; at: number } | null = null;
let deck: PhotoInfo[] = [];
let timer: number | undefined;
let clockTimer: number | undefined;
let mounted = false;

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isPortrait = (p: PhotoInfo) => p.width > 0 && p.height > p.width * 1.05;

/** The next slide: one photo, or two portraits side by side. */
async function nextSlide(): Promise<PhotoInfo[]> {
  if (!library || Date.now() - library.at > LIST_TTL) {
    const res = await getJson<{ configured: boolean; photos: PhotoInfo[] }>('/api/photos');
    library = { photos: res.photos, at: Date.now() };
    const fresh = new Map(res.photos.map(p => [p.id, p]));
    // Drop deleted photos and pick up new captions, but keep our place in the deck.
    deck = deck.filter(p => fresh.has(p.id)).map(p => fresh.get(p.id)!);
  }
  if (!library.photos.length) return [];
  if (!deck.length) deck = shuffle(library.photos);
  const first = deck.shift()!;
  if (!isPortrait(first)) return [first];
  const partner = deck.findIndex(isPortrait);
  if (partner < 0) {
    // Nothing left to pair with in this round; borrow one from the library if there is one.
    const other = library.photos.find(p => isPortrait(p) && p.id !== first.id);
    return other ? [first, other] : [first];
  }
  return [first, ...deck.splice(partner, 1)];
}

const placeOf = (p: PhotoInfo) => p.caption ?? (p.collection && p.collection !== 'Photos' ? p.collection : '');

function dateOf(p: PhotoInfo, tz: string): string {
  if (!p.taken) return '';
  const d = new Date(p.taken);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function label(p: PhotoInfo, tz: string): string {
  return [placeOf(p), dateOf(p, tz)].filter(Boolean).join(' · ');
}

/** One caption for a whole slide: a shared place is said once ("St Ives · 3 May and 9 June 2024"). */
function slideLabel(slide: PhotoInfo[], tz: string): string {
  const places = [...new Set(slide.map(placeOf))];
  if (slide.length === 2 && places.length === 1) {
    const dates = [...new Set(slide.map(p => dateOf(p, tz)).filter(Boolean))];
    return [places[0], dates.join(' and ')].filter(Boolean).join(' · ');
  }
  return [...new Set(slide.map(p => label(p, tz)).filter(Boolean))].join('   ·   ');
}

/** Fills the screen when the photo is close to the screen's shape; otherwise shows it whole. */
function fills(p: PhotoInfo, screen: HTMLElement): boolean {
  if (!p.width || !p.height) return true;
  const ratio = p.width / p.height / (screen.clientWidth / Math.max(1, screen.clientHeight));
  return ratio > 0.8 && ratio < 1.35;
}

async function load(p: PhotoInfo): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.alt = '';
  img.src = `/api/photos/${p.id}`;
  await img.decode();
  return img;
}

function fillLayer(slide: PhotoInfo[], imgs: HTMLImageElement[], screen: HTMLElement): HTMLElement {
  if (slide.length === 2) {
    const layer = h('div', 'pf-layer pf-pair');
    imgs.forEach(img => { img.className = 'pf-img'; layer.append(h('div', 'pf-half')); layer.lastElementChild!.append(img); });
    return layer;
  }
  const [p] = slide;
  const [img] = imgs;
  const whole = !fills(p, screen);
  const layer = h('div', `pf-layer ${whole ? 'whole' : 'fill'}`);
  if (whole) {
    const backdrop = h('img', 'pf-backdrop');
    backdrop.src = img.src;
    backdrop.alt = '';
    layer.append(backdrop);
  }
  img.className = 'pf-img';
  layer.append(img);
  return layer;
}

function framedLayer(slide: PhotoInfo[], imgs: HTMLImageElement[], tz: string): HTMLElement {
  const layer = h('div', `pf-layer pf-wall${slide.length === 2 ? ' two' : ''}`);
  // The wall picks up the photo's colours, very dimly, so each print feels lit rather than pasted.
  const wash = h('img', 'pf-wash');
  wash.src = imgs[0].src;
  wash.alt = '';
  layer.append(wash);
  slide.forEach((p, i) => {
    const print = h('figure', `pf-print${isPortrait(p) ? ' portrait' : ''}`);
    const mount = h('div', 'pf-mount');
    imgs[i].className = 'pf-photo';
    mount.append(imgs[i]);
    print.append(mount);
    const text = label(p, tz);
    if (text) print.append(h('figcaption', 'pf-label', text));
    layer.append(print);
  });
  return layer;
}

export const photosScreen: Screen = {
  id: 'photos',
  title: 'Photos',
  durationSec: 90,
  isAvailable: config => config.features.photos,
  mount(el: HTMLElement, config: HubConfig) {
    mounted = true;
    const framed = config.photoStyle === 'framed';
    el.classList.add(framed ? 'pf-style-framed' : 'pf-style-fill');
    const frame = h('div', 'pf-frame');
    const caption = h('div', 'pf-caption');
    const time = h('div', 'pf-time');
    const when = h('div', 'pf-when');
    caption.append(time, when);
    el.append(frame, caption);

    const clock = () => { time.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date()); };
    clock();
    clockTimer = window.setInterval(clock, 10_000);

    const show = async () => {
      let slide: PhotoInfo[] = [];
      try { slide = await nextSlide(); } catch { slide = []; }
      if (!mounted) return;
      if (!slide.length) {
        frame.replaceChildren(h('div', 'pf-empty', 'No photos yet. Pick some in Setup → Photos.'));
        when.textContent = '';
        return;
      }

      let imgs: HTMLImageElement[];
      try {
        imgs = await Promise.all(slide.map(load));
      } catch {
        timer = window.setTimeout(show, 2000); // skip a slide that won't load
        return;
      }
      if (!mounted) return;

      const layer = framed ? framedLayer(slide, imgs, config.timezone) : fillLayer(slide, imgs, el);
      // Drift in a random direction, so consecutive photos don't all move the same way.
      layer.style.setProperty('--kx', `${(Math.random() * 2 - 1) * 2.5}%`);
      layer.style.setProperty('--ky', `${(Math.random() * 2 - 1) * 2}%`);
      layer.style.setProperty('--dur', `${PHOTO_MS + FADE_MS}ms`);
      frame.append(layer);
      requestAnimationFrame(() => layer.classList.add('in'));
      const old = [...frame.children].filter(c => c !== layer);
      window.setTimeout(() => old.forEach(o => o.remove()), FADE_MS + 100);

      // Framed prints carry their own labels; full-screen photos show theirs under the clock.
      when.textContent = framed ? '' : slideLabel(slide, config.timezone);
      timer = window.setTimeout(show, PHOTO_MS);
    };
    show();
  },
  unmount() {
    mounted = false;
    clearTimeout(timer);
    clearInterval(clockTimer);
  },
};
