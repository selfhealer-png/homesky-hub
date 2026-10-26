import type { SkyHome } from './location';

// Keeps the sky screens from ever being blank, and calm when they don't need to be busy.
//
// - The last good answer for each place is kept on this device, so the radar and board show
//   planes the moment they open (even after a restart) while a fresh answer loads.
// - Refreshing adapts: every 20 s while there are planes; quickly (3, 5, then 8 s) while there's
//   nothing yet, the last try failed, or only stale positions came back.

const PREFIX = 'hub.sky:';
const KEEP_MS = 12 * 3600_000;

const keyFor = (kind: string, home: SkyHome) => `${PREFIX}${kind}:${home.lat.toFixed(2)},${home.lon.toFixed(2)}`;

export function remember(kind: string, home: SkyHome, data: { fetchedAt: number }) {
  try { localStorage.setItem(keyFor(kind, home), JSON.stringify(data)); } catch { /* storage full or blocked: just not remembered */ }
}

export function recall<T extends { fetchedAt: number }>(kind: string, home: SkyHome): T | null {
  try {
    const raw = localStorage.getItem(keyFor(kind, home));
    if (!raw) return null;
    const data = JSON.parse(raw) as T;
    return Date.now() - data.fetchedAt < KEEP_MS ? data : null;
  } catch {
    return null;
  }
}

/** Sky data older than this is shown as old: the screen fades and says since when, plainly. */
export const STALE_MS = 10 * 60_000;
export const isStale = (fetchedAt: number) => Date.now() - fetchedAt > STALE_MS;

/** "updated 3 min ago" between a minute and STALE_MS; nothing when fresh, and nothing once the
 *  screen's own old-data note (watchAge) has taken over. */
export function ageLabel(fetchedAt: number): string | null {
  const s = (Date.now() - fetchedAt) / 1000;
  if (s < 60 || isStale(fetchedAt)) return null;
  return `updated ${Math.round(s / 60)} min ago`;
}

/**
 * Watches how old a sky screen's data is. Once it's older than STALE_MS the screen gets the
 * class "stale" (styles.css fades it) and a line at headline size saying since when, so a
 * glance never takes an hour-old landing time for a live one. Checks every 30 s, and whenever
 * check() is called after new data. onTick lets a screen redraw what depends on the time.
 */
export function watchAge(el: HTMLElement, timeZone: string, fetchedAt: () => number | null, onTick?: () => void) {
  const note = document.createElement('p');
  note.className = 'stale-note';
  note.setAttribute('role', 'status');
  el.append(note);
  const check = () => {
    const t = fetchedAt();
    const stale = t !== null && isStale(t);
    el.classList.toggle('stale', stale);
    note.textContent = stale
      ? `No new flight data since ${new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(t!)}. Still trying.`
      : '';
  };
  check();
  const timer = window.setInterval(() => { check(); onTick?.(); }, 30_000);
  return { check, stop: () => clearInterval(timer) };
}

export type Outcome = 'found' | 'empty' | 'failed';

const CALM_MS = 20_000;
const QUICK_MS = [3_000, 5_000, 8_000];

/** Runs a task again and again: calmly once it finds planes, quickly until it does. */
export class Refresher {
  private timer: number | undefined;
  private misses = 0;
  private stopped = false;

  constructor(private task: () => Promise<Outcome>) {}

  /** Runs now, then keeps going at the right pace. */
  async now() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const outcome = await this.task().catch((): Outcome => 'failed');
    if (this.stopped) return;
    this.misses = outcome === 'found' ? 0 : this.misses + 1;
    const wait = outcome === 'found' ? CALM_MS : QUICK_MS[Math.min(this.misses - 1, QUICK_MS.length - 1)];
    this.timer = window.setTimeout(() => this.now(), wait);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
