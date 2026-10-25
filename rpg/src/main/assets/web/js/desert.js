import * as THREE from 'three';
import { TILE, hash } from './defs.js';
import { makeSkyNoise } from './sky.js';

/**
 * The Scorched Sands: what the desert floors need beyond the open world's sky and light. A distance field
 * over the rock ridges (the level's WALL tiles) shapes everything else: the sand piled against the ridges
 * and the dunes (ground relief), the eroded sandstone cliffs and their flat tops (cliffs.js), and where
 * scenery may stand. The ground's sand, hardpan, paving and grass are baked once on the GPU into a texture
 * array like the overworld's terrain strips, with heights in alpha for the splat blend and the bump.
 */

/** Field samples per tile, and how many tiles of ridge run on past the map edge. */
export const FIELD_RES = 4;
export const PAD = 6;
/** Splat layers of the desert ground, in the order of the level's "mat" codes 0..4 (7 is water). */
export const SAND_LAYERS = 5;

/** Smooth seeded value noise of the plane, about [0, 1]: a lattice cell per unit. */
export function valueNoise(seed) {
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
  };
}

/** Squared Euclidean distance transform of a 1D row (Felzenszwalb and Huttenlocher), in place over f. */
function edt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
  for (let q = 0; q < n; q++) f[q] = d[q];
}

/** Distance (in cells) from every cell to the nearest cell where mask is set. */
function distanceTo(mask, nx, ny) {
  const INF = 1e12, g = new Float64Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = mask[i] ? 0 : INF;
  const n = Math.max(nx, ny), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) f[x] = g[y * nx + x];
    edt1(f, nx, d, v, z);
    for (let x = 0; x < nx; x++) g[y * nx + x] = f[x];
  }
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = g[y * nx + x];
    edt1(f, ny, d, v, z);
    for (let y = 0; y < ny; y++) g[y * nx + x] = Math.sqrt(f[y]);
  }
  return g;
}

