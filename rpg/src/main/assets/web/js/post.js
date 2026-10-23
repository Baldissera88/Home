import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/*
 * The post stack for phones, where every full-screen pass costs: the scene's HDR target feeds a dual-filter
 * (Kawase) bloom that never touches a full-resolution target, and one final pass that does FXAA (presets
 * without msaa), adds the bloom, grades, tone maps and writes sRGB to the screen.
 */

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Halves the size: a 4x4-texel footprint in 5 bilinear taps; PREFILTER keeps only what is over the threshold. */
const DOWN = `
precision mediump float;
precision mediump sampler2D;
uniform sampler2D tSrc;
uniform highp vec2 uTexel;
uniform float uThreshold, uKnee;
varying highp vec2 vUv;
vec3 tap(highp vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
#ifdef PREFILTER
  c = min(c, vec3(64.0));
  c *= smoothstep(uThreshold, uThreshold + uKnee, dot(c, vec3(0.299, 0.587, 0.114)));
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

/**
 * Glow on what is brighter than `threshold`: thresholded to half size, halved `levels - 1` more times, then
 * summed back up to half size, which the final pass adds to the scene times `strength`. `enabled` is the
 * composer's switch; `texture` is the half-size result.
 */
export class BloomPass extends Pass {
  constructor(type = THREE.HalfFloatType, levels = 5) {
    super();
    this.needsSwap = false;
    this.strength = 0.55;
    this.threshold = 0.9;
    this.knee = 0.1;
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
    const quad = (fragmentShader, uniforms, extra) => new THREE.RawShaderMaterial({
      vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra,
    });
    this.prefilter = quad(DOWN, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uKnee: { value: 0 },
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
 * The last pass: FXAA (when built with it), bloom, the grade (vignette, split tone, the warm cast of dusk and
 * dungeons, the red edge of low health, the white flash of a new level), then the renderer's tone mapping
 * at its toneMappingExposure and its output colour space, straight to the screen. `uniforms` holds the
 * grade's uHurt, uFlash, uWarm, uAspect and uVignette.
 */
export class FinalPass extends Pass {
  constructor(bloom = null, fxaa = false) {
    super();
    this.needsSwap = false;
    this.bloom = bloom;
    this.fxaa = fxaa;
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: 0 },
      uSharpen: { value: 0.25 },
      toneMappingExposure: { value: 1 },
      uVignette: { value: 0.32 },
      uHurt: { value: 0 },
      uFlash: { value: 0 },
      uAspect: { value: 1 },
      uWarm: { value: 0 },
      // A biome's own grade (the desert's warm cinematic look): tints for the shadows and the highlights and a
      // saturation; white, white and 1 leave the picture as it is.
      uGradeShadow: { value: new THREE.Color(1, 1, 1) },
      uGradeLight: { value: new THREE.Color(1, 1, 1) },
      uGradeSat: { value: 1 },
    };
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: `
precision highp float;
precision highp sampler2D;
uniform sampler2D tDiffuse, tBloom;
uniform vec2 uTexel;
uniform float uBloom, uSharpen, uVignette, uHurt, uFlash, uAspect, uWarm, uGradeSat;
uniform vec3 uGradeShadow, uGradeLight;
varying vec2 vUv;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
#ifdef FXAA
${FXAA}
#endif
void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
#ifdef FXAA
  col = fxaa(col);
#endif
#ifdef BLOOM
  col += texture2D(tBloom, vUv).rgb * uBloom;
#endif
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
  // split tone: cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l));
  col *= 1.0 + uWarm * vec3(0.06, 0.01, -0.05);
  col = mix(vec3(l), col, uGradeSat) * mix(uGradeShadow, uGradeLight, smoothstep(0.02, 0.7, l));
  col = mix(col, vec3(0.6, 0.0, 0.0), uHurt * smoothstep(0.45, 1.1, r) * 0.7);
  col += uFlash * vec3(1.0, 0.95, 0.85);
#ifdef TONE
  col = TONE(col);
#endif
  gl_FragColor = vec4(col, 1.0);
#ifdef SRGB_TRANSFER
  gl_FragColor = sRGBTransferOETF(gl_FragColor);
#endif
}`,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.built = { tone: -1, space: '', glow: false };
  }

  setSize(width, height) {
    this.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms, b = this.bloom, k = this.built;
    const glow = !!b && b.enabled;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = glow ? b.texture : null;
    u.uBloom.value = glow ? b.strength * b.gain : 0;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    if (k.tone !== renderer.toneMapping || k.space !== renderer.outputColorSpace || k.glow !== glow) {
      k.tone = renderer.toneMapping;
      k.space = renderer.outputColorSpace;
      k.glow = glow;
      const d = this.material.defines = {};
      if (TONE[k.tone]) d.TONE = TONE[k.tone];
      if (THREE.ColorManagement.getTransfer(k.space) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      if (glow) d.BLOOM = '';
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
