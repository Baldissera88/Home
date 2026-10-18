// Generates Sticky Paws rooms 16-100 into ../src/main/assets/web/levels.js.
// Every room is checked by solver.mjs: the toy is reachable, both stars fit within the arm length,
// buttons are really needed where a room has them, and the room is not a straight line.
// Deterministic: re-running gives the same rooms. Usage: node generate.mjs
import fs from 'fs';
import { solve, W, H, O } from './solver.mjs';

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const WORLDS = [
  { from: 1, name: 'Living Room' }, { from: 21, name: 'Kitchen' }, { from: 41, name: 'Bedroom' },
  { from: 61, name: 'Garage' }, { from: 81, name: 'Attic' },
];
const NAMES = {
  'Living Room': ['Sofa Sneak', 'Cushion Fort', 'Remote Control', 'Rug Run', 'Lamp Light'],
  'Kitchen': ['Cookie Jar', 'Fridge Raid', 'Pan Alley', 'Spoon Sprint', 'Toaster Pop', 'Sink Slide', 'Cupboard Creep', 'Pancake Stack', 'Fruit Bowl', 'Midnight Snack',
    'Jelly Wobble', 'Kettle Corner', 'Pizza Night', 'Crumb Trail', 'Oven Mitt', 'Lunch Box', 'Sticky Syrup', 'Pepper Panic', 'Noodle Knot', 'Big Kitchen Heist'],
  'Bedroom': ['Pillow Pile', 'Teddy Town', 'Sock Drawer', 'Bunk Bed', 'Night Light', 'Blanket Maze', 'Slipper Slide', 'Dream Catcher', 'Toy Chest', 'Bedtime Story',
    'Pajama Party', 'Wardrobe', 'Star Stickers', 'Under the Bed', 'Alarm Clock', 'Moon Beams', 'Lullaby Lane', 'Snore Patrol', 'Sleepwalk', 'Big Bedroom Heist'],
  'Garage': ['Toolbox', 'Bike Rack', 'Paint Cans', 'Oil Spill', 'Workbench', 'Lawn Mower', 'Spare Tyre', 'Ladder Climb', 'Bolt Bin', 'Car Wash',
    'Garden Hose', 'Rusty Gate', 'Fuse Box', 'Robot Repair', 'Sawdust', 'Box Tower', 'Flashlight', 'Spanner Spin', 'Engine Room', 'Big Garage Heist'],
  'Attic': ['Dusty Trunk', 'Cobweb Corner', 'Old Photos', 'Rocking Horse', 'Creaky Floor', 'Hat Box', 'Grandpa\'s Radio', 'Skylight', 'Mothball Maze', 'Treasure Map',
    'Antique Clock', 'Secret Door', 'Rafters', 'Ghost Sheet', 'Music Box', 'Lost Marbles', 'Puppet Show', 'Time Capsule', 'Top of the House', 'The Last Heist'],
};
const TOYS = ['popit', 'duck', 'spinner', 'cube', 'slime'];
const HINTS = {
  21: 'Welcome to the Kitchen!', 41: 'Welcome to the Bedroom!', 61: 'Welcome to the Garage! Green buttons now too', 81: 'The Attic. Only master thieves get this far!',
};

const worldOf = n => WORLDS.filter(w => n >= w.from).pop();
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];
const near = (x, y, X, Y, d) => Math.hypot(x - X, y - Y) < d;
const STARTZONE = (x, y, d = 70) => near(x, y, O.x, O.y, d) || (x < 120 && y > 540);

