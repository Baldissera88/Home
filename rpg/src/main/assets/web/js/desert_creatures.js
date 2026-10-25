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
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
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
      idx.push(a, a + 1, b, a + 1, b + 1, b);
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

  /** A bone at (x, y, z) in the creature's space (rest pose), its axes lined up with the creature's. */
  boneWorld(name, parent, x, y, z) {
    this.top.updateMatrixWorld(true);
    const p = this.by[parent];
    const b = this.bone(name, parent);
    b.position.copy(p.worldToLocal(new V3(x, y, z)));
    b.quaternion.copy(p.getWorldQuaternion(new THREE.Quaternion()).invert());
    return b;
  }

  /**
   * Adds geometry g, placed in bone `name` by o.at / o.rot / o.scale, to a layer ('body' by default).
   * o.color, o.rough, o.metal, o.glow, o.tex, o.alpha set the surface; o.paint(v) may change v.c (Color),
   * v.s ([rough, metal, glow, tex]) and v.a per vertex from v.lp (in the bone), v.wp (in the creature), v.n
   * and v.uv; o.faces paints whole triangles (crisp stripes). o.skin(wp, lp) can spread a vertex over bones:
   * [[name, weight], ...]. o.uv = [su, sv] scales the texture coordinates. o.world: g is already placed in the
   * creature's space (rest pose) and is only bound to the bone.
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
    this.top.updateMatrixWorld(true);
    const bone = this.by[name];
    let local;
    if (o.world) {
      // Given in the creature's space: only bound to the bone.
      local = g.attributes.position.clone().applyMatrix4(_m.copy(bone.matrixWorld).invert());
    } else {
      local = g.attributes.position.clone();
      g.applyMatrix4(bone.matrixWorld);
    }
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
    this.defs = this.list.map((b) => ({ name: b.name, parent: b.parent && b.parent.isBone ? b.parent.userData.i : -1, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
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
      b.scale.copy(d.s);
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
// Linen: a tileable wrap texture (colour and normal map) drawn once, for the mummy and the pharaoh's rags.

/** Tileable value noise of period p (cells per tile) at (u, v) in tile units. */
function tnoise(u, v, p, seed) {
  const fx = u * p, fy = v * p, x0 = Math.floor(fx), y0 = Math.floor(fy);
  const sx = ease(fx - x0), sy = ease(fy - y0);
  const h = (i, j) => hash3(((i % p) + p) % p, ((j % p) + p) % p, seed);
  return mix(mix(h(x0, y0), h(x0 + 1, y0), sx), mix(h(x0, y0 + 1), h(x0 + 1, y0 + 1), sx), sy);
}

/** World size of one texture tile on wrapped limbs. */
const LINEN_TILE = 0.24;
let linen = null;

function linenMaps() {
  if (linen) return linen;
  const S = 256, H = new Float32Array(S * S), rgba = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const wob = tnoise(u, v, 8, 1) - 0.5;
      // Strips wound around the limb at a slant, each overlapping the one below with a raised lip...
      const pa = v * 5 + u + wob * 0.35, fa = pa - Math.floor(pa);
      let h = smooth(0, 0.1, fa) * (1 - smooth(0.84, 1, fa)) * (0.7 + 0.3 * Math.sin(fa * Math.PI)) + 0.22 * smooth(0.66, 0.8, fa) * (1 - smooth(0.8, 0.95, fa));
      // ...and in patches a second wrap crossing over them the other way.
      const pb = v * 4 - u * 2 + wob * 0.3, fb = pb - Math.floor(pb);
      const cross = smooth(0, 0.1, fb) * (1 - smooth(0.82, 1, fb)) * smooth(0.5, 0.62, tnoise(u, v, 3, 2));
      h = Math.max(h, cross * 1.2);
      const fibre = tnoise(u, v, 64, 4), weave = 0.5 + 0.25 * (Math.sin(TAU * u * 64) + Math.sin(TAU * v * 64));
      const frayed = smooth(0.6, 0.8, tnoise(u, v, 16, 5)) * 0.15;
      H[y * S + x] = h * 0.85 + weave * 0.06 + fibre * 0.08 - frayed;
      // Pale linen, darker down in the gaps, yellowed and stained in blotches.
      const lum = (0.62 + 0.38 * smooth(0.05, 0.6, h)) * (0.9 + 0.1 * fibre) * (0.92 + 0.08 * weave);
      const stain = smooth(0.55, 0.8, tnoise(u, v, 6, 7)) * 0.4 + smooth(0.68, 0.86, tnoise(u, v, 14, 8)) * 0.25;
      const shade = 0.9 + 0.2 * tnoise(u + Math.floor(pa) * 0.21, v, 4, 3);
      const r = mix(0.86, 0.56, stain) * lum * shade, g = mix(0.82, 0.47, stain) * lum * shade, b = mix(0.72, 0.34, stain) * lum * shade;
      const o = (y * S + x) * 4;
      rgba[o] = clamp(r * 255, 0, 255);
      rgba[o + 1] = clamp(g * 255, 0, 255);
      rgba[o + 2] = clamp(b * 255, 0, 255);
      rgba[o + 3] = 255;
    }
  }
  const nrm = new Uint8Array(S * S * 4), k = 5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = H[y * S + ((x + 1) % S)] - H[y * S + ((x + S - 1) % S)];
      const dy = H[((y + 1) % S) * S + x] - H[((y + S - 1) % S) * S + x];
      _n.set(-dx * k, -dy * k, 1).normalize();
      const o = (y * S + x) * 4;
      nrm[o] = (_n.x * 0.5 + 0.5) * 255;
      nrm[o + 1] = (_n.y * 0.5 + 0.5) * 255;
      nrm[o + 2] = (_n.z * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  linen = { map: tex(rgba, true), normal: tex(nrm, false) };
  return linen;
}

/** A wrapped limb from a to b (in the bone), its radius easing r0 to r1 with lumps; textured with linen. */
function wrapped(a, b, r0, r1, seed = 0, radial = 10, rows = 6) {
  const g = loft(line(a, b, rows), (t) => mix(r0, r1, t) * (1 + 0.05 * Math.sin(t * 19 + seed * 3) + 0.03 * Math.sin(t * 41 + seed)), { radial });
  const around = Math.max(1, Math.round((TAU * (r0 + r1)) / 2 / LINEN_TILE));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, (uv.getY(i) + seed * 0.37) / LINEN_TILE);
  return g;
}

/** Sphere UVs stretched so the linen keeps about the same size on a head or a foot. */
function wrappedEll(rx, ry, rz, w, h) {
  const g = ell(rx, ry, rz, w, h), uv = g.attributes.uv;
  const around = Math.max(1, Math.round((Math.PI * (rx + rz)) / LINEN_TILE)), tall = (Math.PI * ry) / LINEN_TILE;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * tall);
  return g;
}

/** Smooth 3D value noise in 0..1. */
function vnoise(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const sx = ease(x - x0), sy = ease(y - y0), sz = ease(z - z0);
  const h = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k);
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), sx), mix(h(0, 1, 0), h(1, 1, 0), sx), sy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), sx), mix(h(0, 1, 1), h(1, 1, 1), sx), sy), sz);
}

/** Linen tinted per part; holes in the wraps show dark, dried flesh. */
function linenPaint(tint = 0xe8dcc0, holes = 0, seed = 0) {
  const base = new THREE.Color(tint), flesh = new THREE.Color(0x2a1a0f);
  return (v) => {
    v.c.copy(base);
    v.s[0] = 0.92;
    v.s[3] = 1;
    if (holes > 0) {
      const n = vnoise(v.wp.x * 16 + seed, v.wp.y * 12, v.wp.z * 16);
      const k = smooth(1 - holes * 0.6, 1 - holes * 0.35, n);
      v.c.lerp(flesh, k);
      v.s[3] = 1 - smooth(0.4, 1, k) * 0.85;
    }
  };
}

const CURSE = 0x5dffc0;

// ---------------------------------------------------------------------------------------------------------------
// The mummy.

/** Loose strips of linen hanging from the body: [parent bone, offset in it, length, width, turn]. */
const MUMMY_STRIPS = [
  ['foreL', [0.03, -0.18, 0.0], 0.38, 0.05, 0.3],
  ['foreR', [-0.02, -0.12, 0.02], 0.28, 0.045, -0.4],
  ['armR', [0.04, -0.1, 0.0], 0.24, 0.045, 0.8],
  ['hips', [-0.09, -0.04, 0.09], 0.4, 0.06, 0.2],
  ['hips', [0.11, -0.05, -0.06], 0.34, 0.055, -0.5],
  ['hips', [0.02, -0.04, -0.1], 0.3, 0.055, 0.1],
  ['head', [0.05, 0.06, -0.08], 0.34, 0.045, 0.6],
  ['chest', [-0.12, 0.12, 0.06], 0.26, 0.05, -0.2],
];

