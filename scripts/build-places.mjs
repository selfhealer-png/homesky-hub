// Builds the town-name files the radar labels itself with, from GeoNames' list of every place
// in the world with 500 or more people (CC BY 4.0, https://www.geonames.org). The list is
// downloaded once into node_modules/.cache and split into 2° × 2° files, so a display only
// fetches the few around it. Output: src/web/public/places/<lat>_<lon>.json (not committed).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'node_modules', '.cache', 'homesky');
const zipPath = join(cacheDir, 'cities500.zip');
const outDir = join(root, 'src', 'web', 'public', 'places');
const SOURCE = 'https://download.geonames.org/export/dump/cities500.zip';
const CELL = 2; // degrees

if (existsSync(join(outDir, 'index.json'))) {
  console.log('Place names already built.');
  process.exit(0);
}

if (!existsSync(zipPath)) {
  console.log('Downloading place names from GeoNames (about 14 MB, once)…');
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'homesky-hub build (open-source home display)' } });
  if (!res.ok) throw new Error(`GeoNames answered ${res.status}`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}

/** The one file in the zip, read from its local header (the archive holds a single deflated file). */
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Not a zip file');
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (size === 0) {
    // Sizes kept in the central directory instead: find it from the end record.
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = buf.readUInt32LE(eocd + 16);
    size = buf.readUInt32LE(cd + 20);
  }
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

const text = unzipFirst(readFileSync(zipPath)).toString('utf8');
const cells = new Map();
let count = 0;
for (const line of text.split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  // Populated places only (not districts or abandoned sites).
  if (f[6] !== 'P' || /^PPL(H|Q|W|X)$/.test(f[7])) continue;
  const lat = Number(f[4]), lon = Number(f[5]), pop = Number(f[14]) || 0;
  const key = `${Math.floor(lat / CELL) * CELL}_${Math.floor(lon / CELL) * CELL}`;
  if (!cells.has(key)) cells.set(key, []);
  // [name, lat, lon, population]: compact, about 30 bytes a place.
  cells.get(key).push([f[1], Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000, pop]);
  count++;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [key, list] of cells) {
  list.sort((a, b) => b[3] - a[3]);
  writeFileSync(join(outDir, `${key}.json`), JSON.stringify(list));
}
// Which cells exist, so a display never asks for empty sea.
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ cell: CELL, cells: [...cells.keys()] }));
console.log(`Place names: ${count} places in ${cells.size} files.`);
