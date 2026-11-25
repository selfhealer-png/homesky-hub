import type { GoogleItem, Settings } from '../../shared/settings';
import type { DeviceAlbum } from '../../shared/device';
import { render, setSettings, state } from './store';
import { api, busy, card, h, iosSwitch, toast } from './ui';

// Settings for what the iOS app reads from the iPad itself: its calendars and reminders
// (EventKit) and an Apple Photos album. Shown only when the hub runs as the app (status.device).

interface Choices { calendars: GoogleItem[]; reminderLists: GoogleItem[]; problems: string[] }

let albums: DeviceAlbum[] | null = null;
let albumNote = '';

function itemRow(item: GoogleItem, onToggle: (on: boolean) => Promise<unknown>) {
  const sw = iosSwitch(item.enabled, `Show ${item.name}`, onToggle);
  return h('div', { class: 'row' }, h('span', { class: 'swatch', style: `background:${item.color}` }), h('div', { class: 'meta' }, h('b', {}, item.name)), sw);
}

async function saveSelection(next: { calendars: GoogleItem[]; reminderLists: GoogleItem[] }) {
  setSettings(await api<Settings>('/api/admin/device/selection', next));
}

/** "Calendars on this iPad": every calendar and reminder list set up in the iPad's Settings. */
export function deviceCalendarsCard(): Node | null {
  if (!state.status.device) return null;
  const s = state.settings.device;
  const body: Node[] = [];
  const ask = h('button', { type: 'button', class: s ? 'ghost' : 'primary' }, s ? 'Look for new calendars' : 'Use calendars on this iPad');
  ask.addEventListener('click', () => busy(ask, async () => {
    const c = await api<Choices>('/api/admin/device/choices', {});
    await saveSelection({ calendars: c.calendars, reminderLists: c.reminderLists });
    if (c.problems.length) toast(c.problems.join(' '), 'error');
    else toast('Tick the calendars and lists to show.');
  }));
  if (!s) {
    body.push(h('p', { class: 'lede' }, 'Show the calendars and reminders already on this iPad: iCloud, and any Google, Exchange or other accounts added in the iPad’s Settings. Nothing to sign in to here. The app only reads them.'));
  } else {
    const toggle = (kind: 'calendars' | 'reminderLists', id: string) => (on: boolean) => {
      const next = { calendars: [...s.calendars], reminderLists: [...s.reminderLists] };
      next[kind] = next[kind].map(i => (i.id === id ? { ...i, enabled: on } : i));
      return saveSelection(next);
    };
    body.push(h('h4', {}, 'Calendars'));
    body.push(s.calendars.length ? h('div', { class: 'rows' }, ...s.calendars.map(c => itemRow(c, toggle('calendars', c.id)))) : h('p', { class: 'empty' }, 'No calendars, or access wasn’t given.'));
    body.push(h('h4', {}, 'Reminders'));
    body.push(s.reminderLists.length ? h('div', { class: 'rows' }, ...s.reminderLists.map(l => itemRow(l, toggle('reminderLists', l.id)))) : h('p', { class: 'empty' }, 'No reminder lists, or access wasn’t given.'));
  }
  body.push(h('div', { class: 'buttons' }, ask));
  return card('On this iPad', ...body);
}

/** "Apple Photos": one album, shown live as it changes (a Shared Album works too). */
export function applePhotosCard(): Node | null {
  if (!state.status.device) return null;
  const current = state.settings.photoSource;
  const body: Node[] = [current
    ? h('p', { class: 'lede' }, 'Showing ', h('b', {}, current.title), '. Photos added to it appear on the frame within a couple of minutes.')
    : h('p', { class: 'lede' }, 'Show an album from the Photos app, including a Shared Album the family adds to. It’s shown live, so new photos appear on their own. Nothing is copied.')];

  const choose = h('button', { type: 'button', class: current ? 'ghost' : 'primary' }, current ? 'Choose another album' : 'Choose an album');
  choose.addEventListener('click', () => busy(choose, async () => {
    const r = await api<{ limited: boolean; albums: DeviceAlbum[] }>('/api/admin/device/albums', {});
    albums = r.albums;
    albumNote = r.limited ? 'The app can only see the photos you selected. To show a whole album as it grows, allow access to all photos in the iPad’s Settings › Home&Sky Hub › Photos.' : '';
    render();
  }));
  const buttons = h('div', { class: 'buttons' }, choose);
  if (current) {
    const stop = h('button', { type: 'button', class: 'ghost danger' }, 'Stop showing it');
    stop.addEventListener('click', () => busy(stop, async () => { setSettings(await api<Settings>('/api/admin/photos/source', { kind: null })); }));
    buttons.append(stop);
  }
  body.push(buttons);

  if (albums) {
    if (albumNote) body.push(h('p', { class: 'note' }, albumNote));
    const list = h('div', { class: 'rows' });
    for (const a of albums) {
      const pick = h('button', { type: 'button', class: `row row-button${current?.albumId === a.id ? ' on' : ''}` },
        h('div', { class: 'meta' }, h('b', {}, a.title), h('small', {}, `${a.count} photo${a.count === 1 ? '' : 's'}${a.shared ? ' · Shared Album' : ''}`)));
      pick.addEventListener('click', () => busy(pick as HTMLButtonElement, async () => {
        setSettings(await api<Settings>('/api/admin/photos/source', { kind: 'apple', albumId: a.id, title: a.title }));
        albums = null;
        toast(`Showing ${a.title}.`);
      }));
      list.append(pick);
    }
    body.push(albums.length ? list : h('p', { class: 'empty' }, 'No albums found in Photos.'));
  }
  return card('Apple Photos', ...body);
}
