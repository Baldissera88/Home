// Usage: node profile.mjs [scene ...] — per-frame cost of harness scenes (draw calls, triangles, CPU ms).
// Env: HARNESS (harness URL, default port 8770), W/H (viewport, default 540x960 portrait), FRAMES (default 20),
//      Q (quality, default high), OUT (write the results as JSON to this file).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const DEFAULT = ['01_village_day', '02_world_fight_day', '04_crypt_fight', '07_caves', '08_hell', '11_village_night', '14_world_rain', '06_skeleton_king'];
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const base = process.env.HARNESS || 'http://127.0.0.1:8770/tools/web3d/harness.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
for (const s of scenes) {
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 540), height: +(process.env.H || 960) } });
  page.on('pageerror', (e) => console.log(`[${s}] pageerror`, e.message));
  page.on('console', (m) => { const t = m.text(); if (/error|failed/i.test(t)) console.log(`[${s}]`, t.slice(0, 300)); });
  await page.goto(`${base}?scene=${s}&profile=${process.env.FRAMES || 20}&q=${process.env.Q || 'high'}`);
  await page.waitForFunction(() => window.done === true, null, { timeout: 300000 });
  const r = await page.evaluate(() => window.result || null);
  if (r) results.push(r); else console.log(`[${s}] no result`);
  await page.close();
}
await browser.close();
const cols = ['scene', 'calls', 'triangles', 'points', 'programs', 'geometries', 'textures', 'updateMs', 'renderMs', 'overlayMs'];
console.log(cols.join('\t'));
for (const r of results) console.log(cols.map((c) => r[c]).join('\t'));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
