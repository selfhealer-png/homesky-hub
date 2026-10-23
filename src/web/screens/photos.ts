import type { HubConfig } from '../../shared/types';
import type { PhotoInfo } from '../../shared/settings';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// The photo frame. Photos crossfade with a slow drift ("Ken Burns"). A photo that doesn't
// suit the landscape screen (portrait, panorama) is shown whole over a blurred, darkened
// copy of itself rather than cropped. The deck is shuffled once and carries on where it left
// off each time the screen comes round, so the same few photos don't keep repeating.

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

async function nextPhoto(): Promise<PhotoInfo | null> {
  if (!library || Date.now() - library.at > LIST_TTL) {
    const res = await getJson<{ configured: boolean; photos: PhotoInfo[] }>('/api/photos');
    library = { photos: res.photos, at: Date.now() };
    const known = new Set(res.photos.map(p => p.id));
    deck = deck.filter(p => known.has(p.id)); // drop deleted ones, keep our place
  }
  if (!library.photos.length) return null;
  if (!deck.length) deck = shuffle(library.photos);
  return deck.shift()!;
}

/** Fills the screen when the photo is close to the screen's shape; otherwise shows it whole. */
function fills(p: PhotoInfo, screen: HTMLElement): boolean {
  if (!p.width || !p.height) return true;
  const photo = p.width / p.height;
  const view = screen.clientWidth / Math.max(1, screen.clientHeight);
  return photo / view > 0.8 && photo / view < 1.35;
}

function takenLabel(p: PhotoInfo, tz: string): string {
  if (!p.taken) return '';
  const d = new Date(p.taken);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long', year: 'numeric' }).format(d);
}

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

export const photosScreen: Screen = {
  id: 'photos',
  title: 'Photos',
  durationSec: 90,
  mount(el: HTMLElement, config: HubConfig) {
    mounted = true;
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
      let photo: PhotoInfo | null;
      try {
        photo = await nextPhoto();
      } catch {
        photo = null;
      }
      if (!mounted) return;
      if (!photo) {
        frame.replaceChildren(h('div', 'pf-empty', 'No photos yet. Pick some in Setup → Photos.'));
        when.textContent = '';
        return;
      }

      let img: HTMLImageElement;
      try {
        img = await load(`/api/photos/${photo.id}`);
      } catch {
        timer = window.setTimeout(show, 2000); // skip a photo that won't load
        return;
      }
      if (!mounted) return;

      const layer = h('div', `pf-layer${fills(photo, el) ? ' fill' : ' whole'}`);
      if (!layer.classList.contains('fill')) {
        const backdrop = h('img', 'pf-backdrop');
        backdrop.src = img.src;
        backdrop.alt = '';
        layer.append(backdrop);
      }
      img.className = 'pf-img';
      img.alt = '';
      // Drift in a random direction, so consecutive photos don't all move the same way.
      layer.style.setProperty('--kx', `${(Math.random() * 2 - 1) * 2.5}%`);
      layer.style.setProperty('--ky', `${(Math.random() * 2 - 1) * 2}%`);
      layer.style.setProperty('--dur', `${PHOTO_MS + FADE_MS}ms`);
      layer.append(img);
      frame.append(layer);

      requestAnimationFrame(() => layer.classList.add('in'));
      const old = [...frame.children].filter(c => c !== layer);
      window.setTimeout(() => old.forEach(o => o.remove()), FADE_MS + 100);
      when.textContent = takenLabel(photo, config.timezone);
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
