// Shapes shared by the Worker API and the web app.

import type { ClockStyle, MotionLevel, NightSettings, PhotoStyle, Place, RadarMap, SavedAirport, ScreenId } from './settings';
import type { AirInfo } from './air';
import type { Warmth, WeatherHour, WeatherNow } from './wear';

export interface HubConfig {
  /** The default centre of the sky screens: the active saved place, or the deployment's HOME_LAT/LON. */
  home: { lat: number; lon: number; name: string };
  places: Place[];
  /** A place id, 'device' (each display uses its own location), or 'default' (deployment variables). */
  activePlace: string;
  radarRadiusNm: number;
  radarMap: RadarMap;
  timezone: string;
  boardTheme: BoardTheme;
  clock: ClockStyle;
  motion: MotionLevel;
  warmth: Warmth;
  photoStyle: PhotoStyle;
  /** Airports with a board, in order. The board screen is left out of rotation when empty. */
  airports: SavedAirport[];
  night: NightSettings;
  wikiPictures: boolean;
  /** Screens switched off in /setup; they never join the rotation. */
  screensOff: ScreenId[];
  features: { agenda: boolean; photos: boolean; trending: boolean };
}

export interface Aircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  lat: number;
  lon: number;
  altFt: number | null; // null when on the ground or unknown
  groundSpeedKt: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  squawk: string | null;
  emergency: boolean;
  distanceNm: number;
  bearingDeg: number;
}

export interface AircraftResponse {
  source: string;
  fetchedAt: number; // epoch ms
  aircraft: Aircraft[];
  /** True when every source failed just now and these are the last good positions. */
  stale?: boolean;
  /** Routes for the few featured aircraft, keyed by hex, when requested with ?routes=N. */
  routes?: Record<string, RouteSummary>;
}

export interface RouteSummary { from: string; to: string; fromCity: string; toCity: string; airline: string | null }

export interface Airport {
  iata: string; icao: string; name: string; city: string; country: string; lat: number; lon: number;
}

export interface RouteInfo {
  flightNumber: string | null; // IATA style, e.g. "BA28"
  airline: { name: string; icao: string; iata: string } | null;
  origin: Airport;
  destination: Airport;
  flownKm: number;
  remainingKm: number;
  progress: number; // 0..1
}

export interface OverheadResponse {
  fetchedAt: number;
  source: string;
  /** How many aircraft passed the board's filters. */
  candidates: number;
  aircraft: Aircraft | null;
  route: RouteInfo | null;
  /** Why this aircraft was chosen. */
  reason: 'emergency' | 'held' | 'nearest' | null;
}

export type ArrivalStatus = 'en route' | 'descending' | 'approach' | 'landing' | 'landed';
export type DepartureStatus = 'taxiing' | 'takeoff' | 'climbing' | 'departed';

/** One row of an airport board. `code` and `city` are the other end of the flight. */
export interface AirportFlight {
  hex: string;
  /** IATA flight number when known (BA178), else the callsign (BAW178). */
  flight: string;
  airline: string | null;
  code: string;
  city: string;
  type: string | null;
  altFt: number | null;
  /** From the airport, not from home. */
  distanceNm: number;
  status: ArrivalStatus | DepartureStatus;
  /** Arrivals only: estimated minutes to touchdown from fetchedAt (0 once landed). */
  etaMin: number | null;
}

export interface AirportBoardResponse {
  airport: { icao: string; iata: string; name: string; city: string };
  fetchedAt: number;
  source: string;
  stale?: boolean;
  /** How far round the airport the hub looked. */
  radiusNm: number;
  /** Soonest first. */
  arrivals: AirportFlight[];
  /** Most recent first: on the ground, then nearest. */
  departures: AirportFlight[];
}

export type BoardTheme = 'splitflap' | 'led' | 'minimal';

// See docs/feed-contract.md
export interface AgendaSource { id: string; name: string; color?: string }
export interface AgendaEvent {
  id: string; source: string; title: string;
  start: string; end?: string; allDay: boolean; location?: string;
}
export interface AgendaTask { id: string; source: string; title: string; due?: string; done?: boolean }
export interface AgendaFeed {
  version: 1;
  generatedAt: string;
  timezone?: string;
  sources: AgendaSource[];
  events: AgendaEvent[];
  tasks: AgendaTask[];
}

export type AgendaResponse = { configured: false } | ({ configured: true; errors?: string[] } & AgendaFeed);

export interface WeatherDay { date: string; code: number; max: number; min: number; rain: number; sunrise: string; sunset: string }

export interface WeatherResponse {
  updatedAt: string;
  now: WeatherNow;
  /** The next 18 hours, soonest first. */
  hours: WeatherHour[];
  days: WeatherDay[];
  /** Pollen and air quality: only in the pollen season. */
  air?: AirInfo;
}

/** Wikipedia's featured article of the day. */
export interface WikiResponse {
  date: string;
  title: string;
  description?: string;
  extract: string;
  url?: string;
  image?: { url: string; width: number; height: number };
}

/** A visible pass of the International Space Station. */
export interface IssPass { start: string; end: string; maxElev: number; from: string; to: string }

/** Tonight's sky. Times are ISO strings; any part can be missing if its source is down. */
export interface TonightResponse {
  night: { sunset?: string; dark?: string; darkEnds?: string; sunrise?: string; allDay?: boolean; allNight?: boolean };
  moon: { name: string; phase: number; fraction: number; rise?: string; set?: string };
  aurora?: { kp: number; chance: 'unlikely' | 'possible' | 'good' };
  /** Average cloud cover, %, over the first half of the night. */
  cloud?: number;
  iss?: IssPass[];
}

/** A town or city name for labelling the radar (OpenStreetMap). */
export interface PlaceName { name: string; lat: number; lon: number; kind: 'city' | 'town' | 'village'; population?: number }
