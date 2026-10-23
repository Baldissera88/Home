import * as THREE from 'three';
import { applyOcclusion, OCCLUDE } from './occlude.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { TILE, hash } from './defs.js';

const simplex = new SimplexNoise({ random: mulberry(7) });

// Whenever the view moves, the plants in sight are picked again, nearest first, at a level of detail by distance.
const CELL = 8; // tiles per side of a culling cell
const TREE_LOD = [12, 22]; // full trees nearer than the first, lighter ones up to the second, then far ones
const TREE_FAR = 95;
const SHADOW_MARGIN = 3; // trees of the two near bands cast shadows, so they are kept a little beyond the view edges
const GRASS_NEAR = 12; // full tufts nearer than this, one triangle per blade further out
const GRASS_FADE = [27, 36]; // tufts and flowers sink into the ground between these distances
// Geometry per level: near, middle, far, and the stand-in that draws the near trees' shadows.
const CROWN_DETAIL = [3, 2, 0, 1];
const TRUNK_SEGMENTS = [[9, 6], [6, 3], [5, 1], [6, 2]];
const BOUGH_SEGMENTS = [[11, 2], [8, 1], [6, 1], [8, 1]];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function clean(geo) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') geo.deleteAttribute(k);
  return geo;
}

/**
 * Pushes vertices through a 3D noise field that depends only on position (so seams stay closed),
 * then rebuilds smooth normals: lumpy leaf masses and gnarled bark. Returns non-indexed geometry.
 */
function lumpy(geo, amp, freq, seed = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = (a, b, c) => simplex.noise3d(a, b, c) * 0.7 + simplex.noise3d(a * 2.3, b * 2.3, c * 2.3) * 0.3;
    pos.setXYZ(i,
      x + n(x * freq + seed, y * freq, z * freq) * amp,
      y + n(x * freq, y * freq + seed + 11, z * freq) * amp,
      z + n(x * freq + 23, y * freq, z * freq + seed) * amp);
  }
  geo = mergeVertices(geo);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** Trunks and branches lose segments with each level of detail; the random draws stay the same. */
function trunk(rng, height, r0, r1, bark, lod = 0) {
  const [radial, rows] = TRUNK_SEGMENTS[lod];
  let geo = new THREE.CylinderGeometry(r1, r0, height, radial, rows, true);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  const lean = (rng() - 0.5) * 0.25, lean2 = (rng() - 0.5) * 0.25;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) + lean * y * y);
    pos.setZ(i, pos.getZ(i) + lean2 * y * y);
  }
  geo = lumpy(geo, 0.025, 6, rng() * 9);
  return paint(geo, (c, x, y, z) => c.setRGB(bark[0], bark[1], bark[2]).multiplyScalar(0.7 + 0.2 * Math.sin(y * 9 + Math.atan2(z, x) * 5) + 0.1 * Math.sin(y * 31)));
}

/** A broad-leaved tree: a crooked trunk and a crown of lumpy leaf clusters, darker beneath and inside. */
function broadleaf(seed, opts = {}, lod = 0) {
  const rng = mulberry(seed);
  const height = opts.height || 1.35;
  const parts = [trunk(rng, height + 0.4, 0.13, 0.07, opts.bark || [0.27, 0.2, 0.14], lod)];
  const crownY = height + 0.55;
  const R = opts.radius || 0.95;
  const leaf = new THREE.Color(opts.leaf || 0x3f6b22);
  const clusters = opts.clusters || 13;
  for (let k = 0; k < clusters; k++) {
    const a = rng() * Math.PI * 2, el = (rng() - 0.35) * 1.2;
    const d = R * (0.35 + 0.55 * rng());
    const cx = Math.cos(a) * Math.cos(el) * d, cz = Math.sin(a) * Math.cos(el) * d, cy = crownY + Math.sin(el) * d * 0.6;
    const r = (0.33 + 0.22 * rng()) * R;
    let geo = new THREE.IcosahedronGeometry(r, CROWN_DETAIL[lod]);
    geo.scale(1, 0.82, 1);
    geo.translate(cx, cy, cz);
    geo = lumpy(geo, 0.11 * R, 3.4, seed + k);
    const tint = 0.85 + rng() * 0.3, hue = (rng() - 0.5) * 0.04;
    parts.push(paint(geo, (c, x, y, z) => {
      const up = (y - (crownY - R * 0.6)) / (R * 1.4);
      const out = Math.min(1, Math.hypot(x, z) / R);
      c.copy(leaf).offsetHSL(hue, 0, 0).multiplyScalar(tint * (0.45 + 0.55 * Math.min(1, Math.max(0, up))) * (0.8 + 0.3 * out));
    }));
  }
  return mergeGeometries(parts);
}

/** A spruce: tiers of drooping, jagged boughs around a straight trunk. */
function conifer(seed, opts = {}, lod = 0) {
  const rng = mulberry(seed);
  const jitter = mulberry(seed + 101); // per-vertex noise, so every level of detail keeps the same tiers
  const height = opts.height || 2.6;
  const parts = [trunk(rng, height * 0.5, 0.1, 0.06, [0.28, 0.18, 0.11], lod)];
  const tiers = 7;
  const green = new THREE.Color(opts.color || 0x1d4a26);
  const [radial, rows] = BOUGH_SEGMENTS[lod];
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = (1 - f) * 0.75 + 0.14;
    const h = 0.55 - f * 0.15;
    const y = 0.35 + f * (height - 0.6);
    let geo = new THREE.ConeGeometry(r, h, radial, rows, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      if (vy < -h / 2 + 0.01) {
        const x = pos.getX(i), z = pos.getZ(i);
        const jag = 0.75 + 0.45 * jitter();
        pos.setXYZ(i, x * jag, vy - 0.12 * jag * r, z * jag);
      }
    }
    geo.translate(0, y + h / 2, 0);
    geo.rotateY(rng() * 6.28);
    geo = lumpy(geo, 0.05, 5, seed + k);
    parts.push(paint(geo, (c, x, vy, z) => {
      const tip = Math.min(1, Math.hypot(x, z) / r);
      c.copy(green).multiplyScalar(0.55 + 0.5 * tip + 0.1 * f).offsetHSL(0, 0, (jitter() - 0.5) * 0.03);
    }));
  }
  return mergeGeometries(parts);
}

