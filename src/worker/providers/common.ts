import type { AgendaEvent, AgendaSource, AgendaTask } from '../../shared/types';

export interface ProviderResult {
  sources: AgendaSource[];
  events: AgendaEvent[];
  tasks: AgendaTask[];
}

/** The agenda window every provider reads: yesterday through three weeks ahead. */
export function agendaWindow(now = Date.now()) {
  return { start: new Date(now - 86400_000), end: new Date(now + 21 * 86400_000) };
}

export class ProviderError extends Error {}

/**
 * Fetches a URL the admin supplied. Same rules everywhere: https only (webcal is https),
 * a size cap, a timeout, and upstream bodies are never echoed back to the caller.
 */
export async function fetchUserUrl(raw: string, init: RequestInit = {}, maxBytes = 5 * 1024 * 1024): Promise<Response> {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new ProviderError('That is not a valid link.');
  }
  if (url.protocol !== 'https:') throw new ProviderError('The link must start with https:// (or webcal://).');

  const res = await fetch(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) throw new ProviderError(`${url.host} did not answer.`);
  if (res.status === 401 || res.status === 403) throw new ProviderError(`${url.host} refused access (${res.status}). The link may have been reset or made private.`);
  if (res.status === 404) throw new ProviderError(`${url.host} says the link does not exist (404).`);
  if (!res.ok) throw new ProviderError(`${url.host} answered ${res.status}.`);
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new ProviderError('That calendar is too large to read.');

  // Enforce the cap while reading too, since content-length can be missing.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ProviderError('That calendar is too large to read.'); }
    chunks.push(value);
  }
  return new Response(new Blob(chunks as Uint8Array<ArrayBuffer>[]), { headers: res.headers });
}
