export class NotPairedError extends Error {}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) throw new NotPairedError('Display not paired');
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json() as Promise<T>;
}