function deadTree(seed, lod = 0) {
  const rng = mulberry(seed);
  const parts = [trunk(rng, 1.7, 0.13, 0.05, [0.3, 0.27, 0.23], lod)];
  for (let k = 0; k < 5; k++) {
    let g = new THREE.CylinderGeometry(0.015, 0.045, 0.7, [6, 4, 3, 4][lod], lod ? 1 : 3, true);
    g.translate(0, 0.35, 0);
    g.rotateZ(0.6 + rng() * 0.6);
    g.rotateY(rng() * 6.28);
    g.translate(0, 0.7 + k * 0.2, 0);
    g = lumpy(g, 0.012, 8, k);
    parts.push(paint(g, (c) => c.setRGB(0.3, 0.27, 0.23)));
  }
  return mergeGeometries(parts);
}

function shrub(seed, lod = 0) {
  const rng = mulberry(seed);
  const parts = [];
  for (let k = 0; k < 6; k++) {
    let g = new THREE.IcosahedronGeometry(0.22 + rng() * 0.12, [2, 1, 0, 1][lod]);
    g.translate((rng() - 0.5) * 0.5, 0.2 + rng() * 0.15, (rng() - 0.5) * 0.5);
    g = lumpy(g, 0.05, 6, k);
    parts.push(paint(g, (c, x, y) => c.setHex(0x335f22).multiplyScalar(0.55 + y)));
  }
  // Berries are too small to see from afar or in a shadow.
  for (let k = 0; k < 10 && lod < 2; k++) {
    const g = clean(new THREE.IcosahedronGeometry(0.035, 0));
    g.translate((rng() - 0.5) * 0.6, 0.3 + rng() * 0.2, (rng() - 0.5) * 0.6);
    parts.push(paint(g, (c) => c.setHex(0xb01c22)));
  }
  return mergeGeometries(parts);
}

/** Triangles from flat [x, y, z] corner lists, normals facing up-ish (for thin leaves seen from both sides). */
function sheet(tris, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  for (let i = 0; i < nor.count; i++) if (nor.getY(i) < 0) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return paint(g, color);
}

/**
 * A date palm: a ringed trunk curving up with `lean`, a crown of arching feather fronds (young ones up,
 * old ones hanging dry and brown) and clusters of dates under it.
 */
function palm(seed, lean, lod = 0) {
  const rng = mulberry(seed);
  const H = 3.5 + rng() * 0.9;
  const bend = (y) => lean * H * Math.pow(Math.max(0, y) / H, 1.7);
  let tr = new THREE.CylinderGeometry(0.12, 0.2, H, [8, 6, 5, 5][lod], [12, 6, 3, 4][lod], true);
  tr.translate(0, H / 2, 0);
  const P = tr.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), k = 1 + 0.07 * Math.sin(y * 19);
    P.setXYZ(i, P.getX(i) * k + bend(y), y, P.getZ(i) * k);
  }
  tr = clean(tr);
  tr.computeVertexNormals();
  const parts = [paint(tr, (c, x, y) => c.setRGB(0.36, 0.28, 0.2).multiplyScalar(0.7 + 0.3 * (0.5 + 0.5 * Math.sin(y * 19 + 1.2))))];
  const top = new THREE.Vector3(bend(H), H, 0);
  const n = [15, 11, 8, 9][lod], steps = [9, 6, 4, 5][lod];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng() * 0.5;
    const old = k % 4 === 3;
    const e0 = old ? -0.5 - rng() * 0.4 : 0.35 + rng() * 0.6, L = old ? 1.3 + rng() * 0.4 : 1.8 + rng() * 0.6, droop = 1.0 + rng() * 0.6;
    const green = old ? [0.42, 0.33, 0.17] : [0.17 + rng() * 0.05, 0.3 + rng() * 0.06, 0.09];
    const tris = [];
    let p = top.clone(), prev = null;
    const dir = new THREE.Vector3(), side = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), sag = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, e = e0 - droop * t * t;
      dir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
      const w = 0.34 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (old ? 0.6 : 1);
      if (prev) {
        // Leaflets: a folded V of narrow blades along the rib, one pair per step.
        sag.set(0, -0.08 * w, 0);
        const l = p.clone().addScaledVector(side, w).addScaledVector(dir, -0.05).add(sag);
        const r = p.clone().addScaledVector(side, -w).addScaledVector(dir, -0.05).add(sag);
        tris.push([prev.x, prev.y, prev.z, p.x, p.y, p.z, l.x, l.y, l.z], [prev.x, prev.y, prev.z, r.x, r.y, r.z, p.x, p.y, p.z]);
      }
      prev = p.clone();
      p = p.addScaledVector(dir, L / steps);
    }
    parts.push(sheet(tris, (c, x, y, z) => c.setRGB(green[0], green[1], green[2]).multiplyScalar(0.75 + 0.35 * Math.min(1, Math.hypot(x - top.x, z - top.z) / L))));
  }
  for (let k = 0; k < 3 && lod < 2; k++) {
    const a = rng() * Math.PI * 2;
    const g = clean(new THREE.IcosahedronGeometry(0.16, 0));
    g.scale(1, 1.6, 1);
    g.translate(top.x + Math.cos(a) * 0.2, H - 0.3, Math.sin(a) * 0.2);
    parts.push(paint(g, (c) => c.setRGB(0.55, 0.25, 0.08)));
  }
  return mergeGeometries(parts);
}

/** A saguaro: a ribbed column with a rounded top and arms that elbow out and turn up. */
function saguaro(seed, lod = 0) {
  const rng = mulberry(seed);
  const H = 2.4 + rng() * 1.5, R = 0.19 + rng() * 0.05;
  const radial = [16, 10, 6, 8][lod];
  const ribs = lod < 2 ? 12 : 0;
  const rib = (g) => {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i), th = Math.atan2(z, x);
      const k = ribs ? 1 - 0.1 * (0.5 - 0.5 * Math.cos(th * ribs)) : 1;
      P.setX(i, x * k);
      P.setZ(i, z * k);
    }
    return g;
  };
  const green = (c, x, y, z) => {
    const th = Math.atan2(z, x);
    c.setRGB(0.25, 0.36, 0.16).multiplyScalar((0.75 + 0.3 * (ribs ? 0.5 + 0.5 * Math.cos(th * ribs) : 0.7)) * (0.75 + 0.25 * Math.min(1, y / 1.2)));
  };
  const body = rib(new THREE.CylinderGeometry(R, R * 1.06, H, radial, [5, 3, 1, 2][lod], true));
  body.translate(0, H / 2, 0);
  const cap = rib(new THREE.SphereGeometry(R, radial, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  cap.translate(0, H, 0);
  const parts = [paint(clean(body), green), paint(clean(cap), green)];
  const arms = Math.floor(rng() * 3.2);
  for (let k = 0; k < arms; k++) {
    const a = rng() * Math.PI * 2 + k * 2.1, hs = H * (0.35 + rng() * 0.25), up = 0.5 + rng() * 0.9, out = 0.42 + rng() * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a), r = R * 0.68;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, hs, 0), new THREE.Vector3(ca * out * 0.7, hs - 0.04, sa * out * 0.7),
      new THREE.Vector3(ca * out, hs + 0.25, sa * out), new THREE.Vector3(ca * out, hs + 0.25 + up, sa * out),
    ]);
    const arm = new THREE.TubeGeometry(curve, [10, 6, 4, 4][lod], r, [10, 7, 5, 5][lod], false);
    const tip = new THREE.SphereGeometry(r, [10, 7, 5, 5][lod], 3, 0, Math.PI * 2, 0, Math.PI / 2);
    tip.translate(ca * out, hs + 0.25 + up, sa * out);
    parts.push(paint(clean(arm), green), paint(clean(tip), green));
  }
  return mergeGeometries(parts);
}

