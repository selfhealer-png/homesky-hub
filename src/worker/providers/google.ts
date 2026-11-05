import type { AgendaEvent, AgendaTask } from '../../shared/types';
import { GOOGLE_SCOPE, googleGranted, type GoogleConnection, type GoogleItem, type GoogleWants } from '../../shared/settings';
import { agendaWindow, ProviderError, type ProviderResult } from './common';

// Google Calendar and Google Tasks, read-only, through the deployer's own OAuth client.
// Scopes are read-only by construction: nothing here can change a calendar or a task.

export const PHOTOS_SCOPE = GOOGLE_SCOPE.photos;

/** Asks only for the parts chosen (plus the email address, to show who's connected). */
export function googleAuthUrl(clientId: string, redirectUri: string, state: string, wants: GoogleWants, pkceChallenge?: string): string {
  const scopes = ['openid', 'email', ...(Object.keys(GOOGLE_SCOPE) as Array<keyof GoogleWants>).filter(p => wants[p]).map(p => GOOGLE_SCOPE[p])];
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token, even on reconnect
    include_granted_scopes: 'true',
    state,
    // The iOS app's client has no secret, so it proves itself with PKCE instead.
    ...(pkceChallenge ? { code_challenge: pkceChallenge, code_challenge_method: 'S256' } : {}),
  }).toString();
  return u.toString();
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  // An iOS OAuth client has no secret: sending an empty one is refused, so leave it out.
  if (!params.client_secret) delete params.client_secret;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

/** Exchanges the OAuth code for tokens. Returns the refresh token and the account's email. */
export async function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string, codeVerifier?: string) {
  const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code', ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
  if (!t.refresh_token) throw new ProviderError(t.error_description ?? t.error ?? 'Google did not return a refresh token.');
  // The id_token came straight from Google's token endpoint over TLS, so reading its payload
  // without verifying the signature is fine here.
  let account = 'Google account';
  try { account = JSON.parse(atob(t.id_token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? account; } catch { /* keep default */ }
  return { refreshToken: t.refresh_token, account, scopes: (t.scope ?? '').split(' ').filter(Boolean) };
}

const accessTokens = new Map<string, { token: string; expires: number }>();

export async function accessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const hit = accessTokens.get(refreshToken);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (!t.access_token) {
    throw new ProviderError(t.error === 'invalid_grant'
      ? 'Google access was revoked or has expired. Reconnect Google in /setup. (If the OAuth app is in "Testing", tokens expire after 7 days: set it to "In production".)'
      : `Google sign-in failed: ${t.error_description ?? t.error ?? 'unknown error'}`);
  }
  accessTokens.set(refreshToken, { token: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

async function api<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ProviderError(`Google answered ${res.status} for ${new URL(url).pathname.split('/').slice(0, 4).join('/')}.`);
  return res.json() as Promise<T>;
}

export interface GoogleCreds { clientId: string; clientSecret: string; refreshToken: string }

/** Everything the account can see, to choose from in /setup. */
export async function listGoogleChoices(creds: GoogleCreds, granted: { scopes?: string[] } = {}): Promise<{ calendars: GoogleItem[]; taskLists: GoogleItem[] }> {
  const token = await accessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
  // Only ask Google about the parts it granted; the others would just be refused.
  const [cals, lists] = await Promise.all([
    googleGranted(granted, 'calendar')
      ? api<{ items?: Array<{ id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean }> }>(token, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader')
      : { items: [] },
    googleGranted(granted, 'tasks')
      ? api<{ items?: Array<{ id: string; title: string }> }>(token, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100').catch(() => ({ items: [] }))
      : { items: [] },
  ]);
  return {
    calendars: (cals.items ?? []).map(c => ({ id: c.id, name: c.summaryOverride ?? c.summary, color: c.backgroundColor ?? '#2563FF', enabled: !!c.primary })),
    taskLists: (lists.items ?? []).map(l => ({ id: l.id, name: l.title, color: '#94A3B8', enabled: false })),
  };
}

interface GEvent { id: string; status?: string; summary?: string; location?: string; start: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }
interface GTask { id: string; title?: string; due?: string; status?: string }

export async function readGoogle(conn: GoogleConnection, creds: GoogleCreds): Promise<ProviderResult> {
  const token = await accessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
  const { start, end } = agendaWindow();
  const cals = googleGranted(conn, 'calendar') ? conn.calendars.filter(c => c.enabled) : [];
  const lists = googleGranted(conn, 'tasks') ? conn.taskLists.filter(l => l.enabled) : [];
  const sid = (kind: 'cal' | 'tasks', id: string) => `google/${kind}/${id}`;

  const eventLists = await Promise.all(cals.map(async c => {
    const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events`);
    u.search = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: '250' }).toString();
    const data = await api<{ items?: GEvent[] }>(token, u.toString());
    return (data.items ?? [])
      .filter(e => e.status !== 'cancelled' && e.start) // cancelled instances have no start
      .map((e): AgendaEvent => ({
        id: `${sid('cal', c.id)}:${e.id}`,
        source: sid('cal', c.id),
        title: e.summary ?? '(No title)',
        start: e.start.date ?? e.start.dateTime!,
        end: e.end?.date ?? e.end?.dateTime,
        allDay: !!e.start.date,
        location: e.location,
      }));
  }));

  const taskLists = await Promise.all(lists.map(async l => {
    const data = await api<{ items?: GTask[] }>(token, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=false&maxResults=100`);
    return (data.items ?? [])
      .filter(t => t.status !== 'completed' && t.title)
      .map((t): AgendaTask => ({ id: `${sid('tasks', l.id)}:${t.id}`, source: sid('tasks', l.id), title: t.title!, due: t.due?.slice(0, 10) }));
  }));

  return {
    sources: [
      ...cals.map(c => ({ id: sid('cal', c.id), name: c.name, color: c.color })),
      ...lists.map(l => ({ id: sid('tasks', l.id), name: l.name, color: l.color })),
    ],
    events: eventLists.flat(),
    tasks: taskLists.flat(),
  };
}
