import { CALENDAR_COLORS, type ConnectionTest } from '../../shared/settings';

// Building blocks for the setup page. Every value from the server is rendered with textContent
// (via h()), never innerHTML, so a calendar name can't inject markup.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** An inline SVG icon on a 24-unit grid, drawn with currentColor. Paths are our own constants. */
export function svg(paths: string, size = 20): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-hub-admin': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status}).`);
  return data as T;
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.className = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

/** Runs an action with the button disabled; shows any error as a toast. */
export async function busy(btn: HTMLButtonElement, fn: () => Promise<void>) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try { await fn(); } catch (err) { toast((err as Error).message, 'error'); } finally { btn.disabled = false; btn.textContent = label; }
}

/** Runs a save from a control that has no button to disable; shows any error as a toast. */
export function quietly(p: Promise<unknown>) {
  p.catch(err => toast((err as Error).message, 'error'));
}

export function field(label: string, input: HTMLInputElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

export function input(attrs: Record<string, string>) {
  return h('input', { autocomplete: 'off', spellcheck: 'false', ...attrs });
}

export function swatches(name: string, selected: string) {
  const box = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  for (const c of CALENDAR_COLORS) {
    const radio = h('input', { type: 'radio', name, value: c, checked: c.toLowerCase() === selected.toLowerCase(), 'aria-label': c });
    const lab = h('label', { class: 'swatch' }, radio, h('span', {}));
    lab.style.setProperty('--c', c);
    box.append(lab);
  }
  return { el: box, value: () => (box.querySelector('input:checked') as HTMLInputElement | null)?.value ?? CALENDAR_COLORS[0] };
}

export function copyRow(value: string, label = 'Copy') {
  const btn = h('button', { class: 'ghost small', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); toast('Copied.'); } catch { toast('Could not copy. Select the text instead.', 'error'); }
  });
  return h('div', { class: 'copyrow' }, h('code', {}, value), btn);
}

export function testResult(r: ConnectionTest) {
  if (!r.ok) return h('p', { class: 'result bad' }, `✕ ${r.error ?? 'Could not read it.'}`);
  if (!r.events && !r.tasks) return h('p', { class: 'result good' }, '✓ The calendar works, but has nothing in the next three weeks.');
  const counts = [`${r.events} event${r.events === 1 ? '' : 's'}`];
  if (r.tasks) counts.push(`${r.tasks} task${r.tasks === 1 ? '' : 's'}`);
  return h('p', { class: 'result good' }, `✓ Read ${counts.join(' and ')} in the next three weeks.`,
    r.upcoming.length ? h('span', { class: 'upcoming' }, ` Next: ${r.upcoming.join(' · ')}`) : null);
}

export function guide(title: string, ...steps: Array<string | Node>) {
  return h('details', { class: 'guide' }, h('summary', {}, title), h('ol', {}, ...steps.map(s => h('li', {}, s))));
}

// ── settings-app pieces ─────────────────────────────────────────────────────

/** An iOS-style on/off switch. It flips straight away and flips back if the save fails. */
export function iosSwitch(checked: boolean, label: string, onChange: (on: boolean) => Promise<unknown>) {
  const el = h('input', { type: 'checkbox', role: 'switch', class: 'ios', checked, 'aria-label': label });
  el.addEventListener('change', () => {
    const on = el.checked;
    onChange(on).catch(err => { el.checked = !on; toast((err as Error).message, 'error'); });
  });
  return el;
}

export const CHEVRON = '<path d="m9 6 6 6-6 6"/>';

/** A tinted icon tile, like the ones down the left of iOS Settings. */
export function tile(paths: string, color: string) {
  const t = h('span', { class: 'tile', 'aria-hidden': 'true' }, svg(paths, 18));
  t.style.setProperty('--tile', color);
  return t;
}

export interface RowOptions {
  icon?: HTMLElement;
  title: string;
  summary?: string;
  /** Amber summary: on, but with nothing to show until it's set up. */
  needs?: boolean;
  href?: string;
  control?: HTMLElement;
}

/** One row of a grouped list. With href the whole row opens a page; a control (a switch) sits on top. */
export function row(o: RowOptions) {
  const text = h('span', { class: 'row-text' }, h('b', {}, o.title), o.summary ? h('small', { class: o.needs ? 'needs' : '' }, o.summary) : null);
  const r = h('div', { class: `row${o.href ? ' nav' : ''}` });
  if (o.icon) r.append(o.icon);
  r.append(o.href ? h('a', { href: o.href, class: 'row-link' }, text) : text);
  if (o.control) r.append(o.control);
  if (o.href) r.append(h('span', { class: 'chev' }, svg(CHEVRON, 18)));
  return r;
}

/** A grouped list, with a small caps heading above and an optional footnote below. */
export function group(title: string | null, rows: HTMLElement[], foot?: string | Node) {
  return h('section', { class: 'group' },
    title ? h('h4', {}, title) : null,
    h('div', { class: 'rows' }, ...rows),
    foot ? h('p', { class: 'hint' }, foot) : null);
}

/** The top of a detail page: back to the list, then the title. */
export function pageHead(title: string, lede?: string, back = '#/') {
  return h('div', { class: 'pagehead' },
    h('a', { href: back, class: 'back' }, svg('<path d="m15 6-6 6 6 6"/>', 18), back === '#/' ? 'Settings' : 'Back'),
    h('h2', { tabindex: '-1' }, title),
    lede ? h('p', { class: 'lede' }, lede) : null);
}

export function card(title: string | null, ...children: Array<Node | string | null | undefined | false>) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}

/** A row of mutually exclusive buttons. */
export function segmented<T extends string | number | boolean>(name: string, label: string, options: Array<[T, string]>, value: T, onChange: (v: T) => void) {
  const box = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of options) {
    const r = h('input', { type: 'radio', name, value: String(v), checked: v === value });
    r.addEventListener('change', () => onChange(v));
    box.append(h('label', {}, r, h('span', {}, text)));
  }
  return box;
}

/** A list of choices, each with a line of explanation. */
export function choiceList<T extends string>(name: string, label: string, options: Array<[T, string, string]>, value: T, onChange: (v: T) => void) {
  const box = h('div', { class: 'places', role: 'radiogroup', 'aria-label': label });
  for (const [v, title, sub] of options) {
    const radio = h('input', { type: 'radio', name, value: v, checked: v === value });
    radio.addEventListener('change', () => onChange(v));
    box.append(h('div', { class: 'place' }, h('label', { class: 'gcheck' }, radio, h('span', {}, h('b', {}, title), h('small', {}, sub)))));
  }
  return box;
}
