import { IN_APP } from './api';

// What the iOS app does natively instead of through the browser. Everything here is reached
// only when IN_APP (a build-time constant), so the self-hosted web build drops these imports.
// In the app opened in a plain browser (npm run dev:app), each falls back to the web way.

declare global {
  interface Window { Capacitor?: { isNativePlatform?: () => boolean } }
}

export const isNativeApp =(): boolean => IN_APP && !!window.Capacitor?.isNativePlatform?.();

export interface Position { lat: number; lon: number }

const webPosition = (timeout: number, maximumAge: number) => new Promise<Position | null>(resolve => {
  if (!('geolocation' in navigator)) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: false, timeout, maximumAge },
  );
});

/**
 * Where this device is, or null if it won't say. In the app this is Core Location ("When In
 * Use", asked once, with the purpose string in Info.plist), which avoids WKWebView asking a
 * second time for the page's own origin.
 */
export async function devicePosition(timeout = 15_000, maximumAge = 15 * 60_000): Promise<Position | null> {
  if (!isNativeApp()) return webPosition(timeout, maximumAge);
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted' && (await Geolocation.requestPermissions({ permissions: ['coarseLocation'] })).location !== 'granted') return null;
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout, maximumAge });
    return { lat: p.coords.latitude, lon: p.coords.longitude };
  } catch {
    return null;
  }
}

/** Keeps the screen on with the system idle timer. False when that isn't available here. */
export async function keepScreenOn(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.keepAwake();
    return true;
  } catch {
    return false;
  }
}

/** The display is full screen: no clock and battery along the top. */
export async function hideStatusBar(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch { /* plist already hides it at launch */ }
}
