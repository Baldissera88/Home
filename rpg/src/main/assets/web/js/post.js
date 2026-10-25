import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/*
 * The post stack for phones, where every full-screen pass costs: the scene's HDR target feeds a dual-filter
 * (Kawase) bloom that never touches a full-resolution target, on the high preset a half-size ambient
 * occlusion from the scene's depth and quarter-size light shafts outdoors, and one final pass that does
 * FXAA (presets without msaa), lays on the occlusion, the bloom and the shafts, tone maps, grades and writes
 * sRGB to the screen.
 */

/**
 * The look of each biome: one table for exposure and grade, so a new biome only adds a row (the desert
 * agent owns DESERT's). Engine.update blends a biome's day row toward its `dusk` and `night` rows (open
 * sky only) with blendGrade and hands the result to the FinalPass, the bloom and the atmosphere.
 *
 * exposure   toneMappingExposure (ACES): physically the scene is lit far brighter by day than by torches
 * balance    linear white balance before tone mapping (the colour of the light the eye adapted to)
 * contrast   0..1 strength of a filmic S-curve on the display image (0.5 pivot)
 * saturation display saturation; shadowSat the saturation of the darkest tones (luma < ~0.05)
 * lift, gain display tint added to shadows / multiplied into highlights
 * vignette   darkening toward the corners
 * bloom      glow strength; threshold the exposed brightness (max channel) where glow starts, knee its ramp
 * ao         ambient occlusion strength (high preset), env the reflection map's intensity
 * scatter    sun-coloured in-scattering in the fog toward the sun (open sky), haze the height fog share
 */
export const GRADE = {
  OVERWORLD: {
    exposure: 1.2, balance: [1.0, 1.0, 0.98], contrast: 0.3, saturation: 1.02, shadowSat: 0.88,
    lift: [0.0, 0.008, 0.024], gain: [1.05, 1.0, 0.95], vignette: 0.3,
    bloom: 0.3, threshold: 1.5, knee: 0.7, ao: 1.0, env: 0.32, scatter: 0.55, haze: 0.25,
    // Golden hour: warm light, warmer highlights, a little more contrast and glow.
    dusk: { exposure: 1.12, balance: [1.1, 0.98, 0.84], contrast: 0.24, saturation: 1.14, shadowSat: 0.88, lift: [0.016, 0.008, 0.004], gain: [1.06, 0.99, 0.9], bloom: 0.42, threshold: 1.35, scatter: 1.2 },
    // Moonlight: the eye adapts up, the colour goes cool and grey.
    night: { exposure: 1.42, balance: [0.86, 0.95, 1.12], contrast: 0.16, saturation: 0.86, shadowSat: 0.7, lift: [0.0, 0.006, 0.02], gain: [0.97, 0.99, 1.04], bloom: 0.5, threshold: 1.25, scatter: 0.35, env: 0.45 },
  },
  // Cool, desaturated stone; torches stay warm in the highlights.
  CRYPT: {
    exposure: 1.72, balance: [0.94, 0.98, 1.08], contrast: 0.16, saturation: 0.95, shadowSat: 0.62,
    lift: [0.0, 0.006, 0.02], gain: [1.04, 1.0, 0.95], vignette: 0.34,
    bloom: 0.4, threshold: 1.8, knee: 0.8, ao: 1.0, env: 0.38, scatter: 0, haze: 0.4,
  },
  // Teal-green shadows against orange firelight.
  CAVE: {
    exposure: 1.72, balance: [0.94, 1.02, 1.0], contrast: 0.16, saturation: 1.0, shadowSat: 0.72,
    lift: [0.0, 0.016, 0.016], gain: [1.05, 1.0, 0.93], vignette: 0.34,
    bloom: 0.4, threshold: 1.8, knee: 0.8, ao: 1.0, env: 0.4, scatter: 0, haze: 0.45,
  },
  // Red-orange heat, deep red shadows.
  HELL: {
    exposure: 1.48, balance: [1.06, 0.97, 0.88], contrast: 0.18, saturation: 1.04, shadowSat: 0.85,
    lift: [0.02, 0.004, 0.0], gain: [1.04, 0.98, 0.92], vignette: 0.34,
    bloom: 0.45, threshold: 1.9, knee: 0.9, ao: 0.9, env: 0.42, scatter: 0, haze: 0.35,
  },
  // Harsh sun: warm, contrasty, shadows a little desaturated. A starting point for the desert agent.
  DESERT: {
    exposure: 0.98, balance: [1.06, 1.0, 0.9], contrast: 0.28, saturation: 1.05, shadowSat: 0.78,
    lift: [0.012, 0.008, 0.004], gain: [1.04, 1.0, 0.94], vignette: 0.24,
    bloom: 0.28, threshold: 1.6, knee: 0.7, ao: 0.8, env: 0.42, scatter: 0.75, haze: 0.2,
    dusk: { exposure: 1.08, balance: [1.14, 0.97, 0.8], contrast: 0.26, saturation: 1.12, lift: [0.02, 0.008, 0.0], gain: [1.08, 0.98, 0.86], bloom: 0.42, threshold: 1.35, scatter: 1.3 },
    night: { exposure: 1.3, balance: [0.88, 0.95, 1.1], contrast: 0.18, saturation: 0.82, shadowSat: 0.7, lift: [0.0, 0.006, 0.018], gain: [0.97, 0.99, 1.04], bloom: 0.5, threshold: 1.25, scatter: 0.3, env: 0.45 },
  },
};

