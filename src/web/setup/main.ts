import './setup.css';
import {
  CALENDAR_COLORS, CLOCK_STYLES, DEFAULT_DISPLAY, MOTION_LEVELS, PHOTO_STYLES, RADIUS_CHOICES, WARMTH_LEVELS,
  type ClockStyle, type DisplaySettings, type MotionLevel,
  type AdminState, type PhotoInfo, type PickStatus, type Place, type SkySettings, type Connection, type ConnectionTest, type FeedConnection, type GoogleConnection, type GoogleItem, type IcsConnection, type Settings,
} from '../../shared/settings';

// The admin setup page. Every value from the server is rendered with textContent (via h()),
// never innerHTML, so a calendar name can't inject markup.

const app = document.getElementById('app')!;
const logoutBtn = document.getElementById('logout') as HTMLButtonElement;
const toastEl = document.getElementById('toast')!;

let state: AdminState;
let openPanel: 'ics' | 'feed' | 'google' | null = null;

// ── helpers ─────────────────────────────────────────────────────────────────

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
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

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function api<T>(path: string, body?: unknown): Promise<T> {
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
function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  toastEl.textContent = message;
  toastEl.className = kind;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4000);
}

/** Runs an action with the button disabled; shows any error as a toast. */
async function busy(btn: HTMLButtonElement, fn: () => Promise<void>) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try { await fn(); } catch (err) { toast((err as Error).message, 'error'); } finally { btn.disabled = false; btn.textContent = label; }
}

function field(label: string, input: HTMLInputElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

function input(attrs: Record<string, string>) {
  return h('input', { autocomplete: 'off', spellcheck: 'false', ...attrs });
}

function swatches(name: string, selected: string) {
  const box = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  for (const c of CALENDAR_COLORS) {
    const radio = h('input', { type: 'radio', name, value: c, checked: c.toLowerCase() === selected.toLowerCase(), 'aria-label': c });
    const lab = h('label', { class: 'swatch' }, radio, h('span', {}));
    lab.style.setProperty('--c', c);
    box.append(lab);
  }
  return { el: box, value: () => (box.querySelector('input:checked') as HTMLInputElement | null)?.value ?? CALENDAR_COLORS[0] };
}

function copyRow(value: string, label = 'Copy') {
  const btn = h('button', { class: 'ghost small', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); toast('Copied.'); } catch { toast('Could not copy. Select the text instead.', 'error'); }
  });
  return h('div', { class: 'copyrow' }, h('code', {}, value), btn);
}

function testResult(r: ConnectionTest) {
  if (!r.ok) return h('p', { class: 'result bad' }, `✕ ${r.error ?? 'Could not read it.'}`);
  if (!r.events && !r.tasks) return h('p', { class: 'result good' }, '✓ The calendar works, but has nothing in the next three weeks.');
  const counts = [`${r.events} event${r.events === 1 ? '' : 's'}`];
  if (r.tasks) counts.push(`${r.tasks} task${r.tasks === 1 ? '' : 's'}`);
  return h('p', { class: 'result good' }, `✓ Read ${counts.join(' and ')} in the next three weeks.`,
    r.upcoming.length ? h('span', { class: 'upcoming' }, ` Next: ${r.upcoming.join(' · ')}`) : null);
}

// ── login ───────────────────────────────────────────────────────────────────

function renderLogin(message?: string) {
  logoutBtn.hidden = true;
  const pw = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: 'true' });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');
  const form = h('form', { class: 'card login' },
    h('h2', {}, 'Sign in'),
    h('p', { class: 'lede' }, 'Use the admin password that ', h('code', {}, 'npm run setup'), ' printed.'),
    message ? h('p', { class: 'result bad' }, message) : null,
    field('Admin password', pw),
    submit,
  );
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(submit, async () => {
      await api('/api/admin/login', { password: pw.value });
      await load();
    });
  });
  app.replaceChildren(form);
  pw.focus();
}

// ── main view ───────────────────────────────────────────────────────────────

async function load() {
  try {
    state = await api<AdminState>('/api/admin/state');
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return renderLogin();
    app.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'result bad' }, (err as Error).message)));
    return;
  }
  logoutBtn.hidden = false;
  render();
}

function setSettings(s: Settings) {
  state.settings = s;
  render();
}