/** A barrel cactus: a squat ribbed globe crowned with a ring of yellow flowers, sometimes with pups. */
function barrel(seed, lod = 0) {
  const rng = mulberry(seed);
  const parts = [];
  const count = 1 + Math.floor(rng() * 2.5);
  for (let b = 0; b < count; b++) {
    const r = (b ? 0.16 : 0.24) + rng() * 0.06, ox = b ? (rng() - 0.5) * 0.6 : 0, oz = b ? (rng() - 0.5) * 0.6 : 0;
    let g = new THREE.SphereGeometry(r, [14, 10, 6, 7][lod], [8, 6, 4, 4][lod]);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), th = Math.atan2(z, x);
      const k = lod < 2 ? 1 - 0.1 * (0.5 - 0.5 * Math.cos(th * 14)) : 1;
      P.setXYZ(i, x * k, Math.max(y, -r * 0.3) * 1.25, z * k);
    }
    g.translate(ox, r * 0.36, oz);
    g = clean(g);
    g.computeVertexNormals();
    parts.push(paint(g, (c, x, y, z) => c.setRGB(0.3, 0.4, 0.17).multiplyScalar(0.7 + 0.35 * (lod < 2 ? 0.5 + 0.5 * Math.cos(Math.atan2(z - oz, x - ox) * 14) : 0.7))));
    for (let k = 0; k < 6 && lod < 2; k++) {
      const a = k / 6 * Math.PI * 2;
      const fl = clean(new THREE.ConeGeometry(0.035, 0.07, 5));
      fl.translate(ox + Math.cos(a) * r * 0.35, r * 1.6 + 0.02, oz + Math.sin(a) * r * 0.35);
      parts.push(paint(fl, (c) => c.setRGB(0.95, 0.65, 0.1)));
    }
  }
  return mergeGeometries(parts);
}

/** Desert scrub: wiry twigs fanning out of the sand and a few dusty grey-green clumps. */
function scrub(seed, lod = 0) {
  const rng = mulberry(seed);
  const parts = [];
  for (let k = 0; k < [9, 6, 0, 4][lod]; k++) {
    const g = new THREE.CylinderGeometry(0.006, 0.014, 0.5 + rng() * 0.3, 3, 1, true);
    g.translate(0, 0.3, 0);
    g.rotateZ(0.3 + rng() * 0.7);
    g.rotateY(rng() * 6.28);
    parts.push(paint(clean(g), (c) => c.setRGB(0.32, 0.25, 0.18)));
  }
  for (let k = 0; k < 4; k++) {
    let g = new THREE.IcosahedronGeometry(0.13 + rng() * 0.08, [1, 1, 0, 0][lod]);
    g.translate((rng() - 0.5) * 0.4, 0.18 + rng() * 0.18, (rng() - 0.5) * 0.4);
    g = lumpy(g, 0.04, 7, k + seed);
    parts.push(paint(g, (c, x, y) => c.setRGB(0.42, 0.42, 0.27).multiplyScalar(0.6 + y)));
  }
  return mergeGeometries(parts);
}

/** A dead acacia, bleached by the sun: a short twisted trunk and bare limbs spreading flat. */
function acacia(seed, lod = 0) {
  const rng = mulberry(seed);
  const bark = [0.5, 0.45, 0.38];
  const parts = [trunk(rng, 1.3, 0.12, 0.07, bark, lod)];
  for (let k = 0; k < 4; k++) {
    let g = new THREE.CylinderGeometry(0.02, 0.06, 1.3 + rng() * 0.5, [6, 4, 3, 4][lod], lod ? 1 : 3, true);
    g.translate(0, 0.65, 0);
    g.rotateZ(0.9 + rng() * 0.4);
    g.rotateY(k * 1.6 + rng());
    g.translate(0, 1.15 + rng() * 0.15, 0);
    g = lumpy(g, 0.015, 7, k);
    parts.push(paint(g, (c) => c.setRGB(bark[0], bark[1], bark[2]).multiplyScalar(0.85 + rng() * 0.2)));
    for (let j = 0; j < 2 && lod < 2; j++) {
      const tw = new THREE.CylinderGeometry(0.008, 0.02, 0.5, 3, 1, true);
      tw.translate(0, 0.25, 0);
      tw.rotateZ(0.5 + rng() * 0.6);
      tw.rotateY(k * 1.6 + rng() * 2);
      tw.translate(Math.cos(k * 1.6) * 0.5, 1.55, -Math.sin(k * 1.6) * 0.5);
      parts.push(paint(clean(tw), (c) => c.setRGB(bark[0], bark[1], bark[2])));
    }
  }
  return mergeGeometries(parts);
}

/** A clump of reeds standing in the shallows, a few with brown cattail heads. */
function reeds(seed, lod = 0) {
  const rng = mulberry(seed);
  const tris = [], heads = [];
  for (let k = 0; k < [16, 10, 6, 8][lod]; k++) {
    const a = rng() * 6.28, d = rng() * 0.25, h = 0.9 + rng() * 0.7, w = 0.025 + rng() * 0.015;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, lean = 0.1 + rng() * 0.25, la = rng() * 6.28;
    const tx = x + Math.cos(la) * lean, tz = z + Math.sin(la) * lean;
    const sx = -Math.sin(a) * w, sz = Math.cos(a) * w;
    tris.push([x - sx, 0, z - sz, x + sx, 0, z + sz, tx, h, tz]);
    if (k % 5 === 0 && lod < 2) {
      const g = clean(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5));
      g.translate(tx * 0.93, h * 0.9, tz * 0.93);
      heads.push(paint(g, (c) => c.setRGB(0.3, 0.17, 0.08)));
    }
  }
  return mergeGeometries([sheet(tris, (c, x, y) => c.setRGB(0.22 + 0.25 * y, 0.32 + 0.18 * y, 0.1 + 0.05 * y)), ...heads]);
}