function build(n, r) {
  const d = (n - 16) / 84; // 0 → 1 difficulty
  const world = worldOf(n).name;
  const colors = n >= 61 ? ['a', 'b', 'c'] : n >= 41 ? ['a', 'b'] : ['a'];
  const lv = { walls: [], lasers: [], buttons: [], dogs: [], bots: [], coins: [] };
  const tx = ri(r, 50, 310), ty = ri(r, 70, 200 + Math.round(60 * (1 - d)));
  lv.target = [tx, ty, TOYS[n % TOYS.length]];
  const clearOfTarget = (x, y, dd = 60) => !near(x, y, tx, ty, dd);
  const usedColors = [];
  const mechanics = [];
  const pool = ['shelves', 'dogs', 'lasers'];
  if (n >= 21) pool.push('bots', 'buttonLasers');
  if (n >= 41) pool.push('buttonLasers', 'gatedBots', 'maze');
  if (n >= 61) pool.push('gatedBots', 'vLasers');
  const k = 1 + (r() < 0.35 + d * 0.5 ? 1 : 0) + (n > 45 && r() < d * 0.8 ? 1 : 0);
  while (mechanics.length < k) { const m = pick(r, pool); if (!mechanics.includes(m)) mechanics.push(m); }
  // Every tenth room is a breather: one mechanic, generous arm.
  const breather = n % 10 === 3;
  if (breather) mechanics.length = 1;
  const band = [ty + 50, 520];
  const nextColor = () => { const c = colors.find(c => !usedColors.includes(c)); if (c) usedColors.push(c); return c; };
  const addButton = (c, yLo, yHi) => {
    for (let t = 0; t < 30; t++) {
      const x = ri(r, 30, 330), y = ri(r, Math.max(60, yLo), Math.min(600, yHi));
      if (STARTZONE(x, y, 60) || !clearOfTarget(x, y, 70)) continue;
      if (lv.buttons.some(b => near(x, y, b[0], b[1], 60))) continue;
      lv.buttons.push([x, y, c]); return true;
    }
    return false;
  };
  for (const m of mechanics) {
    if (m === 'shelves') {
      const cnt = Math.min(4, 1 + Math.floor(r() * (1.5 + d * 3)));
      const ys = []; const span = band[1] - band[0];
      for (let i = 0; i < cnt; i++) ys.push(Math.round(band[0] + span * (i + 0.5) / cnt + ri(r, -15, 15)));
      let left = r() < 0.5;
      for (const y of ys) {
        const gap = ri(r, Math.round(110 - 40 * d), Math.round(140 - 40 * d));
        lv.walls.push(left ? [0, y, W - gap, 24] : [gap, y, W - gap, 24]);
        left = !left;
      }
    } else if (m === 'maze') {
      const cnt = ri(r, 3, 4 + Math.round(3 * d));
      for (let i = 0; i < cnt; i++) {
        const horiz = r() < 0.6, len = ri(r, 90, 200);
        const x = ri(r, 0, W - (horiz ? len : 24)), y = ri(r, band[0] - 20, 560 - (horiz ? 24 : len));
        const w = horiz ? [x, y, len, 24] : [x, y, 24, len];
        if (STARTZONE(w[0] + w[2] / 2, w[1] + w[3] / 2, 90) || !clearOfTarget(w[0] + w[2] / 2, w[1] + w[3] / 2, 80)) continue;
        lv.walls.push(w);
      }
    } else if (m === 'dogs') {
      const cnt = ri(r, 1, 2 + Math.round(3 * d));
      for (let i = 0, t = 0; i < cnt && t < 60; t++) {
        const rad = ri(r, 30, 48 - Math.round(10 * d)), x = ri(r, rad, W - rad), y = ri(r, ty + 40, 520);
        if (STARTZONE(x, y, rad + 70) || !clearOfTarget(x, y, rad + 45)) continue;
        if (lv.dogs.some(o => near(x, y, o[0], o[1], o[2] + rad + 22))) continue;
        lv.dogs.push([x, y, rad]); i++;
      }
    } else if (m === 'lasers') {
      const cnt = ri(r, 1, 1 + Math.round(2 * d));
      for (let i = 0; i < cnt; i++) {
        const y = ri(r, band[0], 500), gap = ri(r, Math.round(90 - 30 * d), Math.round(120 - 30 * d));
        lv.lasers.push(r() < 0.5 ? [0, y, W - gap, y] : [gap, y, W, y]);
      }
    } else if (m === 'vLasers') {
      const x = ri(r, 140, 300);
      const c = nextColor();
      lv.lasers.push([x, 0, x, H, c || undefined].filter(v => v !== undefined));
      if (c) addButton(c, 300, 600);
    } else if (m === 'buttonLasers') {
      const cnt = Math.min(colors.length - usedColors.length, ri(r, 1, 1 + Math.round(d * 1.5)));
      const ys = [];
      for (let i = 0; i < cnt; i++) ys.push(ri(r, band[0], 470));
      ys.sort((a, b) => b - a); // lowest first; each button sits below its laser
      let prev = 600;
      for (const y of ys) {
        const c = nextColor(); if (!c) break;
        lv.lasers.push([0, y, W, y, c]);
        // The button sits between this laser and the one below it, or anywhere above if that is open.
        if (r() < 0.25 + d * 0.4 && prev !== 600) addButton(c, y - 200, y - 30); else addButton(c, y + 30, prev - 30);
        prev = y;
      }
    } else if (m === 'bots' || m === 'gatedBots') {
      const cnt = ri(r, 1, 1 + Math.round(1.5 * d));
      for (let i = 0; i < cnt; i++) {
        const y = ri(r, band[0], 470), rad = ri(r, 18, 22), speed = ri(r, 80, 100 + Math.round(60 * d));
        const horiz = r() < 0.75;
        const b = horiz ? [30, y, 330, y, rad, speed] : (() => { const x = ri(r, 150, 320); return [x, ty + 60, x, 600, rad, speed]; })();
        if (horiz && r() < 0.5) { b[0] = ri(r, 30, 120); b[2] = ri(r, 240, 330); }
        if (m === 'gatedBots') { const c = nextColor(); if (c) { b.push(c); addButton(c, y + 40, 600); } }
        lv.bots.push(b);
      }
    }
  }
  return { lv, breather, d, world };
}