function render() {
  app.replaceChildren(statusCard(), displayCard(), calendarsCard(), photosCard(), skyCard(), laterCard());
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

function statusCard() {
  const s = state.status;
  const item = (ok: boolean, title: string, detail: Node | string) =>
    h('li', { class: ok ? 'ok' : 'todo' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, ok ? '✓' : '!'), h('div', {}, h('b', {}, title), h('div', { class: 'detail' }, detail)));
  return h('section', { class: 'card', id: 'status' },
    h('h2', {}, 'This hub'),
    h('ul', { class: 'checklist' },
      item(s.kv, 'Settings storage', s.kv ? 'KV namespace connected.' : 'No KV namespace bound. Run npm run setup.'),
      item(!!s.displayPairing, 'Pair a display', s.displayPairing
        ? h('div', {}, h('p', {}, 'Open this link once on the tablet, then add it to the Home Screen. Anyone with it can view the hub, so treat it like a password.'), copyRow(s.displayPairing, 'Copy link'))
        : 'DISPLAY_TOKEN is not set. Run npm run setup.'),
      item(s.photos, 'Photo storage', s.photos ? 'R2 bucket connected, ready for the photo frame.' : 'No R2 bucket yet. Optional: the photo frame needs it.'),
    ),
  );
}

function laterCard() {
  return h('section', { class: 'card muted-card' },
    h('h2', {}, 'Coming next'),
    h('p', { class: 'lede' }, 'Airport boards, watchlist and alerts, and screen order and night mode will be set up here too.'),
  );
}

// ── calendars ───────────────────────────────────────────────────────────────

function calendarsCard() {
  const conns = state.settings.connections;
  const google = conns.find((c): c is GoogleConnection => c.kind === 'google');
  const card = h('section', { class: 'card', id: 'calendars' },
    h('h2', {}, 'Calendars and tasks'),
    h('p', { class: 'lede' }, 'Everything here is read-only: the hub can show your calendars but never change them.'),
  );
  if (state.status.envFeed) card.append(h('p', { class: 'note' }, 'An agenda feed is also set as a deployment variable (AGENDA_FEED_URL). It is shown alongside these.'));

  const list = h('div', { class: 'conns' });
  conns.filter(c => c.kind !== 'google').forEach(c => list.append(connRow(c as IcsConnection | FeedConnection)));
  if (google) list.append(googleRow(google));
  if (!conns.length) list.append(h('p', { class: 'empty' }, 'Nothing connected yet. Add a calendar below.'));
  card.append(list);

  const choose = (panel: typeof openPanel, label: string, hint: string) => {
    const b = h('button', { type: 'button', class: `choice${openPanel === panel ? ' on' : ''}`, 'aria-expanded': String(openPanel === panel) }, h('b', {}, label), h('small', {}, hint));
    b.addEventListener('click', () => { openPanel = openPanel === panel ? null : panel; render(); });
    return b;
  };
  card.append(h('h3', {}, 'Add a calendar'), h('div', { class: 'choices' },
    choose('ics', 'Calendar link', 'Google, iCloud, Outlook (iCal)'),
    google ? null : choose('google', 'Google account', 'Calendars and Google Tasks'),
    choose('feed', 'Agenda feed', 'Your own server (JSON)'),
  ));
  if (openPanel === 'ics') card.append(icsForm());
  if (openPanel === 'feed') card.append(feedForm());
  if (openPanel === 'google' || google) card.append(googlePanel(google));
  return card;
}

function rowShell(color: string | null, title: string, sub: string, conn: Connection) {
  const row = h('div', { class: 'conn' });
  if (color) row.style.setProperty('--own', color);
  const toggle = h('input', { type: 'checkbox', checked: conn.enabled, 'aria-label': `Show ${title}` });
  toggle.addEventListener('change', async () => {
    try { setSettings(await api<Settings>('/api/admin/connections/update', { id: conn.id, enabled: toggle.checked })); }
    catch (err) { toast((err as Error).message, 'error'); toggle.checked = !toggle.checked; }
  });
  const result = h('div', { class: 'conn-result' });
  const test = h('button', { type: 'button', class: 'ghost small' }, 'Test');
  test.addEventListener('click', () => busy(test, async () => {
    result.replaceChildren(testResult(await api<ConnectionTest>('/api/admin/connections/test', { id: conn.id })));
  }));
  const remove = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove');
  remove.addEventListener('click', () => {
    if (!confirm(`Remove ${title}? The hub will stop showing it.`)) return;
    busy(remove, async () => { setSettings(await api<Settings>('/api/admin/connections/delete', { id: conn.id })); toast('Removed.'); });
  });
  const actions = h('div', { class: 'actions' }, h('label', { class: 'switch' }, toggle, h('span', {}, 'Show')), test);
  row.append(
    h('span', { class: 'ring', 'aria-hidden': 'true' }),
    h('div', { class: 'meta' }, h('b', {}, title), h('small', {}, sub)),
    actions,
    result,
  );
  return { row, actions, remove, result };
}

function connRow(conn: IcsConnection | FeedConnection) {
  const { row, actions, remove } = rowShell(conn.kind === 'ics' ? conn.color : null, conn.name,
    conn.kind === 'ics' ? `Calendar link · ${conn.host}` : `Agenda feed · ${new URL(conn.url).host}${conn.hasToken ? ' · token set' : ''}`, conn);
  const edit = h('button', { type: 'button', class: 'ghost small' }, 'Edit');
  edit.addEventListener('click', () => {
    const existing = row.querySelector('.editform');
    if (existing) { existing.remove(); return; }
    row.append(conn.kind === 'ics' ? icsEdit(conn) : feedEdit(conn));
  });
  actions.append(edit, remove);
  return row;
}

function icsEdit(conn: IcsConnection) {
  const name = input({ type: 'text', value: conn.name, maxlength: '60' });
  const link = input({ type: 'url', placeholder: 'Leave empty to keep the current link', inputmode: 'url' });
  const pick = swatches(`color-${conn.id}`, conn.color);
  const save = h('button', { type: 'submit', class: 'primary small' }, 'Save');
  const form = h('form', { class: 'editform' }, field('Name', name), h('div', { class: 'field' }, h('span', {}, 'Colour'), pick.el), field('Replace link', link), save);
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(save, async () => {
      setSettings(await api<Settings>('/api/admin/connections/update', { id: conn.id, name: name.value, color: pick.value(), url: link.value || undefined }));
      toast('Saved.');
    });
  });
  return form;
}

