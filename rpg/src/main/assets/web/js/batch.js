import * as THREE from 'three';

// Static level geometry, batched: every kit piece and procedural mesh that never changes is baked into
// world space and merged per material and shadow flags, in square chunks of the level so frustum culling
// (main view and shadow map) still drops what is out of sight.
const CHUNK = 16; // tiles per side of a chunk
const MAX_EXTENT = CHUNK * 2; // level-sized meshes (ground, walls) are one draw already and stay as they are
const ATTRIBUTES = new Set(['position', 'normal', 'uv', 'color']);
const SHAREABLE = new Set(['MeshStandardMaterial', 'MeshLambertMaterial', 'MeshBasicMaterial']);
// Everything that tells two materials apart in look or in render state.
const MATERIAL_PROPS = [
  'map', 'color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'vertexColors', 'transparent', 'side',
  'opacity', 'alphaTest', 'alphaHash', 'alphaToCoverage', 'blending', 'shadowSide', 'flatShading', 'wireframe', 'fog',
  'toneMapped', 'depthTest', 'depthWrite', 'colorWrite', 'stencilWrite', 'polygonOffset', 'polygonOffsetFactor',
  'polygonOffsetUnits', 'premultipliedAlpha', 'dithering', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap',
  'normalMapType', 'normalScale', 'bumpMap', 'bumpScale', 'displacementMap', 'displacementScale', 'displacementBias',
  'aoMap', 'aoMapIntensity', 'lightMap', 'lightMapIntensity', 'alphaMap', 'envMap', 'envMapIntensity', 'envMapRotation',
  'specularMap', 'reflectivity', 'refractionRatio', 'combine',
];
const BASE_MATERIAL = THREE.Material.prototype;
const BASE_OBJECT = THREE.Object3D.prototype;

const tmpBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpSize = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpNormal = new THREE.Matrix3();

/** Materials that look the same share one key; anything with custom shader code only matches itself. */
function materialKey(m) {
  if (!SHAREABLE.has(m.type) || m.onBeforeCompile !== BASE_MATERIAL.onBeforeCompile
    || m.customProgramCacheKey !== BASE_MATERIAL.customProgramCacheKey || m.clippingPlanes) return m.uuid;
  let key = m.type;
  for (const p of MATERIAL_PROPS) {
    const v = m[p];
    if (v === undefined) continue;
    key += '|' + (v === null ? '-' : v.isTexture ? v.uuid : v.isColor ? `${v.r},${v.g},${v.b}` : v.isVector2 ? `${v.x},${v.y}` : v.isEuler ? `${v.x},${v.y},${v.z}` : v);
  }
  return key;
}

function opaque(m) {
  return m && m.visible && !m.transparent && m.blending === THREE.NormalBlending;
}

/** A plain, untouched-by-code triangle mesh with only the attributes the merge knows. */
function batchable(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || !o.frustumCulled) return false;
  if (o.onBeforeRender !== BASE_OBJECT.onBeforeRender || o.onAfterRender !== BASE_OBJECT.onAfterRender
    || o.onBeforeShadow !== BASE_OBJECT.onBeforeShadow) return false;
  const geo = o.geometry;
  if (!geo || !geo.isBufferGeometry || !geo.attributes.position || !geo.attributes.normal) return false;
  for (const name in geo.attributes) if (!ATTRIBUTES.has(name)) return false;
  for (const name in geo.morphAttributes) if (geo.morphAttributes[name].length) return false;
  return Array.isArray(o.material) ? o.material.every(opaque) : opaque(o.material);
}

/** The index or vertex range [start, end) a part of the geometry draws. */
function range(geo, start, count) {
  const total = geo.index ? geo.index.count : geo.attributes.position.count;
  const a = Math.max(0, start, geo.drawRange.start);
  const b = Math.min(total, start + count, geo.drawRange.start + geo.drawRange.count);
  return [a, b - (b - a) % 3];
}

