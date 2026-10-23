#!/usr/bin/env node
// Home&Sky Hub setup wizard, part 1: Cloudflare resources, secrets and first deploy.
// Usage: npm run setup [-- --dry-run]
// Safe to re-run: existing resources are detected and reused. See docs/SETUP-WIZARD.md.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const DRY = process.argv.includes('--dry-run');
const ANSWERS_FILE = '.homesky.json';
const rl = createInterface({ input: stdin, output: stdout });
// Reading through the iterator (rather than rl.question) also works when answers are piped in.
const lines = rl[Symbol.asyncIterator]();

const c = { bold: s => `\x1b[1m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m` };
const step = (n, title) => console.log(`\n${c.cyan(`── ${n}. ${title}`)}`);

async function ask(question, fallback = '') {
  stdout.write(`${question}${fallback ? c.dim(` [${fallback}]`) : ''}: `);
  const { value, done } = await lines.next();
  if (done) throw new Error('Input ended before setup finished.');
  if (!stdin.isTTY) stdout.write(`${value}
`);
  return value.trim() || fallback;
}
async function confirm(question, yes = true) {
  const a = (await ask(`${question} ${yes ? '(Y/n)' : '(y/N)'}`)).toLowerCase();
  return a ? a.startsWith('y') : yes;
}

