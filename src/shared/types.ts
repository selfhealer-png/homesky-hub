// Shapes shared by the Worker API and the web app.

import type { ClockStyle, MotionLevel, NightSettings, PhotoStyle, Place, RadarMap, SavedAirport, ScreenId } from './settings';
import type { AirInfo } from './air';
import type { AlertLevel } from './notable';
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
  /** Every screen, in the order they rotate (screenOrder() of the saved order). */
  order: ScreenId[];
  /** Seconds on each screen, or null for each screen's own pace. */
  rotateSec: number | null;
  /** Show the time in the bottom corner of screens without their own clock. */
  stripClock: boolean;
  features: { agenda: boolean; photos: boolean; trending: boolean };
  /** The flight the Flight tracker follows, or null (the screen then sits out of the rotation). */
  follow: string | null;
  /** Where the Tides screen reads the tide, or null (the screen sits out until one is chosen). */
  tidePlace: Place | null;
  /** Which aircraft interrupt the display with an alert, and whether a chime sounds. */
  alerts: AlertLevel;
  alertSound: boolean;
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
  /** The type in full from the feed's aircraft database ("BOEING 737-800"), when it knows it. */
  desc?: string | null;
  /** Flagged military in the feed's aircraft database. */
  military?: boolean;
  /** Flagged "interesting" there: government, police, air ambulance and other special operators. */
  interesting?: boolean;
  /** ADS-B emitter category: A1 light … A5 heavy, A7 helicopter, B2 balloon, B6 drone. */
  category?: string | null;
  /** Reported on the ground (altFt is then null too). */
  onGround?: boolean;
}

export interface AircraftResponse {
  source: string;
  fetchedAt: number; // epoch ms
  aircraft: Aircraft[];
  /** True when every source failed just now and these are the last good positions. */
  stale?: boolean;
  /** Routes for the few featured aircraft, keyed by hex, when requested with ?routes=N. */
  routes?: Record<string, RouteSummary>;
  /** Where each aircraft has been lately, keyed by hex, oldest first, when requested with ?trails=1. */
  trails?: Record<string, TrailPoint[]>;
}

/** [lat, lon, epoch seconds] */
export type TrailPoint = [number, number, number];

export interface RouteSummary {
  from: string; to: string; fromCity: string; toCity: string;
  airline: string | null; airlineIata: string | null;
  /** The destination, for drawing the way there. */
  toLat: number; toLon: number;
  remainingKm: number;
}

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
  reason: 'emergency' | 'notable' | 'followed' | 'held' | 'nearest' | null;
}

/** Everything known about one aircraft, for the plane card. */
export interface PlaneDetail {
  hex: string;
  fetchedAt: number;
  source?: string;
  /** Live, measured from the display's place; null once it's out of reach of the feeds. */
  aircraft: Aircraft | null;
  route: RouteInfo | null;
  /** From the feed's aircraft database. */
  operator: string | null;
  /** Where it's registered. */
  country: string | null;
  /** A photo of this aircraft itself (airport-data.com, via adsbdb). */
  photo: string | null;
  year: number | null;
  /** ADS-B emitter category: A1 light … A5 heavy, A7 helicopter, B2 balloon, B6 drone. */
  category: string | null;
  /** How the position was found: adsb_icao (sent by the aircraft), mlat, tisb_icao and so on. */
  positionSource: string | null;
  /** What the aircraft itself reports, when it does. */
  live: {
    iasKt: number | null; tasKt: number | null; mach: number | null;
    /** The altitude dialled in on the autopilot: where it's climbing or descending to. */
    selectedAltFt: number | null;
    /** The heading dialled in on the autopilot. */
    selectedHeadingDeg: number | null;
    /** Which autopilot modes are engaged: autopilot, vnav, althold, approach, lnav, tcas. */
    navModes: string[] | null;
    /** Bank angle in degrees, negative to the left. */
    rollDeg: number | null;
    windFromDeg: number | null; windKt: number | null; outsideTempC: number | null;
  };
  /** About the type, from Wikipedia. */
  article: TypeArticle | null;
}

export interface TypeArticle { title: string; extract: string; url: string; image?: { url: string; width: number; height: number } }

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

/** The flight the Flight tracker follows. */
export interface TrackResponse {
  /** As chosen in /setup ("BA117"). */
  query: string;
  fetchedAt: number;
  source?: string;
  /** Live, with distance and bearing from the display's place; null when it isn't flying. */
  aircraft: Aircraft | null;
  route: RouteInfo | null;
  /** The last sighting, when it isn't in the air now. */
  lastSeen?: { at: number; callsign: string | null; lat: number; lon: number };
}

/** Someone aboard the International Space Station. */
export interface CrewMember { name: string; agency: string; role: string; country: string; spacecraft: string; launched: number }

export interface IssResponse {
  /** The two orbit lines; the display works out where the station is, second by second. */
  tle: [string, string];
  crew: CrewMember[];
  expedition?: number;
  /** Visible passes from the display's place, soonest first. */
  passes?: IssPass[];
}

export interface TideTurn { time: string; height: number; type: 'high' | 'low' }

/** The tide at a place by the sea. Heights are metres from mean sea level. */
export interface TideResponse {
  place: string;
  /** Every 15 minutes, from a few hours ago to a day and a half ahead. */
  heights: Array<[string, number]>;
  turns: TideTurn[];
}