/** Box blur of radius r, in place, along both axes. */
function blur(a, nx, ny, r) {
  const tmp = new Float32Array(Math.max(nx, ny));
  const pass = (count, len, at) => {
    for (let l = 0; l < count; l++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[at(l, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        tmp[i] = sum / (2 * r + 1);
        sum += a[at(l, Math.min(len - 1, i + r + 1))] - a[at(l, Math.max(0, i - r))];
      }
      for (let i = 0; i < len; i++) a[at(l, i)] = tmp[i];
    }
  };
  pass(ny, nx, (y, x) => y * nx + x);
  pass(nx, ny, (x, y) => y * nx + x);
}

/**
 * The shape of a desert floor. S(x, z) is the signed distance in tiles into the ridges (negative over open
 * ground), smoothed so corners round off; ruin walls (thin walls beside paving) are built, not rock, and
 * count as open here. From it: the rock's top height, the sand piled up against it and where dunes bury it.
 */
export class DesertField {
  constructor(level) {
    this.level = level;
    const w = this.w = level.w, h = this.h = level.h;
    this.seed = level.seed | 0;
    this.built = this.findRuins();
    const nx = this.nx = (w + 2 * PAD) * FIELD_RES, ny = this.ny = (h + 2 * PAD) * FIELD_RES;
    const rock = new Uint8Array(nx * ny), open = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const tz = Math.floor(-PAD + (j + 0.5) / FIELD_RES);
      for (let i = 0; i < nx; i++) {
        const tx = Math.floor(-PAD + (i + 0.5) / FIELD_RES);
        const r = this.isRock(tx, tz);
        rock[j * nx + i] = r;
        open[j * nx + i] = r ? 0 : 1;
      }
    }
    const toOpen = distanceTo(open, nx, ny), toRock = distanceTo(rock, nx, ny);
    const s = this.s = new Float32Array(nx * ny);
    for (let k = 0; k < s.length; k++) s[k] = (rock[k] ? toOpen[k] - 0.5 : 0.5 - toRock[k]) / FIELD_RES;
    blur(s, nx, ny, 2);
    blur(s, nx, ny, 1);
    // How thick the rock is around each point (the field's largest value within a tile and a half): lone
    // outcrops stay low, broad ridges rise high.
    const r = Math.round(1.5 * FIELD_RES), m = this.thick = new Float32Array(s), tmp = new Float32Array(Math.max(nx, ny));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let v = -1e9;
        for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r); k++) v = Math.max(v, s[j * nx + k]);
        tmp[i] = v;
      }
      for (let i = 0; i < nx; i++) m[j * nx + i] = tmp[i];
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        let v = -1e9;
        for (let k = Math.max(0, j - r); k <= Math.min(ny - 1, j + r); k++) v = Math.max(v, m[k * nx + i]);
        tmp[j] = v;
      }
      for (let j = 0; j < ny; j++) m[j * nx + i] = tmp[j];
    }
    this.n1 = valueNoise(this.seed + 11);
    this.n2 = valueNoise(this.seed + 12);
    this.n3 = valueNoise(this.seed + 13);
    this.relief = (x, z) => this.sand(x, z);
  }

  tile(x, y) {
    const lv = this.level;
    if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return TILE.WALL;
    return lv.tiles.charCodeAt(y * lv.w + x) - 48;
  }

  mat(x, y) {
    const lv = this.level;
    if (!lv.mat || x < 0 || y < 0 || x >= lv.w || y >= lv.h) return -1;
    return lv.mat.charCodeAt(y * lv.w + x) - 48;
  }

  /**
   * Ruin walls: the game paves its ruins' walls (WALL with mat 3) and puts hardpan (2) under the ridges.
   * Levels whose walls carry no paving fall back to thin runs of wall beside paved floor.
   */
  findRuins() {
    const { w, h } = this;
    const built = new Uint8Array(w * h);
    let paved = 0;
    for (let i = 0; i < w * h; i++) if (this.level.tiles.charCodeAt(i) - 48 === TILE.WALL && this.mat(i % w, (i / w) | 0) === 3) built[i] = ++paved && 1;
    if (paved) return built;
    const walk = (t) => t !== TILE.WALL && t !== TILE.WATER;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.tile(x, y) !== TILE.WALL) continue;
        let paved = this.mat(x, y) === 3, walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const t = this.tile(x + dx, y + dy);
            if (t === TILE.WALL) walls++;
            else if (walk(t) && this.mat(x + dx, y + dy) === 3) paved = true;
          }
        }
        if (paved && walls <= 5) built[y * w + x] = 1;
      }
    }
    return built;
  }

  isBuilt(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.built[y * this.w + x] === 1;
  }

  /** Ridge rock: wall tiles that are not ruins, and a band past the map edge. */
  isRock(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return x >= 1 - PAD && y >= 1 - PAD && x < this.w + PAD - 1 && y < this.h + PAD - 1 ? 1 : 0;
    return this.tile(x, y) === TILE.WALL && !this.built[y * this.w + x] ? 1 : 0;
  }

  /** Signed distance into the ridges at a point, bilinear (or another grid of the field's size). */
  S(x, z, s = this.s) {
    const fx = Math.min(this.nx - 1.001, Math.max(0, (x + PAD) * FIELD_RES - 0.5));
    const fz = Math.min(this.ny - 1.001, Math.max(0, (z + PAD) * FIELD_RES - 0.5));
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, n = this.nx;
    const a = s[iz * n + ix], b = s[iz * n + ix + 1], c = s[iz * n + n + ix], d = s[iz * n + n + ix + 1];
    return a + (b - a) * tx + (c - a + (d - c - b + a) * tx) * tz;
  }

  /** How far a point lies outside the map, in tiles (0 inside). */
  outside(x, z) {
    return Math.max(0, -x, -z, x - this.w, z - this.h);
  }

  /** Where the ridges give way to big dunes: 0 rock, 1 buried in sand. Never at the map edge. */
  dune(x, z) {
    const n = this.n3(x / 11, z / 11);
    const edge = Math.min(x, z, this.w - x, this.h - z);
    return THREE.MathUtils.smoothstep(n, 0.55, 0.72) * THREE.MathUtils.smoothstep(edge, 3, 7);
  }

  /** Height of the ridge tops: higher further in, rolling, with a flat mesa now and then; lone outcrops stay low. */
  top(x, z, s = this.S(x, z)) {
    const roll = this.n1(x / 6.5, z / 6.5), mesa = this.n2(x / 15, z / 15);
    const big = THREE.MathUtils.smoothstep(this.S(x, z, this.thick), 0.35, 1.4);
    let h = 1.3 + 0.95 * big + 1.25 * THREE.MathUtils.smoothstep(s, 0.4, 3.2) + (0.5 + 0.6 * big) * (roll - 0.5) + 1.3 * big * THREE.MathUtils.smoothstep(mesa, 0.5, 0.8);
    h += 0.5 * Math.min(1, this.outside(x, z) / PAD);
    return h * (1 - 0.55 * this.dune(x, z));
  }

  /** Height of the rock's top surface: the ridge top, rounding over within a little more than half a tile of the face. */
  rockTop(x, z, s = this.S(x, z)) {
    const drop = 0.32 * (1 - THREE.MathUtils.smoothstep(s, 0.15, 0.85));
    return this.top(x, z, s) + 0.12 * (this.n2(x * 1.3, z * 1.3) - 0.5) - drop;
  }

  /**
   * How far into the field (S) a cliff face stands at height y (its foot y0): it leans back as it rises,
   * steps in and out band by band, bulges and is cut by gullies. cliffs.js builds the faces from this.
   */
  faceInset(x, z, y, y0) {
    const u = (y + (this.n1(x * 0.6, z * 0.6) - 0.5) * 0.9) / 0.62;
    const band = Math.abs(u - Math.floor(u) - 0.5) * 2;
    return 0.05 + 0.055 * (y - y0) + 0.1 * band + 0.3 * (this.n3(x * 0.9 + y * 0.25, z * 0.9 - y * 0.2) - 0.5)
      + 0.16 * (this.n1(x * 1.4 + 11, z * 1.4 + 7) - 0.5);
  }

  /**
   * A spot at the foot of the cliff nearest (x, z): `off` out from its face (negative: in front of it, on
   * the sand; positive: into the rock), as [x, z], or null where there is no clear face.
   */
  foot(x, z, off) {
    for (let it = 0; it < 2; it++) {
      const e = 0.15, gx = this.S(x + e, z) - this.S(x - e, z), gz = this.S(x, z + e) - this.S(x, z - e), l = Math.hypot(gx, gz);
      if (l < 1e-3) return null;
      const y0 = this.sand(x, z) - 0.38;
      const k = (this.faceInset(x, z, y0 + 0.6, y0) + off - this.S(x, z)) / (l / (2 * e));
      x += gx / l * k;
      z += gz / l * k;
    }
    return [x, z];
  }

  /**
   * The sand's height over the ground: gentle swells over the open sand (never below zero, so only the
   * oasis basin looks wet), a drift banked against the foot of each ridge and dunes where they bury it.
   */
  sand(x, z) {
    const s = this.S(x, z);
    const swell = 0.11 * this.n2(x / 8.5, z / 8.5) + 0.04 * this.n1(x / 3.1, z / 3.1);
    const bank = 0.3 * THREE.MathUtils.smoothstep(s, -0.7, 0.15);
    const d = this.dune(x, z);
    const up = s > 0 ? (0.55 + 2.4 * d) * THREE.MathUtils.smoothstep(s, 0, 1.4 + 1.6 * d) : 0;
    return swell + bank + up;
  }

  /** The level's ground materials for the splat: ridges are drift sand under the rock, ruins keep their paving. */
  groundLevel() {
    const lv = this.level, { w, h } = this;
    const out = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let m = lv.mat ? lv.mat.charCodeAt(i) - 48 : 0;
        if (this.tile(x, y) === TILE.WALL) m = this.built[i] ? 3 : 1;
        else if (m < 0 || m > 7) m = 0;
        out[i] = String.fromCharCode(48 + m);
      }
    }
    return { ...lv, mat: out.join('') };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ground layers, baked on the GPU: fine sand, rippled dune sand, rocky hardpan, sandstone paving, oasis grass.

