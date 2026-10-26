# Home&Sky Hub

An always-on display for an old or spare tablet in landscape. It rotates between **home** (clock, calendar, tasks), a **photo frame**, and the **sky above** (live aircraft radar, most-tracked flights and alerts).

It's one Cloudflare Worker that serves the web app and a small API. The tablet just runs Safari or Chrome in full screen. Nothing personal lives in the repo: your location, feeds and tokens are deployment variables and secrets.

> Status: early. See [docs/PLAN.md](docs/PLAN.md) for the architecture and milestones.

## Screens

| Screen | Status |
|---|---|
| Home: clock, today, overdue, the next few days (from any [agenda feed](docs/feed-contract.md)) | working |
| Overhead board: split-flap board for the plane above you, with three themes | working |
| Radar: live aircraft around you over a street map or satellite view, nearest five labelled, coloured by altitude | working |
| Weather: now, the next hours and days, what to wear (as icons), a rain radar, and pollen and air quality in the pollen season | working |
| Tonight: is it worth looking up? Cloud, the moon's phase and times, when it gets dark, the aurora chance, and visible Space Station passes | working |
| Clock: word clock, digital, analogue or split-flap (chosen in `/setup`) | working |
| Photos: Google Photos (via the Picker), full screen or framed prints, portraits in pairs, labelled with place and date | working |
| Wikipedia: today's featured article, with its picture | working |
| Trending: most-tracked flights, emergency squawks, alerts | planned |

Controls: tap the left or right third of the screen to switch screens, and long-press to pin the current one. On the overhead board, tap the middle to change theme; on the radar, tap the middle to switch between your saved places. In `/setup` → Display you can choose the clock style and how much the screens move (Full, Gentle or Still).

## Set up your own

**New to this? Follow the step-by-step guide: [docs/SETUP.md](docs/SETUP.md).** It covers everything from installing Node to setting up the iPad, Google, photos and troubleshooting.

Requirements: Node 20+ and a Cloudflare account (the free plan is fine).

```bash
npm install
npm run setup
```

The setup wizard signs you in to Cloudflare, finds your location, creates what's needed (KV namespace, optional R2 bucket for photos), generates secrets, deploys, and prints the pairing link for your tablet. Add `-- --dry-run` to see every step without changing anything. Calendars, photos and airports are then set up from the hub's `/setup` page. See [docs/SETUP-WIZARD.md](docs/SETUP-WIZARD.md).

Local development (two terminals). Copy `.dev.vars.example` to `.dev.vars` first; `AGENDA_FEED_URL=demo` shows a sample agenda.

```bash
npm run dev:worker   # Worker API on :8787
npm run dev          # web app on :5173, proxies /api to the Worker
```

### iPad tips

* The hub asks the screen to stay on by itself (Screen Wake Lock, with a fallback for older iPads). Set Settings › Display & Brightness › Auto-Lock → **Never** as well, and keep it on power.
* Settings › Accessibility › **Guided Access**, so the app can't be swiped away.

## Data sources and credits

* Aircraft positions: [airplanes.live](https://airplanes.live), [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi), community-fed ADS-B. Please respect their fair-use guidance; the Worker caches for 5 s so many displays share one upstream request.
* Routes and airlines: [adsbdb](https://www.adsbdb.com).
* Weather, cloud, pollen, air quality and place search: [Open-Meteo](https://open-meteo.com) (forecast, air quality from CAMS, geocoding).
* Rain radar: [RainViewer](https://www.rainviewer.com), over [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles (© OpenStreetMap contributors).
* Aircraft radar background: [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles, or [Sentinel-2 cloudless 2024 by EOX](https://s2maps.eu) satellite imagery (contains modified Copernicus Sentinel data; free for non-commercial use). Both are fine for this open-source hub; a commercial build should switch to a licensed provider in `src/web/mapTiles.ts`.
* Aurora: Kp forecast from the [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov).
* Space Station orbit: [CelesTrak](https://celestrak.org), with [satellite.js](https://github.com/shashwatak/satellite-js) (MIT). Sun and moon are calculated on the hub.
* Town names on the radar: [GeoNames](https://www.geonames.org) (CC BY 4.0), built into small files with the app by `scripts/build-places.mjs`.
* Article of the day: [Wikipedia](https://en.wikipedia.org) via the Wikimedia feed API (text CC BY-SA).
* Calendar parsing: [ical.js](https://github.com/kewisch/ical.js) (MPL-2.0).
* Inspired by [esp32flight](https://github.com/theqkash/esp32flight) (MIT), and by word clocks and airport split-flap boards.
* Titles use [Gabarito](https://github.com/naipefoundry/gabarito) (SIL Open Font License, see `src/web/public/fonts/Gabarito-OFL.txt`).

## License

MIT
