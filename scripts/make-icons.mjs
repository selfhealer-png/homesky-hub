// Draws the app icon and splash screens as SVG and renders them to resources/ with sharp (a
// dependency of @capacitor/assets). Then `npx capacitor-assets generate --ios` makes every size.
// The mark: radar rings over a night sky, a plane crossing them, and a warm light low down for home.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const NAVY = '#0B0F1A';
const BLUE = '#2563FF';
const CREAM = '#F4EFE3';
const AMBER = '#F5B544';

// A plane seen from above, nose up, on a 100-unit box centred at 0,0.
const PLANE = 'M0-46c4 0 6 4 6 9v22l38 22v9L6 4v22l11 9v7L0 37l-17 5v-7l11-9V4l-38 12V7L-6-15v-22c0-5 2-9 6-9z';

function mark(size, scale = 1) {
  const c = size / 2;
  const r = (size * 0.36) * scale;
  const rings = [1, 0.68, 0.36].map((k, i) =>
    `<circle cx="${c}" cy="${c}" r="${r * k}" fill="none" stroke="${BLUE}" stroke-opacity="${0.9 - i * 0.22}" stroke-width="${size * 0.018 * scale}"/>`).join('');
  const sweep = `<path d="M${c} ${c} L${c} ${c - r} A${r} ${r} 0 0 1 ${c + r * Math.sin(Math.PI / 4)} ${c - r * Math.cos(Math.PI / 4)} Z" fill="${BLUE}" fill-opacity="0.22"/>`;
  const plane = `<g transform="translate(${c + r * 0.34} ${c - r * 0.3}) rotate(40) scale(${size * 0.0042 * scale})"><path d="${PLANE}" fill="${CREAM}"/></g>`;
  const home = `<circle cx="${c - r * 0.38}" cy="${c + r * 0.42}" r="${size * 0.032 * scale}" fill="${AMBER}"/>`;
  return rings + sweep + home + plane;
}

const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${NAVY}"/>${mark(size)}</svg>`;
const splash = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${NAVY}"/>${mark(size, 0.32)}</svg>`;

mkdirSync('resources', { recursive: true });
await sharp(Buffer.from(icon(1024))).png().toFile('resources/icon.png');
await sharp(Buffer.from(splash(2732))).png().toFile('resources/splash.png');
await sharp(Buffer.from(splash(2732))).png().toFile('resources/splash-dark.png');
console.log('resources/icon.png, splash.png, splash-dark.png written');