/** Hangs strips of cloth (painted by paint(v)) from their bones: two bones each so they can swing and trail. */
function addStrips(rig, list, paint) {
  rig.top.updateMatrixWorld(true);
  return list.map(([parent, off, len, width, angle, tilt = 0], i) => {
    const at = rig.by[parent].localToWorld(new V3(off[0], off[1], off[2]));
    const a = `strip${i}a`, b = `strip${i}b`;
    rig.boneWorld(a, parent, at.x, at.y, at.z);
    rig.bone(b, a, 0, -len * 0.5, 0);
    const g = loft(bend([0, 0, 0], [0.05 * Math.sin(i * 2.1), -len * 0.5, 0.03], [0.02 * Math.cos(i), -len, -0.02], 7),
      (t) => width * (1 - 0.45 * t) * (1 - 0.5 * smooth(0.8, 1, t)), { radial: 4, flat: [0.07, 1], caps: false });
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.3, (uv.getY(k) + i * 0.4) / LINEN_TILE);
    rig.add(g, a, {
      at: [at.x, at.y, at.z], rot: [0, angle, 0], world: true,
      skin: (wp) => {
        const t = smooth(0.25, 0.75, (at.y - wp.y) / len);
        return [[a, 1 - t], [b, t]];
      },
      paint: (v) => {
        paint(v);
        // Frayed, darker ends.
        v.c.multiplyScalar(1 - 0.35 * smooth(0.6, 1, (at.y - v.wp.y) / len));
      },
    });
    return { a, b, parent, phase: i * 1.7, tilt };
  });
}

function buildMummy() {
  const rig = new Rig();
  rig.bone('hips', null, 0, 0.715, 0);
  rig.bone('spine', 'hips', 0, 0.06, 0, 0.3, 0, 0);
  rig.bone('chest', 'spine', 0, 0.2, 0, 0.24, 0, 0);
  rig.bone('neck', 'chest', 0, 0.21, 0.01, -0.2, 0, 0);
  rig.bone('head', 'neck', 0, 0.08, 0, -0.3, 0, 0);
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.bone(`arm${S}`, 'chest', 0.19 * s, 0.15, 0, s > 0 ? -1.25 : -1.38, 0, 0.16 * s);
    rig.bone(`fore${S}`, `arm${S}`, 0, -0.27, 0, -0.18, 0, 0);
    rig.bone(`hand${S}`, `fore${S}`, 0, -0.25, 0, 0.35, 0, 0);
    rig.bone(`thigh${S}`, 'hips', 0.1 * s, -0.05, 0, -0.16, 0, 0.03 * s);
    rig.bone(`shin${S}`, `thigh${S}`, 0, -0.36, 0, 0.28, 0, 0);
    rig.bone(`foot${S}`, `shin${S}`, 0, -0.32, 0, -0.12, 0, 0);
  }
  const tint = 0xe2dccc, dusty = 0xc4baa4;
  // Torso: pelvis, a gaunt belly with a tear, a broad hunched chest and bony shoulders.
  rig.add(wrapped([0, -0.09, 0], [0, 0.09, 0], 0.118, 0.11, 0, 12, 4), 'hips', { scale: [1, 1, 0.74], paint: linenPaint(dusty) });
  rig.add(wrapped([0, -0.03, 0], [0, 0.22, 0], 0.12, 0.135, 1, 12, 5), 'spine', { scale: [1, 1, 0.72], paint: linenPaint(tint, 0.35, 2) });
  rig.add(warp(wrapped([0, -0.02, 0], [0, 0.22, 0], 0.14, 0.12, 2, 12, 6), (p) => {
    const t = clamp(p.y / 0.22, 0, 1);
    p.x *= 1 + 0.32 * Math.sin(Math.PI * clamp(t * 1.15, 0, 1));
    p.z *= 0.74;
    // A hunched, bony back.
    if (p.z < 0) p.z -= 0.045 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1));
  }), 'chest', { paint: linenPaint(tint, 0.3, 5) });
  for (const s of [-1, 1]) rig.add(wrappedEll(0.05, 0.05, 0.052, 10, 8), 'chest', { at: [0.158 * s, 0.135, -0.015], paint: linenPaint(tint) });
  rig.add(wrapped([0, -0.02, 0], [0, 0.1, 0], 0.05, 0.045, 3, 8, 3), 'neck', { paint: linenPaint(dusty) });
  // The head: a wrapped skull with sunken sockets, a glowing stare and a slit of a mouth.
  const sockets = [[-0.04, 0.035], [0.04, 0.035]];
  rig.add(warp(wrappedEll(0.108, 0.128, 0.118, 18, 14), (p) => {
    if (p.y < -0.02) p.x *= 1 - 0.18 * smooth(-0.02, -0.12, p.y);
    if (p.z < 0) p.z *= 1.08;
    if (p.z > 0) {
      for (const [sx, sy] of sockets) {
        const d = Math.hypot(p.x - sx, (p.y - sy) * 1.2);
        if (d < 0.04) p.z -= 0.03 * (1 - d / 0.04) ** 2;
      }
      // A heavy brow over the sockets.
      p.z += 0.012 * Math.exp(-(((p.y - 0.07) / 0.02) ** 2)) * smooth(0.07, 0.02, Math.abs(p.x));
    }
  }), 'head', { at: [0, 0.1, 0.01], paint: (v) => {
    linenPaint(tint)(v);
    if (v.lp.z > 0.06) {
      for (const [sx, sy] of sockets) {
        const d = Math.hypot(v.lp.x - sx, (v.lp.y - 0.1 - sy) * 1.2);
        const k = smooth(0.042, 0.022, d);
        v.c.lerp(new THREE.Color(0x140a06), k);
        v.s[3] *= 1 - k;
      }
      const mouth = smooth(0.012, 0.004, Math.abs(v.lp.y - 0.1 + 0.055)) * smooth(0.045, 0.03, Math.abs(v.lp.x));
      v.c.lerp(new THREE.Color(0x1a0e08), mouth);
    }
  } });
  for (const [sx, sy] of sockets) {
    rig.add(ell(0.017, 0.013, 0.01, 8, 6), 'head', { at: [sx, 0.1 + sy, 0.092], color: CURSE, glow: 4, rough: 0.3 });
  }
  // Arms reaching out, hands drooping into hooked, half-bared fingers.
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.add(wrapped([0, 0.02, 0], [0, -0.28, 0], 0.064, 0.052, 4 + s, 10, 6), `arm${S}`, { paint: linenPaint(tint, 0.25, 7 + s) });
    rig.add(wrapped([0, 0.01, 0], [0, -0.25, 0], 0.053, 0.042, 6 + s, 10, 6), `fore${S}`, { paint: linenPaint(dusty, 0.2, 9 + s) });
    rig.add(wrappedEll(0.035, 0.045, 0.022, 8, 6), `hand${S}`, { at: [0, -0.035, 0], paint: linenPaint(dusty) });
    for (let f = 0; f < 4; f++) {
      const x = (-0.024 + f * 0.016) * s, L = f === 0 || f === 3 ? 0.065 : 0.08;
      rig.add(loft(bend([x, -0.07, 0], [x * 1.1, -0.07 - L * 0.7, 0.005], [x * 1.1, -0.06 - L, 0.04], 4), (t) => 0.0085 * (1 - 0.6 * t), { radial: 5 }), `hand${S}`, {
        paint: (v) => {
          const t = smooth(-0.09, -0.13, v.lp.y) + smooth(0.0, 0.03, v.lp.z);
          v.c.set(0xb8a888).lerp(new THREE.Color(0x231509), clamp(t, 0, 1));
          v.s[0] = 0.7;
          v.s[3] = 1 - clamp(t, 0, 1);
        },
      });
    }
    rig.add(loft(bend([0.03 * s, -0.04, 0.01], [0.04 * s, -0.08, 0.03], [0.025 * s, -0.1, 0.05], 3), (t) => 0.009 * (1 - 0.5 * t), { radial: 5 }), `hand${S}`, { color: 0x6a5840, rough: 0.7 });
    // Legs: thick wrapped thighs, thinner shins and bound feet.
    rig.add(wrapped([0, 0.02, 0], [0, -0.37, 0], 0.075, 0.058, 8 + s, 10, 6), `thigh${S}`, { paint: linenPaint(tint, s < 0 ? 0.3 : 0, 11) });
    rig.add(wrapped([0, 0.0, 0], [0, -0.33, 0], 0.056, 0.042, 10 + s, 10, 6), `shin${S}`, { paint: linenPaint(dusty, 0, 12) });
    rig.add(warp(wrappedEll(0.045, 0.035, 0.1, 10, 6), (p) => {
      if (p.y < -0.015) p.y = -0.015 + (p.y + 0.015) * 0.3;
    }), `foot${S}`, { at: [0, -0.02, 0.045], paint: linenPaint(0xa89878) });
  }
  const strips = addStrips(rig, MUMMY_STRIPS, linenPaint(tint));
  const maps = linenMaps();
  return {
    rig: rig.finish(),
    materials: { body: bodyMaterial({ map: maps.map, normalMap: maps.normal, normalScale: new THREE.Vector2(1.3, 1.3) }) },
    strips,
    scale: 1.08,
    height: 1.6,
    blob: [0.48, 0],
  };
}

