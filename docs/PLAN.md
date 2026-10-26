# Home&Sky Hub: project plan

An always-on landscape display for a small tablet (designed on an iPad mini 5, 1024×768 CSS px in landscape). It rotates through **screens**: what's happening at home (calendar and tasks), a photo frame, and what's flying overhead.

The project is written to be open-sourced from day one: nothing personal is committed. Every URL, token, location and ID is a deployment variable or secret.

---

## 1. Shape of the system

```
 ┌──────────────┐  HTTPS   ┌────────────────────────────── Cloudflare ──────────────────────────────┐
 │ iPad (Safari │ ───────▶ │ Worker: homesky-hub                                                   │
 │  home-screen │          │  ├─ static assets (the web app, built by Vite)                        │
 │  web app)    │ ◀─────── │  ├─ /api/agenda    ──▶ agenda providers (JSON feed, later ICS)        │
 └──────────────┘          │  ├─ /api/aircraft  ──▶ airplanes.live → adsb.lol → adsb.fi (fallback) │
                           │  ├─ /api/route     ──▶ adsbdb.com (callsign → origin/destination)     │
                           │  ├─ /api/trending  ──▶ FR24 most-tracked (opt-in) + emergency squawks │
                           │  ├─ /api/photos    ──▶ R2 bucket (photos copied in via Google Picker) │
                           │  ├─ /admin         ──▶ Google OAuth + Photos Picker sessions          │
                           │  └─ cron (1 min)   ──▶ trending snapshot + alert rules → KV, ntfy     │
                           └───────────────────────────────────────────────────────────────────────┘
```

* **One Cloudflare Worker** serves both the web app (Workers static assets) and its API. It's always on, the free tier is enough, and the iPad never talks to third parties directly. That keeps keys off the device and means caching happens in one place.
* **Web app**: Vite + TypeScript, no UI framework. It's a small bundle for an older iPad, and a "screen" is just a module that implements an interface, so new screens are easy to add.
* **Everything deployment-specific is config.** `wrangler.example.toml` is committed. Each deployer copies it to `wrangler.toml` (git-ignored) and sets secrets with `wrangler secret put`.

## 2. Screens

A screen is `{ id, title, mount(el), unmount(), durationSec }`. The **rotator** cycles through a configured playlist. Tap left or right to switch, and long-press to pin the current screen. An **alert** can interrupt the rotation (for example, jump to Trending when a flight spikes).

| Screen | Content | Data |
|---|---|---|
| **Home** | Clock, today and the next few days of events, due/overdue tasks | `/api/agenda` |
| **Photos** | Full-bleed slideshow with crossfade and slow Ken Burns, plus a small clock/next-event overlay | `/api/photos` |
| **Radar** | Live aircraft around home: rings, heading-rotated icons, trails, and a side list of nearest/most interesting with speed, altitude, route | `/api/aircraft`, `/api/route` |
| **Overhead board** | Split-flap board for the plane overhead: airline, callsign, route, altitude/speed/heading, progress bar, distance from home | `/api/overhead` |
| **Airport boards** | Arrivals into chosen airports, as a split-flap airport board: inbound now, with ETA, and optionally the timetable | `/api/airport/:icao` |
| **Trending** | Most-tracked flights and emergency squawks, with alert banners | `/api/trending` |
| **Weather** | Now, the next 18 hours, the next four days, and what to wear (feels-like bands adjusted for wind, rain, snow, UV and a personal warmth preference) | `/api/weather` (Open-Meteo) |
| **Clock** | Word clock, digital, analogue or split-flap, chosen in `/setup`. Also a candidate for the night screen | none |
| *(future)* | Weather, energy, departures, Home Assistant… | add a module in `src/web/screens/` |