// Tree kinds: 0-2 broadleaf, 3-4 conifer, 5 birch-ish, 6 dead, 7 shrub; each built at every level of detail.
// The desert's: 8-9 date palms (leaning a little or a lot), 10-11 saguaros, 12 barrel cacti, 13 scrub,
// 14 dead acacia, 15 reeds.
const KINDS = [
  (l) => broadleaf(1, {}, l), (l) => broadleaf(2, { radius: 1.05, leaf: 0x4a7428 }, l), (l) => broadleaf(3, { radius: 0.85, leaf: 0x56692a, height: 1.2 }, l),
  (l) => conifer(4, {}, l), (l) => conifer(5, { height: 3.0, color: 0x1a4024 }, l),
  (l) => broadleaf(6, { radius: 0.7, height: 1.6, leaf: 0x7a8a2c, bark: [0.78, 0.76, 0.7], clusters: 10 }, l),
  (l) => deadTree(7, l), (l) => shrub(8, l),
  (l) => palm(21, 0.12, l), (l) => palm(22, 0.32, l), (l) => saguaro(23, l), (l) => saguaro(24, l),
  (l) => barrel(25, l), (l) => scrub(26, l), (l) => acacia(27, l), (l) => reeds(28, l),
];
/** Desert kinds that stand stiff in the wind, and the thin ones seen from both sides. */
const RIGID = new Set([10, 11, 12, 14]);
const THIN = new Set([8, 9, 15]);

/** Wind: tree tops and grass tips sway; anchored at the ground. */
function windMaterial(base, strength, uniforms, occlude = false) {
  base.onBeforeCompile = (shader) => {
    if (occlude) applyOcclusion(shader, 1.3);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float k = max(0.0, transformed.y) * ${strength.toFixed(3)} * uWind;
          float ph = uTime * 1.7 + ip.x * 0.37 + ip.z * 0.29;
          transformed.x += (sin(ph) + 0.4 * sin(ph * 2.3 + 1.0)) * k * k;
          transformed.z += (cos(ph * 0.8) * 0.6) * k * k;
        }`);
  };
  return base;
}

/**
 * Grass: the tips sway in the wind (held to a sane bend in storms), blades lean away from the hero's
 * feet and tufts sink into the ground with distance instead of popping.
 */
function grassMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uFade = uniforms.uFade;
    shader.uniforms.uHero = OCCLUDE.uHero;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec2 uFade;\nuniform vec3 uHero;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          vec2 ax = instanceMatrix[0].xz, az = instanceMatrix[2].xz;
          float h = max(0.0, transformed.y);
          float k = h * 1.6 * uWind;
          float ph = uTime * 1.7 + ip.x * 0.37 + ip.z * 0.29;
          vec2 bend = vec2(sin(ph) + 0.4 * sin(ph * 2.3 + 1.0), cos(ph * 0.8) * 0.6) * k * k;
          // The hero's push, from world to tuft space (columns of the matrix: rotation times scale).
          vec2 away = ip.xz + ax * transformed.x + az * transformed.z - uHero.xz;
          float ad = length(away);
          float push = (1.0 - smoothstep(0.25, 0.8, ad)) * (1.0 - smoothstep(0.4, 1.0, uHero.y - 0.8 - ip.y));
          bend += vec2(dot(ax, away), dot(az, away)) / (length(ax) * max(ad, 0.001)) * push * h * 1.4;
          bend *= min(1.0, 1.3 * h / max(length(bend), 0.0001));
          transformed.xz += bend;
          transformed.y *= 1.0 - 0.45 * push;
          transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(ip.xz, cameraPosition.xz));
        }`);
  };
  return mat;
}

