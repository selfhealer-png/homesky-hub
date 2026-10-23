import './styles.css';
import type { HubConfig } from '../shared/types';
import { getJson, NotPairedError } from './api';
import type { Screen } from './screen';
import { setMotionLevel } from './motion';
import { boardScreen } from './screens/board';
import { clockScreen } from './screens/clock';
import { homeScreen } from './screens/home';
import { photosScreen } from './screens/photos';
import { radarScreen } from './screens/radar';
import { weatherScreen } from './screens/weather';

const screens: Screen[] = [homeScreen, weatherScreen, boardScreen, radarScreen, clockScreen, photosScreen];
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

function wireGestures() {
  screens.forEach((s, n) => {
    const b = document.createElement('button');
    b.title = s.title;
    b.addEventListener('click', e => { e.stopPropagation(); show(n); });
    dots.append(b);
  });

  // Tap the left or right third to step; long-press anywhere to pin or unpin the current screen.
  let pressTimer: number | undefined;
  let longPressed = false;
  stage.addEventListener('pointerdown', () => {
    longPressed = false;
    pressTimer = window.setTimeout(() => { longPressed = true; setPinned(!pinned); }, 700);
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

async function start() {
  try {
    config = await getJson<HubConfig>('/api/config');
  } catch (err) {
    notice.hidden = false;
    notice.textContent = err instanceof NotPairedError
      ? 'This display is not paired yet. Open the pairing link on this device.'
      : 'Cannot reach the hub. Retrying…';
    if (!(err instanceof NotPairedError)) setTimeout(start, 15000);
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
    Object.assign(config, fresh);
    setMotionLevel(config.motion);
    if (clockChanged && screens[index].id === 'clock') show(index);
  } catch {
    // Keep the current settings; try again next time.
  }
}

start();
