// What to wear, from the forecast. Pure functions, so they're easy to test and reuse.
//
// The temperature that matters is "feels like" (apparent temperature), shifted by a personal
// warmth preference: someone who runs cold should be told to dress for colder weather. The
// day is placed in a band (very hot … freezing), then wind, rain, snow and UV each adjust it.
// Every item belongs to a slot (base layer, outer layer, feet…), and when two rules want the
// same slot the higher rank wins, so the advice never contradicts itself ("light jacket" and
// "winter coat").

export interface WeatherNow {
  temp: number;
  feels: number;
  code: number; // WMO weather code
  precipitation: number; // mm in the last hour
  wind: number; // km/h
  gusts: number; // km/h
  isDay: boolean;
}

export interface WeatherHour {
  time: string; // local ISO time, e.g. "2026-10-23T14:00"
  temp: number;
  feels: number;
  rain: number; // % chance
  code: number;
  wind: number;
  uv: number;
}

export type Warmth = 'cold' | 'normal' | 'warm';
const WARMTH_OFFSET: Record<Warmth, number> = { cold: -3, normal: 0, warm: 3 };

// Thresholds, on the personal feels-like scale.
const WIND_BREEZY = 25; // km/h: worth a windproof layer
const WIND_GUSTY = 40; // km/h gusts
const RAIN_MAYBE = 30; // %: take an umbrella
const RAIN_LIKELY = 60; // %: a proper waterproof
const UV_HIGH = 6;
const SWING = 5; // °C change over the day that's worth a layer change
const WIND_MATTERS_BELOW = 18; // wind is a relief when it's hot, not a problem
const HEAVY_COAT_BELOW = 22; // a heavy waterproof is too much in warm rain

type Slot = 'base' | 'mid' | 'outer' | 'legs' | 'neck' | 'hands' | 'head' | 'eyes' | 'feet' | 'carry';
export type WearIcon = 'tshirt' | 'longsleeve' | 'jumper' | 'jacket' | 'coat' | 'raincoat' | 'shorts' | 'trousers'
  | 'scarf' | 'gloves' | 'beanie' | 'sunhat' | 'sunglasses' | 'umbrella' | 'boots' | 'sandals';
/** text is the full advice; icon and short (one or two words) are what the screen shows. */
export interface WearItem { slot: Slot; rank: number; text: string; icon: WearIcon; short: string; why?: string }

interface Band { min: number; name: string; headline: string; items: WearItem[] }

