// Usage: node interp-test.mjs — runs interp-test.html in headless Chromium, prints its report and exits 1
// when a check fails. Env: PAGE (test page URL, default port 8770), OUT (write the results as JSON).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const url = process.env.PAGE || 'http://127.0.0.1:8770/tools/web3d/interp-test.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--enable-precise-memory-info'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.done === true, null, { timeout: 120000 });
const result = await page.evaluate(() => window.result || null);
await browser.close();
if (process.env.OUT && result) writeFileSync(process.env.OUT, JSON.stringify(result, null, 1));
process.exit(result && result.ok ? 0 : 1);
