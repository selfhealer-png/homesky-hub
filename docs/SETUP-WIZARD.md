# Setup wizard

Setup has two parts. Cloudflare resources and secrets can only be created with *your* Cloudflare login, so that part runs on your computer. Everything else is set up from the hub's own `/setup` page, from any browser.

## Part 1: `npm run setup` (terminal)

Run it from a clone of the repo. It's safe to run again, because it detects what already exists and only changes what you confirm. `npm run setup -- --dry-run` shows every command without running anything that changes your account.

| Step | What happens |
|---|---|
| 1. Cloudflare login | `wrangler whoami`. If you're not signed in, it runs `wrangler login` (opens the browser). |
| 2. Name | Worker name, which becomes `https://<name>.<your-subdomain>.workers.dev`. |
| 3. Location | Type a town or postcode and pick from the matches (Open-Meteo geocoding, no key). The location is rounded to 2 dp (~1 km), and the timezone comes from the same lookup. |
| 4. Cloudflare shopping list | Each item is shown as ✔ exists / ✚ will create / – skipped: **KV namespace** `<name>-kv` (settings, route cache, Google tokens). **R2 bucket** `<name>-photos` (photo frame; optional, needs R2 enabled on the account, and the free tier is 10 GB). **Cron trigger** (trending/alerts snapshot, every minute). |
| 5. Secrets | Generates `DISPLAY_TOKEN` and `ADMIN_PASSWORD` (random, shown once) and uploads them with `wrangler secret bulk` from a temp file that's deleted afterwards. |
| 6. Config | Writes `wrangler.toml` (git-ignored) and remembers your answers in `.homesky.json` (git-ignored) as defaults for the next run. |
| 7. Deploy | `npm run build` → `wrangler deploy` → secrets, then prints the **pairing link** for the tablet and the **/setup link** for part 2. |

## Part 2: `/setup` (in the hub, password = `ADMIN_PASSWORD`)

Settings are stored in KV, and the deployment variables only provide defaults. Each card shows its status (not set / connected / error) and links to a step-by-step guide.

1. **Display**: pairing QR code and link, the list of paired displays, and an unpair-all option.
2. **Calendars and tasks (read-only)**. Pick one or more:
   * **Google account**: OAuth with read-only scopes (`calendar.readonly`, `tasks.readonly`). Tick which calendars and task lists to show, and give each a colour. *Guide: create a Google Cloud project, consent screen and OAuth client, with the exact redirect URL shown on the page. Set the app to "In production" so tokens don't expire after 7 days.*
   * **Calendar links (iCal/ICS)**: paste the *secret address in iCal format* from Google Calendar, iCloud (public calendar link) or Outlook (published calendar). These are read-only by nature. *Guide per provider.*
   * **Agenda feed**: a URL and bearer token for anything implementing [feed-contract.md](feed-contract.md) (for example a household board). *Guide: what the endpoint must return, and how to test it with the "Check feed" button.*
3. **Photos**: uses the same Google connection with the Photos Picker scope added. "Pick photos" shows a link and QR to open the picker on your phone. It also shows the photo count, R2 usage, and collections.
4. **Sky**: radar radius, overhead board theme and filters, airports for arrival boards (ICAO with search), watchlist, optional schedule-provider key, and the opt-in for Flightradar24 most-tracked flights.
5. **Screens**: order, durations, on/off per screen, night window (dim, or word clock only).
6. **Check everything**: runs every integration once and reports results in plain language.

Secrets entered in `/setup` (Google client secret, feed tokens, provider keys) are stored in KV, encrypted with a key derived from `ADMIN_PASSWORD`. Changing that password means re-entering them.
