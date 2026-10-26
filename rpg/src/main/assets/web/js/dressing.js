import * as THREE from 'three';
import { TILE, hash } from './defs.js';
import { applyOcclusion } from './occlude.js';
import { kitSurface } from './surface.js';

/**
 * Dungeon dressing: turns the wall boxes into built (or grown) architecture and litters their feet.
 * Stone base trims and cornices with mitred corners, pilasters along long walls, pillars on outer
 * corners, rubble, bones, cobwebs and chains, and per biome banners and candles (crypt), a rocky
 * skirt and lip with stalactites, moss and glowing crystals (cave) or glowing lava cracks (hell).
 * Everything hugs the walls (within about a quarter tile of the face) and is merged into three
 * static meshes: stone (the biome's wall-top texture), kit (the KayKit dungeon atlas with a
 * per-vertex glow) and decals (a small canvas atlas, blended). Placement depends only on tile
 * coordinates, so a level always looks the same.
 */

const WALL_H = 1.9;
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const WHITE = [1, 1, 1];

/** Wall profiles as [depth out from the face, height], bottom to top; per-biome colours and odds. */
const STYLE = {
  CRYPT: {
    tex: 'crypt',
    stone: [5.2, 5.0, 4.7],
    base: [[0.1, -0.06], [0.1, 0.12], [0.05, 0.17], [0.05, 0.24], [0, 0.29]],
    top: [[0, 1.68], [0.05, 1.73], [0.05, 1.79], [0.1, 1.84], [0.1, 1.96], [-0.24, 1.96], [-0.24, 1.9]],
    pillars: true, moss: 0.15, web: 0.6, rubble: 0.1, bones: 0.06, piles: 0.25, chains: 0.04,
  },
  CAVE: {
    tex: 'cave',
    stone: [3.3, 3.4, 3.5],
    base: [[0.17, -0.06], [0.13, 0.18], [0, 0.42]],
    top: [[0, 1.5], [0.15, 1.7], [0.12, 1.95], [-0.3, 1.97], [-0.3, 1.9]],
    rough: true, moss: 0.7, web: 0.5, rubble: 0.14, bones: 0.04, piles: 0.1, chains: 0,
  },
  HELL: {
    tex: 'hell',
    stone: [1.7, 1.45, 1.45],
    base: [[0.11, -0.06], [0.11, 0.18], [0.04, 0.25], [0, 0.3]],
    top: [[0, 1.66], [0.06, 1.72], [0.06, 1.84], [0.11, 1.88], [0.11, 1.96], [-0.24, 1.96], [-0.24, 1.9]],
    pillars: true, moss: 0, web: 0, rubble: 0.12, bones: 0.06, piles: 0.3, chains: 0.04,
  },
};

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
const _m = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(), _e = new THREE.Euler();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

/** A transform from position, Euler rotation (YXZ, so yaw comes first) and scale. */
function mat(x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** UV of a spot in the 8x4 colour-gradient atlas the KayKit models share (t runs down the gradient). */
function cellUV(col, row, t) {
  return [(col + 0.5) / 8, (row + 0.1 + 0.8 * t) / 4];
}

/** Collects flat triangles for one merged mesh. */
class Batch {
  constructor(planar = false, ao = false, glows = false) {
    this.planar = planar; // project the texture from world space (stone) instead of using UVs
    this.ao = ao; // darken towards the floor
    this.glows = glows; // carries the aGlow attribute
    this.face = null; // [nx, nz] of the wall the next pieces hang on (see material)
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.glow = [];
    this.wall = [];
  }

  vertex(p, n, u, v, c, glow) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    if (this.planar) {
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      if (ay > ax && ay > az) this.uv.push(p.x * 0.5, p.z * 0.5);
      else if (ax > az) this.uv.push(p.z * 0.5, p.y * 0.5);
      else this.uv.push(p.x * 0.5, p.y * 0.5);
    } else {
      this.uv.push(u, v);
    }
    const k = this.ao ? 0.6 + 0.4 * THREE.MathUtils.smoothstep(p.y, -0.05, 0.5) : 1;
    this.col.push(c[0] * k, c[1] * k, c[2] * k);
    this.glow.push(glow);
    if (this.face) this.wall.push(this.face[0], this.face[1]);
    else this.wall.push(0, 0);
  }

  /** A flat quad a-b-c-d wound to face along hint; cols is one colour or four, uvs four pairs. */
  quad(a, b, c, d, hint, cols = WHITE, uvs = null, glow = 0) {
    _n.subVectors(c, a).cross(_t.subVectors(d, b));
    const flip = _n.dot(hint) < 0;
    if (flip) _n.negate();
    _n.normalize();
    const q = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const pts = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const k = q[i];
      const col = cols.length === 4 ? cols[k] : cols;
      this.vertex(pts[k], _n, uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0, col, glow);
    }
  }

  /** A flat triangle, wound like quad. */
  tri(a, b, c, hint, cols = WHITE, uvs = null, glow = 0) {
    _n.subVectors(b, a).cross(_t.subVectors(c, a));
    const flip = _n.dot(hint) < 0;
    if (flip) _n.negate();
    _n.normalize();
    const pts = flip ? [a, c, b] : [a, b, c], q = flip ? [0, 2, 1] : [0, 1, 2];
    for (let i = 0; i < 3; i++) {
      const col = cols.length === 3 && typeof cols[0] !== 'number' ? cols[q[i]] : cols;
      this.vertex(pts[i], _n, uvs ? uvs[q[i]][0] : 0, uvs ? uvs[q[i]][1] : 0, col, glow);
    }
  }

  /**
   * Appends a template transformed by m. opts: color, glow (whole piece) or glowCell [col, row] with
   * glow (only the parts painted from that atlas cell), recolor: a list of [fromCol, fromRow, toCol, toRow].
   */
  add(tpl, m, opts = {}) {
    _nm.getNormalMatrix(m);
    const { pos, nor, uv } = tpl;
    const color = opts.color || WHITE, gc = opts.glowCell, rc = opts.recolor;
    for (let i = 0, n = pos.length / 3; i < n; i++) {
      _a.fromArray(pos, i * 3).applyMatrix4(m);
      _n.fromArray(nor, i * 3).applyMatrix3(_nm).normalize();
      let u = uv[i * 2], v = uv[i * 2 + 1];
      const col = Math.floor(u * 8), row = Math.floor(v * 4);
      if (rc) {
        for (const [c0, r0, c1, r1] of rc) if (col === c0 && row === r0) { u += (c1 - c0) / 8; v += (r1 - r0) / 4; }
      }
      const glow = gc ? (col === gc[0] && row === gc[1] ? opts.glow : 0) : (opts.glow || 0);
      this.vertex(_a, _n, u, v, color, glow);
    }
  }

  mesh(material, name) {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.glows) geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    geo.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wall, 2));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