const _qTop = new THREE.Quaternion(), _qInv = new THREE.Quaternion(), _qP = new THREE.Quaternion(), _qS = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Strips of cloth hanging from a body: they keep hanging down whatever the limb does, and trail behind its moves. */
class Hanging {
  constructor(c, list) {
    this.c = c;
    this.list = list.map((s) => ({ a: c.b[s.a], b: c.b[s.b], parent: c.b[s.parent], phase: s.phase, tilt: s.tilt || 0, sx: s.tilt || 0, sz: 0, vx: 0, vz: 0, last: new V3(), first: true }));
  }

  update(dt, gust) {
    const t = this.c.time, h = Math.min(dt, 0.05);
    this.c.root.getWorldQuaternion(_qTop);
    _qInv.copy(_qTop).invert();
    for (const s of this.list) {
      // How fast the attachment moves in the creature's frame swings the strip back; a little wind sways it.
      s.a.getWorldPosition(_v);
      if (s.first) { s.last.copy(_v); s.first = false; }
      _w.subVectors(_v, s.last).applyQuaternion(_qInv);
      s.last.copy(_v);
      const k = dt > 1e-4 ? 1 / dt : 0;
      const wind = Math.sin(t * 2.1 + s.phase) * 0.12 * gust + Math.sin(t * 5.3 + s.phase * 2) * 0.04;
      const tx = clamp(_w.z * k * 0.25, -0.9, 0.9) + wind * 0.5 + s.tilt, tz = clamp(-_w.x * k * 0.25, -0.9, 0.9) + wind;
      s.vx += ((tx - s.sx) * 40 - s.vx * 5) * h;
      s.vz += ((tz - s.sz) * 40 - s.vz * 5) * h;
      s.sx = clamp(s.sx + s.vx * h, -1.2, 1.2);
      s.sz = clamp(s.sz + s.vz * h, -1.2, 1.2);
      // Hang straight down in the creature's frame, turned by the swing.
      s.parent.getWorldQuaternion(_qP);
      _qS.setFromEuler(_e.set(s.sx, 0, s.sz));
      s.a.quaternion.copy(_qP.invert()).multiply(_qTop).multiply(_qS);
      s.b.rotation.set((s.sx - s.tilt) * 0.5 + wind * 0.3, 0, s.sz * 0.5);
    }
  }
}

class Mummy extends Creature {
  constructor(tpl, uid) {
    super(tpl, uid);
    this.castLength = 0;
    this.hang = new Hanging(this, tpl.strips);
    this.lurch = 0;
  }

  animate(dt, s) {
    const b = this.b, t = this.time, w = this.walk;
    // A slow, dragging gait: the right leg steps, the stiff left one is hauled after it.
    const rate = clamp(this.speed / 1.25, 0.55, 1.4);
    this.phase += dt * TAU * (s.moving ? rate : 0) * (s.stunned ? 0.3 : 1);
    const ph = this.phase + 0.35 * Math.sin(this.phase);
    const wind = s.wind > 0 ? ease(s.wind) : 0;
    const hit = this.strikeT >= 0 ? strikeCurve(this.strikeT / 0.55, 0.3) : 0;
    const raise = Math.max(wind, 0) * (1 - hit);
    const sw = Math.sin(ph), cw = Math.cos(ph);
    const breathe = Math.sin(t * 1.4);
    turn(b.thighR, (-0.42 * sw) * w - hit * 0.25, 0, 0);
    turn(b.shinR, (0.85 * Math.max(0, cw) + 0.1) * w + hit * 0.25, 0, 0);
    turn(b.footR, (-0.25 * Math.max(0, cw) + 0.2 * Math.max(0, -sw)) * w, 0, 0);
    turn(b.thighL, (0.26 * sw) * w + hit * 0.2, 0, -0.14 * Math.max(0, -cw) * w);
    turn(b.shinL, 0.06 * w, 0, 0);
    turn(b.footL, (0.35 * Math.max(0, -cw)) * w, 0, 0);
    // The body lurches over the good leg and sags on the bad one.
    const sag = (0.035 * Math.max(0, sw) + 0.015 * Math.abs(cw)) * w;
    shift(b.hips, 0.02 * sw * w, -sag - hit * 0.06 + raise * 0.02, hit * 0.1);
    turn(b.hips, 0.04 * w, 0.12 * sw * w, (0.09 * sw + 0.02 * Math.sin(t * 0.7)) * (0.4 + w));
    turn(b.spine, breathe * 0.02 + 0.05 * w - raise * 0.3 + hit * 0.45, -0.08 * sw * w, -0.05 * sw * w + 0.03 * Math.sin(t * 0.6));
    turn(b.chest, breathe * 0.015 - raise * 0.25 + hit * 0.2, 0, -0.04 * sw * w);
    turn(b.neck, raise * 0.15 - hit * 0.15, 0.1 * Math.sin(t * 0.5), 0);
    turn(b.head, raise * 0.25 - hit * 0.1 + 0.05 * Math.sin(t * 0.8), 0.15 * Math.sin(t * 0.37 + 1), 0.12 * Math.sin(t * 0.45) * (1 - w * 0.5));
    // Arms: reaching out ahead, swaying with the lurch; raised high on the wind-up, hammered down on the blow.
    for (const S of ['L', 'R']) {
      const k = S === 'R' ? 1 : -1, off = k > 0 ? 0 : 1.3;
      const sway = Math.sin(t * 1.1 + off) * 0.06 + Math.sin(ph + off) * 0.1 * w;
      turn(b[`arm${S}`], sway - raise * 1.35 + hit * 0.75, 0.15 * k * raise, k * (0.04 * Math.sin(t * 0.9 + off) - 0.12 * raise));
      turn(b[`fore${S}`], -0.1 * Math.sin(t * 1.3 + off) - raise * 0.55 + hit * 0.15, 0, 0);
      turn(b[`hand${S}`], 0.12 * Math.sin(t * 1.7 + off) - raise * 0.3 - hit * 0.3, 0, 0);
    }
    if (s.stunned) turn(b.head, 0.3 * Math.sin(t * 9), 0.3 * Math.sin(t * 5), 0.2);
    this.hang.update(dt, 0.6 + w);
  }