const BAKE_VS = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BAKE_FS = /* glsl */`
precision highp float;
precision highp int;
uniform int uLayer;
in vec2 vUv;
out vec4 outColor;

uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
// A lattice value in [0, 1], wrapping every 'period' cells so the texture tiles.
float lat(vec2 c, float period, uint salt) {
  vec2 m = mod(c, period);
  return float(hashU(uvec3(uvec2(m), salt)) >> 8u) / 16777215.0;
}
float vnoise(vec2 p, float period, uint salt) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lat(i, period, salt), lat(i + vec2(1.0, 0.0), period, salt), u.x),
             mix(lat(i + vec2(0.0, 1.0), period, salt), lat(i + vec2(1.0, 1.0), period, salt), u.x), u.y);
}
// fbm over the unit tile: 'cells' lattice cells per tile at the first octave.
float fbm(vec2 uv, float cells, int oct, uint salt) {
  float s = 0.0, a = 0.5, n = 0.0, f = cells;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    s += a * vnoise(uv * f, f, salt + uint(o) * 101u);
    n += a; a *= 0.5; f *= 2.0;
  }
  return s / n;
}
// Tiling Voronoi: x nearest distance, y gap to the second (edges), z the cell's random value.
vec3 voronoi(vec2 uv, float cells, uint salt) {
  vec2 p = uv * cells, i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(lat(i + g, cells, salt), lat(i + g, cells, salt + 7u)) * 0.85 + 0.075;
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = lat(i + g, cells, salt + 13u); } else if (d < d2) d2 = d;
    }
  }
  return vec3(d1, d2 - d1, id);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float grainAt(vec2 uv, uint salt) { return lat(floor(uv * 512.0), 512.0, salt); }

void main() {
  vec2 uv = vUv;
  vec3 col; float h;
  float pat = fbm(uv, 3.0, 4, 1u), fine = fbm(uv, 24.0, 3, 2u), g = grainAt(uv, 3u), g2 = grainAt(uv + 0.5 / 512.0, 4u);
  // Shared sand: warm grains, a few darker mineral specks and pale quartz glints.
  vec3 sand = mix(vec3(0.86, 0.71, 0.51), vec3(0.93, 0.8, 0.6), pat) * (0.94 + 0.12 * fine);
  sand *= 0.93 + 0.1 * g;
  sand = mix(sand, vec3(0.5, 0.38, 0.28), step(0.94, g2) * 0.6);
  sand = mix(sand, vec3(1.0, 0.95, 0.85), step(0.975, g) * 0.5);
  if (uLayer == 0) {
    // Fine sand: soft, faint wind ripples breaking up into smooth patches.
    float warp = fbm(uv, 4.0, 3, 5u) - 0.5;
    float ph = uv.x * 30.0 + warp * 4.0 + (fbm(uv, 12.0, 2, 6u) - 0.5) * 0.8;
    float f = fract(ph);
    float rip = smoothstep(0.0, 0.72, f) * (1.0 - smoothstep(0.72, 1.0, f));
    float amp = smoothstep(0.35, 0.75, fbm(uv, 5.0, 2, 7u));
    col = sand * (0.97 + 0.05 * rip * amp);
    h = 0.42 + 0.07 * (fine - 0.5) + 0.1 * rip * amp + 0.03 * g;
  } else if (uLayer == 1) {
    // Dune sand: crisp asymmetric ripples (gentle stoss, steep lee) that bend and fork, coarse dark grains in the troughs.
    float warp = fbm(uv, 3.0, 3, 8u) - 0.5;
    float ph = uv.x * 22.0 + warp * 5.0 + (fbm(uv, 10.0, 2, 9u) - 0.5) * 1.1;
    float f = fract(ph);
    float rip = smoothstep(0.0, 0.7, f) * (1.0 - smoothstep(0.7, 0.98, f));
    float amp = 0.55 + 0.45 * smoothstep(0.25, 0.65, fbm(uv, 6.0, 2, 10u));
    vec3 base = mix(vec3(0.85, 0.64, 0.42), vec3(0.92, 0.74, 0.52), pat);
    col = mix(base, sand, 0.35) * (0.86 + 0.2 * rip * amp);
    col = mix(col, vec3(0.55, 0.4, 0.3), step(0.88, g2) * (1.0 - rip) * 0.5);
    h = 0.38 + 0.3 * rip * amp + 0.03 * g;
  } else if (uLayer == 2) {
    // Hardpan: a crust of baked silt crazed into small plates, desert pavement (angular pebbles of mixed
    // stone packed into it) and sand drifted into the hollows.
    vec3 cr = voronoi(uv, 18.0, 20u);
    float crack = 1.0 - smoothstep(0.0, 0.02 + 0.02 * fine, cr.y);
    vec3 crust = mix(vec3(0.72, 0.6, 0.47), vec3(0.8, 0.68, 0.54), cr.z) * (0.92 + 0.16 * fine);
    vec3 pb = voronoi(uv, 64.0, 30u);
    float rough = fbm(uv, 32.0, 2, 31u);
    float pebble = step(0.6, pb.z) * smoothstep(0.42, 0.22, pb.x + (rough - 0.5) * 0.25);
    float tone = fract(pb.z * 7.31);
    vec3 stone = mix(vec3(0.46, 0.4, 0.35), vec3(0.72, 0.64, 0.55), tone);
    stone = mix(stone, vec3(0.58, 0.36, 0.26), step(0.82, fract(pb.z * 3.7)) * 0.7);
    stone *= 0.8 + 0.35 * smoothstep(0.4, 0.0, pb.x); // lit tops, darker rims
    float drift = smoothstep(0.45, 0.7, fbm(uv, 4.0, 3, 21u));
    col = mix(crust, sand * 0.97, drift * 0.85);
    col *= 1.0 - 0.22 * crack * (1.0 - drift);
    col = mix(col, stone * (0.9 + 0.2 * g), pebble * (1.0 - drift * 0.85));
    h = 0.42 + 0.05 * (fine - 0.5) - 0.08 * crack * (1.0 - drift) + 0.25 * pebble * (1.0 - drift * 0.85) + drift * 0.03;
  } else if (uLayer == 3) {
    // Sandstone paving: courses of worn slabs, sand in the joints and drifted over the low corners.
    float rows = 6.0, ry = uv.y * rows, row = floor(ry), fy = fract(ry);
    float off = lat(vec2(row, 0.0), rows, 40u);
    float x = fract(uv.x + off);
    float c1 = 0.2 + 0.18 * lat(vec2(row, 1.0), rows, 41u), c2 = 0.55 + 0.2 * lat(vec2(row, 2.0), rows, 42u);
    float a = x < c1 ? 0.0 : x < c2 ? c1 : c2, b = x < c1 ? c1 : x < c2 ? c2 : 1.0;
    float slabId = row * 3.0 + (x < c1 ? 0.0 : x < c2 ? 1.0 : 2.0);
    float sv = lat(vec2(slabId, 3.0), 18.0, 43u), sv2 = lat(vec2(slabId, 5.0), 18.0, 47u);
    // Distance to the nearest joint in metres (a tile of texture is 4 m), roughened.
    float edge = min(min(x - a, b - x) * 4.0, min(fy, 1.0 - fy) * 4.0 / rows) + (fine - 0.5) * 0.03;
    float joint = 1.0 - smoothstep(0.018, 0.04, edge);
    float wear = smoothstep(0.0, 0.1, edge);
    vec3 slab = mix(vec3(0.8, 0.66, 0.49), vec3(0.9, 0.79, 0.62), sv) * (0.9 + 0.18 * fbm(uv, 16.0, 3, 44u));
    slab = mix(slab, vec3(0.76, 0.56, 0.42), step(0.8, sv2) * 0.45);
    // A broken slab now and then: one hairline crack across it.
    float cut = abs(dot(vec2(x - (a + b) * 0.5, fy - 0.5), normalize(vec2(sv - 0.5, 0.6))) + (fine - 0.5) * 0.02);
    float crack = (1.0 - smoothstep(0.0, 0.006, cut)) * step(0.7, sv2);
    slab *= (1.0 - 0.3 * crack) * (0.92 + 0.08 * wear);
    float drift = smoothstep(0.58, 0.78, fbm(uv, 3.0, 3, 46u) + (1.0 - wear) * 0.06);
    col = mix(slab, sand * 0.88, max(joint, drift));
    h = mix(0.55 + 0.17 * wear + 0.05 * fine - 0.08 * crack, 0.28, joint);
    h = mix(h, 0.42, drift);
  } else {
    // Oasis grass: a thick sward of green and straw blades over damp dark soil.
    float blades = fbm(uv * vec2(1.0, 0.25), 64.0, 2, 50u);
    float tuft = fbm(uv, 10.0, 3, 51u);
    vec3 soil = vec3(0.4, 0.32, 0.22) * (0.85 + 0.3 * fine);
    vec3 green = mix(vec3(0.26, 0.36, 0.12), vec3(0.45, 0.52, 0.2), blades);
    green = mix(green, vec3(0.62, 0.55, 0.3), smoothstep(0.6, 0.85, fbm(uv, 6.0, 2, 52u)) * 0.6);
    float cover = smoothstep(0.32, 0.5, tuft + (blades - 0.5) * 0.4);
    col = mix(soil, green, cover) * (0.85 + 0.25 * g);
    h = 0.35 + 0.35 * cover * blades + 0.05 * g;
  }
  outColor = vec4(lin(clamp(col, 0.0, 1.0)), clamp(h, 0.0, 1.0));
}`;

