import * as THREE from 'three';
import { hash } from './defs.js';

/**
 * Sky and weather visuals: the open-world sky dome (gradient, sun, moon, stars and three cloud layers,
 * all melting into the fog colour at the horizon) and the rain (soft streaks plus splashes on the ground).
 * Every noise in the sky comes from one small tiling texture baked at start-up, so a sky pixel costs a
 * handful of texture reads instead of dozens of hashed noise samples.
 */

export const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 50.0, 1.0);
  gl_Position = p.xyww;
}`;

export const SKY_FS = /* glsl */`
uniform vec3 uSun, uMoon, uZenith, uHorizon, uSunColor, uGround, uFog;
uniform float uTime, uNight, uCloud, uRain, uHaze, uFlash, uCover;
uniform sampler2D uNoise;
varying vec3 vDir;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  float day = 1.0 - uNight;
  float dusk = clamp(1.0 - abs(uSun.y) * 3.4, 0.0, 1.0) * day;
  float clear = 1.0 - uRain * 0.85;
  vec3 col = mix(uHorizon, uZenith, pow(hp, 0.45));

  // Stars fade in with the night: round, softly twinkling points of slightly different colours.
  if (uNight > 0.02) {
    vec3 sp = d * 150.0;
    vec3 cell = floor(sp);
    float s = hash3(cell);
    vec3 off = fract(s * vec3(13.17, 71.31, 37.73)) * 0.5 + 0.25;
    float r = length(fract(sp) - off);
    float mag = step(0.986, s) * fract(s * 91.7);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + s * 3.0) + s * 60.0);
    vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.75, 0.86, 1.0), fract(s * 7.3));
    col += tint * mag * mag * tw * (1.0 - smoothstep(0.0, 0.24, r)) * 2.6 * smoothstep(0.35, 1.0, uNight) * smoothstep(0.02, 0.3, h) * clear;
  }

  // Moon: a disc with dark seas and limb shading, inside a cold glow that lights up the night sky.
  float md = dot(d, uMoon);
  vec3 moonCol = vec3(0.62, 0.74, 1.0);
  col += moonCol * (pow(max(md, 0.0), 8.0) * 0.05 + pow(max(md, 0.0), 300.0) * 0.25) * uNight * clear;
  if (md > 0.998) {
    vec3 mt = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    vec2 mp = vec2(dot(d, mt), dot(d, cross(mt, uMoon))) * 34.0;
    float r2 = dot(mp, mp);
    float disc = 1.0 - smoothstep(0.9, 1.0, r2);
    float seas = smoothstep(0.4, 0.62, texture2D(uNoise, mp * 0.2 + 0.31).a);
    float limb = sqrt(max(0.0, 1.0 - r2));
    float lit = 0.55 + 0.45 * clamp(dot(vec3(mp, limb), vec3(0.42, 0.3, 0.86)), 0.0, 1.0);
    col = mix(col, vec3(1.0, 0.97, 0.9) * (1.15 - 0.55 * seas) * lit, disc * uNight * clear);
  }

  // Sun: a hot disc, a soft two-lobed halo and a wide glow along the horizon under it, warmest at dusk.
  float sd = max(dot(d, uSun), 0.0);
  float up = smoothstep(-0.12, 0.02, uSun.y) * day;
  float az = max(dot(normalize(d.xz + 1e-4), normalize(uSun.xz + 1e-4)), 0.0);
  col += uSunColor * exp(-hp * 6.0) * (0.06 + 0.5 * dusk) * (0.25 + 0.75 * az * az) * clear * up;
  col += uSunColor * (pow(sd, 10.0) * 0.22 + pow(sd, 90.0) * 0.55) * clear * up;
  col += uSunColor * smoothstep(0.99955, 0.99985, sd) * 24.0 * clear * up;

  // Clouds, lit by the sun by day and the moon by night.
  vec3 L = normalize(mix(uSun, uMoon, uNight));
  float sl = max(dot(d, L), 0.0);
  vec3 lightCol = mix(vec3(1.3, 1.26, 1.18), mix(uSunColor, vec3(1.0, 0.4, 0.42), 0.4) * 1.2, dusk);
  lightCol = mix(lightCol, vec3(0.28, 0.35, 0.54), uNight);
  vec3 shadeCol = mix(mix(uHorizon, vec3(0.34, 0.4, 0.54), 0.5) * 0.85, vec3(0.36, 0.2, 0.34), dusk * 0.8);
  shadeCol = mix(shadeCol, uZenith * 1.3 + vec3(0.004, 0.006, 0.012), uNight);
  float dim = 0.2 + 0.8 * day;
  lightCol = mix(lightCol, vec3(0.5, 0.53, 0.58) * dim, uRain);
  shadeCol = mix(shadeCol, vec3(0.17, 0.18, 0.21) * dim, uRain);
  if (h > 0.0) {
    vec2 wind = vec2(uTime * 0.004, uTime * 0.0017);
    // High wisps first: long streaks far above, faint and tinted by the light.
    vec2 uv3 = d.xz / (h + 0.4);
    float ci = smoothstep(0.5, 0.9, texture2D(uNoise, uv3 * vec2(0.07, 0.22) + wind * 0.6).b);
    col = mix(col, lightCol * 0.95, ci * 0.32 * smoothstep(0.0, 0.15, h) * (1.0 - uRain));
    // Two billow layers projected onto a low dome: one sample for shape, one for detail and one
    // more toward the light, so edges facing it glow and thick bellies fall into shade.
    vec2 uv = d.xz / (h + 0.2);
    vec2 p1 = uv * 0.22 + wind;
    float erode = (1.0 - texture2D(uNoise, p1 * 3.1 + vec2(0.37, 0.71) + wind * 0.8).g) * 0.22;
    float dens = texture2D(uNoise, p1).r - erode;
    vec2 uvL = L.xz / (max(L.y, 0.02) + 0.2);
    vec2 toL = normalize(uvL - uv + 1e-4) * 0.02;
    float densL = texture2D(uNoise, p1 + toL).r - erode;
    // uCover: the fair-weather threshold (0.44 over the green lands, higher in the desert's clear skies).
    float cover = mix(uCover, 0.0, uCloud);
    float m = smoothstep(cover, cover + 0.08, dens);
    float thick = smoothstep(cover + 0.03, cover + 0.3, dens);
    float rim = clamp(0.5 + (dens - densL) * 14.0, 0.0, 1.0);
    float light = clamp(rim * (1.0 - 0.5 * thick) + (1.0 - thick) * 0.35, 0.0, 1.0);
    vec3 cloud = mix(shadeCol, lightCol, light);
    // Thin cloud near the sun or moon glows with forward-scattered light.
    cloud += lightCol * (pow(sl, 7.0) * 0.6 + pow(sl, 40.0)) * (1.0 - thick) * clear;
    cloud += vec3(0.7, 0.75, 0.95) * uFlash * (0.5 + thick);
    col = mix(col, cloud, m * smoothstep(0.0, 0.06, h) * 0.97);
  }
  col += vec3(0.5, 0.55, 0.7) * uFlash * 0.25;

  // Haze: exactly the fog colour at the horizon so far scenery melts into the sky.
  col = mix(col, uFog, exp(-hp * uHaze));
  col = mix(col, uGround, 1.0 - smoothstep(-0.25, 0.0, h));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * A tiling RGBA texture of value-noise fbm, one scale per channel: R cloud bodies, G cloud detail,
 * B wisps, A moon seas. Mipmapped, so the clouds stay smooth where the dome squeezes them at the horizon.
 */