  dying(dt, d) {
    const b = this.b;
    // Knees buckle, it slumps forward onto its hands and crumbles away into the sand.
    const kneel = ease(d / 0.5), fall = ease((d - 0.35) / 0.6);
    turn(b.thighR, -1.3 * kneel, 0, 0);
    turn(b.thighL, -1.15 * kneel, 0, -0.1 * kneel);
    turn(b.shinR, 1.95 * kneel, 0, 0);
    turn(b.shinL, 1.85 * kneel, 0, 0);
    turn(b.footR, 0.5 * kneel, 0, 0);
    turn(b.footL, 0.5 * kneel, 0, 0);
    shift(b.hips, 0, -0.36 * kneel - 0.06 * fall, 0.08 * kneel + 0.1 * fall);
    turn(b.hips, 0.3 * fall, 0, 0.08 * kneel);
    turn(b.spine, 0.75 * fall, 0, 0.1 * fall);
    turn(b.chest, 0.35 * fall, 0, 0);
    turn(b.neck, -0.2 * fall, 0, 0);
    turn(b.head, -0.2 * kneel, 0.4 * kneel, 0.3 * kneel);
    for (const S of ['L', 'R']) {
      turn(b[`arm${S}`], 0.5 * kneel + 0.35 * fall, 0, 0);
      turn(b[`fore${S}`], -0.25 * fall, 0, 0);
      turn(b[`hand${S}`], 0.2, 0, 0);
    }
    this.hang.update(dt, 0.3);
    if (d > 1.4) this.root.position.y = -(d - 1.4) * 0.35;
    if (d > 1.5) this.setFade(clamp(1 - (d - 1.5) / 1.0, 0, 1));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The djinn.

const GOLD = 0xffbf3c;

/** Polished gold. */
function gold(v) {
  v.c.set(GOLD);
  v.s[0] = 0.26;
  v.s[1] = 1;
}

/** A ring (a bangle, a torc, an armband) of radius R around the y axis, its band r thick and flattened by flat. */
function ring(R, r, flat = [1, 1], radial = 6, seg = 16) {
  const pts = [];
  for (let i = 0; i <= seg; i++) pts.push(new V3(Math.cos((i / seg) * TAU) * R, 0, Math.sin((i / seg) * TAU) * R));
  return loft(pts, r, { radial, flat, caps: false, up: new V3(0, 1, 0) });
}

/** Weights along a chain of bones at the given heights (top first) for a vertex at height y. */
function chainSkin(names, ys) {
  return (wp) => {
    const y = wp.y;
    if (y >= ys[0]) return [[names[0], 1]];
    for (let i = 0; i < ys.length - 1; i++) {
      if (y >= ys[i + 1]) {
        const t = ease((ys[i] - y) / (ys[i] - ys[i + 1]));
        return [[names[i], 1 - t], [names[i + 1], t]];
      }
    }
    return [[names[names.length - 1], 1]];
  };
}

/** Skin from deep blue to a lighter, glowing hue at the edges. */
function djinnSkin(v) {
  const facing = clamp(v.n.y * 0.5 + 0.5, 0, 1);
  v.c.set(0x2a62d8).lerp(new THREE.Color(0x163a9c), 0.5 - facing * 0.5);
  v.s[0] = 0.62;
  v.s[2] = 0.09;
}

function buildDjinn() {
  const rig = new Rig();
  rig.bone('float', null, 0, 0.36, 0);
  rig.bone('waist', 'float', 0, 0.5, 0);
  rig.bone('chest', 'waist', 0, 0.2, 0);
  rig.bone('neck', 'chest', 0, 0.23, 0.0);
  rig.bone('head', 'neck', 0, 0.06, 0.01);
  rig.bone('orb', 'chest', 0, 0.0, 0.3);
  const tails = ['tail0', 'tail1', 'tail2', 'tail3'];
  rig.bone('tail0', 'waist', 0, -0.04, 0);
  rig.bone('tail1', 'tail0', 0, -0.17, -0.01);
  rig.bone('tail2', 'tail1', 0, -0.17, -0.02);
  rig.bone('tail3', 'tail2', 0, -0.16, -0.02);
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.bone(`arm${S}`, 'chest', 0.2 * s, 0.15, -0.01, 0, 0, 0.28 * s);
    rig.bone(`fore${S}`, `arm${S}`, 0, -0.25, 0, -0.9, 0, 0);
    rig.bone(`hand${S}`, `fore${S}`, 0, -0.23, 0, 0, 0, 0);
  }
  // Torso: a broad, muscled chest narrowing to the waist, skinned across both bones.
  rig.add(warp(loft(line([0, -0.24, 0], [0, 0.21, 0], 10), (t) => {
    const chest = Math.sin(Math.PI * clamp((t - 0.25) / 0.85, 0, 1));
    return 0.115 + 0.075 * chest - 0.03 * smooth(0.9, 1, t);
  }, { radial: 14, flat: [0.66, 1] }), (p) => {
    // Pectorals and a hint of abdominals at the front.
    if (p.z > 0) {
      const pec = Math.exp(-(((p.y - 0.06) / 0.06) ** 2)) * smooth(0.0, 0.05, Math.abs(p.x)) * smooth(0.17, 0.08, Math.abs(p.x));
      p.z += 0.03 * pec;
      p.z += 0.006 * Math.cos(p.y * 70) * smooth(0.02, -0.1, p.y) * smooth(0.07, 0.02, Math.abs(p.x));
    }
  }), 'chest', {
    paint: djinnSkin,
    skin: (wp) => {
      const t = smooth(0.78, 0.95, wp.y);
      return [['waist', 1 - t], ['chest', t]];
    },
  });
  for (const s of [-1, 1]) rig.add(ell(0.068, 0.064, 0.066, 10, 8), 'chest', { at: [0.175 * s, 0.135, -0.012], paint: djinnSkin });
  rig.add(loft(line([0, -0.03, 0], [0, 0.08, 0], 2), 0.05, { radial: 10 }), 'neck', { paint: djinnSkin });
  // Gold torc, sash with a jewel, and the belt where the body turns to smoke.
  rig.add(ring(0.075, 0.016, [1, 1.6], 6, 18), 'neck', { at: [0, 0.0, 0.0], rot: [0.25, 0, 0], paint: gold });
  rig.add(ring(0.122, 0.03, [1.6, 0.6], 6, 20), 'waist', { at: [0, 0.0, 0], scale: [1, 1, 0.7], paint: (v) => { v.c.set(0x6a1468); v.s[0] = 0.6; } });
  rig.add(ring(0.125, 0.008, [1, 1], 4, 20), 'waist', { at: [0, 0.03, 0], scale: [1, 1, 0.71], paint: gold });
  rig.add(ring(0.125, 0.008, [1, 1], 4, 20), 'waist', { at: [0, -0.03, 0], scale: [1, 1, 0.71], paint: gold });
  rig.add(ell(0.03, 0.035, 0.015, 8, 6), 'waist', { at: [0, 0, 0.092], paint: gold });
  rig.add(ell(0.017, 0.02, 0.012, 8, 6), 'waist', { at: [0, 0, 0.104], color: 0xff2040, glow: 1.6, rough: 0.15 });
  // The head: a stern face, pointed ears, a forked beard, a topknot and burning eyes.
  rig.add(warp(ell(0.085, 0.1, 0.095, 16, 12), (p) => {
    if (p.y < -0.02) p.x *= 1 - 0.25 * smooth(-0.02, -0.1, p.y);
    if (p.z > 0.05) p.z += 0.012 * Math.exp(-(((p.y - 0.03) / 0.015) ** 2)) * smooth(0.06, 0.0, Math.abs(p.x));
  }), 'head', { at: [0, 0.1, 0.0], paint: djinnSkin });
  rig.add(new THREE.ConeGeometry(0.018, 0.05, 6).rotateX(Math.PI / 2), 'head', { at: [0, 0.085, 0.1], rot: [0.45, 0, 0], paint: djinnSkin });
  for (const s of [-1, 1]) {
    rig.add(new THREE.ConeGeometry(0.022, 0.09, 6).translate(0, 0.045, 0).rotateZ(-s * (Math.PI / 2 - 0.45)), 'head', { at: [0.1 * s, 0.11, -0.01], scale: [1, 0.6, 0.5], paint: djinnSkin });
    rig.add(ring(0.016, 0.004, [1, 1], 4, 10), 'head', { at: [0.093 * s, 0.065, 0.0], rot: [0, 0, Math.PI / 2], paint: gold });
    // Eyes glowing like coals under a heavy, angry brow.
    rig.add(ell(0.019, 0.008, 0.008, 8, 6), 'head', { at: [0.034 * s, 0.11, 0.086], rot: [0, 0, 0.3 * s], color: 0xffb030, glow: 5, rough: 0.2 });
    rig.add(ell(0.034, 0.009, 0.016, 8, 4), 'head', { at: [0.036 * s, 0.124, 0.086], rot: [0, 0, 0.5 * s], color: 0x0c1430 });
  }
  rig.add(loft(bend([0, 0.0, 0.07], [0, -0.05, 0.1], [0, -0.13, 0.07], 5), (t) => 0.026 * (1 - t) + 0.003, { radial: 6 }), 'head', { at: [0, 0.03, 0], color: 0x0c0c18, rough: 0.6 });
  rig.add(loft(bend([0, 0.18, -0.02], [0, 0.3, -0.06], [0, 0.26, -0.2], 6), (t) => 0.03 * (1 - t * 0.7), { radial: 7 }), 'head', { color: 0x0c0c18, rough: 0.5 });
  rig.add(ring(0.024, 0.008, [1, 1], 4, 10), 'head', { at: [0, 0.205, -0.03], rot: [-0.3, 0, 0], paint: gold });
  // Arms: muscled, with gold armbands and heavy bracers; strong open hands.
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.add(loft(line([0, 0.02, 0], [0, -0.26, 0], 6), (t) => 0.055 + 0.012 * Math.sin(Math.PI * t), { radial: 10 }), `arm${S}`, { paint: djinnSkin });
    rig.add(ring(0.062, 0.012, [1.8, 0.8], 4, 14), `arm${S}`, { at: [0, -0.07, 0], paint: gold });
    rig.add(loft(line([0, 0.02, 0], [0, -0.24, 0], 6), (t) => 0.05 - 0.012 * t, { radial: 10 }), `fore${S}`, { paint: djinnSkin });
    rig.add(loft(line([0, -0.08, 0], [0, -0.22, 0], 3), (t) => 0.052 - 0.006 * t, { radial: 12 }), `fore${S}`, { paint: (v) => {
      gold(v);
      // Engraved bands.
      const band = Math.abs(((v.lp.y + 0.08) / 0.035) % 1);
      if (band < 0.18) v.c.multiplyScalar(0.45);
    } });
    rig.add(ell(0.04, 0.05, 0.022, 8, 6), `hand${S}`, { at: [0, -0.045, 0], paint: djinnSkin });
    for (let f = 0; f < 4; f++) {
      const x = (-0.024 + f * 0.016) * s;
      rig.add(loft(bend([x, -0.08, 0], [x, -0.12, 0.012], [x, -0.14, 0.03], 3), 0.009, { radial: 5 }), `hand${S}`, { paint: djinnSkin });
    }
    rig.add(loft(bend([0.035 * s, -0.04, 0.012], [0.05 * s, -0.07, 0.03], [0.04 * s, -0.09, 0.05], 3), 0.01, { radial: 5 }), `hand${S}`, { paint: djinnSkin });
  }
  // The smoke tail: a swirl from the waist tapering to a wisp, skin fading into vapour.
  const ys = [0.82, 0.65, 0.48, 0.32];
  const path = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    path.push(new V3(Math.sin(t * 4.2) * 0.07 * t, 0.84 - t * 0.6, -0.12 * t * t + Math.cos(t * 4.2) * 0.05 * t - 0.05 * t));
  }
  const tailG = loft(path, (t) => (0.13 * Math.pow(1 - t, 1.25) + 0.012) * (1 + 0.07 * Math.sin(t * 26)), { radial: 12 });
  rig.add(tailG, 'tail0', { world: true, skin: chainSkin(tails, ys), paint: (v) => {
    const t = clamp((0.84 - v.wp.y) / 0.6, 0, 1);
    djinnSkin(v);
    v.c.lerp(new THREE.Color(0x6a8ad0), smooth(0.05, 0.7, t)).lerp(new THREE.Color(0xa8c0e8), smooth(0.6, 1, t));
    v.s[2] = 0.07 + 0.35 * smooth(0.2, 1, t);
    v.s[0] = 0.6;
  } });
  // Wisps of smoke spiralling around the tail.
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, a = k * 2.1 + t * 6.5, r = 0.07 + 0.1 * Math.sin(Math.PI * t) + 0.04 * (1 - t);
      pts.push(new V3(path[Math.round(t * 16)].x + Math.cos(a) * r, 0.88 - t * 0.66, path[Math.round(t * 16)].z + Math.sin(a) * r));
    }
    rig.add(loft(pts, (t) => 0.05 * Math.sin(Math.PI * t) + 0.005, { radial: 4, flat: [0.15, 1], caps: false }), 'tail0', {
      layer: 'smoke', world: true, skin: chainSkin(tails, ys), paint: (v) => {
        const t = clamp((0.88 - v.wp.y) / 0.66, 0, 1);
        v.c.set(0xb8cdf0).lerp(new THREE.Color(0xe0e8ff), t);
        v.a = 0.42 * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(t * 9 + k));
      },
    });
  }
  // The fire orb: a white-hot core in the body, flames around it.
  rig.add(ell(0.06, 0.06, 0.06, 12, 8), 'orb', { color: 0xff8a1c, glow: 3.4, rough: 0.3 });
  rig.add(ell(0.095, 0.095, 0.095, 12, 8), 'orb', { layer: 'fire', paint: (v) => { v.c.set(0xff5a08); v.a = 0.55; } });
  rig.add(ell(0.13, 0.15, 0.13, 12, 8), 'orb', { layer: 'fire', at: [0, 0.02, 0], paint: (v) => { v.c.set(0xe03004); v.a = 0.3 + 0.2 * clamp(v.n.y, 0, 1); } });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    rig.add(new THREE.ConeGeometry(0.035, 0.14, 6, 1, true).translate(0, 0.07, 0), 'orb', {
      layer: 'fire', at: [Math.cos(a) * 0.05, 0.03, Math.sin(a) * 0.05], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5],
      paint: (v) => { v.c.set(0xffa030).lerp(new THREE.Color(0xff3000), clamp(v.lp.y / 0.14 + 0.3, 0, 1)); v.a = 0.6 * (1 - clamp(v.lp.y / 0.17, 0, 1)); },
    });
  }
  // The sash's loose ends.
  const strips = addStrips(rig, [['waist', [0.08, -0.01, 0.07], 0.22, 0.045, 0.4], ['waist', [0.1, 0.0, 0.0], 0.17, 0.04, 1.3]], (v) => { v.c.set(0x6a1468); v.s[0] = 0.6; });
  return {
    rig: rig.finish(),
    materials: { body: bodyMaterial(), smoke: fxMaterial(false), fire: fxMaterial(true) },
    strips,
    height: 1.72,
    blob: [0.4, 0.36],
  };
}

