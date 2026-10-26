import './setup.css';
import type { AdminState } from '../../shared/settings';
import { accountsPage, googleConnection } from './accounts';
import { aboutPage, hubProblems, motionPage, MOTION_LABELS, nightPage, nightSummary, SCREENS, screenPage, screenRow } from './pages';
import { placesPage } from './sky';
import { displaySettings, onRender, placeName, setState, state } from './store';
import { api, busy, field, group, h, HttpError, input, row, tile, toast } from './ui';

// The admin setup page, laid out like a phone's Settings app: a list of the hub's screens (each
// with an on/off switch and its own page), then the hub-wide settings. Pages are hash routes
// (#/screens/radar, #/places…) so Back works and a page can be linked to.

const app = document.getElementById('app')!;
const logoutBtn = document.getElementById('logout') as HTMLButtonElement;

// ── login ───────────────────────────────────────────────────────────────────

function renderLogin(message?: string) {
  logoutBtn.hidden = true;
  const pw = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: 'true' });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');
  const form = h('form', { class: 'card login' },
    h('h2', {}, 'Sign in'),
    h('p', { class: 'lede' }, 'Use the admin password that ', h('code', {}, 'npm run setup'), ' printed.'),
    message ? h('p', { class: 'result bad' }, message) : null,
    // A hidden username lets password managers save and fill the admin password.
    input({ type: 'text', name: 'username', autocomplete: 'username', value: 'admin', hidden: 'true' }),
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

async function load() {
  try {
    setState(await api<AdminState>('/api/admin/state'));
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return renderLogin();
    app.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'result bad' }, (err as Error).message)));
    return;
  }
  logoutBtn.hidden = false;
  onRender(render);
  render();
}

// ── routes ──────────────────────────────────────────────────────────────────

/** Links from before the pages existed (the Google sign-in used to come back to #calendars). */
const OLD_ANCHORS: Record<string, string> = {
  '#calendars': '#/accounts', '#google': '#/accounts', '#sky': '#/places', '#photos': '#/screens/photos', '#display': '#/', '#status': '#/about',
};

function page(route: string): Node[] {
  const screen = /^#\/screens\/(\w+)$/.exec(route);
  if (screen) {
    const def = SCREENS.find(s => s.id === screen[1]);
    if (def) return screenPage(def);
  }
  switch (route) {
    case '#/places': return placesPage();
    case '#/accounts': return accountsPage();
    case '#/night': return nightPage();
    case '#/motion': return motionPage();
    case '#/about': return aboutPage();
    default: return listPage();
  }
}

function render() {
  if (!state) return;
  app.replaceChildren(...page(location.hash));
}

window.addEventListener('hashchange', () => {
  if (OLD_ANCHORS[location.hash]) return location.replace(OLD_ANCHORS[location.hash]);
  render();
  window.scrollTo(0, 0);
  // Move focus to the new page's title, so a screen reader announces where it landed.
  (app.querySelector('h2[tabindex]') as HTMLElement | null)?.focus({ preventScroll: true });
});

// ── the list ────────────────────────────────────────────────────────────────

const HUB_ICONS = {
  places: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  accounts: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  night: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/><path d="M17 4v3M15.5 5.5h3"/>',
  motion: '<path d="M3 12c2.5-5 5.5-5 8 0s5.5 5 8 0"/><path d="M3 18c2.5-3 5.5-3 8 0"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

function accountsSummary() {
  const conns = state.settings.connections;
  const google = googleConnection();
  const links = conns.filter(c => c.kind === 'ics').length;
  const feeds = conns.filter(c => c.kind === 'feed').length;
  const parts = [
    google?.account ? 'Google' : google ? 'Google (not finished)' : '',
    links ? `${links} calendar link${links === 1 ? '' : 's'}` : '',
    feeds ? `${feeds} feed${feeds === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing connected';
}

function listPage() {
  const problems = hubProblems();
  const neutral = '#64748B';
  return [
    h('h2', { class: 'listtitle', tabindex: '-1' }, 'Settings'),
    group('Screens', SCREENS.map(screenRow), 'Switched-off screens leave the display’s rotation within five minutes. A screen with nothing to show yet stays out until it has.'),
    group('Hub', [
      row({ icon: tile(HUB_ICONS.places, '#0EA5E9'), title: 'Places', summary: placeName(), href: '#/places' }),
      row({ icon: tile(HUB_ICONS.accounts, '#2563FF'), title: 'Accounts', summary: accountsSummary(), href: '#/accounts' }),
      row({ icon: tile(HUB_ICONS.night, '#4F46E5'), title: 'Night', summary: nightSummary(), href: '#/night' }),
      row({ icon: tile(HUB_ICONS.motion, neutral), title: 'Motion', summary: MOTION_LABELS[displaySettings().motion][0], href: '#/motion' }),
      row({ icon: tile(HUB_ICONS.about, neutral), title: 'This hub', summary: problems ? 'Needs attention' : 'Storage, add another screen', needs: problems > 0, href: '#/about' }),
    ]),
  ];
}

// ── boot ────────────────────────────────────────────────────────────────────

logoutBtn.addEventListener('click', async () => {
  await api('/api/admin/logout', {}).catch(() => {});
  renderLogin();
});

if (OLD_ANCHORS[location.hash]) history.replaceState(null, '', `${location.pathname}${location.search}${OLD_ANCHORS[location.hash]}`);

const params = new URLSearchParams(location.search);
const googleResult = params.get('google');
if (googleResult) {
  const messages: Record<string, [string, 'ok' | 'error']> = {
    connected: ['Google connected. Choose which calendars to show on the Home page.', 'ok'],
    expired: ['That Google sign-in took too long. Press Connect Google again.', 'error'],
    failed: ['Google sign-in did not finish. Check the client ID, secret and redirect URI.', 'error'],
    access_denied: ['Google didn’t allow the connection. If it said “Access blocked”, fill in Branding and publish the app (steps 4 and 5), then try again.', 'error'],
  };
  const [msg, kind] = messages[googleResult] ?? [`Google sign-in failed (${googleResult}).`, 'error'];
  setTimeout(() => toast(msg, kind), 300);
  history.replaceState(null, '', `/setup${location.hash}`);
}

load();