/** Flat arrays of a (non-indexed) geometry, with UVs painted from an atlas cell along its height. */
function template(geo, cell) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, N = g.attributes.normal;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < P.count; i++) { y0 = Math.min(y0, P.getY(i)); y1 = Math.max(y1, P.getY(i)); }
  const pos = new Float32Array(P.count * 3), nor = new Float32Array(P.count * 3), uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    pos.set([P.getX(i), P.getY(i), P.getZ(i)], i * 3);
    nor.set([N.getX(i), N.getY(i), N.getZ(i)], i * 3);
    if (cell) {
      const k = (P.getY(i) - y0) / Math.max(1e-6, y1 - y0);
      uv.set(cellUV(cell[0], cell[1], cell[3] + (cell[2] - cell[3]) * k), i * 2);
    }
  }
  return { pos, nor, uv };
}

/** Several templates baked into one, each part placed by its matrix. */
function compose(parts) {
  const pos = [], nor = [], uv = [];
  for (const [tpl, m] of parts) {
    _nm.getNormalMatrix(m);
    for (let i = 0; i < tpl.pos.length / 3; i++) {
      _a.fromArray(tpl.pos, i * 3).applyMatrix4(m);
      _n.fromArray(tpl.nor, i * 3).applyMatrix3(_nm).normalize();
      pos.push(_a.x, _a.y, _a.z);
      nor.push(_n.x, _n.y, _n.z);
      uv.push(tpl.uv[i * 2], tpl.uv[i * 2 + 1]);
    }
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv) };
}

/** A kit model flattened into world-free arrays, with its bounds and atlas texture. */
function kitTemplate(assets, name) {
  const node = assets.piece('dungeon', name);
  if (!node) return null;
  node.updateMatrixWorld(true);
  const pos = [], nor = [], uv = [];
  let map = null;
  node.traverse((o) => {
    if (!o.isMesh) return;
    map = map || o.material.map;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
    _nm.getNormalMatrix(o.matrixWorld);
    const count = I ? I.count : P.count;
    for (let k = 0; k < count; k++) {
      const i = I ? I.getX(k) : k;
      _a.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      pos.push(_a.x, _a.y, _a.z);
      nor.push(_n.x, _n.y, _n.z);
      uv.push(U.getX(i), U.getY(i));
    }
  });
  const box = new THREE.Box3().setFromArray(pos);
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), box, map };
}

/** A lumpy low-poly rock: an icosahedron with each corner pushed in or out. */
function rockTemplate(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = 0.72 + 0.45 * hash(Math.round(x * 50) + 99, Math.round(y * 50) + 99, Math.round(z * 50) + seed * 1000);
    P.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return template(geo, [0, 0, 0.3, 0.9]);
}

let decalTexture = null;

/**
 * Canvas atlas for the blended decals (made once): a corner cobweb, two tileable lava cracks for
 * the wall feet, a vertical crack for wall faces and a soot smudge.
 */