class Djinn extends Creature {
  constructor(tpl, uid) {
    super(tpl, uid);
    this.castLength = 0;
    this.hang = new Hanging(this, tpl.strips);
    this.tails = [0, 1, 2, 3].map((i) => this.b[`tail${i}`]);
    this.smoke = this.mats[1];
    this.fire = this.mats[2];
  }

  animate(dt, s) {
    const b = this.b, t = this.time, w = this.walk;
    const wind = s.wind > 0 ? ease(s.wind) : 0;
    const hit = this.strikeT >= 0 ? strikeCurve(this.strikeT / 0.5, 0.25) : 0;
    const thrown = this.strikeT >= 0 ? clamp(this.strikeT / 0.18, 0, 1) : 1;
    const charge = Math.max(wind, this.strikeT >= 0 ? 1 - thrown : 0);
    // A gentle bob; it leans into its flight and rises as it gathers the fire.
    shift(b.float, 0, Math.sin(t * 1.8) * 0.06 + wind * 0.08 - hit * 0.04, 0);
    turn(b.float, 0, 0, Math.sin(t * 0.9) * 0.03);
    turn(b.waist, w * 0.28 - wind * 0.12 + hit * 0.2 + Math.sin(t * 1.8 + 0.6) * 0.03, Math.sin(t * 0.6) * 0.08 * (1 - wind), 0);
    turn(b.chest, Math.sin(t * 1.4) * 0.02 - wind * 0.08, Math.sin(t * 0.6 + 0.5) * 0.06 * (1 - wind), 0);
    turn(b.head, -w * 0.18 + wind * 0.12 - hit * 0.1, Math.sin(t * 0.45) * 0.15 * (1 - wind), 0);
    // The tail swirls; it trails behind when it flies.
    this.tails.forEach((seg, i) => {
      const p = t * 2.2 - i * 0.9;
      turn(seg, Math.sin(p) * 0.12 + w * (0.18 + i * 0.06), t * 0.8 * (i === 0 ? 1 : 0) + Math.sin(p * 0.7) * 0.2, Math.cos(p) * 0.12);
    });
    // Arms: menacing and loose when idle; cupped together round the growing orb, then thrust out to hurl it.
    for (const S of ['L', 'R']) {
      const k = S === 'R' ? 1 : -1, off = k > 0 ? 0 : 1.7;
      const idleX = -0.25 + Math.sin(t * 1.2 + off) * 0.08 - w * 0.25 * (1 - wind);
      turn(b[`arm${S}`], idleX * (1 - wind) - 0.5 * wind - 1.2 * hit, 0, k * (0.05 + 0.04 * Math.sin(t + off)) * (1 - wind) - k * 0.24 * wind - k * 0.15 * hit);
      turn(b[`fore${S}`], 0.2 * (1 - wind) - 0.4 * wind + 0.7 * hit, 0.55 * k * wind * (1 - hit), 0);
      turn(b[`hand${S}`], -0.3 * wind - 0.4 * hit, 0, k * 0.5 * wind);
    }
    // The orb swells with the wind-up, flickering, and flies off with the throw.
    const grow = charge > 0.01 ? charge : 0;
    const flick = 1 + 0.08 * Math.sin(t * 31) + 0.05 * Math.sin(t * 17.3);
    b.orb.scale.setScalar(Math.max(1e-3, grow * flick * (0.4 + 0.6 * grow)));
    shift(b.orb, 0, 0.04 * wind, 0.06 * wind + (this.strikeT >= 0 ? thrown * 0.9 : 0));
    turn(b.orb, t * 3, t * 4.3, 0);
    this.smoke.opacity = this.fade;
    this.fire.opacity = this.fade;
    this.body.userData.glow.value = 1 + 0.6 * charge;
    if (s.stunned) turn(b.head, 0.3, 0.4 * Math.sin(t * 7), 0.2 * Math.sin(t * 5));
    this.hang.update(dt, 0.8);
  }

