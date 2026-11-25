import { deviceCalendarsCard } from './device';
import {
  CALENDAR_COLORS, googleGranted,
  type Connection, type ConnectionTest, type FeedConnection, type GoogleConnection, type GoogleItem, type GooglePart, type GoogleWants, type IcsConnection, type Settings,
} from '../../shared/settings';
import { render, setSettings, state } from './store';
import { api, busy, card, copyRow, field, guide, h, input, pageHead, swatches, testResult, toast } from './ui';
import { connectGoogleNative, SignInCancelled } from '../googleNative';

// Accounts: where calendars, tasks and photos come from. Connecting and managing them lives here;
// choosing which calendars the Home screen shows lives on the Home page (calendarChoices below).

let openPanel: 'ics' | 'feed' | 'google' | null = null;

/** The person's choice of what to use Google for, while they're setting it up. */
let googleDraft: GoogleWants | null = null;

export const googleConnection = () => state.settings.connections.find((c): c is GoogleConnection => c.kind === 'google');

/** From the Photos page: open Google setup here with Photos ticked. */
export function startGoogleForPhotos() {
  const google = googleConnection();
  googleDraft = { ...(google?.wants ?? { calendar: false, tasks: false, photos: false }), photos: true };
  openPanel = 'google';
}

export function accountsPage(): Node[] {
  const conns = state.settings.connections;
  const google = googleConnection();
  const list = h('div', { class: 'conns' });
  conns.filter(c => c.kind !== 'google').forEach(c => list.append(connRow(c as IcsConnection | FeedConnection)));
  if (google) list.append(googleRow(google));
  if (!conns.length) list.append(h('p', { class: 'empty' }, 'Nothing connected yet. Add a calendar below.'));

  const connected = card('Connected',
    state.status.envFeed ? h('p', { class: 'note' }, 'An agenda feed is also set as a deployment variable (AGENDA_FEED_URL). It is shown alongside these.') : null,
    list,
    h('p', { class: 'hint' }, 'Choose which calendars the Home screen shows on the ', h('a', { href: '#/screens/home' }, 'Home page'), '.'));

  const choose = (panel: typeof openPanel, label: string, hint: string) => {
    const b = h('button', { type: 'button', class: `choice${openPanel === panel ? ' on' : ''}`, 'aria-expanded': String(openPanel === panel) }, h('b', {}, label), h('small', {}, hint));
    b.addEventListener('click', () => {
      if (panel === 'google' && openPanel !== 'google') googleDraft = null;
      openPanel = openPanel === panel ? null : panel;
      render();
    });
    return b;
  };
  const add = card('Add a calendar', h('div', { class: 'choices' },
    choose('ics', 'Calendar link', 'Google, iCloud, Outlook (iCal)'),
    google ? null : choose('google', 'Google account', 'Calendar, Tasks and Photos'),
    choose('feed', 'Agenda feed', 'Your own server (JSON)'),
  ));
  if (openPanel === 'ics') add.append(icsForm());
  if (openPanel === 'feed') add.append(feedForm());
  if (openPanel === 'google' && !google) add.append(googlePanel(undefined));

  return [
    pageHead('Accounts', 'Where calendars, tasks and photos come from. Everything is read-only: the hub can show your calendars but never change them.'),
    connected,
    deviceCalendarsCard(),
    google ? googlePanel(google) : null,
    add,
  ].filter((n): n is HTMLElement => !!n);
}

// ── connected rows ──────────────────────────────────────────────────────────

function rowShell(color: string | null, title: string, sub: string, conn: Connection) {
  const row = h('div', { class: 'conn' });
  if (color) row.style.setProperty('--own', color);
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
  const actions = h('div', { class: 'actions' }, test);
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
      const next = await api<Settings>('/api/admin/connections/add', { kind: 'ics', name: name.value, url: link.value, color: pick.value() });
      openPanel = null;
      setSettings(next);
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
      const next = await api<Settings>('/api/admin/connections/add', { kind: 'feed', name: name.value, url: url.value, token: token.value });
      openPanel = null;
      setSettings(next);
      toast('Feed added.');
    });
  });
  return form;
}

// ── Google ──────────────────────────────────────────────────────────────────

const PART_NAMES: Record<GooglePart, string> = { calendar: 'Calendars', tasks: 'Tasks', photos: 'Photos' };
const grantedParts = (conn: GoogleConnection) => (Object.keys(PART_NAMES) as GooglePart[]).filter(p => googleGranted(conn, p));

function googleRow(conn: GoogleConnection) {
  const sub = conn.account ? `${conn.account} · ${grantedParts(conn).map(p => PART_NAMES[p]).join(', ')}` : 'Not connected yet';
  const { row, actions, remove } = rowShell(null, 'Google', sub, conn);
  actions.append(remove);
  return row;
}

