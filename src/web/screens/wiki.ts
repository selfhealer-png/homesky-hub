import type { HubConfig, WikiResponse } from '../../shared/types';
import { getJson } from '../api';
import { h, type Screen } from '../screen';

// Wikipedia's featured article of the day: one good thing to read, changing daily. Set like a
// page of a book rather than a dashboard: the picture on one side, the words on the other.

const CACHE_KEY = 'hub.wiki';
let alive = false;

function remember(a: WikiResponse) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(a)); } catch { /* Storage can be unavailable. */ }
}
function recall(): WikiResponse | null {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as WikiResponse | null; } catch { return null; }
}

function render(el: HTMLElement, a: WikiResponse, pictures: boolean) {
  const text = h('article', 'wk-text');
  text.append(h('p', 'wk-kicker', 'Today’s featured article'), h('h1', 'wk-title', a.title));
  if (a.description) text.append(h('p', 'wk-desc', a.description));
  text.append(h('p', 'wk-extract', a.extract), h('p', 'wk-credit', 'From Wikipedia, the free encyclopedia · CC BY-SA'));

  if (!a.image || !pictures) {
    el.classList.add('wk-no-image');
    el.replaceChildren(text);
    return;
  }
  el.classList.remove('wk-no-image');
  const figure = h('figure', 'wk-figure');
  const img = h('img');
  img.src = a.image.url;
  img.alt = '';
  img.decoding = 'async';
  // Tall pictures (portraits) are cropped from the top, so faces stay in view.
  if (a.image.height > a.image.width * 1.15) figure.classList.add('wk-tall');
  img.addEventListener('error', () => { figure.remove(); el.classList.add('wk-no-image'); });
  figure.append(img);
  el.replaceChildren(figure, text);
}

export const wikiScreen: Screen = {
  id: 'wiki',
  title: 'Wikipedia',
  durationSec: 40,
  mount(el: HTMLElement, config: HubConfig) {
    alive = true;
    const pictures = config.wikiPictures;
    const today = new Date().toISOString().slice(0, 10);
    const known = recall();
    if (known) render(el, known, pictures);
    else el.append(h('p', 'wk-loading', 'Finding today’s article…'));
    if (known?.date === today) return;
    getJson<WikiResponse>('/api/wiki')
      .then(a => { remember(a); if (alive) render(el, a, pictures); })
      .catch(() => { if (alive && !known) el.replaceChildren(h('p', 'wk-loading', 'Wikipedia isn’t answering right now.')); });
  },
  unmount() {
    alive = false;
  },
};
