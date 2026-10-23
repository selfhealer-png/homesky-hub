import type { WeatherIcon } from '../shared/wear';

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
