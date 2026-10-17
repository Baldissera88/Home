import * as THREE from 'three';
import { NOISE_GLSL } from './terrain.js';
import { PointBatch } from './fx.js';
import { hash } from './defs.js';

/**
 * Time of day, weather and light: a procedural sky with sun, moon, clouds and stars, the sun's
 * shadow-casting light, a hemisphere fill, fog, a pool of point lights for fires and magic,
 * an environment map for reflections, rain, fireflies and dust motes.
 */

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 50.0, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */`
uniform vec3 uSun, uMoon, uZenith, uHorizon, uSunColor, uGround;
uniform float uTime, uNight, uCloud, uRain;
varying vec3 vDir;
${NOISE_GLSL}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * tNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  // Sun: a hot disc and a wide forward-scattering glow.
  float sd = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 90.0) * 1.2) * (1.0 - uRain * 0.8);
  col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 30.0 * (1.0 - uCloud * 0.7);
  // Moon and stars at night.
  float md = max(dot(d, uMoon), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9990, 0.9994, md) * 6.0 + pow(md, 60.0) * 0.15) * uNight;
  if (h > 0.0) {
    vec3 cell = floor(d * 280.0);
    float s = hash3(cell);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 50.0);
    col += vec3(0.9, 0.95, 1.0) * step(0.9975, s) * tw * uNight * 2.2 * smoothstep(0.0, 0.25, h) * (1.0 - uCloud);
  }
  // Clouds: two drifting layers projected onto a dome.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6;
    float c = fbm(uv + vec2(uTime * 0.012, uTime * 0.004));
    float c2 = fbm(uv * 2.3 - vec2(uTime * 0.02, 0.0));
    float cover = mix(0.56, 0.3, uCloud);
    float m = smoothstep(cover, cover + 0.22, c * 0.75 + c2 * 0.35);
    float lit = 0.75 + 0.5 * pow(sd, 3.0);
    vec3 cloud = mix(uHorizon * 1.15, uSunColor * 0.6 + uZenith * 0.5, 0.35) * lit;
    cloud = mix(cloud, vec3(0.38, 0.4, 0.44) * (0.2 + 0.8 * (1.0 - uNight)), uRain * 0.8);
    col = mix(col, cloud, m * smoothstep(0.0, 0.18, h) * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const lerpColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

const DUNGEON = {
  CRYPT: { fog: 0x0a0c12, fogDensity: 0.06, hemiSky: 0x5a6680, hemiGround: 0x1a1612, hemi: 0.8, key: 0x8090b0, keyI: 0.5, lantern: 0xffc488 },
  CAVE: { fog: 0x0c0a07, fogDensity: 0.05, hemiSky: 0x7a7060, hemiGround: 0x2a2018, hemi: 1.1, key: 0xb0a088, keyI: 0.7, lantern: 0xffc080 },
  HELL: { fog: 0x1a0602, fogDensity: 0.055, hemiSky: 0x803020, hemiGround: 0x200804, hemi: 0.7, key: 0xff7040, keyI: 0.45, lantern: 0xffa070 },
};

export class Atmosphere {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const size = quality.shadowMap;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    this.shadowSpan = quality.shadowSpan;
    cam.left = -this.shadowSpan; cam.right = this.shadowSpan; cam.top = this.shadowSpan; cam.bottom = -this.shadowSpan;
    cam.near = 1; cam.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 0.8);
    scene.add(this.hemi);

    this.pool = [];
    for (let i = 0; i < quality.pointLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.6);
      l.userData.level = 0;
      scene.add(l);
      this.pool.push(l);
    }
    // The hero carries a soft light below ground; useful in dark dungeons.
    this.lantern = new THREE.PointLight(0xffc488, 0, 7, 1.4);
    scene.add(this.lantern);

    this.skyUniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCloud: { value: 0 },
      uRain: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.envKey = -1;

    this.fog = new THREE.FogExp2(0x000000, 0.02);
    scene.fog = this.fog;

    this.motes = new PointBatch(THREE.AdditiveBlending, { value: 600 });
    this.motes.points.renderOrder = 6;
    scene.add(this.motes.points);
    this.rain = this.makeRain();
    scene.add(this.rain);
    this.sunDir = new THREE.Vector3();
    this.flash = 0;
  }

  makeRain() {
    const n = 1400;
    const pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb0c8, transparent: true, opacity: 0.35, depthWrite: false }));
    lines.frustumCulled = false;
    lines.userData.drops = Array.from({ length: n }, (_, i) => [hash(i, 1) * 30 - 15, hash(i, 2) * 14, hash(i, 3) * 30 - 15, 0.8 + hash(i, 4) * 0.4]);
    lines.visible = false;
    return lines;
  }

  setPointScale(v) { this.motes.mat.uniforms.uScale.value = v; }

  /** Switches between the open world and the underground look. */
  setLevel(world) {
    this.world = world;
    this.outdoors = world.outdoors;
    this.biome = world.biome;
    if (this.outdoors) {
      this.scene.add(this.sky);
      this.scene.background = null;
    } else {
      this.scene.remove(this.sky);
      const d = DUNGEON[this.biome] || DUNGEON.CRYPT;
      this.scene.background = new THREE.Color(d.fog);
      this.updateEnvironment(true);
    }
    this.envKey = -1;
    for (const l of this.pool) { l.intensity = 0; l.userData.src = null; }
  }

  /** Re-renders the reflection map from the sky when the light has changed enough to notice. */
  updateEnvironment(dungeon) {
    if (this.envTarget) this.envTarget.dispose();
    if (dungeon) {
      const d = DUNGEON[this.biome] || DUNGEON.CRYPT;
      const env = new THREE.Scene();
      env.background = new THREE.Color(d.hemiSky).multiplyScalar(0.25);
      this.envTarget = this.pmrem.fromScene(env, 0, 0.1, 100);
      this.scene.environmentIntensity = 0.35;
    } else {
      this.envSky.scale.setScalar(50);
      this.envTarget = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 100);
      this.scene.environmentIntensity = 0.55;
    }
    this.scene.environment = this.envTarget.texture;
  }

  update(f, dt, t, focus, camera, fx) {
    if (fx) fx.particleLight.value = this.outdoors ? 0.35 + 0.65 * f.dl : 0.45;
    if (this.outdoors) this.updateOutdoors(f, t, focus);
    else this.updateDungeon(f, t, focus);
    this.placeShadow(focus, camera);
    this.assignLights(f, t, focus, fx);
    this.updateRain(f, dt, focus);
    this.updateMotes(f, t, focus);
  }

  updateOutdoors(f, t, focus) {
    const phase = t * Math.PI * 2 / 360;
    const day = f.dl;
    const rain = f.rn;
    // The sun climbs to 62 degrees at noon and sets in the west; at night the moon takes over.
    const elev = Math.asin(Math.max(-1, Math.min(1, Math.cos(phase)))) * 0.69;
    const az = phase + 0.6;
    const sun = this.sunDir.set(-Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev) * 0.9 + 0.35).normalize();
    const moon = new THREE.Vector3(-sun.x, Math.abs(sun.y) * 0.9 + 0.25, -sun.z).normalize();
    const night = THREE.MathUtils.smoothstep(-sun.y, -0.05, 0.2);
    const dusk = Math.max(0, 1 - Math.abs(sun.y) / 0.32);

    const zenith = lerpColor(0x2a5fae, 0x4a5462, rain).lerp(new THREE.Color(0x0a1426), night);
    const horizon = lerpColor(0xa8c4e0, 0x7a828c, rain).lerp(new THREE.Color(0xf09a5a), dusk * (1 - night) * 0.75 * (1 - rain)).lerp(new THREE.Color(0x0b1424), night);
    const sunColor = lerpColor(0xfff2dc, 0xff8a40, dusk);
    const u = this.skyUniforms;
    u.uSun.value.copy(sun);
    u.uMoon.value.copy(moon);
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uGround.value.copy(horizon).multiplyScalar(0.6);
    u.uSunColor.value.copy(sunColor);
    u.uTime.value = t;
    u.uNight.value = night;
    u.uCloud.value = Math.min(1, 0.15 + rain * 0.9);
    u.uRain.value = rain;

    // Key light: the sun by day, a cold moon at night.
    const lightDir = night > 0.5 ? moon : sun;
    this.keyDir = lightDir;
    const sunI = (1 - night) * Math.min(1, Math.max(0, sun.y) * 4) * (1 - rain * 0.65);
    const moonI = night * 1.1;
    if (night > 0.5) this.sun.color.setHex(0x8aa4e0); else this.sun.color.copy(sunColor);
    this.sun.intensity = night > 0.5 ? moonI : 3.0 * sunI + 0.05;
    this.hemi.color.copy(zenith).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.setHex(0x5a4a36).lerp(new THREE.Color(0x1a2232), night);
    this.hemi.intensity = 0.8 + 0.5 * day - 0.15 * rain;

    const fogCol = horizon.clone().lerp(zenith, 0.15);
    this.fog.color.copy(fogCol);
    this.fog.density = 0.012 + f.fg * 0.09 + rain * 0.012 + night * 0.012;
    this.lantern.intensity = night * 3.5;
    this.lantern.color.setHex(0xffc488);
    this.lantern.position.set(focus.x, focus.y + 2.2, focus.z);

    if (this.world && this.world.water) {
      const w = this.world.water.material.uniforms;
      w.uSun.value.copy(lightDir);
      w.uSunColor.value.copy(this.sun.color).multiplyScalar(night > 0.5 ? 0.5 : 1);
      w.uSky.value.copy(zenith);
      w.uHorizon.value.copy(horizon);
      w.uLight.value = 0.25 + 0.75 * day;
    }
    // Refresh reflections as the light changes over the day.
    const key = Math.round(day * 12) + Math.round(rain * 4) * 100;
    if (key !== this.envKey) {
      this.envKey = key;
      this.updateEnvironment(false);
    }
  }

  updateDungeon(f, t, focus) {
    const d = DUNGEON[this.biome] || DUNGEON.CRYPT;
    this.keyDir = (this.keyDir0 ||= new THREE.Vector3(0.35, 1, 0.55).normalize());
    this.sun.color.setHex(d.key);
    this.sun.intensity = d.keyI;
    this.hemi.color.setHex(d.hemiSky);
    this.hemi.groundColor.setHex(d.hemiGround);
    this.hemi.intensity = d.hemi;
    this.fog.color.setHex(d.fog);
    this.fog.density = d.fogDensity + f.fg * 0.05;
    this.lantern.color.setHex(d.lantern);
    this.lantern.intensity = 5;
    this.lantern.distance = 10;
    this.lantern.position.set(focus.x, focus.y + 2.4, focus.z + 0.4);
  }

  /** The shadow camera follows the hero, snapped to whole shadow texels so edges do not crawl. */
  placeShadow(focus, camera) {
    const dir = this.keyDir;
    const span = this.shadowSpan;
    // Centre a little ahead of the hero, where the camera looks.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const cx = focus.x + fwd.x * span * 0.45, cz = focus.z + fwd.z * span * 0.45;
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(cx / texel) * texel, sz = Math.round(cz / texel) * texel;
    this.sun.target.position.set(sx, focus.y, sz);
    this.sun.position.set(sx + dir.x * 40, focus.y + dir.y * 40, sz + dir.z * 40);
    this.sun.target.updateMatrixWorld();
  }

  /** Gives the pool's point lights to the brightest light sources near the hero. */
  assignLights(f, t, focus, fx) {
    const cands = [];
    const consider = (l) => {
      const dx = l.x - focus.x, dz = l.z - focus.z;
      const d2 = dx * dx + dz * dz;
      const reach = (l.radius || 5) + 9;
      if (d2 > reach * reach) return;
      cands.push({ l, score: d2 / ((l.intensity || 1) * (l.minor ? 0.4 : 1)) });
    };
    if (this.world) for (const l of this.world.lights) consider(l);
    if (fx) for (const l of fx.lights) consider(l);
    cands.sort((a, b) => a.score - b.score);
    const dayDim = this.outdoors ? 1 - 0.75 * f.dl : 1;
    for (let i = 0; i < this.pool.length; i++) {
      const pl = this.pool[i];
      const c = cands[i];
      if (!c) { pl.intensity = 0; continue; }
      const l = c.l;
      let k = 1;
      if (l.flicker) {
        const s = (l.x * 3.7 + l.z * 1.3) % 10;
        k = 0.82 + 0.1 * Math.sin(t * 9.1 + s) + 0.08 * Math.sin(t * 23.3 + s * 3.1);
      }
      pl.color.setHex(l.color);
      pl.position.set(l.x, l.y, l.z);
      pl.distance = (l.radius || 5) * 1.5;
      pl.decay = 1.5;
      pl.intensity = (l.intensity || 1) * 3.2 * k * dayDim;
    }
  }

  updateRain(f, dt, focus) {
    const r = this.outdoors ? f.rn : 0;
    this.rain.visible = r > 0.03;
    if (!this.rain.visible) return;
    this.rain.material.opacity = 0.18 + r * 0.3;
    const pos = this.rain.geometry.attributes.position.array;
    const drops = this.rain.userData.drops;
    const count = Math.floor(drops.length * Math.min(1, r * 1.2));
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d[1] -= dt * 16 * d[3];
      if (d[1] < 0) d[1] += 14;
      const px = focus.x + d[0], z = focus.z + d[2], y = focus.y + d[1] - 2;
      const o = i * 6;
      if (i >= count) { pos[o + 1] = pos[o + 4] = -999; continue; }
      pos[o] = px; pos[o + 1] = y; pos[o + 2] = z;
      pos[o + 3] = px + 0.08; pos[o + 4] = y - 0.55; pos[o + 5] = z + 0.05;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  updateMotes(f, t, focus) {
    const m = this.motes;
    m.begin();
    const c = new THREE.Color();
    if (this.outdoors) {
      // Fireflies after dusk.
      const night = 1 - f.dl;
      if (night > 0.45 && f.rn < 0.3) {
        c.setHex(0xc8ff60);
        for (let i = 0; i < 40; i++) {
          const ph = t * 0.3 + hash(i, 9) * 10;
          const x = focus.x + (hash(i, 1) - 0.5) * 22 + Math.sin(ph * 1.3) * 0.8;
          const z = focus.z + (hash(i, 2) - 0.5) * 22 + Math.cos(ph) * 0.8;
          const blink = Math.max(0, Math.sin(t * 2 + i * 1.7));
          m.add(x, focus.y + 0.4 + hash(i, 3) * 1.2 + Math.sin(ph * 2) * 0.2, z, c.r, c.g, c.b, blink * (night - 0.45) * 1.8, 0.14, 1);
        }
      }
    } else {
      // Dust hanging in the torchlight.
      c.setHex(this.biome === 'HELL' ? 0xff9a50 : 0xd8c8a8);
      for (let i = 0; i < 70; i++) {
        const ph = t * 0.08 + hash(i, 9) * 10;
        const x = focus.x + (((hash(i, 1) * 18 + Math.sin(ph) * 0.6) % 18) - 9);
        const z = focus.z + (((hash(i, 2) * 18 + Math.cos(ph * 0.7) * 0.6) % 18) - 9);
        const y = focus.y + ((hash(i, 3) * 2.4 + t * 0.05 * (this.biome === 'HELL' ? 4 : 1)) % 2.4);
        m.add(x, y, z, c.r, c.g, c.b, 0.25 + 0.2 * Math.sin(t + i), this.biome === 'HELL' ? 0.06 : 0.035, 1);
      }
    }
    m.end();
  }
}
