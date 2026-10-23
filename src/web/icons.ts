import type { WearIcon, WeatherIcon } from '../shared/wear';

// Weather icons: one drawn set, 24-unit grid, 1.75 stroke, currentColor. Inline SVG so they
// inherit colour and scale with text.

const CLOUD = 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.6 4.2 4.2 0 0 0 7 18Z';
const PATHS: Record<WeatherIcon, string> = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  partly: '<path d="M8.5 3.5v1.6M3.5 8.5h1.6M5 5l1.1 1.1M12.4 5.1 11.3 6.2"/><path d="M5.6 11.3a3.4 3.4 0 0 1 6.2-2.3"/><path d="M9.5 20h8a3.6 3.6 0 0 0 .5-7.15 5.2 5.2 0 0 0-9.9-1A3.7 3.7 0 0 0 9.5 20Z"/>',
  cloud: `<path d="${CLOUD}"/>`,
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  rain: `<path d="M7 15.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.1 4.2 4.2 0 0 0 7 15.5Z"/><path d="M8.5 18.5 7.5 21M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>`,
  snow: `<path d="M7 15.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.1 4.2 4.2 0 0 0 7 15.5Z"/><path d="M8 19.2h.01M12 20.5h.01M16 19.2h.01" stroke-width="2.6"/>`,
  storm: `<path d="M7 15.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7.1 4.2 4.2 0 0 0 7 15.5Z"/><path d="m12.5 15.5-2 3.5h3l-2 3.5"/>`,
};

export function weatherIcon(name: WeatherIcon, className = 'wx-icon'): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="${className} wx-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

// Clothing, in the same hand: what to wear, read at a glance from across the room.
const SLEEVES = 'M8.5 4 5 5.8 3.5 19.5h2.8L8 10v10h8V10l1.7 9.5h2.8L19 5.8 15.5 4c-.6 1.4-1.9 2.2-3.5 2.2S9.1 5.4 8.5 4Z';
const COAT = 'M8.5 3.5 5 5.3 3.8 17h2.6L8 10v11.5h8V10l1.6 7h2.6L19 5.3l-3.5-1.8';
const WEAR: Record<WearIcon, string> = {
  tshirt: '<path d="M8.5 4 4 6.5l1.8 3.6 2.2-1V20h8V9.1l2.2 1 1.8-3.6L15.5 4c-.6 1.4-1.9 2.2-3.5 2.2S9.1 5.4 8.5 4Z"/>',
  longsleeve: `<path d="${SLEEVES}"/>`,
  jumper: `<path d="${SLEEVES}"/><path d="M8 17.2h8M5.9 17.4h-2.2M18.1 17.4h2.2"/>`,
  jacket: `<path d="${SLEEVES}"/><path d="M12 6.2V20M8.5 4l1.6 4L12 6.2 13.9 8l1.6-4"/>`,
  coat: `<path d="${COAT}"/><path d="M8.5 3.5 10.5 8 12 6l1.5 2 2-4.5M8 21.5h8"/><path d="M12 11h.01M12 14.5h.01M12 18h.01" stroke-width="2.6"/>`,
  raincoat: '<path d="M8.5 6.5 5 8.3 3.8 18h2.6L8 12.5v9h8v-9l1.6 5.5h2.6L19 8.3l-3.5-1.8"/><path d="M8.5 6.5V5.5a3.5 3.5 0 0 1 7 0v1M12 9v12.5"/>',
  shorts: '<path d="M6 4.5h12l1 10.5h-5.5L12 9.5 10.5 15H5Z"/><path d="M6.2 7h11.6"/>',
  trousers: '<path d="M7 3.5h10l1 17h-4L12 9.5 10 20.5H6Z"/><path d="M7.1 6h9.8"/>',
  scarf: '<path d="M5 5.5c4 2.2 10 2.2 14 0v2.8c-4 2.2-10 2.2-14 0Z"/><path d="M8.6 10.4 7.6 19.5h3l.6-8.6M14 10.7l1.5 8.6 2.9-.7-2-8.6M8.2 19.5v1.6M10 19.5v1.6M16 19.2l.4 1.5M17.8 18.8l.4 1.5"/>',
  gloves: '<path d="M9 18V8a3.5 3.5 0 0 1 7 0v10M9 13.8 7 11.3a1.5 1.5 0 0 0-2.4 1.8L9 18M8.5 18h8v3h-8Z"/>',
  beanie: '<path d="M5.5 15.5a6.5 6.5 0 0 1 13 0"/><path d="M4.5 15.5h15v3.5h-15Z"/><circle cx="12" cy="6.2" r="1.7"/>',
  sunhat: '<path d="M3 16.5c3 2 15 2 18 0"/><path d="M7 16c0-4.2 2-7 5-7s5 2.8 5 7M7.4 13.5h9.2"/>',
  sunglasses: '<path d="M3 9.5h7.5V12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3ZM13.5 9.5H21V12a3 3 0 0 1-3 3h-1.5a3 3 0 0 1-3-3ZM10.5 10.5h3"/>',
  umbrella: '<path d="M3 12.5a9 9 0 0 1 18 0Z"/><path d="M12 12.5V19a2 2 0 0 1-4 0M12 3.5v-1"/>',
  boots: '<path d="M7.5 3.5h5v9.5l6 2.3a2.4 2.4 0 0 1 1.5 2.2v2.5h-12.5Z"/><path d="M7.5 17.5H20M7.5 6h5"/>',
  sandals: '<path d="M12 3c3 0 4.5 2.5 4.5 6.5S15 21 12 21s-4.5-7.5-4.5-11.5S9 3 12 3Z"/><path d="M12 6.5 8.1 11.8M12 6.5l3.9 5.3"/>',
};

export function wearIcon(name: WearIcon, className = 'wx-wear-icon'): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WEAR[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}