const BANDS: Band[] = [
  { min: 27, name: 'very hot', headline: 'Very hot. Wear as little as you can get away with.', items: [
    { slot: 'base', rank: 1, text: 'Loose, breathable top', icon: 'tshirt', short: 'Light top' },
    { slot: 'legs', rank: 1, text: 'Shorts or a light skirt', icon: 'shorts', short: 'Shorts' },
    { slot: 'feet', rank: 1, text: 'Sandals or breathable trainers', icon: 'sandals', short: 'Sandals' },
  ] },
  { min: 22, name: 'warm', headline: 'Warm. A single light layer is plenty.', items: [
    { slot: 'base', rank: 1, text: 'T-shirt', icon: 'tshirt', short: 'T-shirt' },
    { slot: 'legs', rank: 1, text: 'Shorts or light trousers', icon: 'shorts', short: 'Shorts' },
  ] },
  { min: 17, name: 'mild', headline: 'Mild. One layer, with something to hand.', items: [
    { slot: 'base', rank: 2, text: 'T-shirt or a light long-sleeve top', icon: 'tshirt', short: 'T-shirt' },
    { slot: 'legs', rank: 2, text: 'Jeans or light trousers', icon: 'trousers', short: 'Trousers' },
  ] },
  { min: 12, name: 'cool', headline: 'Cool. You’ll want a layer over the top.', items: [
    { slot: 'base', rank: 3, text: 'Long-sleeve top', icon: 'longsleeve', short: 'Long sleeves' },
    { slot: 'outer', rank: 1, text: 'Light jacket', icon: 'jacket', short: 'Jacket' },
    { slot: 'legs', rank: 2, text: 'Jeans or trousers', icon: 'trousers', short: 'Trousers' },
  ] },
  { min: 7, name: 'chilly', headline: 'Chilly. Jumper and jacket weather.', items: [
    { slot: 'base', rank: 3, text: 'Long-sleeve top', icon: 'longsleeve', short: 'Long sleeves' },
    { slot: 'mid', rank: 2, text: 'Jumper or fleece', icon: 'jumper', short: 'Jumper' },
    { slot: 'outer', rank: 2, text: 'Proper jacket', icon: 'jacket', short: 'Jacket' },
    { slot: 'legs', rank: 3, text: 'Jeans or thicker trousers', icon: 'trousers', short: 'Trousers' },
  ] },
  { min: 2, name: 'cold', headline: 'Cold. Wrap up properly before you go out.', items: [
    { slot: 'base', rank: 4, text: 'Thermal or thick long-sleeve base layer', icon: 'longsleeve', short: 'Thermal' },
    { slot: 'mid', rank: 3, text: 'Jumper or fleece', icon: 'jumper', short: 'Jumper' },
    { slot: 'outer', rank: 3, text: 'Winter coat', icon: 'coat', short: 'Coat' },
    { slot: 'legs', rank: 3, text: 'Thick trousers', icon: 'trousers', short: 'Trousers' },
    { slot: 'neck', rank: 1, text: 'Scarf', icon: 'scarf', short: 'Scarf' },
    { slot: 'hands', rank: 1, text: 'Gloves', icon: 'gloves', short: 'Gloves' },
  ] },
  { min: -99, name: 'freezing', headline: 'Freezing. Full winter kit, hands and head included.', items: [
    { slot: 'base', rank: 4, text: 'Thermal base layer', icon: 'longsleeve', short: 'Thermal' },
    { slot: 'mid', rank: 4, text: 'Thick jumper or fleece', icon: 'jumper', short: 'Jumper' },
    { slot: 'outer', rank: 4, text: 'Insulated winter coat', icon: 'coat', short: 'Big coat' },
    { slot: 'legs', rank: 4, text: 'Thermal-lined or heavy trousers', icon: 'trousers', short: 'Trousers' },
    { slot: 'neck', rank: 2, text: 'Scarf', icon: 'scarf', short: 'Scarf' },
    { slot: 'hands', rank: 2, text: 'Warm gloves', icon: 'gloves', short: 'Gloves' },
    { slot: 'head', rank: 2, text: 'Warm hat', icon: 'beanie', short: 'Hat' },
    { slot: 'feet', rank: 3, text: 'Warm socks and boots', icon: 'boots', short: 'Boots' },
  ] },
];

export const isWet = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
export const isSnowy = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;

const SLOT_ORDER: Slot[] = ['outer', 'mid', 'base', 'legs', 'feet', 'neck', 'hands', 'head', 'eyes', 'carry'];

export interface Recommendation { headline: string; items: WearItem[]; effective: number; band: string }

/** hours: the coming hours, soonest first. */
export function recommend(now: WeatherNow, hours: WeatherHour[] = [], warmth: Warmth = 'normal'): Recommendation {
  const effective = now.feels + WARMTH_OFFSET[warmth];
  const band = BANDS.find(b => effective >= b.min)!;
  const slots = new Map<Slot, WearItem>();
  const add = (it: WearItem) => {
    const prev = slots.get(it.slot);
    if (!prev || it.rank > prev.rank) slots.set(it.slot, it);
  };
  band.items.forEach(add);

  let note = '';
  const windy = now.wind >= WIND_BREEZY || now.gusts >= WIND_GUSTY;
  if (windy && effective < WIND_MATTERS_BELOW) {
    add({ slot: 'outer', rank: 5, text: 'Windproof jacket', icon: 'jacket', short: 'Windproof', why: `wind ${Math.round(now.wind)} km/h` });
    note = 'The wind makes it feel sharper than the thermometer says.';
  }

  const rainNow = isWet(now.code) || now.precipitation > 0;
  const rainSoon = hours.slice(0, 3).reduce((m, h) => Math.max(m, h.rain), 0);
  if (rainNow || rainSoon >= RAIN_LIKELY) {
    add(effective < HEAVY_COAT_BELOW
      ? { slot: 'outer', rank: 6, text: 'Waterproof coat', icon: 'raincoat', short: 'Waterproof', why: 'it’s wet out' }
      : { slot: 'outer', rank: 6, text: 'Light rain jacket', icon: 'raincoat', short: 'Rain jacket', why: 'warm but wet' });
    add({ slot: 'feet', rank: 4, text: 'Shoes that cope with puddles', icon: 'boots', short: 'Boots' });
    add({ slot: 'carry', rank: 2, text: 'Umbrella', icon: 'umbrella', short: 'Umbrella' });
  } else if (rainSoon >= RAIN_MAYBE) {
    add({ slot: 'carry', rank: 1, text: 'Umbrella', icon: 'umbrella', short: 'Umbrella', why: `${Math.round(rainSoon)}% chance soon` });
  }

  if (isSnowy(now.code)) add({ slot: 'feet', rank: 5, text: 'Boots with good grip', icon: 'boots', short: 'Grip boots', why: 'snow underfoot' });

  const uvPeak = hours.reduce((m, h) => Math.max(m, h.uv), 0);
  if (now.isDay && uvPeak >= UV_HIGH) {
    add({ slot: 'eyes', rank: 1, text: 'Sunglasses and sun cream', icon: 'sunglasses', short: 'Sun cream', why: `UV ${Math.round(uvPeak)}` });
    if (effective >= 22) add({ slot: 'head', rank: 1, text: 'Sun hat', icon: 'sunhat', short: 'Sun hat' });
  }

  const items = SLOT_ORDER.filter(s => slots.has(s)).map(s => slots.get(s)!);
  return { headline: note ? `${band.headline} ${note}` : band.headline, items, effective, band: band.name };
}

