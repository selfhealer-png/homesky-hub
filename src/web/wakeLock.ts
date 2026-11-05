import { hideStatusBar, keepScreenOn } from './native';

// Keeps the screen on while the hub is showing.
// The Screen Wake Lock API does this properly, but Home Screen apps on iPad only
// honour it from iPadOS 18.4. Older devices get a tiny silent looping video
// instead, which browsers also treat as a reason not to dim the screen.

let lock: WakeLockSentinel | null = null;
let video: HTMLVideoElement | null = null;

async function requestLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    return true;
  } catch {
    // Refused (low battery, or not allowed in this context): fall back to the video.
    return false;
  }
}

function playVideo() {
  if (!video) {
    video = document.createElement('video');
    video.src = '/stay-awake.mp4';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.className = 'stay-awake';
    document.body.append(video);
  }
  video.play().catch(() => { /* Needs a tap first; tried again on the next one. */ });
}

async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  if (lock) return;
  if (!(await requestLock())) playVideo();
}

export function startKeepAwake() {
  // The iOS app holds the system idle timer instead: reliable, and no video needed.
  void hideStatusBar();
  void keepScreenOn().then(native => { if (!native) startWebKeepAwake(); });
}

function startWebKeepAwake() {
  void keepAwake();
  // The lock is dropped whenever the app is hidden, so take it again on return.
  document.addEventListener('visibilitychange', () => { void keepAwake(); });
  // Some browsers only allow either method after a tap.
  document.addEventListener('pointerdown', () => { void keepAwake(); }, { passive: true });
}
