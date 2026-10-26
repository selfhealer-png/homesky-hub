# Home&Sky Hub for iOS: requirements and plan

Status: **draft for discussion**. Nothing here is built yet.

## 1. Why

Today a household needs a free Cloudflare account, a Worker deploy, an R2 bucket and their own Google Cloud OAuth client (about ten steps, including the "unverified app" warning). An App Store app can ship **one verified Google client** inside it, so Google becomes a single **Connect Google** button, and the Worker isn't needed at all: every job it does can run on the iPad itself.

Result for the user: install the app, allow location, optionally press Connect Google. No Cloudflare, no terminal, no pairing link.

## 2. Recommended approach: a native shell around the existing web app

| Option | Reuse | Effort | Notes |
|---|---|---|---|
| **Capacitor (WKWebView) shell** *(recommended)* | All screens, styles, setup UI and most Worker logic (TypeScript) | Weeks | Native plugins for HTTP, storage, files, sign-in, keep-awake. Same code can still build the web version. |
| SwiftUI rewrite | Ideas only | Months | Best "native feel", but ~6,300 lines of TypeScript to redo, and the radar/flap boards are canvas/DOM work that ports badly. |

The screens already talk to the backend through one function, `getJson()` in `src/web/api.ts`. In the app, that function calls the ported Worker handlers directly instead of `fetch('/api/…')`. That is the main seam.

## 3. Where each Worker job goes

| Today (Worker) | In the app | Why it works on device |
|---|---|---|
| `/api/aircraft`, `SKY` Durable Object (`aircraft.ts`, `skyFetcher.ts`) | Fetched on the iPad via native HTTP | The ADS-B sources block browsers (no CORS) and rate-limit Cloudflare's shared addresses. Native HTTP has no CORS, and a home connection is the address type they *do* serve. Likely **more** reliable than today. The shared fetcher is dropped (one device). |
| `/api/route` (adsbdb) | Native HTTP + local cache | Same lookups; `cached()` moves from KV to on-device storage. |
| `/api/weather`, air quality, geocoding (Open-Meteo) | Native HTTP | Unchanged. |
| `/api/tonight` (Celestrak, NOAA SWPC, `astro.ts`) | Native HTTP + existing maths | Unchanged. |
| `/api/wiki` (Wikimedia) | Native HTTP | Wikimedia wants a descriptive User-Agent, which native HTTP can set. |
| `/api/agenda`: ICS links, JSON feed | Native HTTP | Most iCal hosts don't send CORS headers; native HTTP avoids that. Feed token stored in the Keychain. |
| `/api/agenda`: Google Calendar/Tasks (`providers/google.ts`) | Called from the device with the user's own token | No secret needed with an iOS client (see §4). |
| `/api/photos` + R2 (`photos.ts`) | Picker session from the device; photos saved to the app's own storage | Removes R2 entirely. ~500 photos at display size ≈ 150–300 MB on the iPad. |
| KV settings (`settings.ts`) | On-device preferences; secrets/tokens in the Keychain | |
| `/setup` page, admin password (`admin.ts`, `adminAuth.ts`) | A Settings screen inside the app | The setup UI (`src/web/setup/`) is reused; the login goes away because the device is the owner. |
| Pairing, `DISPLAY_TOKEN` (`auth.ts`, `welcome.ts`) | Removed | Nothing to pair. |
| `npm run setup`, `wrangler.toml` | Removed for app users | Kept only if the self-hosted web version continues. |

Device features that change:

| Today | In the app |
|---|---|
| Wake Lock API + looping `stay-awake.mp4` (`wakeLock.ts`) | `UIApplication.isIdleTimerDisabled = true`. Reliable, no video hack. |
| Browser geolocation (`location.ts`, `onboarding.ts`) | Core Location "When In Use", still rounded to ~1 km. |
| `localStorage` | Kept for small UI state (WKWebView supports it), or moved to Preferences. |
| Add to Home Screen + Guided Access | A normal app. Guided Access stays optional for kiosk use. |

## 4. Google: one verified iOS client

1. In a Google Cloud project you own, create an **iOS** OAuth client (bundle ID e.g. `app.homesky.hub`). iOS clients have **no client secret**: the app signs in with PKCE in the system sign-in sheet (`ASWebAuthenticationSession` or the Google Sign-In SDK), Google returns to the app by its custom URL scheme, and the app refreshes tokens itself. **No relay server is needed.**
2. Scopes, requested only when the user turns that feature on:
   - `photospicker.mediaitems.readonly` (photos)
   - `calendar.readonly` and `tasks.readonly` (agenda)
3. Verification (free): homepage and privacy policy on a domain verified in Search Console, a reason for each scope, a YouTube demo video of the sign-in and each scope in use, and Limited Use compliance. Calendar and Tasks read-only are **sensitive**, so a manual review (days to a few weeks) is needed; until then the app is capped at 100 users and shows the "unverified" warning. Confirm the Picker scope's category in the console when adding it. None of these scopes are **restricted**, so no paid security assessment (CASA).
4. Photos behave as today: the user picks in Google's picker (it opens the Google Photos app on the iPad if installed), the app downloads at display size, and new photos need a new pick.
5. The privacy story gets simpler: tokens and photos stay on the iPad. The developer never receives user data, because there's no server.

## 5. Apple requirements