Night mode: a configurable quiet window dims the UI (Safari can't set brightness, so this is a dark overlay) and switches to a minimal clock.

## 3. Agenda: linking to a household system

The hub doesn't know about any particular household app. It reads a **feed** that follows a small published JSON contract ([feed-contract.md](feed-contract.md)):

* `AGENDA_FEED_URL` + `AGENDA_FEED_TOKEN` (secret): the Worker fetches the feed server-to-server with `Authorization: Bearer …`.
* Any system can implement the contract. A private household board can add one read-only endpoint, and the hub never needs its login.
* **Privacy belongs to the producer.** The feed should only include what's OK to show on a screen in a shared room.
* Later provider: plain **ICS URLs** (Google/iCloud/Outlook secret iCal links), so people without a custom backend can use it.

## 4. Photos: Google Photos Picker + cache

Since 31 March 2025 the Google Photos Library API can only read media the app itself uploaded, so a photo frame can no longer read albums directly. The supported route is the **Picker API**:

1. The deployer creates their own Google Cloud OAuth client (web) and sets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. On `/admin`, **Connect Google** runs OAuth with the `photospicker.mediaitems.readonly` scope. The refresh token goes into KV.
3. **Pick photos** creates a Picker session and shows its link/QR. You choose photos on a phone or desktop, and the picker lets you browse an album and select its contents.
4. The Worker polls the session. Once photos are picked, it downloads each one at display size (`baseUrl=w2266-h1488`), stores it in **R2** with its metadata, and then deletes the session.
5. The frame rotates whatever is in R2. Collections (for example "Summer 2026") are labels on stored photos, so the playlist can choose a collection, all photos, or "on this day".

Picked-item URLs expire after 60 minutes, which is why photos are copied rather than linked. To add new photos, pick again.

## 5. Sky

Ideas taken from [esp32flight](https://github.com/theqkash/esp32flight) (MIT) and [Skyty Wall](https://skyty.app/wall/), a commercial iPad flight board. We take ideas only. Skyty Wall's design, assets and wording aren't reused.

### Data

* **Positions** come from free community ADS-B aggregators: adsb.lol first, then adsb.fi and airplanes.live. Queries are `/v2/point/{lat}/{lon}/{radiusNm}`. A local `readsb`/`dump1090` URL can be set instead.
* **These sources limit requests per address, and Cloudflare's addresses are shared by many sites.** From Cloudflare, adsb.fi and airplanes.live refuse (airplanes.live now serves feeders only), and adsb.lol rate-limits often. None of them allow browsers to read their data, so the display can't fetch directly. The hub therefore uses two layers:
  1. **A shared fetcher** (the `SKY` Durable Object, free plan): fresh positions there (< 8 s old) serve every screen on every device, so the hub asks far less often.
  2. **If it's refused, the Worker handling the request tries itself**, from a different Cloudflare location and address, and hands a good result back to the shared fetcher.
  Sources that refuse are rested rather than retried. If everything fails, the last good positions (< 90 s) are served, and the display keeps planes moving on their tracks for up to 2 minutes. Measured from Langwathby: 23 of 24 requests over 4 minutes returned planes, against about half before.
* **Next step for full reliability (free, optional):** a home relay or a home ADS-B receiver that pushes positions to the hub, since the free sources work from home connections.
* **Routes and airlines**: `api.adsbdb.com/v0/callsign/{callsign}` returns the airline name/IATA/ICAO plus the origin and destination airports with coordinates (tested working). Results are cached in KV for 24 h and shared by every screen. A route is only shown when it fits the aircraft's position and track (esp32flight rejects stale routes the same way). Without one, the board falls back to the type and registration.
* `HOME_LAT`/`HOME_LON` are deployment variables. Rounding to 2 dp (~1 km) is recommended.

### Radar

* v1 (built) is a canvas radar with no map tiles: range rings, aircraft icons rotated to their heading, trails, a nearest list, and emergency highlighting. Positions are moved forward between polls so the planes glide smoothly.
* v2 labels only the nearest few planes plus any selected or alerting one, so labels stop overlapping over busy airspace. Tapping a plane opens its details. It adds an optional dark map layer (a configurable tile URL, attribution shown) and filters.

### Overhead board (split-flap)

The "what's that plane?" screen. One aircraft is shown as a flip board:

```
          BRITISH AIRWAYS
        [B][A][W][2][8][F]
     LAX  Los Angeles → London  LHR
   ALT 4,050 ft ↘  SPD 178 kt  HDG 271° W
   LAX ●━━━━━━━━━━━━━━━━━━━━━━━━━○ LHR
   8,740 km flown · 12 km to go · 2.1 km from home · A21N G-XXXX
```

* **Which aircraft**: the closest one that passes the filters, held for at least 20 s so the board doesn't keep flipping. Watch-listed and emergency aircraft always take over.
* **Flip animation**: each character is its own tile and steps through the character set to the new value, top half flipping down. It's plain CSS 3D transforms and works on iPad Safari. When the plane changes, only the characters that changed flip.
* **Progress**: great-circle distance from origin and to destination, using the airport coordinates from adsbdb.
* **Themes** (set with CSS tokens, chosen per display): *Split-flap* (cream on charcoal), *LED* (amber dot-matrix on black), *Minimal* (large serif, light). They share one layout.
* **Filters**: airliners only (has a route or an airline ICAO), minimum altitude, airline include/exclude, and no ground traffic.
* **Airline logos**: open question. The good logo sets have unclear licences, so v1 shows the airline name in large type. A logo pack can be an optional add-on that each deployer configures.

### Airport boards

Up to six airports are chosen in `/setup › Sky › Airport boards`, searched from the OurAirports list (public domain; `scripts/build-airports.mjs` builds `airports.json` at build time). Each gets a split-flap board styled like an airport arrivals board, served by `/api/airport?code=<ICAO>` (only airports chosen in setup). Each visit to the screen shows the next airport's arrivals; a tap in the middle turns to departures, then the next airport.

* **Inbound now** (free, open data, default; *built*): every ~25 s the Worker fetches live aircraft within 100 nm of the airport. Only planes pointing at the airport (or low and near it) are looked up, nearest first, with at most 25 new adsbdb lookups per board so a free-plan request stays under its 50 outside requests. It looks up each callsign's route (cached) and keeps those whose destination is that airport. ETA is distance ÷ ground speed, adjusted for planes on approach. The board shows these columns:

  ```
  FROM        FLIGHT   TYPE  ALT      ETA    STATUS
  NEW YORK    BA 178   B77W  FL350    14:52  EN ROUTE
  MADRID      IB 3166  A320  6,200ft  14:31  APPROACH
  DUBLIN      EI 156   A20N  1,900ft  14:24  LANDING
  ```

  Status comes from altitude, vertical rate and distance: en route, descending, approach, landing, landed.
* **Departures** (outbound, also free; *built*): aircraft whose origin is the airport, taxiing or moving away within 80 nm. Status: taxiing, takeoff, climbing, departed. Planes on the ground are capped (2 landed, 3 taxiing) so the airborne traffic still shows at a busy airport.
* **Timetable** (optional): scheduled and estimated times, gates, delays and cancellations. These need a schedule provider with its own key. The provider interface comes first; AeroDataBox is the likely default because it has a small free tier, and its units-per-call cost needs checking. It stays off unless a key is set.
* Board rotation: when there are several airports, the board flips between them, or each one can be its own screen in the playlist.

### Watchlist

`WATCHLIST` holds callsigns, registrations or hex codes (for example a family member's flight). A match gets a banner, takes over the overhead board when it's in range, and sends an optional ntfy push. Shares its alert plumbing with Trending (§6).

## 6. Trending and alerts

* **Flightradar24 "most tracked"** has no official free endpoint. It's implemented as an **opt-in provider** (`FR24_TRENDING=on`), for personal use, with back-off on 429s, and is documented as such. It's off by default in the open-source release.
* **Emergency squawks** (7500/7600/7700) come from open ADS-B data and are always available. These are usually what *causes* a tracking spike anyway.
* A **cron** (every minute) stores snapshots in KV and evaluates rules: a flight enters the top N, its watcher count exceeds X, it rises by Y % within Z minutes, an emergency squawk appears nearby or worldwide, or a watch-listed registration or callsign shows up. Alerts appear as a banner/interrupt on the display and, optionally, as a push via `NTFY_TOPIC_URL`.

## 7. Access control

* **Display**: a long random `DISPLAY_TOKEN`. Open `https://<host>/pair#<token>` once on the iPad. That sets a long-lived HttpOnly cookie, then the app is added to the Home Screen.
* **Admin** (`/admin`, photo picking): `ADMIN_PASSWORD` over Basic auth, or put the Worker behind Cloudflare Access.
* Bearer secrets are checked with "secret exists *and* matches", so an unset secret can never match.

## 8. iPad setup (documented in README)

Add to Home Screen → Settings › Display › Auto-Lock **Never** → Guided Access on (stops accidental exits) → keep it on power. iPad mini 5 runs current Safari, so ES2020 and CSS grid are safe.

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Skeleton *(this commit)* | Worker + Vite build, screen rotator, clock, live canvas radar from `/api/aircraft`, placeholder Home/Photos screens, config template |
| **M1** | Agenda | Feed contract and demo feed *(done)*, Home screen in the household board's visual style *(done)*, ICS and Google read-only providers, the household board's feed endpoint added (in that project) |
| **M1b** | Setup wizard | `npm run setup` *(done)*; `/setup` page with admin login, encrypted KV settings, iCal/feed/Google read-only calendars with guides, photos, sky places *(done)*; screens and night mode next ([SETUP-WIZARD.md](SETUP-WIZARD.md)) |
| **M2** | Photos | Google Photos Picker → R2 import in batches, collections, slideshow with crossfade, drift and blurred backdrop for portraits *(done; Google sign-in not yet tested with a real OAuth client)* |
| **M3** | Overhead board + Radar v2 | Route/airline lookup and split-flap board with three themes and filters *(done)*; radar redesign: labels on the five nearest only, altitude colours, compass bezel, refresh ping *(done)*; saved places, per-display GPS, tap to switch place *(done)*; tap for details and optional map tiles next |
| **M3b** | Airport boards | Airports chosen in /setup, inbound/departing computed from ADS-B + routes, split-flap arrivals and departures board *(done)*; schedule-provider interface (optional key) next |
| **M4** | Trending + alerts | Cron snapshots, FR24 opt-in provider, squawk rules, watchlist, banner + ntfy |
| **M5** | Polish + publish | Night mode, stale/offline indicators, display pairing, setup guide with screenshots, CI (typecheck + build), first public release |
