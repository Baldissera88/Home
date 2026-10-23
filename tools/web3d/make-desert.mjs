// Synthetic desert dumps for the 3D harness, until CI writes real ones from the game:
//
//   node tools/web3d/make-desert.mjs
//
// Each takes an existing dump's level and frame (its hero, enemies and effects), lays a desert out around them
// and writes it to rpg/screens3d: 21_desert (02's daytime fight), 22_desert_oasis (07's caves fight by the oasis at
// golden hour) and 23_sand_pharaoh (06's boss, standing in for the Sand Pharaoh, at sunset in a sandstorm).
// The layout is what the contract describes for desert floors: big organic sand areas bounded by rock ridges
// (WALL), two ruined sandstone rooms with broken walls, an oasis pool ringed with grass and palms, boulders and
// the stairs down. "mat" uses the desert codes: 0 fine sand, 1 rippled dune sand, 2 rocky hardpan, 3 sandstone
// paving, 4 oasis grass, 7 water. Deterministic: the same script always writes the same files.
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../../rpg/screens3d/', import.meta.url).pathname;
const T = { WALL: 0, FLOOR: 1, STAIRS: 2, TREE: 3, ROCK: 4, WATER: 5 };
const PROP = { BARREL: 0, URN: 1, CHEST: 2, CAMPFIRE: 4, SKULLS: 5, PILLAR: 8, BRAZIER: 10, COLUMN: 11, SARCOPHAGUS: 12, BANNER: 15, BONEPILE: 20 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise over the plane from a seeded lattice, fbm of `oct` octaves, about [0, 1]. */
function noise2(seed, oct = 3) {
  const N = 256, lat = new Float32Array(N * N), r = rng(seed);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const at = (x, y) => lat[((y % N) + N) % N * N + (((x % N) + N) % N)];
  const one = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y) => {
    let s = 0, amp = 1, n = 0, f = 1;
    for (let o = 0; o < oct; o++, amp *= 0.5, f *= 2.03) { s += one(x * f + o * 17.3, y * f - o * 9.1) * amp; n += amp; }
    return s / n;
  };
}

/**
 * A desert floor around the given points of interest. spec: w, h, seed, hero [x, y], keep (more points that
 * must be open, [x, y, radius]), ruins ([cx, cy, w, h, door side 0..3]), oasis [cx, cy, radius], stairs [x, y].
 */