function googleWantsNow(conn: GoogleConnection | undefined): GoogleWants {
  return googleDraft ?? conn?.wants ?? { calendar: true, tasks: true, photos: false };
}

/** "What would you like to use from Google?" Three independent choices. */
function googleQuestion(conn: GoogleConnection | undefined, onChange: () => void) {
  const wants = googleWantsNow(conn);
  const options: Array<[GooglePart, string, string]> = [
    ['calendar', 'Calendars', 'Your Google calendars on the Home screen.'],
    ['tasks', 'Tasks', 'Google Tasks that are due, on the Home screen.'],
    ['photos', 'Photos', 'Pick photos for the photo frame.'],
  ];
  const box = h('div', { class: 'gparts', role: 'group', 'aria-label': 'What to use Google for' });
  for (const [part, title, sub] of options) {
    const check = h('input', { type: 'checkbox', checked: wants[part] });
    check.addEventListener('change', () => { googleDraft = { ...googleWantsNow(conn), [part]: check.checked }; onChange(); });
    box.append(h('label', { class: 'gpart' }, check, h('span', {}, h('b', {}, title), h('small', {}, sub))));
  }
  return h('div', {}, h('h4', {}, 'What would you like to use from Google?'), box);
}

export async function connectGoogle(btn: HTMLButtonElement, wants: GoogleWants) {
  // The iOS app signs in with its own client, in the system sheet, and comes straight back.
  if (state.status.nativeGoogle) {
    return busy(btn, async () => {
      try {
        setSettings(await connectGoogleNative(wants));
        googleDraft = null;
        toast('Google connected. Choose what to show below.');
      } catch (err) {
        if (!(err instanceof SignInCancelled)) throw err;
      }
    });
  }
  await busy(btn, async () => {
    const { url } = await api<{ url: string }>('/api/admin/google/start', { wants });
    googleDraft = null;
    location.href = url;
  });
}

function googlePanel(conn: GoogleConnection | undefined) {
  const panel = h('section', { class: conn ? 'card' : 'panel', id: 'google' }, h('h3', {}, 'Google'));
  if (conn?.account) {
    const disconnect = h('button', { type: 'button', class: 'ghost danger' }, 'Disconnect');
    disconnect.addEventListener('click', () => {
      if (!confirm('Disconnect Google? The display stops showing Google calendars until you connect again.')) return;
      busy(disconnect, async () => { setSettings(await api<Settings>('/api/admin/google/disconnect', {})); toast('Disconnected.'); });
    });
    panel.append(h('p', { class: 'lede' }, 'Connected as ', h('b', {}, conn.account), '. Used for ', grantedParts(conn).map(p => PART_NAMES[p].toLowerCase()).join(', ') || 'nothing yet', '.'));
    // Change which parts Google is used for: reconnects, asking only for what's ticked.
    const change = h('details', { class: 'guide' }, h('summary', {}, 'Change what Google is used for'));
    const update = h('button', { type: 'button', class: 'ghost' }, 'Reconnect with these');
    update.addEventListener('click', () => connectGoogle(update, googleWantsNow(conn)));
    change.append(googleQuestion(conn, () => { /* the box keeps its own state */ }), h('div', { class: 'buttons' }, update));
    panel.append(change, h('div', { class: 'buttons' }, disconnect));
    return panel;
  }
  panel.append(googleQuestion(conn, render));
  const wants = googleWantsNow(conn);

  if (state.status.nativeGoogle) {
    const connect = h('button', { type: 'button', class: 'primary' }, 'Connect Google');
    const nothing = !wants.calendar && !wants.tasks && !wants.photos;
    if (nothing) connect.setAttribute('disabled', '');
    connect.addEventListener('click', () => connectGoogle(connect, wants));
    panel.append(
      h('p', { class: 'lede' }, 'Sign in to Google. The app only ever gets read-only access, and for photos it only sees the ones you pick. Everything stays on this iPad.'),
      h('div', { class: 'buttons' }, connect));
    if (nothing) panel.append(h('p', { class: 'hint' }, 'Tick at least one thing to use Google for.'));
    return panel;
  }

  const redirect = state.status.googleRedirectUri;
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  panel.append(
    h('p', { class: 'lede' }, 'Google only lets a hub read your account through a sign-in “client” that you create in your own free Google Cloud project. It takes about ten minutes, once. The hub only ever gets read-only access, and for photos it only sees the ones you pick.'),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Create a project. '), link('https://console.cloud.google.com/projectcreate', 'Open Google Cloud'), ', give it any name (e.g. “Home and Sky Hub”) and press Create. Make sure it’s the project selected at the top of the page for the next steps.'),
      serviceStep(wants, link),
      h('li', {}, h('b', {}, 'Set up the sign-in screen. '), link('https://console.cloud.google.com/auth/overview', 'Open Google Auth Platform'), ' and press Get started. App name: anything. Support email: yours. Audience: ', h('b', {}, 'External'), '. Contact email: yours. Then Create.'),
      h('li', {}, h('b', {}, 'Fill in Branding. '), link('https://console.cloud.google.com/auth/branding', 'Open Branding'), '. Google won’t publish until the required fields are filled in: app name, user support email and developer contact email. The logo and website links are optional; leave them empty. Press Save.'),
      h('li', {}, h('b', {}, 'Publish it. '), link('https://console.cloud.google.com/auth/audience', 'Open Audience'), ', press ', h('b', {}, 'Publish app'), ' and confirm, so it says “In production”. Skip this and Google blocks the sign-in (“Access blocked … has not completed the Google verification process”), or disconnects the hub after 7 days. If Google says to complete Branding first, go back to step 4.'),
      h('li', {}, h('b', {}, 'Create the client. '), link('https://console.cloud.google.com/auth/clients', 'Open Clients'), ', press Create client, choose ', h('b', {}, 'Web application'), '. Under “Authorised redirect URIs” press Add URI and paste exactly:', copyRow(redirect), 'Then press Create.'),
      h('li', {}, h('b', {}, 'Paste the two codes below. '), 'Google shows a Client ID and a Client secret. Copy both into the boxes below, press Save client, then Connect Google.'),
    ),
    googleTroubleshooting(redirect),
  );
  const clientId = input({ type: 'text', placeholder: '…apps.googleusercontent.com', value: conn?.clientId ?? '' });
  const secret = input({ type: 'password', placeholder: conn ? 'Saved. Leave empty to keep it.' : 'GOCSPX-…' });
  const save = h('button', { type: 'submit', class: conn ? 'ghost' : 'primary' }, conn ? 'Update client' : 'Save client');
  const form = h('form', { class: 'editform' }, field('Client ID', clientId), field('Client secret', secret, 'Stored encrypted.'), h('div', { class: 'buttons' }, save));
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(save, async () => {
      setSettings(await api<Settings>('/api/admin/google/client', { clientId: clientId.value, clientSecret: secret.value }));
      toast('Saved. Now press Connect Google.');
    });
  });
  panel.append(form);

  if (conn) {
    const connect = h('button', { type: 'button', class: 'primary' }, 'Connect Google');
    const nothing = !wants.calendar && !wants.tasks && !wants.photos;
    if (nothing) connect.setAttribute('disabled', '');
    connect.addEventListener('click', () => connectGoogle(connect, wants));
    panel.append(h('div', { class: 'buttons' }, connect));
    if (nothing) panel.append(h('p', { class: 'hint' }, 'Tick at least one thing to use Google for.'));
  }
  return panel;
}

