# Home&Sky Hub for iOS: requirements and plan

Status: **built through P6**, waiting on accounts and a first device build. What's done, what's left and the step-by-step for TestFlight and the App Store: [IOS-RELEASE.md](IOS-RELEASE.md).

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

## 10. Work plan: building it from Windows, with no Mac

The rule that shapes everything: **a native build is slow to get (CI → TestFlight → install, 20–45 min) and hard to debug from Windows, so do as much as possible in the browser first, and keep the native layer to off-the-shelf plugins.** Write Swift only if no plugin fits.

### The shortcut for i1: run the Worker inside the page

Every Worker route is a handler from `Request` to `Response` (`src/worker/index.ts`), and the Worker code uses only web-standard APIs (`fetch`, `crypto.subtle`, `Request`/`Response`) plus three Cloudflare bindings. So the app doesn't need ported handlers. It can **call the Worker's own `fetch(request, env)` in-process**, with stand-ins for the bindings:

| Binding / secret | Stand-in in the app |
|---|---|
| `HUB_KV` (settings, cache, track; `get`/`put`/`delete`/`list`, `expirationTtl`) | A small KV class over IndexedDB (browser) or Capacitor Preferences / SQLite (app) |
| `PHOTOS` (R2) | A small bucket class over IndexedDB (browser) or Capacitor Filesystem (app) |
| `SKY` (Durable Object `SkyFetcher`) | A stub whose `fetch()` runs the same fetcher code directly (one device, so nothing to share) |
| `DISPLAY_TOKEN`, `ADMIN_PASSWORD` | Generated at first launch and kept in the Keychain, so `settings.ts` encryption keeps working unchanged |
| `HOME_LAT`, `TIMEZONE` and the other vars | From on-device settings and Core Location |

Then three call sites switch to the in-process Worker when running as the app: `getJson()` in `src/web/api.ts`, the setup helper in `src/web/setup/ui.ts`, and `src/web/welcome.ts`. Outbound requests from the Worker code go through Capacitor's native HTTP (`CapacitorHttp` patches `fetch`, so there's no CORS). In a desktop browser, a Vite dev proxy does the same job.

The pay-off is that **all of i1 can be built and tested on Windows**, in Chrome and in Safari on the iPad over Wi-Fi, before any native build exists. The self-hosted Worker keeps working from the same code.

### Phases