let sandLayers = null;

/**
 * The desert's ground layers as a texture array, baked once into a render target (mipmapped, repeating),
 * with each layer's height in alpha like Assets.layeredStrip gives the overworld.
 */
export function bakeSandLayers(renderer, size = 512) {
  if (sandLayers) return sandLayers;
  const rt = new THREE.WebGLArrayRenderTarget(size, size, SAND_LAYERS, { depthBuffer: false });
  const tex = rt.texture;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { uLayer: { value: 0 } }, vertexShader: BAKE_VS, fragmentShader: BAKE_FS, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget(), clear = renderer.getClearAlpha();
  for (let l = 0; l < SAND_LAYERS; l++) {
    mat.uniforms.uLayer.value = l;
    renderer.setRenderTarget(rt, l);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prev);
  renderer.setClearAlpha(clear);
  quad.geometry.dispose();
  mat.dispose();
  sandLayers = tex;
  return tex;
}

let noiseTexture = null;

/** A small tiling RGBA noise (the sky's), shared by the sand drift, caustics and rock shaders. */
export function desertNoise() {
  return noiseTexture || (noiseTexture = makeSkyNoise(128));
}

/** Uniforms the desert ground shader animates: time, the wind and how much daylight lights the drift. */
export const SAND = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(1, 0.25) },
  uDay: { value: 1 },
  uNoise: { value: null },
};

