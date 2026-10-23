import * as THREE from 'three';
import { TILE, hash } from './defs.js';
import { applyOcclusion } from './occlude.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAD, SAND, desertNoise, valueNoise } from './desert.js';

/**
 * The desert's built and grown stone, all static and merged per material into chunks of the level (so the
 * main view and the shadow map still cull what is out of sight):
 * - Ridges: every WALL tile that is not a ruin becomes layered sandstone. A welded mesh of cliff faces
 *   (ROWS bands from below the sand to a rounded rim) and flat tops is pushed onto the smoothed distance
 *   field of the ridges, so the blocky tile outline turns into eroded, terraced, leaning cliffs; the tops
 *   roll and rise into mesas further in, and dunes bury them in places. Strata, grain, desert varnish,
 *   sand on the ledges and the ledges' bump are painted in world space by the rock shader.
 * - Ruins: thin walls beside paving are courses of chamfered sandstone blocks with broken tops and
 *   fallen blocks at their feet.
 * - Scenery from the level seed: sandstone boulders, obelisks, broken columns, a half-buried colossal
 *   head, bleached skulls and rib cages, pottery, sarcophagi and banners in the ruins, rock arches and
 *   hoodoos on the ridge tops. Big pieces only stand where nobody walks (ridges, boulder tiles, hard
 *   against a cliff foot); on open sand only small things lie.
 */

const CHUNK = 16;
const ROWS = 7; // bands of a cliff face, from below the sand up to the rim
const COURSE = 0.4; // height of a course of ruin masonry

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** A transform from position, Euler rotation (YXZ) and scale. */
function xf(x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Sandstone, lit like the rest: kind 'rock' paints strata (bands that dip and wander, a red or bleached
 * layer now and then), grain and dark varnish streaks down the faces, with sand settled on whatever faces
 * up and a bump that turns each band's foot into a small ledge; 'stone' is dressed masonry: grain, pits and
 * sand dust at the foot. Both take the cutaway around the hero and multiply the vertex colours.
 */
function sandstone(kind, quality) {
  const rock = kind === 'rock';
  const bump = quality.name !== 'low';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rock ? 0.93 : 0.86, metalness: 0 });
  const uniforms = { uNoise: { value: desertNoise() }, uSandCol: { value: new THREE.Color(0xd8b788) } };
  mat.customProgramCacheKey = () => `desert-${kind}${bump ? '-bump' : ''}`;
  mat.onBeforeCompile = (shader) => {
    applyOcclusion(shader, 1.6, 0.32);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStoneN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStoneN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vStoneN;
uniform sampler2D uNoise;
uniform vec3 uSandCol;
float stoneH = 0.0;`)
      .replace('#include <map_fragment>', `
{
  vec3 sp = vOccWp, sn = normalize(vStoneN), an = abs(sn);
  vec2 side = an.x > an.z ? sp.zy : sp.xy;
  float top = smoothstep(0.5, 0.85, an.y);
  float grain = mix(texture(uNoise, side * vec2(0.8, 1.5)).b, texture(uNoise, sp.xz * 0.8).b, top);
  float fine = mix(texture(uNoise, side * 3.3).g, texture(uNoise, sp.xz * 3.3).g, top);
  vec3 c;
${rock ? `
  // Strata: bands about half a metre thick that dip and wander across the ridge.
  float warp = (texture(uNoise, sp.xz * 0.037).r - 0.5) * 1.9 + (texture(uNoise, sp.xz * 0.19 + 0.3).g - 0.5) * 0.4;
  float s = sp.y * 2.1 + warp, id = floor(s), f = fract(s);
  float hk = fract(sin(id * 91.17 + 3.1) * 43758.5453);
  c = mix(vec3(0.79, 0.47, 0.27), vec3(0.93, 0.71, 0.49), hk);
  c = mix(c, vec3(0.6, 0.3, 0.19), step(0.8, hk) * 0.75);
  c = mix(c, vec3(0.96, 0.85, 0.67), step(hk, 0.13) * 0.7);
  c *= (0.8 + 0.32 * grain) * (0.9 + 0.2 * fine);
  // Desert varnish: dark streaks run down the faces from the ledges.
  float streak = texture(uNoise, vec2((sp.x + sp.z) * 0.55, sp.y * 0.045)).a;
  c *= 1.0 - smoothstep(0.55, 0.8, streak) * (1.0 - an.y) * 0.5;
  // Sand settles on whatever faces up.
  float up = smoothstep(0.62, 0.9, sn.y + (grain - 0.5) * 0.35);
  c = mix(c, uSandCol * (0.9 + 0.2 * fine), up * 0.85);
  stoneH = smoothstep(0.0, 0.16, f) * 0.6 + grain * 0.3 + fine * 0.2;` : `
  // Dressed stone: grain, weathering pits, dust of sand at the foot.
  float pits = smoothstep(0.68, 0.84, mix(texture(uNoise, side * 4.3).r, texture(uNoise, sp.xz * 4.3).r, top));
  c = vec3(0.82 + 0.3 * grain) * (0.92 + 0.14 * fine) * (1.0 - 0.28 * pits);
  c = mix(c, uSandCol * 1.05, (1.0 - smoothstep(0.0, 0.55, sp.y)) * 0.35 + top * 0.12);
  stoneH = grain * 0.5 + fine * 0.3 + (1.0 - pits) * 0.4;`}
  diffuseColor.rgb *= pow(c, vec3(2.2));
}
`);
    if (bump) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
{
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(stoneH), dhdy = dFdy(stoneH);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  normal = normalize(abs(det) * normal - grad * ${rock ? '0.05' : '0.025'});
}
`);
    }
  };
  return mat;
}

/**
 * Triangles for one material, sorted into square chunks of the level by their centre. Positions, normals
 * and colours (linear); mesh() gives one mesh per chunk.
 */
class Chunks {
  constructor() {
    this.map = new Map();
  }

  bucket(x, z) {
    const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let b = this.map.get(key);
    if (!b) this.map.set(key, b = { pos: [], nor: [], col: [] });
    return b;
  }