function decals() {
  if (decalTexture) return decalTexture;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // Cobweb: a fan of strands from the bottom centre of a 256 square, with sagging rings.
  g.strokeStyle = 'rgba(235,235,230,0.9)';
  g.lineCap = 'round';
  const cx = 128, cy = 252, strands = [];
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + (k / 7 - 0.5) * 1.05 + (hash(k, 3) - 0.5) * 0.08;
    strands.push(a);
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 270, cy + Math.sin(a) * 270);
    g.stroke();
  }
  for (let r = 26, i = 0; r < 250; r += 20 + i * 2.5, i++) {
    g.lineWidth = 1.8;
    g.beginPath();
    for (let k = 0; k < strands.length; k++) {
      const rr = r * (0.92 + hash(k, i, 7) * 0.16);
      const x = cx + Math.cos(strands[k]) * rr, y = cy + Math.sin(strands[k]) * rr;
      if (k === 0) g.moveTo(x, y);
      else {
        const am = (strands[k] + strands[k - 1]) / 2, rm = rr * 0.86;
        g.quadraticCurveTo(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm, x, y);
      }
    }
    g.stroke();
  }
  // Lava cracks along the wall feet: two rows, each tiling end to end through the middle.
  const crack = (x0, y0, w, h, seed, amp) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, e = Math.sin(t * Math.PI);
      pts.push([x0 + t * w, y0 + h / 2 + (hash(i, seed) - 0.5) * amp * e]);
    }
    for (const [width, color, blur] of [[20, 'rgba(200,40,0,0.35)', 18], [9, 'rgba(255,90,10,0.9)', 8], [3.5, 'rgba(255,190,80,1)', 2]]) {
      g.lineWidth = width;
      g.strokeStyle = color;
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      for (let b = 0; b < 3; b++) {
        const [bx, by] = pts[3 + Math.floor(hash(b, seed, 5) * 10)];
        g.moveTo(bx, by);
        g.lineTo(bx + (hash(b, seed, 6) - 0.5) * 50, by + (hash(b, seed, 7) > 0.5 ? 1 : -1) * h * 0.35);
      }
      g.stroke();
    }
    g.shadowBlur = 0;
  };
  crack(256, 0, 256, 64, 1, 34);
  crack(256, 64, 256, 64, 2, 40);
  // A vertical crack running up a wall face (bottom to top, fading out).
  g.save();
  g.translate(448, 256);
  g.rotate(-Math.PI / 2);
  crack(0, -64, 128, 128, 3, 60);
  g.restore();
  const fade = g.createLinearGradient(0, 128, 0, 256);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(384, 128, 128, 128);
  g.globalCompositeOperation = 'source-over';
  // Soot above a torch.
  const soot = g.createRadialGradient(320, 200, 4, 320, 180, 62);
  soot.addColorStop(0, 'rgba(0,0,0,0.85)');
  soot.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  soot.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = soot;
  g.fillRect(256, 128, 128, 128);
  decalTexture = new THREE.CanvasTexture(c);
  decalTexture.colorSpace = THREE.SRGBColorSpace;
  decalTexture.anisotropy = 4;
  return decalTexture;
}

/** UVs of the corners of a rectangle of the decal canvas, in pixels (top-left origin). */
function rect(x, y, w, h) {
  const S = 512;
  return (s, t) => [(x + s * w) / S, 1 - (y + t * h) / S];
}
const WEB = rect(0, 0, 256, 256), LAVA = [rect(258, 0, 252, 64), rect(258, 64, 252, 64)], SEAM = rect(388, 128, 120, 128), SOOT = rect(258, 130, 124, 124);

/**
 * Lit materials with the hero cutaway of the walls and an optional per-vertex glow. Pieces hung on a
 * wall carry its normal (aWall) and vanish above the wall stub while the camera is behind that wall:
 * the walls are hollow, so through a cut-away wall top they would float in mid-air.
 */
function material(params, key, glow) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, ...params });
  mat.onBeforeCompile = (shader) => {
    applyOcclusion(shader, 1.6, 0.32);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWall;\nvarying float vBehind;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vBehind = dot(cameraPosition.xz - (modelMatrix * vec4(transformed, 1.0)).xz, aWall);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBehind;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vBehind < 0.0 && vOccWp.y > 0.32) discard;');
    if (!glow) return;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

class Dresser {
  constructor(world) {
    this.world = world;
    this.level = world.level;
    this.style = STYLE[world.biome] || STYLE.CRYPT;
    this.biome = STYLE[world.biome] ? world.biome : 'CRYPT';
    this.stone = new Batch(true, true);
    this.kit = new Batch(false, false, true);
    this.decal = new Batch(false, false, true);
    this.segs = [];
    this.runs = [];
    this.byKey = new Map();
    this.convex = new Map();
    this.concave = new Map();
    this.busy = new Set(); // floor tiles with a prop, the exit or the like: keep their wall feet clear
  }

  wall(x, y) {
    return this.world.tile(x, y) === TILE.WALL;
  }

  key(x, y, k) {
    return ((y + 1) * (this.level.w + 2) + x + 1) * 4 + k;
  }

  /** 1 where the wall turns away (outer corner), -1 where it meets another wall (inner), 0 straight on. */
  end(x, y, tx, tz, nx, nz) {
    if (!this.wall(x + tx, y + tz)) return 1;
    return this.wall(x + tx + nx, y + tz + nz) ? -1 : 0;
  }

  rnd(s, k) {
    return hash(s.x * 4 + s.k, s.y, k);
  }

  build() {
    const a = this.world.assets;
    this.tpl = {
      rocks: [0, 1, 2, 3].map(rockTemplate),
      candle: kitTemplate(a, 'candle_lit'),
      banners: ['banner_patternA_red', 'banner_red', 'banner_thin_red'].map((n) => kitTemplate(a, n)).filter(Boolean),
    };
    this.makeTemplates();
    this.scan();
    for (const run of this.runs) this.walls(run);
    if (this.style.pillars) {
      for (const s of this.segs) this.pilaster(s);
      for (const c of this.convex.values()) this.pillar(c);
    }
    for (const c of this.convex.values()) if (this.style.rough) this.boulders(c);
    for (const c of this.concave.values()) this.innerCorner(c);
    for (const s of this.segs) this.clutter(s);
    this.torches();
    this.finish();
  }

