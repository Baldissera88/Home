import * as THREE from 'three';
import { hash } from './defs.js';

/**
 * The open world's horizon and ambient life. Past the map edge: a forest belt, rolling hills and a far
 * mountain range, all one unlit vertex-coloured draw that melts into the fog, the farther the more, and
 * takes its light from the fog colour so it follows the time of day and the weather. Above and around the
 * hero: birds circling in loose flocks and butterflies near the ground by day, animated on the GPU in one
 * more draw. Both are rebuilt from the level seed, so a level always shows the same skyline.
 */

const BACKDROP_VS = /* glsl */`
attribute vec4 aCol;
uniform vec3 uLight;
uniform float fogDensity, uFogScale;
varying vec3 vCol;
varying float vHaze;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Softer than the scene fog with distance, so the ranges still read at 200 units, but steeper with its
  // density, so rain and mist swallow them. aCol.a adds a layer's own haze.
  float fog = 1.0 - exp(-fogDensity * fogDensity * length(mv.xyz) * uFogScale);
  vHaze = 1.0 - (1.0 - fog) * (1.0 - aCol.a);
  vCol = aCol.rgb * uLight;
  gl_Position = projectionMatrix * mv;
}`;

const BACKDROP_FS = /* glsl */`
uniform vec3 fogColor;
varying vec3 vCol;
varying float vHaze;
void main() {
  gl_FragColor = vec4(mix(vCol, fogColor, vHaze), 1.0);
}`;

const LIFE_VS = /* glsl */`
attribute vec4 aLife; // kind (0 bird, 1 butterfly), show threshold, seed, flock lag
attribute vec4 aPath; // bird: flock centre x z, signed orbit radius, height; butterfly: home x z, height, -
uniform float uTime, uBirds, uFlies, fogDensity;
uniform vec3 uHero, uLight;
varying vec3 vCol;
varying vec2 vUv;
varying float vHaze, vKind;
// Wraps a world point into the tile of size l around the hero; returns the fade near the tile's edge.
float wrapNear(inout vec2 p, float l) {
  vec2 r = mod(p - uHero.xz + 0.5 * l, l) - 0.5 * l;
  p = uHero.xz + r;
  return 1.0 - smoothstep(0.36 * l, 0.48 * l, max(abs(r.x), abs(r.y)));
}
void main() {
  vec3 aWing = position; // span 0..1 (root, elbow, tip), chord -1..1 (back..front), side -1/1
  float bird = 1.0 - aLife.x, seed = aLife.z;
  float t = uTime;
  vec3 pos, fwd;
  float a1, a2, span, scale, bank = 0.0;
  if (bird > 0.5) {
    // Flocks circle while drifting with the wind; each bird has its own lag, radius and height.
    vec2 c = aPath.xy + vec2(1.3, 0.7) * t;
    scale = wrapNear(c, 150.0) * step(aLife.y, uBirds);
    float dir = sign(aPath.z), r = abs(aPath.z) + (fract(seed * 7.13) - 0.5) * 6.0;
    float ph = fract(seed * 3.31) * 6.283 + dir * t * 7.5 / r - dir * aLife.w;
    vec2 rad = vec2(cos(ph), sin(ph));
    vec2 xz = c + rad * r;
    pos = vec3(xz.x, aPath.w + (fract(seed * 5.7) - 0.5) * 3.0 + sin(t * 0.4 + seed * 9.0) * 0.8, xz.y);
    fwd = vec3(-rad.y * dir, 0.0, rad.x * dir);
    // Bursts of wingbeats between long glides on raised wings: a V when gliding, an M at the downstroke.
    float flap = smoothstep(0.25, 0.65, sin(t * 0.5 + seed * 12.0));
    float beat = sin(t * 9.0 + seed * 6.283);
    a1 = 0.24 + flap * 0.55 * beat;
    a2 = -0.12 + flap * 0.45 * sin(t * 9.0 + seed * 6.283 - 0.9);
    span = 0.75 + 0.3 * fract(seed * 2.9);
    bank = 0.3 * dir; // into the turn: the inner wing dips
  } else {
    // Butterflies wander around homes that tile the ground near the hero.
    vec2 h = aPath.xy;
    scale = wrapNear(h, 24.0) * step(aLife.y, uFlies);
    float p1 = seed * 6.283, p2 = seed * 17.0;
    vec2 xz = h + vec2(sin(t * 0.6 + p1) * 2.0 + sin(t * 1.7 + p2) * 0.5, cos(t * 0.5 + p2) * 2.0 + cos(t * 1.9 + p1) * 0.5);
    pos = vec3(xz.x, uHero.y + aPath.z + sin(t * 2.3 + p1) * 0.25 + sin(t * 11.0 + p2) * 0.05, xz.y);
    fwd = vec3(cos(t * 0.6 + p1) * 1.2 + cos(t * 1.7 + p2) * 0.85, 0.0, -sin(t * 0.5 + p2) - sin(t * 1.9 + p1) * 0.95);
    fwd /= max(length(fwd), 1e-3);
    a1 = 0.15 + 1.15 * (0.5 + 0.5 * sin(t * 16.0 + p2));
    a2 = 0.0;
    span = 0.13;
  }
  // The wing: root, elbow and tip, the outer half bent at the elbow.
  float s = aWing.x, mid = step(0.25, s), tip = step(0.75, s);
  vec2 wing = (mid * vec2(cos(a1), sin(a1)) + tip * vec2(cos(a1 + a2), sin(a1 + a2))) * 0.5 * span;
  float chord = bird > 0.5 ? (0.36 - 0.08 * mid - 0.23 * tip) * 0.5 * aWing.y - 0.05 * mid - 0.25 * tip : aWing.y * 0.11;
  vec3 right = vec3(-fwd.z, 0.0, fwd.x);
  vec3 p = pos + (right * wing.x * aWing.z + vec3(0.0, wing.y - bank * wing.x * aWing.z, 0.0) + fwd * chord * (bird > 0.5 ? span : 1.0)) * scale;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vHaze = 1.0 - exp(-fogDensity * length(mv.xyz) * (bird > 0.5 ? 0.5 : 1.0));
  vec3 col = bird > 0.5 ? vec3(0.025, 0.024, 0.028) : fract(seed * 5.3) < 0.25 ? vec3(0.9, 0.86, 0.74)
    : fract(seed * 5.3) < 0.5 ? vec3(0.89, 0.63, 0.05) : fract(seed * 5.3) < 0.75 ? vec3(0.87, 0.25, 0.02) : vec3(0.14, 0.4, 0.87);
  vCol = col * uLight;
  vUv = aWing.xy;
  vKind = aLife.x;
  gl_Position = projectionMatrix * mv;
}`;

