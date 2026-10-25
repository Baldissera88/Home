import * as THREE from 'three';

/**
 * Surface detail shared by the ground, the dungeon walls, the wall dressing and the kit props: one small
 * tiling texture generated at load (no image to ship) and the GLSL that turns it into fine relief,
 * roughness variation and masks, projected from world space so nothing repeats with the colour maps.
 *
 * The texture (256 x 256, linear data):
 *   R, G  slope of a fine fractal relief along x and y (0.5 = flat), for the micro normals;
 *   B     a smooth broad noise, for masks (puddles, damp, grime, streaks);
 *   A     the fine relief itself, so pits read darker and rougher where the normals dip.
 */
const N = 256;
let detailTex = null;

/** Shared uniforms: the detail texture and the clock that pulses the lava. */
export const SURF = {
  uDetail: { value: null },
  uSurfTime: { value: 0 },
  // 0 dry .. 1 soaked: rain on the open world (set by World.update).
  uRain: { value: 0 },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiling value noise with n cells across the unit square. */
function tileNoise(n, rnd) {
  const v = Float32Array.from({ length: n * n }, rnd);
  return (x, y) => {
    x *= n;
    y *= n;
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const i0 = ((ix % n) + n) % n, i1 = (i0 + 1) % n, j0 = (((iy % n) + n) % n) * n, j1 = ((iy + 1) % n) * n;
    const a = v[j0 + i0] + (v[j0 + i1] - v[j0 + i0]) * fx, b = v[j1 + i0] + (v[j1 + i1] - v[j1 + i0]) * fx;
    return a + (b - a) * fy;
  };
}

/** The shared detail texture (made once). */
export function detailTexture() {
  if (detailTex) return detailTex;
  const rnd = rng(0x5eed51);
  const fine = [[tileNoise(16, rnd), 1], [tileNoise(32, rnd), 0.55], [tileNoise(64, rnd), 0.3], [tileNoise(128, rnd), 0.14]];
  const broad = [[tileNoise(4, rnd), 1], [tileNoise(8, rnd), 0.5], [tileNoise(16, rnd), 0.25]];
  const h = new Float32Array(N * N), m = new Float32Array(N * N);
  let hMin = Infinity, hMax = -Infinity, mMin = Infinity, mMax = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = y * N + x;
      let a = 0, b = 0;
      for (const [f, w] of fine) a += f(u, v) * w;
      for (const [f, w] of broad) b += f(u, v) * w;
      h[i] = a;
      m[i] = b;
      hMin = Math.min(hMin, a); hMax = Math.max(hMax, a);
      mMin = Math.min(mMin, b); mMax = Math.max(mMax, b);
    }
  }
  const sx = new Float32Array(N * N), sy = new Float32Array(N * N);
  let smax = 1e-6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      sx[i] = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * 0.5;
      sy[i] = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * 0.5;
      smax = Math.max(smax, Math.abs(sx[i]), Math.abs(sy[i]));
    }
  }
  // Slopes are scaled to fill the byte range at about the 99th percentile, not the single steepest texel.
  smax *= 0.7;
  const data = new Uint8Array(N * N * 4);
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = byte(0.5 + 0.5 * sx[i] / smax);
    data[i * 4 + 1] = byte(0.5 + 0.5 * sy[i] / smax);
    // Broad mask stretched to the full range, so thresholds in the shaders mean the same everywhere.
    const mb = (m[i] - mMin) / (mMax - mMin);
    data[i * 4 + 2] = byte(mb * mb * (3 - 2 * mb));
    data[i * 4 + 3] = byte((h[i] - hMin) / (hMax - hMin));
  }
  const tex = detailTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  SURF.uDetail.value = tex;
  return tex;
}

/**
 * What each cell of a KayKit colour-gradient atlas (8 x 4 cells) is made of, row by row from the top:
 * S stone, W wood, M metal, C cloth and the rest (wax, bone, glass, leaves); then roughness, metalness and
 * how strong the fine relief is. The kits ship one glossy material for everything (roughness 0.45-0.5),
 * which reads as plastic.
 */
