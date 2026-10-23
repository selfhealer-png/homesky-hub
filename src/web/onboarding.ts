import { CLOCK_STYLES, MOTION_LEVELS, type ClockStyle, type MotionLevel } from '../shared/settings';
import { CLOCK_LABELS, clockPreview } from './clockPreview';
import { h } from './screen';

// First-run setup, on the display itself, right after the password on a brand-new hub.
// Three short steps (where you are, a calendar, how it looks), one "Save and start", and the
// display opens. Everything here can be changed later in Settings, which also holds what
// needs a bigger screen or more steps (Google, photos, airports).

interface Choice {
  location: { mode: 'device' } | { mode: 'place'; name: string; lat: number; lon: number };
  calendar: { name: string; url: string } | null;
  clock: ClockStyle;
  motion: MotionLevel;
}

const MOTION_TEXT: Record<MotionLevel, [string, string]> = {
  full: ['Full', 'Letters flip and photos drift.'],
  gentle: ['Gentle', 'Changes fade softly.'],
  still: ['Still', 'Nothing animates.'],
};

async function admin(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-admin': '1' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Saving didn’t work. Try again.');
  return data;
}

function option(name: string, value: string, checked: boolean, title: string, sub: string, onPick: () => void, extra?: Node) {
  const input = h('input');
  Object.assign(input, { type: 'radio', name, value, checked });
  input.addEventListener('change', onPick);
  const label = h('label', 'ob-option');
  const text = h('span', 'ob-option-text');
  text.append(h('b', undefined, title), h('small', undefined, sub));
  label.append(input, ...(extra ? [extra] : []), text);
  return label;
}