const LIFE_FS = /* glsl */`
uniform vec3 fogColor;
varying vec3 vCol;
varying vec2 vUv;
varying float vHaze, vKind;
void main() {
  vec3 col = vCol;
  if (vKind > 0.5) {
    // Butterfly wings: a big forewing and a smaller hindwing, dark rims and body, a paler underside.
    float fore = length((vUv - vec2(0.45, 0.35)) * vec2(1.6, 1.4));
    float hind = length((vUv - vec2(0.3, -0.45)) * vec2(2.2, 1.8));
    float r = min(fore, hind);
    if (r > 1.0) discard;
    col *= mix(1.0, 0.15, smoothstep(0.72, 0.9, r)) * mix(0.15, 1.0, smoothstep(0.04, 0.1, vUv.x));
    if (!gl_FrontFacing) col = col * 0.6 + 0.04;
  }
  gl_FragColor = vec4(mix(col, fogColor, vHaze), 1.0);
}`;

const TAU = Math.PI * 2;
const FLOCKS = 3, PER_FLOCK = 8, BUTTERFLIES = 14;
// Sun direction the faces are shaded for (the fog tint does the time of day).
const SUN = new THREE.Vector3(-0.55, 0.6, -0.58).normalize();
const PAL = {
  rock: 0x47536a, rockLow: 0x3a4a48, snow: 0xd8e0ea,
  hillForest: 0x2c4c36, hillMeadow: 0x5e7c44, hillFoot: 0x48664e,
  floor: 0x2a3e24, floorTop: 0x34502c,
  firBase: 0x1a3624, firTop: 0x3c6c42, leafBase: 0x2c4a22, leafTop: 0x5a8838,
};
const COL = {};
for (const k in PAL) COL[k] = new THREE.Color(PAL[k]);
const _c = new THREE.Color(), _c0 = new THREE.Color(), _c1 = new THREE.Color(), _light = new THREE.Color();
const _n = new THREE.Vector3();

