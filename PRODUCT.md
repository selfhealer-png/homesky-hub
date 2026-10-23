# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary:** a household with a spare tablet (designed on an iPad mini 5, landscape) left on permanently in one fixed spot: on a desk beside someone working, or in a kitchen or living room. Whoever is passing glances at it, often from across the room. They don't operate it so much as look at it, and they occasionally tap to switch screens.

**Secondary:** whoever sets it up. For the open-source release, that is *anyone with a spare tablet*, not only people who self-host. They are guided step by step by `npm run setup` and the hub's `/setup` page. Setup is done from a phone or laptop, not on the display.

## Product Purpose

An always-on ambient display that brings together what's happening at home and what's in the sky above it:

- **Home**: today's events, overdue items and the next few days from the household's calendars and task lists.
- **Photos**: a photo frame of pictures the household picks from Google Photos.
- **Sky**: what's flying overhead. A radar, a split-flap board for the plane above, and later airport arrivals, most-tracked flights and alerts.
- Also a word clock, with more screens to be added over time.

Success: it stays on all day without ever needing attention, it can be read at a glance, and a non-expert can set up their own.

## Positioning

A free, open-source alternative to single-purpose paid devices and apps (photo-frame calendars, flight boards). It turns a tablet you already own into one display that does all three. It runs on the household's own free Cloudflare account and its own Google connection, so there's no subscription and no vendor holding the data.

## Operating Context

- The display is a web app added to the Home Screen and left running on power (Auto-Lock off, Guided Access on). It is paired once with a link and rotates through screens on a timer. Tap the left or right edge to switch screens, long-press to pin one, and tap the middle for that screen's own action (board theme, radar place).
- One Cloudflare Worker serves both the display and its API. Agenda data comes from iCal links, Google Calendar/Tasks (read-only) or a JSON feed contract (`docs/feed-contract.md`). Aircraft come from community ADS-B feeds, and routes from adsbdb. Photos come through the Google Photos Picker and are copied to R2.
- It is viewed in rooms with changing light, at a distance, and left on overnight.

## Capabilities and Constraints

- Read-only access to calendars and tasks: the hub can never change them.
- The repository must stay free of personal data (names, locations, account links). Everything deployment-specific is a variable, secret or `/setup` setting, so others can deploy their own.
- Locations are rounded to about 1 km. The Flightradar24 "most tracked" source is unofficial, so it stays opt-in.
- Target device: iPad mini 5 in Safari, 1024×768 CSS px in landscape. The Workers free plan allows about 10 ms of CPU per request.
- Undecided: night mode behaviour, screen-order settings, airport boards, alerts.

## Brand Commitments

- Name: **Home&Sky Hub** (slug `homesky-hub`). License: MIT.
- Calendar and agenda elements follow the look of the maintainer's existing household board app, as implemented in `src/web/styles.css` (an explicit instruction from the maintainer).
- No references to the maintainer's family, or to the private household board by name, in anything published.

## Evidence on Hand

- No users, testimonials or screenshots yet. Don't invent any.
- A built-in demo agenda (`AGENDA_FEED_URL=demo`) with neutral names, for trying the project out.

## Product Principles

1. **Readable across a room.** Everything that matters can be read at a glance from a distance. Detail is for a closer look.
2. **Calm and ambient.** The display never competes for attention, and motion and emphasis carry meaning. It only raises its voice when something genuinely matters (an alert, something overdue).
3. **Set up by anyone.** Every integration comes with a guided path and plain-language errors. If a non-expert can't set it up, it isn't finished.
4. **One display, many screens.** New screens plug into the same rotation and should feel like the same product.