function feedEdit(conn: FeedConnection) {
  const name = input({ type: 'text', value: conn.name, maxlength: '60' });
  const url = input({ type: 'url', value: conn.url, inputmode: 'url' });
  const token = input({ type: 'password', placeholder: conn.hasToken ? 'Leave empty to keep the current token' : 'Optional' });
  const save = h('button', { type: 'submit', class: 'primary small' }, 'Save');
  const form = h('form', { class: 'editform' }, field('Name', name), field('Feed URL', url), field('Bearer token', token), save);
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(save, async () => {
      setSettings(await api<Settings>('/api/admin/connections/update', { id: conn.id, name: name.value, url: url.value, ...(token.value ? { token: token.value } : {}) }));
      toast('Saved.');
    });
  });
  return form;
}

// ── add: calendar link ──────────────────────────────────────────────────────

function guide(title: string, ...steps: Array<string | Node>) {
  return h('details', { class: 'guide' }, h('summary', {}, title), h('ol', {}, ...steps.map(s => h('li', {}, s))));
}

function icsForm() {
  const used = state.settings.connections.filter((c): c is IcsConnection => c.kind === 'ics').map(c => c.color);
  const name = input({ type: 'text', placeholder: 'e.g. Family', maxlength: '60', required: 'true' });
  const link = input({ type: 'url', placeholder: 'https://… or webcal://…', inputmode: 'url', required: 'true' });
  const pick = swatches('color-new', CALENDAR_COLORS.find(c => !used.includes(c)) ?? CALENDAR_COLORS[0]);
  const result = h('div', {});
  const test = h('button', { type: 'button', class: 'ghost' }, 'Test link');
  const add = h('button', { type: 'submit', class: 'primary' }, 'Add calendar');

  test.addEventListener('click', () => busy(test, async () => {
    result.replaceChildren(testResult(await api<ConnectionTest>('/api/admin/connections/test', { kind: 'ics', url: link.value })));
  }));
  const form = h('form', { class: 'panel' },
    h('h3', {}, 'Add a calendar link'),
    h('p', { class: 'lede' }, 'Most calendar apps can give you a private iCal link. Anyone with the link can read the calendar, so it is stored encrypted and never shown again.'),
    guide('Google Calendar',
      'On a computer, open calendar.google.com.',
      'Click the gear (top right) → Settings.',
      'Under “Settings for my calendars” on the left, click the calendar.',
      'Scroll to “Integrate calendar” and copy “Secret address in iCal format”.',
      'You can reset that address from the same place at any time; then paste the new one here.'),
    guide('iCloud (iPhone, iPad or Mac)',
      'iPhone/iPad: open Calendar → Calendars → tap ⓘ next to the calendar.',
      'Turn on “Public Calendar”, tap “Share Link…” → Copy.',
      'Mac: in Calendar, Control-click the calendar → Share Calendar → tick “Public Calendar” and copy the link.',
      '“Public” means anyone with the link can view it; the link itself is long and unguessable.'),
    guide('Outlook.com or Microsoft 365',
      'Open Outlook on the web → Settings (gear) → Calendar → Shared calendars.',
      'Under “Publish a calendar”, choose the calendar and “Can view all details”, then Publish.',
      'Copy the ICS link (not the HTML one).'),
    guide('Anything else',
      'Look for “Subscribe”, “iCal”, “ICS” or “webcal” in the app’s sharing or export options.',
      'School, club and sports fixture calendars often offer one.'),
    field('Name on the display', name),
    h('div', { class: 'field' }, h('span', {}, 'Colour'), pick.el),
    field('Calendar link', link),
    result,
    h('div', { class: 'buttons' }, test, add),
  );
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(add, async () => {
      setSettings(await api<Settings>('/api/admin/connections/add', { kind: 'ics', name: name.value, url: link.value, color: pick.value() }));
      openPanel = null;
      render();
      toast('Calendar added.');
    });
  });
  return form;
}

// ── add: agenda feed ────────────────────────────────────────────────────────