/** One world-space geometry from the parts: positions, normals and, when any part has them, uvs and colours. */
function merge(parts, vertexColors) {
  let nv = 0, ni = 0, hasUv = false, colorSize = 0;
  for (const p of parts) {
    const geo = p.geo, attr = geo.attributes;
    if (geo.index) {
      let lo = Infinity, hi = -1;
      for (let i = p.a; i < p.b; i++) {
        const v = geo.index.getX(i);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      p.v0 = lo;
      p.nv = hi - lo + 1;
    } else {
      p.v0 = p.a;
      p.nv = p.b - p.a;
    }
    nv += p.nv;
    ni += p.b - p.a;
    if (attr.uv) hasUv = true;
    if (vertexColors && attr.color) colorSize = Math.max(colorSize, attr.color.itemSize);
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const uv = hasUv ? new Float32Array(nv * 2) : null;
  const col = colorSize ? new Float32Array(nv * colorSize).fill(1) : null;
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const attr = p.geo.attributes, index0 = p.geo.index;
    tmpNormal.getNormalMatrix(p.matrix);
    for (let i = 0; i < p.nv; i++) {
      const s = p.v0 + i, d = vo + i;
      tmpVec.fromBufferAttribute(attr.position, s).applyMatrix4(p.matrix);
      pos[d * 3] = tmpVec.x;
      pos[d * 3 + 1] = tmpVec.y;
      pos[d * 3 + 2] = tmpVec.z;
      tmpVec.fromBufferAttribute(attr.normal, s).applyMatrix3(tmpNormal).normalize();
      nor[d * 3] = tmpVec.x;
      nor[d * 3 + 1] = tmpVec.y;
      nor[d * 3 + 2] = tmpVec.z;
      if (uv && attr.uv) {
        uv[d * 2] = attr.uv.getX(s);
        uv[d * 2 + 1] = attr.uv.getY(s);
      }
      if (col && attr.color) {
        col[d * colorSize] = attr.color.getX(s);
        col[d * colorSize + 1] = attr.color.getY(s);
        col[d * colorSize + 2] = attr.color.getZ(s);
        if (colorSize === 4 && attr.color.itemSize === 4) col[d * 4 + 3] = attr.color.getW(s);
      }
    }
    // A mirrored piece turns its triangles around, so they keep facing the way they did.
    const flip = p.matrix.determinant() < 0;
    for (let i = p.a; i < p.b; i += 3) {
      const v0 = index0 ? index0.getX(i) : i, v1 = index0 ? index0.getX(i + 1) : i + 1, v2 = index0 ? index0.getX(i + 2) : i + 2;
      index[io++] = vo + v0 - p.v0;
      index[io++] = vo + (flip ? v2 : v1) - p.v0;
      index[io++] = vo + (flip ? v1 : v2) - p.v0;
    }
    vo += p.nv;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, colorSize));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Takes a mesh out of the level; children it still holds move to a bare stand-in with its transform. */
function detach(o, root) {
  let parent = o.parent;
  if (!parent) return;
  if (o.children.length) {
    const stand = new THREE.Object3D();
    stand.name = o.name;
    stand.position.copy(o.position);
    stand.quaternion.copy(o.quaternion);
    stand.scale.copy(o.scale);
    stand.matrixAutoUpdate = o.matrixAutoUpdate;
    stand.matrix.copy(o.matrix);
    stand.userData = o.userData;
    while (o.children.length) stand.add(o.children[0]);
    parent.add(stand);
  }
  parent.remove(o);
  // Holders left empty go too, so the scene graph walked every frame stays small.
  while (parent !== root && !parent.children.length && !parent.userData.dynamic && (parent.type === 'Group' || parent.type === 'Object3D')) {
    const up = parent.parent;
    up.remove(parent);
    parent = up;
  }
}

/**
 * Merges the static meshes under the world group into a few chunked draws and removes the originals.
 * Skips instanced, skinned, transparent and additive meshes, sprites, points and lines, custom vertex
 * attributes and anything flagged userData.dynamic or userData.noBatch on itself or an ancestor.
 */
export function batchStatic(group) {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const shared = new Map(); // material key -> the one material every look-alike uses
  const buckets = new Map(); // material, shadow flags, render order, layers and chunk -> parts
  const meshes = [];
  const visit = (o) => {
    if (!o.visible || o.userData.dynamic || o.userData.noBatch) return;
    if (batchable(o)) {
      const geo = o.geometry;
      const matrix = new THREE.Matrix4().multiplyMatrices(toGroup, o.matrixWorld);
      if (!geo.boundingBox) geo.computeBoundingBox();
      tmpBox.copy(geo.boundingBox).applyMatrix4(matrix);
      tmpBox.getSize(tmpSize);
      if (Math.max(tmpSize.x, tmpSize.z) <= MAX_EXTENT) {
        tmpBox.getCenter(tmpCenter);
        const cell = `${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}/${o.renderOrder}/${o.layers.mask}/${Math.floor(tmpCenter.x / CHUNK)},${Math.floor(tmpCenter.z / CHUNK)}`;
        const multi = Array.isArray(o.material);
        const entry = { mesh: o, keep: false };
        const parts = multi ? geo.groups.map((g) => [o.material[g.materialIndex], g.start, g.count]) : [[o.material, 0, Infinity]];
        for (const [mat, start, count] of parts) {
          if (!mat) continue;
          const [a, b] = range(geo, start, count);
          if (b <= a) continue;
          const mk = materialKey(mat);
          if (!shared.has(mk)) shared.set(mk, mat);
          const key = mk + '#' + cell;
          let bucket = buckets.get(key);
          if (!bucket) buckets.set(key, bucket = { material: shared.get(mk), mesh: o, parts: [] });
          bucket.parts.push({ entry, multi, geo, matrix, a, b });
        }
        meshes.push(entry);
      }
    }
    for (const child of o.children) visit(child);
  };
  for (const child of group.children) visit(child);
  const batches = [];
  for (const bucket of buckets.values()) {
    const first = bucket.parts[0];
    if (bucket.parts.length === 1 && !first.multi) {
      // Nothing to merge with: the mesh stays where it is, on the shared material.
      first.entry.keep = true;
      first.entry.mesh.material = bucket.material;
      continue;
    }
    const src = bucket.mesh;
    const mesh = new THREE.Mesh(merge(bucket.parts, bucket.material.vertexColors), bucket.material);
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.layers.mask = src.layers.mask;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'static batch';
    batches.push(mesh);
  }
  // Deepest first, so a mesh's own children are gone (or kept) before it is taken out.
  for (let i = meshes.length - 1; i >= 0; i--) if (!meshes[i].keep) detach(meshes[i].mesh, group);
  for (const mesh of batches) group.add(mesh);
  return group;
}
