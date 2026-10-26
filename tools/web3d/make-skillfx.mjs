// Usage: node tools/web3d/make-skillfx.mjs — writes rpg/screens3d/5x_fx_*.json: copies of real dumps with
// synthetic skill cues ("sf": [skill, x, y, tx, ty, dx, dy, progress, value]) and zones ("zo": [x, y, r, kind,
// progress]) at mid progress, so the skill-tree effects (js/skillfx.js) can be screenshot with batch.mjs.
// Cue layouts follow the comment blocks above each cast branch in Game.kt.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../rpg/screens3d');
const load = (name) => JSON.parse(readFileSync(join(dir, name + '.json'), 'utf8'));

// Skill ordinals (Entities.kt) and zone kinds.
const S = {
  JUDGMENT: 16, LIGHT_LANCE: 17, BULWARK: 18, HEAVENS_FURY: 19, HARPOON: 20, REND: 21, SEISMIC_SLAM: 22, AVALANCHE: 23,
  BLADE_DANCE: 24, DEATH_TRAP: 25, MARK_FOR_DEATH: 26, DEATH_BLOSSOM: 27, FROZEN_ORB: 28, BLIZZARD: 29, TELEPORT: 30, BLACK_HOLE: 31,
};
const Z = { BLIZZARD: 2, BLACK_HOLE: 3, TRAP: 4, HOLY_LIGHT: 5, BLEED: 6, SANDSTORM: 7 };
const CLS = { knight: [0, 0], barbarian: [1, 1], assassin: [2, 3], sorceress: [3, 5] };

const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * A copy of `base` with the hero at (hx, hy) facing (fx, fy) as `cls`, the old fight's particles, texts and
 * marks cleared, enemies moved to `foes` ([type, x, y] or [x, y] keeping the type), and the given cues and zones.
 */
function scene(base, { hero, face = [0, -1], cls, foes = [], sf = [], zo = [], keepZones = false }) {
  const d = load(base);
  const f = d.frame;
  if (hero) { f.p[0] = hero[0]; f.p[1] = hero[1]; }
  f.p[2] = face[0]; f.p[3] = face[1];
  f.p[4] = 3; // casting
  if (cls) { f.p[7] = CLS[cls][0]; f.p[8] = CLS[cls][1]; }
  for (const k of ['pa', 'tx', 'wa', 'pr', 'bo', 'me', 'gh', 'dc']) f[k] = [];
  const hx = f.p[0], hy = f.p[1];
  // Keep only enemies that are not right on top of the hero, then move the first few where wanted.
  f.e = f.e.filter((e) => Math.hypot(e[2] - hx, e[3] - hy) > 3 || foes.length);
  foes.forEach((foe, i) => {
    const e = f.e[i];
    if (!e) return;
    const [type, x, y] = foe.length === 3 ? foe : [e[1], foe[0], foe[1]];
    e[1] = type; e[2] = x; e[3] = y;
    const [ux, uy] = unit(hx - x, hy - y);
    e[4] = r2(ux); e[5] = r2(uy);
  });
  f.sf = sf.map((c) => c.map(r2));
  f.zo = (keepZones ? f.zo : []).concat(zo.map((z) => z.map(r2)));
  return d;
}

const out = {};

// Knight in the crypt: the hammer falling, the lance firing and the bulwark up.
{
  const h = [31.5, 47.8];
  const jt = [29.2, 44.2], [jx, jy] = unit(jt[0] - h[0], jt[1] - h[1]);
  const [lx, ly] = unit(4, -4.2);
  out['50_fx_knight'] = scene('04_crypt_fight', {
    hero: h, face: [lx, ly], cls: 'knight',
    foes: [[2, 29.2, 44.2], [2, 34.6, 44.6], [0, 35.3, 43.6], [2, 28.4, 45.4]],
    sf: [
      [S.BULWARK, h[0], h[1], h[0], h[1], lx, ly, 0.3, 0.6],
      [S.JUDGMENT, h[0], h[1], jt[0], jt[1], jx, jy, 0.42, 2.3],
      [S.LIGHT_LANCE, h[0] + lx * 0.5, h[1] + ly * 0.5, h[0] + lx * 8, h[1] + ly * 8, lx, ly, 0.12, 0.55],
    ],
  });
}

