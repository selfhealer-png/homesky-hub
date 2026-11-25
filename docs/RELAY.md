# A relay for the plane feeds (free, no home PC)

The community ADS-B feeds the radar uses (adsb.lol, adsb.fi, airplanes.live) rate-limit or block Cloudflare's shared addresses, and they don't let a web page call them directly. When that leaves the radar empty in the web version, a tiny relay on a free cloud server with an address of its own fetches the planes for your Worker. Everything else stays on Cloudflare; the iPad just runs the web version in Safari, with nothing to refresh every 7 days.

```
iPad (Safari) ──▶ your Cloudflare Worker ──▶ relay (Oracle free server) ──▶ adsb.lol / adsb.fi / airplanes.live
                         └──────────▶ weather, routes, photos… (directly, as before)
```

The relay (`relay/adsb-relay.mjs`) only fetches those three feed hosts, only answers with your token, keeps answers 5 seconds, and passes "slow down" replies back so the hub backs off. It has no dependencies.

**An honest caveat:** the relay's address is still a datacentre one. It is its own, not shared with thousands of other Workers, so it should get through where Cloudflare doesn't, but a feed could still choose to limit it. The setup script checks adsb.lol answers from the server before you change anything in the hub.

Time: about an hour, mostly clicking through Oracle's site.

## 1. Oracle Cloud account (once)

1. Sign up at **cloud.oracle.com** → Start for free. Pick the home region nearest you (e.g. **UK South (London)**): it can't be changed later, and Always Free servers live there. Oracle asks for a card to check who you are; Always Free resources aren't charged.
2. Recommended: upgrade the account to **Pay As You Go** (Billing → Upgrade). Always Free stays free, but Oracle stops reclaiming free servers it thinks are idle, which a relay can look like. Set a budget alert of £1 (Billing → Budgets) for peace of mind.

## 2. Create the server

1. **Compute → Instances → Create instance.** Name it `homesky-relay`.
2. **Image:** Canonical **Ubuntu 24.04**. **Shape:** `VM.Standard.E2.1.Micro` (marked *Always Free-eligible*). If it says out of capacity, use `VM.Standard.A1.Flex` with 1 OCPU and 6 GB, also free.
3. **Networking:** keep the new or default virtual cloud network and public subnet, with **Assign a public IPv4 address** on.
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
