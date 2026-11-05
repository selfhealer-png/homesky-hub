// What the iOS app offers the Worker from the device itself: the calendars, reminders and photo
// albums on this iPad (EventKit and PhotoKit, through the HubNative Swift plugin). The Worker
// sees it as one more optional binding, env.DEVICE, the way it sees KV or R2; on Cloudflare it's
// simply absent. src/web/app/device.ts implements it, natively or (in a browser) with samples.

export type DeviceAccess = 'granted' | 'denied' | 'notDetermined' | 'limited' | 'restricted';

export interface DeviceCalendar {
  id: string;
  title: string;
  /** #RRGGBB */
  color: string;
  /** Which account it belongs to, e.g. "iCloud", "Gmail", "Exchange". */
  account: string;
}

export interface DeviceEvent { id: string; calendar: string; title: string; start: string; end?: string; allDay: boolean; location?: string }
export interface DeviceReminder { id: string; list: string; title: string; due?: string }

export interface DeviceAlbum { id: string; title: string; count: number; shared: boolean }
export interface DeviceAsset { id: string; width: number; height: number; taken: string | null }

export interface DeviceBinding {
  /** Asks iOS for access (shows the system prompt the first time) and says what was granted. */
  requestAccess(what: 'calendars' | 'reminders' | 'photos'): Promise<DeviceAccess>;
  access(what: 'calendars' | 'reminders' | 'photos'): Promise<DeviceAccess>;
  calendars(): Promise<DeviceCalendar[]>;
  reminderLists(): Promise<DeviceCalendar[]>;
  events(calendarIds: string[], from: Date, to: Date): Promise<DeviceEvent[]>;
  reminders(listIds: string[]): Promise<DeviceReminder[]>;
  albums(): Promise<DeviceAlbum[]>;
  assets(albumId: string): Promise<DeviceAsset[]>;
  /** The picture at no more than maxPx on its long side, as JPEG; null if it's gone. */
  image(assetId: string, maxPx: number): Promise<ArrayBuffer | null>;
}