// ---------------------------------------------------------------------------------------------------------
// Blowing sand: grains hopping along the ground with the wind, drawn as short streaks.

const WIND_VS = /* glsl */`
attribute vec4 aGrain; // place in the box (0..1) and a random value
uniform vec3 uCenter;
uniform vec2 uWind;
uniform float uTime, uScale, uHeight;
varying vec2 vUv;
varying float vA;
const vec2 BOX = vec2(26.0, 26.0);
void main() {
  float speed = 0.7 + aGrain.w * 0.9;
  vec3 vel = vec3(uWind.x, 0.0, uWind.y) * speed;
  vec2 xz = aGrain.xz * BOX + vel.xz * uTime;
  xz = uCenter.xz + mod(xz - uCenter.xz + BOX * 0.5, BOX) - BOX * 0.5;
  // Saltation: most grains skim the sand in low hops, a few ride higher on the gusts.
  float hop = abs(sin(uTime * (2.0 + aGrain.w * 3.0) + aGrain.x * 61.0));
  float y = uCenter.y + 0.04 + aGrain.y * aGrain.y * aGrain.y * uHeight + hop * 0.22 * (1.0 - aGrain.y);
  vec3 p = vec3(xz.x, y, xz.y);
  vec3 head = (viewMatrix * vec4(p, 1.0)).xyz;
  vec3 tail = (viewMatrix * vec4(p - vel * 0.075, 1.0)).xyz;
  vec3 side = normalize(cross(tail - head, head));
  vec3 q = mix(head, tail, position.y);
  float w = max(0.007, 1.3 * -q.z / uScale);
  q += side * position.x * w;
  vUv = position.xy;
  vec2 rel = abs(xz - uCenter.xz) / (BOX * 0.5);
  vA = (0.007 / w) * (1.0 - smoothstep(0.65, 1.0, max(rel.x, rel.y))) * smoothstep(1.0, 3.5, -head.z);
  gl_Position = projectionMatrix * vec4(q, 1.0);
}`;