function feedForm() {
  const name = input({ type: 'text', placeholder: 'e.g. Household board', maxlength: '60', required: 'true' });
  const url = input({ type: 'url', placeholder: 'https://…', inputmode: 'url', required: 'true' });
  const token = input({ type: 'password', placeholder: 'Optional' });
  const result = h('div', {});
  const test = h('button', { type: 'button', class: 'ghost' }, 'Test feed');
  const add = h('button', { type: 'submit', class: 'primary' }, 'Add feed');
  test.addEventListener('click', () => busy(test, async () => {
    result.replaceChildren(testResult(await api<ConnectionTest>('/api/admin/connections/test', { kind: 'feed', url: url.value, token: token.value })));
  }));
  const form = h('form', { class: 'panel' },
    h('h3', {}, 'Add an agenda feed'),
    h('p', { class: 'lede' }, 'For your own system: any HTTPS endpoint that returns events and tasks in the hub’s agenda feed format (docs/feed-contract.md in the project). The hub sends the token as “Authorization: Bearer …”.'),
    field('Name', name),
    field('Feed URL', url),
    field('Bearer token', token, 'Stored encrypted. Leave empty if the feed needs none.'),
    result,
    h('div', { class: 'buttons' }, test, add),
  );
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(add, async () => {
      setSettings(await api<Settings>('/api/admin/connections/add', { kind: 'feed', name: name.value, url: url.value, token: token.value }));
      openPanel = null;
      render();
      toast('Feed added.');
    });
  });
  return form;
}

// ── Google ──────────────────────────────────────────────────────────────────

function googleRow(conn: GoogleConnection) {
  const shown = conn.calendars.filter(c => c.enabled).length + conn.taskLists.filter(l => l.enabled).length;
  const { row, actions, remove } = rowShell(null, 'Google', conn.account ? `${conn.account} · ${shown} shown` : 'Not connected yet', conn);
  actions.append(remove);
  return row;
}

function googlePanel(conn: GoogleConnection | undefined) {
  const panel = h('div', { class: 'panel', id: 'google' }, h('h3', {}, 'Google Calendar and Tasks'));
  if (conn?.account) {
    panel.append(h('p', { class: 'lede' }, 'Connected as ', h('b', {}, conn.account), '. Choose what the display shows.'));
    panel.append(googleSelection(conn));
    return panel;
  }

  const redirect = state.status.googleRedirectUri;
  panel.append(
    h('p', { class: 'lede' }, 'Google needs a one-off “OAuth client” in your own Google Cloud project. It takes about ten minutes and is free. The hub only asks for read-only access, and for photos it only ever sees the ones you pick.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Open ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud console'), ' and create a project (any name, e.g. “Home and Sky Hub”).'),
      h('li', {}, 'In APIs & Services → Library, enable ', h('b', {}, 'Google Calendar API'), ', ', h('b', {}, 'Google Tasks API'), ' and ', h('b', {}, 'Photos Picker API'), ' (for the photo frame).'),
      h('li', {}, 'In Google Auth Platform (OAuth consent screen): choose ', h('b', {}, 'External'), ', give it a name and your email. Under Audience, add your own Google address as a test user.'),
      h('li', {}, 'Still under Audience, click ', h('b', {}, 'Publish app'), ' so it is “In production”. Otherwise Google stops the connection after 7 days. Google will warn that the app is unverified when you connect; that is expected for an app only you use.'),
      h('li', {}, 'Under Clients → Create client → ', h('b', {}, 'Web application'), '. Add this as an authorised redirect URI:', copyRow(redirect)),
      h('li', {}, 'Copy the Client ID and Client secret into the boxes below, save, then press Connect.'),
    ),
  );
  const clientId = input({ type: 'text', placeholder: '…apps.googleusercontent.com', value: conn?.clientId ?? '' });
  const secret = input({ type: 'password', placeholder: conn ? 'Saved. Leave empty to keep it.' : 'GOCSPX-…' });
  const save = h('button', { type: 'submit', class: conn ? 'ghost' : 'primary' }, conn ? 'Update client' : 'Save client');
  const form = h('form', { class: 'editform' }, field('Client ID', clientId), field('Client secret', secret, 'Stored encrypted.'), h('div', { class: 'buttons' }, save));
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(save, async () => {
      setSettings(await api<Settings>('/api/admin/google/client', { clientId: clientId.value, clientSecret: secret.value }));
      openPanel = 'google';
      render();
      toast('Saved. Now press Connect Google.');
    });
  });
  panel.append(form);

  if (conn) {
    const connect = h('button', { type: 'button', class: 'primary' }, 'Connect Google');
    connect.addEventListener('click', () => busy(connect, async () => {
      const { url } = await api<{ url: string }>('/api/admin/google/start', {});
      location.href = url;
    }));
    panel.append(h('div', { class: 'buttons' }, connect));
  }
  return panel;
}

