# Setting up Home&Sky Hub

This guide takes you from nothing to a tablet on your wall or desk showing your calendar, your photos, the weather and the planes overhead. No programming is needed: you'll copy a few commands and click through some web pages.

**Time:** about 30–45 minutes, most of it the optional Google part.
**Cost:** nothing. Everything runs on free tiers (see [Costs](#costs)).

---

## What you need

- **A tablet** with a modern browser. This was designed on an iPad mini (5th generation), but any recent iPad or Android tablet works.
- **A computer** (Windows, Mac or Linux) for the one-off setup. After that it can be switched off: the hub runs in the cloud, not on your computer.
- **A Cloudflare account** (free). You'll create one in step 3 if you don't have one.
- **A Google account**, only if you want Google Calendar, Google Tasks or the photo frame. Calendars from iCloud or Outlook work without Google.

## 1. Install Node.js

Node.js runs the setup wizard.

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version for your computer.
2. Install it, accepting the defaults.
3. Open a terminal: on Windows, **PowerShell** from the Start menu; on a Mac, **Terminal** from Applications › Utilities.
4. Check it worked:

   ```bash
   node -v
   ```

   You should see a version number such as `v22.11.0`. Anything from 20 upwards is fine.

## 2. Get Home&Sky Hub

Either download it from GitHub with **Code › Download ZIP** and unzip it, or, if you use git:

```bash
git clone https://github.com/<owner>/homesky-hub.git
```

Then, in the terminal, go into the folder and install what it needs:

```bash
cd homesky-hub
npm install
```

## 3. Run the setup wizard

```bash
npm run setup
```

The wizard asks a few questions and does the Cloudflare work for you. Here is what to expect at each step.

| Wizard step | What happens and what to do |
|---|---|
| **1. Cloudflare login** | A browser window opens. Sign in to Cloudflare, or create a free account, then click **Allow**. Come back to the terminal. |
| **2. Name your hub** | Press Enter to keep `homesky-hub`, or type your own name. It becomes part of the web address. |
| **3. Location** | Type your town or postcode and pick the right match. This centres the radar and the weather. It's rounded to about 1 km, so your exact address is never stored. |
| **4. Shopping list** | Shows what will be created in your Cloudflare account: a small settings store, and optionally a photo store. Say **yes** to the photo store if you want the photo frame. |
| **5–6. Deploy** | Builds the hub and puts it online. This takes about a minute. |
| **7. Secrets** | Creates two random passwords and prints them **once**. |

At the end you'll see something like:

```
1. On the tablet, open this pairing link once, then Share → Add to Home Screen:
   https://homesky-hub.yourname.workers.dev/pair#…
2. Finish setup (calendars, photos, airports) at https://homesky-hub.yourname.workers.dev/setup
   Admin password: …
```

**Save both in your password manager now.** The pairing link lets a tablet show your hub. The admin password signs you in to the setup page.

> **If the photo store step is skipped:** Cloudflare asks you to turn on R2 (its photo storage) once in the dashboard before it can be used, and it may ask for a payment method even though the free allowance is 10 GB. Go to the Cloudflare dashboard → **R2 Object Storage**, enable it, then run `npm run setup` again. It reuses everything already created.

To see every step without changing anything first, run `npm run setup -- --dry-run`.

## 4. Set up the tablet

On the iPad:

1. **Open the pairing link** in Safari. The hub appears.
2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**. From now on, open the hub from its Home Screen icon. It runs full screen, with no browser bars.
3. **Keep the screen on:** Settings › Display & Brightness › **Auto-Lock** › **Never**.
4. **Stop it being closed by accident** (recommended for a shared room): Settings › Accessibility › **Guided Access** › turn it on and set a passcode. Then open the hub and **triple-click the Home button** to lock it to the hub. Triple-click again and enter the passcode to leave.
5. Keep it plugged in.

**Using the display:**

- Tap the **left or right edge** to go to the previous or next screen. It also moves on by itself.
- **Long-press** to stay on the current screen. Long-press again to carry on.
- **Tap the middle** for the screen's own option: the board's theme, or the radar's place.

## 5. Finish in the setup page

On your phone or computer, open `https://<your hub>/setup` and sign in with the admin password. Every section has its own step-by-step guide on the page; this is an overview.

### Calendars and tasks

Everything is read-only: the hub can show your calendars but never change them. There are three ways in, and you can mix them:

- **Calendar link (simplest).** Most calendar apps give you a private iCal link. The setup page has exact steps for **Google Calendar** ("Secret address in iCal format"), **iCloud** ("Public Calendar"), **Outlook** ("Publish a calendar") and others. Paste the link, press **Test link** to check it, pick a colour, then **Add**.
- **Google account.** Shows your Google calendars *and* Google Tasks, and is needed for the photo frame. It takes about ten minutes, once (see [Google](#google) below).
- **Agenda feed.** For your own system: any web address that returns events in the hub's [feed format](feed-contract.md).

### Google

Google requires you to create your own free "OAuth client". It's the key that lets *your* hub, and no one else's, read *your* account. The setup page walks you through it with the exact address to paste. In short:

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project with any name.
2. In **APIs & Services → Library**, enable **Google Calendar API**, **Google Tasks API** and **Photos Picker API**.
3. In **Google Auth Platform** (the OAuth consent screen), choose **External**, and add your name and email. Under **Audience**, add your own Google address as a test user.
4. Still under **Audience**, press **Publish app** so it's "In production". **Don't skip this:** otherwise Google disconnects the hub after 7 days. When you connect, Google will warn that the app is unverified. That's expected for an app only you use, so continue.
5. Under **Clients → Create client**, choose **Web application**, and paste the redirect address the setup page shows you.
6. Copy the **Client ID** and **Client secret** into the setup page, press **Save client**, then **Connect Google**.
7. Tick which calendars and task lists to show, and give them colours.

### Photos

Needs the Google connection and the photo store.

1. Type a collection name (for example "Summer 2026"), then press **Pick photos**.
2. Google Photos opens. Choose photos, or open an album and select everything in it, then press **Done**.
3. Back on the setup page, the hub copies them across. A progress bar shows how far it's got.

**Labels:** Google never shares *where* a photo was taken, so the frame shows the date taken plus a label you choose. Type a place under a collection and press **Label all**, or tap a single photo to label just that one.

**Style** (in **Display**): **Full screen** fills the screen and drifts slowly. **Framed prints** shows each photo mounted in a frame with its label underneath. Portrait photos are always shown in pairs.

To add more photos later, pick again. Photos stay in Google Photos; the hub only keeps its own screen-sized copy.

### Sky

- **Centre on:** add places by searching a town, or with **Use where I am now** on your phone. Or choose **Each display's own location**, so the tablet uses its own location (it asks permission once).
- **Range:** 25 nm suits most places. Near a big airport, 10–15 nm keeps the radar calm.

### Display

- **Clock:** word clock, digital, analogue or split-flap.
- **Motion:** **Full**, **Gentle** (changes fade, nothing flips or drifts) or **Still** (no animation at all). Choose Gentle if the flipping letters are distracting.
- **Clothing advice:** "I run cold" or "I run warm" shifts the weather screen's *What to wear* by about 3°C.

Changes reach the tablet within about five minutes, without touching it.

## Updating later

When a new version comes out, from the project folder:

```bash
git pull
npm install
npm run deploy
```

If you downloaded the ZIP instead, download the new one, copy your `wrangler.toml` and `.homesky.json` into it, then run `npm install` and `npm run deploy`. Your settings, calendars and photos are kept, because they live in your Cloudflare account, not in the code.

## Troubleshooting

| What you see | What to do |
|---|---|
| **"This display is not paired yet"** | Open the pairing link on the tablet again. If you've lost it, run `npm run setup` and say **yes** to new secrets. That unpairs every tablet, so pair each one again. |
| **"Cannot reach the hub"** | The tablet is offline, or the address changed. Check Wi-Fi, then reopen the hub from its Home Screen icon. |
| **Forgot the admin password** | Run `npm run setup` and generate new secrets. Saved calendar links and Google details are encrypted with the old password, so you'll need to enter them again in the setup page. |
| **Google stops working after a week** | The app was still in "Testing". In Google Cloud → Google Auth Platform → Audience, press **Publish app**, then **Connect Google** again. |
| **A calendar link fails its test** | The link may have been reset in your calendar app. Copy a fresh one and use **Edit → Replace link**. |
| **"Google refused photo access"** | Enable **Photos Picker API** in your Google Cloud project, then press **Reconnect Google** on the setup page. |
| **No aircraft on the radar** | The community flight-tracking services are occasionally down. The hub tries three in turn, and it usually recovers within minutes. In remote areas there may simply be nothing nearby: try a larger range. |
| **Letters flipping are distracting** | Setup page → Display → Motion → **Gentle** or **Still**. |
| **The screen goes dark** | Auto-Lock is still on: Settings › Display & Brightness › Auto-Lock › Never. |

## Costs

Everything fits comfortably inside free allowances for one household:

- **Cloudflare Workers:** 100,000 requests a day free. A tablet showing the hub all day uses a fraction of that.
- **Cloudflare KV** (settings): well within the free tier.
- **Cloudflare R2** (photos): 10 GB free, about 20,000 photos at screen size.
- **Weather (Open-Meteo), flight data (community ADS-B feeds) and routes (adsbdb)** are free and need no keys. Please don't point many tablets at one hub at very short intervals.

## Privacy

- Your calendars, photos and settings stay in **your** Cloudflare and Google accounts. There's no Home&Sky Hub server in between.
- Calendar access is read-only. The photo frame only ever sees photos you pick.
- Calendar links, tokens and Google credentials are stored encrypted.
- Locations are rounded to about 1 km.