/** Smooth noise around the ring, u in [0, 1], seamless at 1; octaves of `cells` doubling. */
function ringNoise(seed, cells, octaves) {
  const tables = [];
  for (let o = 0, n = cells; o < octaves; o++, n *= 2) {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = hash(i, o + 1, seed);
    tables.push(v);
  }
  return (u) => {
    let sum = 0, amp = 1, norm = 0;
    for (const v of tables) {
      const x = u * v.length, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
      const a = v[((i % v.length) + v.length) % v.length], b = v[(i + 1) % v.length];
      sum += (a + (b - a) * s) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

/** Collects unlit vertices: position, linear colour and how much of the fog colour they take. */
class Builder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  vert(x, y, z, c, haze, shade = 1) {
    this.pos.push(x, y, z);
    this.col.push(c.r * shade, c.g * shade, c.b * shade, haze);
    return this.count++;
  }

  /** A band around the ring: rows vertices per column from put(u, row), quads between neighbours. */
  band(cols, rows, put) {
    const base = this.count;
    for (let j = 0; j <= cols; j++) for (let k = 0; k < rows; k++) put(j / cols, k);
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < rows - 1; k++) {
        const a = base + j * rows + k, b = a + rows;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /** A three-sided cone, flat-shaded per face for the sun, darker at the base. */
  cone(x, y, z, radius, height, turn, base, top, haze) {
    for (let i = 0; i < 3; i++) {
      const a0 = turn + (i / 3) * TAU, a1 = turn + ((i + 1) / 3) * TAU;
      const x0 = x + Math.cos(a0) * radius, z0 = z + Math.sin(a0) * radius;
      const x1 = x + Math.cos(a1) * radius, z1 = z + Math.sin(a1) * radius;
      // The face's outward normal, for its share of sunlight.
      const am = turn + ((i + 0.5) / 3) * TAU;
      _n.set(Math.cos(am) * height, radius, Math.sin(am) * height).normalize();
      const shade = 0.62 + 0.5 * Math.max(0, _n.dot(SUN));
      const v = this.count;
      this.vert(x0, y, z0, base, haze, shade);
      this.vert(x1, y, z1, base, haze, shade);
      this.vert(x, y + height, z, top, 0, shade);
      this.idx.push(v, v + 1, v + 2);
    }
  }

  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 4));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** The far range: ridged peaks with snow on the tallest, foothills in front, the most haze of all. */
function mountains(b, cx, cz, radius, seed) {
  const peak = ringNoise(seed + 11, 15, 4), reach = ringNoise(seed + 12, 5, 2), snow = ringNoise(seed + 13, 7, 2);
  const mass = ringNoise(seed + 14, 4, 2);
  const height = (u) => {
    const r = 1 - Math.abs(2 * peak(u) - 1);
    return 6 + 26 * r * r * (0.4 + 0.8 * mass(u));
  };
  const ROWS = [[-3, 52, 0.36], [0.4, 22, 0.16], [0.78, 7, 0.1], [1, 0, 0.08]]; // [height share, depth in front, haze]
  const du = 1 / 2000;
  b.band(480, 4, (u, k) => {
    const a = u * TAU, H = height(u), R = radius + 22 * (reach(u) - 0.5);
    const [hs, back, haze] = ROWS[k];
    const y = hs < 0 ? hs : hs * H, r = R - back;
    // Facets: slopes turned toward the sun are lit, the others in shade.
    const slope = (height(u + du) - height(u - du)) / (2 * du * TAU * R);
    const shade = Math.min(1.3, Math.max(0.55, 0.9 - slope * 1.1));
    const line = 22 + 6 * snow(u);
    if (k === 3) _c.copy(COL.rock).lerp(COL.snow, Math.min(1, Math.max(0, (y - line) / 3)));
    else if (k === 0) _c.copy(COL.rockLow);
    else _c.copy(COL.rock).lerp(COL.rockLow, k === 1 ? 0.5 : 0);
    b.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, _c, haze, k === 0 ? 1 : shade);
  });
}

/** Rolling hills between: forested crests with a ragged treeline, meadows on the open slopes. */
function hills(b, cx, cz, radius, seed) {
  const rise = ringNoise(seed + 21, 12, 4), reach = ringNoise(seed + 22, 6, 2), wood = ringNoise(seed + 23, 13, 2);
  b.band(560, 3, (u, k) => {
    const a = u * TAU, H = 4 + 16 * Math.pow(rise(u), 1.3), R = radius + 16 * (reach(u) - 0.5);
    const forest = Math.min(1, Math.max(0, (wood(u) - 0.42) * 3));
    let y, r, haze;
    if (k === 0) {
      y = -2; r = R - 30; haze = 0.3;
      _c.copy(COL.hillFoot);
    } else if (k === 1) {
      y = 0.55 * H; r = R - 10; haze = 0.1;
      _c.copy(COL.hillMeadow).lerp(COL.hillForest, forest * 0.7);
    } else {
      y = H + forest * (0.6 + 1.4 * hash(Math.round(u * 560), 7, seed)); r = R; haze = 0.06;
      _c.copy(COL.hillMeadow).lerp(COL.hillForest, forest);
    }
    b.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, _c, haze);
  });
}