const KIT_CELLS = {
  dungeon: [
    ['M', 0.5, 0.7, 0.5], ['M', 0.32, 0.9, 0.4], ['W', 0.72, 0, 1], ['M', 0.55, 0.6, 0.5], ['W', 0.75, 0, 1], ['S', 0.86, 0, 1], ['W', 0.7, 0, 0.8], ['W', 0.78, 0, 1],
    ['C', 0.55, 0, 0.3], ['W', 0.72, 0, 1], ['S', 0.82, 0, 1], ['C', 0.92, 0, 0.6], ['C', 0.92, 0, 0.6], ['C', 0.22, 0, 0.15], ['C', 0.22, 0, 0.15], ['C', 0.85, 0, 0.5],
    ['C', 0.22, 0, 0.15], ['C', 0.22, 0, 0.15], ['C', 0.92, 0, 0.6], ['C', 0.92, 0, 0.6], ['C', 0.85, 0, 0.5], ['M', 0.3, 1, 0.3], ['C', 0.4, 0, 0.3], ['M', 0.35, 0.9, 0.3],
    ['C', 0.6, 0, 0.4], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1], ['S', 0.86, 0, 1],
  ],
  village: [
    ['M', 0.5, 0.6, 0.4], ['S', 0.9, 0, 0.8], ['S', 0.82, 0, 1], ['S', 0.8, 0, 1], ['M', 0.5, 0.6, 0.4], ['W', 0.75, 0, 1], ['W', 0.75, 0, 1], ['S', 0.75, 0, 1],
    ['C', 0.85, 0, 0.5], ['C', 0.85, 0, 0.5], ['W', 0.75, 0, 1], ['W', 0.82, 0, 1], ['C', 0.85, 0, 0.6], ['W', 0.72, 0, 1], ['S', 0.86, 0, 1], ['W', 0.78, 0, 1],
    ['C', 0.85, 0, 0.6], ['C', 0.8, 0, 0.6], ['M', 0.45, 0.6, 0.4], ['W', 0.72, 0, 1], ['W', 0.72, 0, 1], ['S', 0.9, 0, 0.8], ['C', 0.85, 0, 0.5], ['S', 0.75, 0, 1],
    ['C', 0.85, 0, 0.5], ['C', 0.85, 0, 0.5], ['C', 0.85, 0, 0.5], ['C', 0.85, 0, 0.6], ['C', 0.85, 0, 0.5], ['S', 0.86, 0, 1], ['W', 0.75, 0, 1], ['W', 0.78, 0, 1],
  ],
  // Whole materials of one kind (the procedural props and the wall dressing): a single cell.
  stone: [['S', 0.86, 0, 1]],
  wood: [['W', 0.8, 0, 1]],
  iron: [['M', 0.45, 0.75, 0.5]],
};
const KIND = { S: 0, W: 1, M: 2, C: 3 };
const cellTextures = {};