  /** A triangle from flat arrays at vertex indices i, j, k. */
  tri(P, N, C, i, j, k) {
    const b = this.bucket((P[i * 3] + P[j * 3] + P[k * 3]) / 3, (P[i * 3 + 2] + P[j * 3 + 2] + P[k * 3 + 2]) / 3);
    for (const v of [i, j, k]) {
      b.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      b.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      b.col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
    }
  }

  /** A geometry placed by matrix m, in one colour or coloured per vertex by fn(c, x, y, z) (local coordinates). */
  add(geo, m, color, fn) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    _nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const col = new THREE.Color();
    const cx = m.elements[12], cz = m.elements[14];
    const b = this.bucket(cx, cz);
    for (let t = 0; t < P.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = t + (flip ? [0, 2, 1][k] : k);
        _v.fromBufferAttribute(P, i);
        if (fn) fn(col, _v.x, _v.y, _v.z);
        else if (C) col.fromBufferAttribute(C, i);
        else col.copy(color);
        _v.applyMatrix4(m);
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        b.pos.push(_v.x, _v.y, _v.z);
        b.nor.push(_n.x, _n.y, _n.z);
        b.col.push(col.r, col.g, col.b);
      }
    }
  }

  meshes(material, name, shadow = true) {
    const out = [];
    for (const b of this.map.values()) {
      if (!b.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    return out;
  }
}

/** Flat-shaded triangles of a convex polyhedron given as polygons, each turned to face away from the centre. */
function convex(polys) {
  const pos = [], nor = [];
  for (const poly of polys) {
    const c = new THREE.Vector3();
    for (const p of poly) c.add(p);
    c.divideScalar(poly.length);
    _n.subVectors(poly[1], poly[0]).cross(_a.subVectors(poly[2], poly[0])).normalize();
    const flip = _n.dot(c) < 0;
    if (flip) _n.negate();
    for (let i = 1; i + 1 < poly.length; i++) {
      const tri = flip ? [poly[0], poly[i + 1], poly[i]] : [poly[0], poly[i], poly[i + 1]];
      for (const p of tri) { pos.push(p.x, p.y, p.z); nor.push(_n.x, _n.y, _n.z); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

/** A box of half sizes a, b, d with chamfered edges of width c: the crisp highlights of cut stone. */
function chamferBox(a, b, d, c) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const polys = [];
  const S = [-1, 1];
  // Main faces.
  for (const s of S) {
    polys.push([V(s * a, -(b - c), -(d - c)), V(s * a, b - c, -(d - c)), V(s * a, b - c, d - c), V(s * a, -(b - c), d - c)]);
    polys.push([V(-(a - c), s * b, -(d - c)), V(a - c, s * b, -(d - c)), V(a - c, s * b, d - c), V(-(a - c), s * b, d - c)]);
    polys.push([V(-(a - c), -(b - c), s * d), V(a - c, -(b - c), s * d), V(a - c, b - c, s * d), V(-(a - c), b - c, s * d)]);
  }
  // Edge bevels and corner facets.
  for (const sx of S) {
    for (const sy of S) {
      polys.push([V(sx * a, sy * (b - c), -(d - c)), V(sx * a, sy * (b - c), d - c), V(sx * (a - c), sy * b, d - c), V(sx * (a - c), sy * b, -(d - c))]);
      for (const sz of S) {
        polys.push([V(sx * a, sy * (b - c), sz * (d - c)), V(sx * (a - c), sy * b, sz * (d - c)), V(sx * (a - c), sy * (b - c), sz * d)]);
      }
    }
    for (const sz of S) polys.push([V(sx * a, -(b - c), sz * (d - c)), V(sx * a, b - c, sz * (d - c)), V(sx * (a - c), b - c, sz * d), V(sx * (a - c), -(b - c), sz * d)]);
  }
  for (const sy of S) for (const sz of S) polys.push([V(-(a - c), sy * (b - c), sz * d), V(a - c, sy * (b - c), sz * d), V(a - c, sy * b, sz * (d - c)), V(-(a - c), sy * b, sz * (d - c))]);
  return convex(polys);
}

/** A lumpy boulder: an icosahedron pushed about by noise, flattened a little. */
function boulder(seed, detail = 1) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const P = geo.attributes.position, n = valueNoise(seed);
  for (let i = 0; i < P.count; i++) {
    _v.fromBufferAttribute(P, i);
    const k = 0.72 + 0.5 * n(_v.x * 1.7 + 5, _v.z * 1.7 + _v.y * 1.3 + 5);
    P.setXYZ(i, _v.x * k, _v.y * k * 0.78, _v.z * k);
  }
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** A surface of revolution from [radius, height] pairs (pots, column drums). */
function lathe(profile, segments) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments).toNonIndexed();
}

/** Linear colour from sRGB hex, scaled. */
function lin(hex, k = 1) {
  return new THREE.Color(hex).multiplyScalar(k);
}

class DesertBuilder {
  constructor(world) {
    this.world = world;
    this.field = world.field;
    this.level = world.level;
    this.quality = world.quality;
    this.rock = new Chunks();
    this.stone = new Chunks();
    this.bone = new Chunks();
    this.clay = new Chunks();
    this.r = valueNoise((this.field.seed | 0) + 31);
    this.used = new Set(); // tiles with something big on them
    this.ruinH = new Map(); // ruin wall tile -> about how high it still stands
    // Where the props stand: big scenery keeps its distance.
    for (const [, x, y] of this.level.props) this.used.add(Math.floor(y) * this.level.w + Math.floor(x));
    if (this.level.exit) this.used.add(this.level.exit[1] * this.level.w + this.level.exit[0]);
  }

  tile(x, y) {
    return this.world.tile(x, y);
  }

  rnd(x, y, k) {
    return hash(x, y, (this.field.seed | 0) * 7 + k);
  }

  /** Height of the ridge top surface at a point (the mesh's tops follow it). */
  topY(x, z, s) {
    return this.field.rockTop(x, z, s);
  }

  build() {
    this.cliffs();
    this.ruins();
    this.scenery();
    const group = this.world.group;
    const q = this.quality;
    const rockMat = sandstone('rock', q), stoneMat = sandstone('stone', q);
    const boneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const clayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    for (const m of [
      ...this.rock.meshes(rockMat, 'desert-rock'), ...this.stone.meshes(stoneMat, 'desert-stone'),
      ...this.bone.meshes(boneMat, 'desert-bone'), ...this.clay.meshes(clayMat, 'desert-clay'),
    ]) group.add(m);
  }

  // ---------------------------------------------------------------------------------------------------
  // Ridges

  /**
   * The welded cliff mesh: faces along every rock edge that meets open ground, tops over the rock (half-tile
   * cells near the rim, whole tiles further in, stitched to their finer neighbours by fans), then the face
   * vertices pushed out or in along the field's gradient to the terraced, eroded profile.
   */
  cliffs() {
    const f = this.field, { w, h } = f;
    const rock = (x, z) => f.isRock(x, z) === 1;
    const lo = 1 - PAD, hx = w + PAD - 1, hz = h + PAD - 1;
    const nearOpen = (x, z) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!rock(x + dx, z + dz)) return true;
      return false;
    };
    const pos = [], idx = [], ao = [];
    const ids = new Map();
    const inside = (x, z) => x >= 0 && z >= 0 && x <= w && z <= h;
    const sandAt = (x, z) => (inside(x, z) ? this.world.heightAt(x, z) : 0);
    // A point on the half-tile grid (kx, kz) touches open ground when any tile around it is open.
    const rimPoint = (kx, kz) => {
      const xs = kx & 1 ? [(kx - 1) / 2] : [kx / 2 - 1, kx / 2], zs = kz & 1 ? [(kz - 1) / 2] : [kz / 2 - 1, kz / 2];
      for (const tx of xs) for (const tz of zs) if (!rock(tx, tz)) return true;
      return false;
    };
    const grad = (x, z) => {
      const e = 0.12;
      _a.set((f.S(x + e, z) - f.S(x - e, z)) / (2 * e), 0, (f.S(x, z + e) - f.S(x, z - e)) / (2 * e));
      return _a;
    };
    // Moves (x, z) along the gradient until the field reads s there.
    const project = (x, z, s) => {
      for (let it = 0; it < 4; it++) {
        const g = grad(x, z), l2 = g.x * g.x + g.z * g.z;
        if (l2 < 0.04) break;
        let k = (s - f.S(x, z)) / l2;
        const step = Math.hypot(g.x * k, g.z * k);
        if (step > 0.35) k *= 0.35 / step;
        x += g.x * k;
        z += g.z * k;
      }
      return [x, z];
    };
    const vert = (key, x, y, z, a) => {
      let i = ids.get(key);
      if (i === undefined) {
        i = pos.length / 3;
        ids.set(key, i);
        pos.push(x, y, z);
        ao.push(a);
      }
      return i;
    };
    const key = (kx, kz, r) => ((kz + 4 * PAD) * 4096 + kx + 4 * PAD) * 16 + r;
    // The face profile: how far into the field (s) the face stands at a height, by band.
    const thick = new Map();
    const profile = (x, z, y, y0, r, dmax) => {
      if (r === 0) return -0.04;
      const u = (y + (f.n1(x * 0.6, z * 0.6) - 0.5) * 0.9) / 0.62;
      const band = Math.abs(u - Math.floor(u) - 0.5) * 2;
      let d = 0.05 + 0.055 * (y - y0) + 0.09 * band + 0.2 * (f.n3(x * 0.9 + y * 0.25, z * 0.9 - y * 0.2) - 0.5);
      if (r === ROWS) d += 0.16;
      return Math.max(-0.02, Math.min(dmax, d));
    };
    // The vertex of row r (ROWS: the rim) at half-tile grid point (kx, kz).
    const faceVert = (kx, kz, r, dmax) => {
      const k = key(kx, kz, r);
      if (ids.has(k)) return ids.get(k);
      const x = kx / 2, z = kz / 2;
      const y0 = sandAt(x, z) - 0.38, y1 = this.topY(x, z, 0.15);
      const y = r === ROWS ? y1 : y0 + (y1 - y0) * (r / ROWS) + (r > 0 ? (f.n2(x * 2.1, z * 2.1 + r) - 0.5) * 0.12 : 0);
      const [px, pz] = project(x, z, profile(x, z, y, y0, r, dmax));
      const shade = r === ROWS ? 0.95 : 0.55 + 0.45 * THREE.MathUtils.smoothstep(y - sandAt(px, pz), 0.0, 1.1);
      return vert(k, px, y, pz, shade);
    };
    const topVert = (kx, kz) => {
      const k = key(kx, kz, ROWS);
      if (ids.has(k)) return ids.get(k);
      const x = kx / 2, z = kz / 2;
      return vert(k, x, this.topY(x, z), z, 1);
    };
    const quadTri = (a, b, c, hint) => {
      // Wound to face along hint (from the blocky positions, before any were moved much).
      _a.fromArray(pos, a * 3); _b.fromArray(pos, b * 3); _c.fromArray(pos, c * 3);
      _n.subVectors(_b, _a).cross(_v.subVectors(_c, _a));
      if (_n.dot(hint) < 0) idx.push(a, c, b); else idx.push(a, b, c);
    };
    const UP = new THREE.Vector3(0, 1, 0);
    // Faces.
    const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let z = lo; z < hz; z++) {
      for (let x = lo; x < hx; x++) {
        if (!rock(x, z)) continue;
        // How thick the rock is here limits how far its faces may step back.
        const sc = f.S(x + 0.5, z + 0.5);
        const dmax = Math.max(0.1, sc - 0.12);
        thick.set(z * 10000 + x, sc);
        for (const [nx, nz] of DIRS) {
          if (rock(x + nx, z + nz)) continue;
          // The edge's three half-grid points, in order along it.
          const ex = nx === 1 ? x + 1 : x, ez = nz === 1 ? z + 1 : z;
          const tx = nz !== 0 ? 1 : 0, tz = nx !== 0 ? 1 : 0;
          const cols = [0, 1, 2].map((k) => [ex * 2 + tx * k, ez * 2 + tz * k]);
          const hint = new THREE.Vector3(nx, 0, nz);
          for (let c = 0; c < 2; c++) {
            for (let r = 0; r < ROWS; r++) {
              const a = faceVert(cols[c][0], cols[c][1], r, dmax), b = faceVert(cols[c + 1][0], cols[c + 1][1], r, dmax);
              const d = faceVert(cols[c][0], cols[c][1], r + 1, dmax), e = faceVert(cols[c + 1][0], cols[c + 1][1], r + 1, dmax);
              quadTri(a, b, e, hint);
              quadTri(a, e, d, hint);
            }
          }
        }
      }
    }
    // Tops: rim points come from the faces above; the rest follow the top surface.
    const fine = (x, z) => rock(x, z) && nearOpen(x, z);
    const tv = (kx, kz) => (rimPoint(kx, kz) ? ids.get(key(kx, kz, ROWS)) ?? topVert(kx, kz) : topVert(kx, kz));
    for (let z = lo; z < hz; z++) {
      for (let x = lo; x < hx; x++) {
        if (!rock(x, z)) continue;
        if (fine(x, z)) {
          for (let j = 0; j < 2; j++) {
            for (let i = 0; i < 2; i++) {
              const a = tv(x * 2 + i, z * 2 + j), b = tv(x * 2 + i + 1, z * 2 + j), c = tv(x * 2 + i + 1, z * 2 + j + 1), d = tv(x * 2 + i, z * 2 + j + 1);
              quadTri(a, b, c, UP);
              quadTri(a, c, d, UP);
            }
          }
          continue;
        }
        // A whole-tile cell, fanned out to the midpoints its finer neighbours share.
        const ring = [[0, 0]];
        if (fine(x, z - 1)) ring.push([1, 0]);
        ring.push([2, 0]);
        if (fine(x + 1, z)) ring.push([2, 1]);
        ring.push([2, 2]);
        if (fine(x, z + 1)) ring.push([1, 2]);
        ring.push([0, 2]);
        if (fine(x - 1, z)) ring.push([0, 1]);
        const vs = ring.map(([i, j]) => tv(x * 2 + i, z * 2 + j));
        if (vs.length === 4) {
          quadTri(vs[0], vs[1], vs[2], UP);
          quadTri(vs[0], vs[2], vs[3], UP);
        } else {
          const c = vert(-1 - (z * 10000 + x), x + 0.5, this.topY(x + 0.5, z + 0.5), z + 0.5, 1);
          for (let i = 0; i < vs.length; i++) quadTri(c, vs[i], vs[(i + 1) % vs.length], UP);
        }
      }
    }
    // Smooth normals over the welded mesh, then colour: a warm drift from tile to tile and the shade at the foot.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const N = geo.attributes.normal.array, C = new Float32Array(pos.length);
    const warm = lin(0xffd6c0), pale = lin(0xfff4e6), col = new THREE.Color();
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      col.copy(pale).lerp(warm, f.n2(x / 5.3 + 7, z / 5.3)).multiplyScalar(ao[i]);
      C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
    }
    for (let t = 0; t < idx.length; t += 3) this.rock.tri(pos, N, C, idx[t], idx[t + 1], idx[t + 2]);
    this.cliffStats = { vertices: pos.length / 3, triangles: idx.length / 3 };
  }

  // ---------------------------------------------------------------------------------------------------
  // Ruins

  /** Courses of chamfered blocks along every ruin wall tile, broken off at a wandering height. */
  ruins() {
    const f = this.field, lv = this.level, { w } = lv;
    const torches = new Set(lv.torch || []);
    const wall = (x, y) => this.tile(x, y) === TILE.WALL;
    const blockGeo = [0, 1, 2].map((k) => chamferBox(0.5, 0.5, 0.5, 0.035 + k * 0.012));
    const hn = valueNoise(f.seed + 41);
    const stoneCol = [0xf0d2a4, 0xe6c290, 0xf4dcb4, 0xdcb482, 0xe9c79a].map((c) => lin(c));
    const col = new THREE.Color();
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < w; x++) {
        if (!f.isBuilt(x, y)) continue;
        const W = wall(x - 1, y), E = wall(x + 1, y), N = wall(x, y - 1), S = wall(x, y + 1);
        const horiz = (W || E) && !(N || S), vert = (N || S) && !(W || E);
        let height = 0.55 + 1.9 * THREE.MathUtils.smoothstep(hn(x / 2.6, y / 2.6), 0.25, 0.8) + 0.25 * (this.rnd(x, y, 1) - 0.5);
        if (torches.has(y * w + x)) height = Math.max(height, 1.95);
        this.ruinH.set(y * w + x, height);
        const gy = this.world.heightAt(x + 0.5, y + 0.5) - 0.12;
        const courses = Math.max(1, Math.ceil(height / COURSE));
        const T = 0.86; // wall thickness
        for (let c = 0; c < courses; c++) {
          const yc = gy + c * COURSE;
          if (!horiz && !vert) {
            // A pier: one squared block per course.
            if (c === courses - 1 && this.rnd(x, y, 40 + c) < 0.3) continue;
            this.block(blockGeo, x + 0.5, yc, y + 0.5, T * 1.07, T * 1.07, 0, c, x, y, stoneCol, col);
            continue;
          }
          const L = 0.52 + 0.06 * this.rnd(x, y, 3);
          const off = (c % 2) * L * 0.5 + 0.13 * this.rnd(c, 5, 7);
          // Blocks run on into a neighbouring wall; at an open end they stop square with the tile.
          const minU = (vert ? N : W) ? -1 : 0, maxU = (vert ? S : E) ? 2 : 1;
          for (let k = -2; k < 4; k++) {
            let u0 = off + k * L, u1 = u0 + L;
            const mid = (u0 + u1) / 2;
            if (mid < 0 || mid >= 1) continue; // each block belongs to the tile its middle is on
            u0 = Math.max(u0, minU);
            u1 = Math.min(u1, maxU);
            // The top course is ragged; now and then a block has fallen out higher up.
            const at = vert ? hn(x / 2.6, (y + mid) / 2.6) : hn((x + mid) / 2.6, y / 2.6);
            const top = 0.55 + 1.9 * THREE.MathUtils.smoothstep(at, 0.25, 0.8) + 0.5 * (this.rnd(x * 4 + k, y, 9 + c) - 0.5);
            if ((c + 1) * COURSE > Math.max(top, torches.has(y * w + x) ? 1.95 : 0) + 0.2 && c > 0) continue;
            if (c >= 2 && this.rnd(x * 4 + k, y, 20 + c) < 0.07) continue;
            const len = u1 - u0;
            const cx = vert ? x + 0.5 : x + (u0 + u1) / 2, cz = vert ? y + (u0 + u1) / 2 : y + 0.5;
            this.block(blockGeo, cx, yc, cz, vert ? T : len, vert ? len : T, 0, c, x * 4 + k, y, stoneCol, col);
          }
        }
        // Fallen blocks at the foot of a broken stretch, half sunk in the sand.
        if (height < 1.25 && this.rnd(x, y, 50) < 0.45) {
          const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dy]) => !wall(x + dx, y + dy) && this.tile(x + dx, y + dy) !== TILE.WATER);
          if (dirs.length) {
            const [dx, dy] = dirs[Math.floor(this.rnd(x, y, 51) * dirs.length)];
            const along = (this.rnd(x, y, 52) - 0.5) * 0.6;
            const px = x + 0.5 + dx * 0.68 + dy * along, pz = y + 0.5 + dy * 0.68 + dx * along;
            const s = 0.36 + 0.1 * this.rnd(x, y, 53);
            col.copy(stoneCol[Math.floor(this.rnd(x, y, 54) * stoneCol.length)]);
            this.stone.add(blockGeo[1], xf(px, this.world.heightAt(px, pz) + s * 0.25, pz, (this.rnd(x, y, 55) - 0.5) * 0.7, this.rnd(x, y, 56) * 6.28, (this.rnd(x, y, 57) - 0.5) * 0.6, s * 1.3, s, s), col);
          }
        }
      }
    }
  }

  /** One block of masonry: footprint sx by sz centred at (x, z), from y up one course, a little askew. */
  block(geos, x, y, z, sx, sz, _unused, c, hx, hy, palette, col) {
    const r = (k) => this.rnd(hx, hy, 100 + c * 13 + k);
    col.copy(palette[Math.floor(r(0) * palette.length)]).multiplyScalar(0.88 + 0.2 * r(1));
    // Weathered lower courses are a little darker.
    if (c === 0) col.multiplyScalar(0.9);
    const gap = 0.022;
    this.stone.add(geos[Math.floor(r(2) * 3)], xf(x + (r(3) - 0.5) * 0.03, y + COURSE / 2, z + (r(4) - 0.5) * 0.03, 0, (r(5) - 0.5) * 0.05, 0,
      Math.max(0.1, sx - gap - r(6) * 0.03), COURSE - gap, Math.max(0.1, sz - gap - r(7) * 0.03)), col);
  }

  // ---------------------------------------------------------------------------------------------------
  // Scenery

  scenery() {
    const f = this.field, lv = this.level, { w, h } = lv;
    this.makeTemplates();
    const dense = this.quality.name === 'low' ? 0.6 : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = this.tile(x, y);
        const r = (k) => this.rnd(x, y, 200 + k);
        if (t === TILE.ROCK) {
          // Boulder tiles: mostly sandstone boulders, sometimes a monument.
          const v = r(0);
          if (v < 0.12) this.obelisk(x + 0.5, y + 0.5, r);
          else if (v < 0.24) this.columnGroup(x + 0.5, y + 0.5, r);
          else if (v < 0.34) this.colossus(x + 0.5, y + 0.5, r);
          else this.boulders(x + 0.5, y + 0.5, r, 1);
          continue;
        }
        if (t === TILE.WALL) {
          if (f.isBuilt(x, y)) continue;
          const s = f.S(x + 0.5, y + 0.5);
          // Hard against the foot of a cliff: boulders fallen from it, a monument now and then.
          const v = r(1);
          const spot = s < 0.75 && v < 0.25 ? this.footSpot(x, y, v < 0.16 ? 0.25 : v < 0.19 ? 0.42 : v < 0.22 ? 0.5 : 0.3) : null;
          if (spot) {
            if (v < 0.16 * dense) this.boulders(spot[0], spot[1], r, 0.6);
            else if (v < 0.16) continue;
            else if (v < 0.19) this.obelisk(spot[0], spot[1], r);
            else if (v < 0.22) this.colossus(spot[0], spot[1], r);
            else this.ribs(spot[0], spot[1], r);
          } else if (s > 2.4 && r(2) < 0.012) {
            this.arch(x + 0.5, y + 0.5, r);
          } else if (s > 1.2 && r(3) < 0.02 * dense) {
            this.hoodoo(x + 0.5, y + 0.5, r);
          } else if (s > 0.9 && r(4) < 0.05 * dense) {
            const px = x + r(5), pz = y + r(6);
            this.boulders(px, pz, r, 0.5, this.topY(px, pz) - 0.1);
          }
          continue;
        }
        if (t !== TILE.FLOOR) continue;
        // Open ground: only small things, and none on the tiles with props.
        if (this.used.has(y * w + x)) continue;
        const v = r(10);
        const mat = lv.mat ? lv.mat.charCodeAt(y * w + x) - 48 : 0;
        if (mat === 3) {
          if (v < 0.05) this.drums(x + r(11), y + r(12), r);
          else if (v < 0.11) this.pots(x + r(11), y + r(12), r, true);
          continue;
        }
        if (mat === 4) continue;
        if (v < 0.018 * dense) this.skull(x + r(11), y + r(12), r);
        else if (v < 0.03 * dense) this.bones(x + r(11), y + r(12), r);
        else if (v < 0.075 * dense) this.pebbles(x + r(11), y + r(12), r);
      }
    }
    this.ruinFurniture();
  }

  /** A spot against the cliff foot inside rock tile (x, y): [x, z] about `inset` into the rock, or null. */
  footSpot(x, y, inset = 0.25) {
    const spot = this.field.foot(x + 0.25 + 0.5 * this.rnd(x, y, 300), y + 0.25 + 0.5 * this.rnd(x, y, 301), inset);
    return spot && this.tile(Math.floor(spot[0]), Math.floor(spot[1])) === TILE.WALL ? spot : null;
  }

  groundY(x, z) {
    return this.world.heightAt(x, z);
  }

  makeTemplates() {
    // Bull skull: a long cranium, the snout, eye sockets and two horns sweeping out and up.
    const skull = [];
    const add = (geo, m, c) => skull.push([geo.index ? geo.toNonIndexed() : geo, m.clone(), c]);
    add(new THREE.SphereGeometry(0.5, 8, 6), xf(0, 0.14, -0.05, 0, 0, 0, 0.17, 0.12, 0.2), 1);
    add(new THREE.CylinderGeometry(0.06, 0.09, 0.32, 6), xf(0, 0.1, 0.18, Math.PI / 2 - 0.25, 0, 0, 1), 1);
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.035, 5, 4), xf(sx * 0.07, 0.17, 0.07, 0, 0, 0, 1), 0.25);
      const horn = new THREE.TorusGeometry(0.16, 0.03, 4, 7, Math.PI * 0.6);
      add(horn, xf(sx * 0.13, 0.2, -0.12, 0, sx > 0 ? 0 : Math.PI, 0.6, 1, 1, 1), 0.85);
    }
    this.skullParts = skull;
    this.pebble = [0, 1, 2].map((k) => boulder(70 + k, 0));
    this.rocks = [0, 1, 2, 3].map((k) => boulder(40 + k, 1));
  }

  skull(x, z, r) {
    const y = this.groundY(x, z);
    const yaw = r(20) * 6.28, s = 0.75 + 0.4 * r(21);
    _m.copy(xf(x, y - 0.02, z, (r(22) - 0.5) * 0.4, yaw, (r(23) - 0.5) * 0.3, s));
    const base = _m.clone();
    for (const [geo, m, k] of this.skullParts) {
      this.bone.add(geo, base.clone().multiply(m), lin(0xf2ead8, k));
    }
  }

  bones(x, z, r) {
    const bone = this.boneGeo || (this.boneGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.4, 5).toNonIndexed());
    for (let i = 0; i < 3; i++) {
      const px = x + (r(30 + i) - 0.5) * 0.4, pz = z + (r(33 + i) - 0.5) * 0.4;
      this.bone.add(bone, xf(px, this.groundY(px, pz) + 0.01, pz, Math.PI / 2, r(36 + i) * 6.28, 0, 1, 0.6 + 0.6 * r(39 + i), 1), lin(0xeee4d0));
    }
  }

  pebbles(x, z, r) {
    for (let i = 0; i < 2 + Math.floor(r(40) * 3); i++) {
      const px = x + (r(41 + i) - 0.5) * 0.7, pz = z + (r(46 + i) - 0.5) * 0.7, s = 0.04 + 0.07 * r(51 + i);
      this.rock.add(this.pebble[i % 3], xf(px, this.groundY(px, pz) + s * 0.2, pz, 0, r(56 + i) * 6.28, 0, s, s * 0.7, s * 1.2), lin(0xffe2c8, 0.9 + 0.2 * r(60 + i)));
    }
  }

  /** One to three sandstone boulders, scale k, sitting at y (default: on the sand). */
  boulders(x, z, r, k, y) {
    const n = 1 + Math.floor(r(70) * 3);
    for (let i = 0; i < n; i++) {
      const s = k * (i === 0 ? 0.45 + 0.3 * r(71) : 0.2 + 0.2 * r(72 + i));
      const a = r(75 + i) * 6.28, d = i === 0 ? 0 : s + 0.25;
      const px = x + Math.cos(a) * d * 0.8, pz = z + Math.sin(a) * d * 0.8;
      const gy = y ?? this.groundY(px, pz);
      this.rock.add(this.rocks[(i + Math.floor(r(78) * 4)) & 3], xf(px, gy + s * 0.35, pz, (r(80 + i) - 0.5) * 0.4, r(83 + i) * 6.28, 0, s * 1.15, s, s), lin(0xffe8d4, 0.9 + 0.15 * r(86 + i)));
    }
  }

  obelisk(x, z, r) {
    const geo = this.obeliskGeo || (this.obeliskGeo = (() => {
      const shaft = new THREE.CylinderGeometry(0.2, 0.3, 3.0, 4, 1).toNonIndexed();
      shaft.rotateY(Math.PI / 4);
      shaft.translate(0, 1.5, 0);
      const tip = new THREE.ConeGeometry(0.2, 0.34, 4).toNonIndexed();
      tip.rotateY(Math.PI / 4);
      tip.translate(0, 3.17, 0);
      const base = chamferBox(0.42, 0.14, 0.42, 0.03);
      base.translate(0, 0.08, 0);
      return [shaft, tip, base];
    })());
    const y = this.groundY(x, z) - 0.15 - 0.6 * r(90);
    const m = xf(x, y, z, (r(91) - 0.5) * 0.12, r(92) * 1.57, (r(93) - 0.5) * 0.12, 0.9 + 0.25 * r(94)).clone();
    this.stone.add(geo[0], m, lin(0xe9cfa4));
    this.stone.add(geo[1], m, lin(0xc79c5a));
    this.stone.add(geo[2], m, lin(0xdcbf94));
  }

  /** A broken column, fluted, with drums toppled beside it when there is room. */
  columnGroup(x, z, r) {
    const shaft = this.colGeo || (this.colGeo = (() => {
      const g = new THREE.CylinderGeometry(0.21, 0.24, 1, 16, 4, false).toNonIndexed();
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i);
        const a = Math.atan2(_v.z, _v.x), rr = Math.hypot(_v.x, _v.z);
        const k = rr < 0.05 ? 1 : 1 - 0.05 * (0.5 + 0.5 * Math.cos(a * 16));
        P.setXYZ(i, _v.x * k, _v.y + 0.5, _v.z * k);
      }
      g.computeVertexNormals();
      return g;
    })());
    const base = this.plinth || (this.plinth = chamferBox(0.33, 0.1, 0.33, 0.025));
    const y = this.groundY(x, z);
    const hgt = 0.9 + 1.8 * r(100);
    this.stone.add(base, xf(x, y + 0.04, z, 0, r(101), 0, 1), lin(0xdcc29a));
    // The break: the top is cut at a slant.
    const m = xf(x, y + 0.12, z, (r(102) - 0.5) * 0.05, r(103) * 6.28, (r(104) - 0.5) * 0.05, 1, hgt, 1).clone();
    const slant = (r(105) - 0.5) * 0.5;
    this.stone.add(shaft, m, null, (c, lx, ly, lz) => c.copy(lin(0xead2aa)).multiplyScalar(ly > 0.98 ? 0.8 : 1 - 0.1 * (1 - ly)));
    if (hgt < 1.6) this.drums(x + 0.6, z + 0.3, r, slant);
  }

  /** Column drums lying on the ground. */
  drums(x, z, r) {
    const g = this.drumGeo || (this.drumGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.45, 14).toNonIndexed());
    const n = 1 + Math.floor(r(110) * 2);
    for (let i = 0; i < n; i++) {
      const px = x + (r(111 + i) - 0.5) * 0.5, pz = z + (r(114 + i) - 0.5) * 0.5;
      this.stone.add(g, xf(px, this.groundY(px, pz) + 0.14, pz, Math.PI / 2 + (r(117 + i) - 0.5) * 0.2, r(120 + i) * 6.28, 0, 0.9, 1, 0.9), lin(0xe4caa0, 0.9 + 0.15 * r(123 + i)));
    }
  }

  /**
   * A colossal pharaoh's head half sunk in the sand and tipped back: the face, the striped nemes
   * headdress flaring to its lappets, the false beard.
   */
  colossus(x, z, r) {
    const parts = this.headParts || (this.headParts = (() => {
      const out = [];
      const P = (geo, m, col, fn) => out.push([geo.index ? geo.toNonIndexed() : geo, m.clone(), col, fn]);
      const stripe = (c, lx, ly) => c.copy(Math.floor(ly * 9 + 20) % 2 ? lin(0xc8a060) : lin(0x6a7a8a)).multiplyScalar(0.95);
      // Headdress: a flaring frustum behind the face, with lappets down the sides.
      const nemes = new THREE.CylinderGeometry(0.42, 0.62, 1.0, 6, 3);
      P(nemes, xf(0, 0.95, -0.1, 0, 0, 0, 1, 1, 0.85), null, stripe);
      for (const s of [-1, 1]) P(new THREE.BoxGeometry(0.22, 0.75, 0.16, 1, 4, 1), xf(s * 0.42, 0.45, 0.18, 0, 0, s * 0.08, 1), null, stripe);
      P(new THREE.SphereGeometry(0.44, 10, 8), xf(0, 1.4, -0.12, 0, 0, 0, 1, 0.5, 0.95), null, stripe);
      // Face, nose, brow and beard.
      P(new THREE.SphereGeometry(0.38, 12, 10), xf(0, 0.95, 0.12, 0, 0, 0, 0.9, 1.1, 0.8), lin(0xe2c49a));
      P(new THREE.ConeGeometry(0.08, 0.26, 4), xf(0, 0.92, 0.47, -0.25, Math.PI / 4, 0, 1, 1, 0.7), lin(0xd8b88c));
      P(new THREE.BoxGeometry(0.5, 0.07, 0.12), xf(0, 1.1, 0.4, 0, 0, 0, 1), lin(0xc8a87c));
      P(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 6), xf(0, 0.5, 0.36, 0.2, 0, 0, 1), lin(0x7a6a58));
      return out;
    })());
    const s = 1.25 + 0.5 * r(130);
    const base = xf(x, this.groundY(x, z) - 0.55 * s, z, -0.35 - 0.3 * r(131), r(132) * 6.28, (r(133) - 0.5) * 0.5, s).clone();
    for (const [geo, m, col, fn] of parts) this.stone.add(geo, base.clone().multiply(m), col, fn);
  }

  /** The rib cage of a long-dead beast, half buried. */
  ribs(x, z, r) {
    const rib = this.ribGeo || (this.ribGeo = new THREE.TorusGeometry(0.32, 0.025, 4, 9, Math.PI * 0.85).toNonIndexed());
    const spine = this.spineGeo || (this.spineGeo = new THREE.CylinderGeometry(0.035, 0.03, 1.3, 5).toNonIndexed());
    const yaw = r(140) * 6.28, y = this.groundY(x, z) - 0.06;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    this.bone.add(spine, xf(x, y + 0.3, z, Math.PI / 2, yaw, 0, 1), lin(0xeee4cf));
    for (let i = 0; i < 6; i++) {
      const t = (i - 2.5) * 0.19;
      const k = 1 - Math.abs(i - 2.2) * 0.1;
      this.bone.add(rib, xf(x + sa * t, y + 0.3, z + ca * t, 0, yaw + Math.PI / 2, Math.PI * 1.07, k), lin(0xf2e8d4, 0.9 + 0.1 * r(141 + i)));
    }
  }

  /** A natural arch on a broad ridge top: a lumpy curve of rock with its feet in the ridge. */
  arch(x, z, r) {
    const span = 1.4 + 0.8 * r(150), thick = 0.42 + 0.15 * r(151);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-span, -0.6, 0), new THREE.Vector3(-span * 0.95, 1.2, 0), new THREE.Vector3(-span * 0.5, 2.2, 0),
      new THREE.Vector3(0, 2.45, 0), new THREE.Vector3(span * 0.5, 2.2, 0), new THREE.Vector3(span * 0.95, 1.2, 0), new THREE.Vector3(span, -0.6, 0),
    ]);
    let geo = new THREE.TubeGeometry(curve, 20, thick, 7, false);
    const n = valueNoise(160 + Math.floor(r(152) * 100));
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      const k = (n(_v.x * 2.1 + 4, _v.y * 2.1 + _v.z * 1.7 + 4) - 0.5) * 0.35;
      P.setXYZ(i, _v.x * (1 + k * 0.15), _v.y + k * 0.3, _v.z * (1 + k * 1.2));
    }
    geo.computeVertexNormals();
    geo = geo.toNonIndexed();
    const yaw = r(153) * 3.14;
    const y = this.topY(x, z) - 0.1;
    this.rock.add(geo, xf(x, y, z, 0, yaw, 0, 1, 1, 1.35), lin(0xffe0c8));
  }

  /** A hoodoo: a pillar of soft rock capped by a harder block. */
  hoodoo(x, z, r) {
    const hgt = 1.2 + 1.4 * r(160);
    const y = this.topY(x, z) - 0.2;
    const stem = this.stemGeo || (this.stemGeo = (() => {
      const g = new THREE.CylinderGeometry(0.22, 0.42, 1, 7, 5).toNonIndexed();
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i);
        const k = 1 + 0.18 * Math.sin(_v.y * 9) - 0.1 * Math.cos(Math.atan2(_v.z, _v.x) * 3);
        P.setXYZ(i, _v.x * k, _v.y + 0.5, _v.z * k);
      }
      g.computeVertexNormals();
      return g;
    })());
    this.rock.add(stem, xf(x, y, z, 0, r(161) * 6, 0, 1, hgt, 1), lin(0xffd8bc));
    this.rock.add(this.rocks[Math.floor(r(162) * 4)], xf(x, y + hgt + 0.12, z, (r(163) - 0.5) * 0.3, r(164) * 6, 0, 0.45, 0.28, 0.4), lin(0xe8c8a8));
  }

  /** Clay pots and amphorae, a broken one among them. */
  pots(x, z, r, small) {
    const shapes = this.potGeo || (this.potGeo = [
      lathe([[0, 0], [0.12, 0.02], [0.2, 0.14], [0.21, 0.28], [0.15, 0.42], [0.08, 0.5], [0.09, 0.56], [0, 0.56]], 10),
      lathe([[0, 0], [0.05, 0.02], [0.16, 0.2], [0.18, 0.42], [0.1, 0.62], [0.06, 0.7], [0.07, 0.8], [0, 0.8]], 10),
      lathe([[0, 0], [0.15, 0.01], [0.24, 0.12], [0.24, 0.2], [0.18, 0.3], [0, 0.3]], 10),
    ]);
    const n = small ? 1 + Math.floor(r(170) * 2) : 2 + Math.floor(r(170) * 3);
    for (let i = 0; i < n; i++) {
      const px = x + (r(171 + i) - 0.5) * 0.5, pz = z + (r(175 + i) - 0.5) * 0.5;
      const tip = r(179 + i) < 0.25 ? 1.3 : 0;
      const k = 0.75 + 0.35 * r(183 + i);
      this.clay.add(shapes[i % 3], xf(px, this.groundY(px, pz) - 0.03 + (tip ? 0.15 : 0), pz, tip, r(187 + i) * 6.28, 0, k), null,
        (c, lx, ly) => c.copy(lin(r(191) < 0.5 ? 0xb8673e : 0xc98a58)).multiplyScalar((Math.floor(ly * 14) % 5 === 2 ? 0.6 : 1) * (0.85 + 0.15 * r(192 + i))));
    }
  }

  /**
   * Inside each ruin: sarcophagi and pots at the foot of its walls, banners on the walls. A ruin room is
   * a run of paving (mat 3) floor tiles next to built walls.
   */
  ruinFurniture() {
    const f = this.field, lv = this.level, { w, h } = lv;
    const banner = this.world.assets.piece('dungeon', 'banner_patternA_red') || this.world.assets.piece('dungeon', 'banner_red');
    let banners = 0, coffins = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (this.tile(x, y) !== TILE.FLOOR || (lv.mat && lv.mat.charCodeAt(y * w + x) - 48 !== 3) || this.used.has(y * w + x)) continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (!f.isBuilt(x + dx, y + dy)) continue;
          const r = (k) => this.rnd(x * 4 + dx + 2, y * 4 + dy + 2, 400 + k);
          // Facing into the room, back against the wall.
          const yaw = Math.atan2(-dx, -dy);
          const px = x + 0.5 + dx * 0.24, pz = y + 0.5 + dy * 0.24;
          if (r(0) < 0.09 && coffins < 6) {
            this.sarcophagus(x + 0.5 + dx * 0.3, y + 0.5 + dy * 0.3, yaw + Math.PI / 2, r);
            coffins++;
          } else if (r(1) < 0.12) {
            this.pots(px, pz, r, true);
          } else if (banner && r(2) < 0.14 && banners < 8 && (this.ruinH.get((y + dy) * w + x + dx) || 0) > 1.85 && !(lv.torch || []).includes((y + dy) * w + x + dx)) {
            const b = banner.clone(true);
            b.traverse((o) => {
              if (o.isMesh) {
                o.material = this.bannerMat || (this.bannerMat = o.material.clone());
                this.bannerMat.color.setHex(0xffd890);
              }
            });
            const box = new THREE.Box3().setFromObject(b), k = 1.1 / (box.max.y - box.min.y);
            b.scale.setScalar(k);
            // Back against the wall face (0.57 from this tile's centre), hanging from just under its top.
            b.position.set(x + 0.5 + dx * (0.56 + box.min.z * k), this.groundY(x + 0.5, y + 0.5) + 1.7 - box.max.y * k, y + 0.5 + dy * (0.56 + box.min.z * k));
            b.rotation.y = yaw;
            this.world.group.add(b);
            banners++;
          }
          break;
        }
      }
    }
  }

  /** A painted sarcophagus: a gilded body with blue bands and a lid. */
  sarcophagus(x, z, yaw, r) {
    const body = this.coffinGeo || (this.coffinGeo = chamferBox(0.42, 0.2, 0.22, 0.03));
    const lid = this.lidGeo || (this.lidGeo = chamferBox(0.44, 0.05, 0.24, 0.03));
    const y = this.groundY(x, z);
    const m = xf(x, y + 0.2, z, 0, yaw, 0, 1).clone();
    const bands = (c, lx) => c.copy(Math.abs(Math.floor(lx * 9 + 10)) % 3 === 0 ? lin(0x2a4a8a) : lin(0xc89a3a));
    this.stone.add(body, m, null, bands);
    const open = r(5) < 0.4;
    const ml = xf(x + (open ? 0.12 : 0), y + 0.45 + (open ? -0.02 : 0), z + (open ? 0.1 : 0), 0, yaw + (open ? 0.35 : 0), open ? 0.06 : 0, 1).clone();
    this.stone.add(lid, ml, null, bands);
  }
}

/** Builds the desert's ridges, ruins and scenery into world.group (see the top of this file). */
export function buildDesert(world) {
  const b = new DesertBuilder(world);
  b.build();
  world.desertStats = b.cliffStats;
}

/** Per frame: the sand's clock, wind and daylight. */
export function updateDesert(world, f, t) {
  SAND.uTime.value = t % 1000;
  SAND.uDay.value = f.dl;
}
