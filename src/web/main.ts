import './styles.css';
import type { HubConfig } from '../shared/types';
import { getJson, NotPairedError } from './api';
import type { Screen } from './screen';
import { setMotionLevel } from './motion';
import { showWelcome } from './welcome';
import { boardScreen } from './screens/board';
import { clockScreen } from './screens/clock';
import { homeScreen } from './screens/home';
import { photosScreen } from './screens/photos';
import { radarScreen } from './screens/radar';
import { weatherScreen } from './screens/weather';

const ALL_SCREENS: Screen[] = [homeScreen, weatherScreen, boardScreen, radarScreen, clockScreen, photosScreen];
/** The screens in rotation: those with something to show (no photo frame until there are photos). */
let screens: Screen[] = ALL_SCREENS;
const CONFIG_REFRESH_MS = 5 * 60_000;

const stage = document.getElementById('stage')!;
const dots = document.getElementById('dots')!;
const notice = document.getElementById('notice')!;

let config: HubConfig;
let index = 0;
let pinned = false;
let timer: number | undefined;

function show(i: number) {
  screens[index]?.unmount();
  index = (i + screens.length) % screens.length;
  stage.replaceChildren();
  const el = document.createElement('section');
  el.className = `screen screen-${screens[index].id}`;
  stage.append(el);
  screens[index].mount(el, config);
  dots.querySelectorAll('button').forEach((b, n) => b.classList.toggle('active', n === index));
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!pinned) timer = window.setTimeout(() => show(index + 1), screens[index].durationSec * 1000);
}

function setPinned(value: boolean) {
  pinned = value;
  document.body.classList.toggle('pinned', pinned);
  schedule();
}

function buildRotation() {
  const current = screens[index];
  screens = ALL_SCREENS.filter(s => s.isAvailable?.(config) ?? true);
  index = Math.max(0, screens.indexOf(current));
  dots.replaceChildren();
  screens.forEach((s, n) => {
    const b = document.createElement('button');
    b.title = s.title;
    b.setAttribute('aria-label', s.title);
    b.classList.toggle('active', n === index);
    b.addEventListener('click', e => { e.stopPropagation(); show(n); });
    dots.append(b);
  });
  // Always visible, so Settings never depends on knowing about the long press.
  const gear = document.createElement('button');
  gear.className = 'gear';
  gear.setAttribute('aria-label', 'Menu and settings');
  gear.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
  gear.addEventListener('click', e => { e.stopPropagation(); openMenu(); });
  dots.append(gear);
}

function wireGestures() {
  buildRotation();

  // Tap the left or right third to step; long-press anywhere for the menu (pin, settings).
  let pressTimer: number | undefined;
  let longPressed = false;
  stage.addEventListener('pointerdown', () => {
    longPressed = false;
    pressTimer = window.setTimeout(() => { longPressed = true; openMenu(); }, 700);
  });
  stage.addEventListener('pointerup', e => {
    clearTimeout(pressTimer);
    if (longPressed) return;
    const x = e.clientX / window.innerWidth;
    if (x < 1 / 3) show(index - 1);
    else if (x > 2 / 3) show(index + 1);
    else screens[index].onCenterTap?.();
  });
  stage.addEventListener('pointercancel', () => clearTimeout(pressTimer));
  // The long press is ours (pin), not the browser's menu.
  stage.addEventListener('contextmenu', e => e.preventDefault());
  // iOS Safari ignores user-scalable=no; its pinch gesture has to be cancelled here instead.
  document.addEventListener('gesturestart', e => e.preventDefault());
}

/** The long-press menu: the way into Settings from the display. */
function openMenu() {
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Display menu');
  const title = document.createElement('h2');
  title.textContent = screens[index].title;
  const item = (text: string, action: () => void, primary = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (primary) b.className = 'primary';
    b.addEventListener('click', e => { e.stopPropagation(); scrim.remove(); action(); });
    return b;
  };
  menu.append(
    title,
    item(pinned ? 'Carry on rotating' : 'Stay on this screen', () => setPinned(!pinned), true),
    item('Settings', () => { location.href = '/setup'; }),
    item('Close', () => {}),
  );
  scrim.append(menu);
  scrim.addEventListener('click', e => { if (e.target === scrim) scrim.remove(); });
  document.body.append(scrim);
  (menu.querySelector('button') as HTMLButtonElement).focus();
}

async function start() {
  try {
    config = await getJson<HubConfig>('/api/config');
  } catch (err) {
    if (err instanceof NotPairedError) {
      // Pair right here with the admin password (and get a welcome on a brand-new hub).
      showWelcome(notice, start);
      return;
    }
    notice.hidden = false;
    notice.textContent = 'Cannot reach the hub. Retrying…';
    setTimeout(start, 15000);
    return;
  }
  notice.hidden = true;
  setMotionLevel(config.motion);
  wireGestures();
  show(0);
  window.setInterval(refreshConfig, CONFIG_REFRESH_MS);
}

// Picks up changes made in /setup (clock style, motion, places) without reloading the display.
async function refreshConfig() {
  try {
    const fresh = await getJson<HubConfig>('/api/config');
    const clockChanged = fresh.clock !== config.clock;
    const rotationChanged = JSON.stringify(fresh.features) !== JSON.stringify(config.features);
    Object.assign(config, fresh);
    setMotionLevel(config.motion);
    if (rotationChanged) buildRotation();
    if (clockChanged && screens[index].id === 'clock') show(index);
  } catch {
    // Keep the current settings; try again next time.
  }
}

start();
