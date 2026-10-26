# Settings restructure plan

**Status (2026-10-26): built.** Notes on where the build differs from the plan below:
- Files are grouped by area rather than one per page: `setup/main.ts` (boot, login, router, list),
  `ui.ts`, `store.ts`, `pages.ts` (every screen page, plus Night, Motion and This hub), `accounts.ts`,
  `photos.ts`, `sky.ts`. Most screen pages are a few lines, so one file per page added little.
- Screen pages say whether the screen stays on in quiet hours, with a link to Night. They don't yet let
  you change that or how long a screen stays up: both need new settings, so they're left for later.
- The rotation filter is a pure function in `src/shared/rotation.ts`, tested in `tests/rotation.test.ts`.
- The display's long-press menu "Settings" now opens the current screen's page.

The goal: `/setup` should read like an iPhone Settings app. First, which screens the hub shows,
each with an on/off switch and a way into that screen's own settings. Then the hub-wide stuff.

## What's wrong today

`/setup` ([src/web/setup/main.ts](../src/web/setup/main.ts)) is one long page of six cards in this
order: This hub → Display → Calendars and tasks → Photos → Sky → Coming next. The problems:

- **Nothing turns a screen on or off.** The rotation is `ALL_SCREENS` in
  [src/web/main.ts:19](../src/web/main.ts:19), filtered only by "has data" (`isAvailable`) and by quiet
  hours. The only way to hide Photos or Airports is to have no photos or no airports.
- **Each screen's settings are spread out.** "Display" mixes hub-wide settings (motion, night) with
  per-screen ones (clock style, the photo frame style, Wikipedia pictures, clothing advice for Weather).
  The radar's settings are in "Sky", and the photo library is in its own card.
- **Airport boards are hidden.** They're implemented, but they sit at the very bottom of the
  "Sky" card, under places, range and radar background. They have no heading of their own in the
  page, and the screen drops out of the rotation silently when no airports are saved.
- **Two screens have no settings at all** (Overhead, Tonight), so there's no obvious place for them.

## The new shape

The page becomes a small app with a list view and drill-in detail views (hash routes, so the
browser's Back button works and links like `/setup#/screens/radar` can be shared).

```
Settings
│
├─ SCREENS
│   [icon] Home              ●━  ›     calendars, tasks
│   [icon] Weather           ●━  ›
│   [icon] Overhead          ●━  ›
│   [icon] Flight radar      ●━  ›
│   [icon] Airport boards    ━○  ›     "Add an airport to turn this on"
│   [icon] Tonight           ●━  ›
│   [icon] Clock             ●━  ›
│   [icon] Photos            ●━  ›     "48 photos"
│   [icon] Wikipedia         ●━  ›
│
├─ HUB
│   Places                   Home ›    shared by every screen that uses a location
│   Accounts                 Google ›  Google, calendar links and feeds
│   Night                    Quiet hours 22:30–06:30 ›
│   Motion                   Full ›
│
└─ ABOUT THIS HUB
    Status, Add another screen (pairing link), Sign out
```

Each screen row: icon, name, a one-line summary of its current setup in grey, an iOS-style switch,
and a chevron. The switch and the chevron are separate targets: the switch toggles, the rest of the row
opens the screen's page. (The iOS pattern of a switch *inside* a navigable row works on a phone because
the switch is on the far right; keep the switch a 51×31 target with the chevron area taking the row.)

A row whose screen is on but has nothing to show (Photos with no photos, Airport boards with no
airports, Home with no calendars) shows an amber "Needs setting up" summary instead of hiding it,
and the switch still reflects the person's choice.

### Screen pages

Every screen page has the same skeleton: the switch again at the top ("Show on the hub"), a small live
preview where there is one (the clock already has `clockPreview`), then that screen's settings,
then "How long it stays on screen" and "Show during quiet hours".

| Screen | Settings on its page | Comes from today |
| --- | --- | --- |
| Home | Calendars and task lists to show (with colours), link to Accounts to add more | Calendars card |
| Weather | Clothing advice (I run cold / Typical / I run warm), location (row linking to Places) | Display → Clothing advice |
| Overhead | Location, range (shared with radar, see below) | Sky |
| Flight radar | Location, range, map type (Plain / Map / Satellite) | Sky |
| Airport boards | Airport list: add (search), remove, reorder | Sky → Airport boards |
| Tonight | Location | (none) |
| Clock | Style picker with previews | Display → Clock |
| Photos | Frame style, Add photos (Google picker), Library | Display → Photo frame, Photos card |
| Wikipedia | With its picture / Words only | Display → Wikipedia |

