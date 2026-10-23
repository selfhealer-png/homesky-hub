# Home&Sky Hub

An always-on display for an old or spare tablet in landscape. It rotates between **home** (clock, calendar, tasks), a **photo frame**, and the **sky above** (live aircraft radar, most-tracked flights and alerts).

It's one Cloudflare Worker that serves the web app and a small API. The tablet just runs Safari or Chrome in full screen. Nothing personal lives in the repo: your location, feeds and tokens are deployment variables and secrets.

> Status: early. See [docs/PLAN.md](docs/PLAN.md) for the architecture and milestones.

## Screens

| Screen | Status |
|---|---|
| Home: clock, today, overdue, the next few days (from any [agenda feed](docs/feed-contract.md)) | working |
| Overhead board: split-flap board for the plane above you, with three themes | working |
| Radar: live aircraft around you, nearest five labelled, coloured by altitude | working |
| Weather: now, the next hours and days, and what to wear | working |
| Clock: word clock, digital, analogue or split-flap (chosen in `/setup`) | working |
| Photos: Google Photos (via the Picker) copied to R2, crossfading slideshow | working |
| Trending: most-tracked flights, emergency squawks, alerts | planned |

Controls: tap the left or right third of the screen to switch screens, and long-press to pin the current one. On the overhead board, tap the middle to change theme; on the radar, tap the middle to switch between your saved places. In `/setup` → Display you can choose the clock style and how much the screens move (Full, Gentle or Still).

## Set up your own

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

* Settings › Display & Brightness › Auto-Lock → **Never**, and keep it on power.
* Settings › Accessibility › **Guided Access**, so the app can't be swiped away.

## Data sources and credits

* Aircraft positions: [airplanes.live](https://airplanes.live), [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi), community-fed ADS-B. Please respect their fair-use guidance; the Worker caches for 5 s so many displays share one upstream request.
* Routes and airlines: [adsbdb](https://www.adsbdb.com).
* Weather and place search: [Open-Meteo](https://open-meteo.com) (forecast and geocoding).
* Calendar parsing: [ical.js](https://github.com/kewisch/ical.js) (MPL-2.0).
* Inspired by [esp32flight](https://github.com/theqkash/esp32flight) (MIT), and by word clocks and airport split-flap boards.
* Titles use [Gabarito](https://github.com/naipefoundry/gabarito) (SIL Open Font License, see `src/web/public/fonts/Gabarito-OFL.txt`).

## License

MIT