const WIND_FS = /* glsl */`
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  float a = (1.0 - vUv.x * vUv.x) * vUv.y * (1.0 - vUv.y) * 4.0;
  gl_FragColor = vec4(uColor, a * vA * uAmount);
}`;

/** Blowing sand around the hero in one GPU-animated draw; `count` grains at full strength. */
export class SandWind {
  constructor(scaleUniform, count) {
    this.count = count;
    this.time = 0;
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(1, 0.25) },
      uTime: { value: 0 },
      uScale: scaleUniform,
      uHeight: { value: 1.6 },
      uColor: { value: new THREE.Color() },
      uAmount: { value: 0 },
    };
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const grains = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) grains[i * 4 + k] = hash(i, k + 1, 77);
    geo.setAttribute('aGrain', new THREE.InstancedBufferAttribute(grains, 4));
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: WIND_VS, fragmentShader: WIND_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.fwd = new THREE.Vector3();
  }

  /** amount 0..1 of the full count; color is the lit sand's. */
  update(amount, dt, focus, camera, wind, color) {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    this.time = (this.time + dt) % 1000;
    camera.getWorldDirection(this.fwd);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    u.uCenter.value.set(focus.x + this.fwd.x / fl * 5, focus.y, focus.z + this.fwd.z / fl * 5);
    u.uWind.value.copy(wind);
    u.uTime.value = this.time;
    u.uHeight.value = 1.2 + 2.5 * Math.max(0, amount - 0.5);
    u.uAmount.value = Math.min(1, 0.35 + amount * 0.65);
    u.uColor.value.copy(color);
    this.mesh.geometry.instanceCount = Math.ceil(this.count * Math.min(1, amount));
  }
}

