import { DEFAULT_RADAR_MAP, MAX_AIRPORTS, RADAR_MAPS, RADIUS_CHOICES, type Place, type RadarMap, type SavedAirport } from '../../shared/settings';
import { km, placeName, saveSky, skySettings } from './store';
import { busy, card, h, input, pageHead, quietly, row, segmented, svg, toast } from './ui';

// Places (shared by every screen that uses a location), the radar's range and map, and airports.

export function placesPage() {
  const sky = skySettings();
  const list = h('div', { class: 'places', role: 'radiogroup', 'aria-label': 'Centre the screens on' });
  const option = (id: string, title: string, sub: string, removable: boolean) => {
    const radio = h('input', { type: 'radio', name: 'sky-active', value: id, checked: sky.active === id });
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

  const query = input({ type: 'text', placeholder: 'Town, city or postcode', 'aria-label': 'Search for a place' });
  const search = h('button', { type: 'submit', class: 'ghost' }, 'Search');
  const results = h('div', { class: 'results' });
  const add = (p: Omit<Place, 'id'>) => busy(search, async () => {
    // The first place saved becomes the active one.
    const places = [...sky.places, { id: '', ...p }];
    await saveSky({ ...sky, places, active: sky.places.length ? sky.active : '' }, `${p.name} added.`);
  });
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
        b.addEventListener('click', () => { results.replaceChildren(); query.value = ''; add({ name: r.name, lat: r.latitude, lon: r.longitude }); });
        return b;
      }) : [h('p', { class: 'empty' }, 'No matches. Try a nearby town.')]));
    });
  });
  const here = h('button', { type: 'button', class: 'ghost' }, 'Use where I am now');
  here.addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast('This browser can’t share its location.', 'error');
    here.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      here.disabled = false;
      const name = prompt('Name for this place', 'Home')?.trim();
      if (name) add({ name: name.slice(0, 40), lat: pos.coords.latitude, lon: pos.coords.longitude });
    }, () => { here.disabled = false; toast('Location permission was refused or unavailable.', 'error'); }, { timeout: 15_000 });
  });

  return [
    pageHead('Places', 'Weather, the rain map, Overhead, Flight radar and Tonight all use this location. On the display, tap the middle of the radar to step through your places.'),
    card('Centre on', list),
    card('Add a place', form, results, h('div', { class: 'buttons' }, here),
      h('p', { class: 'hint' }, 'Places are rounded to about 1 km. That’s plenty for a radar, and your exact address is never stored.')),
  ];
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
type AirportRow = [string, string, string, string, string, number, number];
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
  const airports = sky.airports ?? [];
  const save = (next: SavedAirport[], message: string) => saveSky({ ...sky, airports: next }, message);

  const list = h('div', { class: 'places' });
  const move = (from: number, to: number) => {
    const next = [...airports];
    next.splice(to, 0, ...next.splice(from, 1));
    return save(next, 'Order saved.');
  };
  airports.forEach((a, i) => {
    const up = h('button', { type: 'button', class: 'ghost small', 'aria-label': `Move ${a.city} up` }, '↑');
    up.addEventListener('click', () => busy(up, () => move(i, i - 1)));
    const remove = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove');
    remove.addEventListener('click', () => busy(remove, () => save(airports.filter((_, n) => n !== i), `${a.city} removed.`)));
    list.append(h('div', { class: 'place' },
      h('span', { class: 'gcheck' }, h('span', {}, h('b', {}, `${a.city} ${a.iata || a.icao}`), h('small', {}, a.name))),
      h('span', { class: 'actions' }, i > 0 ? up : null, remove)));
  });
  if (!airports.length) list.append(h('p', { class: 'empty' }, 'No airports yet. Add one below and the board joins the rotation.'));
  const yours = card('Your airports', list,
    h('p', { class: 'hint' }, 'The display shows them in this order. Tap the middle of the board to switch between arrivals, departures and your other airports.'));
  if (airports.length >= MAX_AIRPORTS) return [yours, card(null, h('p', { class: 'hint' }, `That’s the most the board can cycle through (${MAX_AIRPORTS}). Remove one to add another.`))];

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
          if (airports.some(a => a.icao === icao)) return toast('That airport is already on the list.');
          busy(search, () => save([...airports, { icao, iata, name, city: city || name, lat, lon }], `${city || name} added.`));
        });
        return b;
      }) : [h('p', { class: 'empty' }, 'No airport with scheduled flights matches. Try its city or three-letter code.')]));
    });
  });
  return [yours, card('Add an airport', form, results,
    h('p', { class: 'hint' }, 'Each airport gets a split-flap arrivals and departures board, showing flights within 100 nm of it. Airports: OurAirports. Flights come from the same open ADS-B data as the radar, with routes from adsbdb, so only flights already in the air or taxiing are shown, and arrival times are estimates.'))];
}