// Layout rules so rooms look tidy: nothing sits inside a shelf, robot tracks stay clear of shelves and
// of each other, and the window in the top-right corner stays uncovered.
const WINDOW = [248, 18, 96, 112];
function rectDist(x, y, w) { const cx = Math.max(w[0], Math.min(x, w[0] + w[2])), cy = Math.max(w[1], Math.min(y, w[1] + w[3])); return Math.hypot(x - cx, y - cy); }
function segPts(s, n = 24) { return [...Array(n + 1)].map((_, k) => [s[0] + (s[2] - s[0]) * k / n, s[1] + (s[3] - s[1]) * k / n]); }
function segRectDist(s, w) { return Math.min(...segPts(s).map(([x, y]) => rectDist(x, y, w))); }
function segSegDist(a, b) { return Math.min(...segPts(a).flatMap(([x, y]) => segPts(b).map(([u, v]) => Math.hypot(x - u, y - v)))); }
function rectsOverlap(a, b, pad) { return a[0] < b[0] + b[2] + pad && b[0] < a[0] + a[2] + pad && a[1] < b[1] + b[3] + pad && b[1] < a[1] + a[3] + pad; }
function freeSpot(lv, x, y, pad = 26) {
  if (rectDist(x, y, WINDOW) < 16) return false;
  if (lv.walls.some(w => rectDist(x, y, w) < pad)) return false;
  if (lv.dogs.some(d => Math.hypot(x - d[0], y - d[1]) < d[2] + pad)) return false;
  if (lv.bots.some(b => segPts(b).some(([u, v]) => Math.hypot(x - u, y - v) < b[4] + pad))) return false;
  if (lv.lasers.some(l => segPts(l, 60).some(([u, v]) => Math.hypot(x - u, y - v) < pad))) return false;
  return true;
}
function tidy(lv) {
  const W2 = lv.walls;
  for (let i = 0; i < W2.length; i++) for (let j = i + 1; j < W2.length; j++) if (rectsOverlap(W2[i], W2[j], 30)) return false;
  for (const b of lv.bots) {
    if (W2.some(w => segRectDist(b, w) < b[4] + 10)) return false;
    if (rectDist(b[0], b[1], WINDOW) < b[4] + 6 || rectDist(b[2], b[3], WINDOW) < b[4] + 6) return false;
  }
  for (let i = 0; i < lv.bots.length; i++) for (let j = i + 1; j < lv.bots.length; j++) if (segSegDist(lv.bots[i], lv.bots[j]) < lv.bots[i][4] + lv.bots[j][4] + 14) return false;
  for (const d of lv.dogs) if (W2.some(w => rectDist(d[0], d[1], w) < d[2] + 12) || lv.bots.some(b => segPts(b).some(([u, v]) => Math.hypot(d[0] - u, d[1] - v) < d[2] + b[4] + 10))) return false;
  for (const l of lv.lasers) if (!l[4] && W2.some(w => segRectDist(l, w) < 14)) return false;
  for (let i = 0; i < lv.lasers.length; i++) for (let j = i + 1; j < lv.lasers.length; j++) { const a = lv.lasers[i], b = lv.lasers[j]; if (a[1] === a[3] && b[1] === b[3] && Math.abs(a[1] - b[1]) < 40) return false; }
  for (const b of lv.buttons) { const rest = { ...lv, lasers: lv.lasers.filter(l => l[4] !== b[2]), bots: lv.bots.filter(o => o[6] !== b[2]) }; if (!freeSpot(rest, b[0], b[1], 28)) return false; }
  const t = lv.target; if (rectDist(t[0], t[1], WINDOW) < 30 || W2.some(w => rectDist(t[0], t[1], w) < 34)) return false;
  return true;
}

