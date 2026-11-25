import type { DeviceAccess, DeviceCalendar } from '../shared/device';
import type { GoogleItem, PhotoInfo, Settings } from '../shared/settings';
import type { Env } from './env';
import { agendaWindow, ProviderError, type ProviderResult } from './providers/common';

// The iPad's own calendars, reminders and photo albums, for the iOS app (env.DEVICE; see
// shared/device.ts). Everything is read on the device itself: nothing leaves it.

class DeviceUnavailable extends ProviderError {}

function device(env: Env) {
  if (!env.DEVICE) throw new DeviceUnavailable('This only works in the iPad app.');
  return env.DEVICE;
}

const ACCESS_TEXT: Record<DeviceAccess, string> = {
  granted: '',
  limited: '',
  notDetermined: '',
  denied: 'Access was turned off. Turn it on in the iPad’s Settings › Home&Sky Hub.',
  restricted: 'Access is blocked on this iPad (Screen Time or a profile).',
};

const toItem = (c: DeviceCalendar, enabled: boolean): GoogleItem => ({ id: c.id, name: c.account ? `${c.title} (${c.account})` : c.title, color: c.color, enabled });

/** Keeps the person's ticks and colours for calendars that still exist; adds new ones, off. */
function merge(saved: GoogleItem[] | undefined, fresh: DeviceCalendar[]): GoogleItem[] {
  return fresh.map(f => {
    const s = saved?.find(x => x.id === f.id);
    return s ? { ...toItem(f, s.enabled), color: s.color } : toItem(f, false);
  });
}

/** Asks for access (the system prompt, the first time) and lists what's there to choose from. */
export async function deviceChoices(env: Env, settings: Settings, what: { calendars: boolean; reminders: boolean }) {
  const d = device(env);
  const out = { calendars: settings.device?.calendars ?? [], reminderLists: settings.device?.reminderLists ?? [], problems: [] as string[] };
  if (what.calendars) {
    const access = await d.requestAccess('calendars');
    if (access === 'granted') out.calendars = merge(settings.device?.calendars, await d.calendars());
    else if (ACCESS_TEXT[access]) out.problems.push(`Calendars: ${ACCESS_TEXT[access]}`);
  }
  if (what.reminders) {
    const access = await d.requestAccess('reminders');
    if (access === 'granted') out.reminderLists = merge(settings.device?.reminderLists, await d.reminderLists());
    else if (ACCESS_TEXT[access]) out.problems.push(`Reminders: ${ACCESS_TEXT[access]}`);
  }
  return out;
}

export async function readDevice(env: Env, settings: Settings): Promise<ProviderResult | null> {
  const s = settings.device;
  if (!env.DEVICE || !s) return null;
  const cals = s.calendars.filter(c => c.enabled);
  const lists = s.reminderLists.filter(l => l.enabled);
  if (!cals.length && !lists.length) return null;
  const { start, end } = agendaWindow();
  const sid = (kind: 'cal' | 'rem', id: string) => `device/${kind}/${id}`;
  const [events, reminders] = await Promise.all([
    cals.length ? env.DEVICE.events(cals.map(c => c.id), start, end) : [],
    lists.length ? env.DEVICE.reminders(lists.map(l => l.id)) : [],
  ]);
  return {
    sources: [
      ...cals.map(c => ({ id: sid('cal', c.id), name: c.name.replace(/ \([^)]*\)$/, ''), color: c.color })),
      ...lists.map(l => ({ id: sid('rem', l.id), name: l.name.replace(/ \([^)]*\)$/, ''), color: l.color })),
    ],
    events: events.map(e => ({ id: `${sid('cal', e.calendar)}:${e.id}`, source: sid('cal', e.calendar), title: e.title || '(No title)', start: e.start, end: e.end, allDay: e.allDay, location: e.location })),
    tasks: reminders.map(r => ({ id: `${sid('rem', r.list)}:${r.id}`, source: sid('rem', r.list), title: r.title, due: r.due })),
  };
}

// ── Apple Photos ────────────────────────────────────────────────────────────

/** The frame's ids are short hex strings; PhotoKit's are long. This maps one to the other. */
const assetIds = new Map<string, string>();
let assetList: { album: string; at: number; photos: PhotoInfo[] } | null = null;
const LIST_SECONDS = 120; // new photos in the album show up within two minutes

async function shortId(localId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`apple:${localId}`)));
  return [...digest.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function deviceAlbums(env: Env) {
  const d = device(env);
  const access = await d.requestAccess('photos');
  if (access !== 'granted' && access !== 'limited') throw new DeviceUnavailable(ACCESS_TEXT[access] || 'Photo access wasn’t given.');
  return { limited: access === 'limited', albums: await d.albums() };
}

/** The chosen album's photos, newest first, as the frame lists them. */
export async function devicePhotos(env: Env, settings: Settings): Promise<PhotoInfo[]> {
  const src = settings.photoSource;
  if (!env.DEVICE || src?.kind !== 'apple') return [];
  if (assetList && assetList.album === src.albumId && Date.now() - assetList.at < LIST_SECONDS * 1000) return assetList.photos;
  const assets = await env.DEVICE.assets(src.albumId).catch(() => []);
  const photos: PhotoInfo[] = [];
  for (const a of assets) {
    const id = await shortId(a.id);
    assetIds.set(id, a.id);
    photos.push({ id, width: a.width, height: a.height, taken: a.taken, collection: src.title, caption: null });
  }
  assetList = { album: src.albumId, at: Date.now(), photos };
  return photos;
}

/** A photo from the album, at display size, or null if it isn't one of the album's. */
export async function serveDevicePhoto(env: Env, settings: Settings, id: string, maxPx: number): Promise<Response | null> {
  if (!env.DEVICE) return null;
  if (!assetIds.has(id)) await devicePhotos(env, settings);
  const local = assetIds.get(id);
  if (!local) return null;
  const data = await env.DEVICE.image(local, maxPx);
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(data, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
}