/** Step 2: only the Google services for what was chosen. */
function serviceStep(wants: GoogleWants, link: (href: string, text: string) => HTMLElement) {
  const services: Array<[GooglePart, string, string]> = [
    ['calendar', 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Calendar'],
    ['tasks', 'https://console.cloud.google.com/apis/library/tasks.googleapis.com', 'Tasks'],
    ['photos', 'https://console.cloud.google.com/apis/library/photospicker.googleapis.com', 'Photos Picker'],
  ];
  const chosen = services.filter(([part]) => wants[part]);
  if (!chosen.length) return h('li', {}, h('b', {}, 'Turn on services. '), 'Tick at least one option above first.');
  const words = ['', 'one service', 'two services', 'three services'];
  const parts: Array<Node | string> = [];
  chosen.forEach(([, href, name], i) => { if (i) parts.push(', '); parts.push(link(href, name)); });
  return h('li', {}, h('b', {}, `Turn on ${words[chosen.length]}. `), 'Open each and press Enable: ', ...parts, '.');
}

/** What Google shows during Connect, and what to do about each screen. */
function googleTroubleshooting(redirect: string) {
  return h('details', { class: 'guide' },
    h('summary', {}, 'What you’ll see when you press Connect Google'),
    h('ol', {},
      h('li', {}, h('b', {}, '“Google hasn’t verified this app”. '), 'Expected: the app is yours and only you use it. Press ', h('b', {}, 'Advanced'), ', then ', h('b', {}, 'Go to … (unsafe)'), ', then Continue.'),
      h('li', {}, h('b', {}, 'A list of permissions. '), 'Tick them all (calendars, tasks and photos you pick) and press Continue. It’s read-only.'),
      h('li', {}, h('b', {}, '“Access blocked: … has not completed the Google verification process”. '), 'The app is still in Testing. Do steps 4 and 5 (Branding, then Publish app), then press Connect Google again.'),
      h('li', {}, h('b', {}, '“Error 400: redirect_uri_mismatch”. '), 'The redirect URI in step 6 doesn’t match exactly. It must be:', copyRow(redirect)),
      h('li', {}, h('b', {}, '“Google refused photo access”. '), 'The Photos Picker service isn’t turned on (step 2). Enable it, then press Reconnect Google.'),
    ),
  );
}

// ── for the Home page: which calendars show ─────────────────────────────────

/** How many calendars and task lists the Home screen is showing. Feeds count as calendars. */
export function calendarCount(): { calendars: number; lists: number } {
  const google = googleConnection();
  const own = state.settings.connections.filter(c => c.kind !== 'google' && c.enabled).length + (state.status.envFeed ? 1 : 0);
  if (!google?.enabled || !google.account) return { calendars: own, lists: 0 };
  return {
    calendars: own + (googleGranted(google, 'calendar') ? google.calendars.filter(c => c.enabled).length : 0),
    lists: googleGranted(google, 'tasks') ? google.taskLists.filter(l => l.enabled).length : 0,
  };
}

/** Switches for each calendar link and feed, and Google's calendars and task lists. */
export function calendarChoices(): Node[] {
  const conns = state.settings.connections.filter((c): c is IcsConnection | FeedConnection => c.kind !== 'google');
  const google = googleConnection();
  const out: Node[] = [];

  if (conns.length) {
    const list = h('div', { class: 'conns' });
    for (const conn of conns) {
      const row = h('div', { class: 'conn' });
      if (conn.kind === 'ics') row.style.setProperty('--own', conn.color);
      const toggle = h('input', { type: 'checkbox', role: 'switch', class: 'ios', checked: conn.enabled, 'aria-label': `Show ${conn.name}` });
      toggle.addEventListener('change', async () => {
        try { setSettings(await api<Settings>('/api/admin/connections/update', { id: conn.id, enabled: toggle.checked })); }
        catch (err) { toast((err as Error).message, 'error'); toggle.checked = !toggle.checked; }
      });
      row.append(h('span', { class: 'ring', 'aria-hidden': 'true' }),
        h('div', { class: 'meta' }, h('b', {}, conn.name), h('small', {}, conn.kind === 'ics' ? 'Calendar link' : 'Agenda feed')),
        h('div', { class: 'actions' }, toggle));
      list.append(row);
    }
    out.push(card('Calendars', list));
  }

  if (google?.account && (googleGranted(google, 'calendar') || googleGranted(google, 'tasks'))) out.push(googleSelection(google));

  if (!out.length) {
    out.push(card('Calendars',
      h('p', { class: 'empty' }, state.status.envFeed ? 'Only the agenda feed set as a deployment variable is connected.' : 'No calendars yet, so the Home screen has nothing to show.'),
      h('div', { class: 'buttons' }, h('a', { href: '#/accounts', class: 'primary button-link' }, 'Add a calendar'))));
  }
  return out;
}

function googleSelection(conn: GoogleConnection) {
  const wrap = h('section', { class: 'card' });
  const rows = (items: GoogleItem[], kind: 'cal' | 'list') => items.map(item => {
    const box = h('input', { type: 'checkbox', checked: item.enabled, 'data-id': item.id, 'data-kind': kind });
    const pick = swatches(`g-${kind}-${item.id}`, item.color);
    pick.el.dataset.for = item.id;
    const row = h('div', { class: 'gitem' }, h('label', { class: 'gcheck' }, box, h('span', {}, item.name)), pick.el);
    row.style.setProperty('--own', item.color);
    return row;
  });
  const master = h('input', { type: 'checkbox', role: 'switch', class: 'ios', checked: conn.enabled, 'aria-label': 'Show Google calendars and tasks' });
  master.addEventListener('change', async () => {
    try { setSettings(await api<Settings>('/api/admin/connections/update', { id: conn.id, enabled: master.checked })); }
    catch (err) { toast((err as Error).message, 'error'); master.checked = !master.checked; }
  });
  const save = h('button', { type: 'button', class: 'primary' }, 'Save selection');
  const refresh = h('button', { type: 'button', class: 'ghost' }, 'Refresh list');

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

  wrap.append(
    h('div', { class: 'cardhead' }, h('h3', {}, 'Google'), master),
    h('p', { class: 'hint' }, conn.account),
    ...(googleGranted(conn, 'calendar') ? [h('h4', {}, 'Calendars'),
      ...(conn.calendars.length ? rows(conn.calendars, 'cal') : [h('p', { class: 'empty' }, 'No calendars found.')])] : []),
    ...(googleGranted(conn, 'tasks') ? [h('h4', {}, 'Task lists'),
      ...(conn.taskLists.length ? rows(conn.taskLists, 'list') : [h('p', { class: 'empty' }, 'No task lists found (or the Tasks API is not enabled).')])] : []),
    h('div', { class: 'buttons' }, save, refresh),
  );
  return wrap;
}
