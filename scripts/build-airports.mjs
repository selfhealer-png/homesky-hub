// Builds the airport list that /setup searches when adding an arrivals board, from OurAirports
// (public domain, https://ourairports.com/data/). Only airports with scheduled passenger
// service are kept, about 4,000 of them. The CSV is downloaded once into node_modules/.cache.
// Output: src/web/public/airports.json (not committed).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'node_modules', '.cache', 'homesky');
const csvPath = join(cacheDir, 'airports.csv');
const outPath = join(root, 'src', 'web', 'public', 'airports.json');
const SOURCE = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

if (existsSync(outPath)) {
  console.log('Airport list already built.');
  process.exit(0);
}

if (!existsSync(csvPath)) {
  console.log('Downloading the airport list from OurAirports (about 13 MB, once)…');
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'homesky-hub build (open-source home display)' } });
  if (!res.ok) throw new Error(`OurAirports answered ${res.status}`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(csvPath, Buffer.from(await res.arrayBuffer()));
}

/** One CSV line into fields: commas inside quotes stay, "" is a quote. */
function fields(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(csvPath, 'utf8').split('\n');
const head = fields(lines[0]);
const col = name => head.indexOf(name);
const [TYPE, NAME, LAT, LON, COUNTRY, CITY, SCHEDULED, ICAO, IATA, IDENT] =
  ['type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country', 'municipality', 'scheduled_service', 'icao_code', 'iata_code', 'ident'].map(col);

const airports = [];
for (const line of lines.slice(1)) {
  const f = fields(line);
  if (f.length < head.length - 2) continue;
  if (f[SCHEDULED] !== 'yes' || !/^(large|medium|small)_airport$/.test(f[TYPE])) continue;
  const icao = f[ICAO] || (/^[A-Z]{4}$/.test(f[IDENT]) ? f[IDENT] : '');
  if (!icao) continue;
  // [icao, iata, name, city, country, lat, lon]: compact, about 60 bytes an airport.
  airports.push([icao, f[IATA], f[NAME], f[CITY].split(',')[0].trim(), f[COUNTRY], Math.round(Number(f[LAT]) * 1000) / 1000, Math.round(Number(f[LON]) * 1000) / 1000, f[TYPE][0]]);
}
// Big airports first, so a search for a city finds its main airport before the small ones.
const rank = { l: 0, m: 1, s: 2 };
airports.sort((a, b) => rank[a[7]] - rank[b[7]]);
writeFileSync(outPath, JSON.stringify(airports.map(a => a.slice(0, 7))));
console.log(`Airports: ${airports.length} with scheduled flights.`);