  dying(dt, d) {
    const b = this.b;
    // It howls, spins up into its own smoke and is gone.
    const k = ease(d / 1.3);
    shift(b.float, 0, 0.6 * k, 0);
    turn(b.float, 0, d * d * 6, 0);
    turn(b.waist, -0.3 * k, 0, 0);
    turn(b.head, 0.4 * k, 0, 0);
    for (const S of ['L', 'R']) turn(b[`arm${S}`], -0.3, 0, (S === 'R' ? 1 : -1) * 1.2 * k);
    this.root.scale.setScalar(Math.max(0.01, 1 - 0.7 * k));
    b.orb.scale.setScalar(1e-3);
    this.setFade(clamp(1 - (d - 0.3) / 1.0, 0, 1));
    this.smoke.opacity = Math.min(1, this.fade * 1.5);
    this.fire.opacity = 0;
    this.hang.update(dt, 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Sand Pharaoh.

const LAPIS = 0x1a3690, CARNELIAN = 0xa8221a, TURQUOISE = 0x2aa89a, ROBE = 0x2c2234;

/** Gold and lapis stripes across lp.y (or a custom coordinate), each `w` wide. */
function stripes(w, at = (v) => v.lp.y, blue = LAPIS) {
  return (v) => {
    const k = Math.floor(at(v) / w);
    if (k % 2 === 0) gold(v);
    else { v.c.set(blue); v.s[0] = 0.35; v.s[1] = 0.1; }
  };
}

/** Dark, ragged robe cloth on the linen weave. */
function robePaint(tint = ROBE) {
  const base = new THREE.Color(tint);
  return (v) => {
    v.c.copy(base).multiplyScalar(0.85 + 0.3 * vnoise(v.wp.x * 9, v.wp.y * 7, v.wp.z * 9));
    v.s[0] = 0.95;
    v.s[3] = 1;
  };
}

/** The flail's strands: chains of gold and lapis beads on swinging bones. */
function addStrands(rig, parent, at, count, len) {
  rig.top.updateMatrixWorld(true);
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = `strand${i}a`, b = `strand${i}b`, x = (i - (count - 1) / 2) * 0.022;
    rig.boneWorld(a, parent, at.x + x, at.y, at.z);
    rig.bone(b, a, 0, -len * 0.5, 0);
    for (let k = 0; k < 6; k++) {
      const y = -0.02 - k * (len / 6);
      const g = ell(0.014 - k * 0.0008, len / 12, 0.014 - k * 0.0008, 7, 5);
      rig.add(g, k < 3 ? a : b, { world: true, at: [at.x + x, at.y + y, at.z], paint: k % 2 ? (v) => { v.c.set(LAPIS); v.s[0] = 0.3; } : gold });
    }
    list.push({ a, b, parent, phase: i * 2.3 });
  }
  return list;
}

function buildPharaoh() {
  const rig = new Rig();
  rig.bone('aura', null, 0, 0, 0);
  rig.bone('hips', null, 0, 0.75, 0);
  rig.bone('spine', 'hips', 0, 0.07, 0, 0.08, 0, 0);
  rig.bone('chest', 'spine', 0, 0.2, 0, 0.06, 0, 0);
  rig.bone('neck', 'chest', 0, 0.22, 0.0, -0.06, 0, 0);
  // A big head and headdress read from the game's high camera (bone scale: the parts are built larger).
  rig.bone('head', 'neck', 0, 0.07, 0.01, -0.06, 0, 0).scale.setScalar(1.22);
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.bone(`arm${S}`, 'chest', 0.2 * s, 0.15, -0.01, 0, 0, 0.16 * s);
    rig.bone(`fore${S}`, `arm${S}`, 0, -0.27, 0, s > 0 ? -0.55 : -0.85, s > 0 ? 0 : 0.3, 0);
    rig.bone(`hand${S}`, `fore${S}`, 0, -0.25, 0, 0, 0, 0);
    rig.bone(`thigh${S}`, 'hips', 0.1 * s, -0.05, 0, 0, 0, 0.02 * s);
    rig.bone(`shin${S}`, `thigh${S}`, 0, -0.36, 0, 0.04, 0, 0);
    rig.bone(`foot${S}`, `shin${S}`, 0, -0.33, 0, -0.04, 0, 0);
  }
  rig.top.updateMatrixWorld(true);
  const dark = 0x4a4038;
  // The robe: a long, dark gown flaring to a tattered hem, swinging with the legs.
  const robe = loft(line([0, 0.86, 0], [0, 0.03, 0], 12), (t) => 0.15 + 0.15 * Math.pow(t, 1.4), { radial: 20, flat: [0.82, 1], caps: false });
  warp(robe, (p) => {
    if (p.y < 0.2) {
      const a = Math.atan2(p.x, p.z);
      p.y += (0.2 - p.y) / 0.17 * 0.07 * (0.5 + 0.5 * Math.sin(a * 7) * Math.sin(a * 3 + 1));
    }
  });
  const ruv = robe.attributes.uv;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 6, ruv.getY(i) / LINEN_TILE);
  rig.add(robe, 'hips', {
    world: true,
    paint: robePaint(),
    skin: (wp) => {
      const t = smooth(0.72, 0.4, wp.y), side = smooth(-0.05, 0.05, wp.x);
      return [['hips', 1 - t], ['thighR', t * side], ['thighL', t * (1 - side)]];
    },
  });
  // Upper robe over a gaunt chest, a gold belt with a striped apron.
  rig.add(warp(wrapped([0, -0.1, 0], [0, 0.22, 0], 0.135, 0.15, 3, 14, 5), (p) => {
    p.x *= 1 + 0.25 * smooth(0.05, 0.2, p.y);
    p.z *= 0.75;
  }), 'chest', { at: [0, -0.02, 0], paint: robePaint(), skin: (wp) => {
    const t = smooth(0.86, 1.0, wp.y);
    return [['spine', 1 - t], ['chest', t]];
  } });
  rig.add(ring(0.15, 0.022, [1.6, 0.7], 6, 22), 'hips', { at: [0, 0.1, 0], scale: [1, 1, 0.83], paint: gold });
  rig.add(new THREE.BoxGeometry(0.15, 0.3, 0.015, 1, 8, 1), 'hips', { at: [0, -0.07, 0.135], rot: [0.08, 0, 0], faces: true, paint: (v) => {
    stripes(0.0375)(v);
    if (Math.abs(v.lp.x) > 0.06) gold(v);
  } });
  // The broad collar: rings of gold, lapis, carnelian and turquoise over the shoulders.
  const collar = new THREE.LatheGeometry([new THREE.Vector2(0.25, -0.1), new THREE.Vector2(0.18, -0.045), new THREE.Vector2(0.12, 0.0), new THREE.Vector2(0.075, 0.03)], 28);
  rig.add(collar, 'chest', { at: [0, 0.23, 0.0], scale: [1, 1, 0.78], faces: true, paint: (v) => {
    const r = Math.hypot(v.lp.x, v.lp.z / 0.78);
    const band = Math.floor((r - 0.075) / 0.026);
    [gold, (w) => { w.c.set(LAPIS); w.s[0] = 0.35; }, gold, (w) => { w.c.set(CARNELIAN); w.s[0] = 0.3; }, gold, (w) => { w.c.set(TURQUOISE); w.s[0] = 0.3; }, gold][clamp(band, 0, 6)](v);
  } });
  for (const s of [-1, 1]) rig.add(ell(0.065, 0.06, 0.065, 10, 8), 'chest', { at: [0.175 * s, 0.11, -0.01], paint: robePaint() });
  rig.add(loft(line([0, -0.02, 0], [0, 0.09, 0], 2), 0.045, { radial: 10 }), 'neck', { color: dark, rough: 0.8 });
  // The death mask: a gold face with kohl-lined, glowing eyes.
  const eyes = [[-0.032, 0.012], [0.032, 0.012]];
  rig.add(warp(ell(0.085, 0.105, 0.092, 18, 14), (p) => {
    if (p.y < -0.02) p.x *= 1 - 0.2 * smooth(-0.02, -0.1, p.y);
    if (p.z > 0) {
      for (const [ex, ey] of eyes) {
        const d = Math.hypot(p.x - ex, (p.y - ey) * 1.6);
        if (d < 0.03) p.z -= 0.014 * (1 - d / 0.03);
      }
      p.z += 0.016 * Math.exp(-((p.x / 0.012) ** 2)) * smooth(0.03, -0.01, p.y) * smooth(-0.05, -0.01, p.y);
    }
  }), 'head', { at: [0, 0.1, 0.012], paint: (v) => {
    gold(v);
    v.s[0] = 0.22;
    for (const [ex, ey] of eyes) {
      const dx = v.lp.x - ex, dy = v.lp.y - 0.1 - ey;
      const k = smooth(0.026, 0.018, Math.hypot(dx, dy * 1.6)) + smooth(0.006, 0.002, Math.abs(dy + dx * 0.25 * Math.sign(ex) - 0.012)) * smooth(0.05, 0.03, Math.abs(dx));
      if (k > 0) { v.c.lerp(new THREE.Color(0x0a0e22), clamp(k, 0, 1)); v.s[1] *= 1 - clamp(k, 0, 1); }
    }
    const mouth = smooth(0.006, 0.002, Math.abs(v.lp.y - 0.1 + 0.058)) * smooth(0.03, 0.02, Math.abs(v.lp.x));
    v.c.lerp(new THREE.Color(0x3a2008), mouth);
  } });
  for (const [ex, ey] of eyes) rig.add(ell(0.013, 0.009, 0.006, 8, 6), 'head', { at: [ex, 0.1 + ey, 0.094], color: CURSE, glow: 6, rough: 0.2 });
  // The nemes: a striped headcloth with flaring sides, lappets on the chest, the cobra on the brow.
  rig.add(warp(dome(0.112, 0.1, 0.112, 18, 6), (p) => { p.z -= 0.01 * (p.y / 0.1); }), 'head', { at: [0, 0.135, -0.003], faces: true, paint: stripes(0.016, (v) => v.lp.y + 0.003) });
  const profile = [new THREE.Vector2(0.113, 0.0), new THREE.Vector2(0.13, -0.06), new THREE.Vector2(0.17, -0.15), new THREE.Vector2(0.23, -0.25), new THREE.Vector2(0.235, -0.28)];
  const nemes = new THREE.LatheGeometry([...profile].reverse(), 22, 0.75, TAU - 1.5);
  rig.add(nemes, 'head', { at: [0, 0.135, -0.003], scale: [1, 1, 0.8], faces: true, paint: stripes(0.022, (v) => v.lp.y + 0.3) });
  // Its dark lining, seen through the open front.
  rig.add(new THREE.LatheGeometry(profile, 22, 0.75, TAU - 1.5).scale(0.985, 1, 0.985), 'head', { at: [0, 0.133, -0.003], scale: [1, 1, 0.8], color: 0x1a1430, rough: 0.9 });
  for (const s of [-1, 1]) {
    rig.add(new THREE.BoxGeometry(0.07, 0.24, 0.016, 1, 8, 1), 'head', { at: [0.135 * s, -0.17, 0.06], rot: [0.12, 0, -0.08 * s], faces: true, paint: stripes(0.03) });
  }
  rig.add(ring(0.112, 0.008, [1, 1.6], 4, 24), 'head', { at: [0, 0.14, -0.003], scale: [1, 1, 1], paint: gold });
  rig.add(loft(bend([0, 0.125, 0.105], [0, 0.17, 0.12], [0, 0.2, 0.108], 4), (t) => 0.011 + 0.005 * t, { radial: 6 }), 'head', { paint: gold });
  rig.add(ell(0.018, 0.012, 0.014, 8, 6), 'head', { at: [0, 0.205, 0.11], paint: gold });
  rig.add(ell(0.007, 0.007, 0.006, 6, 4), 'head', { at: [0, 0.2, 0.123], color: CARNELIAN, glow: 1.2 });
  rig.add(loft(line([0, -0.01, 0.07], [0, -0.1, 0.062], 5), (t) => 0.016 - 0.004 * t, { radial: 8 }), 'head', { faces: true, paint: stripes(0.015, (v) => v.lp.y + 0.2) });
  // Arms: wrapped and dark, gold at the wrists; withered hands.
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.add(wrapped([0, 0.02, 0], [0, -0.28, 0], 0.06, 0.05, 20 + s, 10, 6), `arm${S}`, { paint: robePaint(0x3a3040) });
    rig.add(wrapped([0, 0.01, 0], [0, -0.25, 0], 0.048, 0.04, 22 + s, 10, 6), `fore${S}`, { paint: linenPaint(0x8a7c68, 0.3, 30 + s) });
    rig.add(loft(line([0, -0.13, 0], [0, -0.23, 0], 2), 0.05, { radial: 12 }), `fore${S}`, { faces: true, paint: stripes(0.025, (v) => -v.lp.y) });
    rig.add(ell(0.036, 0.045, 0.024, 8, 6), `hand${S}`, { at: [0, -0.04, 0], color: dark, rough: 0.8 });
    for (let f = 0; f < 4; f++) {
      const x = (-0.022 + f * 0.015) * s;
      rig.add(loft(bend([x, -0.07, 0.0], [x, -0.1, 0.03], [x * 0.8, -0.085, 0.05], 3), 0.0085, { radial: 5 }), `hand${S}`, { color: dark, rough: 0.8 });
    }
    rig.add(loft(bend([0.03 * s, -0.04, 0.015], [0.03 * s, -0.06, 0.05], [0.01 * s, -0.075, 0.055], 3), 0.009, { radial: 5 }), `hand${S}`, { color: dark, rough: 0.8 });
  }
  // Legs, mostly hidden: dark wrapped shins and gold sandals.
  for (const s of [-1, 1]) {
    const S = s > 0 ? 'R' : 'L';
    rig.add(wrapped([0, 0.0, 0], [0, -0.36, 0], 0.07, 0.058, 25 + s, 8, 4), `thigh${S}`, { paint: robePaint() });
    rig.add(wrapped([0, 0.0, 0], [0, -0.33, 0], 0.056, 0.044, 27 + s, 8, 4), `shin${S}`, { paint: linenPaint(0x6a5e50) });
    rig.add(warp(ell(0.048, 0.035, 0.105, 10, 6), (p) => { if (p.y < -0.012) p.y = -0.012 + (p.y + 0.012) * 0.3; }), `foot${S}`, { at: [0, -0.02, 0.045], paint: (v) => {
      v.c.set(dark); v.s[0] = 0.8;
      if (v.lp.y < -0.02) gold(v);
    } });
  }
  // The crook-staff in his right hand: banded gold and lapis, hooked at the top round a glowing eye.
  const hand = rig.by.handR.localToWorld(new V3(0, -0.05, 0.01));
  rig.boneWorld('staff', 'handR', hand.x, hand.y, hand.z);
  rig.add(loft(line([0, -hand.y + 0.02, 0], [0, 0.72, 0], 12), 0.019, { radial: 8 }), 'staff', {
    at: [hand.x, hand.y, hand.z], world: true, faces: true, paint: stripes(0.06, (v) => v.wp.y),
  });
  const hook = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 1.25;
    hook.push(new V3(0, 0.72 + Math.sin(a) * 0.09, -Math.cos(a) * 0.09 + 0.09));
  }
  rig.add(loft(hook, (t) => 0.02 - 0.006 * t, { radial: 8 }), 'staff', { at: [hand.x, hand.y, hand.z], world: true, faces: true, paint: stripes(0.04, (v) => v.wp.y + v.wp.z) });
  rig.add(ell(0.032, 0.04, 0.032, 10, 8), 'staff', { at: [hand.x, hand.y + 0.72, hand.z], world: true, paint: gold });
  rig.add(ell(0.02, 0.024, 0.02, 10, 8), 'staff', { at: [hand.x, hand.y + 0.75, hand.z + 0.02], world: true, color: CURSE, glow: 4, rough: 0.15 });
  // The flail in his left: a short banded rod with three beaded strands.
  const lh = rig.by.handL.localToWorld(new V3(0, -0.05, 0.01));
  rig.boneWorld('flail', 'handL', lh.x, lh.y, lh.z);
  rig.add(loft(line([0, -0.06, 0], [0, 0.22, 0.08], 6), 0.014, { radial: 7 }), 'flail', { at: [lh.x, lh.y, lh.z], world: true, faces: true, paint: stripes(0.04, (v) => v.wp.y) });
  const top = new V3(lh.x, lh.y + 0.22, lh.z + 0.08);
  rig.add(ell(0.02, 0.02, 0.02, 8, 6), 'flail', { at: [top.x, top.y, top.z], world: true, paint: gold });
  const strands = addStrands(rig, 'flail', top, 3, 0.22);
  // The cape: dark rags hanging from the shoulders, and loose strips at the hem and sleeves.
  const rags = addStrips(rig, [
    ['chest', [0.0, 0.16, -0.12], 0.95, 0.3, 0.0, 0.3],
    ['chest', [-0.13, 0.15, -0.09], 0.85, 0.14, 0.4, 0.3],
    ['chest', [0.13, 0.15, -0.09], 0.88, 0.14, -0.4, 0.3],
    ['foreL', [0.03, -0.1, 0.0], 0.3, 0.05, 0.4],
    ['foreR', [-0.03, -0.08, 0.0], 0.26, 0.05, -0.6],
    ['hips', [0.12, 0.05, 0.08], 0.55, 0.06, -0.3],
  ], robePaint(0x241c2c));
  // The aura: pale gold wisps of sand and spirit rising in a slow spiral round him.
  for (let k = 0; k < 5; k++) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, a = (k / 5) * TAU + t * 2.4, r = 0.36 - 0.14 * t;
      pts.push(new V3(Math.cos(a) * r, 0.02 + t * 1.5, Math.sin(a) * r));
    }
    rig.add(loft(pts, (t) => 0.045 * Math.sin(Math.PI * t) + 0.01, { radial: 4, flat: [0.2, 1], caps: false }), 'aura', {
      layer: 'aura', paint: (v) => {
        const t = clamp(v.lp.y / 1.5, 0, 1);
        v.c.set(0xffa830).lerp(new THREE.Color(0x30e0b0), smooth(0.35, 1, t));
        v.a = 0.3 * Math.sin(Math.PI * t) ** 1.5;
      },
    });
  }
  const groundRing = new THREE.RingGeometry(0.3, 0.55, 32, 1).rotateX(-Math.PI / 2);
  rig.add(groundRing, 'aura', { layer: 'aura', at: [0, 0.03, 0], paint: (v) => {
    const r = Math.hypot(v.lp.x, v.lp.z);
    v.c.set(0xffa030);
    v.a = r < 0.4 ? 0.22 : 0.0;
  } });
  const maps = linenMaps();
  return {
    rig: rig.finish(),
    materials: { body: bodyMaterial({ map: maps.map, normalMap: maps.normal, normalScale: new THREE.Vector2(1.1, 1.1) }), aura: fxMaterial(true) },
    strips: [...rags, ...strands],
    scale: 1.62,
    height: 2.55,
    blob: [0.85, 0],
  };
}