// Knight outdoors: Heaven's Fury raining pillars, holy light where they struck, a Judgment landing.
{
  const h = [45, 66];
  out['55_fx_knight_fury'] = scene('02_world_fight_day', {
    hero: h, face: [0, -1], cls: 'knight',
    foes: [[42.5, 62.5], [47.6, 62.2], [41.6, 64.4], [44.2, 60.4]],
    sf: [
      [S.HEAVENS_FURY, h[0], h[1], h[0], h[1], 0, 0, 0.35, -6.5],
      [S.HEAVENS_FURY, 42.5, 62.5, 42.5, 62.5, 0, 0, 0.3, 1.3],
      [S.HEAVENS_FURY, 47.6, 62.2, 47.6, 62.2, 0, 0, 0.58, 1.3],
      [S.HEAVENS_FURY, 41.6, 64.4, 41.6, 64.4, 0, 0, 0.8, 1.3],
      [S.JUDGMENT, h[0], h[1], 44.2, 60.4, 0, -1, 0.6, 2.3],
    ],
    zo: [[47.6, 62.2, 1.1, Z.HOLY_LIGHT, 0.05], [41.6, 64.4, 1.1, Z.HOLY_LIGHT, 0.25]],
  });
}

// Barbarian outdoors: the spear in flight on its chain, a rend, a seismic slam, boulders and a bleed pool.
{
  const h = [45, 66];
  const [sx, sy] = unit(-2.2, -4.5);
  const [ex, ey] = unit(3.5, -4);
  out['51_fx_barbarian'] = scene('02_world_fight_day', {
    hero: h, face: [0, -1], cls: 'barbarian',
    foes: [[42.6, 61.4], [48.6, 61.6], [44.4, 64.4], [46.4, 64.6]],
    sf: [
      [S.HARPOON, h[0], h[1], h[0] + sx * 4.2, h[1] + sy * 4.2, sx, sy, 0.2, 0],
      [S.REND, h[0], h[1], h[0], h[1] - 1.3, 0, -1, 0.17, 2.3],
      [S.SEISMIC_SLAM, h[0], h[1], h[0] + ex * 4.6, h[1] + ey * 4.6, ex, ey, 0.38, 1.25],
      [S.AVALANCHE, h[0], h[1], 43.4, 59.6, 0, -1, 0.4, 1.25],
      [S.AVALANCHE, h[0], h[1], 46.8, 59.4, 0, -1, 0.62, 1.25],
    ],
    zo: [[44.6, 64.3, 1.6, Z.BLEED, 0.3]],
  });
}

// Assassin in the crypt: Death Blossom whirling, a Blade Dance hop, a marked skeleton and two traps.
{
  const h = [31.5, 47.8];
  const [bx, by] = unit(3.2, -3.4);
  out['52_fx_assassin'] = scene('04_crypt_fight', {
    hero: h, face: [0, -1], cls: 'assassin',
    foes: [[2, 29.0, 44.0], [2, 34.6, 44.0], [0, 33.0, 46.8], [2, 28.6, 46.2]],
    sf: [
      [S.DEATH_BLOSSOM, h[0], h[1], h[0], h[1], Math.cos(0.7), Math.sin(0.7), 0.4, 2.3],
      [S.BLADE_DANCE, h[0] - 0.4, h[1] - 0.6, h[0] - 0.4 + bx * 4.4, h[1] - 0.6 + by * 4.4, bx, by, 0.15, 1],
      [S.MARK_FOR_DEATH, 29.0, 44.0, h[0], h[1], 0, 0, 0.4, 0.42],
    ],
    zo: [[30.2, 45.9, 1.3, Z.TRAP, 0.4], [33.4, 45.2, 1.3, Z.TRAP, 0.02]],
  });
}

