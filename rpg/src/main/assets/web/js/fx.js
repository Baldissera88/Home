import * as THREE from 'three';
import { hash, RARITY_COLORS } from './defs.js';

/**
 * Everything short-lived the game sends each frame: particles, projectiles, spell zones, shock waves,
 * lightning, meteors, blood and scorch decals, dodge afterimages and loot on the ground.
 * Dynamic lights for the light pool are collected in `lights` every frame.
 *
 * Per frame this costs a fixed handful of draw calls: glows are one instanced batch, each kind of
 * ground mark is one instanced mesh, and nothing in the update allocates.
 */

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
/** The camera's view this frame: batched effects skip copies outside it, as separate meshes were culled. */
const view = new THREE.Frustum();

/** Particles whose sprite would come out smaller than this many pixels are skipped. */
const MIN_PARTICLE_PX = 1;
/** Past this many particles a frame, the smallest on screen are dropped first. */
const PARTICLE_BUDGET = 1200;
/** No glow halo grows wider than this share of the screen's height (they are additive, so fill rate). */
const HALO_SCREEN_CAP = 0.3;
const BOLT_VERTS = 4096;
const BOLT_MAX_POINTS = 23;
const DECALS_PER_KIND = 170;

/** Whether a sphere at (x, y, z) of radius r reaches into the view. */
function inView(x, y, z, r) {
  const planes = view.planes;
  for (let i = 0; i < 6; i++) {
    const p = planes[i], n = p.normal;
    if (n.x * x + n.y * y + n.z * z + p.constant < -r) return false;
  }
  return true;
}

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
      const pos = this.pos, col = this.col, size0 = this.size;
      this.grow(this.capacity * 2);
      this.pos.set(pos);
      this.col.set(col);
      this.size.set(size0);
    }
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i * 2] = size; this.size[i * 2 + 1] = kind;
  }

  end() {
    this.geo.setDrawRange(0, this.n);
    const at = this.geo.attributes;
    at.position.needsUpdate = true;
    at.aColor.needsUpdate = true;
    at.aSize.needsUpdate = true;
  }
}

const HALO_VS = `
attribute vec4 aPos;
attribute vec4 aColor;
attribute vec2 aCore;
uniform float uCap;
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vCore;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
  // Never wider than uCap of the screen height: a glow right in front of the lens would flood it.
  float size = min(aPos.w, uCap * 2.0 * max(0.0, -mvPosition.z) / projectionMatrix[1][1]);
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy * 2.0;
  vColor = aColor;
  vCore = aCore;
  #include <fog_vertex>
}`;

const HALO_FS = `
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vCore;
#include <fog_pars_fragment>
// The glow texture's falloff: 1 in the middle, 0.75 at a fifth of the radius, 0.18 at half, 0 at the rim.
float glow(float r) {
  return r < 0.2 ? 1.0 - 1.25 * r : r < 0.5 ? 0.75 - 1.9 * (r - 0.2) : max(0.0, 0.36 * (1.0 - r));
}
void main() {
  float r = length(vUv);
  float a = glow(r) * vColor.a;
  float core = vCore.y > 0.0 ? glow(r / vCore.y) * vCore.x : 0.0;
  // Premultiplied and added: the coloured halo plus a white-hot core, in one pass over the pixels.
  vec3 col = vColor.rgb * a + core;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor * (a + core), fogFactor);
  #endif
  gl_FragColor = vec4(col, a + core);
}`;

/**
 * Camera-facing additive glows, all drawn in one call. Each is a coloured halo with an optional
 * white-hot core inside it, which costs one quad instead of two overlapping sprites.
 */