function googleSelection(conn: GoogleConnection) {
  const wrap = h('div', {});
  const rows = (items: GoogleItem[], kind: 'cal' | 'list') => items.map(item => {
    const box = h('input', { type: 'checkbox', checked: item.enabled, 'data-id': item.id, 'data-kind': kind });
    const pick = swatches(`g-${kind}-${item.id}`, item.color);
    pick.el.dataset.for = item.id;
    const row = h('div', { class: 'gitem' }, h('label', { class: 'gcheck' }, box, h('span', {}, item.name)), pick.el);
    row.style.setProperty('--own', item.color);
    return row;
  });
  const save = h('button', { type: 'button', class: 'primary' }, 'Save selection');
  const refresh = h('button', { type: 'button', class: 'ghost' }, 'Refresh list');
  const disconnect = h('button', { type: 'button', class: 'ghost danger' }, 'Disconnect');

  const collect = (kind: 'cal' | 'list') => [...wrap.querySelectorAll<HTMLInputElement>(`input[type=checkbox][data-kind="${kind}"]`)].map(b => ({
    id: b.dataset.id!,
    enabled: b.checked,
    color: (b.closest('.gitem')!.querySelector('.swatches input:checked') as HTMLInputElement | null)?.value,
  }));
  save.addEventListener('click', () => busy(save, async () => {
    setSettings(await api<Settings>('/api/admin/google/selection', { calendars: collect('cal'), taskLists: collect('list') }));
    toast('Saved. The display picks this up within five minutes.');
  }));
  refresh.addEventListener('click', () => busy(refresh, async () => { setSettings(await api<Settings>('/api/admin/google/choices', {})); }));
  disconnect.addEventListener('click', () => {
    if (!confirm('Disconnect Google? The display stops showing Google calendars until you connect again.')) return;
    busy(disconnect, async () => { setSettings(await api<Settings>('/api/admin/google/disconnect', {})); toast('Disconnected.'); });
  });

  wrap.append(
    h('h4', {}, 'Calendars'),
    ...(conn.calendars.length ? rows(conn.calendars, 'cal') : [h('p', { class: 'empty' }, 'No calendars found.')]),
    h('h4', {}, 'Task lists'),
    ...(conn.taskLists.length ? rows(conn.taskLists, 'list') : [h('p', { class: 'empty' }, 'No task lists found (or the Tasks API is not enabled).')]),
    h('div', { class: 'buttons' }, save, refresh, disconnect),
  );
  return wrap;
}

// ── photos ──────────────────────────────────────────────────────────────────

const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
let photoLibrary: PhotoInfo[] | null = null;
let picking: { sessionId: string; pickerUri: string; status: PickStatus | null } | null = null;

async function reconnectGoogle(btn: HTMLButtonElement) {
  await busy(btn, async () => {
    const { url } = await api<{ url: string }>('/api/admin/google/start', {});
    location.href = url;
  });
}

function photosCard() {
  const card = h('section', { class: 'card', id: 'photos' },
    h('h2', {}, 'Photos'),
    h('p', { class: 'lede' }, 'Pick photos in Google Photos and the hub keeps a copy at screen size for the photo frame. You can open an album in the picker and select everything in it.'),
  );
  const google = state.settings.connections.find((c): c is GoogleConnection => c.kind === 'google');

  if (!state.status.photos) {
    card.append(h('p', { class: 'note' }, 'Photo storage isn’t set up. Run npm run setup again and choose to create the photo bucket (Cloudflare R2, free up to 10 GB).'));
    return card;
  }
  // Adding photos needs Google; the library below doesn't, so it can always be tidied.
  card.append(h('h3', {}, 'Add photos'));
  if (!google?.account) {
    const go = h('button', { type: 'button', class: 'ghost' }, 'Set up Google');
    go.addEventListener('click', () => { openPanel = 'google'; render(); document.getElementById('google')?.scrollIntoView({ behavior: 'smooth' }); });
    card.append(h('p', { class: 'note' }, 'Photos use the same Google connection as calendars. Connect Google first; calendars are optional.'), h('div', { class: 'buttons' }, go));
  } else if (google.scopes && !google.scopes.includes(PHOTOS_SCOPE)) {
    const again = h('button', { type: 'button', class: 'primary' }, 'Reconnect Google');
    again.addEventListener('click', () => reconnectGoogle(again));
    card.append(h('p', { class: 'note' }, 'Google is connected without photo access. Enable the Photos Picker API in your Google Cloud project, then reconnect.'), h('div', { class: 'buttons' }, again));
  } else {
    card.append(picking ? pickingPanel() : pickForm());
  }

  libraryInto(card);
  return card;
}

function pickForm() {
  const collections = [...new Set((photoLibrary ?? []).map(p => p.collection))];
  const collection = input({ type: 'text', value: collections[0] ?? 'Family', maxlength: '40', list: 'collections' });
  const datalist = h('datalist', { id: 'collections' }, ...collections.map(c => h('option', { value: c })));
  const pick = h('button', { type: 'submit', class: 'primary' }, 'Pick photos');
  const form = h('form', { class: 'editform' }, field('Add them to collection', collection, 'Collections help you tidy up later, e.g. “Summer 2026”.'), datalist, h('div', { class: 'buttons' }, pick));
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(pick, async () => {
      const s = await api<{ sessionId: string; pickerUri: string }>('/api/admin/photos/pick', { collection: collection.value || 'Photos' });
      picking = { ...s, status: null };
      render();
      window.open(`${s.pickerUri}/autoclose`, '_blank', 'noopener');
      pollPick();
    });
  });
  return form;
}

