// Renders icons/icon.svg to the PNG sizes the manifest and iOS expect. Requires Playwright (dev only).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const svg = readFileSync(resolve(root, 'icons/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-180.png', 180, false], ['icon-512-maskable.png', 512, true]]) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need a full-bleed background with the artwork inside the safe zone (80%).
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#1c120d' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  const buf = await page.screenshot({ omitBackground: !maskable, type: 'png' });
  writeFileSync(resolve(root, 'icons', name), buf);
  console.log('wrote icons/' + name);
}
await browser.close();