const KEYS = ['exposure', 'contrast', 'saturation', 'shadowSat', 'vignette', 'bloom', 'threshold', 'knee', 'ao', 'env', 'scatter', 'haze'];
const TINTS = ['balance', 'lift', 'gain'];

/** A grade record to blend into (blendGrade's `out`). */
export function makeGrade() {
  const g = {};
  for (const k of KEYS) g[k] = 0;
  for (const k of TINTS) g[k] = [0, 0, 0];
  return g;
}

/**
 * Writes biome's grade into `out`: its day row, moved toward its dusk row by `dusk` and toward its night
 * row by `night` (0..1 each; rows missing a key keep the day value). Unknown biomes look like the crypt.
 */
export function blendGrade(out, biome, dusk = 0, night = 0) {
  const day = GRADE[biome] || GRADE.CRYPT;
  const d = day.dusk, n = day.night;
  for (const k of KEYS) {
    let v = day[k] ?? 0;
    if (d && d[k] !== undefined) v += (d[k] - v) * dusk;
    if (n && n[k] !== undefined) v += (n[k] - v) * night;
    out[k] = v;
  }
  for (const k of TINTS) {
    for (let i = 0; i < 3; i++) {
      let v = day[k][i];
      if (d && d[k]) v += (d[k][i] - v) * dusk;
      if (n && n[k]) v += (n[k][i] - v) * night;
      out[k][i] = v;
    }
  }
  return out;
}

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Interleaved gradient noise (Jimenez): a per-pixel rotation that a small blur averages away. */
const IGN = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';

/**
 * Halves the size: a 4x4-texel footprint in 5 bilinear taps; PREFILTER keeps only what, once exposed, is
 * brighter than the threshold (by its brightest channel, so saturated emissives and flames glow while lit
 * stone, foliage and skin do not), with a soft quadratic knee.
 */
const DOWN = `
precision mediump float;
precision mediump sampler2D;
uniform sampler2D tSrc;
uniform highp vec2 uTexel;
uniform float uThreshold, uKnee, uExposure;
varying highp vec2 vUv;
vec3 tap(highp vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
#ifdef PREFILTER
  c = min(c, vec3(64.0));
  float br = max(c.r, max(c.g, c.b)) * uExposure;
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 0.0001);
  c *= max(soft, br - uThreshold) / max(br, 0.0001);
#endif
  return c;
}
void main() {
  vec3 c = tap(vUv) * 4.0 + tap(vUv + uTexel) + tap(vUv - uTexel)
    + tap(vUv + vec2(uTexel.x, -uTexel.y)) + tap(vUv - vec2(uTexel.x, -uTexel.y));
  gl_FragColor = vec4(c * 0.125, 1.0);
}`;

/** Doubles the size: a tent in 8 bilinear taps, blended additively onto that size's own downsample. */
const UP = `
precision mediump float;
precision mediump sampler2D;
uniform sampler2D tSrc;
uniform highp vec2 uTexel;
uniform float uScale;
varying highp vec2 vUv;
void main() {
  highp vec2 h = uTexel * 0.5;
  vec3 c = texture2D(tSrc, vUv + vec2(-uTexel.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).rgb
    + texture2D(tSrc, vUv + vec2(0.0, -uTexel.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).rgb
    + 2.0 * (texture2D(tSrc, vUv + h).rgb + texture2D(tSrc, vUv - h).rgb
    + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb);
  gl_FragColor = vec4(c * (uScale / 12.0), 1.0);
}`;