function layout(spec) {
  const { w, h, seed } = spec;
  const R = rng(seed);
  const field = noise2(seed + 1, 4), patch = noise2(seed + 2, 3), dune = noise2(seed + 3, 3), wob = noise2(seed + 4, 2);
  const tiles = new Uint8Array(w * h).fill(T.WALL);
  const mat = new Uint8Array(w * h);
  const fixed = new Uint8Array(w * h); // tiles the smoothing must not touch
  const idx = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  // Open where a low-frequency field is high, raised around the points of interest and the paths between them.
  const lift = new Float32Array(w * h);
  const disc = (cx, cy, r, k = 1) => {
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
      for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        if (!inside(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        lift[idx(x, y)] = Math.max(lift[idx(x, y)], k * (1 - Math.min(1, Math.max(0, (d - 0.6) / 0.6))));
      }
    }
  };
  const points = [[...spec.hero, 9], ...spec.keep];
  for (const [x, y, r] of points) disc(x, y, r);
  for (const [cx, cy, rw, rh] of spec.ruins) disc(cx, cy, Math.max(rw, rh) * 0.5 + 3);
  if (spec.oasis) disc(spec.oasis[0], spec.oasis[1], spec.oasis[2] + 5);
  disc(spec.stairs[0] + 0.5, spec.stairs[1] + 0.5, 4);
  // Winding paths between consecutive points, 2.5 to 4 tiles wide.
  const route = [...points.map(([x, y]) => [x, y]), ...spec.ruins.map(([x, y]) => [x, y]), ...(spec.oasis ? [[spec.oasis[0], spec.oasis[1]]] : []), [spec.stairs[0] + 0.5, spec.stairs[1] + 0.5]];
  route.sort((a, b) => Math.atan2(a[1] - h / 2, a[0] - w / 2) - Math.atan2(b[1] - h / 2, b[0] - w / 2));
  for (let i = 0; i < route.length; i++) {
    const [ax, ay] = route[i], [bx, by] = route[(i + 1) % route.length];
    const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
    for (let s = 0; s <= len; s += 0.5) {
      const t = s / len, bend = (wob(t * 3 + i * 7.1, i * 3.3) - 0.5) * 9 * Math.sin(t * Math.PI);
      disc(ax + (bx - ax) * t + nx * bend, ay + (by - ay) * t + ny * bend, 1.8 + 1.4 * wob(s * 0.2, i + 40), 0.95);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const v = field(x / 13, y / 13) + lift[idx(x, y)] * 0.9 - (edge < 4 ? (4 - edge) * 0.25 : 0);
      tiles[idx(x, y)] = edge >= 2 && v > 0.62 ? T.FLOOR : T.WALL;
    }
  }
  // Smooth into organic shapes: a cell turns to the majority of its neighbours.
  for (let pass = 0; pass < 3; pass++) {
    const copy = tiles.slice();
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && copy[idx(x + dx, y + dy)] === T.WALL) walls++;
        if (walls >= 5) tiles[idx(x, y)] = T.WALL;
        else if (walls <= 2) tiles[idx(x, y)] = T.FLOOR;
      }
    }
  }
  // Ruins: a floor of paving inside broken walls, freestanding in a ring of open sand.
  const torches = [];
  for (const [cx, cy, rw, rh, door] of spec.ruins) {
    const x0 = Math.round(cx - rw / 2), y0 = Math.round(cy - rh / 2), x1 = x0 + rw - 1, y1 = y0 + rh - 1;
    for (let y = y0 - 2; y <= y1 + 2; y++) {
      for (let x = x0 - 2; x <= x1 + 2; x++) {
        if (!inside(x, y)) continue;
        const i = idx(x, y);
        const wall = (x === x0 || x === x1 || y === y0 || y === y1) && x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const inner = x > x0 && x < x1 && y > y0 && y < y1;
        tiles[i] = wall ? T.WALL : T.FLOOR;
        mat[i] = wall || inner ? 3 : 0;
        fixed[i] = 1;
      }
    }
    // A doorway two tiles wide in the middle of one side, and gaps where the wall fell.
    const side = (k, f) => (k === 0 ? [x0 + f, y1] : k === 1 ? [x1, y0 + f] : k === 2 ? [x0 + f, y0] : [x0, y0 + f]);
    const span = (k) => (k % 2 === 0 ? rw : rh);
    for (const f of [Math.floor(span(door) / 2) - 1, Math.floor(span(door) / 2)]) {
      const [x, y] = side(door, f);
      tiles[idx(x, y)] = T.FLOOR;
    }
    for (let k = 0; k < 4; k++) {
      for (let f = 1; f < span(k) - 1; f++) {
        const [x, y] = side(k, f);
        if (tiles[idx(x, y)] === T.WALL && R() < 0.16) tiles[idx(x, y)] = T.FLOOR;
      }
    }
    // Torches on inner faces of the walls left standing.
    for (let k = 0; k < 4 && torches.length < spec.ruins.length * 3; k++) {
      const f = 1 + Math.floor(R() * (span(k) - 2));
      const [x, y] = side(k, f);
      if (tiles[idx(x, y)] === T.WALL && R() < 0.8) torches.push(idx(x, y));
    }
  }
  // The oasis: a pool with a wandering shore, grass around it and palms on the grass.
  if (spec.oasis) {
    const [ox, oy, r] = spec.oasis;
    for (let y = Math.floor(oy - r - 5); y <= oy + r + 5; y++) {
      for (let x = Math.floor(ox - r - 5); x <= ox + r + 5; x++) {
        if (!inside(x, y) || x < 3 || y < 3 || x > w - 4 || y > h - 4) continue;
        const i = idx(x, y);
        const a = Math.atan2(y + 0.5 - oy, x + 0.5 - ox), d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
        const rr = r * (0.85 + 0.35 * wob(Math.cos(a) * 1.3 + 5, Math.sin(a) * 1.3 + 5));
        fixed[i] = 1;
        if (d < rr) { tiles[i] = T.WATER; mat[i] = 7; } else if (d < rr + 2.6) {
          tiles[i] = d > rr + 0.7 && d < rr + 2.2 && R() < 0.2 ? T.TREE : T.FLOOR;
          mat[i] = 4;
        } else if (d < rr + 3.6) { tiles[i] = T.FLOOR; mat[i] = R() < 0.5 ? 4 : 0; }
      }
    }
  }
  // Keep only the floor the hero can reach; the rest becomes ridge.
  const seen = new Uint8Array(w * h), stack = [idx(Math.floor(spec.hero[0]), Math.floor(spec.hero[1]))];
  const walk = (t) => t === T.FLOOR || t === T.STAIRS;
  tiles[stack[0]] = T.FLOOR;
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = idx(x + dx, y + dy);
      if (inside(x + dx, y + dy) && !seen[j] && walk(tiles[j])) stack.push(j);
    }
  }
  for (let i = 0; i < w * h; i++) if (walk(tiles[i]) && !seen[i]) { tiles[i] = T.WALL; mat[i] = 2; }
  // Boulders here and there in the open, away from the action.
  for (let y = 3; y < h - 3; y++) {
    for (let x = 3; x < w - 3; x++) {
      const i = idx(x, y);
      if (tiles[i] !== T.FLOOR || fixed[i] || Math.hypot(x - spec.hero[0], y - spec.hero[1]) < 7) continue;
      if (R() < 0.008) tiles[i] = T.ROCK;
    }
  }
  // Ground materials of the open sand: hardpan in patches and along the ridges, rippled dune sand in drifts.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (fixed[i] && (mat[i] === 3 || mat[i] === 4 || mat[i] === 7)) continue;
      if (tiles[i] === T.WALL || tiles[i] === T.ROCK) { mat[i] = 2; continue; }
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && tiles[idx(x + dx, y + dy)] === T.WALL) walls++;
      const p = patch(x / 7, y / 7), d = dune(x / 9, y / 9);
      mat[i] = p > 0.64 || (walls > 2 && p > 0.45) ? 2 : d > 0.52 ? 1 : 0;
    }
  }
  // Old paving creeping out of the ruins' doorways, half buried.
  for (const [cx, cy, rw, rh] of spec.ruins) {
    for (let y = Math.floor(cy - rh / 2 - 3); y <= cy + rh / 2 + 3; y++) {
      for (let x = Math.floor(cx - rw / 2 - 3); x <= cx + rw / 2 + 3; x++) {
        if (!inside(x, y) || tiles[idx(x, y)] !== T.FLOOR || mat[idx(x, y)] === 3) continue;
        const d = Math.max(Math.abs(x + 0.5 - cx) - rw / 2, Math.abs(y + 0.5 - cy) - rh / 2);
        if (R() < 0.55 - d * 0.18) mat[idx(x, y)] = 3;
      }
    }
  }
  const [sx, sy] = spec.stairs;
  tiles[idx(sx, sy)] = T.STAIRS;
  if (mat[idx(sx, sy)] === 7) mat[idx(sx, sy)] = 0;
  return { tiles, mat, torches, seen };
}

