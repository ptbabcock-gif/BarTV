// Browser test for shared groups: two "phones" (browser contexts) against the fake Supabase.
// `npm run e2e:groups`. Map tiles and geolocation are stubbed as in the smoke test.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createFakeSupabase } from './fake-supabase.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const PORT = 8124;
const BASE = `http://localhost:${PORT}/`;
const shots = process.env.SHOTS_DIR || null;
if (shots) mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const fake = createFakeSupabase({ base: 'https://fake.supabase.co' });
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const errors = [];
let browser;

async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', geolocation: { latitude: 51.5136, longitude: -0.133 }, permissions: ['geolocation'] });
  await ctx.addInitScript(() => { window.__CHEERS_CLOUD__ = { url: 'https://fake.supabase.co', anonKey: 'anon' }; });
  await ctx.route('https://fake.supabase.co/**', fake.route);
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, shot: async (n) => { if (shots) await page.screenshot({ path: `${shots}/${n}.png` }); } };
}

try {
  browser = await chromium.launch();
  const pat = await phone('pat');
  const sam = await phone('sam');

  // Pat has solo data, creates a group
  await pat.page.goto(BASE + '#/settings');
  await pat.page.click('#sample');
  await pat.page.waitForSelector('#list .card');
  await pat.page.goto(BASE + '#/settings');
  await pat.page.waitForSelector('#g-create');
  await pat.page.fill('#g-name', 'Pat');
  await pat.page.fill('#g-new', 'Soho crew');
  await pat.page.click('#g-create');
  await pat.page.waitForSelector('#g-share');
  const code = (await pat.page.textContent('.code')).trim();
  assert.match(code, /^[A-Z0-9]{6}$/);
  await pat.page.waitForFunction(() => document.querySelector('#sync-chip')?.dataset.status === 'synced');
  assert.equal(fake.db.venues.length, 5, 'sample venues shared with the group');
  assert.equal(fake.db.tastings.length, 6);
  await pat.shot('g1-group-created');

  // Sam joins via the invite link
  await sam.page.goto(BASE + `#/join/${code.toLowerCase()}`);
  await sam.page.waitForSelector('#j-go');
  await sam.page.fill('#j-name', 'Sam');
  await sam.page.click('#j-go');
  await sam.page.waitForSelector('#list .card');
  assert.equal(await sam.page.locator('#list .card').count(), 5, 'Sam sees the shared venues');
  await sam.page.waitForFunction(() => document.querySelector('#sync-chip')?.dataset.status === 'synced');

  // Sam rates Bar Termini; Pat sees it with Sam's name
  await sam.page.click('#list .card:first-child');
  await sam.page.waitForSelector('a:has-text("Rate another")');
  assert.match(await sam.page.textContent('.chip.who'), /Pat/, 'existing tastings carry the rater name');
  await sam.page.click('a:has-text("Rate another")');
  await sam.page.waitForSelector('#rate');
  await sam.page.click('.criterion[data-key="coffee"] button[data-n="2"]');
  await sam.page.fill('#f-notes', 'Not my night.');
  await sam.page.click('#save');
  await sam.page.waitForSelector('.score-badge.lg');
  await sam.page.waitForFunction(() => document.querySelector('#sync-chip')?.dataset.status === 'synced');
  assert.equal(fake.db.tastings.length, 7);

  await pat.page.goto(BASE + '#/venues');
  await pat.page.click('#list .card:has-text("Bar Termini")');
  await pat.page.waitForSelector('a:has-text("Rate another")');
  await pat.page.click('#sync-chip');
  await pat.page.waitForSelector('#g-sync');
  await pat.page.click('#g-sync');
  await pat.page.waitForFunction(() => /Everything is synced/.test(document.querySelector('#g-status')?.textContent || ''));
  assert.match(await pat.page.textContent('#group-card'), /Sam/, 'member list shows Sam');
  await pat.page.goto(BASE + '#/venues');
  await pat.page.click('#list .card:has-text("Bar Termini")');
  await pat.page.waitForSelector('.tasting');
  assert.equal(await pat.page.locator('.tasting').count(), 3);
  assert.match(await pat.page.textContent('#view'), /by 2 people/);
  assert.match(await pat.page.textContent('#view'), /Not my night/);
  await pat.shot('g2-shared-venue');

  // Pat cannot edit Sam's tasting
  await pat.page.click('.tasting:has-text("Sam")');
  await pat.page.waitForSelector('text=Only Sam can edit this tasting');
  assert.equal(await pat.page.locator('#save').count(), 0);
  await pat.shot('g3-readonly');

  // Stats shows who's been drinking
  await pat.page.goto(BASE + '#/stats');
  await pat.page.waitForSelector('.kpi');
  assert.match(await pat.page.textContent('#view'), /Who's been drinking/);

  // Sam leaves; local copy stays
  await sam.page.goto(BASE + '#/settings');
  await sam.page.click('#g-leave');
  await sam.page.waitForSelector('#g-create');
  await sam.page.goto(BASE + '#/venues');
  assert.equal(await sam.page.locator('#list .card').count(), 5);
  assert.equal(await sam.page.locator('#sync-chip:not([hidden])').count(), 0);

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log('e2e groups: all checks passed');
} finally {
  await browser?.close();
  server.kill();
}
