import * as THREE from 'three';
import { TILE } from './defs.js';
import { SURF_GLSL, surfUniforms } from './surface.js';

/** GLSL value noise shared by the ground and water shaders. */
export const NOISE_GLSL = /* glsl */`
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** Height of the lake surfaces; the ground dips below it in the basins. */
const WATER_Y = -0.17;
/** Splat weight texels per tile by quality: the ground's material blend is baked at this density. */
const SPLAT_RES = { high: 8, medium: 6, low: 4 };
/** Height-field cells per side of a ground chunk; a chunk that stays flat is drawn with a few triangles. */
const CHUNK = 8;

/** The ground built last, so makeWater can fit the lakes to it when not handed one. */
let lastGround = null;

/**
 * Two independent smooth value noises over [0, w] x [0, h] at `freq` lattice cells per unit, from a seeded
 * lattice. The returned function writes both into `out` at a point (x, y >= 0).
 */
function latticeNoise2(freq, seed, w, h, out) {
  const nx = Math.ceil(w * freq) + 2, ny = Math.ceil(h * freq) + 2;
  const v = new Float32Array(nx * ny * 2);
  let s = seed >>> 0;
  for (let i = 0; i < v.length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    v[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const row = nx * 2;
  return (x, y) => {
    x = Math.min(nx - 1.001, x * freq);
    y = Math.min(ny - 1.001, y * freq);
    const ix = x | 0, iy = y | 0;
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    for (let c = 0, o = (iy * nx + ix) * 2; c < 2; c++, o++) {
      const a = v[o] + (v[o + 2] - v[o]) * fx, b = v[o + row] + (v[o + row + 2] - v[o + row]) * fx;
      out[c] = a + (b - a) * fy;
    }
  };
}

/** Indexed geometry from flat position / normal arrays (and any extra float attributes). */
function meshGeometry(pos, idx, attrs = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const [name, [data, size]] of Object.entries(attrs)) geo.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  geo.setIndex(idx);
  return geo;
}

/**
 * The walkable ground: a height field (lakes dip into basins, the rest stays almost flat for the game's
 * flat physics) drawn with a splat shader that blends material textures by height, like the 2D baker.
 */
export class Ground {
  constructor(level, layers, opts) {
    this.level = level;
    this.w = level.w;
    this.h = level.h;
    this.res = 2; // height samples per tile
    this.layers = layers;
    this.opts = opts;
    this.heights = this.computeHeights();
  }

  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TILE.WALL;
    return this.level.tiles.charCodeAt(y * this.w + x) - 48;
  }

  computeHeights() {
    const { w, h, res } = this;
    const gw = w * res + 1, gh = h * res + 1;
    const water = new Float32Array(gw * gh);
    // Water fraction around each sample, blurred so shores slope gently.
    const r = 1.4;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x = gx / res, y = gy / res;
        let sum = 0, n = 0;
        for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++) {
          for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
            const dx = tx + 0.5 - x, dy = ty + 0.5 - y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r * r) continue;
            const wgt = 1 - d2 / (r * r);
            sum += (this.tile(tx, ty) === TILE.WATER ? 1 : 0) * wgt;
            n += wgt;
          }
        }
        water[gy * gw + gx] = n > 0 ? sum / n : 0;
      }
    }
    const heights = new Float32Array(gw * gh);
    // opts.relief(x, y) raises the land (the desert's dunes), easing off around the lakes.
    const relief = this.opts && this.opts.relief;
    for (let i = 0; i < gw * gh; i++) {
      const k = Math.min(1, Math.max(0, (water[i] - 0.25) / 0.6));
      heights[i] = -0.62 * k * k * (3 - 2 * k);
      if (relief) heights[i] += relief((i % gw) / res, Math.floor(i / gw) / res) * Math.max(0, 1 - water[i] * 3);
    }
    this.gw = gw;
    this.gh = gh;
    return heights;
  }

  /** Ground height at a point in tiles (bilinear over the height field). */
  heightAt(x, y) {
    const { res, gw, gh } = this;
    const fx = Math.min(gw - 1.001, Math.max(0, x * res));
    const fy = Math.min(gh - 1.001, Math.max(0, y * res));
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const h = this.heights;
    const a = h[iy * gw + ix], b = h[iy * gw + ix + 1], c = h[(iy + 1) * gw + ix], d = h[(iy + 1) * gw + ix + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }

  /**
   * Bakes the splat blend, k texels per tile, into two RGBA textures the shader samples bilinearly. Each
   * texel holds, per layer, the largest bilinear weight among the four tiles around a noise-warped point
   * that use it (layers 0-3 in the first texture, 4-6 in the second), so the shader no longer warps and
   * looks up the tile corners itself. The second texture's alpha holds the macro brightness variation.
   */
  splatTextures(count, waterLayer, k, nearWall = false) {
    const { w, h } = this;
    const mat = this.level.mat;
    const layer = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const m = mat.charCodeAt(i) - 48;
      layer[i] = Math.min(6, m >= count ? waterLayer : m);
    }
    // Tiles whose 5 x 5 neighbourhood is one layer: no warp reaches another there, so skip the noise.
    const solid = new Int8Array(w * h).fill(-1);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const l = layer[ty * w + tx];
        let same = true;
        for (let y = Math.max(0, ty - 2); same && y <= Math.min(h - 1, ty + 2); y++) {
          for (let x = Math.max(0, tx - 2); x <= Math.min(w - 1, tx + 2); x++) if (layer[y * w + x] !== l) { same = false; break; }
        }
        if (same) solid[ty * w + tx] = l;
      }
    }
    const seed = this.level.seed | 0;
    const warp = new Float32Array(2), fine = new Float32Array(2), macro = new Float32Array(2);
    const warpAt = latticeNoise2(1.7, seed + 1, w, h, warp), fineAt = latticeNoise2(4.1, seed + 2, w, h, fine);
    // Macro variation on a half-tile grid, two octaves (the second a sample of the same lattice further
    // out), faded out at the edges so the apron beyond does not streak.
    const macroAt = latticeNoise2(0.37, seed + 3, w, h, macro);
    const mw = w * 2 + 1, mh = h * 2 + 1, mg = new Float32Array(mw * mh);
    for (let gy = 0; gy < mh; gy++) {
      for (let gx = 0; gx < mw; gx++) {
        const x = gx / 2, y = gy / 2;
        macroAt(x, y);
        const m = macro[0];
        macroAt(x * 0.35 + 3.1, y * 0.35 + 5.7);
        mg[gy * mw + gx] = 0.5 + ((macro[1] + m * 0.5) / 1.5 - 0.5) * Math.min(1, Math.min(x, y, w - x, h - y) / 3);
      }
    }
    const W = w * k, H = h * k, half = W * H * 4;
    // Both textures in one buffer; each layer's byte offset within a texel.
    const data = new Uint8Array(half * 2), off = [0, 1, 2, 3, half, half + 1, half + 2];
    const put = (o, l, v) => {
      const q = (v * 255 + 0.5) | 0, p = o + off[l];
      if (q > data[p]) data[p] = q;
    };
    for (let j = 0; j < H; j++) {
      const y = (j + 0.5) / k;
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / k, o = (j * W + i) * 4;
        const sl = solid[(y | 0) * w + (x | 0)];
        if (sl >= 0) {
          data[o + off[sl]] = 255;
        } else {
          warpAt(x, y);
          fineAt(x, y);
          const sx = x + (warp[0] - 0.5 + (fine[0] - 0.5) * 0.4) * 0.75 - 0.5;
          const sy = y + (warp[1] - 0.5 + (fine[1] - 0.5) * 0.4) * 0.75 - 0.5;
          const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
          const x0 = Math.min(w - 1, Math.max(0, ix)), x1 = Math.min(w - 1, Math.max(0, ix + 1));
          const y0 = Math.min(h - 1, Math.max(0, iy)) * w, y1 = Math.min(h - 1, Math.max(0, iy + 1)) * w;
          put(o, layer[y0 + x0], (1 - fx) * (1 - fy));
          put(o, layer[y0 + x1], fx * (1 - fy));
          put(o, layer[y1 + x0], (1 - fx) * fy);
          put(o, layer[y1 + x1], fx * fy);
        }
        if (nearWall) {
          // Underground (four layers, so the second texture's colour channels are free): how close the
          // nearest wall face is, wobbled by the fine noise, for the dust and grime gathered at the walls.
          fineAt(x * 1.7, y * 1.7);
          let d = 9;
          const tx = x | 0, ty = y | 0;
          for (let yy = ty - 1; yy <= ty + 1; yy++) {
            for (let xx = tx - 1; xx <= tx + 1; xx++) {
              if (this.tile(xx, yy) !== TILE.WALL) continue;
              const dx = Math.max(xx - x, 0, x - xx - 1), dy = Math.max(yy - y, 0, y - yy - 1);
              d = Math.min(d, Math.hypot(dx, dy));
            }
          }
          const t = Math.min(1, Math.max(0, d / (0.16 + 0.3 * fine[0])));
          data[half + o] = (1 - t * t * (3 - 2 * t)) * 255 + 0.5;
        }
        const mx = x * 2, my = y * 2, mi = (my | 0) * mw + (mx | 0), fx = mx - (mx | 0), fy = my - (my | 0);
        const ma = mg[mi] + (mg[mi + 1] - mg[mi]) * fx, mb = mg[mi + mw] + (mg[mi + mw + 1] - mg[mi + mw]) * fx;
        data[half + o + 3] = (ma + (mb - ma) * fy) * 255 + 0.5;
      }
    }
    return [data.subarray(0, half), data.subarray(half)].map((d) => {
      const tex = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    });
  }

  /**
   * Standard PBR material with the splat blend injected in place of the colour map and a height bump.
   * extra.quality ('high', 'medium', 'low' or a preset with that name) sets the splat bake density;
   * low also drops the bump.
   */
  material(extra = {}) {
    const quality = (extra.quality && extra.quality.name) || extra.quality || 'high';
    const bump = quality !== 'low';
    // extra.desert: the sand's uniforms (see desert.js SAND): wind-blown drift, wet sand on the shore,
    // caustics on the pool bed and, at the high preset, heat shimmer over the far sand.
    const desert = extra.desert || null;
    // extra.surface (not with desert): the stone underground ({ wet, dust, lava }) or the open world
    // ({ open: true }): fine relief, cavities, roughness, damp, puddles, grime, rain and glowing lava.
    const surf = desert ? null : extra.surface || null;
    const dungeon = !!(surf && !surf.open);
    const [splat0, splat1] = this.splatTextures(extra.count || 7, extra.waterLayer ?? 4, SPLAT_RES[quality] || SPLAT_RES.high, dungeon);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
    const uniforms = {
      uSplat0: { value: splat0 },
      uSplat1: { value: splat1 },
      uLayers: { value: this.layers },
      uSize: { value: new THREE.Vector2(this.w, this.h) },
      uTexScale: { value: extra.texScale || 4.0 },
      uHeightBlend: { value: 0.6 },
      uBump: { value: extra.bump ?? 1.6 },
      uMacro: { value: extra.macro ?? 0.22 },
      uTint: { value: new THREE.Color(extra.tint ?? 0xffffff) },
    };
    if (desert) {
      Object.assign(uniforms, desert);
      mat.defines = { DESERT: '' };
      if (quality === 'high') mat.defines.SHIMMER = '';
    }
    let surfKey = '';
    if (surf) {
      mat.defines = { SURF: '' };
      if (bump) mat.defines.SURF_DETAIL = '';
      if (dungeon) {
        mat.defines.DUNGEON = '';
        if (surf.lava) mat.defines.LAVA = '';
        uniforms.uWet = { value: surf.wet || 0 };
        uniforms.uDust = { value: new THREE.Color(surf.dust ?? 0x3a342c) };
        uniforms.uDustAmt = { value: surf.dustAmt ?? 0.4 };
      } else {
        mat.defines.OPEN = '';
      }
      surfKey = '-' + Object.keys(mat.defines).join('-').toLowerCase();
    }
    mat.userData.uniforms = uniforms;
    const key = (bump ? 'ground-bump' : 'ground') + (desert ? '-desert-' + quality : '') + surfKey;
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (surf) surfUniforms(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vGroundPos;
uniform sampler2D uSplat0, uSplat1;
uniform highp sampler2DArray uLayers;
uniform vec2 uSize;
uniform float uTexScale, uHeightBlend, uBump, uMacro;
uniform vec3 uTint;
float splatH = 0.0, groundWet = 0.0, groundBumpK = 1.0;
#ifdef SURF
${SURF_GLSL}
// Set with the colour, used by the roughness, the normal and the glow.
float groundRough = 0.9, groundPuddle = 0.0, groundRelief = 1.0;
vec4 groundFine = vec4(0.0);
vec3 groundGlow = vec3(0.0);
#endif
#ifdef DUNGEON
uniform float uWet, uDustAmt;
uniform vec3 uDust;
// The hot orange of the lava seams painted in the hell floor (linear colour).
float lavaMask(vec3 c) { return smoothstep(0.1, 0.42, c.r) * smoothstep(0.02, 0.1, c.g) * (1.0 - smoothstep(0.25, 0.5, c.b)); }
#endif
#ifdef DESERT
uniform sampler2D uNoise;
uniform vec2 uWind;
uniform float uTime, uDay;
#endif
// Keeps the two strongest layers as (weight, layer, weight, layer).
void splatPick(inout vec4 best, float w, float layer) {
  if (w > best.x) best = vec4(w, layer, best.xy);
  else if (w > best.z) best.zw = vec2(w, layer);
}
`)
        .replace('#include <map_fragment>', `
{
  vec2 tp = vGroundPos.xz;
  vec4 w0 = texture(uSplat0, tp / uSize), w1 = texture(uSplat1, tp / uSize);
  vec4 best = vec4(w0.x, 0.0, -1.0, 0.0);
  splatPick(best, w0.y, 1.0);
  splatPick(best, w0.z, 2.0);
  splatPick(best, w0.w, 3.0);
#ifndef DUNGEON
  splatPick(best, w1.x, 4.0);
  splatPick(best, w1.y, 5.0);
  splatPick(best, w1.z, 6.0);
#endif
  vec2 uv = tp / uTexScale;
#ifdef SHIMMER
  // Heat shimmer: the far sand wavers in the rising air.
  float far = smoothstep(16.0, 42.0, distance(vGroundPos.xz, cameraPosition.xz));
  uv += (texture(uNoise, tp * 0.07 + vec2(0.0, uTime * 0.21)).rg - 0.5) * 0.05 * far * uDay;
#endif
#ifdef DESERT
  // The sand's texture bends over the land, so its ripples sweep in long curves instead of repeating
  // every 4 m; paving and the rest stay straight.
  vec2 uvSand = uv + (texture(uNoise, tp * 0.019).rg - 0.5) * 0.9;
  vec4 c1 = texture(uLayers, vec3(best.y < 1.5 ? uvSand : uv, best.y)), c2 = texture(uLayers, vec3(best.w < 1.5 ? uvSand : uv, best.w));
#else
  vec4 c1 = texture(uLayers, vec3(uv, best.y)), c2 = texture(uLayers, vec3(uv, best.w));
#endif
  // Height blend: the higher texture wins near the seam; the second layer's height counts only where it is present.
  float s1 = best.x + c1.a * uHeightBlend;
  float s2 = best.z + c2.a * uHeightBlend * min(best.z * 16.0, 1.0);
  float top = max(s1, s2) - 0.1;
  float b1 = max(s1 - top, 0.0), b2 = max(s2 - top, 0.0);
  vec4 col = (c1 * b1 + c2 * b2) / (b1 + b2);
  splatH = col.a;
#ifdef DESERT
  // Drift: pale streaks of sand running over the dunes with the wind, by day.
  float sandy = ((best.y < 1.5 ? b1 : 0.0) + (best.w < 1.5 ? b2 : 0.0)) / (b1 + b2);
  float wl = length(uWind);
  vec2 wd = uWind / max(wl, 1e-3);
  vec2 q = vec2(dot(tp, wd), dot(tp, vec2(-wd.y, wd.x)));
  float dr = texture(uNoise, vec2(q.x * 0.045 - uTime * 0.05 * wl, q.y * 0.4)).r * 0.6
    + texture(uNoise, vec2(q.x * 0.1 - uTime * 0.12 * wl, q.y * 0.85 + 0.3)).g * 0.4;
  col.rgb *= 1.0 + smoothstep(0.56, 0.78, dr) * sandy * uDay * 0.1;
  // Wet sand on the shore above the water line, dark and glossy; light rippling over the pool bed.
  float wet = 1.0 - smoothstep(-0.22, -0.02, vGroundPos.y);
  float under = smoothstep(-0.2, -0.32, vGroundPos.y);
  if (under > 0.0) {
    float ca = texture(uNoise, tp * 0.31 + uTime * vec2(0.021, 0.013)).b, cb = texture(uNoise, tp * 0.37 - uTime * vec2(0.017, -0.024)).b;
    col.rgb *= 1.0 + pow(1.0 - abs(ca - cb), 12.0) * 1.6 * under * (0.3 + 0.7 * uDay);
  }
  groundWet = wet;
  diffuseColor.rgb *= col.rgb * (1.0 + (w1.w * 1.5 - 0.75) * uMacro) * (1.0 - 0.42 * wet) * uTint;
#else
  // Darker where wet: lake shores just above the water line and the beds below it.
  float wet = 1.0 - smoothstep(-0.2, -0.09, vGroundPos.y);
#ifdef SURF
  // Cavities: how far below its blurred surroundings the winning texture's height lies (mortar joints,
  // cracks, the gaps between cobbles), for occlusion, grime and where water gathers.
  float hBlur = texture(uLayers, vec3(uv, best.y), 4.0).a;
  float cav = clamp((hBlur - splatH) * 3.2, 0.0, 1.0);
  float luma = dot(col.rgb, vec3(0.3, 0.59, 0.11));
#ifdef SURF_DETAIL
  groundFine = surfFine(tp * 0.5);
#else
  groundFine = vec4(0.0, 0.0, texture(uDetail, tp * 0.5).a, 0.5);
#endif
  float broad = texture(uDetail, tp * 0.085 + 0.37).b;
#endif
#ifdef DUNGEON
  // Damp: the damp floor layer (3), the joints and the feet of the walls (seeping water) are wetter, and
  // shallow puddles lie in broad hollows. Along the walls dust and grime gather: wet silt in damp
  // biomes, dry dust and ash in the others.
  float nearWall = w1.r;
  float dampL = ((best.y > 2.5 ? b1 : 0.0) + (best.w > 2.5 ? b2 : 0.0)) / (b1 + b2);
  float pudT = 0.7 - 0.14 * uWet;
  float pud = step(0.01, uWet) * smoothstep(pudT, pudT + 0.07, broad + cav * 0.12 + dampL * 0.12 - nearWall * 0.2 + (0.5 - groundFine.z) * 0.06);
  float damp = clamp(uWet * (0.12 + 0.5 * dampL + 0.45 * cav + 0.3 * smoothstep(0.45, 0.66, broad) + 0.5 * nearWall) + pud, 0.0, 1.0);
  col.rgb *= 1.0 - 0.42 * cav;
  // Wet stone: darker and a touch more saturated; under a puddle's film a little darker still.
  col.rgb = mix(vec3(luma), col.rgb, 1.0 + 0.3 * damp) * (1.0 - 0.26 * damp - 0.06 * pud);
  float grime = nearWall * uDustAmt * (0.6 + 0.8 * groundFine.w);
  col.rgb = mix(col.rgb, uDust * (0.75 + 0.5 * groundFine.z), clamp(grime, 0.0, 0.85));
  groundRough = 0.74 + (groundFine.z - 0.5) * 0.3 + cav * 0.14;
  groundRough = mix(groundRough, 0.4, damp);
  groundRough = mix(groundRough, 0.2, pud);
  groundRough = mix(groundRough, mix(0.95, 0.42, uWet), clamp(grime * 1.4, 0.0, 1.0));
  groundPuddle = pud;
  // Water fills the pores, dust buries the grain: both smooth the fine relief.
  groundRelief = (1.0 - 0.7 * grime) * (1.0 - 0.45 * damp);
  groundBumpK = (1.0 - 0.7 * grime) * (1.0 - 0.8 * pud);
#ifdef LAVA
  // Hell: the seams of lava painted in the floor burn and pulse, slowly flowing; the stone beside them is
  // scorched dark and glows dull red with the heat (from a blurred look at the same texture).
  vec3 cBlur = texture(uLayers, vec3(uv, best.y), 3.5).rgb;
  float lavaC = lavaMask(col.rgb / max(1.0 - 0.42 * cav, 0.2));
  float lavaB = lavaMask(cBlur * 1.6);
  float flow = texture(uDetail, tp * 0.11 + vec2(uSurfTime * 0.013, -uSurfTime * 0.009)).b;
  float pulse = 0.72 + 0.28 * sin(uSurfTime * 1.9 + flow * 10.0 + broad * 6.0);
  vec3 lavaCol = col.rgb / max(1.0 - 0.42 * cav, 0.2);
  groundGlow = lavaCol * vec3(1.0, 0.62, 0.5) * lavaC * (0.9 * pulse + 0.8 * flow) + vec3(0.8, 0.13, 0.02) * lavaB * lavaB * (1.0 - lavaC) * 0.5 * pulse;
  col.rgb = mix(col.rgb, lavaCol, lavaC);
  col.rgb *= 1.0 - 0.45 * lavaB * (1.0 - lavaC);
  groundRough = mix(mix(0.8 + (groundFine.z - 0.5) * 0.25, 0.4, smoothstep(0.012, 0.004, luma) * (1.0 - lavaB)), 0.95, lavaC);
  groundRelief *= 1.0 - lavaC;
  groundBumpK *= 1.0 - lavaC;
#endif
#endif
#ifdef OPEN
  // What the two winning layers are: plants (grass, dry grass, forest floor), earth (dirt, mud), cobbles.
  float k1 = b1 / (b1 + b2), k2 = 1.0 - k1;
  float plant = (best.y < 2.5 ? k1 : 0.0) + (best.w < 2.5 ? k2 : 0.0);
  float cobble = (best.y == 5.0 ? k1 : 0.0) + (best.w == 5.0 ? k2 : 0.0);
  float mud = (best.y == 6.0 ? k1 : 0.0) + (best.w == 6.0 ? k2 : 0.0);
  float earth = (best.y == 3.0 ? k1 : 0.0) + (best.w == 3.0 ? k2 : 0.0) + mud;
  col.rgb *= 1.0 - (0.22 + 0.2 * cobble) * cav;
  // Worn edges: where a path meets the grass, the grass is trampled thin, dry and dusty.
  float worn = clamp(plant * (1.0 - plant) * 4.0, 0.0, 1.0) * (0.6 + 0.8 * groundFine.w);
  col.rgb = mix(col.rgb, vec3(luma) * vec3(1.12, 1.0, 0.72), worn * 0.35);
  // Dry roughness: plants and dust matte, cobble tops polished by feet, mud always a little damp.
  groundRough = 0.94 - 0.2 * cobble * smoothstep(0.45, 0.85, splatH) - 0.3 * mud + (groundFine.z - 0.5) * 0.14;
  groundRelief = mix(0.35, 1.0, 1.0 - plant) * (1.0 - 0.4 * mud);
  // Rain: everything darkens and turns glossy (paving and earth most), and water stands in the hollows of
  // the paths: between cobbles, in ruts and low mud, never on the grass.
  float soak = uRain * (0.55 + 0.45 * (1.0 - plant));
  float pud = smoothstep(0.6, 0.68, broad * 0.75 + cav * (0.3 * cobble + 0.2 * earth) + mud * 0.25 + (0.5 - groundFine.z) * 0.1 - plant * 0.6 + 0.16)
    * smoothstep(0.2, 0.7, uRain);
  col.rgb = mix(vec3(luma), col.rgb, 1.0 + 0.25 * soak) * (1.0 - 0.38 * soak * (1.0 - 0.4 * plant) - 0.1 * pud);
  groundRough = mix(groundRough, mix(0.38, 0.6, plant), soak);
  groundRough = mix(groundRough, 0.04, pud);
  groundRough = mix(groundRough, 0.3, wet);
  groundPuddle = pud;
  groundBumpK = 1.0 - 0.85 * pud;
#endif
  diffuseColor.rgb *= col.rgb * (1.0 + (w1.w * 1.5 - 0.75) * uMacro) * (1.0 - 0.3 * wet) * uTint;
#endif
}
`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.32, groundWet);
#if defined(DUNGEON) || defined(OPEN)
  roughnessFactor = groundRough;
#endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef SURF
  totalEmissiveRadiance += groundGlow;
#endif`);
      if (bump) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
{
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(splatH), dhdy = dFdy(splatH);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  normal = normalize(abs(det) * normal - grad * uBump * 0.02 * groundBumpK);
#ifdef SURF_DETAIL
  // Fine relief over the textures (world space, so it never repeats with them); puddles lie flat.
  normal = surfTilt(normal, groundFine.xy * 0.55 * groundRelief * (1.0 - groundPuddle), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0));
  normal = normalize(mix(normal, normalize(vNormal), groundPuddle));
#endif
}
`);
      }
    };
    return mat;
  }

  /**
   * The height field as a mesh: full resolution in chunks where it bends, flat chunks as two triangles,
   * or a fan whose sides follow the vertices of bent neighbours so no T-junction cracks open between them.
   */
  geometry() {
    const { w, h, res, gw, gh, heights } = this;
    const cw = w * res, ch = h * res;
    const nx = Math.ceil(cw / CHUNK), ny = Math.ceil(ch / CHUNK);
    const flat = new Uint8Array(nx * ny);
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        let f = 1;
        for (let gy = cy * CHUNK; f && gy <= Math.min(ch, cy * CHUNK + CHUNK); gy++) {
          for (let gx = cx * CHUNK; gx <= Math.min(cw, cx * CHUNK + CHUNK); gx++) {
            if (heights[gy * gw + gx] !== 0) { f = 0; break; }
          }
        }
        flat[cy * nx + cx] = f;
      }
    }
    const pos = [], nor = [], idx = [];
    const ids = new Int32Array(gw * gh).fill(-1);
    const vert = (gx, gy) => {
      const i = gy * gw + gx;
      if (ids[i] < 0) {
        ids[i] = pos.length / 3;
        pos.push(gx / res, heights[i], gy / res);
        const sx = (heights[gy * gw + Math.max(0, gx - 1)] - heights[gy * gw + Math.min(gw - 1, gx + 1)]) * res / 2;
        const sz = (heights[Math.max(0, gy - 1) * gw + gx] - heights[Math.min(gh - 1, gy + 1) * gw + gx]) * res / 2;
        const l = Math.hypot(sx, 1, sz);
        nor.push(sx / l, 1 / l, sz / l);
      }
      return ids[i];
    };
    const bent = (cx, cy) => cx >= 0 && cy >= 0 && cx < nx && cy < ny && !flat[cy * nx + cx];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const x0 = cx * CHUNK, x1 = Math.min(cw, x0 + CHUNK), y0 = cy * CHUNK, y1 = Math.min(ch, y0 + CHUNK);
        if (!flat[cy * nx + cx]) {
          for (let gy = y0; gy < y1; gy++) {
            for (let gx = x0; gx < x1; gx++) {
              const a = vert(gx, gy), b = vert(gx, gy + 1), c = vert(gx + 1, gy + 1), d = vert(gx + 1, gy);
              idx.push(a, b, d, b, c, d);
            }
          }
          continue;
        }
        const left = bent(cx - 1, cy), down = bent(cx, cy + 1), right = bent(cx + 1, cy), up = bent(cx, cy - 1);
        if (!left && !down && !right && !up) {
          const a = vert(x0, y0), b = vert(x0, y1), c = vert(x1, y1), d = vert(x1, y0);
          idx.push(a, b, d, b, c, d);
          continue;
        }
        // Counter-clockwise from above, every cell step along sides shared with a bent chunk.
        const ring = [];
        for (let gy = y0; gy < y1; gy += left ? 1 : y1 - y0) ring.push(vert(x0, gy));
        for (let gx = x0; gx < x1; gx += down ? 1 : x1 - x0) ring.push(vert(gx, y1));
        for (let gy = y1; gy > y0; gy -= right ? 1 : y1 - y0) ring.push(vert(x1, gy));
        for (let gx = x1; gx > x0; gx -= up ? 1 : x1 - x0) ring.push(vert(gx, y0));
        const m = pos.length / 3;
        pos.push((x0 + x1) / 2 / res, 0, (y0 + y1) / 2 / res);
        nor.push(0, 1, 0);
        for (let i = 0; i < ring.length; i++) idx.push(m, ring[i], ring[(i + 1) % ring.length]);
      }
    }
    return meshGeometry(pos, idx, { normal: [nor, 3] });
  }

  /** Lake surface: the height-field cells that dip below the water line, each vertex carrying the depth there. */
  waterGeometry() {
    const { res, gw, gh, heights } = this;
    const pos = [], depth = [], idx = [];
    const ids = new Int32Array(gw * gh).fill(-1);
    const vert = (i) => {
      if (ids[i] < 0) {
        ids[i] = depth.length;
        pos.push((i % gw) / res, 0, Math.floor(i / gw) / res);
        depth.push(WATER_Y - heights[i]);
      }
      return ids[i];
    };
    for (let gy = 0; gy < gh - 1; gy++) {
      for (let gx = 0; gx < gw - 1; gx++) {
        const i = gy * gw + gx;
        if (Math.min(heights[i], heights[i + 1], heights[i + gw], heights[i + gw + 1]) >= WATER_Y) continue;
        // Same diagonal as the ground's cells, so the interpolated depth meets the shore exactly.
        const a = vert(i), b = vert(i + gw), c = vert(i + gw + 1), d = vert(i + 1);
        idx.push(a, b, d, b, c, d);
      }
    }
    return meshGeometry(pos, idx, { aDepth: [depth, 1] });
  }

  /** The playable area as a displaced mesh, plus a flat apron around the edges that fades into fog. */
  build(material) {
    const group = new THREE.Group();
    const { w, h } = this;
    const mesh = new THREE.Mesh(this.geometry(), material);
    mesh.receiveShadow = true;
    group.add(mesh);
    if (this.opts.apron) {
      // A frame, not a sheet under the level: it tucks one tile under the border, leaving the lakes open.
      const pad = 70, i = 1, y = -0.015;
      const pos = [-pad, y, -pad, -pad, y, h + pad, w + pad, y, h + pad, w + pad, y, -pad, i, y, i, i, y, h - i, w - i, y, h - i, w - i, y, i];
      const idx = [], nor = [];
      for (let s = 0; s < 4; s++) {
        const o0 = s, o1 = (s + 1) % 4, i0 = s + 4, i1 = (s + 1) % 4 + 4;
        idx.push(o0, o1, i1, o0, i1, i0);
        nor.push(0, 1, 0, 0, 1, 0);
      }
      const apron = new THREE.Mesh(meshGeometry(pos, idx, { normal: [nor, 3] }), material);
      apron.receiveShadow = true;
      group.add(apron);
    }
    this.mesh = mesh;
    lastGround = this;
    return group;
  }
}

let waveTexture = null;

/**
 * A tiling ripple texture, made once: RG hold the slope of a sum of waves with whole-number frequencies
 * (so it wraps), B a value noise that breaks up the shore foam.
 */
function waves() {
  if (waveTexture) return waveTexture;
  const N = 128, TAU = Math.PI * 2;
  let s = 0x2f6b1d;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const list = [];
  while (list.length < 20) {
    const f = 2 + rnd() * 8, a = rnd() * TAU;
    const fx = Math.round(Math.cos(a) * f), fy = Math.round(Math.sin(a) * f);
    if (fx || fy) list.push([fx, fy, Math.pow(Math.hypot(fx, fy), -1.5), rnd() * TAU]);
  }
  const lattice = (n) => Float32Array.from({ length: n * n }, rnd);
  const coarse = lattice(8), fine = lattice(16);
  const noise = (v, n, x, y) => {
    x *= n;
    y *= n;
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => v[(j % n) * n + (i % n)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
  const slope = new Float32Array(N * N * 2);
  let max = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let sx = 0, sy = 0;
      for (const [fx, fy, amp, ph] of list) {
        const c = Math.cos(TAU * (fx * x + fy * y) / N + ph) * amp * TAU;
        sx += c * fx;
        sy += c * fy;
      }
      slope[(y * N + x) * 2] = sx;
      slope[(y * N + x) * 2 + 1] = sy;
      max = Math.max(max, Math.abs(sx), Math.abs(sy));
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const x = (i % N) / N, y = Math.floor(i / N) / N;
    data[i * 4] = 128 + 127 * slope[i * 2] / max;
    data[i * 4 + 1] = 128 + 127 * slope[i * 2 + 1] / max;
    data[i * 4 + 2] = 255 * (noise(coarse, 8, x, y) * 0.65 + noise(fine, 16, x, y) * 0.35);
    data[i * 4 + 3] = 255;
  }
  const tex = waveTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Open water: coloured by depth, sky reflection by fresnel off two drifting ripple layers, the sun's
 * glints and a soft foam line where it meets the shore. One pass, no render targets. Fitted to the
 * ground's basins (the last Ground built unless one is passed), so it only covers the lakes.
 */
export function makeWater(w, h, assets, ground = lastGround, clear = false) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSky: { value: new THREE.Color(0.55, 0.7, 0.9) },
      uHorizon: { value: new THREE.Color(0.8, 0.85, 0.9) },
      // A desert pool (clear) is turquoise over pale sand and see-through much deeper.
      uDeep: { value: clear ? new THREE.Color(0.0, 0.16, 0.2) : new THREE.Color(0.01, 0.045, 0.06) },
      uShallow: { value: clear ? new THREE.Color(0.06, 0.5, 0.46) : new THREE.Color(0.07, 0.19, 0.17) },
      uClear: { value: clear ? 1 : 0 },
      uWaves: { value: null },
      uLight: { value: 1.0 },
    },
  ]);
  uniforms.uWaves.value = waves();
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aDepth;
      varying vec3 vPos;
      varying float vDepth;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        vDepth = aDepth;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLight, uClear;
      uniform vec3 uSun, uSunColor, uSky, uHorizon, uDeep, uShallow;
      uniform sampler2D uWaves;
      varying vec3 vPos;
      varying float vDepth;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vPos.xz;
        float d = max(vDepth, 0.0);
        // Two ripple layers drifting across each other.
        vec4 a = texture2D(uWaves, p * 0.17 + uTime * vec2(0.013, 0.008));
        vec4 b = texture2D(uWaves, p * 0.43 - uTime * vec2(0.019, -0.023));
        vec2 slope = (a.rg - 0.5) * 0.5 + (b.rg - 0.5) * 0.3;
        vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 v = normalize(cameraPosition - vPos);
        vec3 l = normalize(uSun);
        float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uHorizon, uSky, smoothstep(0.1, 0.9, r.y)) * uLight;
        // Colour by depth: clear and green over the shallows, dark in the deep; ripples catch the light.
        float deep = 1.0 - exp(-d * mix(6.0, 2.6, uClear));
        vec3 body = mix(uShallow, uDeep, deep) * mix(0.35 + 0.65 * uLight, uLight * uLight, uClear) * (0.75 + 0.5 * max(dot(n, l), 0.0));
        vec3 col = mix(body, sky, 0.16 + 0.7 * fres);
        // Sun glints: a soft sheen and sharp sparkles off the ripple facets.
        float nh = max(dot(n, normalize(l + v)), 0.0);
        float s1 = pow(nh, 160.0), s8 = s1 * s1;
        s8 *= s8;
        s8 *= s8;
        float glint = (s1 * 0.6 + s8 * 9.0) * uLight;
        // Shore: the depth is roughened with noise so the waterline wanders off the mesh's straight edges.
        // There the water fades out, with a soft ragged foam line just off it and a fainter one lapping in.
        float nz = a.b * 0.55 + b.b * 0.45;
        float ds = d + (nz - 0.5) * 0.06;
        float edge = 1.0 - smoothstep(0.0, 0.07, ds);
        float lap = smoothstep(0.5, 1.0, sin(ds * 70.0 - uTime * 1.6)) * (1.0 - smoothstep(0.05, 0.13, ds));
        float foam = smoothstep(0.3, 0.8, edge * (0.5 + b.b)) * 0.8 + lap * 0.3 * a.b;
        foam *= smoothstep(0.0, 0.015, ds);
        col += uSunColor * glint * (1.0 - foam);
        col = mix(col, mix(uHorizon, vec3(1.0), 0.6) * (0.15 + 0.85 * uLight), foam);
        // See-through over the shallows, opaque in the deep and at grazing angles; glints and foam stay solid.
        float alpha = min(mix(mix(0.3, 0.12, uClear), mix(0.88, 0.8, uClear), deep) + fres * 0.35, 1.0) * smoothstep(0.0, 0.04, ds);
        gl_FragColor = vec4(col, max(max(alpha, foam), min(glint, 1.0)));
        #include <fog_fragment>
      }`,
  });
  let geo;
  if (ground && ground.w === w && ground.h === h) {
    geo = ground.waterGeometry();
  } else {
    geo = new THREE.PlaneGeometry(w + 140, h + 140, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w / 2, 0, h / 2);
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.renderOrder = 2;
  return mesh;
}
