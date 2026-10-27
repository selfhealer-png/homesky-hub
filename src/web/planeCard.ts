import { minutesToGo } from '../shared/arrivals';
import { approaching, classify, compassWord, typeName, whereToLook, type Notable } from '../shared/notable';
import type { Aircraft, HubConfig, PlaneDetail } from '../shared/types';
import { getJson } from './api';
import { skyHome, skyQuery } from './location';
import { h } from './screen';

// The plane card: everything known about one aircraft, over whatever screen is showing. Opened
// by tapping a plane (on the radar, or from the menu on the sky screens) or an alert. It starts
// from what the screen already knows and fills in from /api/plane, then keeps the live figures
// fresh while it's open. Like the menu, it closes itself when left alone.

const REFRESH_MS = 10_000;
const IDLE_MS = 60_000;

const num = (n: number) => Math.round(n).toLocaleString('en-GB');

const CATEGORY: Record<string, string> = {
  A1: 'Light aircraft', A2: 'Small aircraft', A3: 'Airliner', A4: 'Large airliner', A5: 'Heavy',
  A6: 'High performance', A7: 'Helicopter', B1: 'Glider', B2: 'Balloon or airship', B4: 'Microlight',
  B6: 'Drone', B7: 'Spacecraft',
};

/** How the position was found (readsb's message types, without their _icao/_other ending). */
const POSITION_SOURCE: Record<string, string> = {
  adsb: 'ADS-B, sent by the aircraft',
  adsr: 'ADS-B, relayed by a ground station',
  mlat: 'MLAT, worked out by ground receivers',
  tisb: 'TIS-B, from air traffic radar',
  adsc: 'ADS-C, by satellite',
  mode_s: 'Mode S only',
};

/** The autopilot's modes in words; air traffic avoidance (tcas) is always on, so it's left out. */
const NAV_MODE: Record<string, string> = {
  althold: 'holding height',
  vnav: 'managing its climb and descent',
  lnav: 'following its route',
  approach: 'flying the approach',
};

/** What the autopilot is set to: on or off, the height and heading dialled in, and its modes. */
function autopilot(modes: string[] | null, targetFt: number | null, headingDeg: number | null): string | null {
  const parts: string[] = [];
  // Only aircraft that send their modes say whether it's engaged at all.
  if (modes) parts.push(modes.includes('autopilot') ? 'On' : 'Not engaged');
  if (targetFt != null && targetFt > 0) parts.push(`set to ${num(targetFt)} ft`);
  if (headingDeg != null) parts.push(`heading ${Math.round(headingDeg)}°`);
  for (const m of modes ?? []) if (NAV_MODE[m]) parts.push(NAV_MODE[m]);
  if (!parts.length) return null;
  const text = parts.join(' · ');
  return text[0].toUpperCase() + text.slice(1);
}

/** Bank angle: readsb's roll is negative with the left wing down. */
function bank(rollDeg: number | null): string | null {
  if (rollDeg == null) return null;
  if (Math.abs(rollDeg) < 2) return 'Wings level';
  return `${Math.round(Math.abs(rollDeg))}°, turning ${rollDeg < 0 ? 'left' : 'right'}`;
}

export const NOTABLE_LABEL: Record<Notable['kind'], string> = { emergency: 'Emergency', rare: 'Rare', military: 'Military', special: 'Special' };

let closeOpen: (() => void) | undefined;