const quad = (fragmentShader, uniforms, extra) => new THREE.RawShaderMaterial({
  vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra,
});

/**
 * Glow on what is brighter than `threshold` once exposed by `exposure`: thresholded to half size, halved
 * `levels - 1` more times, then summed back up to half size, which the final pass adds to the scene times
 * `strength`. `enabled` is the composer's switch; `texture` is the half-size result.
 */
export class BloomPass extends Pass {
  constructor(type = THREE.HalfFloatType, levels = 5) {
    super();
    this.needsSwap = false;
    this.strength = 0.55;
    this.threshold = 1.2;
    this.knee = 0.6;
    this.exposure = 1;
    /** Tap spacing of the upsamples below the last and the weight of each coarser level: a wide, faint halo. */
    this.spread = 2;
    this.scale = 1.35;
    /** Brings the sum of the levels to the brightness UnrealBloomPass had at the same strength. */
    this.gain = 0.6;
    this.targets = [];
    for (let i = 0; i < levels; i++) {
      this.targets.push(new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false }));
    }
    this.texture = this.targets[0].texture;
    this.prefilter = quad(DOWN, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uKnee: { value: 0 }, uExposure: { value: 1 },
    }, { defines: { PREFILTER: '' } });
    this.down = quad(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = quad(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 } }, { blending: THREE.AdditiveBlending });
    this.fsQuad = new FullScreenQuad(this.prefilter);
    this.width = 1;
    this.height = 1;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    for (const t of this.targets) {
      width = Math.max(1, Math.round(width / 2));
      height = Math.max(1, Math.round(height / 2));
      t.setSize(width, height);
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const t = this.targets, q = this.fsQuad;
    const p = this.prefilter.uniforms;
    p.tSrc.value = readBuffer.texture;
    p.uTexel.value.set(1 / this.width, 1 / this.height);
    p.uThreshold.value = this.threshold;
    p.uKnee.value = this.knee;
    p.uExposure.value = this.exposure;
    q.material = this.prefilter;
    renderer.setRenderTarget(t[0]);
    renderer.clear(true, false, false);
    q.render(renderer);
    const d = this.down.uniforms;
    q.material = this.down;
    for (let i = 1; i < t.length; i++) {
      d.tSrc.value = t[i - 1].texture;
      d.uTexel.value.set(1 / t[i - 1].width, 1 / t[i - 1].height);
      renderer.setRenderTarget(t[i]);
      renderer.clear(true, false, false);
      q.render(renderer);
    }
    const u = this.up.uniforms;
    q.material = this.up;
    u.uScale.value = this.scale;
    for (let i = t.length - 2; i >= 0; i--) {
      u.tSrc.value = t[i + 1].texture;
      const s = i ? this.spread : 1;
      u.uTexel.value.set(s / t[i + 1].width, s / t[i + 1].height);
      renderer.setRenderTarget(t[i]);
      q.render(renderer);
    }
    renderer.autoClear = autoClear;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.fsQuad.dispose();
  }
}

/** View-space depth (positive, units) from a depth-buffer value: uDepth = (near * far, far - near, far). */
const LINEAR_DEPTH = 'float linearDepth(float d) { return uDepth.x / (uDepth.z - d * uDepth.y); }';

/**
 * Ambient occlusion at half size from the full-size depth: the view-space normal from the flatter side of
 * each pair of neighbours (so silhouettes do not smear), then SAMPLES taps on a rotated golden-angle spiral
 * of `radius` units, each counting how far its point rises over the surface (the cosine of its horizon),
 * fading with distance. Output: r occlusion (1 open), g view depth for the bilateral blur and upsample.
 */
