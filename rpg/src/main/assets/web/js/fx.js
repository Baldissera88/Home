import * as THREE from 'three';
import { hash, RARITY_COLORS } from './defs.js';

/**
 * Everything short-lived the game sends each frame: particles, projectiles, spell zones, shock waves,
 * lightning, meteors, blood and scorch decals, dodge afterimages and loot on the ground.
 * Dynamic lights for the light pool are collected in `lights` every frame.
 */

const tmpColor = new THREE.Color();

/** Kotlin colours arrive as 0xAARRGGBB in sRGB; this sets a linear THREE colour and returns alpha. */
function setArgb(color, v) {
  color.setHex(v & 0xffffff);
  return ((v >>> 24) & 255) / 255;
}

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft beam that fades towards both ends, for loot pillars. */
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  v.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A ring of holy runes for consecration. */
function runeTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  g.strokeStyle = 'rgba(255,240,190,1)';
  g.lineWidth = 3;
  for (const r of [118, 96]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 4;
  for (let i = 0; i < 16; i++) {
    g.save();
    g.rotate(i / 16 * Math.PI * 2);
    g.translate(0, -107);
    g.beginPath();
    const k = i % 4;
    if (k === 0) { g.moveTo(-5, -6); g.lineTo(5, 6); g.moveTo(5, -6); g.lineTo(-5, 6); }
    else if (k === 1) { g.moveTo(0, -7); g.lineTo(0, 7); g.moveTo(-5, -2); g.lineTo(5, -2); }
    else if (k === 2) { g.arc(0, 0, 5, 0, Math.PI * 2); }
    else { g.moveTo(-6, 5); g.lineTo(0, -7); g.lineTo(6, 5); }
    g.stroke();
    g.restore();
  }
  // A star in the middle.
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = i / 6 * Math.PI * 2 * 2 - Math.PI / 2;
    const fn = i === 0 ? 'moveTo' : 'lineTo';
    g[fn](Math.cos(a) * 80, Math.sin(a) * 80);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PARTICLE_VS = `
attribute vec4 aColor;
attribute vec2 aSize;
uniform float uScale;
varying vec4 vColor;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize.x * uScale / max(0.1, -mv.z), 1.0, 256.0);
  vColor = aColor;
  vKind = aSize.y;
}`;

const PARTICLE_FS = `
uniform float uLight;
varying vec4 vColor;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a;
  vec3 c = vColor.rgb;
  if (vKind > 1.5) {
    // smoke: a wide soft puff
    a = exp(-r * r * 3.5) * (1.0 - r * r);
  } else if (vKind > 0.5) {
    // spark: white-hot core inside a coloured halo
    float core = exp(-r * r * 42.0);
    a = exp(-r * r * 7.0) * 0.55 + core;
    c = mix(c * 2.2, vec3(2.4), core);
  } else {
    // dust, blood and debris: soft-edged and lit like the scene around them
    a = smoothstep(1.0, 0.2, r);
    c *= uLight * (1.0 - 0.35 * r);
  }
  if (vKind > 1.5) c *= uLight;
  gl_FragColor = vec4(c, vColor.a * a);
}`;

/** One growable buffer of camera-facing points. */
export class PointBatch {
  constructor(blending, scaleUniform, lightUniform = { value: 1 }) {
    this.capacity = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: scaleUniform, uLight: lightUniform },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.grow(512);
    this.n = 0;
  }

  grow(cap) {
    this.capacity = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
  }

  begin() { this.n = 0; }

  add(x, y, z, r, g, b, a, size, kind) {
    if (this.n >= this.capacity) {
      const old = [this.pos, this.col, this.size];
      this.grow(this.capacity * 2);
      this.pos.set(old[0]);
      this.col.set(old[1]);
      this.size.set(old[2]);
    }
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i * 2] = size; this.size[i * 2 + 1] = kind;
  }

  end() {
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'aColor', 'aSize']) this.geo.attributes[k].needsUpdate = true;
  }
}

/** Keeps a list of objects alive across frames and hides the ones not used this frame. */
class Pool {
  constructor(parent, make) {
    this.parent = parent;
    this.make = make;
    this.items = [];
    this.used = 0;
  }

