import { devicePosition } from '../native';
import { ALERT_LEVELS, DEFAULT_ALERTS, type AlertLevel } from '../../shared/notable';
import { cleanFollow, DEFAULT_RADAR_MAP, isFollow, RADAR_MAPS, RADIUS_CHOICES, type Place, type RadarMap, type SavedAirport } from '../../shared/settings';
import { km, placeName, saveSky, skySettings } from './store';
import { busy, card, h, input, iosSwitch, pageHead, quietly, row, segmented, svg, toast } from './ui';

// Places (shared by every screen that uses a location), the radar's range and map, and airports.

export function placesPage() {
  const sky = skySettings();
  const list = h('div', { class: 'places', role: 'radiogroup', 'aria-label': 'Centre the screens on' });
  // The place in use, worked out as placeName() does: an unknown id falls back to the first place, or the device.
  const inUse = sky.active === 'device' || sky.places.some(p => p.id === sky.active) ? sky.active : sky.places[0]?.id ?? 'device';
  const option = (id: string, title: string, sub: string, removable: boolean) => {
    const radio = h('input', { type: 'radio', name: 'sky-active', value: id, checked: inUse === id });
    radio.addEventListener('change', () => quietly(saveSky({ ...sky, active: id })));
    const r = h('div', { class: 'place' }, h('label', { class: 'gcheck' }, radio, h('span', {}, h('b', {}, title), h('small', {}, sub))));
    if (removable) {
      const remove = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove');
      remove.addEventListener('click', () => busy(remove, () => saveSky({ ...sky, places: sky.places.filter(p => p.id !== id) }, 'Removed.')));
      r.append(remove);
    }
    return r;
  };
  for (const p of sky.places) list.append(option(p.id, p.name, `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`, true));
  list.append(option('device', 'Each display’s own location', 'Uses the tablet’s GPS or Wi-Fi location. The tablet asks permission the first time.', false));
  if (!sky.places.length) list.prepend(h('p', { class: 'empty' }, 'No places saved yet, so each display uses its own location, or roughly where its internet connection is.'));

  // The first place saved becomes the active one.
  const add = (p: Omit<Place, 'id'>) => saveSky({ ...sky, places: [...sky.places, { id: '', ...p }], active: sky.places.length ? sky.active : '' }, `${p.name} added.`);
  const { form, results } = placeSearch(add);
  const here = h('button', { type: 'button', class: 'ghost' }, 'Use where I am now');
  here.addEventListener('click', () => {
    here.disabled = true;
    void devicePosition(15_000, 0).then(pos => {
      here.disabled = false;
      if (!pos) return toast('Location permission was refused or unavailable.', 'error');
      const name = prompt('Name for this place', 'Home')?.trim();
      if (name) busy(here, () => add({ name: name.slice(0, 40), lat: pos.lat, lon: pos.lon }));
    });
  });

  return [
    pageHead('Places', 'Weather, the rain map, Overhead, Flight radar and Tonight all use this location. On the display, tap the middle of the radar to step through your places.'),
    card('Centre on', list),
    card('Add a place', form, results, h('div', { class: 'buttons' }, here),
      h('p', { class: 'hint' }, 'Places are rounded to about 1 km. That’s plenty for a radar, and your exact address is never stored.')),
  ];
}

