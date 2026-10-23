import type { WeatherResponse } from '../shared/types';
import { cached } from './cache';
import { json, USER_AGENT, type Env } from './env';
import { skyContext } from './sky';

// Forecast for the weather screen, from Open-Meteo (free, no key). Centred on the same place
// as the sky screens, so a display that follows its own location gets its own weather.

interface OpenMeteo {
  current: { time: string; temperature_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; apparent_temperature: number[]; precipitation_probability: number[]; weather_code: number[]; wind_speed_10m: number[]; uv_index: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; sunrise: string[]; sunset: string[] };
}

async function fetchForecast(lat: number, lon: number): Promise<WeatherResponse> {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto', forecast_days: '5', wind_speed_unit: 'kmh',
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  }).toString();
  const res = await fetch(u, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const d = (await res.json()) as OpenMeteo;

  // The rest of today and tonight: the next 18 hours from now.
  const hourNow = d.current.time.slice(0, 13);
  const start = Math.max(0, d.hourly.time.findIndex(t => t.slice(0, 13) > hourNow));
  const hours = d.hourly.time.slice(start, start + 18).map((time, k) => {
    const i = start + k;
    return { time, temp: d.hourly.temperature_2m[i], feels: d.hourly.apparent_temperature[i], rain: d.hourly.precipitation_probability[i] ?? 0, code: d.hourly.weather_code[i], wind: d.hourly.wind_speed_10m[i], uv: d.hourly.uv_index[i] ?? 0 };
  });

  return {
    updatedAt: new Date().toISOString(),
    now: {
      temp: d.current.temperature_2m, feels: d.current.apparent_temperature, code: d.current.weather_code,
      precipitation: d.current.precipitation, wind: d.current.wind_speed_10m, gusts: d.current.wind_gusts_10m, isDay: d.current.is_day === 1,
    },
    hours,
    days: d.daily.time.map((date, i) => ({
      date, code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i],
      rain: d.daily.precipitation_probability_max[i] ?? 0, sunrise: d.daily.sunrise[i], sunset: d.daily.sunset[i],
    })),
  };
}

export async function handleWeather(env: Env, url: URL, request: Request): Promise<Response> {
  try {
    const { home } = await skyContext(env, url, request);
    return json(await cached(env, `weather:${home.lat}:${home.lon}`, 600, () => fetchForecast(home.lat, home.lon)));
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 502 });
  }
}
