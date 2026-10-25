import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { enhanceCharacter } from './charmat.js';

/**
 * The desert's monsters: the giant scorpion, the mummy, the djinn and the Sand Pharaoh. Each is built once from
 * procedural parts hung on a bone rig, folded into one skinned mesh per material (an opaque body, plus a
 * transparent layer for smoke and auras), and copied per monster with its own bones and materials.
 *
 * One body material carries every surface of a creature: per-vertex colour, plus a per-vertex aSurf
 * (roughness, metalness, glow, texture amount), so chitin, gold, linen, skin and glowing eyes share a draw.
 */

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const IDENTITY = new THREE.Matrix4();
const _v = new V3(), _w = new V3(), _n = new V3();
const _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

/** Eases 0..1 in and out. */
function ease(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/** A quick strike curve over u in 0..1: snaps to 1 by `peak`, then eases back to 0. */
function strikeCurve(u, peak = 0.3) {
  if (u <= 0 || u >= 1) return 0;
  return u < peak ? ease(u / peak) : 1 - ease((u - peak) / (1 - peak));
}

/** Small deterministic noise in 0..1 from three numbers. */
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Materials: per-vertex surface on top of the characters' rim light.

/** How much of the characters' rim light the creatures take. */
const RIM_K = 0.7;
const SURF_VS_HEAD = '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;';
const SURF_VS_BODY = '#include <begin_vertex>\nvSurf = aSurf;';
const SURF_FS_HEAD = '#include <common>\nvarying vec4 vSurf;\nuniform float uGlow;';
const SURF_MAP = `#ifdef USE_MAP
  diffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), vSurf.w);
#endif`;

/** Gives a creature's own body material the rim light and the per-vertex surface; call again on every clone. */
function hook(m) {
  enhanceCharacter(m);
  const rim = m.onBeforeCompile;
  const glow = { value: m.userData.glow ? m.userData.glow.value : 1 };
  m.userData.glow = glow;
  m.onBeforeCompile = (s, r) => {
    s.uniforms.uGlow = glow;
    s.vertexShader = s.vertexShader.replace('#include <common>', SURF_VS_HEAD).replace('#include <begin_vertex>', SURF_VS_BODY);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', SURF_FS_HEAD)
      .replace('#include <map_fragment>', SURF_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vSurf.y;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(nonPerturbedNormal, normal, vSurf.w));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uGlow;');
    rim(s, r);
    // Thin legs and tails are mostly edge, and dark chitin or rags would turn pale under the full rim: it is
    // softer here and follows the surface colour.
    s.fragmentShader = s.fragmentShader.replace('outgoingLight += uRim * rim * (0.65 + 0.35 * diffuseColor.rgb)', 'outgoingLight += uRim * rim * RIM_K * (0.15 + 0.85 * diffuseColor.rgb)');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n#define RIM_K ${RIM_K.toFixed(2)}`);
  };
  m.customProgramCacheKey = () => 'desertSurf';
  return m;
}

function bodyMaterial(opts = {}) {
  const Ctor = opts.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new Ctor({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1, ...opts });
}

function fxMaterial(additive) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers.

function ell(rx, ry, rz, w = 14, h = 10) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}

/** The top half of an ellipsoid. */
function dome(rx, ry, rz, w = 14, h = 6) {
  return new THREE.SphereGeometry(1, w, h, 0, TAU, 0, Math.PI / 2).scale(rx, ry, rz);
}

/** Moves every vertex by fn(p) (p is changed in place) and smooths the normals again. */
function warp(g, fn) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    fn(_v);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return smoothNormals(g);
}

/** Vertex normals averaged over vertices that share a position, so UV seams and poles shade smoothly. */
function smoothNormals(g) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, sums = new Map(), keys = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    keys.push(k);
    const s = sums.get(k);
    if (s) s.add(_n.fromBufferAttribute(n, i)); else sums.set(k, new V3().fromBufferAttribute(n, i));
  }
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(keys[i]);
    _n.copy(s).normalize();
    n.setXYZ(i, _n.x, _n.y, _n.z);
  }
  return g;
}

/**
 * A tube along the points, radius a number or r(t) over its length (t 0..1), its cross-section stretched by
 * flat = [along the first normal (up by default), along the binormal]. uv: u around, v in length units.
 */