const GRADE_SHADOW = new THREE.Color(0.93, 0.98, 1.06), GRADE_LIGHT = new THREE.Color(1.07, 1.0, 0.9);
const GRADE_DUSK = new THREE.Color(1.1, 0.95, 0.84), WHITE = new THREE.Color(1, 1, 1);

/**
 * The desert's camera: exposed a little lower for the bright sand, a gentler bloom by day, and a warm
 * cinematic grade (teal-tinged shade, golden highlights, a touch more saturation), warmest at dusk.
 * Elsewhere the grade is left neutral. Called by the engine after its own per-frame settings.
 */
export function applyLook(world, f, renderer, bloom, grade) {
  if (!world.desert) {
    if (grade.uGradeSat.value !== 1) {
      grade.uGradeSat.value = 1;
      grade.uGradeShadow.value.copy(WHITE);
      grade.uGradeLight.value.copy(WHITE);
    }
    return;
  }
  const day = f.dl, dusk = Math.max(0, 1 - Math.abs(day - 0.42) / 0.3);
  renderer.toneMappingExposure = 0.9 + 0.35 * (1 - day);
  if (bloom) bloom.strength = 0.3 + 0.4 * (1 - day);
  grade.uWarm.value = (1 - day) * 0.5;
  grade.uGradeSat.value = 1.08 + 0.05 * dusk;
  grade.uGradeShadow.value.copy(GRADE_SHADOW);
  grade.uGradeLight.value.copy(GRADE_LIGHT).lerp(GRADE_DUSK, dusk);
}
