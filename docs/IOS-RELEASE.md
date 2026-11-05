# Home&Sky Hub for iOS: getting it onto an iPad and into the App Store

This is the hands-on companion to [IOS-PLAN.md](IOS-PLAN.md). Everything that can be built is built and in the repository. What's left needs your accounts, and a real build on the iPad to try what only a device can do. All of it works from Windows.

## Where things stand

| | Phase | State |
|---|---|---|
| P1 | Worker inside the page | **Done, tested in the browser.** `npm run dev:app` runs every screen with no Worker. |
| — | Setup wizard (pick screens, then one page each) | **Done, tested in the browser.** Also used by the self-hosted web version. |
| P2 | Capacitor iOS project (`ios/`) | **Done.** iPad only, landscape, full screen, icon and splash, permission texts. Generated and synced on Windows. |
| P3 | Cloud builds | **Written, not yet run:** `.github/workflows/ios-compile.yml` (compile check, no account needed) and `codemagic.yaml` (signed build → TestFlight). Needs the accounts below. |
| P4 | Device features | **Done, not yet run on a device:** keep-awake, Core Location, Keychain for the secret, settings in UserDefaults, native HTTP, status bar hidden. |
| P5 | iPad calendars and reminders, Apple Photos albums, Google sign-in from the app | **Done in TypeScript and tested in the browser with sample data (`VITE_FAKE_DEVICE=1`). The Swift plugin (`ios/App/App/HubNativePlugin.swift`) is written but has never been compiled:** the first compile check will tell. |
| P5a | Dropbox and Google Drive folders | **Not started.** Each needs its own developer app and OAuth keys (see "Later"). |
| P6 | Compliance | **Done:** adsb.lol only in the app, a setting for the map tile provider, credits and privacy note in Settings › This hub, [privacy policy](privacy.md), privacy manifest. Google verification needs you. |
| P7 | Release | Steps below. |

## 1. Accounts (once)