**Location.** Weather, Overhead, Radar and Tonight all use the same hub location (`config.home`,
from `sky.active`). Asking for it on each page would let them disagree when they can't. So each of
those pages shows a "Location: Home ›" row that opens the shared Places page, with a note that it
changes every screen. If per-screen locations are ever wanted, this is where they'd go, but it's
not proposed here.

**Range.** Today `radiusNm` drives both the radar and the overhead board. Keep it shared and show it
on both pages, labelled "Range (also used by Overhead)".

**Airport boards** get their own row, their own page and their own switch. With no airports, turning
the switch on opens the page with the airport search focused.

### Hub pages

- **Places**: today's "Centre on" list + "Add a place" search + "Use where I am now".
- **Accounts**: today's Calendars and tasks card, minus choosing which calendars show (that moves to
  Home). Google setup, calendar links and agenda feeds live here because Photos uses Google too.
- **Night**: the three night modes and quiet hours.
- **Motion**: Full / Gentle / Still.
- **About this hub**: storage status, the pairing link, Sign out. "Coming next" is dropped.

## Data changes

Add to `DisplaySettings` in [src/shared/settings.ts](../src/shared/settings.ts):

```ts
export type ScreenId = 'home' | 'weather' | 'board' | 'radar' | 'airport' | 'tonight' | 'clock' | 'photos' | 'wiki';
/** Screens the person switched off. Absent = every screen on, so existing hubs don't change. */
screensOff?: ScreenId[];
```

A list of what's *off* (not what's on) means a new screen added in a later release shows up by default,
and hubs saved before this change behave exactly as now.

Then:

1. `HubConfig` gets `screensOff: ScreenId[]` (built in [src/worker/sky.ts](../src/worker/sky.ts)
   alongside `features`).
2. The rotation in [src/web/main.ts:77](../src/web/main.ts:77) also filters out
   `config.screensOff`; `rotationChanged` at line 212 compares it too, so a switch flipped on a phone
   reaches the tablet on the next config refresh.
3. `/api/admin/display` already saves the whole `DisplaySettings`, so the switch needs no new
   endpoint. Validate `screensOff` in [src/worker/settings.ts](../src/worker/settings.ts) against the
   known ids.
4. Guard: if every screen is off, the display shows the clock rather than an empty rotation.

Optional, later: `order?: ScreenId[]` for the screen order the "Coming next" card promised, done as
drag handles on the Screens list. Out of scope for the first pass.

## Building it

`main.ts` is ~980 lines with every card in one file. Split it as part of this:

```
src/web/setup/
  main.ts          boot, login, router, list view
  ui.ts            h(), api(), toast(), busy(), field(), switch(), row(), page header with Back
  screens/         one file per screen page (home, weather, radar, airport, clock, photos, wiki, …)
  hub/             places, accounts (google, ics, feed), night, motion, about
```

The existing render functions mostly move as they are: `skyCard` splits into `places` + `radar`,
`airportsInto` becomes the Airport boards page, `displayCard` splits five ways, `calendarsCard` splits
into Accounts (connections) and Home (`googleSelection` + which ICS calendars show), `photosCard`
moves into the Photos page.

Order of work:

1. Data: `screensOff`, `HubConfig`, rotation filter, worker validation, a test for the filter.
2. UI kit: iOS switch, grouped list rows with chevrons, page header with Back, hash router.
3. The Screens list and the Hub list, with each row linking to its existing card content moved into a
   page (no content rewrites yet).
4. Move per-screen settings to their pages as in the table above; Airport boards gets its own page.
5. Tidy copy and the "Needs setting up" summaries; check it at phone width and in dark mode.

## Open questions

1. Should flipping a switch off for Home also stop fetching calendars, or only hide the screen?
   (Proposed: only hide; it's cheap and the data is ready if it's turned back on.)
2. Is a per-display override wanted (the kitchen tablet hides Photos, the hall one doesn't)? Today all
   settings are per-hub except the radar map. Proposed: no, not in this pass.
3. Should "Overhead" and "Flight radar" be one row with two switches? They share location and range.
   Proposed: keep them separate rows, since people may want one without the other.