/** A search for a town or city (Open-Meteo's geocoding); picking a result calls onPick. */
function placeSearch(onPick: (p: Omit<Place, 'id'>) => Promise<void>, placeholder = 'Town, city or postcode') {
  const query = input({ type: 'text', placeholder, 'aria-label': 'Search for a place' });
  const search = h('button', { type: 'submit', class: 'ghost' }, 'Search');
  const results = h('div', { class: 'results' });
  const form = h('form', { class: 'searchrow' }, query, search);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!query.value.trim()) return;
    busy(search, async () => {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(query.value.trim())}`).then(r => r.json()).catch(() => null);
      const found: Array<{ name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; country?: string }> = res?.results ?? [];
      results.replaceChildren(...(found.length ? found.map(r => {
        const label = [r.name, r.admin2 ?? r.admin1, r.country].filter(Boolean).join(', ');
        const b = h('button', { type: 'button', class: 'choice' }, h('b', {}, r.name), h('small', {}, label));
        b.addEventListener('click', () => { results.replaceChildren(); query.value = ''; busy(search, () => onPick({ name: r.name, lat: r.latitude, lon: r.longitude })); });
        return b;
      }) : [h('p', { class: 'empty' }, 'No matches. Try a nearby town.')]));
    });
  });
  return { form, results };
}

/** "Location: Home ›", for the pages of screens that use the hub's place. */
export function locationRow() {
  return card(null, row({ icon: h('span', { class: 'rowicon' }, svg('<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>')), title: 'Location', summary: placeName(), href: '#/places' }),
    h('p', { class: 'hint' }, 'Shared by every screen that uses a location. Changing it here changes them all.'));
}

export function rangeCard(sharedWith: string) {
  const sky = skySettings();
  return card('Range',
    segmented('sky-radius', 'Range', RADIUS_CHOICES.map(nm => [nm, km(nm)] as [number, string]), sky.radiusNm,
      radiusNm => quietly(saveSky({ ...sky, radiusNm }))),
    h('p', { class: 'hint' }, `46 km suits most places. Near a big airport, 19 or 28 km keeps the radar calm. Also used by ${sharedWith}.`));
}

export const MAP_LABELS: Record<RadarMap, string> = { plain: 'Plain', map: 'Map', satellite: 'Satellite' };

export function mapCard() {
  const sky = skySettings();
  return card('Map',
    segmented('sky-map', 'Radar background', RADAR_MAPS.map(m => [m, MAP_LABELS[m]] as [RadarMap, string]), sky.map ?? DEFAULT_RADAR_MAP,
      map => quietly(saveSky({ ...sky, map }))),
    h('p', { class: 'hint' }, 'A street map or satellite view under the radar shows where the planes are. Satellite and Plain are labelled with nearby towns. Each display can also switch its own from the radar screen. Maps: OpenStreetMap; satellite: Sentinel-2 cloudless by EOX; town names: GeoNames.'));
}

/** [icao, iata, name, city, country, lat, lon], biggest airports first (scripts/build-airports.mjs). */
type AirportRow = [string, string, string, string, string, number, number, string?];
let airportList: Promise<AirportRow[]> | null = null;

function searchAirports(list: AirportRow[], q: string): AirportRow[] {
  const query = q.trim().toLowerCase();
  const code = query.toUpperCase();
  const exact = list.filter(a => a[0] === code || a[1] === code);
  const named = list.filter(a => !exact.includes(a) && (a[2].toLowerCase().includes(query) || a[3].toLowerCase().includes(query)));
  return [...exact, ...named].slice(0, 6);
}

export const airportCodes = () => (skySettings().airports ?? []).map(a => a.iata || a.icao);

export function airportCards(): Node[] {
  const sky = skySettings();
  // Hubs set up when several were allowed keep the first.
  const airport = sky.airports?.[0] ?? null;
  const save = (next: SavedAirport[], message: string) => saveSky({ ...sky, airports: next }, message);

  const yours = h('div', { class: 'places' });
  if (airport) {
    const remove = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove');
    remove.addEventListener('click', () => busy(remove, () => save([], `${airport.city} removed.`)));
    yours.append(h('div', { class: 'place' },
      h('span', { class: 'gcheck' }, h('span', {}, h('b', {}, `${airport.city} ${airport.iata || airport.icao}`), h('small', {}, airport.name))),
      h('span', { class: 'actions' }, remove)));
  } else {
    yours.append(h('p', { class: 'empty' }, 'No airport yet. Choose one below and the board joins the rotation.'));
  }

  const query = input({ type: 'text', placeholder: 'Airport, city or code (e.g. MAN)', 'aria-label': 'Search for an airport', id: 'airport-search' });
  const search = h('button', { type: 'submit', class: 'ghost' }, 'Search');
  const results = h('div', { class: 'results' });
  const form = h('form', { class: 'searchrow' }, query, search);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (query.value.trim().length < 2) return;
    busy(search, async () => {
      airportList ??= fetch('/airports.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`airports.json answered ${r.status}`))));
      const found = searchAirports(await airportList.catch(err => { airportList = null; throw err; }), query.value);
      results.replaceChildren(...(found.length ? found.map(([icao, iata, name, city, country, lat, lon]) => {
        const b = h('button', { type: 'button', class: 'choice' }, h('b', {}, `${city || name} ${iata || icao}`), h('small', {}, `${name}, ${country}`));
        b.addEventListener('click', () => {
          results.replaceChildren();
          query.value = '';
          if (airport?.icao === icao) return toast('That’s already your airport.');
          busy(search, () => save([{ icao, iata, name, city: city || name, lat, lon }], `${city || name} chosen.`));
        });
        return b;
      }) : [h('p', { class: 'empty' }, 'No airport with scheduled flights matches. Try its city or three-letter code.')]));
    });
  });
  return [card('Your airport', yours), card(airport ? 'Change airport' : 'Choose an airport', form, results,
    h('p', { class: 'hint' }, 'The board shows its arrivals and departures together, for flights within 100 nm of it. Airports: OurAirports. Flights come from the same open ADS-B data as the radar, with routes from adsbdb, so only flights already in the air or taxiing are shown, and arrival times are estimates.'))];
}

// ── Flight tracker ──────────────────────────────────────────────────────────

export function followCard() {
  const sky = skySettings();
  const flight = input({ type: 'text', placeholder: 'BA117, BAW117, G-XLEA or 4CA8B1', 'aria-label': 'Flight to follow', value: sky.follow ?? '', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
  const save = h('button', { type: 'submit' }, 'Follow');
  const form = h('form', { class: 'searchrow' }, flight, save);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const follow = cleanFollow(flight.value);
    if (follow && !isFollow(follow)) return toast('That doesn’t look like a flight number, callsign, registration or hex code.', 'error');
    busy(save, () => saveSky({ ...sky, follow }, follow ? `Following ${follow}. The display picks it up within five minutes.` : 'Not following a flight.'));
  });
  const stop = h('button', { type: 'button', class: 'ghost danger' }, 'Stop following');
  stop.addEventListener('click', () => busy(stop, () => saveSky({ ...sky, follow: '' }, 'Not following a flight. The screen leaves the rotation.')));
  return card('Flight', form, sky.follow ? h('div', { class: 'buttons' }, stop) : null,
    h('p', { class: 'hint' }, 'A flight number (BA117), a callsign (BAW117), a registration (G-XLEA) or the aircraft’s ICAO hex code (4CA8B1). Flight numbers become callsigns the way most airlines use them; if one doesn’t show up, try its callsign from a flight-tracking site.'),
    h('p', { class: 'hint' }, 'The screen joins the rotation once a flight is chosen. When it passes within range, the Overhead board shows it before any other plane. Positions: the same open ADS-B data as the radar; routes: adsbdb.'));
}

// ── Tides ───────────────────────────────────────────────────────────────────

export const tidePlaceName = () => skySettings().tidePlace?.name ?? null;

export function tideCards(): Node[] {
  const sky = skySettings();
  const pick = (p: Omit<Place, 'id'>) => saveSky({ ...sky, tidePlace: { id: 'tide', ...p } }, `Tides for ${p.name}. The display picks it up within five minutes.`);
  const current = sky.tidePlace;
  const yours = card('Tides for', current
    ? h('div', { class: 'places' }, h('div', { class: 'place' }, h('span', { class: 'gcheck' }, h('span', {}, h('b', {}, current.name), h('small', {}, `${current.lat.toFixed(2)}, ${current.lon.toFixed(2)}`)))))
    : h('p', { class: 'empty' }, 'No place chosen yet. Tides need a place by the sea; inland there are none to show.'));
  const { form, results } = placeSearch(pick, 'Harbour, beach or seaside town');
  const saved = sky.places.map(p => {
    const b = h('button', { type: 'button', class: 'choice' }, h('b', {}, p.name), h('small', {}, 'One of your places'));
    b.addEventListener('click', () => busy(b, () => pick({ name: p.name, lat: p.lat, lon: p.lon })));
    return b;
  });
  return [yours, card('Choose a place', form, results, saved.length ? h('div', { class: 'results' }, ...saved) : null,
    h('p', { class: 'hint' }, 'Choose somewhere right on the coast. Tides come from Open-Meteo’s global marine model, as height above or below mean sea level: good for when the tide turns, but not a harbour tide table, and not for navigation.'))];
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export function alertsCard() {
  const sky = skySettings();
  return card('Alerts',
    segmented('sky-alerts', 'Alerts', ALERT_LEVELS.map(l => [l, ALERT_LABELS[l]] as [AlertLevel, string]), sky.alerts ?? DEFAULT_ALERTS,
      alerts => quietly(saveSky({ ...sky, alerts }))),
    h('label', { class: 'gcheck' }, iosSwitch(sky.alertSound ?? false, 'Chime with each alert', alertSound => saveSky({ ...sky, alertSound })), h('span', {}, 'Chime with each alert')),
    h('p', { class: 'hint' }, 'A banner over any screen when something worth looking up for comes into range: an emergency, a rare aircraft (a Beluga, a B-52, a Spitfire), or, if you choose, military and special operators such as police and air ambulances. It says where to look; tap it for the plane’s details. Each aircraft alerts once every six hours, nothing alerts in quiet hours, and the chime never sounds after sunset.'));
}

const ALERT_LABELS: Record<AlertLevel, string> = { off: 'Off', rare: 'Rare and emergencies', all: 'Also military' };