/** Opens the card for one aircraft; `known` is what the screen already has, shown straight away. */
export function openPlane(hex: string, config: HubConfig, known?: Aircraft | null) {
  closeOpen?.();
  const scrim = h('div', 'plane-scrim');
  const card = h('div', 'plane-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'About this plane');
  const close = h('button', 'plane-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const body = h('div', 'plane-body');
  card.append(close, body);
  scrim.append(card);
  document.body.append(scrim);

  let detail: PlaneDetail | null = null;
  let timer: number | undefined;
  let idle = window.setTimeout(shut, IDLE_MS);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
  function shut() {
    clearTimeout(idle);
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    if (closeOpen === shut) closeOpen = undefined;
  }
  closeOpen = shut;
  document.addEventListener('keydown', onKey);
  close.addEventListener('click', e => { e.stopPropagation(); shut(); });
  scrim.addEventListener('click', e => { if (e.target === scrim) shut(); });
  scrim.addEventListener('pointerdown', () => { clearTimeout(idle); idle = window.setTimeout(shut, IDLE_MS); });

  const draw = () => body.replaceChildren(...render(config, hex, detail, known ?? null));
  draw();
  close.focus();

  const load = async () => {
    try {
      const home = await skyHome(config);
      const fresh = await getJson<PlaneDetail>(`/api/plane?hex=${encodeURIComponent(hex)}&${skyQuery(home)}`);
      if (!scrim.isConnected) return;
      // Out of reach of the feeds now: keep the last live figures rather than blanking them.
      detail = fresh.aircraft || !detail ? fresh : { ...fresh, aircraft: detail.aircraft, route: detail.route };
      draw();
    } catch {
      // What's on the card stays; the next refresh may get through.
    }
    if (scrim.isConnected) timer = window.setTimeout(load, REFRESH_MS);
  };
  load();
}

function render(config: HubConfig, hex: string, d: PlaneDetail | null, known: Aircraft | null): Node[] {
  const a = d?.aircraft ?? known;
  if (!a) return [h('p', 'plane-loading', d ? 'This aircraft is out of range of the feeds now.' : 'Looking it up…')];
  const r = d?.route ?? null;
  const notable = classify(a);
  const type = typeName(a.desc) ?? a.type;

  // Who: the flight, the airline and the aircraft.
  const head = h('header', 'plane-head');
  if (notable) {
    const tag = h('span', `plane-tag tag-${notable.kind}`, NOTABLE_LABEL[notable.kind]);
    head.append(tag);
  }
  if (r?.airline?.iata) {
    const logo = h('img', 'plane-logo');
    logo.alt = '';
    logo.src = `/api/logo/${encodeURIComponent(r.airline.iata)}`;
    logo.addEventListener('error', () => logo.remove());
    head.append(logo);
  }
  head.append(h('h2', undefined, r?.flightNumber ?? a.callsign ?? a.registration ?? hex.toUpperCase()));
  const who = [r?.airline?.name, notable?.kind === 'rare' ? notable.title : type].filter(Boolean).join(' · ');
  if (who) head.append(h('p', 'plane-who', who));
  if (notable?.kind === 'emergency') head.append(h('p', 'plane-alarm', notable.title));
  const age = d?.year ? new Date().getFullYear() - d.year : null;
  const facts = [
    a.registration && d?.country ? `${a.registration} (${d.country})` : a.registration,
    // The owner, unless it only repeats the airline ("easyJet Airline" under easyJet).
    d?.operator && !(r?.airline && d.operator.toLowerCase().startsWith(r.airline.name.toLowerCase().split(' ')[0])) ? d.operator : null,
    d?.year ? `built ${d.year}${age && age > 1 ? ` (${age} years old)` : ''}` : null,
    d?.category && CATEGORY[d.category] && notable?.kind !== 'rare' ? CATEGORY[d.category] : null,
  ].filter(Boolean);
  if (facts.length) head.append(h('p', 'plane-facts', facts.join(' · ')));

  // Where: in the sky from here, and along its route.
  const look = whereToLook(a);
  const where = h('p', 'plane-look', [look, approaching(a) ? 'heading this way' : null].filter(Boolean).join(' · ') || 'Below the horizon from here');

  const parts: Node[] = [head, where];
  if (r) {
    const leg = h('div', 'plane-leg');
    leg.append(
      h('b', undefined, `${r.origin.iata || r.origin.icao} → ${r.destination.iata || r.destination.icao}`),
      h('span', undefined, `${r.origin.name}, ${r.origin.city} to ${r.destination.name}, ${r.destination.city}`),
    );
    const bar = h('div', 'plane-progress');
    bar.style.setProperty('--p', `${Math.round(r.progress * 100)}%`);
    const togo = minutesToGo(r.remainingKm, a);
    const lands = togo !== null
      ? ` · lands about ${new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date((d?.fetchedAt ?? Date.now()) + togo * 60_000))}`
      : '';
    leg.append(bar, h('small', undefined, `${num(r.flownKm)} km flown · ${num(r.remainingKm)} km to go${lands}`));
    parts.push(leg);
  }

  // How: height, speed and what the aircraft says about itself.
  const stats = h('dl', 'plane-stats');
  const stat = (label: string, value: string | null) => {
    if (!value) return;
    const row = h('div');
    row.append(h('dt', undefined, label), h('dd', undefined, value));
    stats.append(row);
  };
  const live = d?.live;
  const vs = a.verticalRateFpm;
  // The autopilot reports it in 16 ft steps (15,008); it was set to a round number.
  const target = live?.selectedAltFt != null ? Math.round(live.selectedAltFt / 100) * 100 : null;
  const heading = a.altFt !== null && target != null && Math.abs(target - a.altFt) > 400 ? `, ${target > a.altFt ? 'climbing' : 'descending'} to ${num(target)}` : '';
  stat('Altitude', a.altFt === null ? 'On the ground' : `${num(a.altFt)} ft${heading}`);
  stat('Climb', vs != null && Math.abs(vs) >= 100 ? `${vs > 0 ? '+' : '−'}${num(Math.abs(vs))} ft/min` : a.altFt !== null ? 'Level' : null);
  stat('Speed', a.groundSpeedKt != null ? `${num(a.groundSpeedKt * 1.852)} km/h over the ground` : null);
  stat('Airspeed', live?.mach != null && live.mach >= 0.4 ? `Mach ${live.mach.toFixed(2)}` : live?.iasKt != null ? `${num(live.iasKt)} kt` : null);
  stat('Heading', a.trackDeg != null ? `${Math.round(a.trackDeg)}° ${compassWord(a.trackDeg)}` : null);
  if (a.altFt !== null) {
    stat('Autopilot', autopilot(live?.navModes ?? null, target, live?.selectedHeadingDeg ?? null));
    stat('Bank', bank(live?.rollDeg ?? null));
  }
  stat('Position', d?.positionSource ? POSITION_SOURCE[d.positionSource.replace(/_(icao(_nt)?|other|trackfile)$/, '')] ?? null : null);
  stat('From you', Number.isFinite(a.distanceNm) ? `${(a.distanceNm * 1.852).toFixed(a.distanceNm < 5 ? 1 : 0)} km ${compassWord(a.bearingDeg)}` : null);
  stat('Outside', live?.outsideTempC != null ? `${String(Math.round(live.outsideTempC)).replace('-', '−')} °C${live.windKt != null && live.windFromDeg != null ? `, wind from the ${compassWord(live.windFromDeg)} at ${num(live.windKt * 1.852)} km/h` : ''}` : null);
  stat('Squawk', a.squawk);
  parts.push(stats);

  const main = h('div', 'plane-main');
  main.append(...parts);
  const out: Node[] = [main];

  // What: a few lines about the type, from Wikipedia.
  // A photo of this very aircraft if there is one, else one of the type.
  const art = d?.article;
  const photo = d?.photo ?? art?.image?.url;
  if (art || photo) {
    const about = h('aside', 'plane-about');
    if (photo && config.wikiPictures) {
      const img = h('img', 'plane-photo');
      img.alt = d?.photo ? `This aircraft${a.registration ? `, ${a.registration}` : ''}` : art?.title ?? '';
      img.src = photo;
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      about.append(img);
      if (d?.photo) about.append(h('small', 'plane-credit', 'Photo: airport-data.com'));
    }
    if (art) about.append(h('h3', undefined, art.title), h('p', undefined, art.extract), h('small', 'plane-credit', 'From Wikipedia, CC BY-SA'));
    out.push(about);
  }

  const sources = [d?.source && `Positions: ${d.source}`, (r || d?.country) && 'aircraft and route: adsbdb'].filter(Boolean).join(' · ');
  out.push(h('footer', 'plane-foot', [hex.toUpperCase(), sources].filter(Boolean).join(' · ')));
  return out;
}
