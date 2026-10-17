// Usage: node shot.mjs <url> <out.png> [width height] — renders a page in headless Chromium (SwiftShader WebGL).
import { chromium } from 'playwright-core';
const [url, out, w = '720', h = '1280'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.done === true, null, { timeout: 120000 });
console.log('title:', await page.title());
await page.screenshot({ path: out });
await browser.close();
