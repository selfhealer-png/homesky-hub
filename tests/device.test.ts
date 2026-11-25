import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceBinding } from '../src/shared/device';
import type { Settings } from '../src/shared/settings';
import { readDevice } from '../src/worker/device';
import type { Env } from '../src/worker/env';

const binding = (calls: string[]): DeviceBinding => ({
  requestAccess: async () => 'granted',
  access: async () => 'granted',
  calendars: async () => [],
  reminderLists: async () => [],
  events: async ids => { calls.push(`events:${ids.join(',')}`); return [{ id: 'e1', calendar: 'c1', title: '', start: '2026-11-05', end: '2026-11-06', allDay: true }]; },
  reminders: async ids => { calls.push(`reminders:${ids.join(',')}`); return [{ id: 'r1', list: 'l1', title: 'Bins', due: '2026-11-04' }]; },
  albums: async () => [],
  assets: async () => [],
  image: async () => null,
});

const settings = (over: Partial<NonNullable<Settings['device']>> = {}): Settings => ({
  version: 1,
  connections: [],
  device: {
    calendars: [{ id: 'c1', name: 'Home (iCloud)', color: '#34C759', enabled: true }, { id: 'c2', name: 'Work (Exchange)', color: '#FF9500', enabled: false }],
    reminderLists: [{ id: 'l1', name: 'House (iCloud)', color: '#FF3B30', enabled: true }],
    ...over,
  },
});

test('the iPad’s calendars become agenda sources, events and tasks, asking only for ticked ones', async () => {
  const calls: string[] = [];
  const r = await readDevice({ DEVICE: binding(calls) } as unknown as Env, settings());
  assert.ok(r);
  assert.deepEqual(calls.sort(), ['events:c1', 'reminders:l1']);
  assert.deepEqual(r.sources.map(s => s.name), ['Home', 'House'], 'the account name in brackets is for Settings, not the display');
  assert.deepEqual(r.events[0], { id: 'device/cal/c1:e1', source: 'device/cal/c1', title: '(No title)', start: '2026-11-05', end: '2026-11-06', allDay: true, location: undefined });
  assert.deepEqual(r.tasks[0], { id: 'device/rem/l1:r1', source: 'device/rem/l1', title: 'Bins', due: '2026-11-04' });
});

test('nothing is read without the app, or with nothing ticked', async () => {
  const calls: string[] = [];
  assert.equal(await readDevice({} as Env, settings()), null);
  assert.equal(await readDevice({ DEVICE: binding(calls) } as unknown as Env, settings({ calendars: [], reminderLists: [] })), null);
  assert.deepEqual(calls, []);
});