/**
 * The forest belt hugging the map: a low wooded rise along a rounded square just outside the playable
 * square, closed by conifers and broadleaf trees in patches.
 */
function forest(b, cx, cz, half, seed) {
  // A squircle: as far out along the sides as at the corners, relative to the map.
  const ring = (a) => half / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25);
  const rise = ringNoise(seed + 31, 17, 3), wood = ringNoise(seed + 32, 23, 2), kind = ringNoise(seed + 33, 31, 1);
  const DEPTH = 16;
  b.band(400, 3, (u, k) => {
    const a = u * TAU, R = ring(a), gh = 0.6 + 2.2 * rise(u);
    const r = R + (k === 0 ? -6 : k === 1 ? 2 : DEPTH);
    const y = k === 0 ? -0.5 : k === 1 ? 0.4 * gh : gh;
    b.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, k === 2 ? COL.floorTop : COL.floor, k === 0 ? 0.12 : 0.04);
  });
  const TREES = 900;
  for (let i = 0; i < TREES; i++) {
    const u = (i + hash(i, 1, seed)) / TREES;
    if (hash(i, 2, seed) > (wood(u) - 0.25) * 2.2) continue; // clearings
    const a = u * TAU, d = Math.pow(hash(i, 3, seed), 0.7) * DEPTH, R = ring(a) + d;
    const gh = 0.6 + 2.2 * rise(u), y = gh * Math.min(1, (d + 6) / (DEPTH + 6)) - 0.3;
    const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
    const fir = hash(i, 4, seed) < 0.35 + 0.5 * kind(u);
    const h = (fir ? 3.2 : 2.6) + 2.2 * hash(i, 5, seed) + d * 0.1, w = fir ? 1 + 0.25 * hash(i, 6, seed) : 1.5 + 0.4 * hash(i, 6, seed);
    const turn = hash(i, 7, seed) * TAU;
    const tint = 0.85 + 0.3 * hash(i, 8, seed);
    _c0.copy(fir ? COL.firBase : COL.leafBase).multiplyScalar(tint);
    _c1.copy(fir ? COL.firTop : COL.leafTop).multiplyScalar(tint);
    if (fir) {
      b.cone(x, y + h * 0.05, z, w, h * 0.6, turn, _c0, _c1, 0.08);
      b.cone(x, y + h * 0.4, z, w * 0.68, h * 0.6, turn + 1, _c0, _c1, 0);
    } else {
      b.cone(x, y + h * 0.12, z, w, h * 0.55, turn, _c0, _c1, 0.08);
      b.cone(x, y + h * 0.38, z, w * 0.85, h * 0.62, turn + 1, _c0, _c1, 0);
    }
  }
}