  begin() { this.used = 0; }

  next() {
    if (this.used >= this.items.length) {
      const o = this.make();
      this.parent.add(o);
      this.items.push(o);
    }
    const o = this.items[this.used++];
    o.visible = true;
    return o;
  }

  end() {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
}

export class Fx {
  constructor(assets, scene) {
    this.assets = assets;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lights = [];
    this.scale = { value: 600 };
    /** How bright unlit particles (dust, smoke, blood) should look in the current light. */
    this.particleLight = { value: 1 };
    this.additive = new PointBatch(THREE.AdditiveBlending, this.scale);
    this.normal = new PointBatch(THREE.NormalBlending, this.scale, this.particleLight);
    this.normal.points.renderOrder = 2;
    this.additive.points.renderOrder = 3;
    this.group.add(this.normal.points, this.additive.points);

    this.glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
    this.discTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.65, 'rgba(255,255,255,0.35)'], [0.92, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    this.beamTex = beamTexture();
    this.runeTex = runeTexture();

    const additiveSprite = () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.renderOrder = 4;
      return s;
    };
    this.halos = new Pool(this.group, additiveSprite);
    const groundQuad = (tex) => () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 1;
      return m;
    };
    this.groundGlows = new Pool(this.group, groundQuad(this.glowTex));
    this.discs = new Pool(this.group, groundQuad(this.discTex));
    this.runes = new Pool(this.group, groundQuad(this.runeTex));
    this.rings = new Pool(this.group, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 1;
      return m;
    });
    this.streaks = new Pool(this.group, () => {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 4;
      return m;
    });
    this.cores = new Pool(this.group, () => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      return m;
    });

    // Lightning: one ribbon geometry rebuilt while bolts are alive.
    this.boltGeo = new THREE.BufferGeometry();
    this.boltPos = new Float32Array(4096 * 3);
    this.boltCol = new Float32Array(4096 * 4);
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setAttribute('color', new THREE.BufferAttribute(this.boltCol, 4).setUsage(THREE.DynamicDrawUsage));
    const boltMesh = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    boltMesh.frustumCulled = false;
    boltMesh.renderOrder = 5;
    this.group.add(boltMesh);

    // Decals: blood (kinds 0-3) and scorch (4), one instanced batch per kind.
    this.decals = [];
    const sheet = assets.texture('tex_decals.png', true, false);
    for (let k = 0; k < 5; k++) {
      const tex = sheet.clone();
      tex.repeat.set(0.2, 1);
      tex.offset.set(k * 0.2, 0);
      tex.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: k < 4 ? 0.25 : 0.95, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, 170);
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.decals.push(mesh);
    }
    this.decalKey = '';

    this.loot = new Map();
    this.sparkles = [];
  }

  /** Sets the pixel scale for particle sizes from the camera and canvas height. */
  resize(height, camera) {
    this.scale.value = height * camera.projectionMatrix.elements[5] * 0.5 * 2.0;
  }

  reset() {
    for (const l of this.loot.values()) this.group.remove(l.root);
    this.loot.clear();
    this.decalKey = '';
    for (const d of this.decals) d.count = 0;
  }

  update(f, dt, t, ground, camera) {
    this.lights.length = 0;
    this.halos.begin();
    this.groundGlows.begin();
    this.discs.begin();
    this.runes.begin();
    this.rings.begin();
    this.streaks.begin();
    this.cores.begin();
    this.additive.begin();
    this.normal.begin();

    this.particles(f, ground);
    this.projectiles(f, ground, t);
    this.zones(f, ground, t);
    this.waves(f, ground);
    this.meteors(f, ground, t);
    this.updateDecals(f, ground);
    this.updateLoot(f, dt, t, ground);
    this.bolts(f, ground, camera);

    this.halos.end();
    this.groundGlows.end();
    this.discs.end();
    this.runes.end();
    this.rings.end();
    this.streaks.end();
    this.cores.end();
    this.additive.end();
    this.normal.end();
  }

  halo(x, y, z, size, color, opacity) {
    const s = this.halos.next();
    s.position.set(x, y, z);
    s.scale.set(size, size, 1);
    s.material.color.copy(color);
    s.material.opacity = opacity;
    return s;
  }

  particles(f, ground) {
    const pa = f.pa;
    for (let i = 0; i + 6 < pa.length; i += 7) {
      const x = pa[i], y = pa[i + 1], z = pa[i + 2], size = pa[i + 3], c = pa[i + 4], fade = pa[i + 5], fl = pa[i + 6];
      const alpha = setArgb(tmpColor, c);
      const h = ground(x, y) + z * 1.4 + 0.05;
      if (fl & 2) {
        // Smoke swells as it ages.
        const grow = 1 + 1.5 * (1 - fade);
        this.normal.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, alpha * fade * 0.8, size * 2 * grow * 1.3, 2);
      } else if (fl & 1) {
        this.additive.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, fade, size * 2 * 2.6, 1);
      } else {
        this.normal.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, alpha * fade, size * 2.4, 0);
      }
    }
  }

  projectiles(f, ground, t) {
    for (const [x, y, vx, vy, c, r, fl] of f.pr) {
      setArgb(tmpColor, c);
      const small = (fl & 1) !== 0, hostile = (fl & 2) !== 0, aoe = (fl & 4) !== 0;
      const h = ground(x, y) + (small ? 0.7 : 0.8);
      const sp = Math.hypot(vx, vy) || 1;
      if (small && !hostile) {
        // Knives and arcane bolts: a hot streak along the flight.
        const s = this.streaks.next();
        s.position.set(x, h, y);
        s.rotation.y = Math.atan2(vx, vy);
        s.scale.set(r * 3.2, 1, 0.9);
        s.material.color.copy(tmpColor);
        s.material.opacity = 0.9;
        this.halo(x, h, y, r * 4, tmpColor, 0.8);
        this.lights.push({ x, y: h, z: y, color: tmpColor.getHex(), radius: 2.5, intensity: 0.8 });
        continue;
      }
      const big = aoe ? 1.4 : 1;
      const core = this.cores.next();
      core.position.set(x, h, y);
      core.scale.setScalar(r * 0.55 * big);
      core.material.color.copy(tmpColor).lerp(WHITE, 0.6).multiplyScalar(2);
      this.halo(x, h, y, r * 7 * big * (1 + 0.08 * Math.sin(t * 30 + x)), tmpColor, 0.95);
      this.halo(x, h, y, r * 2.6 * big, WHITE, 0.9);
      // Trail behind it.
      for (let k = 1; k <= 4; k++) {
        const bx = x - vx / sp * k * 0.18, by = y - vy / sp * k * 0.18;
        this.halo(bx, h, by, r * (6 - k) * big, tmpColor, 0.5 * (1 - k / 5));
      }
      const gg = this.groundGlows.next();
      gg.position.set(x, ground(x, y) + 0.03, y);
      gg.scale.setScalar(r * 6 * big);
      gg.material.color.copy(tmpColor);
      gg.material.opacity = 0.35;
      this.lights.push({ x, y: h, z: y, color: tmpColor.getHex(), radius: aoe ? 6 : 4, intensity: aoe ? 2.5 : 1.6 });
    }
  }

  zones(f, ground, t) {
    for (const [x, y, r, kind, k] of f.zo) {
      const fadeIn = Math.min(1, k * 10), fadeOut = Math.min(1, (1 - k) * 5);
      const a = fadeIn * fadeOut;
      const gy = ground(x, y) + 0.04;
      if (kind === 0) {
        // Consecration: a golden disc, a turning rune circle and motes rising from it.
        const d = this.discs.next();
        d.position.set(x, gy, y);
        d.scale.setScalar(r);
        d.material.color.setHex(0xffc94a).multiplyScalar(0.22);
        d.material.opacity = a;
        const rn = this.runes.next();
        rn.position.set(x, gy + 0.01, y);
        rn.scale.setScalar(r * 1.02);
        rn.rotation.y = t * 0.6;
        rn.material.color.setHex(0xffe8a0).multiplyScalar(0.9);
        rn.material.opacity = a;
        for (let i = 0; i < 18; i++) {
          const ph = (t * 0.5 + hash(i, 7)) % 1;
          const ang = hash(i, 3) * 6.283, rr = Math.sqrt(hash(i, 5)) * r * 0.95;
          tmpColor.setHex(0xffe08a);
          this.additive.add(x + Math.cos(ang) * rr, gy + ph * 1.6, y + Math.sin(ang) * rr, tmpColor.r, tmpColor.g, tmpColor.b, a * Math.sin(ph * Math.PI), 0.16, 1);
        }
        this.lights.push({ x, y: gy + 0.8, z: y, color: 0xffd060, radius: r * 2.2, intensity: 1.6 * a });
      } else {
        // Burning ground: a molten glow with flames licking up.
        const d = this.discs.next();
        d.position.set(x, gy, y);
        d.scale.setScalar(r);
        d.material.color.setHex(0xff5a14).multiplyScalar(0.3 + 0.08 * Math.sin(t * 9 + x));
        d.material.opacity = a;
        for (let i = 0; i < 14; i++) {
          const ph = (t * 1.6 + hash(i, 11, Math.floor(x * 10))) % 1;
          const ang = hash(i, 13) * 6.283, rr = Math.sqrt(hash(i, 17)) * r * 0.9;
          tmpColor.setHex(ph < 0.4 ? 0xffd27a : 0xff6a1a);
          this.additive.add(x + Math.cos(ang) * rr, gy + ph * 1.1, y + Math.sin(ang) * rr, tmpColor.r, tmpColor.g, tmpColor.b, a * (1 - ph), 0.5 * (1 - ph * 0.6), 1);
        }
        this.lights.push({ x, y: gy + 0.6, z: y, color: 0xff7020, radius: r * 2.5, intensity: 2.2 * a });
      }
    }
  }

  waves(f, ground) {
    for (const [x, y, r, c, k] of f.wa) {
      const ring = this.rings.next();
      ring.position.set(x, ground(x, y) + 0.08, y);
      ring.scale.setScalar(Math.max(0.05, r));
      setArgb(ring.material.color, c);
      ring.material.opacity = (1 - k) * 0.75;
      const d = this.groundGlows.next();
      d.position.copy(ring.position);
      d.scale.setScalar(Math.max(0.05, r) * 1.1);
      setArgb(d.material.color, c);
      d.material.opacity = (1 - k) * 0.2;
    }
  }

  meteors(f, ground, t) {
    for (const [x, y, mt] of f.me) {
      const k = 1 - mt / 0.75;
      const gy = ground(x, y) + 0.05;
      const warn = this.discs.next();
      warn.position.set(x, gy, y);
      warn.scale.setScalar(2.3);
      warn.material.color.setHex(0xff3d00).multiplyScalar(0.25 + 0.4 * k);
      warn.material.opacity = 1;
      const ring = this.rings.next();
      ring.position.set(x, gy + 0.02, y);
      ring.scale.setScalar(Math.max(0.05, 2.3 * k));
      ring.material.color.setHex(0xffab40).multiplyScalar(1.5);
      ring.material.opacity = 0.9;
      // The rock itself streaks in from high above.
      const u = 1 - k;
      const mx = x + 3 * u, my = gy + 14 * u + 0.3, mz = y - 4 * u;
      const core = this.cores.next();
      core.position.set(mx, my, mz);
      core.scale.setScalar(0.32);
      core.material.color.setRGB(3, 1.6, 0.6);
      tmpColor.setHex(0xff7a2a);
      this.halo(mx, my, mz, 2.6, tmpColor, 0.95);
      for (let i = 1; i <= 8; i++) {
        const q = i * 0.35;
        this.halo(mx + 3 / 18 * q * 3, my + q * 2.4, mz - 4 / 18 * q * 3, 2.2 - i * 0.2, tmpColor, 0.55 * (1 - i / 9));
      }
      this.lights.push({ x: mx, y: my, z: mz, color: 0xff8030, radius: 9, intensity: 3 * (0.4 + 0.6 * k) });
    }
  }

  updateDecals(f, ground) {
    const dc = f.dc;
    // Decals only change when one is added or the oldest drops off.
    const key = dc.length + ':' + (dc.length ? dc[dc.length - 1][0] + ',' + dc[0][0] : '');
    if (key === this.decalKey) return;
    this.decalKey = key;
    const counts = [0, 0, 0, 0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [x, y, kind, rot, scale] of dc) {
      const mesh = this.decals[kind] || this.decals[0];
      const i = counts[kind]++;
      if (i >= 170) continue;
      p.set(x, ground(x, y) + 0.015, y);
      q.setFromAxisAngle(up, rot * Math.PI / 180);
      s.setScalar(1.1 * scale);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    this.decals.forEach((mesh, k) => {
      mesh.count = Math.min(170, counts[k]);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  bolts(f, ground, camera) {
    let v = 0;
    const pos = this.boltPos, col = this.boltCol;
    const view = new THREE.Vector3();
    const quad = (ax, ay, az, bx, by, bz, w, r, g, b, a) => {
      if (v + 6 > 4096) return;
      view.set((ax + bx) / 2 - camera.position.x, (ay + by) / 2 - camera.position.y, (az + bz) / 2 - camera.position.z);
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      // side = normalize(dir x view) * w
      let sx = dy * view.z - dz * view.y, sy = dz * view.x - dx * view.z, sz = dx * view.y - dy * view.x;
      const l = Math.hypot(sx, sy, sz) || 1;
      sx *= w / l; sy *= w / l; sz *= w / l;
      const pts = [[ax - sx, ay - sy, az - sz], [ax + sx, ay + sy, az + sz], [bx + sx, by + sy, bz + sz], [ax - sx, ay - sy, az - sz], [bx + sx, by + sy, bz + sz], [bx - sx, by - sy, bz - sz]];
      for (const pt of pts) {
        pos[v * 3] = pt[0]; pos[v * 3 + 1] = pt[1]; pos[v * 3 + 2] = pt[2];
        col[v * 4] = r; col[v * 4 + 1] = g; col[v * 4 + 2] = b; col[v * 4 + 3] = a;
        v++;
      }
    };
    for (const [x1, y1, x2, y2, age, seed] of f.bo) {
      const a = Math.max(0, 1 - age / 0.28);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(4, Math.min(22, Math.round(len * 3)));
      const h1 = ground(x1, y1) + 0.9, h2 = ground(x2, y2) + 0.8;
      const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
      const flick = Math.floor(age * 40);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const j = i === 0 || i === n ? 0 : (hash(i, seed, flick) - 0.5) * 0.7;
        const jv = i === 0 || i === n ? 0 : (hash(i, seed + 1, flick) - 0.5) * 0.5;
        pts.push([x1 + (x2 - x1) * u + nx * j, h1 + (h2 - h1) * u + jv, y1 + (y2 - y1) * u + ny * j]);
      }
      for (let i = 0; i < n; i++) {
        const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
        quad(ax, ay, az, bx, by, bz, 0.22, 0.25 * a, 0.5 * a, 1.0 * a, 1);
        quad(ax, ay, az, bx, by, bz, 0.05, 1.6 * a, 1.8 * a, 2.2 * a, 1);
      }
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      this.lights.push({ x: mx, y: (h1 + h2) / 2, z: my, color: 0x9fd0ff, radius: 6, intensity: 3 * a });
    }
    this.boltGeo.setDrawRange(0, v);
    this.boltGeo.attributes.position.needsUpdate = true;
    this.boltGeo.attributes.color.needsUpdate = true;
  }

  // ---- loot on the ground

  makeLoot(kind, rarity, icon) {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    root.add(holder);
    const rc = RARITY_COLORS[rarity] || 0xffffff;
    const out = { root, holder, kind, rarity, spin: 0, glow: null, beam: null, light: null };
    const piece = (kit, name, w) => {
      const p = this.assets.piece(kit, name);
      if (!p) return null;
      const box = p.userData.box;
      const size = box.getSize(new THREE.Vector3());
      const s = w / Math.max(size.x, size.y, size.z);
      p.scale.setScalar(s);
      const c = box.getCenter(new THREE.Vector3());
      p.position.set(-c.x * s, -c.y * s, -c.z * s);
      const g = new THREE.Group();
      g.add(p);
      return g;
    };
    if (kind === 0) {
      const coins = piece('dungeon', 'coin_stack_small', 0.32) || piece('dungeon', 'coin', 0.2);
      if (coins) { coins.position.y = 0.08; holder.add(coins); }
      out.glint = 0xffd54a;
    } else if (kind === 1) {
      holder.add(potion());
      out.light = 0xff3040;
    } else if (kind === 3) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: 0xff7ad8, emissive: 0xff40c0, emissiveIntensity: 2.2, roughness: 0.1 }));
      m.scale.set(1, 1.8, 1);
      m.position.y = 0.55;
      holder.add(m);
      out.spin = 1.6;
      out.bob = true;
      out.light = 0xff60d0;
      out.beamColor = 0xff7ad8;
    } else {
      const item = gearModel(this, icon, piece);
      holder.add(item.obj);
      if (item.flat) {
        // Weapons lie on the ground, turned a little.
        holder.rotation.y = hash(icon, rarity) * 6.28;
      }
    }
    if (kind === 2 && rarity >= 1) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: this.glowTex, color: new THREE.Color(rc).multiplyScalar(0.8), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      g.position.y = 0.03;
      g.renderOrder = 1;
      root.add(g);
      out.glow = g;
      if (rarity >= 2) out.light = rc;
      if (rarity >= 3) out.beamColor = rc;
    }
    if (out.beamColor) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 16, 1, true).translate(0, 1.6, 0),
        new THREE.MeshBasicMaterial({ map: this.beamTex, color: new THREE.Color(out.beamColor).multiplyScalar(1.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      beam.renderOrder = 4;
      root.add(beam);
      out.beam = beam;
    }
    return out;
  }

  updateLoot(f, dt, t, ground) {
    const seen = new Set();
    for (const [uid, kind, x, y, z, rarity, icon] of f.lo) {
      seen.add(uid);
      let l = this.loot.get(uid);
      if (!l) {
        l = this.makeLoot(kind, rarity, icon);
        this.loot.set(uid, l);
        this.group.add(l.root);
      }
      const gy = ground(x, y);
      l.root.position.set(x, gy, y);
      l.holder.position.y = z * 1.3 + (l.bob ? Math.sin(t * 2.5 + uid) * 0.06 : 0);
      if (l.spin) l.holder.rotation.y += dt * l.spin;
      if (z > 0.02) l.holder.rotation.x += dt * 9; else l.holder.rotation.x = 0;
      if (l.glow) l.glow.scale.setScalar(0.9 + 0.1 * Math.sin(t * 3 + uid));
      if (l.beam) l.beam.material.opacity = 0.65 + 0.25 * Math.sin(t * 2 + uid);
      if (l.glint && Math.sin(t * 1.3 + uid * 1.7) > 0.96) {
        tmpColor.setHex(0xffffff);
        this.additive.add(x + 0.05, gy + 0.2, y, 1, 1, 1, 1, 0.25, 1);
      }
      if (l.light) this.lights.push({ x, y: gy + 0.5, z: y, color: l.light, radius: 2.5, intensity: 0.9, minor: true });
    }
    for (const [uid, l] of this.loot) {
      if (!seen.has(uid)) {
        this.group.remove(l.root);
        this.loot.delete(uid);
      }
    }
  }
}