const hourLabel = (iso: string) => {
  const h = Number(iso.slice(11, 13));
  return h === 0 ? 'midnight' : h === 12 ? 'midday' : h < 12 ? `${h}am` : `${h - 12}pm`;
};

/** One or two plain sentences about how the rest of the day differs from now. */
export function laterToday(now: WeatherNow, hours: WeatherHour[], rec: Recommendation): string {
  if (!hours.length) return '';
  const parts: string[] = [];
  const max = Math.max(...hours.map(h => h.feels));
  const min = Math.min(...hours.map(h => h.feels));
  const warmest = hours.find(h => h.feels === max)!;
  const coldest = hours.find(h => h.feels === min)!;
  const rise = max - now.feels;
  const fall = now.feels - min;

  if (rise >= SWING && fall >= SWING) {
    const [a, b] = warmest.time < coldest.time
      ? [`climbs to ${Math.round(max)}° by ${hourLabel(warmest.time)}`, `back down to ${Math.round(min)}° by ${hourLabel(coldest.time)}`]
      : [`dips to ${Math.round(min)}° by ${hourLabel(coldest.time)}`, `back up to ${Math.round(max)}° by ${hourLabel(warmest.time)}`];
    parts.push(`It ${a}, then ${b}: dress so you can add or shed a layer.`);
  } else if (rise >= SWING) {
    parts.push(`It warms to about ${Math.round(max)}° by ${hourLabel(warmest.time)}, so one layer fewer later.`);
  } else if (fall >= SWING) {
    parts.push(`It cools to about ${Math.round(min)}° by ${hourLabel(coldest.time)}: take an extra layer if you’ll be out.`);
  }

  const wetNow = isWet(now.code) || now.precipitation > 0;
  const carrying = rec.items.some(i => i.slot === 'carry' || /waterproof|rain jacket/i.test(i.text));
  const wetHour = hours.find(h => h.rain >= 40 || isWet(h.code));
  if (wetHour && wetNow) parts.push(`More rain from about ${hourLabel(wetHour.time)}.`);
  else if (wetHour && !carrying) parts.push(`Dry now, but a ${Math.round(wetHour.rain)}% chance of rain from about ${hourLabel(wetHour.time)}: worth taking a waterproof.`);
  else if (wetHour) parts.push(`Rain likely from about ${hourLabel(wetHour.time)}.`);

  const maxWind = Math.max(...hours.map(h => h.wind));
  if (maxWind >= WIND_BREEZY && maxWind - now.wind >= 10) {
    const windHour = hours.find(h => h.wind === maxWind)!;
    parts.push(`The wind picks up to about ${Math.round(maxWind)} km/h around ${hourLabel(windHour.time)}.`);
  }
  return parts.length ? parts.join(' ') : 'Steady for the rest of the day.';
}

/** WMO weather code → plain label and icon name. */
export function describe(code: number, isDay = true): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: isDay ? 'Clear' : 'Clear night', icon: isDay ? 'sun' : 'moon' };
  if (code === 1) return { label: 'Mostly clear', icon: isDay ? 'sun' : 'moon' };
  if (code === 2) return { label: 'Partly cloudy', icon: isDay ? 'partly' : 'cloud' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'rain' };
  if (code >= 61 && code <= 67) return { label: code >= 65 ? 'Heavy rain' : 'Rain', icon: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: 'rain' };
  if (code >= 95) return { label: 'Thunderstorms', icon: 'storm' };
  return { label: 'Unsettled', icon: 'cloud' };
}

export type WeatherIcon = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';