/** The nearest walkable tile centre to (x, y), searching outwards. */
function nearestOpen(L, w, h, x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const ok = (tx, ty) => tx >= 1 && ty >= 1 && tx < w - 1 && ty < h - 1 && (L.tiles[ty * w + tx] === T.FLOOR);
  if (ok(fx, fy)) return [x, y];
  for (let r = 1; r < Math.max(w, h); r++) {
    let best = null, bd = Infinity;
    for (let ty = fy - r; ty <= fy + r; ty++) {
      for (let tx = fx - r; tx <= fx + r; tx++) {
        if (Math.max(Math.abs(tx - fx), Math.abs(ty - fy)) !== r || !ok(tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d < bd) { bd = d; best = [tx + 0.5 + (x - fx - 0.5) * 0.3, ty + 0.5 + (y - fy - 0.5) * 0.3]; }
      }
    }
    if (best) return best;
  }
  return [x, y];
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Props a desert floor would carry: pots, a chest, a sarcophagus and columns in the ruins, bones in the open. */
function props(spec, L, w, h) {
  const R = rng(spec.seed + 9);
  const out = [];
  const open = (x, y) => L.tiles[y * w + x] === T.FLOOR && !out.some((p) => Math.floor(p[1]) === x && Math.floor(p[2]) === y);
  const put = (type, x, y) => { if (open(x, y)) out.push([type, x + 0.5, y + 0.5, 0]); };
  for (const [cx, cy, rw, rh] of spec.ruins) {
    const x0 = Math.round(cx - rw / 2), y0 = Math.round(cy - rh / 2), x1 = x0 + rw - 1, y1 = y0 + rh - 1;
    put(PROP.COLUMN, x0 + 1, y0 + 1);
    put(PROP.COLUMN, x1 - 1, y0 + 1);
    put(PROP.SARCOPHAGUS, Math.round(cx), y0 + 1);
    put(PROP.URN, x0 + 1, y1 - 1);
    put(PROP.URN, x0 + 2, y1 - 1);
    put(PROP.CHEST, x1 - 1, y1 - 1);
    put(PROP.BRAZIER, x1 - 1, Math.round(cy));
  }
  if (spec.oasis) {
    const [ox, oy, r] = spec.oasis;
    put(PROP.CAMPFIRE, Math.floor(ox + r + 3), Math.floor(oy + 1));
    put(PROP.URN, Math.floor(ox - r - 3), Math.floor(oy));
    put(PROP.BARREL, Math.floor(ox - r - 3), Math.floor(oy + 1));
  }
  for (let k = 0; k < 400 && out.length < spec.ruins.length * 7 + 12; k++) {
    const x = 3 + Math.floor(R() * (w - 6)), y = 3 + Math.floor(R() * (h - 6));
    if (Math.hypot(x - spec.hero[0], y - spec.hero[1]) < 5) continue;
    put(R() < 0.5 ? PROP.SKULLS : PROP.BONEPILE, x, y);
  }
  return out;
}

function make(srcName, outName, spec) {
  const src = JSON.parse(readFileSync(DIR + srcName + '.json', 'utf8'));
  const { level, frame } = src;
  const w = spec.w = level.w, h = spec.h = level.h;
  // Move the scene so the hero stands at spec.hero; everything in the frame moves along.
  const [hx, hy] = spec.hero, ox = hx - frame.p[0], oy = hy - frame.p[1];
  spec.seed = spec.seed ?? 4242;
  const L = layout(spec);
  const lv = {
    k: 'level', biome: 'DESERT', floor: spec.floor, w, h, seed: spec.seed,
    tiles: Array.from(L.tiles, (t) => String.fromCharCode(48 + t)).join(''),
    mat: Array.from(L.mat, (m) => String.fromCharCode(48 + m)).join(''),
    var: level.var.length === w * h * 2 ? level.var : Array.from({ length: w * h }, (_, i) => ((i * 2654435761) >>> 24).toString(16).padStart(2, '0')).join(''),
    props: props(spec, L, w, h), bld: [], ent: [], torch: L.torches, exit: spec.stairs,
  };
  const f = JSON.parse(JSON.stringify(frame));
  f.p[0] = round3(hx);
  f.p[1] = round3(hy);
  const move = (row, ix, iy) => {
    const [x, y] = nearestOpen(L, w, h, row[ix] + ox, row[iy] + oy);
    row[ix] = round3(x);
    row[iy] = round3(y);
  };
  for (const e of f.e) move(e, 2, 3);
  for (const l of f.lo) move(l, 2, 3);
  for (const p of f.pr) { p[0] = round3(p[0] + ox); p[1] = round3(p[1] + oy); }
  for (let i = 0; i + 6 < f.pa.length; i += 7) { f.pa[i] = round3(f.pa[i] + ox); f.pa[i + 1] = round3(f.pa[i + 1] + oy); }
  for (const t of f.tx) { t[0] += ox; t[1] += oy; t[6] += ox; t[7] += oy; }
  for (const z of f.zo) { z[0] += ox; z[1] += oy; }
  f.n = []; // no villagers out here
  f.pu = '0'.repeat(lv.props.length);
  if (spec.frame) spec.frame(f);
  writeFileSync(DIR + outName + '.json', JSON.stringify({ level: lv, frame: f }));
  const open = L.tiles.reduce((n, t) => n + (t !== T.WALL), 0);
  console.log(`wrote ${outName}.json: ${w}x${h}, ${open} open tiles, ${lv.props.length} props, ${f.e.length} enemies`);
}

// 02's bandit fight at noon, in a wide sand basin: a ruin and the oasis ahead, ridges all around.
make('02_world_fight_day', '21_desert', {
  floor: 1, seed: 5150, hero: [55.05, 45.64],
  keep: [[52, 58, 6], [70, 64, 6], [24, 70, 6], [68, 16, 6], [36, 24, 6]],
  ruins: [[53, 30, 10, 7, 0], [24, 50, 8, 7, 1]], oasis: [38, 40, 3.4], stairs: [20, 18],
});

// 07's cave fight by the oasis in the late afternoon, the sun low and warm.
make('07_caves', '22_desert_oasis', {
  floor: 2, seed: 777, hero: [31.5, 38.5],
  keep: [[14, 44, 5], [44, 46, 5], [46, 14, 5]],
  ruins: [[16, 16, 8, 6, 0], [44, 30, 7, 7, 3]], oasis: [29, 27, 3.6], stairs: [10, 46],
  frame: (f) => { f.t = 72; f.dl = 0.65; f.fg = 0.06; },
});

// 06's boss as the Sand Pharaoh at sunset: a temple ruin behind it and the sandstorm it raises.
make('06_skeleton_king', '23_sand_pharaoh', {
  floor: 3, seed: 9001, hero: [29.3, 36.7],
  keep: [[29, 28, 8], [14, 44, 5], [45, 44, 5]],
  ruins: [[29, 17, 11, 7, 0], [46, 30, 7, 6, 3]], oasis: null, stairs: [12, 46],
  frame: (f) => {
    f.t = 104; f.dl = 0.38; f.fg = 0.08;
    const boss = f.e.find((e) => e[9] & 32);
    if (boss) {
      boss[12] = 'The Sand Pharaoh';
      boss[10] = 1.3;
      f.zo.push([boss[2], boss[3], 4.5, 7, 0.4]);
    }
  },
});