class Pharaoh extends Creature {
  constructor(tpl, uid) {
    super(tpl, uid);
    this.castLength = 1.5;
    this.hang = new Hanging(this, tpl.strips);
    this.aura = this.mats[1];
    this.swings = 0;
    this.flare = 0;
  }

  animate(dt, s) {
    const b = this.b, t = this.time, w = this.walk;
    // A slow, heavy stride.
    const rate = clamp(this.speed / (0.95 * 1.62), 0.5, 1.4);
    this.phase += dt * TAU * (s.moving ? rate * 0.6 : 0);
    const ph = this.phase, sw = Math.sin(ph), cw = Math.cos(ph);
    if (s.wind > 0 && this.lastWindStart !== true) { this.swings++; this.lastWindStart = true; }
    if (s.wind <= 0) this.lastWindStart = false;
    const flail = this.swings % 2 === 0;
    const wind = s.wind > 0 ? ease(s.wind) : 0;
    const hit = this.strikeT >= 0 ? strikeCurve(this.strikeT / 0.6, 0.28) : 0;
    const cast = this.castT >= 0 ? this.castT / this.castLength : -1;
    const raise = cast >= 0 ? ease(cast / 0.35) * (1 - ease((cast - 0.75) / 0.25)) : 0;
    const push = cast >= 0 ? strikeCurve((cast - 0.6) / 0.4, 0.3) : 0;
    const breathe = Math.sin(t * 1.1);
    // Legs and hips.
    turn(b.thighR, -0.38 * sw * w - hit * 0.3, 0, 0);
    turn(b.shinR, 0.6 * Math.max(0, cw) * w + hit * 0.3, 0, 0);
    turn(b.footR, -0.2 * Math.max(0, cw) * w, 0, 0);
    turn(b.thighL, 0.38 * sw * w + hit * 0.15, 0, 0);
    turn(b.shinL, 0.6 * Math.max(0, -cw) * w, 0, 0);
    turn(b.footL, -0.2 * Math.max(0, -cw) * w, 0, 0);
    shift(b.hips, 0, -0.025 * Math.abs(cw) * w - hit * 0.05 + raise * 0.02, hit * 0.08);
    turn(b.hips, 0, 0.1 * sw * w, 0.03 * sw * w);
    // The upper body: imposing, leaning back to wind up and over to strike; arched back as it casts.
    const lean = -wind * (flail ? 0.08 : 0.2) + hit * (flail ? 0.15 : 0.35) - raise * 0.18 + push * 0.2;
    turn(b.spine, breathe * 0.015 + lean, -0.12 * sw * w + (flail ? -0.3 * wind + 0.5 * hit : 0), 0);
    turn(b.chest, breathe * 0.012 + lean * 0.4, flail ? -0.2 * wind + 0.3 * hit : 0, 0);
    turn(b.neck, -lean * 0.4, 0.12 * Math.sin(t * 0.4) * (1 - raise), 0);
    turn(b.head, -raise * 0.35 + 0.03 * Math.sin(t * 0.7), 0.1 * Math.sin(t * 0.27 + 2) * (1 - raise), 0);
    // Right arm and the staff: planted, swung overhead and slammed down, or raised high to call the storm.
    const staffUp = flail ? 0 : wind;
    turn(b.armR, 0.12 * sw * w - 2.5 * staffUp + 1.6 * hit * (flail ? 0 : 1) - 1.2 * raise - 1.3 * push, 0, -0.05 * staffUp + 0.55 * raise);
    turn(b.foreR, 0.45 * staffUp - 0.3 * hit * (flail ? 0 : 1) - 0.2 * raise + 0.4 * push, 0, 0);
    turn(b.handR, 0, 0, 0);
    // Left arm and the flail: drawn back across the body, lashed out sideways; spread wide when casting.
    const lashUp = flail ? wind : 0, lash = flail ? hit : 0;
    turn(b.armL, -0.12 * sw * w - 1.1 * lashUp - 0.6 * lash - 1.1 * raise + 0.04 * breathe, 0.9 * lashUp - 1.4 * lash, -0.5 * lashUp + 0.3 * lash - 0.55 * raise);
    turn(b.foreL, 0.4 * lashUp + 0.6 * lash - 0.1 * raise, 0, 0);
    // Aura: a slow turn and pulse, flaring when he casts or strikes.
    this.flare = Math.max(raise, push, hit * 0.6, this.flare - dt * 1.5);
    turn(b.aura, 0, t * 0.6, 0);
    b.aura.scale.setScalar(1 + 0.08 * Math.sin(t * 2.3) + 0.3 * this.flare);
    this.aura.opacity = (0.75 + 0.25 * Math.sin(t * 3.1) + 0.6 * this.flare) * this.fade;
    this.body.userData.glow.value = 1 + 0.8 * this.flare + 0.15 * Math.sin(t * 4);
    if (s.stunned) turn(b.head, 0.25, 0.3 * Math.sin(t * 6), 0.15);
    this.hang.update(dt, 0.7 + w * 0.5 + this.flare);
  }

