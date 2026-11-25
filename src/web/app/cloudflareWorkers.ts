// Stands in for the `cloudflare:workers` module when the Worker runs inside the app (see the
// alias in vite.config.ts). Only DurableObject is used, by src/worker/skyFetcher.ts.

export class DurableObject<Env = unknown> {
  constructor(protected ctx: { storage: unknown }, protected env: Env) {}
}