function loft(pts, radius, { radial = 8, flat = [1, 1], caps = true, up = null } = {}) {
  const n = pts.length, T = [], N = [], B = [], s = [0];
  for (let i = 0; i < n; i++) {
    T.push(new V3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize());
    if (i > 0) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  const len = s[n - 1] || 1;
  const nrm = up ? up.clone() : Math.abs(T[0].y) < 0.9 ? new V3(0, 1, 0) : new V3(0, 0, 1);
  nrm.addScaledVector(T[0], -nrm.dot(T[0])).normalize();
  const axis = new V3();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      axis.crossVectors(T[i - 1], T[i]);
      const l = axis.length();
      if (l > 1e-6) nrm.applyAxisAngle(axis.divideScalar(l), Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)));
    }
    N.push(nrm.clone());
    B.push(new V3().crossVectors(T[i], nrm).normalize());
  }
  const R = (i) => (typeof radius === 'function' ? radius(s[i] / len) : radius);
  const pos = [], nor = [], uv = [], idx = [];
  const rn = new V3();
  for (let i = 0; i < n; i++) {
    const r = R(i);
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    const slope = (R(i1) - R(i0)) / Math.max(1e-6, s[i1] - s[i0]);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), sn = Math.sin(a);
      pos.push(
        pts[i].x + (N[i].x * c * flat[0] + B[i].x * sn * flat[1]) * r,
        pts[i].y + (N[i].y * c * flat[0] + B[i].y * sn * flat[1]) * r,
        pts[i].z + (N[i].z * c * flat[0] + B[i].z * sn * flat[1]) * r,
      );
      rn.set(0, 0, 0).addScaledVector(N[i], c / flat[0]).addScaledVector(B[i], sn / flat[1]).normalize().addScaledVector(T[i], -slope).normalize();
      nor.push(rn.x, rn.y, rn.z);
      uv.push(j / radial, s[i]);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (caps) {
    for (const end of [0, n - 1]) {
      if (R(end) < 1e-4) continue;
      const c = pos.length / 3, t = T[end], k = end === 0 ? -1 : 1;
      pos.push(pts[end].x, pts[end].y, pts[end].z);
      nor.push(t.x * k, t.y * k, t.z * k);
      uv.push(0.5, s[end]);
      for (let j = 0; j < radial; j++) {
        const a = end * row + j;
        if (k > 0) idx.push(a, a + 1, c); else idx.push(a + 1, a, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Points of a quadratic Bezier from a through control c to b. */
function bend(a, c, b, n = 6) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(new V3(
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
    ));
  }
  return out;
}

/** A straight run of n+1 points from a to b. */
function line(a, b, n = 4) {
  return bend(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b, n);
}

// ---------------------------------------------------------------------------------------------------------------
// The rig: bones, parts painted and bound to them, merged per layer; then cheap copies.

const KEEP = ['position', 'normal', 'uv', 'color', 'aSurf', 'skinIndex', 'skinWeight'];

class Rig {
  constructor() {
    this.top = new THREE.Group();
    this.list = [];
    this.by = {};
    this.layers = new Map();
  }

  /** A bone at (x, y, z) in its parent (none: the creature's root), turned by Euler (rx, ry, rz). */
  bone(name, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    b.rotation.set(rx, ry, rz);
    (parent ? this.by[parent] : this.top).add(b);
    b.userData.i = this.list.length;
    this.list.push(b);
    this.by[name] = b;
    return b;
  }

  /**
   * Adds geometry g, placed in bone `name` by o.at / o.rot / o.scale, to a layer ('body' by default).
   * o.color, o.rough, o.metal, o.glow, o.tex, o.alpha set the surface; o.paint(v) may change v.c (Color),
   * v.s ([rough, metal, glow, tex]) and v.a per vertex from v.lp (in the bone), v.wp (in the creature), v.n
   * and v.uv; o.faces paints whole triangles (crisp stripes). o.skin(wp, lp) can spread a vertex over bones:
   * [[name, weight], ...]. o.uv = [su, sv] scales the texture coordinates.
   */
  add(g, name, o = {}) {
    const layer = o.layer || 'body';
    if (o.faces && g.index) g = g.toNonIndexed();
    if (!g.index) {
      const n = g.attributes.position.count, idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(idx);
    }
    const count = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    if (o.uv) {
      const uv = g.attributes.uv;
      for (let i = 0; i < count; i++) uv.setXY(i, uv.getX(i) * o.uv[0], uv.getY(i) * o.uv[1]);
    }
    const r = o.rot || [0, 0, 0], sc = o.scale || [1, 1, 1], at = o.at || [0, 0, 0];
    g.applyMatrix4(_m.compose(_v.set(at[0], at[1], at[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])), _w.set(sc[0], sc[1], sc[2])));
    const local = g.attributes.position.clone();
    this.top.updateMatrixWorld(true);
    const bone = this.by[name];
    g.applyMatrix4(bone.matrixWorld);
    const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const alpha = layer !== 'body';
    const colors = new Float32Array(count * (alpha ? 4 : 3)), surf = new Float32Array(count * 4);
    const base = new THREE.Color(o.color ?? 0xffffff);
    const v = { lp: new V3(), wp: new V3(), n: new V3(), uv: new THREE.Vector2(), c: new THREE.Color(), s: [0, 0, 0, 0], a: 1 };
    const paintOne = (i) => {
      v.c.copy(base);
      v.s[0] = o.rough ?? 0.8; v.s[1] = o.metal ?? 0; v.s[2] = o.glow ?? 0; v.s[3] = o.tex ?? 0;
      v.a = o.alpha ?? 1;
      if (o.paint) o.paint(v);
    };
    const store = (i) => {
      const k = alpha ? 4 : 3;
      colors[i * k] = v.c.r; colors[i * k + 1] = v.c.g; colors[i * k + 2] = v.c.b;
      if (alpha) colors[i * k + 3] = v.a;
      surf.set(v.s, i * 4);
    };
    if (o.faces) {
      for (let f = 0; f < count; f += 3) {
        v.lp.set(0, 0, 0); v.wp.set(0, 0, 0); v.n.set(0, 0, 0); v.uv.set(0, 0);
        for (let k = 0; k < 3; k++) {
          v.lp.add(_v.fromBufferAttribute(local, f + k));
          v.wp.add(_v.fromBufferAttribute(p, f + k));
          v.n.add(_v.fromBufferAttribute(nrm, f + k));
          v.uv.x += uv.getX(f + k) / 3; v.uv.y += uv.getY(f + k) / 3;
        }
        v.lp.divideScalar(3); v.wp.divideScalar(3); v.n.normalize();
        paintOne(f);
        for (let k = 0; k < 3; k++) store(f + k);
      }
    } else {
      for (let i = 0; i < count; i++) {
        v.lp.fromBufferAttribute(local, i);
        v.wp.fromBufferAttribute(p, i);
        v.n.fromBufferAttribute(nrm, i);
        v.uv.fromBufferAttribute(uv, i);
        paintOne(i);
        store(i);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, alpha ? 4 : 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
    const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4);
    const own = bone.userData.i;
    for (let i = 0; i < count; i++) {
      if (!o.skin) {
        si[i * 4] = own;
        sw[i * 4] = 1;
        continue;
      }
      const list = o.skin(_v.fromBufferAttribute(p, i), _w.fromBufferAttribute(local, i));
      let sum = 0;
      for (let k = 0; k < list.length && k < 4; k++) sum += list[k][1];
      for (let k = 0; k < list.length && k < 4; k++) {
        si[i * 4 + k] = this.by[list[k][0]].userData.i;
        sw[i * 4 + k] = list[k][1] / (sum || 1);
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    let list = this.layers.get(layer);
    if (!list) this.layers.set(layer, list = []);
    list.push(g);
    return g;
  }

  /** Merges each layer and records the bind pose; the rig can then hand out copies. */
  finish() {
    this.top.updateMatrixWorld(true);
    this.inverses = this.list.map((b) => b.matrixWorld.clone().invert());
    this.defs = this.list.map((b) => ({ name: b.name, parent: b.parent && b.parent.isBone ? b.parent.userData.i : -1, p: b.position.clone(), q: b.quaternion.clone() }));
    this.merged = [];
    this.layers.forEach((list, layer) => {
      const g = mergeGeometries(list);
      g.userData.shared = true;
      this.merged.push({ layer, geometry: g, triangles: g.index.count / 3 });
    });
    this.triangles = this.merged.reduce((t, m) => t + m.triangles, 0);
    return this;
  }

  /** A copy with its own bones (by name, each remembering its rest pose in userData.rest) on the given materials. */
  instance(materials) {
    const top = new THREE.Group(), bones = [], by = {};
    for (const d of this.defs) {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.copy(d.p);
      b.quaternion.copy(d.q);
      b.userData.rest = { p: d.p.clone(), r: b.rotation.clone() };
      bones.push(b);
      by[d.name] = b;
    }
    this.defs.forEach((d, i) => (d.parent < 0 ? top : bones[d.parent]).add(bones[i]));
    const skeleton = new THREE.Skeleton(bones, this.inverses);
    const meshes = [];
    for (const { layer, geometry } of this.merged) {
      const mesh = new THREE.SkinnedMesh(geometry, materials[layer]);
      mesh.bind(skeleton, IDENTITY);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = layer === 'body';
      if (layer !== 'body') mesh.renderOrder = 2;
      top.add(mesh);
      meshes.push(mesh);
    }
    return { top, bones: by, meshes, skeleton };
  }
}

/** Sets a bone's rotation to its rest pose turned by (x, y, z). */
function turn(b, x = 0, y = 0, z = 0) {
  const r = b.userData.rest.r;
  b.rotation.set(r.x + x, r.y + y, r.z + z);
}

/** Sets a bone's position to its rest position moved by (x, y, z). */
function shift(b, x = 0, y = 0, z = 0) {
  const p = b.userData.rest.p;
  b.position.set(p.x + x, p.y + y, p.z + z);
}

// ---------------------------------------------------------------------------------------------------------------
// The live creature: shared state tracking; each kind animates its own bones.

class Creature {
  constructor(tpl, uid) {
    this.tpl = tpl;
    this.mats = {};
    for (const [k, m] of Object.entries(tpl.materials)) {
      const c = m.clone();
      if (k === 'body') hook(c);
      this.mats[k] = c;
    }
    const inst = tpl.rig.instance(this.mats);
    this.root = new THREE.Group();
    inst.top.scale.setScalar(tpl.scale || 1);
    this.root.add(inst.top);
    this.b = inst.bones;
    this.meshes = inst.meshes;
    this.height = tpl.height;
    this.blob = tpl.blob;
    this.mats = Object.values(this.mats);
    this.body = this.mats[0];
    this.time = (uid * 1.618) % 10;
    this.phase = (uid * 2.39) % TAU;
    this.speed = 0;
    this.lastX = NaN;
    this.lastY = 0;
    this.dist = 0;
    this.spent = 0;
    this.lastWind = 0;
    /** Seconds since the last blow was let go (-1: none), and since a cast began (-1: none). */
    this.strikeT = -1;
    this.castT = -1;
    this.walk = 0;
    this.deadT = -1;
    this.fade = 1;
  }

  /** Ground speed in tiles per second, from the positions the game sends (as the Animator measures it). */
  track(x, y, dt) {
    if (this.lastX === this.lastX) {
      const dx = x - this.lastX, dy = y - this.lastY, d = Math.sqrt(dx * dx + dy * dy);
      const keep = Math.exp(-dt / 0.2);
      this.dist = this.dist * keep + (d < 2 ? d : 0);
      this.spent = this.spent * keep + dt;
      this.speed = this.spent > 0 ? this.dist / this.spent : 0;
    }
    this.lastX = x;
    this.lastY = y;
  }

  /** One animation step: s = { x, y, moving, wind, stunned, frozen, cast }. */
  tick(dt, s) {
    this.track(s.x, s.y, dt);
    this.time += dt;
    if (this.lastWind > 0 && s.wind <= 0 && !s.stunned) this.strikeT = 0;
    else if (this.strikeT >= 0) this.strikeT += dt;
    if (this.strikeT > 1.2) this.strikeT = -1;
    if (s.cast && this.castT < 0) this.castT = 0;
    else if (this.castT >= 0) this.castT += dt;
    if (this.castT > this.castLength) this.castT = -1;
    this.lastWind = s.wind;
    const want = s.moving ? 1 : 0;
    this.walk += (want - this.walk) * (1 - Math.exp(-dt * 6));
    this.animate(dt, s);
  }

  die() {
    this.deadT = 0;
  }

  /** Plays the death; false once the body is gone. */
  dead(dt) {
    this.deadT += dt;
    this.time += dt;
    this.dying(dt, this.deadT);
    return this.deadT < this.deathLength;
  }

  /** Fades the body out (a 0..1); the transparent layers read this.fade themselves. */
  setFade(a) {
    if (a === this.fade) return;
    this.fade = a;
    const m = this.body;
    m.transparent = a < 1;
    m.opacity = a;
    m.depthWrite = a > 0.4;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The giant scorpion.

const CHITIN = new THREE.Color(0x1c0c06), CHITIN_EDGE = new THREE.Color(0x8c3e12), AMBER = new THREE.Color(0xa85a18);
const MEMBRANE = new THREE.Color(0x5a3412);

/** Dark plates that turn amber toward their edges and underside; keels and joints a little lighter. */
function chitin(edge = 1, dark = CHITIN) {
  return (v) => {
    const e = clamp(1 - v.n.y, 0, 1.6) / 1.6;
    v.c.copy(dark).lerp(CHITIN_EDGE, Math.pow(e, 1.7) * edge);
    v.s[0] = 0.45;
  };
}

function buildScorpion() {
  const rig = new Rig();
  rig.bone('body', null, 0, 0.17, 0);
  rig.bone('pro', 'body', 0, 0, 0.1);
  rig.bone('abd', 'body', 0, 0.005, 0.0);
  // The carapace: a low shield, narrower at the front, over a paler sternum.
  rig.add(warp(ell(0.13, 0.06, 0.15, 16, 8), (p) => {
    const f = clamp(p.z / 0.15, -1, 1);
    p.x *= 1 - 0.28 * Math.max(0, f);
    if (p.y > 0) p.y *= 1 - 0.25 * Math.abs(f);
    p.y += 0.012 * Math.cos(p.x * 18) * (p.y > 0 ? 1 : 0);
  }), 'pro', { at: [0, 0.012, 0.0], paint: chitin(1.1) });
  rig.add(ell(0.11, 0.045, 0.13, 10, 6), 'pro', { at: [0, -0.02, -0.01], paint: chitin(1, MEMBRANE) });
  // Eyes: a median pair on a tubercle, glowing ember red, and small clusters at the front corners.
  rig.add(ell(0.028, 0.02, 0.035, 10, 6), 'pro', { at: [0, 0.062, 0.05], paint: chitin(0.6) });
  for (const s of [-1, 1]) {
    rig.add(ell(0.015, 0.015, 0.015, 8, 6), 'pro', { at: [0.016 * s, 0.075, 0.062], color: 0xff3a12, glow: 2.6, rough: 0.2 });
    for (let k = 0; k < 3; k++) {
      rig.add(ell(0.006, 0.006, 0.006, 5, 3), 'pro', { at: [(0.083 - k * 0.009) * s, 0.034, 0.112 - k * 0.011], color: 0x2a0a04, glow: 0.5, rough: 0.15 });
    }
    // Chelicerae: small jaws under the brow.
    rig.add(ell(0.02, 0.02, 0.035, 7, 5), 'pro', { at: [0.022 * s, -0.005, 0.15], paint: chitin(1.2, MEMBRANE) });
  }
  // The mesosoma: seven overlapping tergites over the belly plates.
  const widths = [0.13, 0.145, 0.155, 0.16, 0.155, 0.14, 0.115];
  for (let i = 0; i < 7; i++) {
    const z = -0.06 - i * 0.062;
    rig.add(warp(dome(widths[i], 0.065 - i * 0.002, 0.05, 14, 4), (p) => {
      p.y += 0.006 * Math.cos(p.x * 40) * (p.y / 0.06);
    }), 'abd', { at: [0, 0.0, z], rot: [0.12, 0, 0], paint: (v) => {
      chitin(1.2)(v);
      // Two dorsal keels and a pale trailing edge, like real tergites.
      const keel = Math.abs(Math.abs(v.lp.x) - 0.045) < 0.01 ? 0.25 : 0;
      v.c.lerp(CHITIN_EDGE, keel);
      if (v.lp.z < z - 0.035) v.c.lerp(AMBER, 0.35);
    } });
  }
  rig.add(ell(0.135, 0.05, 0.25, 12, 6), 'abd', { at: [0, -0.02, -0.25], paint: chitin(1, MEMBRANE) });
  // The tail: five keeled segments curling up and over the back, then the venom bulb and the sting.
  const segs = [0.1, 0.105, 0.11, 0.115, 0.125], radii = [0.05, 0.047, 0.044, 0.042, 0.04];
  let parent = 'abd', at = [0, 0.03, -0.47], rest = 0.95;
  for (let i = 0; i < 5; i++) {
    const name = `tail${i}`, L = segs[i], r = radii[i];
    rig.bone(name, parent, at[0], at[1], at[2], rest, 0, 0);
    rig.add(loft(line([0, 0, 0], [0, 0, -L], 4), (t) => r * (0.82 + 0.18 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1))), { radial: 8, flat: [0.9, 1.1] }), name, {
      paint: (v) => {
        chitin(1)(v);
        // Ridges along the top and the sides; amber joints at both ends.
        const a = Math.atan2(v.lp.x, v.lp.y);
        const ridge = Math.max(0, Math.cos(a * 4)) ** 6;
        v.c.lerp(CHITIN_EDGE, ridge * 0.5);
        const t = -v.lp.z / L;
        v.c.lerp(AMBER, smooth(0.8, 1, t) * 0.5 + (1 - smooth(0, 0.12, t)) * 0.3);
      },
    });
    rig.add(ell(r * 0.8, r * 0.75, r * 0.55, 8, 5), name, { at: [0, 0, 0], color: 0x2e1608, rough: 0.5 });
    parent = name;
    at = [0, 0, -L];
    rest = 0.42;
  }
  rig.bone('telson', parent, at[0], at[1], at[2], 0.3, 0, 0);
  rig.add(warp(ell(0.055, 0.05, 0.08, 12, 8), (p) => {
    if (p.y < 0) p.y *= 1.15;
  }), 'telson', { at: [0, -0.005, -0.075], paint: (v) => {
    v.c.set(0x7a3a10).lerp(new THREE.Color(0x1e0a04), clamp(-v.n.y * 0.6 + 0.25 + 0.25 * Math.cos(Math.atan2(v.lp.x, v.lp.y) * 6), 0, 1));
    v.s[0] = 0.25;
  } });
  rig.add(loft(bend([0, -0.01, -0.13], [0, -0.03, -0.21], [0, -0.1, -0.22], 6), (t) => 0.026 * (1 - t) + 0.002, { radial: 6 }), 'telson', {
    paint: (v) => {
      v.c.set(0x2a1006).lerp(new THREE.Color(0x080302), smooth(0.13, 0.2, -v.lp.z));
      v.s[0] = 0.3;
    },
  });
  rig.add(ell(0.01, 0.014, 0.01, 6, 4), 'telson', { at: [0, -0.115, -0.218], color: 0x9cff3a, glow: 2.2, rough: 0.1 });
  // The pincers: arm, elbow, a heavy palm and two curved fingers, the outer one on its own bone.
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.bone(`palp${S}`, 'pro', 0.075 * s, 0.0, 0.12, -0.25, 0.75 * s, 0);
    rig.add(loft(line([0, 0, 0], [0, 0, 0.17], 3), (t) => 0.026 + 0.006 * t, { radial: 7 }), `palp${S}`, { paint: chitin(1) });
    rig.add(ell(0.03, 0.03, 0.03, 7, 5), `palp${S}`, { at: [0, 0, 0.17], color: 0x2e1608, rough: 0.5 });
    rig.bone(`elbow${S}`, `palp${S}`, 0, 0, 0.17, 0.2, -1.6 * s, 0);
    rig.add(loft(line([0, 0, 0], [0, 0, 0.15], 3), (t) => 0.03 + 0.012 * Math.sin(Math.PI * t), { radial: 8 }), `elbow${S}`, { paint: chitin(1) });
    rig.bone(`hand${S}`, `elbow${S}`, 0, 0, 0.15, 0.05, 0.75 * s, 0);
    rig.add(warp(ell(0.062, 0.036, 0.12, 12, 8), (p) => {
      const f = clamp(p.z / 0.12, -1, 1);
      p.x *= 1 + 0.12 * (1 - f * f);
      p.y *= 1 - 0.2 * Math.max(0, f);
      // Granular ridges along the top of the palm.
      p.y += 0.004 * Math.sin(p.x * 160) * Math.max(0, p.y / 0.036);
    }), `hand${S}`, { at: [0, 0, 0.085], paint: (v) => {
      chitin(1.1)(v);
      v.c.lerp(new THREE.Color(0x4a1608), smooth(0.04, 0.18, v.lp.z) * 0.7);
    } });
    const finger = (z) => (v) => {
      v.c.set(0x34120a).lerp(new THREE.Color(0x070302), smooth(z * 0.55, z, v.lp.z));
      v.s[0] = 0.35;
    };
    rig.add(loft(bend([-0.022 * s, 0, 0.16], [-0.035 * s, 0.0, 0.27], [0.0, -0.004, 0.36], 6), (t) => 0.026 * (1 - t) + 0.003, { radial: 6, flat: [0.8, 1] }), `hand${S}`, { paint: finger(0.36) });
    rig.bone(`finger${S}`, `hand${S}`, 0.024 * s, 0.0, 0.16, 0, 0.12 * s, 0);
    rig.add(loft(bend([0, 0, 0], [0.016 * s, 0.0, 0.11], [-0.022 * s, -0.004, 0.2], 6), (t) => 0.024 * (1 - t) + 0.003, { radial: 6, flat: [0.8, 1] }), `finger${S}`, { paint: finger(0.2) });
  }
  // Eight walking legs: hip (swing), femur (lift), tibia (reach) and a hooked tarsus.
  const legZ = [0.06, 0.0, -0.06, -0.12], legA = [0.85, 0.3, -0.25, -0.8];
  const femL = [0.17, 0.18, 0.19, 0.2], tibL = [0.32, 0.33, 0.345, 0.36];
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    for (let k = 0; k < 4; k++) {
      const hip = `hip${S}${k}`, fem = `fem${S}${k}`, tib = `tib${S}${k}`;
      rig.bone(hip, 'pro', 0.075 * s, -0.03, legZ[k], 0, s > 0 ? -legA[k] : Math.PI + legA[k], 0);
      rig.add(ell(0.03, 0.025, 0.028, 6, 4), hip, { paint: chitin(1, MEMBRANE) });
      rig.bone(fem, hip, 0.02, 0, 0, 0, 0, 0.75);
      rig.add(loft(line([0, 0, 0], [femL[k], 0, 0], 3), (t) => 0.021 + 0.005 * Math.sin(Math.PI * t), { radial: 6, flat: [1.25, 0.9] }), fem, { paint: chitin(0.6) });
      rig.add(ell(0.02, 0.02, 0.02, 6, 4), fem, { at: [femL[k], 0, 0], color: 0x2e1608, rough: 0.5 });
      rig.bone(tib, fem, femL[k], 0, 0, 0, 0, -1.65);
      rig.add(loft(bend([0, 0, 0], [tibL[k] * 0.5, 0.03, 0], [tibL[k], -0.005, 0], 5), (t) => 0.018 * (1 - t) + 0.004, { radial: 6 }), tib, {
        paint: (v) => {
          chitin(0.45)(v);
          const u = v.lp.x / tibL[k];
          v.c.lerp(AMBER, (1 - smooth(0, 0.25, u)) * 0.4 + smooth(0.55, 0.8, u) * (1 - smooth(0.8, 0.95, u)) * 0.35);
        },
      });
    }
  }
  return {
    rig: rig.finish(),
    materials: { body: bodyMaterial({ clearcoat: 0.45, clearcoatRoughness: 0.25 }) },
    scale: 1.3,
    height: 0.98,
    blob: [0.7, 0],
  };
}

class Scorpion extends Creature {
  constructor(tpl, uid) {
    super(tpl, uid);
    this.castLength = 0;
    this.legs = [];
    for (const S of ['L', 'R']) {
      for (let k = 0; k < 4; k++) {
        const s = S === 'R' ? 1 : -1;
        // Alternating tetrapod gait: L1, R2, L3, R4 against the other four, with a front-to-back ripple.
        const group = (k + (s > 0 ? 1 : 0)) % 2;
        this.legs.push({ s, k, hip: this.b[`hip${S}${k}`], fem: this.b[`fem${S}${k}`], tib: this.b[`tib${S}${k}`], off: group * Math.PI + k * 0.35 });
      }
    }
    this.tail = [0, 1, 2, 3, 4].map((i) => this.b[`tail${i}`]);
    this.snap = 0;
  }

  animate(dt, s) {
    const b = this.b, t = this.time, w = this.walk;
    const stride = clamp(this.speed / 0.28, 1.6, 6);
    this.phase += dt * TAU * (s.moving ? stride : 0.25) * (s.stunned ? 0.2 : 1);
    const ph = this.phase;
    const wind = s.wind > 0 ? ease(s.wind) : 0;
    const hit = this.strikeT >= 0 ? strikeCurve(this.strikeT / 0.45, 0.28) : 0;
    for (const l of this.legs) {
      const p = ph + l.off;
      const swing = Math.sin(p) * 0.34 * w;
      const lift = Math.max(0, Math.cos(p)) * 0.5 * w;
      const idle = (1 - w) * 0.04 * Math.sin(t * 1.3 + l.k * 1.7 + l.s);
      turn(l.hip, 0, -l.s * swing, 0);
      turn(l.fem, 0, 0, lift + idle - wind * 0.12 + hit * 0.1);
      turn(l.tib, 0, 0, -lift * 0.55 + idle * 0.5 + wind * 0.15);
    }
    // The body rides low and steady; it rears on the wind-up and lunges with the sting.
    shift(b.body, Math.sin(ph) * 0.004 * w, Math.abs(Math.sin(ph * 2)) * 0.008 * w + 0.004 * Math.sin(t * 1.6) * (1 - w) + wind * 0.03, hit * 0.08 - wind * 0.03);
    turn(b.body, -wind * 0.16 + hit * 0.1, 0, Math.sin(ph) * 0.03 * w);
    turn(b.abd, Math.sin(t * 1.6) * 0.012, 0, 0);
    // The tail sways, cocks tighter on the wind-up and whips the sting forward over the head.
    const sway = (1 - wind) * (1 - hit);
    this.tail.forEach((seg, i) => {
      const curl = wind * (i === 0 ? -0.2 : 0.16) + hit * (i === 0 ? 0.85 : i < 3 ? -0.12 : -0.02);
      const idle = Math.sin(t * 1.8 - i * 0.6) * 0.05 * sway + Math.sin(ph * 2 - i) * 0.04 * w;
      turn(seg, curl + idle, Math.sin(t * 0.9 - i * 0.5) * 0.07 * sway, 0);
    });
    turn(b.telson, wind * 0.25 + hit * 0.8 + Math.sin(t * 2.2) * 0.06 * sway, 0, 0);
    // The pincers spread and open on the wind-up and snap shut on the blow; idle ones flex now and then.
    this.snap = Math.max(0, this.snap - dt * 3);
    if (Math.sin(t * 0.7 + this.phase * 0.01) > 0.995 || (s.moving && Math.random() < dt * 0.4)) this.snap = 1;
    const open = clamp(0.15 + 0.12 * Math.sin(t * 2.1) + wind * 0.55 - hit * 0.4 - this.snap * 0.3 * (1 - wind), 0, 0.75);
    for (const S of ['L', 'R']) {
      const k = S === 'R' ? 1 : -1;
      turn(b[`palp${S}`], -wind * 0.25 + hit * 0.2 + Math.sin(t * 1.1 + k) * 0.03, k * (wind * 0.3 - hit * 0.25), 0);
      turn(b[`elbow${S}`], 0, k * (wind * 0.25 - hit * 0.15 + 0.06 * Math.sin(ph + k) * w), 0);
      turn(b[`hand${S}`], wind * 0.2, k * -wind * 0.2, 0);
      turn(b[`finger${S}`], 0, k * open, 0);
    }
  }

  dying(dt, d) {
    const b = this.b;
    const k = ease(d / 0.5);
    // Legs curl up under the body, the tail goes slack and the body rolls over and sinks.
    for (const l of this.legs) {
      turn(l.hip, 0, 0, 0);
      turn(l.fem, 0, 0, 0.9 * k + Math.sin(d * 30 + l.k) * 0.08 * (1 - k));
      turn(l.tib, 0, 0, -0.9 * k);
    }
    this.tail.forEach((seg, i) => turn(seg, -k * (i === 0 ? 0.6 : 0.3), 0, 0));
    turn(b.body, 0, 0, k * 2.4);
    shift(b.body, 0, 0.06 * Math.sin(k * Math.PI), 0);
    if (d > 1.4) this.root.position.y = -(d - 1.4) * 0.25;
    if (d > 1.6) this.setFade(clamp(1 - (d - 1.6) / 0.8, 0, 1));
  }
}

// ---------------------------------------------------------------------------------------------------------------

const KINDS = {
  SCORPION: { build: buildScorpion, Ctor: Scorpion, deathLength: 2.4 },
};

const templates = {};

/** The desert creatures this module draws. */
export const DESERT_TYPES = new Set(Object.keys(KINDS));

/** A new desert creature of the given EnemyType name: { root, height, blob, mats, tick, die, dead }. */
export function desertCreature(type, uid) {
  const kind = KINDS[type];
  const tpl = templates[type] || (templates[type] = kind.build());
  const c = new kind.Ctor(tpl, uid);
  c.deathLength = kind.deathLength;
  return c;
}

/** Triangles of each creature (for profiling). */
export function desertTriangles(type) {
  const kind = KINDS[type];
  const tpl = templates[type] || (templates[type] = kind.build());
  return tpl.rig.merged.map((m) => `${m.layer} ${m.triangles}`).join(', ');
}