  dying(dt, d) {
    const b = this.b;
    // He reels, falls to his knees with his arms flung wide and his face to the sky, his spirit bursts out
    // of him in a blaze of light, and what is left crumbles into the sand.
    const reel = strikeCurve(d / 0.7, 0.4), kneel = ease((d - 0.3) / 0.55), burst = ease((d - 0.9) / 0.6);
    turn(b.thighR, -1.25 * kneel, 0, 0);
    turn(b.thighL, -1.1 * kneel, 0, -0.08 * kneel);
    turn(b.shinR, 1.9 * kneel, 0, 0);
    turn(b.shinL, 1.8 * kneel, 0, 0);
    turn(b.footR, 0.5 * kneel, 0, 0);
    turn(b.footL, 0.5 * kneel, 0, 0);
    shift(b.hips, 0, -0.36 * kneel, -0.08 * reel + 0.08 * kneel);
    turn(b.hips, 0, 0, 0);
    turn(b.spine, -0.35 * reel - 0.3 * kneel + 0.5 * ease((d - 1.6) / 0.8), 0, 0);
    turn(b.chest, -0.2 * kneel, 0, 0);
    turn(b.neck, -0.3 * kneel, 0, 0);
    turn(b.head, -0.4 * kneel, 0, 0);
    turn(b.armR, -0.6 * kneel, 0, 1.2 * kneel);
    turn(b.foreR, -0.2 * kneel, 0, 0);
    turn(b.armL, -0.6 * kneel, 0, -1.2 * kneel);
    turn(b.foreL, -0.2 * kneel, 0, 0);
    turn(b.aura, 0, d * (1 + d * 3), 0);
    b.aura.scale.setScalar(1 + burst * 1.4);
    this.aura.opacity = (0.8 + 0.9 * Math.sin(Math.PI * clamp(burst, 0, 1))) * (1 - ease((d - 1.5) / 0.9));
    this.body.userData.glow.value = 1 + 3 * Math.sin(Math.PI * clamp((d - 0.8) / 1.2, 0, 1));
    this.hang.update(dt, 1.5 * (1 - burst) + 0.3);
    if (d > 1.9) this.root.position.y = -(d - 1.9) * 0.45;
    if (d > 2.0) this.setFade(clamp(1 - (d - 2.0) / 1.1, 0, 1));
  }
}

// ---------------------------------------------------------------------------------------------------------------

const KINDS = {
  SCORPION: { build: buildScorpion, Ctor: Scorpion, deathLength: 2.4 },
  MUMMY: { build: buildMummy, Ctor: Mummy, deathLength: 2.6 },
  DJINN: { build: buildDjinn, Ctor: Djinn, deathLength: 1.5 },
  SAND_PHARAOH: { build: buildPharaoh, Ctor: Pharaoh, deathLength: 3.2 },
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
