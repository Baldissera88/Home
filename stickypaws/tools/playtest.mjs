// Plays every room in the real game page (headless Chromium) along the solver's 3-star route.
// Usage: node playtest.mjs  (needs the playwright package)
import { chromium } from 'playwright';
import { solve } from './solver.mjs';
const page = new URL('../src/main/assets/web/index.html', import.meta.url).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 393, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(page); await p.waitForTimeout(300);
const levels = await p.evaluate(() => LEVELS);
let bad = 0;
for (let i = 0; i < levels.length; i++) {
  const { path } = solve(levels[i], { path: true });
  const r = await p.evaluate(([i, path]) => {
    startLevel(i);
    for (const [x, y] of path) {
      G.finger = { x, y };
      for (let k = 0; k < 20 && G.state === 'play'; k++) {
        update(1 / 60);
        const t = G.path[G.path.length - 1]; if (Math.hypot(t.x - x, t.y - y) < 4) break;
      }
      if (G.state !== 'play') break;
    }
    G.finger = null;
    for (let k = 0; k < 600 && (G.state === 'grab' || G.state === 'fail'); k++) update(1 / 60);
    return { state: G.state, stars: 1 + G.coins.filter(Boolean).length, msg: G.msg, len: Math.round(G.len) };
  }, [i, path]);
  const ok = r.state === 'won' && r.stars === 3;
  if (!ok) bad++;
  console.log(String(i + 1).padStart(3), levels[i].name.padEnd(18), ok ? 'OK 3★' : 'FAIL ' + JSON.stringify(r));
}
console.log(bad ? bad + ' rooms failed' : 'all rooms won with 3 stars', errs.length ? errs : '');
await b.close();