function placeCoins(lv, r, base) {
  for (let t = 0; t < 80; t++) {
    const coins = [];
    for (let c = 0; c < 2; c++) {
      for (let u = 0; u < 40; u++) {
        const x = ri(r, 24, 336), y = ri(r, 40, 560);
        if (STARTZONE(x, y, 80) || near(x, y, lv.target[0], lv.target[1], 60)) continue;
        if (coins.some(o => near(x, y, o[0], o[1], 80)) || lv.buttons.some(b => near(x, y, b[0], b[1], 40))) continue;
        if (!freeSpot(lv, x, y, 22)) continue;
        coins.push([x, y]); break;
      }
    }
    if (coins.length < 2) continue;
    const s = solve({ ...lv, coins });
    if (s.l3 < Infinity && s.l3 >= base + 50 && s.l3 <= base * 1.7 + 60) return { coins, l3: s.l3 };
  }
  return null;
}

const out = [];
for (let n = 16; n <= 100; n++) {
  let made = null;
  for (let attempt = 0; attempt < 3000 && !made; attempt++) {
    const r = rng(n * 7919 + attempt * 104729);
    const { lv, breather, d, world } = build(n, r);
    if (!tidy(lv)) continue;
    const s = solve({ ...lv, coins: [] });
    if (s.l1 === Infinity || s.l1 > 1500) continue;
    const straight = Math.hypot(lv.target[0] - O.x, lv.target[1] - O.y);
    if (!breather && s.l1 < straight * (1.12 + 0.25 * d)) continue; // the room must make you think
    if (lv.buttons.length) {
      if (lv.buttons.length !== new Set([...lv.lasers, ...lv.bots].map(x => x.find(v => typeof v === 'string')).filter(Boolean)).size) continue;
      if (solve({ ...lv, coins: [] }, { noButtons: true }).l1 < Infinity) continue; // buttons must matter
    }
    const c = placeCoins(lv, r, s.l1);
    if (!c) continue;
    lv.coins = c.coins;
    const slack = breather ? 1.7 : 1.55 - 0.33 * d;
    lv.max = Math.round((c.l3 * slack + 60) / 10) * 10;
    const names = NAMES[world], first = WORLDS.find(w => w.name === world).from;
    lv.name = names[(n - Math.max(16, first)) % names.length];
    if (HINTS[n]) lv.hint = HINTS[n];
    made = { lv, l1: s.l1, l3: c.l3, attempt };
  }
  if (!made) throw new Error('could not make room ' + n);
  const { lv } = made;
  out.push(lv);
  console.log(String(n).padStart(3), lv.name.padEnd(18), 'max', lv.max, 'l1', Math.round(made.l1), 'l3', Math.round(made.l3),
    `w${lv.walls.length} l${lv.lasers.length} b${lv.buttons.length} d${lv.dogs.length} r${lv.bots.length}`, 'try', made.attempt);
}
const js = '// Generated by stickypaws/tools/generate.mjs — rooms 16-100, each checked solvable with 3 stars.\n' +
  'window.MORE_LEVELS=[\n' + out.map(l => JSON.stringify(l)).join(',\n') + '\n];\n' +
  'window.WORLDS=' + JSON.stringify(WORLDS) + ';\n';
fs.writeFileSync(new URL('../src/main/assets/web/levels.js', import.meta.url), js);
