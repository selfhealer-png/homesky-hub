// Shapes shared by the Worker API and the web app.

import type { Place } from './settings';

export interface HubConfig {
  /** The default centre of the sky screens: the active saved place, or the deployment's HOME_LAT/LON. */
  home: { lat: number; lon: number; name: string };
  places: Place[];
  /** A place id, 'device' (each display uses its own location), or 'default' (deployment variables). */
  activePlace: string;
  radarRadiusNm: number;
  timezone: string;
  boardTheme: BoardTheme;
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