class HaloBatch {
  constructor(parent, cap = 64) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uCap: { value: HALO_SCREEN_CAP } },
      vertexShader: HALO_VS,
      fragmentShader: HALO_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
    this.n = 0;
    this.grow(cap);
  }

  grow(cap) {
    const old = this.mesh.geometry;
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    const attr = (name, size, prev) => {
      const a = new Float32Array(cap * size);
      if (prev) a.set(prev);
      g.setAttribute(name, new THREE.InstancedBufferAttribute(a, size).setUsage(THREE.DynamicDrawUsage));
      return a;
    };
    this.pos = attr('aPos', 4, this.pos);
    this.col = attr('aColor', 4, this.col);
    this.core = attr('aCore', 2, this.core);
    g.instanceCount = 0;
    old.dispose();
    this.mesh.geometry = g;
    this.capacity = cap;
  }

  begin() { this.n = 0; }

  /** A glow `size` wide; `core` > 0 adds a white centre of that opacity, `coreSize` wide. */
  add(x, y, z, size, color, opacity, core = 0, coreSize = 0) {
    if (!inView(x, y, z, size * 0.71)) return;
    if (this.n >= this.capacity) this.grow(this.capacity * 2);
    const i = this.n++;
    const p = this.pos, c = this.col, k = this.core;
    p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = z; p[i * 4 + 3] = size;
    c[i * 4] = color.r; c[i * 4 + 1] = color.g; c[i * 4 + 2] = color.b; c[i * 4 + 3] = opacity;
    k[i * 2] = core; k[i * 2 + 1] = core > 0 && size > 0 ? coreSize / size : 0;
  }

  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    const at = g.attributes;
    at.aPos.needsUpdate = true;
    at.aColor.needsUpdate = true;
    at.aCore.needsUpdate = true;
  }
}

/** Lets an instanced MeshBasicMaterial fade each copy on its own through the aOpacity attribute. */
function instanceOpacity(shader) {
  shader.vertexShader = shader.vertexShader.replace('void main() {', 'attribute float aOpacity;\nvarying float vOpacity;\nvoid main() {\n  vOpacity = aOpacity;');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'varying float vOpacity;\nvoid main() {')
    .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vOpacity;');
}

/**
 * Copies of one mesh drawn in a single call, each with its own place, turn about the vertical,
 * scale, colour and (for transparent materials) opacity. Grows as needed.
 */
class Instances {
  constructor(parent, geo, mat, renderOrder, cap = 16) {
    this.fades = mat.transparent;
    if (this.fades) mat.onBeforeCompile = instanceOpacity;
    this.geo = geo;
    geo.computeBoundingSphere();
    /** Reach of one unscaled copy from its origin, for culling. */
    this.reach = geo.boundingSphere.radius + geo.boundingSphere.center.length();
    this.mesh = new THREE.InstancedMesh(geo, mat, 1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.n = 0;
    this.capacity = 0;
    this.alloc(cap);
  }

  alloc(cap) {
    const m = this.mesh;
    const mat = new Float32Array(cap * 16), col = new Float32Array(cap * 3), op = new Float32Array(cap);
    if (this.capacity) {
      mat.set(this.matrices);
      col.set(this.col);
      op.set(this.op);
      // Frees the old instance buffers on the GPU; they are uploaded again at the new size.
      m.dispose();
      this.geo.dispose();
    }
    m.instanceMatrix = new THREE.InstancedBufferAttribute(mat, 16).setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    if (this.fades) this.geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(op, 1).setUsage(THREE.DynamicDrawUsage));
    this.matrices = mat;
    this.col = col;
    this.op = op;
    this.capacity = cap;
  }

  begin() { this.n = 0; }

  /** Adds a copy at (x, y, z), turned by `rot` about the vertical and scaled by (sx, sy, sz). */
  add(x, y, z, rot, sx, sy, sz, color, opacity = 1) {
    if (!inView(x, y, z, this.reach * Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz)))) return;
    if (this.n >= this.capacity) this.alloc(this.capacity * 2);
    const i = this.n++;
    const e = this.matrices, o = i * 16;
    const c = rot ? Math.cos(rot) : 1, s = rot ? Math.sin(rot) : 0;
    e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = s * sz; e[o + 9] = 0; e[o + 10] = c * sz; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.op[i] = opacity;
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (!this.n) return;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    if (this.fades) this.geo.attributes.aOpacity.needsUpdate = true;
  }
}

