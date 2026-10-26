import './styles.css';
import type { HubConfig } from '../shared/types';
import { getJson, NotPairedError } from './api';
import { pickRotation } from '../shared/rotation';
import { flash, setCaption, type Screen } from './screen';
import { setMotionLevel } from './motion';
import { currentNight, startNight, updateNight } from './night';
import { showWelcome } from './welcome';
import { startKeepAwake } from './wakeLock';
import { airportScreen } from './screens/airport';
import { boardScreen } from './screens/board';
import { clockScreen } from './screens/clock';
import { homeScreen } from './screens/home';
import { photosScreen } from './screens/photos';
import { radarScreen } from './screens/radar';
import { rainScreen } from './screens/rain';
import { tonightScreen } from './screens/tonight';
import { weatherScreen } from './screens/weather';
import { wikiScreen } from './screens/wiki';

/** In the default order (SCREEN_IDS); the saved order in config.order rearranges them. */
const ALL_SCREENS: Screen[] = [homeScreen, weatherScreen, rainScreen, boardScreen, radarScreen, airportScreen, tonightScreen, clockScreen, photosScreen, wikiScreen];
/** The screens in rotation: those with something to show (no photo frame until there are photos). */
let screens: Screen[] = ALL_SCREENS;
const CONFIG_REFRESH_MS = 5 * 60_000;
/** An open menu closes itself after this long untouched, so it never sits on an unattended display. */
const MENU_IDLE_MS = 15_000;

const stage = document.getElementById('stage')!;
const dots = document.getElementById('dots')!;
const notice = document.getElementById('notice')!;

let config: HubConfig;
let index = 0;
/** The screen on the stage, which may have left the rotation since it was shown. */
let mounted: Screen | undefined;
let pinned = false;
let timer: number | undefined;
let offlineSince: Date | undefined;

function show(i: number) {
  mounted?.unmount();
  index = (i + screens.length) % screens.length;
  mounted = screens[index];
  stage.replaceChildren();
  const el = document.createElement('section');
  el.className = `screen screen-${screens[index].id}`;
  stage.append(el);
  // The shared strip along the bottom: what this is (the screen can say more) and the time,
  // on every screen that doesn't show the time itself.
  document.body.classList.toggle('own-clock', !!screens[index].ownClock);
  setCaption(screens[index].title);
  screens[index].mount(el, config);
  dots.querySelectorAll('button').forEach((b, n) => b.classList.toggle('active', n === index));
  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!pinned) timer = window.setTimeout(() => show(index + 1), screens[index].durationSec * 1000);
}

/** A screen someone chose (a tap or a dot), not the rotation: say which one it is. */
function showChosen(i: number) {
  show(i);
  flash(screens[index].title);
}

function setPinned(value: boolean) {
  pinned = value;
  document.body.classList.toggle('pinned', pinned);
  flash(pinned ? `Staying on ${screens[index].title}` : 'Rotating again');
  schedule();
}

function buildRotation() {
  const current = screens[index];
  // Switched-off screens leave; in quiet hours only the calm ones stay, plus a screen someone has pinned.
  screens = pickRotation(ALL_SCREENS, config, currentNight() === 'quiet', pinned ? current : undefined);
  index = Math.max(0, screens.indexOf(current));
  dots.replaceChildren();
  screens.forEach((s, n) => {
    const b = document.createElement('button');
    b.title = s.title;
    b.setAttribute('aria-label', s.title);
    b.classList.toggle('active', n === index);
    b.addEventListener('click', e => { e.stopPropagation(); showChosen(n); });
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

/** The strip along the bottom, either side of the dots: a caption on the left, the time on the right. */
function buildStrip() {
  const caption = document.createElement('div');
  caption.id = 'caption';
  const time = document.createElement('div');
  time.id = 'strip-time';
  const tick = () => { time.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date()); };
  tick();
  window.setInterval(tick, 10_000);
  document.body.append(caption, time);
}

function wireGestures() {
  buildRotation();
  buildStrip();

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
    if (x < 1 / 3) showChosen(index - 1);
    else if (x > 2 / 3) showChosen(index + 1);
    else {
      const changed = screens[index].onCenterTap?.();
      if (changed) flash(changed);
    }
  });
  stage.addEventListener('pointercancel', () => clearTimeout(pressTimer));
  // The long press is ours (pin), not the browser's menu.
  stage.addEventListener('contextmenu', e => e.preventDefault());
  // iOS Safari ignores user-scalable=no; its pinch gesture has to be cancelled here instead.
  document.addEventListener('gesturestart', e => e.preventDefault());
}

/** The long-press menu: the way into Settings from the display. */
function openMenu() {
  if (document.querySelector('.menu-scrim')) return;
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
    b.addEventListener('click', e => { e.stopPropagation(); close(); action(); });
    return b;
  };
  // Escape, a tap outside, or 15 seconds untouched all close it.
  let idle = window.setTimeout(close, MENU_IDLE_MS);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  function close() {
    clearTimeout(idle);
    document.removeEventListener('keydown', onKey);
    scrim.remove();
  }
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('pointerdown', () => { clearTimeout(idle); idle = window.setTimeout(close, MENU_IDLE_MS); });
  menu.append(
    title,
    item(pinned ? 'Carry on rotating' : 'Stay on this screen', () => setPinned(!pinned), true),
    // Straight to this screen's own settings page; Back there leads to the rest.
    item('Settings', () => { location.href = `/setup#/screens/${screens[index].id}`; }),
    item('Close', () => {}),
  );
  scrim.append(menu);
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
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
    offlineSince ??= new Date();
    notice.hidden = false;
    notice.textContent = `Can’t reach the hub since ${offlineSince.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Trying again every 15 seconds.`;
    setTimeout(start, 15000);
    return;
  }
  notice.hidden = true;
  offlineSince = undefined;
  setMotionLevel(config.motion);
  wireGestures();
  startKeepAwake();
  startNight(config, () => {
    buildRotation();
    if (mounted && screens[index] !== mounted) show(index);
  });
  show(index);
  window.setInterval(refreshConfig, CONFIG_REFRESH_MS);
}

// Picks up changes made in /setup (clock style, motion, places) without reloading the display.
async function refreshConfig() {
  try {
    const fresh = await getJson<HubConfig>('/api/config');
    const clockChanged = fresh.clock !== config.clock;
    const rotationChanged = JSON.stringify([fresh.features, fresh.airports, fresh.screensOff, fresh.order]) !== JSON.stringify([config.features, config.airports, config.screensOff, config.order]);
    Object.assign(config, fresh);
    setMotionLevel(config.motion);
    updateNight();
    if (rotationChanged) buildRotation();
    if (clockChanged && screens[index].id === 'clock') show(index);
  } catch {
    // Keep the current settings; try again next time.
  }
}

start();
