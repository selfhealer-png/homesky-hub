import type { GoogleWants, Settings } from '../shared/settings';
import { IN_APP } from './api';

// Connecting Google from the iOS app. The app ships its own Google client (an iOS client: no
// secret), so there's nothing to create in Google Cloud: PKCE proves it's the same app that
// started, and the sign-in runs in the system sheet (ASWebAuthenticationSession, through the
// HubNative plugin), which hands Google's redirect straight back. Only the code and the PKCE
// verifier reach the in-page Worker, which swaps them for a refresh token kept on the iPad.

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-admin': '1' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

export class SignInCancelled extends Error {}

export async function connectGoogleNative(wants: GoogleWants): Promise<Settings> {
  if (!IN_APP) throw new Error('Only in the app.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const start = await post<{ url: string; redirect: string; state: string }>('/api/admin/google/native-start', { wants, challenge });

  const { registerPlugin } = await import('@capacitor/core');
  const native = registerPlugin<{ authenticate(o: { url: string; callbackScheme: string }): Promise<{ url: string }> }>('HubNative');
  let back: URL;
  try {
    back = new URL((await native.authenticate({ url: start.url, callbackScheme: start.redirect.split(':')[0] })).url);
  } catch (err) {
    if (/cancel/i.test((err as Error).message)) throw new SignInCancelled('Sign-in was cancelled.');
    throw err;
  }
  if (back.searchParams.get('state') !== start.state) throw new Error('Google’s answer didn’t match this sign-in. Try again.');
  const error = back.searchParams.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Google access wasn’t allowed.' : `Google said: ${error}`);
  return post<Settings>('/api/admin/google/native-finish', { code: back.searchParams.get('code'), verifier });
}