export class Fx {
  constructor(assets, scene) {
    this.assets = assets;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lights = [];
    /** Light records handed out by light(), reused from frame to frame. */
    this.lightPool = [];
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

    this.halos = new HaloBatch(this.group);
    // Ground-aligned additive marks: one instanced mesh per texture, each copy a 2 x 2 quad.
    const ground = (tex, offset = true) => new Instances(this.group, new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: offset, polygonOffsetFactor: offset ? -2 : 0 }), 1);
    this.groundGlows = ground(this.glowTex);
    this.discs = ground(this.discTex);
    this.runes = ground(this.runeTex);
    // Glows under loot sit a hair below the item, so they must not be pulled in front of it.
    this.lootGlows = ground(this.glowTex, false);
    // Additive light does not care about draw order, so double-sided ones take one pass instead of two.
    this.rings = new Instances(this.group, new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }), 1);
    this.streaks = new Instances(this.group, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
      new THREE.MeshBasicMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }), 4);
    this.cores = new Instances(this.group, new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0);
    this.beams = new Instances(this.group, new THREE.CylinderGeometry(0.16, 0.24, 3.2, 16, 1, true).translate(0, 1.6, 0),
      new THREE.MeshBasicMaterial({ map: this.beamTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }), 4);
    this.batches = [this.groundGlows, this.lootGlows, this.discs, this.runes, this.rings, this.streaks, this.cores, this.beams];

    // Lightning: one ribbon geometry rebuilt while bolts are alive.
    this.boltGeo = new THREE.BufferGeometry();
    this.boltPos = new Float32Array(BOLT_VERTS * 3);
    this.boltCol = new Float32Array(BOLT_VERTS * 4);
    this.boltPts = new Float32Array(BOLT_MAX_POINTS * 3);
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setAttribute('color', new THREE.BufferAttribute(this.boltCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.boltMesh = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
    this.boltMesh.frustumCulled = false;
    this.boltMesh.renderOrder = 5;
    this.boltMesh.visible = false;
    this.group.add(this.boltMesh);

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
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, DECALS_PER_KIND);
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.decals.push(mesh);
    }
    this.decalCounts = new Int32Array(5);
    this.decalN = -1;
    this.decalFirst = 0;
    this.decalLast = 0;

    this.loot = new Map();
    this.lootStamp = 0;
    this.sparkles = [];
  }

  /** Sets the pixel scale for particle sizes from the camera and canvas height. */
  resize(height, camera) {
    this.scale.value = height * camera.projectionMatrix.elements[5] * 0.5 * 2.0;
  }

  reset() {
    for (const l of this.loot.values()) this.group.remove(l.root);
    this.loot.clear();
    this.decalN = -1;
    for (const d of this.decals) { d.count = 0; d.visible = false; }
  }

  update(f, dt, t, ground, camera) {
    this.lights.length = 0;
    camera.updateMatrixWorld();
    view.setFromProjectionMatrix(tmpMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.halos.begin();
    const batches = this.batches;
    for (let i = 0; i < batches.length; i++) batches[i].begin();
    this.additive.begin();
    this.normal.begin();

    this.particles(f, ground, camera);
    this.projectiles(f, ground, t);
    this.zones(f, ground, t);
    this.waves(f, ground);
    this.meteors(f, ground, t);
    this.updateDecals(f, ground);
    this.updateLoot(f, dt, t, ground);
    this.bolts(f, ground, camera);

    this.halos.end();
    for (let i = 0; i < batches.length; i++) batches[i].end();
    this.additive.end();
    this.normal.end();
    this.additive.points.visible = this.additive.n > 0;
    this.normal.points.visible = this.normal.n > 0;
  }

  /** Queues a dynamic light for the light pool. The records are reused, so read them the same frame. */
  light(x, y, z, color, radius, intensity, minor = false) {
    let l = this.lightPool[this.lights.length];
    if (!l) {
      l = { x: 0, y: 0, z: 0, color: 0, radius: 0, intensity: 0, minor: false };
      this.lightPool.push(l);
    }
    l.x = x; l.y = y; l.z = z;
    l.color = color;
    l.radius = radius;
    l.intensity = intensity;
    l.minor = minor;
    this.lights.push(l);
    return l;
  }

  /** A camera-facing glow; `core` > 0 adds a white-hot centre `coreSize` wide. */
  halo(x, y, z, size, color, opacity, core = 0, coreSize = 0) {
    this.halos.add(x, y, z, size, color, opacity, core, coreSize);
  }

  particles(f, ground, camera) {
    const pa = f.pa;
    const cam = camera.position, cx = cam.x, cy = cam.y, cz = cam.z;
    // Specks too small to see are skipped; past the budget the cut-off rises, so the particles
    // that are smallest on screen (the far ones) go first.
    const minPx = MIN_PARTICLE_PX * Math.max(1, pa.length / 7 / PARTICLE_BUDGET);
    const minPx2 = minPx * minPx, scale2 = this.scale.value * this.scale.value;
    for (let i = 0; i + 6 < pa.length; i += 7) {
      const x = pa[i], y = pa[i + 1], z = pa[i + 2], size = pa[i + 3], c = pa[i + 4], fade = pa[i + 5], fl = pa[i + 6];
      const h = ground(x, y) + z * 1.4 + 0.05;
      const kind = fl & 2 ? 2 : fl & 1 ? 1 : 0;
      const px = kind === 2 ? size * 2 * (1 + 1.5 * (1 - fade)) * 1.3 : kind === 1 ? size * 2 * 2.6 : size * 2.4;
      const dx = x - cx, dy = h - cy, dz = y - cz;
      if (px * px * scale2 < minPx2 * (dx * dx + dy * dy + dz * dz)) continue;
      const alpha = setArgb(tmpColor, c);
      if (kind === 2) {
        // Smoke swells as it ages.
        this.normal.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, alpha * fade * 0.8, px, 2);
      } else if (kind === 1) {
        this.additive.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, fade, px, 1);
      } else {
        this.normal.add(x, h, y, tmpColor.r, tmpColor.g, tmpColor.b, alpha * fade, px, 0);
      }
    }
  }

  projectiles(f, ground, t) {
    const pr = f.pr;
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i];
      const x = p[0], y = p[1], vx = p[2], vy = p[3], c = p[4], r = p[5], fl = p[6];
      setArgb(tmpColor, c);
      const rgb = c & 0xffffff;
      const small = (fl & 1) !== 0, hostile = (fl & 2) !== 0, aoe = (fl & 4) !== 0;
      const gy = ground(x, y);
      const h = gy + (small ? 0.7 : 0.8);
      const sp = Math.hypot(vx, vy) || 1;
      if (small && !hostile) {
        // Knives and arcane bolts: a hot streak along the flight.
        this.streaks.add(x, h, y, Math.atan2(vx, vy), r * 3.2, 1, 0.9, tmpColor, 0.9);
        this.halos.add(x, h, y, r * 4, tmpColor, 0.8);
        this.light(x, h, y, rgb, 2.5, 0.8);
        continue;
      }
      const big = aoe ? 1.4 : 1;
      const rad = r * 0.55 * big;
      this.cores.add(x, h, y, 0, rad, rad, rad, tmpColor2.copy(tmpColor).lerp(WHITE, 0.6).multiplyScalar(2));
      // The coloured glow with its white-hot middle in one quad.
      this.halos.add(x, h, y, r * 7 * big * (1 + 0.08 * Math.sin(t * 30 + x)), tmpColor, 0.95, 0.9, r * 2.6 * big);
      // Trail behind it.
      for (let k = 1; k <= 4; k++) {
        const bx = x - vx / sp * k * 0.18, by = y - vy / sp * k * 0.18;
        this.halos.add(bx, h, by, r * (6 - k) * big, tmpColor, 0.5 * (1 - k / 5));
      }
      const gs = r * 6 * big;
      this.groundGlows.add(x, gy + 0.03, y, 0, gs, gs, gs, tmpColor, 0.35);
      this.light(x, h, y, rgb, aoe ? 6 : 4, aoe ? 2.5 : 1.6);
    }
  }

  zones(f, ground, t) {
    const zo = f.zo;
    for (let i = 0; i < zo.length; i++) {
      const zn = zo[i];
      const x = zn[0], y = zn[1], r = zn[2], kind = zn[3], k = zn[4];
      const fadeIn = Math.min(1, k * 10), fadeOut = Math.min(1, (1 - k) * 5);
      const a = fadeIn * fadeOut;
      const gy = ground(x, y) + 0.04;
      if (kind === 0) {
        // Consecration: a golden disc, a turning rune circle and motes rising from it.
        this.discs.add(x, gy, y, 0, r, r, r, tmpColor.setHex(0xffc94a).multiplyScalar(0.22), a);
        const rr = r * 1.02;
        this.runes.add(x, gy + 0.01, y, t * 0.6, rr, rr, rr, tmpColor.setHex(0xffe8a0).multiplyScalar(0.9), a);
        tmpColor.setHex(0xffe08a);
        for (let j = 0; j < 18; j++) {
          const ph = (t * 0.5 + hash(j, 7)) % 1;
          const ang = hash(j, 3) * 6.283, d = Math.sqrt(hash(j, 5)) * r * 0.95;
          this.additive.add(x + Math.cos(ang) * d, gy + ph * 1.6, y + Math.sin(ang) * d, tmpColor.r, tmpColor.g, tmpColor.b, a * Math.sin(ph * Math.PI), 0.16, 1);
        }
        this.light(x, gy + 0.8, y, 0xffd060, r * 2.2, 1.6 * a);
      } else {
        // Burning ground: a molten glow with flames licking up.
        this.discs.add(x, gy, y, 0, r, r, r, tmpColor.setHex(0xff5a14).multiplyScalar(0.3 + 0.08 * Math.sin(t * 9 + x)), a);
        const seed = Math.floor(x * 10);
        for (let j = 0; j < 14; j++) {
          const ph = (t * 1.6 + hash(j, 11, seed)) % 1;
          const ang = hash(j, 13) * 6.283, d = Math.sqrt(hash(j, 17)) * r * 0.9;
          tmpColor.setHex(ph < 0.4 ? 0xffd27a : 0xff6a1a);
          this.additive.add(x + Math.cos(ang) * d, gy + ph * 1.1, y + Math.sin(ang) * d, tmpColor.r, tmpColor.g, tmpColor.b, a * (1 - ph), 0.5 * (1 - ph * 0.6), 1);
        }
        this.light(x, gy + 0.6, y, 0xff7020, r * 2.5, 2.2 * a);
      }
    }
  }

  waves(f, ground) {
    const wa = f.wa;
    for (let i = 0; i < wa.length; i++) {
      const w = wa[i];
      const x = w[0], y = w[1], r = Math.max(0.05, w[2]), k = w[4];
      const gy = ground(x, y) + 0.08;
      setArgb(tmpColor, w[3]);
      this.rings.add(x, gy, y, 0, r, r, r, tmpColor, (1 - k) * 0.75);
      const gs = r * 1.1;
      this.groundGlows.add(x, gy, y, 0, gs, gs, gs, tmpColor, (1 - k) * 0.2);
    }
  }

  meteors(f, ground, t) {
    const me = f.me;
    for (let i = 0; i < me.length; i++) {
      const m = me[i];
      const x = m[0], y = m[1];
      const k = 1 - m[2] / 0.75;
      const gy = ground(x, y) + 0.05;
      this.discs.add(x, gy, y, 0, 2.3, 2.3, 2.3, tmpColor.setHex(0xff3d00).multiplyScalar(0.25 + 0.4 * k), 1);
      const rs = Math.max(0.05, 2.3 * k);
      this.rings.add(x, gy + 0.02, y, 0, rs, rs, rs, tmpColor.setHex(0xffab40).multiplyScalar(1.5), 0.9);
      // The rock itself streaks in from high above.
      const u = 1 - k;
      const mx = x + 3 * u, my = gy + 14 * u + 0.3, mz = y - 4 * u;
      this.cores.add(mx, my, mz, 0, 0.32, 0.32, 0.32, tmpColor.setRGB(3, 1.6, 0.6));
      tmpColor.setHex(0xff7a2a);
      this.halos.add(mx, my, mz, 2.6, tmpColor, 0.95);
      for (let j = 1; j <= 8; j++) {
        const q = j * 0.35;
        this.halos.add(mx + 3 / 18 * q * 3, my + q * 2.4, mz - 4 / 18 * q * 3, 2.2 - j * 0.2, tmpColor, 0.55 * (1 - j / 9));
      }
      this.light(mx, my, mz, 0xff8030, 9, 3 * (0.4 + 0.6 * k));
    }
  }

  updateDecals(f, ground) {
    const dc = f.dc;
    // Decals only change when one is added or the oldest drops off.
    const n = dc.length;
    const first = n ? dc[0][0] : 0, last = n ? dc[n - 1][0] : 0;
    if (n === this.decalN && first === this.decalFirst && last === this.decalLast) return;
    this.decalN = n;
    this.decalFirst = first;
    this.decalLast = last;
    const counts = this.decalCounts;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const d = dc[i];
      const x = d[0], y = d[1], kind = this.decals[d[2]] ? d[2] : 0;
      const j = counts[kind]++;
      if (j >= DECALS_PER_KIND) continue;
      tmpPos.set(x, ground(x, y) + 0.015, y);
      tmpQuat.setFromAxisAngle(UP, d[3] * Math.PI / 180);
      tmpScale.setScalar(1.1 * d[4]);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      this.decals[kind].setMatrixAt(j, tmpMat);
    }
    for (let k = 0; k < this.decals.length; k++) {
      const mesh = this.decals[k];
      mesh.count = Math.min(DECALS_PER_KIND, counts[k]);
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  bolts(f, ground, camera) {
    let v = 0;
    const bo = f.bo, pts = this.boltPts, cam = camera.position;
    for (let b = 0; b < bo.length; b++) {
      const e = bo[b];
      const x1 = e[0], y1 = e[1], x2 = e[2], y2 = e[3], age = e[4], seed = e[5];
      const a = Math.max(0, 1 - age / 0.28);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(4, Math.min(BOLT_MAX_POINTS - 1, Math.round(len * 3)));
      const h1 = ground(x1, y1) + 0.9, h2 = ground(x2, y2) + 0.8;
      const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
      const flick = Math.floor(age * 40);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const j = i === 0 || i === n ? 0 : (hash(i, seed, flick) - 0.5) * 0.7;
        const jv = i === 0 || i === n ? 0 : (hash(i, seed + 1, flick) - 0.5) * 0.5;
        pts[i * 3] = x1 + (x2 - x1) * u + nx * j;
        pts[i * 3 + 1] = h1 + (h2 - h1) * u + jv;
        pts[i * 3 + 2] = y1 + (y2 - y1) * u + ny * j;
      }
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        // A wide blue glow, then the white-hot thread inside it.
        v = this.boltQuad(v, cam, pts[o], pts[o + 1], pts[o + 2], pts[o + 3], pts[o + 4], pts[o + 5], 0.22, 0.25 * a, 0.5 * a, 1.0 * a);
        v = this.boltQuad(v, cam, pts[o], pts[o + 1], pts[o + 2], pts[o + 3], pts[o + 4], pts[o + 5], 0.05, 1.6 * a, 1.8 * a, 2.2 * a);
      }
      this.light((x1 + x2) / 2, (h1 + h2) / 2, (y1 + y2) / 2, 0x9fd0ff, 6, 3 * a);
    }
    this.boltGeo.setDrawRange(0, v);
    this.boltMesh.visible = v > 0;
    if (!v) return;
    this.boltGeo.attributes.position.needsUpdate = true;
    this.boltGeo.attributes.color.needsUpdate = true;
  }

  /** One camera-facing ribbon segment from a to b, `w` either side, as two triangles; returns the next vertex. */
  boltQuad(v, cam, ax, ay, az, bx, by, bz, w, r, g, b) {
    if (v + 6 > BOLT_VERTS) return v;
    const vx = (ax + bx) / 2 - cam.x, vy = (ay + by) / 2 - cam.y, vz = (az + bz) / 2 - cam.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    // side = normalize(dir x view) * w
    let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
    const l = w / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    sx *= l; sy *= l; sz *= l;
    this.boltVert(v, ax - sx, ay - sy, az - sz, r, g, b);
    this.boltVert(v + 1, ax + sx, ay + sy, az + sz, r, g, b);
    this.boltVert(v + 2, bx + sx, by + sy, bz + sz, r, g, b);
    this.boltVert(v + 3, ax - sx, ay - sy, az - sz, r, g, b);
    this.boltVert(v + 4, bx + sx, by + sy, bz + sz, r, g, b);
    this.boltVert(v + 5, bx - sx, by - sy, bz - sz, r, g, b);
    return v + 6;
  }

  boltVert(v, x, y, z, r, g, b) {
    const pos = this.boltPos, col = this.boltCol;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    col[v * 4] = r; col[v * 4 + 1] = g; col[v * 4 + 2] = b; col[v * 4 + 3] = 1;
  }

  // ---- loot on the ground

  makeLoot(kind, rarity, icon) {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    root.add(holder);
    const rc = RARITY_COLORS[rarity] || 0xffffff;
    const out = { root, holder, kind, rarity, spin: 0, glow: null, beam: null, light: null, stamp: 0 };
    const piece = (kit, name, w) => {
      const p = this.assets.piece(kit, name);
      if (!p) return null;
      const box = p.userData.box;
      const size = box.getSize(tmpPos);
      const s = w / Math.max(size.x, size.y, size.z);
      p.scale.setScalar(s);
      const c = box.getCenter(tmpPos);
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
      const m = new THREE.Mesh(shared('gemGeo', () => new THREE.OctahedronGeometry(0.12, 0)),
        shared('gemMat', () => new THREE.MeshStandardMaterial({ color: 0xff7ad8, emissive: 0xff40c0, emissiveIntensity: 2.2, roughness: 0.1 })));
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
      // A glow on the ground under it, drawn with the other loot glows.
      out.glow = new THREE.Color(rc).multiplyScalar(0.8);
      if (rarity >= 2) out.light = rc;
      if (rarity >= 3) out.beamColor = rc;
    }
    // A pillar of light, drawn with the other beams.
    if (out.beamColor) out.beam = new THREE.Color(out.beamColor).multiplyScalar(1.4);
    return out;
  }

  updateLoot(f, dt, t, ground) {
    const stamp = ++this.lootStamp;
    const lo = f.lo;
    for (let i = 0; i < lo.length; i++) {
      const e = lo[i];
      const uid = e[0], x = e[2], y = e[3], z = e[4];
      let l = this.loot.get(uid);
      if (!l) {
        l = this.makeLoot(e[1], e[5], e[6]);
        this.loot.set(uid, l);
        this.group.add(l.root);
      }
      l.stamp = stamp;
      const gy = ground(x, y);
      l.root.position.set(x, gy, y);
      l.holder.position.y = z * 1.3 + (l.bob ? Math.sin(t * 2.5 + uid) * 0.06 : 0);
      if (l.spin) l.holder.rotation.y += dt * l.spin;
      if (z > 0.02) l.holder.rotation.x += dt * 9; else l.holder.rotation.x = 0;
      if (l.glow) {
        const s = (0.9 + 0.1 * Math.sin(t * 3 + uid)) * 0.5;
        this.lootGlows.add(x, gy + 0.03, y, 0, s, s, s, l.glow, 1);
      }
      if (l.beam) this.beams.add(x, gy, y, 0, 1, 1, 1, l.beam, 0.65 + 0.25 * Math.sin(t * 2 + uid));
      if (l.glint && Math.sin(t * 1.3 + uid * 1.7) > 0.96) this.additive.add(x + 0.05, gy + 0.2, y, 1, 1, 1, 1, 0.25, 1);
      if (l.light) this.light(x, gy + 0.5, y, l.light, 2.5, 0.9, true);
    }
    // Items picked up or gone: only look for them when the counts disagree.
    if (this.loot.size !== lo.length) {
      for (const [uid, l] of this.loot) {
        if (l.stamp !== stamp) {
          this.group.remove(l.root);
          this.loot.delete(uid);
        }
      }
    }
  }
}

