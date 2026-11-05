export class NotPairedError extends Error {}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) throw new NotPairedError('Display not paired');
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json() as Promise<T>;
}

/** True in the app build, where the Worker runs inside the page (src/web/app/boot.ts). */
export const IN_APP = import.meta.env.MODE === 'app';

/** Where Settings lives: the Worker serves it at /setup; the app opens the page itself. */
export const SETUP_PATH = IN_APP ? '/setup.html' : '/setup';

/**
 * The app's images as blob: URLs, shared by every <img> that shows the same path and capped by
 * size. Each new <img> on the radar and the photo frame would otherwise keep its own copy alive
 * for the life of the page, and on a display that runs for days that's what gets the web view
 * killed for memory. The least recently used are freed first; an image already on screen stays
 * drawn when its URL is freed.
 */
const BLOB_CAP_BYTES = 48 * 1024 * 1024;
const MISS_SECONDS = 30 * 60;
const blobs = new Map<string, { url: string; bytes: number }>();
const loading = new Map<string, Promise<string>>();
const misses = new Map<string, number>();
let blobBytes = 0;

function remember(path: string, url: string, bytes: number) {
  blobs.set(path, { url, bytes });
  blobBytes += bytes;
  for (const [key, b] of blobs) {
    if (blobBytes <= BLOB_CAP_BYTES || key === path) break;
    URL.revokeObjectURL(b.url);
    blobs.delete(key);
    blobBytes -= b.bytes;
  }
}

async function blobUrl(path: string): Promise<string> {
  const hit = blobs.get(path);
  if (hit) {
    // Most recently used goes to the end, so eviction takes the oldest.
    blobs.delete(path);
    blobs.set(path, hit);
    return hit.url;
  }
  if ((misses.get(path) ?? 0) > Date.now()) throw new Error(`${path} is missing`);
  let pending = loading.get(path);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(path);
      if (!res.ok) {
        // A logo the service doesn't have: don't ask again on every radar refresh.
        if (res.status === 404) misses.set(path, Date.now() + MISS_SECONDS * 1000);
        throw new Error(`${path} answered ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      remember(path, url, blob.size);
      return url;
    })().finally(() => loading.delete(path));
    loading.set(path, pending);
  }
  return pending;
}

/**
 * Points an <img> at an /api/… image (photo, thumbnail, airline logo). In the app those come
 * from the in-page Worker, which an <img> can't reach, so the image is shown from a shared
 * blob: URL; a miss fires the image's error event, as a broken src would.
 */
export async function setApiImage(img: HTMLImageElement, path: string): Promise<void> {
  if (!IN_APP) { img.src = path; return; }
  try {
    img.src = await blobUrl(path);
  } catch {
    img.removeAttribute('src');
    img.dispatchEvent(new Event('error'));
  }
}