// Sorceress outdoors: Frozen Orb in flight, a Blizzard, a Teleport and the Black Hole pulling.
{
  const h = [45, 66];
  const [ox, oy] = unit(-1, -3);
  out['53_fx_sorceress'] = scene('02_world_fight_day', {
    hero: h, face: [ox, oy], cls: 'sorceress',
    foes: [[41.4, 59.6], [42.4, 60.3], [48.2, 60.6], [47.4, 59.8], [48.8, 59.4]],
    sf: [
      [S.FROZEN_ORB, h[0] + ox * 2.4, h[1] + oy * 2.4, h[0], h[1], ox, oy, 0.4, 0.45],
      [S.TELEPORT, h[0] + 2.6, h[1] + 1.4, h[0], h[1], -0.88, -0.47, 0.18, 1.6],
      [S.BLACK_HOLE, 48.2, 59.8, 48.2, 59.8, Math.cos(1.2), Math.sin(1.2), 0.45, 4.5],
    ],
    zo: [[41.8, 60.2, 2.7, Z.BLIZZARD, 0.4], [48.2, 59.8, 4.5, Z.BLACK_HOLE, 0.45]],
  });
}

// Sorceress in the crypt: orb, teleport and the black hole's implosion in the dark.
{
  const h = [31.5, 47.8];
  out['57_fx_sorceress_crypt'] = scene('04_crypt_fight', {
    hero: h, face: [0, -1], cls: 'sorceress',
    foes: [[2, 33.2, 43.6], [0, 34.4, 44.6], [2, 28.6, 44.4]],
    sf: [
      [S.FROZEN_ORB, 29.6, 45.2, h[0], h[1], -0.6, -0.8, 0.5, 0.45],
      [S.BLACK_HOLE, 33.6, 44.2, 33.6, 44.2, 0, 0, 0.3, -2.8],
      [S.TELEPORT, 28.8, 48.4, h[0], h[1], 0.97, -0.22, 0.12, 1.6],
    ],
    zo: [],
  });
}

// Mixed impacts in the crypt: Judgment landing, the spear reeling back, a boulder landing, a rend's blood.
{
  const h = [31.5, 47.8];
  out['56_fx_impacts'] = scene('04_crypt_fight', {
    hero: h, face: [0, -1], cls: 'barbarian',
    foes: [[2, 29.2, 44.2], [2, 34.2, 45.0]],
    sf: [
      [S.JUDGMENT, h[0], h[1], 29.4, 44.4, -0.5, -0.86, 0.58, 2.3],
      [S.HARPOON, h[0], h[1], 34.0, 45.2, 0.7, -0.7, 0.5, 2],
      [S.AVALANCHE, h[0], h[1], 33.6, 43.4, 0, -1, 0.55, 1.25],
      [S.BLADE_DANCE, 30.6, 46.8, 33.4, 46.2, 0.98, -0.2, 0.3, 2],
    ],
    zo: [[31.6, 45.8, 1.6, Z.BLEED, 0.4]],
  });
}

// Every new zone kind in the desert, around the Pharaoh's sandstorm.
{
  out['54_fx_zones'] = scene('23_sand_pharaoh', {
    hero: [44.5, 62.2], face: [0, -1], cls: 'knight', keepZones: true,
    zo: [
      [40.8, 59.4, 1.1, Z.HOLY_LIGHT, 0.2],
      [47.6, 59.6, 1.6, Z.BLEED, 0.35],
      [49.6, 55.2, 2.6, Z.BLIZZARD, 0.5],
      [41.4, 62.0, 1.3, Z.TRAP, 0.5],
      [47.4, 62.6, 1.3, Z.TRAP, 0.02],
    ],
  });
}

for (const [name, d] of Object.entries(out)) {
  writeFileSync(join(dir, name + '.json'), JSON.stringify(d));
  console.log('wrote', name);
}