/** Geometries and materials for loot models, made once and shared by every item on the ground. */
const SHARED = {};
function shared(key, make) {
  return SHARED[key] || (SHARED[key] = make());
}

function potion() {
  const g = new THREE.Group();
  const glass = shared('glass', () => new THREE.MeshStandardMaterial({ color: 0xff2a3a, emissive: 0x900010, emissiveIntensity: 1.2, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.88 }));
  const flask = new THREE.Mesh(shared('flask', () => new THREE.SphereGeometry(0.11, 18, 14)), glass);
  flask.position.y = 0.11;
  const neck = new THREE.Mesh(shared('neck', () => new THREE.CylinderGeometry(0.035, 0.045, 0.09, 12)), glass);
  neck.position.y = 0.24;
  const cork = new THREE.Mesh(shared('cork', () => new THREE.CylinderGeometry(0.038, 0.034, 0.05, 10)),
    shared('corkMat', () => new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 })));
  cork.position.y = 0.3;
  for (const m of [flask, neck, cork]) { m.castShadow = true; g.add(m); }
  return g;
}

/** A 3D stand-in for each item icon. Weapons use the adventurers' kit; armour pieces are built here. */
function gearModel(fx, icon, piece) {
  const metal = shared('metal', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85 }));
  const leather = shared('leather', () => new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.8 }));
  const gold = shared('gold', () => new THREE.MeshStandardMaterial({ color: 0xffc040, roughness: 0.25, metalness: 1 }));
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
      g.add(mesh(shared('maceShaft', () => new THREE.CylinderGeometry(0.02, 0.025, 0.5, 8).rotateZ(Math.PI / 2)), leather, 0.05));
      const head = mesh(shared('maceHead', () => new THREE.IcosahedronGeometry(0.08, 0)), metal, 0.07);
      head.position.x = 0.27;
      g.add(head);
      return { obj: g, flat: true };
    }
    case 10: { // spear
      const g = new THREE.Group();
      g.add(mesh(shared('spearShaft', () => new THREE.CylinderGeometry(0.018, 0.02, 1.0, 8).rotateZ(Math.PI / 2)), leather, 0.04));
      const tip = mesh(shared('spearTip', () => new THREE.ConeGeometry(0.04, 0.18, 8).rotateZ(-Math.PI / 2)), metal, 0.04);
      tip.position.x = 0.58;
      g.add(tip);
      return { obj: g, flat: true };
    }
    case 3: { // helm
      const g = new THREE.Group();
      g.add(mesh(shared('helm', () => new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), metal, 0.02));
      g.add(mesh(shared('helmNose', () => new THREE.BoxGeometry(0.03, 0.12, 0.17)), metal, 0.1));
      g.children[1].position.z = 0.1;
      return { obj: g };
    }
    case 14: { // hood
      return { obj: mesh(shared('hood', () => new THREE.ConeGeometry(0.15, 0.3, 14)),
        shared('hoodMat', () => new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.95 })), 0.15) };
    }
    case 4: case 15: { // body armour, plate or leather
      const g = new THREE.Group();
      const m = icon === 4 ? metal : leather;
      const torso = mesh(shared('torso', () => new THREE.CylinderGeometry(0.17, 0.13, 0.32, 14, 1)), m, 0.16);
      torso.scale.z = 0.62;
      torso.rotation.x = -Math.PI / 2;
      torso.position.y = 0.07;
      g.add(torso);
      return { obj: g };
    }
    case 5: { // boots
      const g = new THREE.Group();
      const leg = shared('bootLeg', () => new THREE.BoxGeometry(0.09, 0.16, 0.08));
      const foot = shared('bootToe', () => new THREE.BoxGeometry(0.09, 0.06, 0.1));
      for (const s of [-1, 1]) {
        const b = mesh(leg, leather, 0.08);
        b.position.x = s * 0.06;
        const toe = mesh(foot, leather, 0.03);
        toe.position.set(s * 0.06, 0.03, 0.08);
        g.add(b, toe);
      }
      return { obj: g };
    }
    case 13: { // gloves
      const g = new THREE.Group();
      const hand = shared('glove', () => new THREE.BoxGeometry(0.1, 0.04, 0.16));
      for (const s of [-1, 1]) {
        const b = mesh(hand, leather, 0.02);
        b.position.x = s * 0.08;
        b.rotation.y = s * 0.3;
        g.add(b);
      }
      return { obj: g };
    }
    case 6: case 7: { // amulet, ring
      const g = new THREE.Group();
      const ring = icon === 7;
      const band = mesh(shared(ring ? 'ringBand' : 'amuletBand', () => new THREE.TorusGeometry(ring ? 0.06 : 0.11, ring ? 0.015 : 0.008, 8, 28).rotateX(Math.PI / 2)), gold, 0.02);
      g.add(band);
      const gem = mesh(shared(ring ? 'ringGem' : 'amuletGem', () => new THREE.OctahedronGeometry(ring ? 0.03 : 0.045)),
        shared('jewel', () => new THREE.MeshStandardMaterial({ color: 0x40a0ff, emissive: 0x2060ff, emissiveIntensity: 1.5, roughness: 0.1 })), 0.05);
      gem.position.z = ring ? 0.06 : 0.11;
      g.add(gem);
      return { obj: g };
    }
    case 16: { // scroll
      return { obj: mesh(shared('scroll', () => new THREE.CylinderGeometry(0.04, 0.04, 0.3, 12).rotateZ(Math.PI / 2)),
        shared('paper', () => new THREE.MeshStandardMaterial({ color: 0xe8d8b0, roughness: 0.9 })), 0.04), flat: true };
    }
    case 8: return { obj: potion() };
    default: return { obj: mesh(shared('box', () => new THREE.BoxGeometry(0.2, 0.2, 0.2)), metal, 0.1) };
  }
}