- **Apple Developer Program**: $99/year (needed for TestFlight and the App Store).
- **A Mac with Xcode** to build and sign. Development here is on Windows, so one of: a Mac (any Apple-silicon Mac mini is enough), a rented cloud Mac, or building in CI (**Xcode Cloud** includes 25 free compute hours a month with the Developer Program; GitHub Actions has macOS runners). Testing on a real iPad needs the iPad connected to that Mac or a TestFlight build.
- **Minimum iPadOS**: pick one that covers the iPad mini 5 (the design target). Check which iPadOS versions it supports before fixing the deployment target; older spare tablets are the audience, so keep it as low as Capacitor allows.
- **App Review points to prepare for:**
  - *4.2 Minimum functionality*: web-wrapper apps get rejected when they're just a website. Native keep-awake, native location, Google sign-in, offline photo storage and the fact there's no website to visit all help; say so in the review notes.
  - *5.1.1 Data collection*: location purpose string, account deletion is not required (no accounts), a privacy policy URL, and **App Privacy labels** ("Data not collected" is likely true if nothing leaves the device except to the listed services).
  - *Google sign-in*: Sign in with Apple is **not** required, because Google here is a data source, not the app's login.
  - A demo mode for the reviewer (the existing demo agenda, `demo.ts`) so they can see screens without a Google account.
- **Store listing**: screenshots at iPad sizes, description, support URL, age rating.

### Developing without a Mac

| Works on Windows | Needs a Mac (or a Mac in CI) |
|---|---|
| All TypeScript work, unit tests, the Vite dev server | Building and signing the app |
| The screens in **Safari on the iPad itself** over the home network (`vite --host`). Safari and the app's WKWebView share the WebKit engine, so layout and rendering match closely | The iOS Simulator (Mac only) |
| The on-device backend (§3), if it can also run in the browser behind a dev proxy | Xcode's debugger, Instruments, and live reload into the app (`npx cap run ios`) |
| TestFlight crash reports and App Store Connect (web) | Safari Web Inspector on the iPad (Mac only). On Windows: an on-screen console such as eruda, logging to the dev server, or a paid tool such as inspect.dev |

What only a real app build can show, so it gets tested through TestFlight: Google sign-in returning to the app, keep-awake, the location prompt, native HTTP, Keychain, photo storage, and overnight behaviour (memory warnings, the app being suspended).

Building without a Mac: GitHub Actions macOS runners (free for a public repository), Codemagic (free monthly macOS minutes) or Xcode Cloud (first-time setup is normally done in Xcode). Signing certificates can be made on Windows with OpenSSL and handed to CI (for example fastlane match). Each round of change → CI build → TestFlight processing → install takes roughly 20–45 minutes, against seconds with a Mac. So: keep the native part small, test everything else in Safari on the iPad, and rent a cloud Mac by the hour for the occasional native bug.

## 6. Third-party data terms (must check before shipping)

Several sources are free for **non-commercial** use, and the code already notes this (`mapTiles.ts`). A free, open-source app is the safe position; charging money changes the answer.

| Source | Use | What to check |
|---|---|---|
| adsb.lol | Aircraft | ODbL: attribution. Generally fine. |
| adsb.fi, airplanes.live | Aircraft fallbacks | Personal/non-commercial terms; airplanes.live now serves feeders only. Probably drop from the app. |
| adsbdb | Routes | Free API; check terms for app use and add a User-Agent. |
| OpenStreetMap tiles | Radar street map | The OSM tile policy forbids heavy use by distributed apps. With many installs, switch to a provider with a free tier (MapTiler, Stadia, Protomaps self-hosted file). |
| EOX Sentinel-2 cloudless 2024 | Radar satellite | CC BY-NC-SA: non-commercial only. |
| Open-Meteo | Weather, air quality, geocoding | Free for non-commercial, up to 10,000 calls/day **per device** (fine). Commercial use needs their paid plan. |
| RainViewer | Rain radar | Check current free-API limits and attribution. |
| Celestrak, NOAA SWPC, Wikimedia | Tonight's sky, wiki | Public/open data; attribution and User-Agent. |
| Flightradar24 "most tracked" | Planned, opt-in | Unofficial; leave it out of the App Store build. |

## 7. Milestones

| | Milestone | Done when |
|---|---|---|
| **i0** | Toolchain | Capacitor project builds the current web app into an iPad app on a Mac/CI; it runs against an existing Worker. |
| **i1** | Local backend | `getJson()` routes to on-device handlers; weather, tonight, wiki, aircraft, routes and ICS work with **no Worker**. Native HTTP plugin, local cache replacing KV. |
| **i2** | Device features | Keep-awake via idle timer, Core Location, in-app Settings replacing `/setup`; pairing and admin login removed. |
| **i3** | Google | iOS OAuth client, PKCE sign-in, Calendar/Tasks from device, Picker → on-device photo store. Tested with up to 100 test users before verification. |
| **i4** | Compliance | Privacy policy + homepage, Google verification submitted, data-source swaps from §6, App Privacy labels, demo mode for review. |
| **i5** | Release | TestFlight with a few households, then App Store submission. |

## 8. Running costs

| Item | Cost |
|---|---|
| Apple Developer Program | $99/year |
| Mac for building | $0 if using Xcode Cloud's free hours, otherwise a Mac or a rented one |
| Domain for homepage + privacy policy | ~£10/year (pages can be hosted free, e.g. GitHub Pages or Cloudflare Pages) |
| Google verification and APIs | Free |
| Servers | None. Each iPad does its own fetching and storage. |
| Map tiles | Free tier of a tile provider at small scale; may cost money if the app gets popular |

## 9. Decisions needed

1. **Keep the self-hosted web version?** The shared code makes it cheap to keep both: the Worker for people who want a browser display or several displays sharing one feed, the app for everyone else.
2. **Free or paid?** Paid (or a Premium tier) turns several data sources in §6 into paid or replaced ones.
3. **Setup on the iPad itself, or from a phone?** On the iPad is simplest. A phone companion only matters if the display is mounted out of reach.
4. **Android later?** Capacitor builds Android from the same code; Google sign-in there uses an Android client in the same project.