  makeTemplates() {
    const BONE = [0, 3, 0.1, 0.45], DARK = [3, 0, 0.55, 0.95], IRON = [0, 0, 0.35, 0.8];
    const T = (geo, cell) => template(geo, cell);
    const M = (x, y, z, rx, ry, rz, sx, sy, sz) => mat(x, y, z, rx, ry, rz, sx, sy, sz).clone();
    const knob = T(new THREE.OctahedronGeometry(1), BONE);
    this.tpl.bone = compose([
      [T(new THREE.CylinderGeometry(0.06, 0.05, 1, 5, 1, true), BONE), M(0, 0, 0, 0, 0, Math.PI / 2, 1, 1, 1)],
      [knob, M(0.5, 0, 0.05, 0, 0, 0, 0.1, 0.09, 0.09)], [knob, M(0.5, 0, -0.05, 0, 0, 0, 0.1, 0.09, 0.09)],
      [knob, M(-0.5, 0, 0.05, 0, 0, 0, 0.1, 0.09, 0.09)], [knob, M(-0.5, 0, -0.05, 0, 0, 0, 0.1, 0.09, 0.09)],
    ]);
    const eye = T(new THREE.OctahedronGeometry(1), DARK);
    this.tpl.skull = compose([
      [T(new THREE.DodecahedronGeometry(0.5, 0), [0, 3, 0.05, 0.35]), M(0, 0.47, -0.02, 0, 0.3, 0, 0.92, 0.84, 1)],
      [T(new THREE.BoxGeometry(0.6, 0.3, 0.42), [0, 3, 0.35, 0.55]), M(0, 0.17, 0.17, 0, 0, 0, 1, 1, 1)],
      [eye, M(0.19, 0.38, 0.42, 0, 0, 0, 0.13, 0.12, 0.07)], [eye, M(-0.19, 0.38, 0.42, 0, 0, 0, 0.13, 0.12, 0.07)],
      [eye, M(0, 0.25, 0.44, 0, 0, 0, 0.06, 0.07, 0.05)],
    ]);
    this.tpl.link = T(new THREE.TorusGeometry(1, 0.3, 3, 5), IRON);
    this.tpl.shackle = T(new THREE.TorusGeometry(1, 0.28, 3, 6, Math.PI), IRON);
    this.tpl.shard = T(new THREE.OctahedronGeometry(1), [0, 0, 0, 1]);
    this.tpl.cone = T(new THREE.ConeGeometry(1, 1, 5, 1, true));
  }

