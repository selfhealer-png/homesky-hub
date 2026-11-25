#!/usr/bin/env node
// Starts the ADS-B relay (adsb-relay.mjs). RELAY_TOKEN is required; PORT defaults to 8787.
import { startServer } from './adsb-relay.mjs';

startServer({ token: process.env.RELAY_TOKEN, port: Number(process.env.PORT ?? 8787) });
