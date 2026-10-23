// Usage: node probe.mjs scene "<js expression>" — loads a harness scene and prints the value of an expression
// evaluated in the page (window.engine is the Engine), for poking at a level while working on the renderer.
import { chromium } from 'playwright-core';
const [scene, expr] = process.argv.slice(2);
const base = process.env.HARNESS || 'http://127.0.0.1:8770/tools/web3d/harness.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { const t = m.text(); if (/WebGLProgram|error/i.test(t)) console.log(t.slice(0, +(process.env.CHARS || 3000))); });
await page.goto(`${base}?scene=${scene}`);
await page.waitForFunction(() => window.done === true, null, { timeout: 240000 });
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
