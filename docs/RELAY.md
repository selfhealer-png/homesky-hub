# A relay for the plane feeds (free, no home PC)

The community ADS-B feeds the radar uses (adsb.lol, adsb.fi, airplanes.live) rate-limit or block Cloudflare's shared addresses, and they don't let a web page call them directly. When that leaves the radar empty in the web version, a tiny relay on a free cloud server with an address of its own fetches the planes for your Worker. Everything else stays on Cloudflare; the iPad just runs the web version in Safari, with nothing to refresh every 7 days.

```
iPad (Safari) ──▶ your Cloudflare Worker ──▶ relay (Oracle free server) ──▶ adsb.lol / adsb.fi / airplanes.live
                         └──────────▶ weather, routes, photos… (directly, as before)
```

The relay (`relay/adsb-relay.mjs`) only fetches those three feed hosts, only answers with your token, keeps answers 5 seconds, and passes "slow down" replies back so the hub backs off. It has no dependencies.

**Tried on an Oracle free server in London (November 2026):** adsb.lol and adsb.fi answer through the relay every time; airplanes.live refuses it (403). adsb.lol allows an address about **500 requests a day**, and one display asks a few times a minute, so put adsb.fi (1 request a second, no daily cap) first and keep adsb.lol as the backup: set `AIRCRAFT_SOURCES = "adsb.fi,adsb.lol"` in `wrangler.toml`. The hub tries the feeds in the order listed.

**An honest caveat:** the relay's address is still a datacentre one. It is its own, not shared with thousands of other Workers, so it should get through where Cloudflare doesn't, but a feed could still choose to limit it. The setup script checks adsb.lol answers from the server before you change anything in the hub.

Time: about an hour, mostly clicking through Oracle's site.

## 1. Oracle Cloud account (once)

Useful pages (checked November 2026):

| What | Link |
|---|---|
| Sign up | https://signup.cloud.oracle.com/ |
| Sign in to the Console afterwards | https://cloud.oracle.com/ |
| What's free, and the idle rule | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm |
| Free tier overview, upgrading to paid | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm |
| Oracle's own "first Linux server" walkthrough, including SSH from Windows | https://docs.oracle.com/en-us/iaas/Content/GSG/Reference/overviewworkflow.htm |
| Security lists (the cloud firewall) | https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm |

1. Sign up at **https://signup.cloud.oracle.com/**. You need a mobile number and a card; Always Free resources aren't charged. Pick the home region nearest you (e.g. **UK South (London)**): it can't be changed later, and Always Free servers must live there.
2. **The idle rule.** Oracle may reclaim an Always Free server that's idle for 7 days: CPU under 20% (95th percentile) *and* network under 20% (and, on Ampere shapes, memory under 20%). A relay is light work, so it can look idle. Many people avoid this by upgrading to **Pay As You Go** (the **Upgrade** link in the banner at the top of the Console): Always Free resources stay free after upgrading. Oracle's page doesn't promise that upgrading exempts you from reclaiming, though, so if the radar ever goes quiet, check the server is still running in the Console. If you upgrade, set a small budget alert (search "Budgets" in the Console) so nothing can cost money unnoticed.

## 2. Create the server

1. Sign in at **https://cloud.oracle.com/**, open the ☰ menu → **Compute → Instances → Create instance.** Name it `homesky-relay`.
2. **Image:** Canonical **Ubuntu 24.04**. **Shape:** `VM.Standard.E2.1.Micro` (marked *Always Free-eligible*). If it says out of capacity, use `VM.Standard.A1.Flex` with 1 OCPU and 6 GB, also free.
3. **Networking:** keep the new or default virtual cloud network and public subnet, with **Assign a public IPv4 address** on. If that option is greyed out, the subnet chosen is private (or there's no network yet): in a new tab, ☰ → **Networking → Virtual cloud networks → Start VCN Wizard → Create VCN with Internet Connectivity**, accept the defaults, then back in Create instance pick that network and its **public subnet**, and the option unlocks.
4. **SSH keys:** *Generate a key pair for me* → **Save private key**. Keep the file (e.g. `Downloads\ssh-key-2026-11-25.key`).
5. Create. When it's running, copy its **Public IP address**.
6. **Open ports 80 and 443:** on the instance page → the subnet link → **Security Lists** → *Default Security List* → **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP protocol TCP, Destination port range `80,443` → Add. (Port 80 is only for getting the HTTPS certificate.)

## 3. Install the relay

From Windows, in PowerShell (use your key file and IP):

```powershell
ssh -i $HOME\Downloads\ssh-key-2026-11-25.key ubuntu@203.0.113.7
```

If ssh complains the key's permissions are too open, run this once and try again:

```powershell
icacls $HOME\Downloads\ssh-key-2026-11-25.key /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then, on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/selfhealer-png/homesky-hub/main/relay/install.sh -o install.sh && sudo bash install.sh
```

It installs Node.js and Caddy, starts the relay as a service, gets an HTTPS certificate for a free name made from your IP (`203-0-113-7.sslip.io`), opens the server's own firewall, checks adsb.lol answers, and prints:

```
  ADSB_RELAY_URL   = https://203-0-113-7.sslip.io
  ADSB_RELAY_TOKEN = 3f9c…
```

Open `https://203-0-113-7.sslip.io/health` in a browser: it should say `ok` (the certificate can take a minute the first time).

## 4. Point the hub at it

On your PC, in the hub folder:

1. In `wrangler.toml`, under `[vars]`, add the URL:
   ```toml
   ADSB_RELAY_URL = "https://203-0-113-7.sslip.io"
   ```
2. Store the token as a secret, and deploy:
   ```powershell
   npx wrangler secret put ADSB_RELAY_TOKEN
   ```
   ```powershell
   npm run deploy
   ```

Every request to the three feeds now goes through the relay: the radar, the overhead board, alerts and the flight tracker. Leave `ADSB_RELAY_URL` out (and deploy) to go back to fetching directly.

## 5. On the iPad

Open the hub's pairing link in Safari, then Share → **Add to Home Screen**, and open it from there for full screen. Guided Access and Auto-Lock → Never as in the README's iPad tips.

## Looking after it

* **See what it's doing:** `journalctl -u homesky-relay -f` on the server shows each request and the feed's answer (`200`, or `429` when a feed asks it to slow down).
* **Update the relay:** run the same `curl … install.sh && sudo bash install.sh` again. It keeps the token.
* **New token:** `sudo rm /etc/homesky-relay.env && sudo bash install.sh`, then `wrangler secret put ADSB_RELAY_TOKEN` with the new one.
* **The IP address** stays as long as the server exists (stopping and starting it keeps it). If you ever recreate the server, rerun the install and update `ADSB_RELAY_URL`.
* **Ubuntu security updates** install themselves (unattended-upgrades is on in Oracle's image).