/** Flowers fade with the grass they grow in. */
function flowerMaterial(uniforms) {
  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = uniforms.uFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFade;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float f = 1.0 - smoothstep(uFade.x - 3.0, uFade.y - 3.0, distance(instanceMatrix[3].xz, cameraPosition.xz));
          transformed = transformed * f - vec3(0.0, 0.2 * (1.0 - f), 0.0);
        }`);
  };
  return mat;
}

/** A tuft of nine blades; the far version gives each blade a single triangle. */
function grassTuft(rng) {
  const near = [], far = [];
  const blade = (verts, index, a, ox, oz, h) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(index);
    g.rotateY(a);
    g.translate(ox, 0, oz);
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, nor.getX(i) * 0.3, 1, nor.getZ(i) * 0.3);
    g.normalizeNormals();
    return paint(g.toNonIndexed(), (c, x, y) => {
      const t = y / h;
      c.setRGB(0.07 + 0.2 * t, 0.15 + 0.3 * t, 0.04 + 0.08 * t);
    });
  };
  for (let b = 0; b < 9; b++) {
    const h = 0.16 + rng() * 0.2;
    const w = 0.022 + rng() * 0.015;
    const a = rng() * Math.PI * 2;
    const lean = 0.08 + rng() * 0.18;
    const ox = (rng() - 0.5) * 0.22, oz = (rng() - 0.5) * 0.22;
    near.push(blade([-w, 0, 0, w, 0, 0, -w * 0.55, h * 0.55, lean * 0.4, w * 0.55, h * 0.55, lean * 0.4, 0, h, lean], [0, 1, 2, 2, 1, 3, 2, 3, 4], a, ox, oz, h));
    far.push(blade([-w * 1.1, 0, 0, w * 1.1, 0, 0, 0, h, lean], [0, 1, 2], a, ox, oz, h));
  }
  return [mergeGeometries(near), mergeGeometries(far)];
}

/**
 * Instances bucketed by culling cell, as flat arrays: position, the rotation-and-scale terms of the
 * instance matrix (a = cos * s, b = sin * s, sy) and optionally a kind and a colour.
 */
function bucket(list, nx, ny, withColor) {
  const n = list.length;
  const start = new Uint32Array(nx * ny + 1);
  const cellOf = (e) => Math.min(ny - 1, Math.max(0, Math.floor(e[2] / CELL))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(e[0] / CELL)));
  for (const e of list) start[cellOf(e) + 1]++;
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nx * ny);
  const p = {
    n, start, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    a: new Float32Array(n), b: new Float32Array(n), sy: new Float32Array(n), kind: new Uint8Array(n),
    col: withColor ? new Float32Array(n * 3) : null,
  };
  for (const e of list) {
    const i = fill[cellOf(e)]++;
    const [x, y, z, r, s, sy, kind] = e;
    p.x[i] = x; p.y[i] = y; p.z[i] = z;
    p.a[i] = Math.cos(r) * s; p.b[i] = Math.sin(r) * s; p.sy[i] = sy;
    p.kind[i] = kind;
    if (withColor) p.col.set(e[7], i * 3);
  }
  return p;
}

/** An instanced mesh whose instances are rewritten whenever the view changes. */
function dynamicMesh(geo, mat, capacity, withColor) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (withColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  // Only used to sort the render list: set to roughly where this band's instances are.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return mesh;
}

/** A mesh that is drawn only into shadow maps: it skips the camera passes by drawing no instances there. */
function shadowOnly(mesh) {
  let n = 0;
  mesh.castShadow = true;
  mesh.onBeforeRender = () => { n = mesh.count; mesh.count = 0; };
  mesh.onAfterRender = () => { mesh.count = n; };
}

/** Copies instance i of a bucket into slot j of a mesh (the other matrix entries stay those of identity). */
function put(mesh, j, p, i) {
  const m = mesh.instanceMatrix.array, o = j * 16;
  const a = p.a[i], b = p.b[i];
  m[o] = a; m[o + 2] = -b; m[o + 5] = p.sy[i]; m[o + 8] = b; m[o + 10] = a;
  m[o + 12] = p.x[i]; m[o + 13] = p.y[i]; m[o + 14] = p.z[i];
  if (p.col) {
    const c = mesh.instanceColor.array;
    c[j * 3] = p.col[i * 3]; c[j * 3 + 1] = p.col[i * 3 + 1]; c[j * 3 + 2] = p.col[i * 3 + 2];
  }
}

function commit(mesh, n, v, dist) {
  mesh.count = n;
  mesh.visible = n > 0;
  if (!n) return;
  const m = mesh.instanceMatrix;
  m.clearUpdateRanges();
  m.addUpdateRange(0, n * 16);
  m.needsUpdate = true;
  if (mesh.instanceColor) {
    const c = mesh.instanceColor;
    c.clearUpdateRanges();
    c.addUpdateRange(0, n * 3);
    c.needsUpdate = true;
  }
  mesh.boundingSphere.center.set(v.px + v.fx * dist, v.py + v.fy * dist, v.pz + v.fz * dist);
}

const _v = new THREE.Vector3();

/**
 * Every tree, bush, grass tuft, flower and log of the overworld as a handful of instanced meshes, refilled
 * from the camera's view: near trees in full and casting shadows, distant ones light, grass only close by.
 */
export class Flora {
  /** field: the desert's DesertField on desert floors (palms, cacti and scrub instead of woods), else null. */
  constructor(level, ground, quality, field = null) {
    this.level = level;
    this.ground = ground;
    this.quality = quality;
    this.field = field;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uFade: { value: new THREE.Vector2(GRASS_FADE[0], GRASS_FADE[1]) } };
    this.group = new THREE.Group();
    // The camera is not handed to us: the first draw of a plant tells which one renders the world.
    this.camera = null;
    this.learn = (renderer, scene, camera) => {
      if (camera.isPerspectiveCamera && camera.position.distanceToSquared(OCCLUDE.uCam.value) < 0.01) this.camera = camera;
    };
    // View for culling: position, forward/right/up axes, half-angle tangents (padded) and secants.
    this.view = { px: 0, py: -999, pz: 0, fx: 0, fy: 0, fz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, tanH: 1, tanV: 1, secH: 1, secV: 1 };
    this.last = { px: 0, py: -1e9, pz: 0, fx: 0, fy: 0, fz: 0, tanH: 0, tanV: 0 };
    this.trees = null;
    this.grass = null;
    this.flowers = null;
  }

  build() {
    const lv = this.level;
    this.nx = Math.ceil(lv.w / CELL);
    this.ny = Math.ceil(lv.h / CELL);
    // Cell offsets nearest first, so instances go out roughly front to back.
    const span = Math.max(this.nx, this.ny) + 2;
    const ring = [];
    for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) ring.push([dx, dy]);
    ring.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]));
    this.ring = new Int16Array(ring.flat());
    this.buildTrees();
    this.buildGrass();
    // The village palisade stands on the overworld's walls; the desert's are rock.
    if (!this.field) this.buildPalisade();
    return this.group;
  }

  /**
   * Desert plants as [x, y, z, yaw, scale, scale, kind]: palms on tree tiles near the water and leaning out
   * over the pool's edge, reeds in its shallows, cacti, scrub and dead acacias on the other tree tiles, at
   * the foot of the ridges and on their tops, small scrub on the open sand. Nothing big where people walk.
   */
  desertPlants() {
    const lv = this.level, f = this.field, { w, h } = lv;
    const t = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? TILE.WALL : lv.tiles.charCodeAt(y * w + x) - 48);
    const seed = lv.seed | 0;
    const r = (x, y, k) => hash(x, y, seed * 3 + k);
    const water = (x, y, d) => {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (t(x + dx, y + dy) === TILE.WATER) return true;
      return false;
    };
    const list = [];
    const put = (x, z, kind, s, y = this.ground.heightAt(x, z)) => list.push([x, y, z, hash(Math.floor(x * 9), Math.floor(z * 9), 7) * 6.28, s, s, kind]);
    const dense = this.quality.grass ?? 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tile = t(x, y);
        if (tile === TILE.TREE) {
          const px = x + 0.5 + (r(x, y, 1) - 0.5) * 0.3, pz = y + 0.5 + (r(x, y, 2) - 0.5) * 0.3;
          if (water(x, y, 4)) put(px, pz, r(x, y, 3) < 0.5 ? 8 : 9, 0.85 + r(x, y, 4) * 0.35);
          else put(px, pz, r(x, y, 3) < 0.55 ? 10 + (r(x, y, 5) < 0.5 ? 1 : 0) : r(x, y, 3) < 0.8 ? 14 : 12, 0.8 + r(x, y, 4) * 0.4);
        } else if (tile === TILE.WATER) {
          // The shore: reeds in the shallows, now and then a palm leaning over the water.
          const land = [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([dx, dy]) => t(x + dx, y + dy) !== TILE.WATER);
          if (!land.length) continue;
          const [dx, dy] = land[Math.floor(r(x, y, 6) * land.length)];
          if (r(x, y, 7) < 0.55) {
            for (let k = 0; k < 2; k++) {
              const along = (r(x, y, 8 + k) - 0.5) * 0.8;
              put(x + 0.5 + dx * 0.3 + dy * along, y + 0.5 + dy * 0.3 + dx * along, 15, 0.8 + r(x, y, 10 + k) * 0.5);
            }
          } else if (r(x, y, 12) < 0.35) {
            const px = x + 0.5 + dx * 0.38, pz = y + 0.5 + dy * 0.38, s = 0.9 + r(x, y, 13) * 0.3;
            // Leaning out over the water: the lean is along the model's +x, so turn it away from the land.
            list.push([px, this.ground.heightAt(px, pz), pz, Math.atan2(dy, -dx), s, s, 9]);
          }
        } else if (tile === TILE.WALL && !f.isBuilt(x, y)) {
          const s = f.S(x + 0.5, y + 0.5);
          const v = r(x, y, 20);
          if (s < 0.8) {
            // At the cliff foot, inside the rock tile.
            if (v > 0.2 * dense) continue;
            const spot = f.foot(x + r(x, y, 21), y + r(x, y, 22), 0.32);
            if (!spot || t(Math.floor(spot[0]), Math.floor(spot[1])) !== TILE.WALL) continue;
            const kind = v < 0.03 ? 10 + (v < 0.015 ? 1 : 0) : v < 0.08 ? 12 : v < 0.1 ? 14 : 13;
            put(spot[0], spot[1], kind, 0.75 + r(x, y, 23) * 0.4);
          } else if (s > 1.0 && v < 0.07 * dense) {
            // On the ridge tops.
            const px = x + r(x, y, 24), pz = y + r(x, y, 25);
            const kind = v < 0.02 ? 10 + (v < 0.01 ? 1 : 0) : v < 0.03 ? 14 : 13;
            put(px, pz, kind, 0.7 + r(x, y, 26) * 0.4, f.rockTop(px, pz) - 0.05);
          }
        } else if (tile === TILE.FLOOR) {
          const m = lv.mat ? lv.mat.charCodeAt(y * w + x) - 48 : 0;
          if (m <= 2 && r(x, y, 30) < 0.025 * dense) put(x + r(x, y, 31), y + r(x, y, 32), 13, 0.45 + r(x, y, 33) * 0.25);
        }
      }
    }
    return list;
  }

  buildTrees() {
    const lv = this.level;
    if (this.field) {
      this.placeTrees(this.desertPlants());
      return;
    }
    const varOf = (i) => parseInt(lv.var.substr(i * 2, 2), 16) / 255;
    const list = [];
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const i = y * lv.w + x;
        if (lv.tiles.charCodeAt(i) - 48 !== TILE.TREE) continue;
        const v = varOf(i);
        let k;
        if (v < 0.05) k = 6;
        else if (v < 0.13) k = 7;
        else {
          const r = (v * 997) % 1;
          k = r < 0.28 ? 3 : r < 0.46 ? 4 : r < 0.66 ? 0 : r < 0.82 ? 1 : r < 0.92 ? 2 : 5;
        }
        const s = 0.85 + ((v * 7) % 1) * 0.45;
        const tx = x + 0.5 + (hash(x, y, 3) - 0.5) * 0.4, tz = y + 0.6 + (hash(x, y, 4) - 0.5) * 0.3;
        list.push([tx, this.ground.heightAt(tx, tz), tz, hash(x, y, 5) * 6.28, s, s, k]);
      }
    }
    this.placeTrees(list);
  }

  /** Instanced meshes for every kind in the list ([x, y, z, yaw, scale, scale y, kind]), per level of detail. */
  placeTrees(list) {
    const perKind = new Uint32Array(KINDS.length);
    for (const e of list) perKind[e[6]]++;
    if (!list.length) return;
    const mat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 0.12, this.uniforms, true);
    // The desert's stiff cacti and its thin, two-sided fronds and reeds have materials of their own.
    let rigid = null, thin = null;
    const matOf = (k) => {
      if (RIGID.has(k)) {
        if (!rigid) {
          rigid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
          rigid.onBeforeCompile = (shader) => applyOcclusion(shader, 1.3);
          rigid.customProgramCacheKey = () => 'flora-rigid';
        }
        return rigid;
      }
      if (THIN.has(k)) {
        if (!thin) {
          thin = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 0.09, this.uniforms, true);
          thin.customProgramCacheKey = () => 'flora-thin';
        }
        return thin;
      }
      return mat;
    };
    // Per kind: bounding sphere centre height and radius at scale 1, and a mesh for each level of detail.
    this.treeY = new Float32Array(KINDS.length);
    this.treeR = new Float32Array(KINDS.length);
    this.treeMeshes = KINDS.map((make, k) => {
      if (!perKind[k]) return null;
      return [0, 1, 2, 3].map((lod) => {
        const geo = make(lod);
        if (lod === 0) {
          geo.computeBoundingSphere();
          const bs = geo.boundingSphere;
          this.treeY[k] = bs.center.y;
          this.treeR[k] = bs.radius + Math.hypot(bs.center.x, bs.center.z);
        }
        const mesh = dynamicMesh(geo, matOf(k), perKind[k], false);
        mesh.receiveShadow = true; // also on the shadow stand-in, which then shares the trees' program
        if (lod < 3) mesh.onBeforeRender = this.learn;
        else shadowOnly(mesh);
        this.group.add(mesh);
        return mesh;
      });
    });
    this.treeCount = new Uint32Array(KINDS.length * 4);
    this.trees = bucket(list, this.nx, this.ny, false);
  }

  /** Grass tufts and flowers over grassy ground; only those near the camera are drawn. */
  buildGrass() {
    const lv = this.level;
    const rng = mulberry(11);
    const variants = [grassTuft(rng), grassTuft(rng), grassTuft(rng)];
    const dryTint = [0.62, 0.55, 0.3];
    const density = this.quality.grass;
    const flowerColors = [0xf4f1ea, 0xf7d23a, 0x7d7af0, 0xd8322a, 0xe98ad8];
    // The desert: a lush sward on the oasis grass (mat 4), a dry tuft here and there on the sand.
    const desert = !!this.field;
    const grassy = desert ? (m) => m <= 2 || m === 4 : (m) => m === 0 || m === 1 || m === 2;
    const tufts = [], flowers = [];
    const c = new THREE.Color();
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const i = y * lv.w + x;
        const t = lv.tiles.charCodeAt(i) - 48;
        if (t !== TILE.FLOOR && t !== TILE.TREE) continue;
        const mt = lv.mat.charCodeAt(i) - 48;
        if (!grassy(mt)) continue;
        const sparse = desert && mt !== 4;
        const n = sparse ? (hash(x, y, 19) < 0.07 * density ? 2 : 0)
          : Math.round((mt === 2 && !desert ? 1.5 : mt === 1 ? 4 : 5) * density * (0.6 + hash(x, y, 9) * 0.8));
        for (let k = 0; k < n; k++) {
          const px = sparse ? x + hash(x, y, 1) + (k - 0.5) * 0.12 : x + hash(x * 7 + k, y, 1);
          const pz = sparse ? y + hash(x, y, 2) : y + hash(x, y * 7 + k, 2);
          const s = 0.5 + hash(x, y + k, 4) * 0.45;
          const dry = desert ? sparse : mt === 1;
          if (dry) c.setRGB(dryTint[0] * 1.6, dryTint[1] * 1.5, dryTint[2] * 1.4);
          else c.setRGB(0.85 + hash(x * 7 + k, y, 6) * 0.3, 1, 0.85);
          tufts.push([px, this.ground.heightAt(px, pz), pz, hash(x + k, y, 3) * 6.28, s, s * (dry ? 1.25 : 1), k % 3, [c.r, c.g, c.b]]);
        }
        if (mt === 0 && !desert && hash(x, y, 21) < 0.18 * density) {
          c.setHex(flowerColors[Math.floor(hash(x >> 2, y >> 2, 22) * flowerColors.length)]);
          for (let k = 0; k < 6; k++) {
            const fx = x + hash(x, y, 30 + k), fz = y + hash(x, y, 40 + k);
            flowers.push([fx, this.ground.heightAt(fx, fz) + 0.2 + hash(x * 6 + k, y, 50) * 0.08, fz, 0, 1, 1, 0, [c.r, c.g, c.b]]);
          }
        }
      }
    }
    if (tufts.length) {
      const mat = grassMaterial(this.uniforms);
      this.grassMeshes = variants.map((pair, k) => pair.map((geo) => {
        const mesh = dynamicMesh(geo, mat, tufts.filter((e) => e[6] === k).length, true);
        mesh.receiveShadow = true;
        mesh.onBeforeRender = this.learn;
        this.group.add(mesh);
        return mesh;
      }));
      this.grassCount = new Uint32Array(variants.length * 2);
      this.grass = bucket(tufts, this.nx, this.ny, true);
    }
    if (flowers.length) {
      this.flowerMesh = dynamicMesh(new THREE.IcosahedronGeometry(0.035, 0), flowerMaterial(this.uniforms), flowers.length, true);
      this.group.add(this.flowerMesh);
      this.flowers = bucket(flowers, this.nx, this.ny, true);
    }
  }

  /** The village palisade: rows of sharpened logs along the wall tiles. */
  buildPalisade() {
    const lv = this.level;
    const log = new THREE.CylinderGeometry(0.1, 0.12, 1.7, 8, 1);
    log.translate(0, 0.85, 0);
    const tip = new THREE.ConeGeometry(0.1, 0.28, 8);
    tip.translate(0, 1.84, 0);
    const geo = mergeGeometries([
      paint(lumpy(log, 0.015, 9), (c, x, y) => c.setRGB(0.36, 0.25, 0.16).multiplyScalar(0.8 + 0.2 * Math.sin(y * 13))),
      paint(lumpy(tip, 0.01, 9, 3), (c) => c.setRGB(0.42, 0.31, 0.2)),
    ]);
    const list = [];
    const wall = (x, y) => x >= 0 && y >= 0 && x < lv.w && y < lv.h && lv.tiles.charCodeAt(y * lv.w + x) - 48 === TILE.WALL;
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        if (!wall(x, y)) continue;
        const horiz = wall(x - 1, y) || wall(x + 1, y);
        const vert = wall(x, y - 1) || wall(x, y + 1);
        const n = 4;
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          if (horiz || !vert) list.push([x + f, y + 0.5, hash(x, y, k)]);
          if (vert && !horiz) list.push([x + 0.5, y + f, hash(x, y, k + 9)]);
        }
      }
    }
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach(([x, z, r], j) => {
      q.setFromAxisAngle(up, r * 6.28);
      const s = 0.9 + r * 0.25;
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, s, 1));
      mesh.setMatrixAt(j, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  update(t, wind) {
    this.uniforms.uTime.value = t;
    this.uniforms.uWind.value = wind;
    if (this.look()) this.cull();
  }

  /** Reads the view into this.view; true when it moved enough since the last cull to redo it. */
  look() {
    const v = this.view, cam = this.camera;
    let tanV, tanH;
    if (cam) {
      v.px = cam.position.x; v.py = cam.position.y; v.pz = cam.position.z;
      _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
      v.fx = _v.x; v.fy = _v.y; v.fz = _v.z;
      _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
      v.rx = _v.x; v.ry = _v.y; v.rz = _v.z;
      _v.set(0, 1, 0).applyQuaternion(cam.quaternion);
      v.ux = _v.x; v.uy = _v.y; v.uz = _v.z;
      tanV = Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1);
      tanH = tanV * cam.aspect;
      // Margins: the selection is only redone after the camera moved or turned a little.
      tanV += 0.05;
      tanH += 0.05;
    } else {
      // Before the first draw: the chase camera looks at the hero from uCam, with some fov.
      const c = OCCLUDE.uCam.value, h = OCCLUDE.uHero.value;
      if (c.y < -500 || h.y < -500) return false;
      v.px = c.x; v.py = c.y; v.pz = c.z;
      _v.set(h.x - c.x, h.y + 0.25 - c.y, h.z - c.z).normalize();
      v.fx = _v.x; v.fy = _v.y; v.fz = _v.z;
      const l = Math.hypot(v.fx, v.fz) || 1;
      v.rx = -v.fz / l; v.ry = 0; v.rz = v.fx / l;
      v.ux = v.ry * v.fz - v.rz * v.fy; v.uy = v.rz * v.fx - v.rx * v.fz; v.uz = v.rx * v.fy - v.ry * v.fx;
      const aspect = typeof innerWidth === 'number' && innerHeight > 0 ? innerWidth / innerHeight : 1;
      tanV = 0.9;
      tanH = 0.7 * Math.max(1, aspect) + 0.3;
    }
    v.tanV = tanV; v.tanH = tanH;
    v.secV = Math.sqrt(1 + tanV * tanV); v.secH = Math.sqrt(1 + tanH * tanH);
    const l = this.last;
    const dx = v.px - l.px, dy = v.py - l.py, dz = v.pz - l.pz;
    if (dx * dx + dy * dy + dz * dz < 0.12 && v.fx * l.fx + v.fy * l.fy + v.fz * l.fz > 0.9992 && tanV === l.tanV && tanH === l.tanH) return false;
    l.px = v.px; l.py = v.py; l.pz = v.pz; l.fx = v.fx; l.fy = v.fy; l.fz = v.fz; l.tanV = tanV; l.tanH = tanH;
    return true;
  }

  /** Where a sphere sits in the view: 0 outside, 1 across an edge, 2 wholly inside. */
  seen(x, y, z, r) {
    const v = this.view;
    const dx = x - v.px, dy = y - v.py, dz = z - v.pz;
    const zc = dx * v.fx + dy * v.fy + dz * v.fz;
    if (zc < -r) return 0;
    const xc = dx * v.rx + dy * v.ry + dz * v.rz, yc = dx * v.ux + dy * v.uy + dz * v.uz;
    // Distances past the side planes, times their secants.
    const sx = (xc < 0 ? -xc : xc) - zc * v.tanH, sy = (yc < 0 ? -yc : yc) - zc * v.tanV;
    const rh = r * v.secH, rv = r * v.secV;
    if (sx > rh || sy > rv) return 0;
    return zc > r && sx < -rh && sy < -rv ? 2 : 1;
  }

  /** Refills every plant mesh with the instances in view, nearest cells first. */
  cull() {
    const v = this.view, ring = this.ring, nx = this.nx, ny = this.ny;
    const ccx = Math.floor(v.px / CELL), ccy = Math.floor(v.pz / CELL);
    const T = this.trees, G = this.grass, F = this.flowers;
    const counts = this.treeCount, grassCounts = this.grassCount;
    if (counts) counts.fill(0);
    if (grassCounts) grassCounts.fill(0);
    let nFlower = 0;
    const l0 = TREE_LOD[0] * TREE_LOD[0], l1 = TREE_LOD[1] * TREE_LOD[1], far = TREE_FAR * TREE_FAR;
    const g0 = GRASS_NEAR * GRASS_NEAR, gEnd = GRASS_FADE[1] + 0.5, g1 = gEnd * gEnd;
    const half = CELL / 2, cellR = half * Math.SQRT2;
    for (let o = 0; o < ring.length; o += 2) {
      const cx = ccx + ring[o], cy = ccy + ring[o + 1];
      if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) continue;
      const cell = cy * nx + cx;
      const mx = cx * CELL + half, mz = cy * CELL + half;
      const ddx = mx - v.px, ddz = mz - v.pz;
      const flat = Math.sqrt(ddx * ddx + ddz * ddz) - cellR; // nearest the cell can be, ignoring height
      if (flat > TREE_FAR) continue;
      const tv = T && T.start[cell + 1] > T.start[cell] ? this.seen(mx, 1, mz, cellR + 4 + SHADOW_MARGIN) : 0;
      if (tv) {
        for (let i = T.start[cell], e = T.start[cell + 1]; i < e; i++) {
          const k = T.kind[i], s = T.sy[i];
          const x = T.x[i], y = T.y[i] + this.treeY[k] * s, z = T.z[i];
          const dx = x - v.px, dy = y - v.py, dz = z - v.pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > far) continue;
          const lod = d2 < l0 ? 0 : d2 < l1 ? 1 : 2;
          if (tv === 1 && !this.seen(x, y, z, this.treeR[k] * s + (lod < 2 ? SHADOW_MARGIN : 0.3))) continue;
          const meshes = this.treeMeshes[k];
          put(meshes[lod], counts[k * 4 + lod]++, T, i);
          if (lod < 2) put(meshes[3], counts[k * 4 + 3]++, T, i);
        }
      }
      if (flat > gEnd) continue;
      // Grass and flowers: whole cells in view skip the test per instance.
      const gv = this.seen(mx, 0.2, mz, cellR + 0.8);
      if (!gv) continue;
      if (G) {
        for (let i = G.start[cell], e = G.start[cell + 1]; i < e; i++) {
          const x = G.x[i], z = G.z[i];
          const dx = x - v.px, dz = z - v.pz;
          const d2 = dx * dx + dz * dz;
          if (d2 > g1 || (gv === 1 && !this.seen(x, G.y[i] + 0.15, z, 0.6))) continue;
          const slot = G.kind[i] * 2 + (d2 < g0 ? 0 : 1);
          put(this.grassMeshes[G.kind[i]][slot & 1], grassCounts[slot]++, G, i);
        }
      }
      if (F) {
        for (let i = F.start[cell], e = F.start[cell + 1]; i < e; i++) {
          const x = F.x[i], z = F.z[i];
          const dx = x - v.px, dz = z - v.pz;
          if (dx * dx + dz * dz > g1 || (gv === 1 && !this.seen(x, F.y[i], z, 0.4))) continue;
          put(this.flowerMesh, nFlower++, F, i);
        }
      }
    }
    if (this.treeMeshes) {
      const mid = [TREE_LOD[0] * 0.5, (TREE_LOD[0] + TREE_LOD[1]) * 0.5, TREE_LOD[1] * 2, TREE_LOD[0]];
      for (let k = 0; k < this.treeMeshes.length; k++) {
        const meshes = this.treeMeshes[k];
        if (meshes) for (let lod = 0; lod < 4; lod++) commit(meshes[lod], counts[k * 4 + lod], v, mid[lod]);
      }
    }
    if (G) {
      for (let k = 0; k < this.grassMeshes.length; k++) {
        commit(this.grassMeshes[k][0], grassCounts[k * 2], v, GRASS_NEAR * 0.5);
        commit(this.grassMeshes[k][1], grassCounts[k * 2 + 1], v, (GRASS_NEAR + GRASS_FADE[1]) * 0.5);
      }
    }
    if (F) commit(this.flowerMesh, nFlower, v, GRASS_FADE[0] * 0.5);
  }
}
