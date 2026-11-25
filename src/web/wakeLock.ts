import { hideStatusBar, keepScreenOn } from './native';

// Keeps the screen on while the hub is showing.
//
// The Screen Wake Lock API does this properly, but it isn't dependable on an iPad left running
// for days: Home Screen apps only honour it from iPadOS 18.4 (before that the request succeeds
// and the screen still dims), and the system can drop the lock at any time. So on an iPad the
// hub holds both the lock and a tiny silent looping video (which browsers also treat as a reason
// not to dim the screen), takes the lock again as soon as it's dropped, and checks every minute.
// Elsewhere the lock alone is enough, with the video only if the lock is refused.

let lock: WakeLockSentinel | null = null;
let video: HTMLVideoElement | null = null;

/** iPhone and iPad, including iPads that present themselves as a Mac. */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function requestLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  if (lock && !lock.released) return true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
      // Dropped while still showing (iPadOS does this now and then): take it again.
      if (document.visibilityState === 'visible') window.setTimeout(() => void keepAwake(), 1000);
    });
    return true;
  } catch {
    // Refused (Low Power Mode, or not allowed in this context): the video has to do it.
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
    video.setAttribute('muted', '');
    video.setAttribute('aria-hidden', 'true');
    video.className = 'stay-awake';
    document.body.append(video);
  }
  if (video.paused) video.play().catch(() => { /* Needs a tap first; tried again on the next one. */ });
}

async function keepAwake() {
  if (document.visibilityState !== 'visible') return;
  const locked = await requestLock();
  if (!locked || isIOS()) playVideo();
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
  // And a check every minute, in case either was dropped without telling us.
  window.setInterval(() => { void keepAwake(); }, 60_000);
}
