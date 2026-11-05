import { registerPlugin } from '@capacitor/core';
import type { DeviceAccess, DeviceAlbum, DeviceAsset, DeviceBinding, DeviceCalendar, DeviceEvent, DeviceReminder } from '../../shared/device';

// env.DEVICE for the in-page Worker (shared/device.ts).
//   • In the iOS app: the HubNative Swift plugin (ios/App/App/HubNativePlugin.swift), over
//     EventKit and PhotoKit. Its method names and shapes must match the interface below.
//   • In a browser with VITE_FAKE_DEVICE=1: sample calendars, reminders and albums, so the
//     wizard and Settings can be tried on Windows, where there's no iPad to ask.

type What = 'calendars' | 'reminders' | 'photos';

interface HubNativePlugin {
  requestAccess(o: { what: What }): Promise<{ access: DeviceAccess }>;
  access(o: { what: What }): Promise<{ access: DeviceAccess }>;
  calendars(): Promise<{ calendars: DeviceCalendar[] }>;
  reminderLists(): Promise<{ lists: DeviceCalendar[] }>;
  events(o: { ids: string[]; from: string; to: string }): Promise<{ events: DeviceEvent[] }>;
  reminders(o: { ids: string[] }): Promise<{ reminders: DeviceReminder[] }>;
  albums(): Promise<{ albums: DeviceAlbum[] }>;
  assets(o: { album: string }): Promise<{ assets: DeviceAsset[] }>;
  image(o: { id: string; maxPx: number }): Promise<{ data: string | null }>;
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

export function nativeDevice(): DeviceBinding {
  const p = registerPlugin<HubNativePlugin>('HubNative');
  return {
    requestAccess: async what => (await p.requestAccess({ what })).access,
    access: async what => (await p.access({ what })).access,
    calendars: async () => (await p.calendars()).calendars,
    reminderLists: async () => (await p.reminderLists()).lists,
    events: async (ids, from, to) => (await p.events({ ids, from: from.toISOString(), to: to.toISOString() })).events,
    reminders: async ids => (await p.reminders({ ids })).reminders,
    albums: async () => (await p.albums()).albums,
    assets: async album => (await p.assets({ album })).assets,
    image: async (id, maxPx) => {
      const { data } = await p.image({ id, maxPx });
      return data ? fromBase64(data) : null;
    },
  };
}

// ── Samples for the browser ─────────────────────────────────────────────────

const day = (offset: number, h = 0, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SAMPLE_CALENDARS: DeviceCalendar[] = [
  { id: 'cal-home', title: 'Home', color: '#34C759', account: 'iCloud' },
  { id: 'cal-work', title: 'Work', color: '#FF9500', account: 'Exchange' },
  { id: 'cal-holidays', title: 'UK Holidays', color: '#5856D6', account: 'Subscribed' },
];
const SAMPLE_LISTS: DeviceCalendar[] = [
  { id: 'rem-house', title: 'House', color: '#FF3B30', account: 'iCloud' },
  { id: 'rem-shopping', title: 'Shopping', color: '#007AFF', account: 'iCloud' },
];
const SAMPLE_ALBUMS: DeviceAlbum[] = [
  { id: 'album-family', title: 'Family (shared)', count: 6, shared: true },
  { id: 'album-holiday', title: 'Summer holiday', count: 4, shared: false },
];
const HUES = [205, 30, 140, 280, 350, 60];

async function sampleImage(id: string, maxPx: number): Promise<ArrayBuffer | null> {
  const n = Number(id.split('-').pop()) || 0;
  const w = Math.min(maxPx, n % 3 === 2 ? 900 : 1600), hgt = n % 3 === 2 ? Math.round(w * 1.33) : Math.round(w * 0.66);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width: w, height: hgt });
  const g = canvas.getContext('2d')!;
  const hue = HUES[n % HUES.length];
  g.fillStyle = `hsl(${hue} 45% 32%)`;
  g.fillRect(0, 0, w, hgt);
  g.fillStyle = `hsl(${(hue + 40) % 360} 55% 55%)`;
  g.beginPath();
  g.arc(w * 0.7, hgt * 0.35, Math.min(w, hgt) * 0.18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = `hsl(${hue} 35% 18%)`;
  g.fillRect(0, hgt * 0.68, w, hgt * 0.32);
  g.fillStyle = '#F1F5F9';
  g.font = `600 ${Math.round(hgt * 0.06)}px system-ui, sans-serif`;
  g.fillText(`Sample photo ${n + 1}`, w * 0.06, hgt * 0.9);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  return blob ? blob.arrayBuffer() : null;
}

export function sampleDevice(): DeviceBinding {
  const granted = new Set<What>();
  return {
    requestAccess: async what => { granted.add(what); return 'granted'; },
    access: async what => (granted.has(what) ? 'granted' : 'notDetermined'),
    calendars: async () => SAMPLE_CALENDARS,
    reminderLists: async () => SAMPLE_LISTS,
    events: async ids => [
      { id: 'e1', calendar: 'cal-home', title: 'Dentist', start: day(0, 15, 30).toISOString(), end: day(0, 16).toISOString(), allDay: false },
      { id: 'e2', calendar: 'cal-work', title: 'Team call', start: day(1, 9).toISOString(), end: day(1, 10).toISOString(), allDay: false },
      { id: 'e3', calendar: 'cal-home', title: 'Football practice', start: day(2, 17).toISOString(), end: day(2, 18, 30).toISOString(), allDay: false, location: 'Park' },
      { id: 'e4', calendar: 'cal-holidays', title: 'Bank holiday', start: ymd(day(5)), end: ymd(day(6)), allDay: true },
    ].filter(e => ids.includes(e.calendar)),
    reminders: async ids => [
      { id: 'r1', list: 'rem-house', title: 'Book boiler service', due: ymd(day(-1)) },
      { id: 'r2', list: 'rem-house', title: 'Water the plants', due: ymd(day(0)) },
      { id: 'r3', list: 'rem-shopping', title: 'Birthday card' },
    ].filter(r => ids.includes(r.list)),
    albums: async () => SAMPLE_ALBUMS,
    assets: async album => {
      const a = SAMPLE_ALBUMS.find(x => x.id === album);
      return Array.from({ length: a?.count ?? 0 }, (_, i) => ({
        id: `${album}-${i}`, width: i % 3 === 2 ? 900 : 1600, height: i % 3 === 2 ? 1197 : 1056, taken: day(-i * 9, 12).toISOString(),
      }));
    },
    image: sampleImage,
  };
}