/** Runs wrangler. Read-only calls always run; changes only run when not in dry-run mode. */
function wrangler(args, { mutates = false, input, inherit = false } = {}) {
  const line = `npx wrangler ${args.join(' ')}`;
  if (mutates && DRY) {
    console.log(c.dim(`   (dry run) ${line}`));
    return { ok: true, out: '' };
  }
  const r = spawnSync(command('npx', ['wrangler', ...args]), { encoding: 'utf8', input, shell: true, stdio: inherit ? 'inherit' : 'pipe' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function run(cmd, args) {
  if (DRY) { console.log(c.dim(`   (dry run) ${cmd} ${args.join(' ')}`)); return true; }
  return spawnSync(command(cmd, args), { stdio: 'inherit', shell: true }).status === 0;
}

// npx and npm are .cmd shims on Windows and need a shell. Every argument here comes from this
// script or a validated answer, and is quoted anyway in case a temp path contains spaces.
function command(cmd, args) {
  return [cmd, ...args.map(a => (/^[\w@./:=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`))].join(' ');
}

const token = () => randomBytes(24).toString('base64url');

async function main() {
  console.log(c.bold('\nHome&Sky Hub setup') + (DRY ? c.yellow('  (dry run: nothing on your account will change)') : ''));
  const saved = existsSync(ANSWERS_FILE) ? JSON.parse(readFileSync(ANSWERS_FILE, 'utf8')) : {};

  // 1. Cloudflare login
  step(1, 'Cloudflare login');
  let who = wrangler(['whoami']);
  if (!/logged in/i.test(who.out)) {
    console.log('You are not signed in to Cloudflare. Opening the browser to sign in…');
    wrangler(['login'], { inherit: true });
    who = wrangler(['whoami']);
    if (!/logged in/i.test(who.out)) throw new Error('Still not signed in to Cloudflare. Run `npx wrangler login` and try again.');
  }
  console.log(c.green('✔ Signed in to Cloudflare'));

  // 2. Name
  step(2, 'Name your hub');
  const name = (await ask('Worker name (lowercase letters, numbers and dashes)', saved.name ?? 'homesky-hub')).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error(`"${name}" is not a valid Worker name.`);

  // 3. Location
  step(3, 'Location (optional)');
  console.log(c.dim('   Leave it blank and each display uses its own location (it asks once), falling back to'));
  console.log(c.dim('   roughly where its internet connection is. You can also add places later in /setup.'));
  let place = saved.place ?? null;
  if (!place || !(await confirm(`Keep ${place.label}?`))) place = await pickPlace();
  console.log(place ? c.green(`✔ ${place.label} → ${place.lat}, ${place.lon} (${place.timezone})`) : c.green('✔ No fixed location: displays use their own'));

  // 4. Shopping list
  step(4, 'Cloudflare shopping list');
  const kvTitle = `${name}-kv`;
  const bucket = `${name}-photos`;
  const kvList = JSON.parse(wrangler(['kv', 'namespace', 'list']).out.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
  let kvId = kvList.find(n => n.title === kvTitle)?.id;
  const r2Out = wrangler(['r2', 'bucket', 'list']);
  const r2Enabled = r2Out.ok;
  const bucketExists = new RegExp(`name:\\s+${bucket}\\s`).test(r2Out.out + '\n');

  console.log(`   KV namespace  ${kvTitle.padEnd(28)} ${kvId ? c.green('✔ exists') : c.yellow('✚ will create')}`);
  console.log(`   R2 bucket     ${bucket.padEnd(28)} ${bucketExists ? c.green('✔ exists') : r2Enabled ? c.yellow('✚ will create (photo frame)') : c.dim('– R2 not enabled on this account')}`);
  console.log(`   Cron trigger  ${'every minute'.padEnd(28)} ${c.dim('– arrives with trending alerts')}`);
  console.log(`   Secrets       ${'DISPLAY_TOKEN, ADMIN_PASSWORD'.padEnd(28)} ${saved.secretsSet ? c.green('✔ set (kept)') : c.yellow('✚ will generate')}`);

  const wantPhotos = r2Enabled && (bucketExists || (await confirm('Create the R2 bucket for the photo frame? (free tier: 10 GB)')));
  if (!(await confirm('Go ahead with the list above?'))) return console.log('Stopped. Nothing was changed.');

  if (!kvId) {
    const r = wrangler(['kv', 'namespace', 'create', kvTitle], { mutates: true });
    if (!r.ok) throw new Error(`Could not create the KV namespace:\n${r.out}`);
    kvId = DRY ? '<new-kv-id>' : JSON.parse(wrangler(['kv', 'namespace', 'list']).out.match(/\[[\s\S]*\]/)[0]).find(n => n.title === kvTitle).id;
    console.log(c.green(`✔ KV namespace created`));
  }
  if (wantPhotos && !bucketExists) {
    const r = wrangler(['r2', 'bucket', 'create', bucket], { mutates: true });
    if (!r.ok) throw new Error(`Could not create the R2 bucket:\n${r.out}`);
    console.log(c.green(`✔ R2 bucket created`));
  }

  // Config is written before deploying, which reads it.
  step(5, 'Writing wrangler.toml');
  const toml = wranglerToml({ name, place, kvId, bucket: wantPhotos ? bucket : null });
  if (DRY) {
    console.log(c.dim(toml.replace(/^/gm, '   ')));
  } else {
    writeFileSync('wrangler.toml', toml);
    writeFileSync(ANSWERS_FILE, JSON.stringify({ ...saved, name, place }, null, 2));
    console.log(c.green('✔ wrangler.toml and .homesky.json written (both git-ignored)'));
  }

  // Secrets go up after the deploy, because they need the Worker to exist.
  step(6, 'Build and deploy');
  if (!run('npm', ['run', 'build'])) throw new Error('Build failed.');
  const deploy = wrangler(['deploy'], { mutates: true });
  if (!deploy.ok) throw new Error(`Deploy failed:\n${deploy.out}`);
  const url = DRY ? `https://${name}.<your-subdomain>.workers.dev` : deploy.out.match(/https:\/\/\S+\.workers\.dev/)?.[0] ?? `https://${name}.<your-subdomain>.workers.dev`;
  console.log(c.green(`✔ Deployed to ${url}`));

  step(7, 'Secrets');
  let displayToken = null, adminPassword = null;
  if (!saved.secretsSet || (await confirm('Secrets are already set. Generate new ones? (unpairs every display)', false))) {
    displayToken = token();
    adminPassword = token();
    const dir = mkdtempSync(join(tmpdir(), 'homesky-'));
    const file = join(dir, 'secrets.json');
    try {
      writeFileSync(file, JSON.stringify({ DISPLAY_TOKEN: displayToken, ADMIN_PASSWORD: adminPassword }));
      const r = wrangler(['secret', 'bulk', file], { mutates: true });
      if (!r.ok) throw new Error(`Could not upload secrets:\n${r.out}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!DRY) writeFileSync(ANSWERS_FILE, JSON.stringify({ ...saved, name, place, secretsSet: true }, null, 2));
    console.log(c.green('✔ Secrets uploaded'));
  }

  console.log(`\n${c.bold('Done.')} Next steps:\n`);
  if (displayToken) {
    console.log(`  1. On the tablet, open this pairing link once, then Share → Add to Home Screen:\n     ${c.cyan(`${url}/pair#${displayToken}`)}`);
    console.log(`  2. Finish setup (calendars, photos, airports) at ${c.cyan(`${url}/setup`)}\n     Admin password: ${c.bold(adminPassword)}`);
    console.log(c.yellow('\n  These are shown once. Save them in your password manager.'));
  } else {
    console.log(`  Finish setup at ${c.cyan(`${url}/setup`)} with your existing admin password.`);
  }
}

async function pickPlace() {
  for (;;) {
    const q = await ask('Town, city or postcode (blank to skip)');
    if (!q) return null;
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => null);
    const results = res?.results ?? [];
    if (!results.length) { console.log(c.red('No matches. Try a nearby town.')); continue; }
    results.forEach((r, i) => console.log(`   ${i + 1}. ${[r.name, r.admin2 ?? r.admin1, r.country].filter(Boolean).join(', ')}`));
    const n = Number(await ask('Which one', '1'));
    const r = results[n - 1];
    if (!r) continue;
    const round = v => Math.round(v * 100) / 100; // ~1 km: enough for a radar, not an address
    return { label: [r.name, r.country].join(', '), lat: round(r.latitude), lon: round(r.longitude), timezone: r.timezone };
  }
}

function wranglerToml({ name, place, kvId, bucket }) {
  return `# Generated by \`npm run setup\`. Safe to edit; re-running setup rewrites it.
name = "${name}"
main = "src/worker/index.ts"
compatibility_date = "2026-09-01"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*", "/pair", "/setup*"]

[vars]
${place ? `HOME_LAT = "${place.lat}"\nHOME_LON = "${place.lon}"\n` : ''}TIMEZONE = "${place?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}"
RADAR_RADIUS_NM = "25"

[[kv_namespaces]]
binding = "HUB_KV"
id = "${kvId}"
${bucket ? `
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "${bucket}"
` : ''}
`;
}

main()
  .catch(err => { console.error(c.red(`\n✖ ${err.message}`)); process.exitCode = 1; })
  .finally(() => rl.close());