const AO_FS = `
precision highp float;
precision highp sampler2D;
uniform sampler2D tDepth;
uniform vec4 uProj;
uniform vec3 uDepth;
uniform vec2 uTexel;
uniform float uRadius, uPxPerUnit, uMaxPx, uBias, uIntensity, uFadeFar;
varying vec2 vUv;
${LINEAR_DEPTH}
${IGN}
vec3 viewPos(vec2 uv) {
  float z = linearDepth(texture2D(tDepth, uv).r);
  return vec3((uv * 2.0 - 1.0 + uProj.zw) * z / uProj.xy, -z);
}
void main() {
  float d0 = texture2D(tDepth, vUv).r;
  float z0 = linearDepth(d0);
  if (d0 >= 0.99999 || z0 > uFadeFar) { gl_FragColor = vec4(1.0, min(z0, 60000.0), 0.0, 1.0); return; }
  vec3 p = vec3((vUv * 2.0 - 1.0 + uProj.zw) * z0 / uProj.xy, -z0);
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)), pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)), pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));
  float rPx = min(uRadius * uPxPerUnit / z0, uMaxPx);
  float r2 = uRadius * uRadius;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.6) / float(SAMPLES);
    float a = ang + float(i) * 2.3999632;
    vec3 q = viewPos(vUv + vec2(cos(a), sin(a)) * (t * rPx) * uTexel);
    vec3 v = q - p;
    float vv = dot(v, v);
    float fall = max(0.0, 1.0 - vv / r2);
    occ += fall * max(0.0, dot(v, n) * inversesqrt(vv + 0.0001) - uBias);
  }
  float ao = clamp(1.0 - occ * uIntensity / float(SAMPLES), 0.0, 1.0);
  // Fade out where a tap spans less than a texel (far away) and toward the fog.
  ao = mix(1.0, ao, smoothstep(1.0, 3.0, rPx) * (1.0 - smoothstep(uFadeFar * 0.6, uFadeFar, z0)));
  gl_FragColor = vec4(ao, z0, 0.0, 1.0);
}`;

/** One direction of a depth-aware 5-tap blur of the occlusion (keeps g, the depth). */
const AO_BLUR_FS = `
precision highp float;
precision highp sampler2D;
uniform sampler2D tAO;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tAO, vUv);
  float z = c.g, sum = c.r, wsum = 1.0;
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    vec2 s = texture2D(tAO, vUv + uStep * float(i)).rg;
    float w = (abs(float(i)) < 1.5 ? 0.8 : 0.45) * max(0.0, 1.0 - abs(s.g - z) / (z * 0.06 + 0.02));
    sum += s.r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, z, 0.0, 1.0);
}`;

/**
 * Screen-space ambient occlusion at half resolution (high preset): reads the depth texture the scene pass
 * resolved, writes `texture` (occlusion and depth) for the FinalPass's depth-aware upsample. `radius` is in
 * world units; `enabled` is the composer's switch (the FinalPass leaves the occlusion out when it is off).
 */
export class AOPass extends Pass {
  constructor(camera, samples = 8) {
    super();
    this.needsSwap = false;
    this.camera = camera;
    this.radius = 0.7;
    this.intensity = 2.8;
    this.depthTexture = null;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.target = new THREE.WebGLRenderTarget(1, 1, opts);
    this.temp = new THREE.WebGLRenderTarget(1, 1, opts);
    this.texture = this.target.texture;
    this.material = quad(AO_FS, {
      tDepth: { value: null }, uProj: { value: new THREE.Vector4() }, uDepth: { value: new THREE.Vector3() },
      uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.5 }, uPxPerUnit: { value: 1 }, uMaxPx: { value: 40 },
      uBias: { value: 0.07 }, uIntensity: { value: 1.6 }, uFadeFar: { value: 40 },
    }, { defines: { SAMPLES: samples } });
    this.blur = quad(AO_BLUR_FS, { tAO: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.fsQuad = new FullScreenQuad(this.material);
    this.width = this.height = 1;
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.round(width / 2));
    this.height = Math.max(1, Math.round(height / 2));
    this.target.setSize(this.width, this.height);
    this.temp.setSize(this.width, this.height);
  }