/** The cell table of a kit as an 8 x 4 (or 1 x 1) texture: roughness, metalness, kind / 3, relief strength. */
function cellTexture(kit) {
  if (cellTextures[kit]) return cellTextures[kit];
  const cells = KIT_CELLS[kit], one = cells.length === 1;
  const data = new Uint8Array(cells.length * 4);
  cells.forEach(([k, r, m, s], i) => data.set([r * 255, m * 255, KIND[k] * 85, s * 255], i * 4));
  const tex = cellTextures[kit] = new THREE.DataTexture(data, one ? 1 : 8, one ? 1 : 4, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Kit props (a material on one of the colour-gradient atlases): per atlas cell roughness and metalness,
 * and fine relief from world space: grain running along wood, a fine tooth on stone, faint brushing on
 * metal, a soft weave on cloth. At the low preset (setKitDetail) the roughness and metal stay, the relief
 * goes. One program for every kit (the table is a uniform).
 */
export function kitSurface(mat, kit) {
  if (!KIT_CELLS[kit]) return mat;
  const cells = cellTexture(kit);
  const base = mat.onBeforeCompile, baseKey = mat.customProgramCacheKey;
  const custom = base !== THREE.Material.prototype.onBeforeCompile;
  // Without a colour map the whole material is the table's one cell.
  const key = (custom ? baseKey.call(mat) : '') + (mat.map ? '' : '-nomap');
  kitMaterials.add(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    const detail = kitDetail;
    const uv = mat.map ? 'vMapUv' : 'vec2(0.5)';
    if (custom) base.call(mat, shader, renderer);
    surfUniforms(shader);
    shader.uniforms.uKitCells = { value: cells };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitWp, vKitWn;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 kp = vec4(transformed, 1.0);
    vec3 kn = objectNormal;
    #ifdef USE_INSTANCING
      kp = instanceMatrix * kp;
      kn = mat3(instanceMatrix) * kn;
    #endif
    vKitWp = (modelMatrix * kp).xyz;
    vKitWn = mat3(modelMatrix) * kn;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vKitWp, vKitWn;
uniform sampler2D uKitCells;
${SURF_GLSL}
float kitRough = 0.8, kitMetal = 0.0;
vec2 kitSlope = vec2(0.0);
vec3 kitAx, kitAy;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec4 cell = texture2D(uKitCells, ${uv});
    float kind = floor(cell.b * 3.0 + 0.5);
    vec3 wn = normalize(vKitWn);
    vec2 p;
    float edge = surfPlane(vKitWp, wn, p, kitAx, kitAy);
    // Wood grain runs up the sides and along x on tops; the other kinds are isotropic at their own scale.
    vec2 aniso = kind == 1.0 ? (abs(wn.y) > 0.7 ? vec2(0.12, 2.0) : vec2(2.0, 0.12)) : vec2(1.0);
    float scale = kind == 0.0 ? 1.1 : kind == 2.0 ? 2.4 : kind == 3.0 ? 3.0 : 1.4;
#ifdef SURF_DETAIL
    vec4 fd = surfFine(p * scale * aniso);
    kitSlope = fd.xy * aniso / max(aniso.x, aniso.y) * cell.a * edge * (kind == 2.0 ? 0.25 : 0.7);
#else
    vec4 fd = vec4(0.0, 0.0, texture2D(uDetail, p * scale * aniso).a, 0.5);
#endif
    float grain = kind == 1.0 ? 1.3 : kind == 0.0 ? 0.6 : 0.25;
    diffuseColor.rgb *= 1.0 + (fd.z - 0.5) * grain * cell.a;
    kitRough = clamp(cell.r + (fd.z - 0.5) * 0.25 + (fd.w - 0.5) * 0.15, 0.08, 1.0);
    kitMetal = cell.g;
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = kitRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = kitMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef SURF_DETAIL
  normal = surfTilt(normal, kitSlope, kitAx, kitAy);
#endif`);
    if (detail) shader.fragmentShader = '#define SURF_DETAIL\n' + shader.fragmentShader;
  };
  mat.customProgramCacheKey = () => key + (kitDetail ? '-kit-detail' : '-kit');
  mat.needsUpdate = true;
  return mat;
}

let kitDetail = true;
const kitMaterials = new Set();

/** Fine relief on the kit props or not (off at the low preset); recompiles them when it changes. */
export function setKitDetail(on) {
  if (on === kitDetail) return;
  kitDetail = on;
  for (const m of kitMaterials) m.needsUpdate = true;
}

/** Hooks the shared uniforms into a shader (call from onBeforeCompile). */
export function surfUniforms(shader) {
  detailTexture();
  shader.uniforms.uDetail = SURF.uDetail;
  shader.uniforms.uSurfTime = SURF.uSurfTime;
  shader.uniforms.uRain = SURF.uRain;
}

/**
 * GLSL helpers (fragment, after <common>):
 *   surfFine(p)   fine relief at world-plane point p: xy slope, z height (0..1), w broad mask; two scales
 *                 rotated against each other, so the pattern never visibly repeats;
 *   surfTilt(n, s, ax, ay)  tilts a view-space normal by slope s along the world axes ax, ay;
 *   surfPlane(wp, wn, out p, out ax, out ay)  the world plane a face mostly lies in (dominant axis of
 *                 its world normal) and how strongly it is that axis (0 at a 45 degree edge, for fading).
 */
export const SURF_GLSL = /* glsl */`
uniform sampler2D uDetail;
uniform float uSurfTime, uRain;
vec4 surfFine(vec2 p) {
  vec4 a = texture(uDetail, p);
  vec2 q = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.37 + 0.31;
  vec4 b = texture(uDetail, q);
  vec2 sb = b.rg - 0.5;
  // b's slope back into p's frame (transpose of the rotation), scaled by its frequency.
  sb = vec2(0.8 * sb.x + 0.6 * sb.y, -0.6 * sb.x + 0.8 * sb.y) * 1.6;
  return vec4((a.rg - 0.5) + sb * 0.55, a.a * 0.6 + b.a * 0.4, a.b);
}
vec3 surfTilt(vec3 n, vec2 s, vec3 ax, vec3 ay) {
  vec3 vx = (viewMatrix * vec4(ax, 0.0)).xyz, vy = (viewMatrix * vec4(ay, 0.0)).xyz;
  return normalize(n - s.x * vx - s.y * vy);
}
float surfPlane(vec3 wp, vec3 wn, out vec2 p, out vec3 ax, out vec3 ay) {
  vec3 an = abs(wn);
  float m = max(an.x, max(an.y, an.z));
  if (an.y >= m) { p = wp.xz; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
  else if (an.x >= m) { p = vec2(wp.z, wp.y); ax = vec3(0.0, 0.0, 1.0); ay = vec3(0.0, 1.0, 0.0); }
  else { p = wp.xy; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 1.0, 0.0); }
  float second = an.x + an.y + an.z - m - min(an.x, min(an.y, an.z));
  return smoothstep(0.0, 0.18, m - second);
}
`;