export function runOnboarding(root: HTMLElement, onDone: () => void) {
  const choice: Choice = { location: { mode: 'device' }, calendar: null, clock: 'word', motion: 'full' };
  let step = 0;

  const card = h('section', 'wel-card wide');
  root.replaceChildren(card);
  root.hidden = false;
  root.className = 'welcome';

  const shell = (title: string, lede: string, body: Node[], actions: Node[]) => {
    const progress = h('p', 'ob-step', `Step ${step + 1} of 3`);
    const bar = h('div', 'ob-actions');
    bar.append(...actions);
    card.replaceChildren(progress, h('h1', undefined, title), h('p', 'wel-lede', lede), ...body, bar);
    card.scrollTop = 0;
  };
  const button = (text: string, kind: 'primary' | 'secondary', onClick: () => void) => {
    const b = h('button', kind === 'primary' ? 'wel-primary' : 'wel-secondary', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const go = (n: number) => { step = n; render(); };

  // ── 1. Where ──────────────────────────────────────────────────────────────
  function whereStep() {
    const results = h('div', 'ob-results');
    const query = h('input');
    Object.assign(query, { type: 'text', placeholder: 'Town, city or postcode', autocomplete: 'off' });
    query.setAttribute('aria-label', 'Search for a place');
    const search = h('button', 'wel-secondary', 'Search');
    search.type = 'submit';
    const searchForm = h('form', 'ob-search');
    searchForm.append(query, search);
    const chosen = h('p', 'ob-chosen');
    const placeBox = h('div', 'ob-place');
    placeBox.append(searchForm, results, chosen);
    const showChosen = () => {
      chosen.textContent = choice.location.mode === 'place' ? `✓ ${choice.location.name}` : '';
    };
    showChosen();
    placeBox.hidden = choice.location.mode !== 'place';

    searchForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!query.value.trim()) return;
      search.disabled = true;
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(query.value.trim())}`).then(r => r.json()).catch(() => null);
      search.disabled = false;
      const found: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }> = res?.results ?? [];
      results.replaceChildren(...(found.length ? found.map(r => {
        const b = h('button', 'ob-result');
        b.type = 'button';
        b.append(h('b', undefined, r.name), h('small', undefined, [r.admin1, r.country].filter(Boolean).join(', ')));
        b.addEventListener('click', () => {
          choice.location = { mode: 'place', name: r.name, lat: r.latitude, lon: r.longitude };
          results.replaceChildren();
          showChosen();
        });
        return b;
      }) : [h('p', 'ob-hint', 'No matches. Try a nearby town.')]));
    });

    const device = option('where', 'device', choice.location.mode === 'device', 'Use this device’s location',
      'Best for a screen that lives at home. It asks permission once; if you say no, it uses roughly where your internet connection is.',
      () => { choice.location = { mode: 'device' }; placeBox.hidden = true; showChosen(); });
    const place = option('where', 'place', choice.location.mode === 'place', 'Choose a place',
      'For a fixed place, or if you’d rather not share this device’s location.',
      () => { placeBox.hidden = false; query.focus(); });

    const next = button('Next', 'primary', async () => {
      if (!place.querySelector('input')!.checked) {
        choice.location = { mode: 'device' };
        // Ask now, while someone is here to answer, rather than later on an unattended screen.
        await new Promise<void>(resolve => {
          if (!('geolocation' in navigator)) return resolve();
          navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 15_000 });
        });
      } else if (choice.location.mode !== 'place') {
        chosen.textContent = 'Search for your place and pick it from the list first.';
        return;
      }
      go(1);
    });
    shell('Where is this screen?', 'The weather and the planes overhead are centred here.', [h('div', 'ob-options'), placeBox], [next]);
    card.querySelector('.ob-options')!.append(device, place);
  }

  // ── 2. A calendar ─────────────────────────────────────────────────────────
  function calendarStep() {
    const name = h('input');
    Object.assign(name, { type: 'text', value: choice.calendar?.name ?? 'Family', maxLength: 60, id: 'ob-cal-name' });
    const link = h('input');
    Object.assign(link, { type: 'url', value: choice.calendar?.url ?? '', placeholder: 'https://… or webcal://…', inputMode: 'url', id: 'ob-cal-link', autocomplete: 'off' });
    const result = h('p', 'ob-result-line');
    const test = h('button', 'wel-secondary', 'Test link');
    test.type = 'button';
    test.addEventListener('click', async () => {
      if (!link.value.trim()) return;
      test.disabled = true;
      result.className = 'ob-result-line';
      result.textContent = 'Checking…';
      try {
        const r = (await admin('/api/admin/connections/test', { kind: 'ics', url: link.value })) as { ok?: boolean; events?: number; upcoming?: string[]; error?: string };
        if (!r.ok) throw new Error(r.error ?? 'Couldn’t read that calendar.');
        result.className = 'ob-result-line good';
        result.textContent = r.events ? `✓ Found ${r.events} event${r.events === 1 ? '' : 's'} in the next three weeks${r.upcoming?.length ? `, like “${r.upcoming[0]}”` : ''}.` : '✓ The calendar works, but has nothing in the next three weeks.';
      } catch (err) {
        result.className = 'ob-result-line bad';
        result.textContent = (err as Error).message;
      } finally {
        test.disabled = false;
      }
    });

    const help = h('details', 'ob-help');
    help.append(h('summary', undefined, 'Where do I find my calendar link?'));
    const tips: Array<[string, string]> = [
      ['Google Calendar', 'On a computer: calendar.google.com → gear → Settings → pick the calendar → “Secret address in iCal format”.'],
      ['iCloud', 'Calendar app → Calendars → ⓘ next to the calendar → turn on Public Calendar → Share Link.'],
      ['Outlook', 'Outlook on the web → Settings → Calendar → Shared calendars → Publish → copy the ICS link.'],
    ];
    for (const [title, text] of tips) help.append(h('p', undefined, `${title}: ${text}`));

    const fields = h('div', 'ob-fields');
    const nameLabel = h('label', 'wel-label', 'Name on the display');
    nameLabel.htmlFor = 'ob-cal-name';
    const linkLabel = h('label', 'wel-label', 'Calendar link');
    linkLabel.htmlFor = 'ob-cal-link';
    const linkRow = h('div', 'ob-search');
    linkRow.append(link, test);
    fields.append(nameLabel, name, linkLabel, linkRow, result, help);

    const keep = () => { choice.calendar = link.value.trim() ? { name: name.value.trim() || 'Calendar', url: link.value.trim() } : null; };
    shell('Add a calendar', 'Paste a private calendar link to see your events on the Home screen. Google Calendar and Tasks, more calendars and photos can be connected later in Settings.', [fields], [
      button('Back', 'secondary', () => { keep(); go(0); }),
      button('Skip', 'secondary', () => { choice.calendar = null; go(2); }),
      button('Next', 'primary', () => { keep(); go(2); }),
    ]);
  }

  // ── 3. How it looks ───────────────────────────────────────────────────────
  function lookStep() {
    const clocks = h('div', 'ob-clocks');
    for (const style of CLOCK_STYLES) {
      const [title] = CLOCK_LABELS[style];
      const input = h('input');
      Object.assign(input, { type: 'radio', name: 'clock', value: style, checked: choice.clock === style });
      input.addEventListener('change', () => { choice.clock = style; });
      const label = h('label', 'ob-clock');
      label.append(input, clockPreview(style), h('b', undefined, title));
      clocks.append(label);
    }
    const motion = h('div', 'ob-options');
    for (const level of MOTION_LEVELS) {
      const [title, sub] = MOTION_TEXT[level];
      motion.append(option('motion', level, choice.motion === level, title, sub, () => { choice.motion = level; }));
    }
    const error = h('p', 'wel-error');
    error.setAttribute('role', 'alert');
    const save = button('Save and start', 'primary', async () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      error.textContent = '';
      try {
        const loc = choice.location;
        await admin('/api/admin/sky', loc.mode === 'place'
          ? { places: [{ name: loc.name, lat: loc.lat, lon: loc.lon }], active: '', radiusNm: 25 }
          : { places: [], active: 'device', radiusNm: 25 });
        if (choice.calendar) await admin('/api/admin/connections/add', { kind: 'ics', name: choice.calendar.name, url: choice.calendar.url, color: '#2563FF' });
        await admin('/api/admin/display', { clock: choice.clock, motion: choice.motion, warmth: 'normal', photoStyle: 'fill' });
        root.hidden = true;
        root.className = '';
        onDone();
      } catch (err) {
        error.textContent = (err as Error).message;
        save.disabled = false;
        save.textContent = 'Save and start';
      }
    });
    shell('How should it look?', 'Pick a clock and how much the screens move. You can change both any time.', [
      h('h2', 'ob-sub', 'Clock'), clocks, h('h2', 'ob-sub', 'Motion'), motion, error,
    ], [button('Back', 'secondary', () => go(1)), save]);
  }

  const render = () => (step === 0 ? whereStep() : step === 1 ? calendarStep() : lookStep());
  render();
}