/** Birds and butterflies: one instanced wing pair each, flown entirely in the vertex shader. */
function life(seed, uniforms) {
  const geo = new THREE.InstancedBufferGeometry();
  const wing = [], idx = [];
  for (const side of [-1, 1]) {
    const o = wing.length / 3;
    for (const s of [0, 0.5, 1]) wing.push(s, -1, side, s, 1, side);
    for (let j = 0; j < 2; j++) idx.push(o + j * 2, o + j * 2 + 2, o + j * 2 + 1, o + j * 2 + 1, o + j * 2 + 2, o + j * 2 + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(wing, 3));
  geo.setIndex(idx);
  const n = FLOCKS * PER_FLOCK + BUTTERFLIES;
  const lifeA = new Float32Array(n * 4), path = new Float32Array(n * 4);
  let i = 0;
  for (let f = 0; f < FLOCKS; f++) {
    // Spread around the wrap tile, so the flocks keep to different quarters of the sky.
    const fa = (f + 0.6 * hash(f, 41, seed)) / FLOCKS * TAU, fd = 40 + 25 * hash(f, 42, seed);
    const fx = 75 + Math.cos(fa) * fd, fz = 75 + Math.sin(fa) * fd;
    const r = (14 + 12 * hash(f, 43, seed)) * (hash(f, 44, seed) < 0.5 ? -1 : 1), y = 11 + 8 * hash(f, 45, seed);
    for (let k = 0; k < PER_FLOCK; k++, i++) {
      // Fewer birds in rain or at dusk: each one shows above its own threshold.
      lifeA.set([0, 0.15 + 0.8 * hash(i, 46, seed), hash(i, 47, seed), k * 0.12 + hash(i, 48, seed) * 0.1], i * 4);
      path.set([fx, fz, r, y], i * 4);
    }
  }
  for (let k = 0; k < BUTTERFLIES; k++, i++) {
    lifeA.set([1, 0.1 + 0.85 * hash(k, 51, seed), hash(k, 52, seed), 0], i * 4);
    path.set([hash(k, 53, seed) * 24, hash(k, 54, seed) * 24, 0.45 + 0.9 * hash(k, 55, seed), 0], i * 4);
  }
  geo.setAttribute('aLife', new THREE.InstancedBufferAttribute(lifeA, 4));
  geo.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: LIFE_VS, fragmentShader: LIFE_FS, side: THREE.DoubleSide, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** The open world's skyline and ambient life, for world.group; null indoors. */
export function buildBackdrop(world) {
  if (!world.outdoors) return null;
  const lv = world.level;
  const seed = lv.seed | 0;
  const cx = lv.w / 2, cz = lv.h / 2, corner = Math.hypot(lv.w, lv.h) / 2;
  const b = new Builder();
  forest(b, cx, cz, Math.max(lv.w, lv.h) / 2 + 16, seed);
  hills(b, cx, cz, corner * 2.3, seed);
  mountains(b, cx, cz, corner * 3.4, seed);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uLight: { value: new THREE.Color(1, 1, 1) },
    uFogScale: { value: 14 },
  }]);
  const ranges = new THREE.Mesh(b.geometry(), new THREE.ShaderMaterial({
    uniforms, vertexShader: BACKDROP_VS, fragmentShader: BACKDROP_FS, side: THREE.DoubleSide, fog: true,
  }));
  ranges.frustumCulled = false; // around the camera, always in sight

  const lifeUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uBirds: { value: 0 }, uFlies: { value: 0 }, uHero: { value: new THREE.Vector3() },
  }]);
  lifeUniforms.uLight = uniforms.uLight;
  const critters = life(seed, lifeUniforms);

  const group = new THREE.Group();
  group.add(ranges, critters);
  group.userData.dynamic = true;
  group.userData.ranges = ranges;
  group.userData.life = critters;
  group.userData.world = world;
  return group;
}

/** Time of day, weather and the hero's spot: the light comes from the fog, life only by day. */
export function updateBackdrop(group, f, t) {
  const scene = group.parent && group.parent.parent;
  const fog = scene && scene.fog;
  if (!fog) return;
  const day = f.dl, rain = f.rn || 0;
  // Daylight, tinted by the fog's hue and dimmed with it: blue haze at noon, warm at dusk, grey under
  // rain clouds, dim moonlit blue at night.
  const fc = fog.color, m = Math.max(fc.r, fc.g, fc.b, 0.02);
  _light.setRGB(fc.r / m, fc.g / m, fc.b / m);
  _light.lerp(_c.setRGB(1, 1, 1), 0.75 - 0.6 * (1 - day)).multiplyScalar(0.16 + 0.94 * day * Math.min(1, m * 1.5));
  const ru = group.userData.ranges.material.uniforms;
  ru.uLight.value.copy(_light);
  // The night's thicker fog would hide the moonlit ranges altogether.
  ru.uFogScale.value = 14 * (0.4 + 0.6 * day);

  const lu = group.userData.life.material.uniforms;
  const birds = THREE.MathUtils.smoothstep(day, 0.3, 0.7) * (1 - 0.7 * rain);
  const flies = THREE.MathUtils.smoothstep(day, 0.55, 0.85) * (1 - rain) * (1 - rain);
  lu.uBirds.value = birds;
  lu.uFlies.value = flies;
  group.userData.life.visible = birds > 0.15 || flies > 0.1;
  lu.uTime.value = t;
  const p = f.p, w = group.userData.world;
  if (p) lu.uHero.value.set(p[0], w.heightAt(p[0], p[1]), p[1]);
}