  /** Depth-buffer to linear depth constants for the camera: (near * far, far - near, far). */
  static depthParams(camera, out) {
    return out.set(camera.near * camera.far, camera.far - camera.near, camera.far);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = this.depthTexture || readBuffer.depthTexture;
    if (!depth) return;
    const cam = this.camera, e = cam.projectionMatrix.elements, u = this.material.uniforms;
    u.tDepth.value = depth;
    u.uProj.value.set(e[0], e[5], e[8], e[9]);
    AOPass.depthParams(cam, u.uDepth.value);
    u.uTexel.value.set(1 / this.width, 1 / this.height);
    u.uRadius.value = this.radius;
    u.uIntensity.value = this.intensity;
    u.uPxPerUnit.value = e[5] * 0.5 * this.height;
    u.uMaxPx.value = Math.max(8, this.height * 0.06);
    u.uFadeFar.value = this.fadeFar || 40;
    const q = this.fsQuad;
    q.material = this.material;
    renderer.setRenderTarget(this.target);
    q.render(renderer);
    const b = this.blur.uniforms;
    q.material = this.blur;
    b.tAO.value = this.target.texture;
    b.uStep.value.set(1 / this.width, 0);
    renderer.setRenderTarget(this.temp);
    q.render(renderer);
    b.tAO.value = this.temp.texture;
    b.uStep.value.set(0, 1 / this.height);
    renderer.setRenderTarget(this.target);
    q.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.temp.dispose();
    this.material.dispose();
    this.blur.dispose();
    this.fsQuad.dispose();
  }
}

/**
 * Light shafts: from each pixel, STEPS taps toward the sun's place on screen count the open sky (depth at
 * the far plane), decaying with distance, so gaps between trees and roofs stream light. Quarter size; the
 * FinalPass adds it over the scene. `sun` is the sun's screen position (uv), `color` the shafts' linear
 * colour with strength; `active` false skips the pass (sun behind the camera, night, indoors).
 */
const RAYS_FS = `
precision highp float;
precision highp sampler2D;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform vec3 uColor;
uniform float uAspect, uLength;
varying vec2 vUv;
${IGN}
void main() {
  vec2 delta = (uSun - vUv) * (uLength / float(STEPS));
  vec2 uv = vUv + delta * ign(gl_FragCoord.xy);
  float sum = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec2 c = clamp(uv, 0.0, 1.0);
    float inside = step(abs(c.x - uv.x) + abs(c.y - uv.y), 0.0001);
    sum += step(0.99999, texture2D(tDepth, c).r) * inside * w;
    wsum += w;
    w *= 0.93;
    uv += delta;
  }
  float dist = length((vUv - uSun) * vec2(uAspect, 1.0));
  gl_FragColor = vec4(uColor * (sum / wsum) * exp(-dist * 1.6), 1.0);
}`;

export class RaysPass extends Pass {
  constructor(steps = 20) {
    super();
    this.needsSwap = false;
    this.active = false;
    this.lit = true;
    this.depthTexture = null;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.texture = this.target.texture;
    this.material = quad(RAYS_FS, {
      tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 1.2) }, uColor: { value: new THREE.Color() },
      uAspect: { value: 1 }, uLength: { value: 0.9 },
    }, { defines: { STEPS: steps } });
    this.sun = this.material.uniforms.uSun.value;
    this.color = this.material.uniforms.uColor.value;
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)));
    this.material.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = this.depthTexture || readBuffer.depthTexture;
    if (!depth) return;
    if (!this.active) {
      // Nothing to add: leave the target black (cleared once) so the final pass adds nothing.
      if (this.lit) {
        this.lit = false;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, false, false);
      }
      return;
    }
    this.lit = true;
    this.material.uniforms.tDepth.value = depth;
    renderer.setRenderTarget(this.target);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