export function makeSkyNoise(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const acc = new Float32Array(size * size);
  const CHANNELS = [[4, 5], [8, 4], [6, 4], [16, 3]]; // [base period, octaves]
  for (let c = 0; c < 4; c++) {
    const [base, octaves] = CHANNELS[c];
    acc.fill(0);
    let amp = 1;
    for (let o = 0; o < octaves; o++) {
      const p = base << o;
      const lat = new Float32Array(p * p);
      for (let i = 0; i < lat.length; i++) lat[i] = hash(i, o, c + 11);
      for (let y = 0; y < size; y++) {
        const fy = y / size * p, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
        const r0 = iy * p, r1 = ((iy + 1) % p) * p;
        for (let x = 0; x < size; x++) {
          const fx = x / size * p, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
          const ix1 = (ix + 1) % p;
          const a = lat[r0 + ix], b = lat[r0 + ix1], e = lat[r1 + ix], g = lat[r1 + ix1];
          const top = a + (b - a) * sx;
          acc[y * size + x] += amp * (top + (e + (g - e) * sx - top) * sy);
        }
      }
      amp *= 0.5;
    }
    // Stretch each channel to the full range so the shader's thresholds mean the same for all of them.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < acc.length; i++) { lo = Math.min(lo, acc[i]); hi = Math.max(hi, acc[i]); }
    for (let i = 0; i < acc.length; i++) data[i * 4 + c] = Math.round((acc[i] - lo) / (hi - lo) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Rain streaks: camera-facing quads stretched along the fall, animated on the GPU inside a box that
// follows the hero, at least ~1.5 pixels wide so they read on dense phone screens.
const RAIN_VS = /* glsl */`
attribute vec4 aDrop;
uniform vec3 uCenter;
uniform vec2 uWind;
uniform float uTime, uScale;
varying vec2 vUv;
varying float vA;
const vec3 BOX = vec3(22.0, 12.0, 22.0);
void main() {
  float speed = 14.0 + aDrop.w * 6.0;
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = aDrop.xyz * BOX + vel * uTime;
  p = uCenter + mod(p - uCenter + BOX * 0.5, BOX) - BOX * 0.5;
  vec3 head = (viewMatrix * vec4(p, 1.0)).xyz;
  vec3 tail = (viewMatrix * vec4(p - vel * 0.04, 1.0)).xyz;
  vec3 side = normalize(cross(tail - head, head));
  vec3 q = mix(head, tail, position.y);
  float w = max(0.011, 1.4 * -q.z / uScale);
  q += side * position.x * w;
  vUv = position.xy;
  // Thin out where the box wraps, right in front of the lens and with distance.
  vec3 rel = abs(p - uCenter) / (BOX * 0.5);
  vA = (0.011 / w) * (1.0 - smoothstep(0.75, 1.0, max(max(rel.x, rel.z), rel.y))) * smoothstep(1.5, 4.5, -head.z);
  gl_Position = projectionMatrix * vec4(q, 1.0);
}`;

const RAIN_FS = /* glsl */`
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  float a = (1.0 - vUv.x * vUv.x) * vUv.y * (1.0 - vUv.y) * 4.0;
  gl_FragColor = vec4(uColor, a * vA * uAmount * 0.7);
}`;

// Splashes: per instance a ring spreading on the ground and three droplets thrown up from its centre.
const SPLASH_VS = /* glsl */`
attribute vec4 aSplash;
uniform float uTime, uLife;
varying vec3 vUv;
varying float vA;
void main() {
  float age = (uTime - aSplash.w) / uLife;
  vec3 p = aSplash.xyz;
  vec4 mv;
  if (position.z < 0.5) {
    float r = (0.02 + 0.16 * sqrt(max(age, 0.0))) * (0.6 + 0.6 * fract(aSplash.w * 5.13));
    mv = viewMatrix * vec4(p.x + position.x * r, p.y, p.z + position.y * r, 1.0);
    vA = (1.0 - age) * 0.6;
  } else {
    float s = age * uLife;
    float a = position.z * 2.094 + fract(aSplash.w * 7.31) * 6.283;
    float sp = 0.3 + 0.3 * fract(position.z * 0.37 + aSplash.w * 3.1);
    vec3 q = p + vec3(cos(a) * sp * s, (1.4 + 0.2 * position.z) * s - 4.9 * s * s, sin(a) * sp * s);
    mv = viewMatrix * vec4(q, 1.0);
    mv.xy += position.xy * 0.016;
    vA = step(p.y, q.y) * 0.8;
  }
  vA *= step(0.0, age) * step(age, 1.0);
  vUv = position;
  gl_Position = projectionMatrix * mv;
}`;

const SPLASH_FS = /* glsl */`
uniform vec3 uColor;
uniform float uAmount;
varying vec3 vUv;
varying float vA;
void main() {
  float r = length(vUv.xy);
  float a = vUv.z < 0.5 ? smoothstep(0.5, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r)) : 1.0 - smoothstep(0.3, 1.0, r);
  gl_FragColor = vec4(uColor, a * vA * uAmount * 0.6);
}`;

const DROPS = 1600, SPLASHES = 80, SPLASH_LIFE = 0.42;

/** Rain in two draws: GPU-animated streaks and a small batch of ground splashes respawned on the CPU. */
export class Rain {
  constructor(scaleUniform) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.time = 0;
    this.fwd = new THREE.Vector3();
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uLife: { value: SPLASH_LIFE },
      uScale: scaleUniform,
      uColor: { value: new THREE.Color() },
      uAmount: { value: 0 },
    };
    const mat = (vs, fs) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });

    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    sg.setIndex([0, 1, 2, 2, 1, 3]);
    const drops = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) for (let k = 0; k < 4; k++) drops[i * 4 + k] = hash(i, k + 1, 5);
    sg.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
    this.streaks = new THREE.Mesh(sg, mat(RAIN_VS, RAIN_FS));
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 7;

    const pg = new THREE.InstancedBufferGeometry();
    const pos = [], idx = [];
    for (let k = 0; k < 4; k++) {
      pos.push(-1, -1, k, 1, -1, k, -1, 1, k, 1, 1, k);
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3);
    }
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setIndex(idx);
    this.splash = new Float32Array(SPLASHES * 4).fill(-999);
    pg.setAttribute('aSplash', new THREE.InstancedBufferAttribute(this.splash, 4).setUsage(THREE.DynamicDrawUsage));
    this.splashes = new THREE.Mesh(pg, mat(SPLASH_VS, SPLASH_FS));
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 6;
    this.group.add(this.streaks, this.splashes);
  }

  /** amount 0..1; ground(x, z) gives the surface height for splashes. */
  update(amount, dt, focus, camera, ground) {
    this.group.visible = amount > 0.03;
    if (!this.group.visible) return;
    const u = this.uniforms;
    const d = this.splash;
    // Keep the clock small for float precision; splash birth times move with it.
    this.time += dt;
    if (this.time > 1000) {
      this.time -= 1000;
      for (let i = 3; i < d.length; i += 4) d[i] -= 1000;
    }
    camera.getWorldDirection(this.fwd);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const fx = this.fwd.x / fl, fz = this.fwd.z / fl;
    u.uCenter.value.set(focus.x + fx * 3, focus.y + 4.5, focus.z + fz * 3);
    u.uWind.value.set(1.4 * amount, 0.5 * amount);
    u.uTime.value = this.time;
    u.uAmount.value = Math.min(1, amount * 1.4);
    this.streaks.geometry.instanceCount = Math.ceil(DROPS * Math.min(1, amount * 1.2));

    // Splashes land around the spot the camera looks at.
    const n = Math.ceil(SPLASHES * amount);
    const cx = focus.x + fx * 2, cz = focus.z + fz * 2;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (this.time - d[o + 3] < SPLASH_LIFE) continue;
      const x = cx + (Math.random() - 0.5) * 13, z = cz + (Math.random() - 0.5) * 13;
      d[o] = x;
      d[o + 1] = ground(x, z) + 0.03;
      d[o + 2] = z;
      d[o + 3] = this.time + Math.random() * 0.3;
      dirty = true;
    }
    if (dirty) this.splashes.geometry.attributes.aSplash.needsUpdate = true;
    this.splashes.geometry.instanceCount = n;
  }
}
