// End-to-end test of the web app against the mock database: two phones share one family.
//   node web/test/mock-rtdb.mjs & node web/test/e2e.cjs [outDir]
const { chromium } = require('playwright');
const assert = require('node:assert');
const fs = require('node:fs');

const WEB = 'http://localhost:8080/';
const DB = 'http://localhost:9000';
const out = process.argv[2] || 'web/test/screens';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const phone = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  const open = async (ctx, url = WEB) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await p.goto(url);
    return p;
  };
  const shot = async (p, name) => { await p.waitForTimeout(450); await p.screenshot({ path: `${out}/${name}.png` }); };
  const pin = async (p) => {
    await p.getByRole('button', { name: '🔒 Forældre' }).click();
    for (const d of '1234') await p.getByRole('button', { name: d, exact: true }).click();
    await p.getByRole('heading', { name: 'Forældre' }).waitFor();
  };

  // Phone A starts a family and shares it.
  const a = await open(await phone());
  await a.getByText('Har I familien på en anden telefon?').waitFor();
  await shot(a, '0-welcome');
  await a.getByRole('button', { name: 'Start en ny familie her' }).click();
  await a.getByText('Hvem er du?').waitFor();
  await pin(a);
  await a.getByRole('button', { name: 'Indstillinger' }).click();
  await a.getByRole('button', { name: 'Del online' }).click();
  await a.getByText('Forbundet – alt er delt').waitFor();
  const code = (await a.locator('.code').textContent()).trim();
  await shot(a, '7-parent-settings');
  console.log('family code', code);

  // Phone B opens the shared link and joins.
  const b = await open(await phone(), `${WEB}#familie=${code.replace(/-/g, '')}`);
  await b.getByRole('button', { name: 'Forbind' }).click();
  await b.getByText('Victor').waitFor();
  await b.waitForTimeout(500);
  await shot(b, '1-home');

  // B: Victor ticks a chore; A sees it waiting and approves; B's piggy bank fills.
  await b.getByRole('button', { name: /Victor/ }).click();
  await b.getByRole('button', { name: /Red sengen/ }).click();
  await b.getByText('Venter på godkendelse').waitFor();
  await a.getByRole('button', { name: 'Godkend (1)' }).click();
  await shot(a, '4-parent-approve');
  await a.getByRole('button', { name: '✓ Godkend', exact: true }).click();
  await b.getByText('✓ 2 kr i grisen').waitFor();
  await b.waitForTimeout(1300);
  await shot(b, '2-kid');

  // B goes offline, ticks another chore, and it reaches A once B is back online.
  await fetch(`${DB}/__down`);
  await b.getByRole('button', { name: /Dæk bord/ }).click();
  await b.waitForTimeout(500);
  await fetch(`${DB}/__up`);
  await a.getByRole('button', { name: 'Godkend (1)' }).waitFor({ timeout: 20000 });

  // A gives a bonus; both phones agree on the balance.
  await a.getByRole('button', { name: 'Børn' }).click();
  await a.getByRole('button', { name: '＋ Bonus' }).first().click();
  await a.locator('.sheet input').first().fill('12,50');
  await shot(a, '8-bonus');
  await a.getByRole('button', { name: 'Giv bonus' }).click();
  await b.getByText('14,50 kr').first().waitFor();
  await shot(a, '6-parent-kids');

  // Chore editor and PIN pad.
  await a.getByRole('button', { name: 'Pligter' }).click();
  await shot(a, '5-parent-chores');
  await a.getByRole('button', { name: /Dæk bord/ }).click();
  await shot(a, '9-chore-editor');
  await a.getByRole('button', { name: 'Annuller' }).click();
  await a.getByRole('button', { name: 'Luk ✕' }).click();
  await a.getByRole('button', { name: '🔒 Forældre' }).click();
  await shot(a, '3-pin');

  const tree = await (await fetch(`${DB}/__tree`)).json();
  const fam = tree.families[code.replace(/-/g, '')];
  const victor = Object.values(fam.txns).filter((t) => t.kid === 'victor').reduce((s, t) => s + t.amount, 0);
  assert.strictEqual(victor, 1450);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('e2e ok');
})().catch((e) => { console.error(e); process.exit(1); });