| # | Phase | Where it's done | Rough effort | Done when |
|---|---|---|---|---|
| **P0** | Accounts and paperwork: Apple Developer Program enrolment (web or the Apple Developer app on the iPad), App Store Connect app record and bundle ID, App Store Connect API key for CI, Google Cloud iOS OAuth client, domain with homepage and privacy policy | Browser | 1–2 days, plus Apple's enrolment check | All accounts exist; API key stored as a CI secret |
| **P1** | **In-page Worker** (above): KV/R2/DO stand-ins, `env` built from local settings, the three call sites switched, dev proxy, an `app` build mode | Windows | ~1 week | Every screen and `/setup` works in the browser with `npm run dev:app` and **no Worker running**; unit tests for the stand-ins |
| **P2** | Capacitor shell: `@capacitor/core`, `cli`, `ios`; `npx cap add ios` (Swift Package Manager, so no CocoaPods), committed `ios/` folder; Info.plist edited by hand (location purpose string, landscape only, full screen, status bar hidden); icons and splash from `@capacitor/assets` | Windows (files), CI (build) | 2–3 days | `ios/` committed; `npx cap sync` runs clean on Windows |
| **P3** | CI and signing: a pipeline that runs `npm run build` → `cap sync ios` → archive → sign → upload to TestFlight. **Codemagic** is the easiest with no Mac (it can create and manage the certificate and profile itself from the App Store Connect API key). GitHub Actions macOS runners + fastlane is the alternative | CI | 2–4 days, mostly first-time fiddling | A commit to a branch puts a build in TestFlight; it opens on the iPad with the demo agenda |
| **P4** | Device features through plugins: keep-awake (idle timer), Core Location (rounded to ~1 km as now), Keychain secure storage, Filesystem for photos. Pairing, admin login and `stay-awake.mp4` skipped in app mode; `/setup` opened as an in-app Settings screen | Windows + TestFlight | 3–5 days | Runs overnight on the iPad without dimming, asks for location once, settings survive a restart |
| **P5a** | Photos as a live source with a capped cache (the display is always on, so it can stream rather than store everything). **First: Apple Photos** through PhotoKit: choose an album in Settings, including an iCloud **Shared Album** (Photo Stream was retired in 2023; Shared Albums replace it), and the frame shows it live as iCloud syncs, with no copying, no accounts and no review. Needs full library access (limited access only covers individually picked photos, so it wouldn't stay live), `NSPhotoLibraryUsageDescription`, iCloud downloads allowed for optimised-storage libraries, and probably a small Swift plugin (album list, assets by album, an image at display size); testable only in a TestFlight build. Then **Dropbox** folder (simplest; production approval is free past 500 users) and **Google Drive** folder chosen in Google's picker (`drive.file`; a whole-folder `drive.readonly` grant is a *restricted* scope needing a paid assessment, so check the picker route grants the folder's contents first). Downloaded at display size into a cache of a few hundred MB, least recently shown evicted first. **Google Photos can't be live**: since March 2025 apps only see items picked in the Picker, and picked items' URLs expire within about an hour, so it stays pick-and-copy (into the same capped cache) | Windows + TestFlight | ~1 week | A photo added to the chosen folder appears on the display without a new pick; cache stays under its cap |
| **P5** | Google on device: PKCE sign-in in `ASWebAuthenticationSession` through an OAuth plugin, returning by the app's URL scheme; replace the web-client code exchange in `admin.ts`/`providers/google.ts` with the device's own token and refresh; Picker session opened from the app, photos saved to Filesystem instead of R2 | Windows + TestFlight | ~1 week | Calendar, Tasks and Photos work for up to 100 test users |
| **P6** | Compliance (start the Google part early: its review takes days to weeks): data-source changes from §6 (map tiles off the OSM servers, drop airplanes.live/adsb.fi, User-Agents), attribution screen, App Privacy labels, demo mode for the reviewer, Google verification video and submission | Windows | ~1 week of work, plus waiting | Google verification submitted; no non-commercial-only source the app can't justify |
| **P7** | Release: TestFlight with a few households, store screenshots at the required iPad size (from the iPad, or a browser at that size), listing, review notes explaining what's native (§5 *4.2*) | Browser | 2–3 days, plus review | App approved |

P1 and the P0 paperwork can run side by side. P2–P3 can start as soon as P1 shows the screens, and they don't need P1 to be finished.

### Debugging the native build from Windows

- An in-app log panel (eruda or a small overlay) behind a debug setting, plus a "send logs to the dev server" option during testing.
- Debug builds set `WKWebView.isInspectable = true` (Capacitor's `ios.webContentsDebuggingEnabled`), so a Windows WebKit inspector (inspect.dev, paid; or ios-webkit-debug-proxy) can attach over USB.
- TestFlight crash reports in App Store Connect.
- If a native bug won't yield: rent a cloud Mac by the hour for a session with Xcode. If that keeps happening, a second-hand Apple-silicon Mac mini is the cheapest permanent fix.

### Risks

| Risk | Mitigation |
|---|---|
| Rejected under 4.2 as a web wrapper | Native keep-awake, location, Google sign-in, offline photos, no website to visit; say so in the review notes, and include demo mode |
| Google verification drags on | Submit as soon as the privacy policy and demo video exist; the 100-test-user cap is enough for TestFlight |
| Slow CI loop | P1 in the browser first; batch native changes; keep Swift out |
| iPad mini 5 left behind by new iPadOS versions | Set the deployment target to the oldest iPadOS Capacitor supports, and check before fixing it |
| OSM tile policy at scale | Switch tile provider in `mapTiles.ts` before release (P6) |
| Free CI minutes run out | Each build takes roughly 10–20 min; check the current free allowance of the chosen service. A public GitHub repo gets free macOS runners |
