import * as THREE from 'three';
import { applyOcclusion } from './occlude.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { TILE, hash } from './defs.js';

const simplex = new SimplexNoise({ random: mulberry(7) });

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

function trunk(rng, height, r0, r1, bark) {
  let geo = new THREE.CylinderGeometry(r1, r0, height, 9, 6, true);
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
function broadleaf(seed, opts = {}) {
  const rng = mulberry(seed);
  const height = opts.height || 1.35;
  const parts = [trunk(rng, height + 0.4, 0.13, 0.07, opts.bark || [0.27, 0.2, 0.14])];
  const crownY = height + 0.55;
  const R = opts.radius || 0.95;
  const leaf = new THREE.Color(opts.leaf || 0x3f6b22);
  const clusters = opts.clusters || 13;
  for (let k = 0; k < clusters; k++) {
    const a = rng() * Math.PI * 2, el = (rng() - 0.35) * 1.2;
    const d = R * (0.35 + 0.55 * rng());
    const cx = Math.cos(a) * Math.cos(el) * d, cz = Math.sin(a) * Math.cos(el) * d, cy = crownY + Math.sin(el) * d * 0.6;
    const r = (0.33 + 0.22 * rng()) * R;
    let geo = new THREE.IcosahedronGeometry(r, 3);
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
function conifer(seed, opts = {}) {
  const rng = mulberry(seed);
  const height = opts.height || 2.6;
  const parts = [trunk(rng, height * 0.5, 0.1, 0.06, [0.28, 0.18, 0.11])];
  const tiers = 7;
  const green = new THREE.Color(opts.color || 0x1d4a26);
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = (1 - f) * 0.75 + 0.14;
    const h = 0.55 - f * 0.15;
    const y = 0.35 + f * (height - 0.6);
    let geo = new THREE.ConeGeometry(r, h, 11, 2, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      if (vy < -h / 2 + 0.01) {
        const x = pos.getX(i), z = pos.getZ(i);
        const jag = 0.75 + 0.45 * rng();
        pos.setXYZ(i, x * jag, vy - 0.12 * jag * r, z * jag);
      }
    }
    geo.translate(0, y + h / 2, 0);
    geo.rotateY(rng() * 6.28);
    geo = lumpy(geo, 0.05, 5, seed + k);
    parts.push(paint(geo, (c, x, vy, z) => {
      const tip = Math.min(1, Math.hypot(x, z) / r);
      c.copy(green).multiplyScalar(0.55 + 0.5 * tip + 0.1 * f).offsetHSL(0, 0, (rng() - 0.5) * 0.03);
    }));
  }
  return mergeGeometries(parts);
}

function deadTree(seed) {
  const rng = mulberry(seed);
  const parts = [trunk(rng, 1.7, 0.13, 0.05, [0.3, 0.27, 0.23])];
  for (let k = 0; k < 5; k++) {
    let g = new THREE.CylinderGeometry(0.015, 0.045, 0.7, 6, 3, true);
    g.translate(0, 0.35, 0);
    g.rotateZ(0.6 + rng() * 0.6);
    g.rotateY(rng() * 6.28);
    g.translate(0, 0.7 + k * 0.2, 0);
    g = lumpy(g, 0.012, 8, k);
    parts.push(paint(g, (c) => c.setRGB(0.3, 0.27, 0.23)));
  }
  return mergeGeometries(parts);
}

function shrub(seed) {
  const rng = mulberry(seed);
  const parts = [];
  for (let k = 0; k < 6; k++) {
    let g = new THREE.IcosahedronGeometry(0.22 + rng() * 0.12, 2);
    g.translate((rng() - 0.5) * 0.5, 0.2 + rng() * 0.15, (rng() - 0.5) * 0.5);
    g = lumpy(g, 0.05, 6, k);
    parts.push(paint(g, (c, x, y) => c.setHex(0x335f22).multiplyScalar(0.55 + y)));
  }
  for (let k = 0; k < 10; k++) {
    const g = clean(new THREE.IcosahedronGeometry(0.035, 0));
    g.translate((rng() - 0.5) * 0.6, 0.3 + rng() * 0.2, (rng() - 0.5) * 0.6);
    parts.push(paint(g, (c) => c.setHex(0xb01c22)));
  }
  return mergeGeometries(parts);
}

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

function grassTuft(rng) {
  const parts = [];
  const blades = 9;
  for (let b = 0; b < blades; b++) {
    const h = 0.16 + rng() * 0.2;
    const w = 0.022 + rng() * 0.015;
    const a = rng() * Math.PI * 2;
    const lean = 0.08 + rng() * 0.18;
    const ox = (rng() - 0.5) * 0.22, oz = (rng() - 0.5) * 0.22;
    const verts = [-w, 0, 0, w, 0, 0, -w * 0.55, h * 0.55, lean * 0.4, w * 0.55, h * 0.55, lean * 0.4, 0, h, lean];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    g.rotateY(a);
    g.translate(ox, 0, oz);
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, nor.getX(i) * 0.3, 1, nor.getZ(i) * 0.3);
    g.normalizeNormals();
    parts.push(paint(g.toNonIndexed(), (c, x, y) => {
      const t = y / h;
      c.setRGB(0.07 + 0.2 * t, 0.15 + 0.3 * t, 0.04 + 0.08 * t);
    }));
  }
  return mergeGeometries(parts);
}

/** Every tree, bush, grass tuft, flower and log of the overworld as a handful of instanced meshes. */
export class Flora {
  constructor(level, ground, quality) {
    this.level = level;
    this.ground = ground;
    this.quality = quality;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
    this.group = new THREE.Group();
  }

  build() {
    const lv = this.level;
    const varOf = (i) => parseInt(lv.var.substr(i * 2, 2), 16) / 255;
    // Tree kinds: 0-2 broadleaf, 3-4 conifer, 5 birch-ish, 6 dead, 7 shrub.
    const kinds = [
      broadleaf(1), broadleaf(2, { radius: 1.05, leaf: 0x4a7428 }), broadleaf(3, { radius: 0.85, leaf: 0x56692a, height: 1.2 }),
      conifer(4), conifer(5, { height: 3.0, color: 0x1a4024 }),
      broadleaf(6, { radius: 0.7, height: 1.6, leaf: 0x7a8a2c, bark: [0.78, 0.76, 0.7], clusters: 10 }),
      deadTree(7), shrub(8),
    ];
    const treeMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 0.12, this.uniforms, true);
    const buckets = kinds.map(() => []);
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
        buckets[k].push({ x: x + 0.5 + (hash(x, y, 3) - 0.5) * 0.4, z: y + 0.6 + (hash(x, y, 4) - 0.5) * 0.3, s, r: hash(x, y, 5) * 6.28 });
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    kinds.forEach((geo, k) => {
      const list = buckets[k];
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, treeMat, list.length);
      list.forEach((t, j) => {
        q.setFromAxisAngle(up, t.r);
        m.compose(new THREE.Vector3(t.x, this.ground.heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        mesh.setMatrixAt(j, m);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    });
    this.buildGrass();
    this.buildPalisade();
    return this.group;
  }

  /** Grass tufts over grassy ground, in chunks so the camera only draws what is near. */
  buildGrass() {
    const lv = this.level;
    const rng = mulberry(11);
    const tufts = [grassTuft(rng), grassTuft(rng), grassTuft(rng)];
    const dryTint = [0.62, 0.55, 0.3];
    const mat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 1.6, this.uniforms);
    const density = this.quality.grass;
    const CH = 8;
    const flowerGeo = new THREE.IcosahedronGeometry(0.035, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const flowerColors = [0xf4f1ea, 0xf7d23a, 0x7d7af0, 0xd8322a, 0xe98ad8];
    const grassy = (m) => m === 0 || m === 1 || m === 2;
    for (let cy = 0; cy < lv.h; cy += CH) {
      for (let cx = 0; cx < lv.w; cx += CH) {
        const items = [[], [], []];
        const flowers = [];
        for (let y = cy; y < Math.min(lv.h, cy + CH); y++) {
          for (let x = cx; x < Math.min(lv.w, cx + CH); x++) {
            const i = y * lv.w + x;
            const t = lv.tiles.charCodeAt(i) - 48;
            if (t !== TILE.FLOOR && t !== TILE.TREE) continue;
            const mt = lv.mat.charCodeAt(i) - 48;
            if (!grassy(mt)) continue;
            const n = Math.round((mt === 2 ? 1.5 : mt === 1 ? 4 : 5) * density * (0.6 + hash(x, y, 9) * 0.8));
            for (let k = 0; k < n; k++) {
              const px = x + hash(x * 7 + k, y, 1), pz = y + hash(x, y * 7 + k, 2);
              items[k % 3].push([px, pz, hash(x + k, y, 3) * 6.28, 0.5 + hash(x, y + k, 4) * 0.45, mt === 1]);
            }
            if (mt === 0 && hash(x, y, 21) < 0.18 * density) {
              const col = flowerColors[Math.floor(hash(x >> 2, y >> 2, 22) * flowerColors.length)];
              for (let k = 0; k < 6; k++) flowers.push([x + hash(x, y, 30 + k), y + hash(x, y, 40 + k), col]);
            }
          }
        }
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        items.forEach((list, k) => {
          if (!list.length) return;
          const mesh = new THREE.InstancedMesh(tufts[k], mat, list.length);
          list.forEach(([x, z, r, s, dry], j) => {
            q.setFromAxisAngle(up, r);
            m.compose(new THREE.Vector3(x, this.ground.heightAt(x, z), z), q, new THREE.Vector3(s, s * (dry ? 1.25 : 1), s));
            mesh.setMatrixAt(j, m);
            mesh.setColorAt(j, dry ? c.setRGB(dryTint[0] * 1.6, dryTint[1] * 1.5, dryTint[2] * 1.4) : c.setRGB(0.85 + hash(j, k) * 0.3, 1, 0.85));
          });
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          this.group.add(mesh);
        });
        if (flowers.length) {
          const mesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowers.length);
          flowers.forEach(([x, z, col], j) => {
            m.makeTranslation(x, this.ground.heightAt(x, z) + 0.2 + hash(j, 3) * 0.08, z);
            mesh.setMatrixAt(j, m);
            mesh.setColorAt(j, c.setHex(col));
          });
          mesh.computeBoundingSphere();
          this.group.add(mesh);
        }
      }
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
  }
}
