import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, essentials, laterToday, recommend, type WeatherHour, type WeatherNow } from '../src/shared/wear';

const now = (o: Partial<WeatherNow> = {}): WeatherNow => ({ temp: 10, feels: 10, code: 3, precipitation: 0, wind: 10, gusts: 15, isDay: true, ...o });
const hour = (time: string, o: Partial<WeatherHour> = {}): WeatherHour => ({ time, temp: 10, feels: 10, rain: 0, code: 3, wind: 10, uv: 1, ...o });
const texts = (n: WeatherNow, h: WeatherHour[] = [], w?: 'cold' | 'normal' | 'warm') => recommend(n, h, w).items.map(i => i.text);

test('bands follow the feels-like temperature', () => {
  assert.equal(recommend(now({ feels: 30 })).band, 'very hot');
  assert.equal(recommend(now({ feels: 9 })).band, 'chilly');
  assert.equal(recommend(now({ feels: -4 })).band, 'freezing');
});

test('a warmth preference shifts the band', () => {
  assert.equal(recommend(now({ feels: 13 }), [], 'normal').band, 'cool');
  assert.equal(recommend(now({ feels: 13 }), [], 'cold').band, 'chilly');
});

test('rain upgrades the outer layer instead of adding a second coat', () => {
  const items = texts(now({ feels: 9, code: 63 }));
  assert.ok(items.includes('Waterproof coat'));
  assert.ok(!items.includes('Proper jacket'), 'only one outer layer');
  assert.ok(items.includes('Umbrella'));
});

test('warm rain gets a light rain jacket, not a heavy coat', () => {
  assert.ok(texts(now({ feels: 24, code: 61 })).includes('Light rain jacket'));
});

test('wind only matters when it is cool', () => {
  assert.ok(texts(now({ feels: 10, wind: 30 })).includes('Windproof jacket'));
  assert.ok(!texts(now({ feels: 25, wind: 30 })).includes('Windproof jacket'));
});

test('a chance of rain soon suggests an umbrella', () => {
  assert.ok(texts(now({ feels: 15 }), [hour('2026-10-23T13:00', { rain: 40 })]).includes('Umbrella'));
});

test('later today describes a big swing in the order it happens', () => {
  const n = now({ feels: 8 });
  const hours = [hour('2026-10-23T11:00', { feels: 10 }), hour('2026-10-23T14:00', { feels: 15 }), hour('2026-10-23T20:00', { feels: 2 })];
  const text = laterToday(n, hours, recommend(n, hours));
  assert.match(text, /climbs to 15° by 14:00, then back down to 2° by 20:00/);
});

test('weather codes map to plain labels', () => {
  assert.equal(describe(0).label, 'Clear');
  assert.equal(describe(0, false).icon, 'moon');
  assert.equal(describe(81).icon, 'rain');
  assert.equal(describe(95).label, 'Thunderstorms');
});

test('a glance shows the four items that decide how you go out', () => {
  const rec = recommend(now({ feels: 3, code: 63, precipitation: 2 }), []);
  assert.ok(rec.items.length > 4);
  const { shown, also } = essentials(rec.items);
  assert.deepEqual(shown.map(i => i.short), ['Waterproof', 'Jumper', 'Gloves', 'Umbrella']);
  assert.equal(shown.length + also.length, rec.items.length);
});

test('a short list is shown whole', () => {
  const rec = recommend(now({ feels: 24 }), []);
  assert.equal(essentials(rec.items).also.length, 0);
});
