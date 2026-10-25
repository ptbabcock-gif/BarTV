// Browser smoke test. Not part of `npm test` (needs Playwright + Chromium): `npm run e2e`.
// Map tiles, place search and geolocation are stubbed so the run is deterministic and offline.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const PORT = 8123;
const BASE = `http://localhost:${PORT}/`;
const shots = process.env.SHOTS_DIR || null;
if (shots) mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

// 1x1 transparent PNG used as a stand-in map tile.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const errors = [];
let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    geolocation: { latitude: 51.5136, longitude: -0.1330 }, permissions: ['geolocation'], colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await ctx.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { lat: '51.5101', lon: '-0.1340', name: 'Swift', display_name: 'Swift, Old Compton Street, Soho, London', address: { city: 'London' } },
  ]) }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); };
  const tileOk = async () => { const r = await page.goto(BASE); assert.equal(r.status(), 200); };

  // Empty state
  await tileOk();
  await page.waitForSelector('.empty');
  assert.match(await page.textContent('.empty'), /No espresso martinis yet/);
  await shot('01-empty');

  // Load sample data
  await page.click('a[href="#/settings"]');
  await page.click('#sample');
  await page.waitForSelector('.card.is-link');
  assert.equal(await page.locator('#list .card').count(), 5);
  const first = await page.textContent('#list .card:first-child strong');
  assert.equal(first, 'Bar Termini');
  await shot('02-venues');

  // Search + sort
  await page.fill('#q', 'sydney');
  assert.equal(await page.locator('#list .card').count(), 1);
  await page.fill('#q', '');
  await page.selectOption('#sort', 'price');
  assert.equal(await page.textContent('#list .card:first-child strong'), 'The Soho Grind');

  // Venue detail
  await page.click('#list .card:first-child');
  await page.waitForSelector('.score-badge.lg');
  assert.match(await page.textContent('#page-title'), /Soho Grind/);
  assert.ok(await page.locator('a:has-text("Directions")').count());
  await shot('03-venue');

  // Map
  await page.click('.tabbar a[data-tab="map"]');
  await page.waitForSelector('.cmap-pin');
  assert.equal(await page.locator('.cmap-pin').count(), 5, 'all five sample venues have pins');
  assert.ok((await page.locator('.cmap-tile').count()) > 0, 'tiles requested');
  await page.click('#locate');
  await page.waitForSelector('.cmap-user');
  await page.waitForSelector('#near .card');
  const nearFirst = await page.textContent('#near .card:first-child strong');
  assert.equal(nearFirst, 'Bar Termini', 'nearest venue to Soho is Bar Termini');
  assert.match(await page.textContent('#near .card:first-child'), /\d+ m|\d km/);
  await page.locator('.cmap-pin').first().click();
  await page.waitForSelector('#sheet:not([hidden]) .card');
  await shot('04-map');
  await page.click('#sheet-close');
  // zoom controls work
  const z0 = await page.evaluate(() => document.querySelectorAll('.cmap-tile').length);
  await page.click('.cmap-btn[data-act="in"]');
  assert.ok(await page.evaluate(() => document.querySelectorAll('.cmap-tile').length) > 0 && z0 > 0);

  // Discover nearby bars from OpenStreetMap (stubbed)
  await ctx.route('https://overpass-api.de/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 51.5134, lon: -0.1316, tags: { amenity: 'bar', name: 'Bar Termini', 'addr:city': 'London' } },
    { type: 'node', id: 2, lat: 51.5140, lon: -0.1335, tags: { amenity: 'bar', name: 'Swift', 'addr:housenumber': '12', 'addr:street': 'Old Compton Street', 'addr:city': 'London', opening_hours: 'Mo-Su 15:00-01:00' } },
    { type: 'way', id: 3, center: { lat: 51.5125, lon: -0.1350 }, tags: { amenity: 'pub', name: 'The French House' } },
  ] }) }));
  await page.click('#discover');
  await page.waitForSelector('.place');
  assert.equal(await page.locator('.place').count(), 3);
  assert.match(await page.textContent('#discover-msg'), /3 places .* 2 not rated yet/);
  assert.equal(await page.locator('.cmap-pin.is-place').count(), 2, 'unrated places get hollow pins');
  assert.equal(await page.locator('.place:has-text("Bar Termini") a.score-badge').count(), 1, 'rated place shows its score');
  await shot('04b-discover');
  await page.locator('.cmap-pin.is-place').first().click();
  await page.waitForSelector('#sheet:not([hidden]) a:has-text("Rate here")');
  await page.click('#sheet-close');
  await page.click('.place:has-text("Swift") a:has-text("Rate")');
  await page.waitForSelector('#rate');
  assert.equal(await page.inputValue('#f-name'), 'Swift');
  assert.equal(await page.inputValue('#f-city'), 'London');
  assert.match(await page.textContent('#loc'), /12 Old Compton Street/);
  await page.click('.criterion[data-key="foam"] button[data-n="4"]');
  await page.click('#save');
  await page.waitForSelector('.score-badge.lg');
  assert.equal(await page.locator('a:has-text("Directions")').count(), 1, 'discovered place is saved with coordinates');
  page.once('dialog', (d) => d.accept());
  await page.click('a:has-text("Edit")');
  await page.waitForSelector('#delete');
  await page.click('#delete');
  await page.waitForSelector('#list .card');

  // Rate a new venue end to end
  await page.click('.tabbar a[data-tab="rate"]');
  await page.waitForSelector('#rate');
  await page.fill('#f-name', 'Swift');
  await page.fill('#f-city', 'London');
  assert.match(await page.textContent('#venue-hint'), /New venue/);
  await page.click('#loc [data-act="search"]');
  await page.click('#geo-go');
  await page.waitForSelector('#geo-out button');
  await page.click('#geo-out button');
  assert.match(await page.textContent('#loc'), /Swift, Old Compton Street/);
  await page.fill('#f-price', '13.5');
  const picks = { coffee: 5, balance: 4, foam: 5, presentation: 4, temperature: 5 };
  for (const [k, n] of Object.entries(picks)) await page.click(`.criterion[data-key="${k}"] button[data-n="${n}"]`);
  assert.match(await page.textContent('#live'), /5\/5 criteria/);
  const liveScore = await page.textContent('#live .score-badge');
  assert.equal(liveScore, '9.0'); // weighted mean 4.6 -> ((4.6-1)/4)*10 = 9.0
  await page.click('[data-cat="liqueur"] button[data-pick="Mr Black"]');
  assert.equal(await page.inputValue('input[data-ing="liqueur"]'), 'Mr Black');
  await page.fill('input[data-ing="vodka"]', 'Belvedere');
  await page.fill('#extra-in', 'Oat milk');
  await page.press('#extra-in', 'Enter');
  await page.fill('#extra-in', 'oat milk'); // duplicate, ignored
  await page.click('#extra-add');
  assert.equal(await page.locator('#extras .chip').count(), 1);
  await page.click('#again button[data-v="true"]');
  await page.fill('#f-notes', 'Silky. Proper espresso.');
  await shot('05-rate');
  await page.click('#save');
  await page.waitForSelector('.score-badge.lg');
  assert.match(await page.textContent('#page-title'), /Swift/);
  assert.equal(await page.textContent('.score-badge.lg'), '9.0');
  assert.match(await page.textContent('#view'), /Oat milk/);
  assert.equal(await page.locator('a:has-text("Directions")').count(), 1, 'geocoded venue gets a directions link');

  // Rate again at the same venue via the "known venue" path, using device location
  await page.click('a:has-text("Rate another")');
  await page.waitForSelector('#rate');
  assert.match(await page.textContent('#venue-hint'), /Known venue · 1 previous/);
  await page.click('.criterion[data-key="coffee"] button[data-n="3"]');
  await page.click('#save');
  await page.waitForSelector('.score-badge.lg');
  assert.equal(await page.locator('.tasting').count(), 2);

  // Venues ranking now includes Swift
  await page.click('.tabbar a[data-tab="venues"]');
  await page.waitForSelector('#list .card');
  await page.selectOption('#sort', 'score');
  assert.equal(await page.locator('#list .card').count(), 6);

  // History and stats
  await page.click('.tabbar a[data-tab="history"]');
  await page.waitForSelector('.tasting');
  assert.equal(await page.locator('.tasting').count(), 8);
  await shot('06-history');
  await page.click('.tabbar a[data-tab="stats"]');
  await page.waitForSelector('.kpi');
  const kpis = await page.locator('.kpi .v').allTextContents();
  assert.equal(kpis[0], '8'); assert.equal(kpis[1], '6');
  assert.match(await page.textContent('#view'), /Ingredient insights/);
  assert.match(await page.textContent('#view'), /Mr Black/);
  await shot('07-stats');

  // Edit a tasting, then delete it
  await page.click('.tabbar a[data-tab="history"]');
  await page.click('.tasting:first-child');
  await page.waitForSelector('#delete');
  assert.equal(await page.inputValue('#f-name'), 'Swift');
  await page.click('.criterion[data-key="coffee"] button[data-n="5"]');
  await page.click('#save');
  await page.waitForSelector('.score-badge.lg');
  await page.click('.tasting:first-child');
  page.once('dialog', (d) => d.accept());
  await page.click('#delete');
  await page.waitForSelector('.score-badge.lg');
  assert.equal(await page.locator('.tasting').count(), 1);

  // Venue photos: add two, open the viewer, remove one
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEIGGEMAD3wBf1W5vd9AAAAAElFTkSuQmCC', 'base64');
  await page.setInputFiles('#venue-photos', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);
  await page.waitForSelector('.gallery-item');
  assert.equal(await page.locator('.gallery-item').count(), 2);
  await page.click('.gallery-item:first-child');
  await page.waitForSelector('.lightbox img');
  page.once('dialog', (d) => d.accept());
  await page.click('.lightbox [data-act="remove"]');
  await page.waitForSelector('.lightbox', { state: 'detached' });
  assert.equal(await page.locator('.gallery-item').count(), 1);
  await page.reload();
  await page.waitForSelector('.gallery-item');
  assert.equal(await page.locator('.gallery-item').count(), 1, 'venue photo persists');
  await shot('09-photos');

  // Edit venue + persistence across reload
  await page.click('a:has-text("Edit")');
  await page.fill('#f-name', 'Swift Soho');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.score-badge.lg');
  await page.reload();
  await page.waitForSelector('.score-badge.lg');
  assert.match(await page.textContent('#page-title'), /Swift Soho/);

  // Export produces valid JSON with the right counts
  await page.click('a[href="#/settings"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const data = JSON.parse(text);
  assert.equal(data.venues.length, 6); assert.equal(data.tastings.length, 7);

  // Light theme renders
  await page.selectOption('#theme', 'light');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.click('.tabbar a[data-tab="venues"]');
  await page.waitForSelector('#list .card');
  await shot('08-light');

  // Tile outage: the map explains itself instead of showing a blank box
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await offline.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  const p2 = await offline.newPage();
  await p2.goto(BASE + '#/settings');
  await p2.click('#sample');
  await p2.goto(BASE + '#/map');
  await p2.waitForSelector('.cmap-notice:not([hidden])');
  assert.match(await p2.textContent('.cmap-notice'), /could not load/);
  assert.equal(await p2.locator('.cmap-pin').count(), 5, 'pins still render without tiles');
  await offline.close();

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log('e2e smoke: all checks passed');
} finally {
  await browser?.close();
  server.kill();
}