1. **Apple Developer Program** ($99 a year, or the local equivalent). Enrol at developer.apple.com/programs, or in the Apple Developer app on the iPad. An individual account needs an Apple ID with two-factor authentication. Approval usually takes a day or two.
2. **App Store Connect app record.** At appstoreconnect.apple.com → Apps → +: platform iOS, name "Home&Sky Hub" (or what you like; the name must be unique on the store), primary language, bundle ID `app.homesky.hub` (register it first under Certificates, Identifiers & Profiles → Identifiers if it isn't offered), SKU anything. If you change the bundle ID, change it in `capacitor.config.ts`, `ios/App/App.xcodeproj/project.pbxproj` (two places) and `codemagic.yaml`, **before** the first upload: it can't change after.
3. **App Store Connect API key.** Users and Access → Integrations → App Store Connect API → +, role **App Manager**. Download the `.p8` file (only offered once) and note the Key ID and Issuer ID.
4. **GitHub repository** (for the free compile check). Push this repository to GitHub. A public repository gets macOS runners free. Open Actions and run "iOS compile check": it compiles the app, including the Swift plugin, for the iPad simulator. **Do this first: it's the cheapest way to find Swift mistakes.**
5. **Codemagic** (codemagic.io, sign in with GitHub). Add the repository. Teams → Integrations → Developer Portal: add the API key from step 3 under the name **`homesky ASC key`** (the name `codemagic.yaml` uses). Codemagic then makes and renews the signing certificate and provisioning profile itself, so you never handle certificates.
6. In Codemagic → the app → Environment variables, create a group named **`google`**. It can stay empty for now (see step 3 of Google, below). In `codemagic.yaml`, replace `APP_STORE_APPLE_ID: 0000000000` with the app's Apple ID: the number on its App Information page in App Store Connect.

## 2. First TestFlight build

1. Push to a branch named `release/…` (for example `release/first`), or tag `v0.1.0`. Codemagic builds, signs and uploads. Expect about 15–25 minutes, then 5–30 minutes of "Processing" in App Store Connect.
2. App Store Connect → TestFlight: answer the export-compliance question if asked (the app only uses standard HTTPS: Info.plist already says so). Add yourself to an internal group, and create the external group **`Households`** (the name `codemagic.yaml` publishes to) for other families later. External testers need a short Beta App Review, usually a day.
3. Install **TestFlight** on the iPad, accept the invite, install Home&Sky Hub.

## 3. What to check on the iPad (things a browser can't show)

Tick these off on the first TestFlight build. Anything that fails: note what you saw, and paste the Codemagic or compile-check log if there is one.

- [ ] It opens full screen in landscape, with no status bar, on the dark splash then the wizard.
- [ ] Location: one iOS prompt (not two), and the weather is for the right town.
- [ ] Planes appear on the radar (native HTTP reaching adsb.lol), with airline logos on the board (binary downloads through native HTTP: the likeliest thing to need a fix).
- [ ] "Calendars and reminders on this iPad": the iOS prompts appear, calendars from iCloud and other accounts are listed, and events show on Home.
- [ ] "Choose an album in Apple Photos": the prompt, the album list including Shared Albums, and photos on the frame. Add a photo to the album on a phone: it should appear within a few minutes.
- [ ] The screen stays on (leave it an hour with Auto-Lock at 2 minutes).
- [ ] Settings opens with a long-press, and Done comes back to the display.
- [ ] Quit the app from the app switcher and reopen: settings and choices are still there.
- [ ] Overnight on power: still running in the morning (iOS may restart a web view that uses too much memory; the app should simply reload).

**Debugging from Windows:** debug builds allow the web view to be inspected (`webContentsDebuggingEnabled`). Connect the iPad by USB and use [inspect.dev](https://inspect.dev) (paid, with a trial) or the free `ios-webkit-debug-proxy`. For anything native that won't yield, rent a cloud Mac by the hour.

## 4. Google (only if you want Google in the app)

The app ships its own **iOS** OAuth client: users just press Connect Google. Calendars on the iPad and Apple Photos need none of this, so it can wait.

1. In a Google Cloud project you own: Google Auth Platform → Clients → Create client → **iOS**, bundle ID `app.homesky.hub`. Copy the client ID (`….apps.googleusercontent.com`). iOS clients have no secret.
2. Enable the APIs used: Google Calendar API, Google Tasks API, Photos Picker API.
3. In Codemagic's `google` group, set `GOOGLE_IOS_CLIENT_ID` to that client ID. The build bakes it in and sets the app's return address (`com.googleusercontent.apps.…`) for you.
4. Audience: while "Testing", add the Google accounts of your test households (up to 100). Sign-ins expire after 7 days in Testing.
5. **Verification**, before the public release: Branding → app name, logo, home page and privacy policy (publish [privacy.md](privacy.md), e.g. with GitHub Pages, on a domain you verify in Google Search Console), and a YouTube video showing the sign-in and each scope in use. Calendar and Tasks read-only are "sensitive" scopes: expect a review of days to a few weeks. None are "restricted", so there's no paid security assessment.

## 5. Map tiles, before many people use it

The radar's street map falls back to OpenStreetMap's own tile servers, which is fine for a handful of TestFlight iPads but not for an App Store app (OSM's tile policy). Pick a provider with a free tier (MapTiler, Stadia Maps…) and add to Codemagic a group **`maps`** with:

- `VITE_MAP_TILE_URL`: a raster tile URL template with `{z}`, `{x}`, `{y}` and your key, for example `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=YOUR_KEY`;
- `VITE_MAP_TILE_CREDIT`: what the provider asks you to show, e.g. `© MapTiler © OpenStreetMap contributors`.

Then add `- maps` under `groups:` in `codemagic.yaml`. The satellite view uses EOX's Sentinel-2 cloudless tiles, which are free for non-commercial use: fine while the app is free.

## 6. App Store submission

**App Privacy** (App Store Connect → App Privacy): choose **"Data Not Collected"**. That's accurate: nothing is sent to you, and the services the app calls receive requests the way a browser's would. The privacy manifest (`PrivacyInfo.xcprivacy`) says the same.

**Age rating:** 4+ (no objectionable content; the Wikipedia screen can hide its pictures in Settings).

**Category:** Weather, or Utilities.

**Screenshots:** iPad 13" (2064 × 2752 portrait or 2752 × 2064 landscape) are required. Take them on the iPad (top button + volume up) on a few good screens, or render the screens at that size in a desktop browser (`npm run dev:app`, window sized 1376 × 1032 at 2× zoom).

**Description** (a starting point):

> Turn a spare iPad into a calm display for home and the sky above it. Home shows today's events, what's overdue and the next few days, from the calendars on your iPad. A live radar shows the planes overhead, with a split-flap board for the one closest above you. There's weather and what to wear, a rain radar, tides, tonight's sky and the Space Station, a word clock, a photo frame for an album from Photos, and Wikipedia's article of the day. Pick the screens you want; they take turns all day. No account, no subscription, and nothing leaves your iPad.

**Review notes** (App Review guideline 4.2 rejects "web wrappers", so say what's native):

> Home&Sky Hub is an always-on display for a spare iPad. It has no account or login. To see it working: pick some screens in the setup wizard; for Home, choose "Calendars and reminders on this iPad", or paste this public calendar: https://www.gov.uk/bank-holidays/england-and-wales.ics. Native features: Core Location for the local weather and sky; EventKit for the iPad's own calendars and reminders; PhotoKit for a live Apple Photos album (including Shared Albums); the idle timer kept off so the display stays on; the Keychain for the optional Google sign-in (ASWebAuthenticationSession). All data stays on the device; there is no server. Tap the left or right edge to change screen; long-press for Settings.

Submit from App Store Connect once a TestFlight build is good.

## Later

- **Dropbox and Google Drive folders** as live photo sources with a capped cache (IOS-PLAN.md, P5a). Each needs a developer app (Dropbox App Console; a Google Drive picker with `drive.file`) and its own sign-in, built the same way as the Google sign-in here.
- **A daytime set of preview screenshots** for the wizard (`src/web/public/previews/`): the airport board one was taken near midnight and is empty, and the Photos tile uses a stand-in.
- **An icon by a designer.** `scripts/make-icons.mjs` draws the current one; replace `resources/icon.png` and run `npm run ios:icons`.

## Commands

```bash
npm run dev:app
```

```bash
npm run ios:sync
```

```bash
npm run ios:icons
```

`.env.app` (git-ignored, project root) sets build-time options for app mode: `VITE_AGENDA_FEED_URL=demo` for the sample agenda, `VITE_FAKE_DEVICE=1` for sample iPad calendars and albums in a browser, `VITE_GOOGLE_IOS_CLIENT_ID`, `VITE_MAP_TILE_URL` and `VITE_MAP_TILE_CREDIT`.