const TONE = {
  [THREE.LinearToneMapping]: 'LinearToneMapping',
  [THREE.ReinhardToneMapping]: 'ReinhardToneMapping',
  [THREE.CineonToneMapping]: 'CineonToneMapping',
  [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping',
  [THREE.AgXToneMapping]: 'AgXToneMapping',
  [THREE.NeutralToneMapping]: 'NeutralToneMapping',
};

/**
 * Lottes' 9-tap FXAA on the HDR scene. Taps are squashed into [0, 1) first so a bright edge blends the way
 * it will look once tone mapped, and the result is expanded back. Smooth areas skip the 4 taps along the
 * edge and get a gentle sharpen (uSharpen) from the corner taps already read, for the low preset's low dpr.
 */
const FXAA = `
vec3 fxSquash(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
float fxLuma(vec3 c) { return sqrt(dot(c, vec3(0.299, 0.587, 0.114))); }
vec3 fxTap(vec2 uv) { return fxSquash(texture2D(tDiffuse, uv).rgb); }
vec3 fxaa(vec3 m) {
  vec3 s = fxSquash(m);
  vec3 nw = fxTap(vUv - uTexel), ne = fxTap(vUv + vec2(uTexel.x, -uTexel.y));
  vec3 sw = fxTap(vUv + vec2(-uTexel.x, uTexel.y)), se = fxTap(vUv + uTexel);
  float lM = fxLuma(s), lNW = fxLuma(nw), lNE = fxLuma(ne), lSW = fxLuma(sw), lSE = fxLuma(se);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0833, lMax * 0.166)) {
    // no edge: sharpen a little against the diagonal neighbours instead
    s = clamp(s + uSharpen * (s - 0.25 * (nw + ne + sw + se)), 0.0, 0.999);
    return s / (1.0 - max(s.r, max(s.g, s.b)));
  }
  vec2 dir = vec2((lSW + lSE) - (lNW + lNE), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (fxTap(vUv - dir * 0.1667) + fxTap(vUv + dir * 0.1667));
  vec3 b = a * 0.5 + 0.25 * (fxTap(vUv - dir * 0.5) + fxTap(vUv + dir * 0.5));
  float lB = fxLuma(b);
  if (lB < lMin || lB > lMax) b = a;
  return b / max(1.0 - max(b.r, max(b.g, b.b)), 0.001);
}`;

/**
 * The half-size occlusion brought to full size: the four nearest texels, bilinear weights cut down where
 * their depth differs from this pixel's, so dark halos do not spill over silhouettes.
 */
const AO_UP = `
${LINEAR_DEPTH}
float aoUpsample() {
  float z = linearDepth(texture2D(tDepth, vUv).r);
  vec2 p = vUv * uAOSize.xy - 0.5;
  vec2 f = fract(p), b = (floor(p) + 0.5) * uAOSize.zw;
  vec2 a00 = texture2D(tAO, b).rg, a10 = texture2D(tAO, b + vec2(uAOSize.z, 0.0)).rg;
  vec2 a01 = texture2D(tAO, b + vec2(0.0, uAOSize.w)).rg, a11 = texture2D(tAO, b + uAOSize.zw).rg;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 dz = abs(vec4(a00.g, a10.g, a01.g, a11.g) - z) / (z * 0.05 + 0.02);
  w = w * max(vec4(0.0), 1.0 - dz) + 0.0001;
  return dot(w, vec4(a00.r, a10.r, a01.r, a11.r)) / dot(w, vec4(1.0));
}`;

/**
 * The last pass: FXAA (when built with it); the occlusion (AO), bloom and light shafts (RAYS); white balance,
 * the red edge of low health and the white flash of a new level; the renderer's tone mapping at its
 * toneMappingExposure and its output colour space; then the grade on the display image (saturation with
 * a shadow share, a filmic S-curve, lift and gain, vignette), film grain (GRAIN) or a fine dither against
 * banding in dark gradients. `uniforms` holds the grade (see GRADE and setGrade), uHurt, uFlash and uAspect.
 */
export class FinalPass extends Pass {
  constructor(bloom = null, fxaa = false) {
    super();
    this.needsSwap = false;
    this.bloom = bloom;
    this.fxaa = fxaa;
    /** AOPass or RaysPass to lay on when they are enabled (set by the engine). */
    this.ao = null;
    this.rays = null;
    /** Film grain on (high preset). */
    this.grain = false;
    this.camera = null;
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      tAO: { value: null },
      tDepth: { value: null },
      tRays: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uAOSize: { value: new THREE.Vector4(1, 1, 1, 1) },
      uDepth: { value: new THREE.Vector3(1, 1, 1) },
      uBloom: { value: 0 },
      uAO: { value: 0.8 },
      uSharpen: { value: 0.25 },
      toneMappingExposure: { value: 1 },
      uVignette: { value: 0.3 },
      uHurt: { value: 0 },
      uFlash: { value: 0 },
      uAspect: { value: 1 },
      uBalance: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3() },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uContrast: { value: 0.2 },
      uSat: { value: 1 },
      uShadowSat: { value: 1 },
      uGrain: { value: 0.035 },
      uTime: { value: 0 },
    };
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: `
precision highp float;
precision highp sampler2D;
uniform sampler2D tDiffuse, tBloom, tAO, tDepth, tRays;
uniform vec2 uTexel;
uniform vec4 uAOSize;
uniform vec3 uDepth, uBalance, uLift, uGain;
uniform float uBloom, uAO, uSharpen, uVignette, uHurt, uFlash, uAspect, uContrast, uSat, uShadowSat, uGrain, uTime;
varying vec2 vUv;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
#ifdef FXAA
${FXAA}
#endif
#ifdef AO
${AO_UP}
#endif
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uTime);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
#ifdef FXAA
  col = fxaa(col);
#endif
#ifdef AO
  // Occlusion darkens what ambient light shows; glowing things (fire, magic, emissives) keep their light.
  float glow = smoothstep(0.6, 2.2, max(col.r, max(col.g, col.b)) * toneMappingExposure);
  col *= mix(1.0, aoUpsample(), uAO * (1.0 - glow));
#endif
#ifdef BLOOM
  col += texture2D(tBloom, vUv).rgb * uBloom;
#endif
#ifdef RAYS
  col += texture2D(tRays, vUv).rgb;
#endif
  col *= uBalance;
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);
  col = mix(col, vec3(0.6, 0.0, 0.0), uHurt * smoothstep(0.45, 1.1, r) * 0.7);
  col += uFlash * vec3(1.0, 0.95, 0.85);
#ifdef TONE
  col = TONE(col);
#endif
#ifdef SRGB_TRANSFER
  col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
#endif
  // The grade, on the display image: saturation (less in the shadows), an S-curve, lift and gain, vignette.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, mix(uShadowSat, uSat, smoothstep(0.04, 0.4, l))), 0.0);
  col = min(col, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  col = col * uGain + uLift * (1.0 - col);
  col *= 1.0 - uVignette * smoothstep(0.3, 1.1, r);
  float n = hash12(gl_FragCoord.xy) - 0.5;
#ifdef GRAIN
  col += n * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 0.8)));
#else
  col += n * (1.5 / 255.0);
#endif
  gl_FragColor = vec4(col, 1.0);
}`,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.built = { tone: -1, space: '', glow: false, ao: false, rays: false, grain: false };
  }

  /** Copies a blended grade (makeGrade / blendGrade) into the shader's uniforms. */
  setGrade(g) {
    const u = this.uniforms;
    u.uBalance.value.fromArray(g.balance);
    u.uLift.value.fromArray(g.lift);
    u.uGain.value.fromArray(g.gain);
    u.uContrast.value = g.contrast;
    u.uSat.value = g.saturation;
    u.uShadowSat.value = g.shadowSat;
    u.uVignette.value = g.vignette;
    u.uAO.value = g.ao;
  }

  setSize(width, height) {
    this.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms, b = this.bloom, k = this.built;
    const glow = !!b && b.enabled;
    const ao = !!this.ao && this.ao.enabled && !!readBuffer.depthTexture;
    const rays = !!this.rays && this.rays.enabled && !!readBuffer.depthTexture;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = glow ? b.texture : null;
    u.uBloom.value = glow ? b.strength * b.gain : 0;
    u.tAO.value = ao ? this.ao.texture : null;
    u.tDepth.value = ao ? readBuffer.depthTexture : null;
    u.tRays.value = rays ? this.rays.texture : null;
    if (ao) {
      const t = this.ao.target;
      u.uAOSize.value.set(t.width, t.height, 1 / t.width, 1 / t.height);
      AOPass.depthParams(this.ao.camera, u.uDepth.value);
    }
    u.uTime.value = (u.uTime.value + 0.618034) % 1;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    if (k.tone !== renderer.toneMapping || k.space !== renderer.outputColorSpace || k.glow !== glow || k.ao !== ao || k.rays !== rays || k.grain !== this.grain) {
      k.tone = renderer.toneMapping;
      k.space = renderer.outputColorSpace;
      k.glow = glow;
      k.ao = ao;
      k.rays = rays;
      k.grain = this.grain;
      const d = this.material.defines = {};
      if (TONE[k.tone]) d.TONE = TONE[k.tone];
      if (THREE.ColorManagement.getTransfer(k.space) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      if (glow) d.BLOOM = '';
      if (ao) d.AO = '';
      if (rays) d.RAYS = '';
      if (this.grain) d.GRAIN = '';
      if (this.fxaa) d.FXAA = '';
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