  /** Every wall face that meets open floor, with its corners and straight runs. */
  scan() {
    const lv = this.level;
    for (const [, x, y] of lv.props) this.busy.add(Math.floor(y) * lv.w + Math.floor(x));
    if (lv.exit) this.busy.add(lv.exit[1] * lv.w + lv.exit[0]);
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        if (!this.wall(x, y)) continue;
        for (let k = 0; k < 4; k++) {
          const [nx, nz] = DIRS[k];
          if (this.wall(x + nx, y + nz)) continue;
          const tx = nz, tz = -nx;
          const cx = x + 0.5 + nx * 0.5, cz = y + 0.5 + nz * 0.5;
          const s = {
            x, y, k, nx, nz, tx, tz, cx, cz, ax: cx - tx * 0.5, az: cz - tz * 0.5,
            eA: this.end(x, y, -tx, -tz, nx, nz), eB: this.end(x, y, tx, tz, nx, nz),
            run: 0, len: 1, torch: false, free: true,
            busy: this.busy.has((y + nz) * lv.w + x + nx),
            floor: this.world.heightAt(cx + nx * 0.3, cz + nz * 0.3),
          };
          this.segs.push(s);
          this.byKey.set(this.key(x, y, k), s);
          const bx = cx + tx * 0.5, bz = cz + tz * 0.5;
          if (s.eA === 1) this.corner(this.convex, s.ax, s.az, nx - tx, nz - tz, s);
          if (s.eB === 1) this.corner(this.convex, bx, bz, nx + tx, nz + tz, s);
          if (s.eA === -1) this.corner(this.concave, s.ax, s.az, nx + tx, nz + tz, s);
          if (s.eB === -1) this.corner(this.concave, bx, bz, nx - tx, nz - tz, s);
        }
      }
    }
    // Straight runs: the position of each face along its wall and the wall's length.
    for (const s of this.segs) {
      if (s.eA === 0) continue;
      const run = [];
      for (let c = s; c; c = c.eB === 0 ? this.byKey.get(this.key(c.x + c.tx, c.y + c.tz, c.k)) : null) run.push(c);
      run.forEach((c, i) => { c.run = i; c.len = run.length; });
      this.runs.push(run);
    }
    for (const idx of lv.torch) {
      const x = idx % lv.w, y = Math.floor(idx / lv.w);
      // Same face as World.buildWalls picks.
      const k = !this.wall(x, y + 1) ? 0 : !this.wall(x + 1, y) ? 1 : !this.wall(x - 1, y) ? 3 : 2;
      const s = this.byKey.get(this.key(x, y, k));
      if (s) s.torch = true;
    }
  }

  corner(map, x, z, dx, dz, s) {
    const key = Math.round(z) * (this.level.w + 1) + Math.round(x);
    if (map.has(key)) return;
    const busy = this.busy.has(Math.floor(z + dz * 0.5) * this.level.w + Math.floor(x + dx * 0.5));
    map.set(key, { x, z, dx, dz, s, busy, ix: Math.round(x), iz: Math.round(z) });
  }

  /** A point on the wall face of s: f along it (0..1), d out from the face, at height y. */
  at(s, f, d, y, out = new THREE.Vector3()) {
    return out.set(s.ax + s.tx * f + s.nx * d, y, s.az + s.tz * f + s.nz * d);
  }

  /** Base trim and cornice (or rocky skirt and lip) swept along a straight wall, mitred into its neighbours. */
  walls(run) {
    const st = this.style;
    this.sweep(run, st.base, false);
    this.sweep(run, st.top, true);
  }

  sweep(run, prof, top) {
    const st = this.style, s = run[0], len = run.length, eB = run[len - 1].eB;
    const seed = top ? 20 : 10;
    // Built walls are one straight sweep (the texture is projected from world space, so no seams);
    // rough ones get a station at every tile corner, jittered by the corner so neighbours agree.
    const stations = [];
    for (let f = 0; f <= len; f += st.rough ? 1 : len) stations.push(f);
    const rings = stations.map((f) => {
      const px = s.ax + s.tx * f, pz = s.az + s.tz * f, e = f === 0 ? s.eA : f === len ? eB : 0;
      let kd = 1, kh = 1, moss = 0;
      if (st.rough) {
        kd = 0.65 + 0.7 * hash(px, pz, seed + 1);
        kh = 0.75 + 0.5 * hash(px, pz, seed + 2);
      }
      if (st.moss) moss = Math.max(0, hash(px, pz, seed + 3) - (1 - st.moss)) / st.moss;
      const pts = prof.map(([d, h]) => {
        const dd = d * kd, hh = top ? WALL_H + (h - WALL_H) * kh : h * kh;
        const along = f === 0 ? -e * dd : f === len ? len + e * dd : f;
        return this.at(s, along, dd, hh);
      });
      return { pts, moss };
    });
    const c0 = st.stone;
    const mossy = (m) => [c0[0] * (1 - 0.55 * m), c0[1] * (1 - 0.05 * m), c0[2] * (1 - 0.7 * m)];
    const hint = new THREE.Vector3();
    for (let i = 0; i + 1 < prof.length; i++) {
      const dd = prof[i + 1][0] - prof[i][0], dh = prof[i + 1][1] - prof[i][1];
      hint.set(s.nx * dh, -dd, s.nz * dh);
      const up = -dd / Math.hypot(dd, dh) > 0.3;
      for (let j = 0; j + 1 < rings.length; j++) {
        const r0 = rings[j], r1 = rings[j + 1];
        const a = up ? mossy(r0.moss) : c0, b = up ? mossy(r1.moss) : c0;
        this.stone.quad(r0.pts[i], r1.pts[i], r1.pts[i + 1], r0.pts[i + 1], hint, [a, b, b, a]);
      }
    }
  }

  /** Pilasters every third tile boundary of long walls. */
  pilaster(s) {
    if (s.run < 1 || s.len - s.run < 1) return;
    const along = s.tx ? s.ax : s.az;
    if (((along % 3) + 3) % 3 !== 0) return;
    const hell = this.biome === 'HELL';
    this.hang(s, () => {
      this.box(s, 0, -0.2, 0.2, 0, 0.17, -0.06, 0.36, 'fst');
      this.box(s, 0, -0.13, 0.13, 0, hell ? 0.09 : 0.11, 0.36, 1.62, 'fs');
      this.box(s, 0, -0.19, 0.19, 0, 0.15, 1.62, 1.76, 'fstb');
    });
  }

  /** Runs fn with every batch tagging what it adds as hung on the wall face of s. */
  hang(s, fn, nx = s.nx, nz = s.nz) {
    const face = [nx, nz];
    this.stone.face = this.kit.face = this.decal.face = face;
    fn();
    this.stone.face = this.kit.face = this.decal.face = null;
  }

  /** An axis box in the frame of face s: f0 along, x from/to across the face, d out, y up. faces: f s t b. */
  box(s, f0, x0, x1, d0, d1, y0, y1, faces, color = this.style.stone) {
    const P = (x, d, y) => this.at(s, f0 + x, d, y);
    const n = new THREE.Vector3(s.nx, 0, s.nz), t = new THREE.Vector3(s.tx, 0, s.tz);
    if (faces.includes('f')) this.stone.quad(P(x0, d1, y0), P(x1, d1, y0), P(x1, d1, y1), P(x0, d1, y1), n, color);
    if (faces.includes('s')) {
      this.stone.quad(P(x0, d0, y0), P(x0, d1, y0), P(x0, d1, y1), P(x0, d0, y1), t.clone().negate(), color);
      this.stone.quad(P(x1, d1, y0), P(x1, d0, y0), P(x1, d0, y1), P(x1, d1, y1), t, color);
    }
    if (faces.includes('t')) this.stone.quad(P(x0, d0, y1), P(x0, d1, y1), P(x1, d1, y1), P(x1, d0, y1), AXIS_Y, color);
    if (faces.includes('b')) this.stone.quad(P(x0, d0, y0), P(x1, d0, y0), P(x1, d1, y0), P(x0, d1, y0), new THREE.Vector3(0, -1, 0), color);
  }

  /** A square pillar on an outer corner, rising above the cornice to a pointed cap. */
  pillar(c) {
    const col = this.style.stone, hell = this.biome === 'HELL';
    const B = (r, y0, y1, top) => {
      const v = (sx, sz, y) => new THREE.Vector3(c.x + sx * r, y, c.z + sz * r);
      const sides = [[-1, -1, 1, -1, 0, -1], [1, -1, 1, 1, 1, 0], [1, 1, -1, 1, 0, 1], [-1, 1, -1, -1, -1, 0]];
      for (const [ax, az, bx, bz, hx, hz] of sides) this.stone.quad(v(ax, az, y0), v(bx, bz, y0), v(bx, bz, y1), v(ax, az, y1), new THREE.Vector3(hx, 0, hz), col);
      if (top) this.stone.quad(v(-1, -1, y1), v(-1, 1, y1), v(1, 1, y1), v(1, -1, y1), AXIS_Y, col);
    };
    B(0.2, -0.06, 0.34, true);
    B(0.15, 0.34, 1.98, false);
    B(0.19, 1.98, 2.1, false);
    // A pyramid cap; in hell a thin spike on a flat top.
    const apex = new THREE.Vector3(c.x, hell ? 2.62 : 2.3, c.z);
    const v = (r, sx, sz) => new THREE.Vector3(c.x + sx * r, 2.1, c.z + sz * r);
    if (hell) this.stone.quad(v(0.19, -1, -1), v(0.19, -1, 1), v(0.19, 1, 1), v(0.19, 1, -1), AXIS_Y, col);
    const r = hell ? 0.1 : 0.19;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      this.stone.tri(v(r, ax, az), v(r, bx, bz), apex, new THREE.Vector3((ax + bx) / 2, 0.5, (az + bz) / 2), col);
    }
  }

  /** Rocks heaped on an outer corner of a cave wall. */
  boulders(c) {
    const h = (k) => hash(c.ix, c.iz, 40 + k);
    for (let i = 0; i < 2; i++) {
      const r = 0.16 + 0.12 * h(i);
      const a = (h(i + 3) - 0.5) * 1.2 + Math.atan2(c.dx, c.dz);
      const d = 0.08 + i * 0.06;
      const y = this.world.heightAt(c.x + c.dx * 0.2, c.z + c.dz * 0.2);
      this.stone.add(this.tpl.rocks[(c.ix + c.iz + i) & 3], mat(c.x + Math.sin(a) * d, y + r * 0.35, c.z + Math.cos(a) * d, 0, h(i + 6) * 6, 0, r, r * 1.1, r), { color: this.style.stone });
    }
  }

  /** Inner corners: cobwebs up high, skull piles at the foot. */
  innerCorner(c) {
    const st = this.style;
    const h = (k) => hash(c.ix, c.iz, 60 + k);
    // The two walls run along the diagonal's components.
    const ux = Math.sign(c.dx), uz = Math.sign(c.dz);
    if (h(0) < st.web) {
      const top = st.rough ? 1.55 : 1.68;
      const a = 0.5 + 0.3 * h(1), b = 0.55 + 0.35 * h(2);
      const o = 0.02;
      const p1 = new THREE.Vector3(c.x + ux * a, top, c.z + uz * o);
      const p2 = new THREE.Vector3(c.x + ux * o, top, c.z + uz * a);
      const p3 = new THREE.Vector3(c.x + ux * o, top - b, c.z + uz * o);
      const hint = new THREE.Vector3(ux, 0, uz);
      this.hang(c.s, () => this.decal.tri(p3, p1, p2, hint, [0.75, 0.75, 0.72], [WEB(0.5, 0.985), WEB(0, 0), WEB(1, 0)]), ux, uz);
    }
    if (!c.busy && h(3) < st.piles) {
      const y = this.world.heightAt(c.x + ux * 0.25, c.z + uz * 0.25);
      const n = 2 + Math.floor(h(4) * 1.8);
      for (let i = 0; i < n; i++) {
        const px = c.x + ux * (0.1 + 0.16 * hash(c.ix, c.iz, 70 + i)), pz = c.z + uz * (0.1 + 0.16 * hash(c.ix, c.iz, 80 + i));
        const yaw = Math.atan2(ux, uz) + (hash(c.ix, c.iz, 90 + i) - 0.5) * 1.6;
        const sc = 0.12 + 0.03 * hash(c.ix, c.iz, 95 + i);
        this.kit.add(this.tpl.skull, mat(px, y + (i > 1 ? sc * 0.6 : -0.01), pz, (hash(i, c.ix, 3) - 0.5) * 0.5, yaw, (hash(i, c.iz, 4) - 0.5) * 0.4, sc));
      }
      for (let i = 0; i < 2; i++) {
        this.kit.add(this.tpl.bone, mat(c.x + ux * (0.12 + 0.1 * i), y + 0.015, c.z + uz * (0.3 - 0.12 * i), 0.1, h(9 + i) * 6, 0, 0.22));
      }
    }
  }

  /** What stands or hangs along one face: rubble, bones, banners, candles, chains, crystals, lava. */
  clutter(s) {
    const st = this.style, biome = this.biome;
    const r = (k) => this.rnd(s, k);
    const y = s.floor;
    const long = s.len >= 3 && s.run > 0 && s.run < s.len - 1;
    // Banners on long crypt and hell walls, away from torches.
    if (st.pillars && long && !s.torch && this.tpl.banners.length && r(1) < (biome === 'HELL' ? 0.12 : 0.22)) {
      const tpl = this.tpl.banners[Math.floor(r(2) * this.tpl.banners.length)];
      const k = 1.25 / (tpl.box.max.y - tpl.box.min.y);
      const back = tpl.box.min.z * k;
      // Crypt banners are red or purple; hell's are red and black.
      const recolor = biome === 'HELL' ? [[0, 1, 3, 0]] : r(3) < 0.4 ? [[3, 2, 3, 1]] : null;
      this.at(s, 0.5, 0.012 - back, 1.66 - tpl.box.max.y * k, _b);
      this.hang(s, () => this.kit.add(tpl, mat(_b.x, _b.y, _b.z, 0, Math.atan2(s.nx, s.nz), 0, k), { recolor, color: [0.8, 0.8, 0.8] }));
      s.free = false;
    }
    if (s.free && !s.torch && st.chains && r(4) < st.chains) this.hang(s, () => this.chains(s));
    if (st.rough) this.cave(s);
    if (biome === 'HELL') this.lava(s);
    if (s.busy) return;
    // Candles at the foot of crypt walls.
    if (biome === 'CRYPT' && s.free && this.tpl.candle && r(5) < 0.04) {
      const n = 2 + Math.floor(r(6) * 2);
      for (let i = 0; i < n; i++) {
        const hgt = 0.14 + 0.16 * hash(s.x, s.y, 200 + i + s.k * 8);
        const k = hgt / 1.05;
        this.at(s, 0.5 + (i - (n - 1) / 2) * 0.13 + (hash(s.x, s.y, 210 + i) - 0.5) * 0.05, 0.15 + 0.06 * hash(s.x, s.y, 220 + i), y, _b);
        this.kit.add(this.tpl.candle, mat(_b.x, _b.y, _b.z, 0, hash(s.x, s.y, 230 + i) * 6, 0, k), { glowCell: [7, 2], glow: 3.5 });
      }
      s.free = false;
    }
    // Rubble against the wall.
    if (r(7) < st.rubble) {
      const n = 2 + Math.floor(r(8) * 2.5);
      for (let i = 0; i < n; i++) {
        const sz = (st.rough ? 0.08 : 0.055) + 0.08 * r(20 + i);
        this.at(s, 0.15 + 0.7 * r(30 + i), 0.1 + sz * 0.6, y + sz * 0.25, _b);
        this.stone.add(this.tpl.rocks[(s.x + s.y + i) & 3], mat(_b.x, _b.y, _b.z, 0, r(40 + i) * 6, 0, sz, sz * 0.75, sz * 1.1), { color: st.stone });
      }
    }
    // A stray bone or two, now and then with its skull.
    if (r(9) < st.bones) {
      for (let i = 0; i < 1 + (r(10) > 0.5); i++) {
        this.at(s, 0.25 + 0.5 * r(50 + i), 0.16 + 0.05 * i, y + 0.015, _b);
        this.kit.add(this.tpl.bone, mat(_b.x, _b.y, _b.z, 0.08, Math.atan2(s.tx, s.tz) + (r(52 + i) - 0.5) * 1.2, 0, 0.2 + 0.06 * r(54 + i)));
      }
      if (r(11) < 0.5) {
        this.at(s, 0.3 + 0.4 * r(56), 0.15, y - 0.01, _b);
        this.kit.add(this.tpl.skull, mat(_b.x, _b.y, _b.z, (r(57) - 0.5) * 0.4, Math.atan2(s.nx, s.nz) + (r(58) - 0.5) * 2, (r(59) - 0.5) * 0.6, 0.12));
      }
    }
  }

  /** Iron chains hanging from under the cornice: a straight drop with a shackle or a sagging loop. */
  chains(s) {
    const r = (k) => this.rnd(s, 300 + k);
    const yaw = Math.atan2(s.nx, s.nz);
    const link = (x, y, z, tilt, i) => {
      _q.setFromAxisAngle(AXIS_Y, yaw).multiply(_q2.setFromAxisAngle(AXIS_Z, tilt));
      _q.multiply(_q2.setFromAxisAngle(AXIS_Y, i & 1 ? Math.PI / 2 : 0));
      this.kit.add(this.tpl.link, _m.compose(_p.set(x, y, z), _q, _s.set(0.022, 0.034, 0.022)));
    };
    if (r(0) < 0.55) {
      for (let c = 0; c < 1 + (r(1) > 0.5); c++) {
        const f = 0.3 + 0.4 * r(2 + c), n = 5 + Math.floor(r(4 + c) * 5);
        const top = this.at(s, f, 0.05, 0);
        for (let i = 0; i < n; i++) link(top.x, 1.66 - (i + 0.5) * 0.06, top.z, 0, i);
        _q.setFromAxisAngle(AXIS_Y, yaw).multiply(_q2.setFromAxisAngle(AXIS_Z, Math.PI));
        this.kit.add(this.tpl.shackle, _m.compose(_p.set(top.x, 1.66 - n * 0.06 - 0.01, top.z), _q, _s.set(0.05, 0.06, 0.05)));
      }
    } else {
      // A loop between two hooks, sagging in the middle.
      const f0 = 0.12, f1 = 0.88, sag = 0.18 + 0.15 * r(6), y0 = 1.58, n = 13;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const yy = y0 - sag * 4 * u * (1 - u);
        const slope = -sag * 4 * (1 - 2 * u) / (f1 - f0);
        const p = this.at(s, f0 + (f1 - f0) * u, 0.05, yy);
        link(p.x, p.y, p.z, Math.atan2(-1, slope), i);
      }
    }
    s.free = false;
  }

  /** Cave walls: stalactites under the lip, stalagmites, glowing crystals and moss. */
  cave(s) {
    const r = (k) => this.rnd(s, 400 + k);
    const col = this.style.stone;
    if (r(0) < 0.45) {
      for (let i = 0; i < 1 + Math.floor(r(1) * 3); i++) {
        const len = 0.22 + 0.36 * r(2 + i), rad = 0.045 + 0.035 * r(6 + i);
        this.at(s, 0.15 + 0.7 * r(10 + i), 0.03 + 0.04 * r(14 + i), 1.7 - len / 2, _b);
        this.hang(s, () => this.stone.add(this.tpl.cone, mat(_b.x, _b.y, _b.z, Math.PI, r(18 + i) * 6, 0, rad, len, rad), { color: col }));
      }
    }
    if (s.busy) return;
    if (r(20) < 0.25) {
      for (let i = 0; i < 1 + (r(21) > 0.6); i++) {
        const len = 0.12 + 0.3 * r(22 + i), rad = 0.05 + 0.05 * r(24 + i);
        this.at(s, 0.2 + 0.6 * r(26 + i), 0.12 + 0.06 * r(28 + i), s.floor + len / 2 - 0.02, _b);
        this.stone.add(this.tpl.cone, mat(_b.x, _b.y, _b.z, 0, r(30 + i) * 6, 0, rad, len, rad), { color: col });
      }
    }
    // Crystal clusters, at the foot of the wall or breaking out of its face.
    if (s.free && r(32) < 0.1) {
      const high = r(33) < 0.35;
      const cell = [[6, 2], [3, 1], [5, 1]][Math.floor(r(34) * 3)];
      const f = 0.25 + 0.5 * r(35), y0 = high ? 0.6 + 0.6 * r(36) : s.floor;
      const n = 3 + Math.floor(r(37) * 3);
      for (let i = 0; i < n; i++) {
        const len = (high ? 0.13 : 0.18) + 0.16 * r(40 + i);
        const lean = high ? 1.2 + 0.3 * r(46 + i) : 0.25 + 0.4 * r(46 + i);
        const base = this.at(s, f + (r(50 + i) - 0.5) * 0.22, high ? 0.02 : 0.1 + 0.05 * r(56 + i), y0);
        // Lean out from the wall (and a little sideways), the lower half buried.
        _q.setFromAxisAngle(AXIS_Y, Math.atan2(s.nx, s.nz) + (r(60 + i) - 0.5) * 1.4);
        _q.multiply(_q2.setFromAxisAngle(AXIS_X, lean));
        const tpl = this.tpl.shard;
        _m.compose(_p.copy(base), _q, _s.set(0.045 + 0.025 * r(66 + i), len, 0.045 + 0.025 * r(66 + i)));
        const uv = cellUV(cell[0], cell[1], 0.15 + 0.5 * r(70 + i));
        if (high) this.kit.face = [s.nx, s.nz];
        this.kit.add({ pos: tpl.pos, nor: tpl.nor, uv: tpl.uv.map((_, j) => uv[j & 1]) }, _m, { glow: 1.8, color: [1.3, 1.3, 1.3] });
        this.kit.face = null;
      }
      s.free = false;
    }
  }

  /** Hell: a glowing crack along the foot of every wall, seams up some faces and embers. */
  lava(s) {
    const r = (k) => this.rnd(s, 500 + k);
    const d0 = 0.1, d1 = 0.36, y = s.floor + 0.012;
    const a0 = this.at(s, -s.eA * d0, d0, y), b0 = this.at(s, 1 + s.eB * d0, d0, y);
    const a1 = this.at(s, -s.eA * d1, d1, y), b1 = this.at(s, 1 + s.eB * d1, d1, y);
    const uv = LAVA[r(0) < 0.5 ? 0 : 1];
    // Brightness drifts along the walls: shared at the corners so neighbouring cracks agree.
    const ga = 0.5 + 1.1 * hash(s.ax, s.az, 77), gb = 0.5 + 1.1 * hash(s.ax + s.tx, s.az + s.tz, 77);
    const g = (ga + gb) / 2;
    this.decal.quad(a0, b0, b1, a1, AXIS_Y, WHITE, [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)], g);
    if (!s.torch && s.free && r(1) < 0.18) {
      const f = 0.3 + 0.4 * r(2), w = 0.18 + 0.1 * r(3), top = 0.9 + 0.6 * r(4);
      const n = new THREE.Vector3(s.nx, 0, s.nz);
      this.hang(s, () => this.decal.quad(this.at(s, f - w, 0.008, 0.2), this.at(s, f + w, 0.008, 0.2), this.at(s, f + w, 0.008, top), this.at(s, f - w, 0.008, top), n, WHITE,
        [SEAM(0, 1), SEAM(1, 1), SEAM(1, 0), SEAM(0, 0)], 1.3));
    }
    if (!s.busy && r(5) < 0.3) {
      for (let i = 0; i < 2; i++) {
        this.at(s, r(6 + i), 0.16 + 0.12 * r(8 + i), y + 0.01, _b);
        const sz = 0.025 + 0.03 * r(10 + i);
        const tpl = this.tpl.shard, uv2 = cellUV(7, 2, 0.6 + 0.3 * r(12 + i));
        this.kit.add({ pos: tpl.pos, nor: tpl.nor, uv: tpl.uv.map((_, j) => uv2[j & 1]) }, mat(_b.x, _b.y, _b.z, r(14 + i), r(16 + i) * 6, 0, sz, sz * 0.6, sz), { glow: 3 });
      }
    }
  }

  /** Soot blackening the wall above every torch. */
  torches() {
    for (const s of this.segs) {
      if (!s.torch) continue;
      const n = new THREE.Vector3(s.nx, 0, s.nz);
      this.hang(s, () => this.decal.quad(this.at(s, 0.18, 0.012, 1.2), this.at(s, 0.82, 0.012, 1.2), this.at(s, 0.82, 0.012, 1.76), this.at(s, 0.18, 0.012, 1.76), n, [0.02, 0.015, 0.01],
        [SOOT(0, 1), SOOT(1, 1), SOOT(1, 0), SOOT(0, 0)]));
    }
  }

  finish() {
    const group = this.world.group;
    const stoneTex = this.world.assets.texture(`tex_${this.style.tex}_top.png`);
    const atlas = this.tpl.candle ? this.tpl.candle.map : null;
    const parts = [
      // Fine relief, roughness and metal like the kit props (surface.js): carved stone, the kit's own cells.
      this.stone.mesh(kitSurface(material({ map: stoneTex, roughness: 0.9 }, 'dressing-stone', false), 'stone'), 'dressing-stone'),
      this.kit.mesh(atlas ? kitSurface(material({ map: atlas, roughness: 0.75 }, 'dressing-kit', true), 'dungeon') : material({ roughness: 0.75 }, 'dressing-kit', true), 'dressing-kit'),
      this.decal.mesh(material({
        map: decals(), roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }, 'dressing-decal', true), 'dressing-decal'),
    ];
    for (const m of parts) if (m) group.add(m);
  }
}

/** Dresses the walls of a dungeon level (see the top of this file); call once after the walls are built. */
export function buildDressing(world) {
  if (world.outdoors) return;
  new Dresser(world).build();
}