const WHITE = new THREE.Color(1, 1, 1);

function potion() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xff2a3a, emissive: 0x900010, emissiveIntensity: 1.2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.88 });
  const flask = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), glass);
  flask.position.y = 0.11;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.09, 12), glass);
  neck.position.y = 0.24;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 }));
  cork.position.y = 0.3;
  for (const m of [flask, neck, cork]) { m.castShadow = true; g.add(m); }
  return g;
}

/** A 3D stand-in for each item icon. Weapons use the adventurers' kit; armour pieces are built here. */
function gearModel(fx, icon, piece) {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc040, roughness: 0.25, metalness: 1 });
  const lay = (obj, w) => {
    if (!obj) return null;
    const g = new THREE.Group();
    obj.rotation.z = Math.PI / 2;
    g.add(obj);
    obj.position.y = 0.05;
    obj.scale.multiplyScalar(w);
    return g;
  };
  const mesh = (geo, mat, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    return m;
  };
  switch (icon) {
    case 0: return { obj: lay(piece('weapons', 'sword_1h', 0.8), 1), flat: true };
    case 1: return { obj: lay(piece('weapons', 'axe_1h', 0.7), 1), flat: true };
    case 9: return { obj: lay(piece('weapons', 'dagger', 0.5), 1), flat: true };
    case 11: return { obj: lay(piece('weapons', 'staff', 1.0), 1), flat: true };
    case 12: {
      const s = piece('weapons', 'shield_round', 0.55);
      if (s) { s.rotation.x = -Math.PI / 2 + 0.25; s.position.y = 0.08; }
      return { obj: s || new THREE.Group(), flat: true };
    }
    case 2: { // mace
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 8).rotateZ(Math.PI / 2), leather, 0.05));
      const head = mesh(new THREE.IcosahedronGeometry(0.08, 0), metal, 0.07);
      head.position.x = 0.27;
      g.add(head);
      return { obj: g, flat: true };
    }
    case 10: { // spear
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 1.0, 8).rotateZ(Math.PI / 2), leather, 0.04));
      const tip = mesh(new THREE.ConeGeometry(0.04, 0.18, 8).rotateZ(-Math.PI / 2), metal, 0.04);
      tip.position.x = 0.58;
      g.add(tip);
      return { obj: g, flat: true };
    }
    case 3: { // helm
      const g = new THREE.Group();
      g.add(mesh(new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0.02));
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.12, 0.17), metal, 0.1));
      g.children[1].position.z = 0.1;
      return { obj: g };
    }
    case 14: { // hood
      return { obj: mesh(new THREE.ConeGeometry(0.15, 0.3, 14), new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.95 }), 0.15) };
    }
    case 4: case 15: { // body armour, plate or leather
      const g = new THREE.Group();
      const m = icon === 4 ? metal : leather;
      const torso = mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.32, 14, 1), m, 0.16);
      torso.scale.z = 0.62;
      torso.rotation.x = -Math.PI / 2;
      torso.position.y = 0.07;
      g.add(torso);
      return { obj: g };
    }
    case 5: { // boots
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const b = mesh(new THREE.BoxGeometry(0.09, 0.16, 0.08), leather, 0.08);
        b.position.x = s * 0.06;
        const toe = mesh(new THREE.BoxGeometry(0.09, 0.06, 0.1), leather, 0.03);
        toe.position.set(s * 0.06, 0.03, 0.08);
        g.add(b, toe);
      }
      return { obj: g };
    }
    case 13: { // gloves
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const b = mesh(new THREE.BoxGeometry(0.1, 0.04, 0.16), leather, 0.02);
        b.position.x = s * 0.08;
        b.rotation.y = s * 0.3;
        g.add(b);
      }
      return { obj: g };
    }
    case 6: case 7: { // amulet, ring
      const g = new THREE.Group();
      const band = mesh(new THREE.TorusGeometry(icon === 7 ? 0.06 : 0.11, icon === 7 ? 0.015 : 0.008, 8, 28).rotateX(Math.PI / 2), gold, 0.02);
      g.add(band);
      const gem = mesh(new THREE.OctahedronGeometry(icon === 7 ? 0.03 : 0.045), new THREE.MeshStandardMaterial({ color: 0x40a0ff, emissive: 0x2060ff, emissiveIntensity: 1.5, roughness: 0.1 }), 0.05);
      gem.position.z = icon === 7 ? 0.06 : 0.11;
      g.add(gem);
      return { obj: g };
    }
    case 16: { // scroll
      return { obj: mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8d8b0, roughness: 0.9 }), 0.04), flat: true };
    }
    case 8: return { obj: potion() };
    default: return { obj: mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), metal, 0.1) };
  }
}
