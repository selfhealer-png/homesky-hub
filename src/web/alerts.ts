import { approaching, classify, compassWord, shouldAlert, typeName, whereToLook, type Notable } from '../shared/notable';
import type { Aircraft, AircraftResponse, HubConfig } from '../shared/types';
import { getJson } from './api';
import { skyHome, skyQuery } from './location';
import { currentNight } from './night';
import { NOTABLE_LABEL, openPlane } from './planeCard';
import { h } from './screen';

// Alerts: a banner over any screen when something worth looking up for comes into range: an
// emergency, a rare aircraft, or (if chosen in /setup) military and special operators. It says
// where to look, a tap opens the plane card, and each aircraft alerts only once in a while.
// Nothing alerts in quiet hours, and the chime (off unless chosen) never sounds after sunset.

const CHECK_MS = 30_000;
const SHOWN_MS = 90_000;
/** The same aircraft doesn't alert again for this long, even after the display reloads. */
const AGAIN_MS = 6 * 3600_000;
const SEEN_KEY = 'hub.alerted';

const RANK: Record<Notable['kind'], number> = { emergency: 0, rare: 1, military: 2, special: 3 };

let config: HubConfig;
let banner: HTMLElement | undefined;
let shownKind: Notable['kind'] | undefined;
let hideTimer: number | undefined;
let audio: AudioContext | undefined;

function loadSeen(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
    return new Map(Object.entries(raw).filter(([, at]) => Date.now() - at < AGAIN_MS));
  } catch {
    return new Map();
  }
}
const seen = loadSeen();

function remember(hex: string) {
  seen.set(hex, Date.now());
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seen))); } catch { /* private mode: remembered until reload */ }
}

export function startAlerts(hub: HubConfig) {
  config = hub;
  // Browsers only let a page make a sound once someone has touched it; the first touch unlocks it.
  document.addEventListener('pointerdown', () => {
    if (!audio && 'AudioContext' in window) audio = new AudioContext();
    audio?.resume().catch(() => {});
  }, { capture: true, passive: true });
  window.setTimeout(check, 5000);
  window.setInterval(check, CHECK_MS);
}

async function check() {
  // config is the live object main.ts refreshes, so a change in /setup applies on the next check.
  if (config.alerts === 'off' || currentNight() === 'quiet' || document.hidden) return;
  let data: AircraftResponse;
  try {
    data = await getJson<AircraftResponse>(`/api/aircraft?${skyQuery(await skyHome(config))}`);
  } catch {
    return;
  }
  if (data.stale) return;
  const pick = data.aircraft
    .filter(a => a.altFt !== null && !seen.has(a.hex))
    .map(a => [a, classify(a)] as const)
    .filter((p): p is readonly [Aircraft, Notable] => shouldAlert(p[1], config.alerts))
    .sort(([a, n], [b, m]) => RANK[n.kind] - RANK[m.kind] || a.distanceNm - b.distanceNm)[0];
  if (!pick) return;
  const [a, n] = pick;
  // One at a time: only an emergency takes over a banner that's already up.
  if (banner && !(n.kind === 'emergency' && shownKind !== 'emergency')) return;
  remember(a.hex);
  show(a, n);
}

function show(a: Aircraft, n: Notable) {
  hide();
  const el = h('button', `alert alert-${n.kind}`);
  el.type = 'button';
  el.setAttribute('role', 'alert');
  const title = n.kind === 'rare' || n.kind === 'emergency' ? n.title : typeName(a.desc) ?? a.type ?? `${NOTABLE_LABEL[n.kind]} aircraft`;
  const where = [
    a.callsign ?? a.registration,
    `${(a.distanceNm * 1.852).toFixed(a.distanceNm < 5 ? 1 : 0)} km ${compassWord(a.bearingDeg)}`,
    a.altFt !== null ? `${a.altFt.toLocaleString('en-GB')} ft` : null,
    approaching(a) ? 'heading this way' : null,
  ].filter(Boolean).join(' · ');
  const text = h('span', 'alert-text');
  text.append(h('b', undefined, title), h('span', undefined, where));
  const look = whereToLook(a);
  el.append(h('span', 'alert-tag', NOTABLE_LABEL[n.kind]), text);
  if (look) el.append(h('span', 'alert-look', look));
  const dismiss = h('span', 'alert-close');
  dismiss.setAttribute('role', 'button');
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  el.append(dismiss);
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', e => {
    e.stopPropagation();
    hide();
    if (e.target !== dismiss) openPlane(a.hex, config, a);
  });
  document.body.append(el);
  banner = el;
  shownKind = n.kind;
  requestAnimationFrame(() => el.classList.add('on'));
  hideTimer = window.setTimeout(hide, SHOWN_MS);
  if (config.alertSound && currentNight() === 'day') chime(n.kind === 'emergency');
}

function hide() {
  clearTimeout(hideTimer);
  banner?.remove();
  banner = shownKind = undefined;
}

/** Two soft notes, rising; three for an emergency. */
function chime(urgent: boolean) {
  if (!audio || audio.state !== 'running') return;
  const notes = urgent ? [660, 880, 660] : [587, 880];
  notes.forEach((f, i) => {
    const t = audio!.currentTime + i * 0.22;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}