function libraryInto(card: HTMLElement) {
  card.append(h('h3', {}, 'Library'));
  if (!photoLibrary) {
    card.append(h('p', { class: 'empty' }, 'Loading…'));
    api<PhotoInfo[]>('/api/admin/photos').then(list => { photoLibrary = list; render(); }).catch(err => toast((err as Error).message, 'error'));
    return;
  }
  if (!photoLibrary.length) {
    card.append(h('p', { class: 'empty' }, 'No photos yet.'));
    return;
  }
  const groups = new Map<string, PhotoInfo[]>();
  for (const p of photoLibrary) groups.set(p.collection, [...(groups.get(p.collection) ?? []), p]);
  for (const [name, photos] of groups) {
    const removeAll = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove collection');
    removeAll.addEventListener('click', () => {
      if (!confirm(`Remove all ${photos.length} photos in “${name}” from the frame? They stay in Google Photos.`)) return;
      busy(removeAll, async () => { photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/delete', { collection: name }); render(); toast('Removed.'); });
    });
    // A place for the whole collection. Google's picker never shares where a photo was taken,
    // so the frame's label is whatever is typed here (or per photo, by tapping it).
    const shared = photos.every(p => p.caption === photos[0].caption) ? photos[0].caption ?? '' : '';
    const place = input({ type: 'text', value: shared, maxlength: '60', placeholder: 'e.g. St Ives, Cornwall', 'aria-label': `Place for ${name}` });
    const savePlace = h('button', { type: 'submit', class: 'ghost small' }, 'Label all');
    const placeForm = h('form', { class: 'searchrow placerow' }, place, savePlace);
    placeForm.addEventListener('submit', e => {
      e.preventDefault();
      busy(savePlace, async () => {
        photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/caption', { collection: name, caption: place.value });
        render();
        toast(place.value.trim() ? `All of “${name}” labelled “${place.value.trim()}”.` : 'Labels cleared.');
      });
    });

    const grid = h('div', { class: 'thumbs' });
    for (const p of photos.slice(0, 48)) {
      const del = h('button', { type: 'button', class: 'thumb-del', 'aria-label': 'Remove this photo' });
      del.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      del.addEventListener('click', () => busy(del, async () => { photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/delete', { ids: [p.id] }); render(); }));
      const edit = h('button', { type: 'button', class: 'thumb-edit', 'aria-label': p.caption ? `Label: ${p.caption}. Change it` : 'Add a label to this photo' },
        h('img', { src: `/api/admin/photos/thumb/${p.id}`, alt: '', loading: 'lazy' }));
      edit.addEventListener('click', async () => {
        const next = prompt('Label for this photo (a place, or who’s in it). Leave empty to remove.', p.caption ?? '');
        if (next === null) return;
        try {
          photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/caption', { ids: [p.id], caption: next });
          render();
        } catch (err) { toast((err as Error).message, 'error'); }
      });
      grid.append(h('figure', { class: 'thumb' }, edit, del, p.caption ? h('figcaption', {}, p.caption) : null));
    }
    card.append(h('div', { class: 'collection' },
      h('div', { class: 'collection-head' }, h('b', {}, name), h('small', {}, `${photos.length} photo${photos.length === 1 ? '' : 's'}`), removeAll),
      placeForm,
      grid,
      h('p', { class: 'hint' }, 'Tap a photo to label it on its own.'),
      photos.length > 48 ? h('p', { class: 'hint' }, `Showing 48 of ${photos.length}.`) : null,
    ));
  }
}

function pickingPanel() {
  const p = picking!;
  const s = p.status;
  const line = !s || s.state === 'waiting'
    ? 'Waiting for you to choose photos in Google Photos. Press Done there when you’ve finished.'
    : s.state === 'importing' ? `Copying photos… ${s.imported} of ${s.total}`
    : s.state === 'done' ? `Done: ${s.imported} photo${s.imported === 1 ? '' : 's'} added${s.skipped ? ` (${s.skipped} skipped: videos or unreadable)` : ''}.`
    : 'That picking session expired. Start again.';
  const open = h('a', { class: 'ghost button-link', href: `${p.pickerUri}/autoclose`, target: '_blank', rel: 'noopener' }, 'Open Google Photos');
  const cancel = h('button', { type: 'button', class: 'ghost' }, s && (s.state === 'done' || s.state === 'expired') ? 'Close' : 'Cancel');
  cancel.addEventListener('click', () => { picking = null; render(); });
  const progress = s?.state === 'importing' && s.total ? h('progress', { max: String(s.total), value: String(s.imported) }) : null;
  return h('div', { class: 'panel' },
    h('p', { class: `result ${s?.state === 'expired' ? 'bad' : 'good'}` }, line),
    progress,
    h('div', { class: 'buttons' }, !s || s.state === 'waiting' ? open : null, cancel),
  );
}

async function pollPick() {
  while (picking && (!picking.status || picking.status.state === 'waiting' || picking.status.state === 'importing')) {
    const current = picking;
    try {
      current.status = await api<PickStatus>('/api/admin/photos/poll', { sessionId: current.sessionId });
    } catch (err) {
      toast((err as Error).message, 'error');
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (picking !== current) return; // cancelled
    if (current.status.state === 'done') photoLibrary = null; // reload the library
    render();
    const wait = current.status.state === 'waiting' ? current.status.pollMs : 300;
    await new Promise(r => setTimeout(r, wait));
  }
}

// ── display ─────────────────────────────────────────────────────────────────

function displaySettings(): DisplaySettings {
  return state.settings.display ?? DEFAULT_DISPLAY;
}

async function saveDisplay(next: DisplaySettings) {
  setSettings(await api<Settings>('/api/admin/display', next));
  toast('Saved. The display picks this up within five minutes.');
}

/** A small preview of each clock style, drawn with markup rather than images. */
function clockPreview(style: ClockStyle): HTMLElement {
  const box = h('span', { class: `cp cp-${style}`, 'aria-hidden': 'true' });
  if (style === 'word') {
    box.append(
      h('span', {}, h('i', {}, 'IT'), ' L ', h('i', {}, 'IS'), ' AS'),
      h('span', {}, h('i', {}, 'HALF'), ' S TEN'),
      h('span', {}, h('i', {}, 'PAST'), ' ER'),
      h('span', {}, 'ON ', h('i', {}, 'NINE')),
    );
  } else if (style === 'digital') {
    box.append('9:30');
  } else if (style === 'analogue') {
    box.innerHTML = '<svg viewBox="-50 -50 100 100" width="58" height="58"><circle r="46" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><line y1="6" y2="-24" stroke="currentColor" stroke-width="5" stroke-linecap="round" transform="rotate(285)"/><line y1="8" y2="-38" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" transform="rotate(180)"/><circle r="3.5" fill="#F59E0B"/></svg>';
  } else {
    for (const ch of ['0', '9', ':', '3', '0']) box.append(h('span', { class: ch === ':' ? 'cp-colon' : 'cp-tile' }, ch));
  }
  return box;
}

const CLOCK_LABELS: Record<ClockStyle, [string, string]> = {
  word: ['Word clock', 'The time spelled out in a letter grid.'],
  digital: ['Digital', 'Large, plain numbers. Easiest from across a room.'],
  analogue: ['Analogue', 'A quiet clock face.'],
  flip: ['Split-flap', 'Flip tiles, matching the overhead board.'],
};

const MOTION_LABELS: Record<MotionLevel, [string, string]> = {
  full: ['Full', 'Letters flip, photos drift, the radar pings when new planes arrive.'],
  gentle: ['Gentle', 'Changes fade softly. Nothing flips, drifts or pings.'],
  still: ['Still', 'No animation at all. Only the aircraft keep moving, because that’s live data.'],
};

function displayCard() {
  const d = displaySettings();
  const card = h('section', { class: 'card', id: 'display' },
    h('h2', {}, 'Display'),
    h('p', { class: 'lede' }, 'How the clock looks, and how much the screens move.'),
  );

  card.append(h('h3', {}, 'Clock'));
  const clocks = h('div', { class: 'clockpicker', role: 'radiogroup', 'aria-label': 'Clock style' });
  for (const style of CLOCK_STYLES) {
    const [title, sub] = CLOCK_LABELS[style];
    const radio = h('input', { type: 'radio', name: 'clock-style', value: style, checked: d.clock === style });
    radio.addEventListener('change', () => saveDisplay({ ...d, clock: style }).catch(err => toast((err as Error).message, 'error')));
    clocks.append(h('label', { class: 'clockopt' }, radio, clockPreview(style), h('b', {}, title), h('small', {}, sub)));
  }
  card.append(clocks);

  card.append(h('h3', {}, 'Motion'));
  const motion = h('div', { class: 'places', role: 'radiogroup', 'aria-label': 'Motion' });
  for (const level of MOTION_LEVELS) {
    const [title, sub] = MOTION_LABELS[level];
    const radio = h('input', { type: 'radio', name: 'motion-level', value: level, checked: d.motion === level });
    radio.addEventListener('change', () => saveDisplay({ ...d, motion: level }).catch(err => toast((err as Error).message, 'error')));
    motion.append(h('div', { class: 'place' }, h('label', { class: 'gcheck' }, radio, h('span', {}, h('b', {}, title), h('small', {}, sub)))));
  }
  card.append(motion, h('p', { class: 'hint' }, 'A tablet set to “Reduce Motion” in its accessibility settings never goes above Gentle.'));

  card.append(h('h3', {}, 'Clothing advice'));
  const warmth = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Clothing advice' });
  const WARMTH_LABELS = { cold: 'I run cold', normal: 'Typical', warm: 'I run warm' } as const;
  for (const w of WARMTH_LEVELS) {
    const r = h('input', { type: 'radio', name: 'warmth', value: w, checked: (d.warmth ?? 'normal') === w });
    r.addEventListener('change', () => saveDisplay({ ...d, warmth: w }).catch(err => toast((err as Error).message, 'error')));
    warmth.append(h('label', {}, r, h('span', {}, WARMTH_LABELS[w])));
  }
  card.append(warmth, h('p', { class: 'hint' }, 'The weather screen’s “What to wear” dresses you for about 3° colder or warmer than it feels.'));

  card.append(h('h3', {}, 'Photo frame'));
  const photoStyle = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Photo frame style' });
  const PHOTO_LABELS = { fill: 'Full screen', framed: 'Framed prints' } as const;
  for (const style of PHOTO_STYLES) {
    const r = h('input', { type: 'radio', name: 'photo-style', value: style, checked: (d.photoStyle ?? 'fill') === style });
    r.addEventListener('change', () => saveDisplay({ ...d, photoStyle: style }).catch(err => toast((err as Error).message, 'error')));
    photoStyle.append(h('label', {}, r, h('span', {}, PHOTO_LABELS[style])));
  }
  card.append(photoStyle, h('p', { class: 'hint' }, 'Framed shows each photo as a mounted print with its place and date underneath. Portrait photos are always shown in pairs.'));
  return card;
}

// ── sky ─────────────────────────────────────────────────────────────────────

function skySettings(): SkySettings {
  return state.settings.sky ?? { places: [], active: 'default', radiusNm: 25 };
}

async function saveSky(next: SkySettings, message = 'Saved.') {
  setSettings(await api<Settings>('/api/admin/sky', next));
  toast(message);
}

function skyCard() {
  const sky = skySettings();
  const card = h('section', { class: 'card', id: 'sky' },
    h('h2', {}, 'Sky'),
    h('p', { class: 'lede' }, 'Where the radar and the overhead board are centred, and how far they look. On the display, tap the middle of the radar to step through your places.'),
  );

  // Centre
  card.append(h('h3', {}, 'Centre on'));
  const list = h('div', { class: 'places', role: 'radiogroup', 'aria-label': 'Centre the sky screens on' });
  const option = (id: string, title: string, sub: string, removable: boolean) => {
    const radio = h('input', { type: 'radio', name: 'sky-active', value: id, checked: sky.active === id });
    radio.addEventListener('change', () => saveSky({ ...sky, active: id }).catch(err => toast((err as Error).message, 'error')));
    const row = h('div', { class: 'place' }, h('label', { class: 'gcheck' }, radio, h('span', {}, h('b', {}, title), h('small', {}, sub))));
    if (removable) {
      const remove = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove');
      remove.addEventListener('click', () => busy(remove, () => saveSky({ ...sky, places: sky.places.filter(p => p.id !== id) }, 'Removed.')));
      row.append(remove);
    }
    return row;
  };
  for (const p of sky.places) list.append(option(p.id, p.name, `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`, true));
  list.append(option('device', 'Each display’s own location', 'Uses the tablet’s GPS or Wi-Fi location. The tablet asks permission the first time.', false));
  if (!sky.places.length) list.prepend(h('p', { class: 'empty' }, 'No places saved yet, so each display uses its own location, or roughly where its internet connection is.'));
  card.append(list);

  // Add a place
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
  card.append(h('h3', {}, 'Add a place'), form, results, h('div', { class: 'buttons' }, here),
    h('p', { class: 'hint' }, 'Places are rounded to about 1 km. That’s plenty for a radar, and your exact address is never stored.'));

  // Range
  const radius = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Radar range' });
  for (const nm of RADIUS_CHOICES) {
    const r = h('input', { type: 'radio', name: 'sky-radius', value: String(nm), checked: sky.radiusNm === nm });
    r.addEventListener('change', () => saveSky({ ...sky, radiusNm: nm }).catch(err => toast((err as Error).message, 'error')));
    radius.append(h('label', {}, r, h('span', {}, `${nm} nm`)));
  }
  card.append(h('h3', {}, 'Range'), radius, h('p', { class: 'hint' }, '25 nm (46 km) suits most places. Near a big airport, 10–15 nm keeps the radar calm.'));
  return card;
}

// ── boot ────────────────────────────────────────────────────────────────────

logoutBtn.addEventListener('click', async () => {
  await api('/api/admin/logout', {}).catch(() => {});
  renderLogin();
});

const params = new URLSearchParams(location.search);
const googleResult = params.get('google');
if (googleResult) {
  const messages: Record<string, [string, 'ok' | 'error']> = {
    connected: ['Google connected. Choose which calendars to show.', 'ok'],
    expired: ['That Google sign-in took too long. Press Connect Google again.', 'error'],
    failed: ['Google sign-in did not finish. Check the client ID, secret and redirect URI.', 'error'],
    access_denied: ['Google access was not granted.', 'error'],
  };
  const [msg, kind] = messages[googleResult] ?? [`Google sign-in failed (${googleResult}).`, 'error'];
  setTimeout(() => toast(msg, kind), 300);
  history.replaceState(null, '', `/setup${location.hash}`);
}

load();
