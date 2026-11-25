#!/usr/bin/env node
// Starts the ADS-B relay (adsb-relay.mjs). RELAY_TOKEN is required; PORT defaults to 8787.
import dns from 'node:dns';
import net from 'node:net';
import { startServer } from './adsb-relay.mjs';

// Oracle's free servers have no IPv6, but some feeds (adsb.lol) publish IPv6 addresses too.
// Without this, Node sometimes tries an IPv6 address first and hangs until the timeout.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily?.(true);

startServer({ token: process.env.RELAY_TOKEN, port: Number(process.env.PORT ?? 8787) });
