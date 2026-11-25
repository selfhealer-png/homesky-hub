#!/usr/bin/env bash
# Sets up the ADS-B relay on a fresh Ubuntu 24.04 server (Oracle Cloud's free tier, see docs/RELAY.md).
# Run as:  sudo bash install.sh
# Safe to run again: it keeps the token it made the first time.
set -euo pipefail

if [ "$(id -u)" != 0 ]; then echo "Run with sudo: sudo bash $0"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/selfhealer-png/homesky-hub/main/relay}"

echo "== Packages (Node.js, Caddy)"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs caddy iptables-persistent curl openssl >/dev/null
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node.js $NODE_MAJOR is too old (needs 18+). Use an Ubuntu 24.04 image."; exit 1; fi

echo "== Relay"
install -d /opt/homesky-relay
for f in adsb-relay.mjs server.mjs; do
  if [ -f "$HERE/$f" ]; then cp "$HERE/$f" /opt/homesky-relay/; else curl -fsSL "$REPO_RAW/$f" -o "/opt/homesky-relay/$f"; fi
done

if [ ! -f /etc/homesky-relay.env ]; then
  echo "RELAY_TOKEN=$(openssl rand -hex 24)" > /etc/homesky-relay.env
  chmod 600 /etc/homesky-relay.env
fi
# shellcheck disable=SC1091
. /etc/homesky-relay.env

cat > /etc/systemd/system/homesky-relay.service <<'UNIT'
[Unit]
Description=Home&Sky Hub ADS-B relay
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/homesky-relay.env
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/homesky-relay/server.mjs
Restart=always
RestartSec=5
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now homesky-relay >/dev/null
systemctl restart homesky-relay

echo "== Address and HTTPS"
IP="${RELAY_IP:-$(curl -fsS -4 https://api.ipify.org)}"
HOST="${RELAY_HOST:-${IP//./-}.sslip.io}"
cat > /etc/caddy/Caddyfile <<CADDY
# Home&Sky Hub ADS-B relay. Caddy gets and renews the HTTPS certificate by itself.
$HOST {
	reverse_proxy 127.0.0.1:8787
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "== Firewall (Oracle's Ubuntu images block everything but SSH)"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
done
netfilter-persistent save >/dev/null

echo "== Checking"
sleep 2
if curl -fsS -m 5 http://127.0.0.1:8787/health >/dev/null; then echo "Relay is running."; else echo "Relay did not start: journalctl -u homesky-relay"; fi
if curl -fsS -m 5 -H "Authorization: Bearer $RELAY_TOKEN" "http://127.0.0.1:8787/api.adsb.lol/v2/point/51.5/-0.1/5" >/dev/null; then echo "adsb.lol answers from this server."; else echo "adsb.lol did not answer from this server (try again in a minute)."; fi

cat <<DONE

Done. Put these two values into your hub (docs/RELAY.md, step 4):

  ADSB_RELAY_URL   = https://$HOST
  ADSB_RELAY_TOKEN = $RELAY_TOKEN

If https://$HOST/health doesn't open in a browser in a few minutes, check the Oracle
Security List allows ports 80 and 443 (docs/RELAY.md, step 2).
DONE
