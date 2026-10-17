// Usage: node batch.mjs <outDir> <w> <h> scene[?params] ... — screenshots several harness scenes with one browser.
import { chromium } from 'playwright-core';
const [outDir, w, h, ...scenes] = process.argv.slice(2);
const base = process.env.HARNESS || 'http://127.0.0.1:8770/tools/web3d/harness.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const s of scenes) {
  const [name, extra] = s.split('?');
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('console', (m) => { if (!m.text().startsWith('THREE.WebGLProgram')) console.log(`[${name}]`, m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`${base}?scene=${name}${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.done === true, null, { timeout: 240000 });
  const file = `${outDir}/${name}${extra ? '_' + extra.replace(/[^a-z0-9]+/gi, '_') : ''}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
  await page.close();
}
await browser.close();
