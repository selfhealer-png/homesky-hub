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

const blobUrls = new WeakMap<HTMLImageElement, string>();

/**
 * Points an <img> at an /api/… image (photo, thumbnail, airline logo). In the app those come
 * from the in-page Worker, which an <img> can't reach, so the image is fetched and shown from a
 * blob: URL; a miss fires the image's error event, as a broken src would.
 */
export async function setApiImage(img: HTMLImageElement, path: string): Promise<void> {
  if (!IN_APP) { img.src = path; return; }
  const previous = blobUrls.get(img);
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    blobUrls.set(img, url);
    img.src = url;
  } catch {
    blobUrls.delete(img);
    img.removeAttribute('src');
    img.dispatchEvent(new Event('error'));
  } finally {
    if (previous) URL.revokeObjectURL(previous);
  }
}
