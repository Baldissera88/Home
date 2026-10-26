import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kitSurface } from './surface.js';

/** Where the game's own textures live: the app's res/ folder, two levels up from assets/web/. */
export const RES = '../../res/drawable-nodpi/';

const CHARACTERS = ['knight', 'barbarian', 'mage', 'rogue', 'bandit', 'skeleton_warrior', 'skeleton_minion', 'skeleton_mage', 'skeleton_rogue'];
const KITS = ['dungeon', 'village', 'weapons'];

const _a = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _n = new THREE.Matrix3();
/** Directions around a transparent character with a draw order of its own, seen at the chase camera's usual pitch. */
const SECTORS = 8, PITCH = 0.5;

/** The matrix that takes a skinned mesh's vertices into bone i's space in its bind pose. */
function bindOf(mesh, i, target) {
  return target.multiplyMatrices(mesh.skeleton.boneInverses[i], mesh.bindMatrix);
}

/**
 * The matrix that moves a part's vertices into the bind pose of `ref`, the character's first skinned part, so the
 * part can be drawn with ref's skeleton; null when it cannot. A skinned part must use the same bones, its own bind
 * may only differ from ref's by one transform for every bone (KayKit quantizes each part on its own, so it does).
 * A rigid part hanging from a bone is bound to that bone, at `bone`.
 */
function rebind(ref, part) {
  const bones = ref.skeleton.bones;
  if (part.isSkinnedMesh) {
    const own = part.skeleton.bones;
    if (own.length !== bones.length || own.some((b, i) => b !== bones[i])) return null;
    const x = bindOf(ref, 0, new THREE.Matrix4()).invert().multiply(bindOf(part, 0, _a));
    for (let i = 1; i < bones.length; i++) {
      const e = bindOf(ref, i, _a).multiply(x).elements, f = bindOf(part, i, _b).elements;
      for (let k = 0; k < 16; k++) if (Math.abs(e[k] - f[k]) > 1e-4 * (1 + Math.abs(f[k]))) return null;
    }
    return { x, bone: -1 };
  }
  let bone = part.parent, i = -1;
  while (bone && (i = bones.indexOf(bone)) < 0) bone = bone.parent;
  if (i < 0) return null;
  // Drawn by bone i alone: bone.matrixWorld * boneInverse * bindMatrix * x must be where the part is now.
  const x = bindOf(ref, i, new THREE.Matrix4()).invert().multiply(_a.copy(bone.matrixWorld).invert()).multiply(part.matrixWorld);
  return { x, bone: i };
}

/** A plain copy of an attribute, as floats when it is to be moved (the parts' int16 arrays cannot hold that). */
function plain(attr, float) {
  const size = attr.itemSize, out = new (float ? Float32Array : attr.array.constructor)(attr.count * size);
  const data = attr.isInterleavedBufferAttribute ? attr.data : null;
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < size; c++) {
      out[i * size + c] = float ? attr.getComponent(i, c) : data ? data.array[i * data.stride + attr.offset + c] : attr.array[i * size + c];
    }
  }
  return new THREE.BufferAttribute(out, size, !float && attr.normalized);
}

/** A part's geometry moved into ref's bind pose; a rigid part gets weights binding it to its bone. */
function rebound(part, fit, like) {
  const src = part.geometry, g = new THREE.BufferGeometry();
  for (const name in src.attributes) {
    const attr = src.attributes[name], moved = name === 'position' || name === 'normal';
    g.setAttribute(name, moved || attr.isInterleavedBufferAttribute ? plain(attr, moved) : attr);
  }
  g.setIndex(src.index);
  g.attributes.position.applyMatrix4(fit.x);
  // Skinning turns normals by the bone matrices themselves, so the merged part's normals turn by x itself too.
  if (g.attributes.normal) g.attributes.normal.applyMatrix3(_n.setFromMatrix4(fit.x));
  if (fit.bone >= 0) {
    const n = src.attributes.position.count, index = like.attributes.skinIndex, weight = like.attributes.skinWeight;
    const joints = new THREE.BufferAttribute(new index.array.constructor(n * 4), 4, index.normalized);
    const weights = new THREE.BufferAttribute(new weight.array.constructor(n * 4), 4, weight.normalized);
    for (let i = 0; i < n; i++) {
      joints.setXYZW(i, fit.bone, 0, 0, 0);
      weights.setXYZW(i, 1, 0, 0, 0);
    }
    g.setAttribute('skinIndex', joints);
    g.setAttribute('skinWeight', weights);
  }
  return g;
}

/**
 * The geometry with a reversed copy of each triangle ahead of it: drawn front-sided in one call, it shows the back
 * faces and then the front faces, as the two passes three gives a double-sided transparent mesh did for each part.
 */
function bothSides(geometry) {
  const back = geometry.clone(), index = back.index.array, normal = back.attributes.normal.array;
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
  for (let i = 0; i < normal.length; i++) normal[i] = -normal[i];
  return mergeGeometries([back, geometry]);
}

/** The attributes a part brings to the merge, a rigid one counting the skin weights it is given. */
function attributeNames(geometry, rigid) {
  const names = Object.keys(geometry.attributes);
  if (rigid) names.push('skinIndex', 'skinWeight');
  return names.sort().join();
}

/** Loads every model once and hands out clones. */
export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.texLoader = new THREE.TextureLoader();
    this.chars = {};
    this.kits = {};
    this.clips = {};
    this.textures = {};
    /** Merged character geometry by model and parts, shared by every copy. */
    this.merges = new Map();
    /** Textures still on their way, for tests that wait until everything has arrived. */
    this.pending = [];
  }

  async load(onProgress) {
    const jobs = [];
    let done = 0;
    const total = CHARACTERS.length + KITS.length + 1;
    const tick = () => onProgress && onProgress(++done / total);
    for (const name of CHARACTERS) {
      jobs.push(this.loader.loadAsync(`models/${name}.glb`).then((g) => { this.chars[name] = this.prepareCharacter(g.scene); tick(); }));
    }
    for (const name of KITS) {
      jobs.push(this.loader.loadAsync(`models/${name}.glb`).then((g) => { this.kits[name] = this.indexKit(g.scene, name); tick(); }));
    }
    jobs.push(this.loader.loadAsync('models/anims.glb').then((g) => {
      for (const clip of g.animations) this.clips[clip.name] = clip;
      tick();
    }));
    await Promise.all(jobs);
  }

  prepareCharacter(scene) {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material.roughness = 0.75;
          o.material.metalness = 0.0;
        }
      }
    });
    return scene;
  }

  /**
   * A kit is one scene with a named holder node per model. The dungeon and village kits' one shared
   * material gets real roughness, metal and fine relief per atlas cell (surface.js kitSurface).
   */
  indexKit(scene, kit) {
    const map = {};
    const done = new Set();
    for (const child of scene.children) {
      child.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.geometry.userData.shared = true;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m && m.map && !done.has(m)) { done.add(m); kitSurface(m, kit, true); }
          }
        }
      });
      const box = new THREE.Box3().setFromObject(child);
      map[child.name] = { node: child, box };
    }
    return map;
  }

  /** A fresh, independently animated copy of a character. */
  character(name) {
    const body = SkeletonUtils.clone(this.chars[name]);
    body.userData.model = name;
    return body;
  }

  /**
   * Folds a character copy's visible parts into one skinned mesh per material, all on the first part's skeleton:
   * the skinned body parts and the gear the model hangs on its bones (bound rigidly to that bone), drawn and
   * skinned once instead of a dozen times. Hidden parts are dropped; kit pieces hung on a bone stay as they are.
   * Call it once the parts' visibility and materials are final. A transparent double-sided material (a ghost) turns
   * front-sided, with each part's back faces drawn just before its front faces as three's two passes did.
   */
  mergeParts(body) {
    body.updateWorldMatrix(true, true);
    const groups = new Map(), hidden = [];
    let ref = null;
    body.traverse((o) => {
      if (!o.isMesh || o.geometry.userData.shared || Array.isArray(o.material) || o.children.length) return;
      if (!o.visible) { hidden.push(o); return; }
      if (!ref && o.isSkinnedMesh) ref = o;
      const list = groups.get(o.material);
      if (list) list.push(o); else groups.set(o.material, [o]);
    });
    for (const o of hidden) o.removeFromParent();
    if (!ref) return;
    groups.forEach((list, material) => {
      const twoSided = material.transparent && material.side === THREE.DoubleSide;
      const key = `${body.userData.model}|${ref.name}|${twoSided}|${list.map((o) => o.name).join()}`;
      let merge = this.merges.get(key);
      if (!merge) merge = this.merge(ref, list, key, twoSided);
      if (!merge.geometry) return;
      const parts = list.filter((o) => merge.names.includes(o.name));
      const host = parts.find((o) => o.isSkinnedMesh);
      host.geometry = merge.geometry;
      if (twoSided) {
        material.side = THREE.FrontSide;
        // The parts' draw order for the direction the camera sees the character from.
        const orders = merge.orders, e = body.matrixWorld.elements;
        host.onBeforeRender = (renderer, scene, camera, geometry) => {
          const c = camera.matrixWorld.elements, x = c[12] - e[12], y = c[13] - e[13], z = c[14] - e[14];
          const a = Math.atan2(x * e[0] + y * e[1] + z * e[2], x * e[8] + y * e[9] + z * e[10]);
          geometry.index = orders[(Math.round(a / (2 * Math.PI) * SECTORS) + SECTORS) % SECTORS];
        };
      }
      if (host.skeleton !== ref.skeleton) host.bind(ref.skeleton, ref.bindMatrix);
      host.frustumCulled = false;
      host.boundingSphere = host.boundingBox = null;
      for (const o of parts) if (o !== host) o.removeFromParent();
    });
  }

  /** Builds (and remembers under `key`) the merged geometry of one material's parts, from those that can join. */
  merge(ref, list, key, twoSided) {
    const fits = list.map((o) => rebind(ref, o));
    const host = list.find((o, i) => o.isSkinnedMesh && fits[i]);
    const names = host ? attributeNames(host.geometry) : '';
    const parts = [], moves = [];
    list.forEach((o, i) => {
      if (!host || !fits[i] || attributeNames(o.geometry, !o.isSkinnedMesh) !== names) return;
      parts.push(o);
      moves.push(fits[i]);
    });
    const merge = { geometry: null, names: parts.map((o) => o.name) };
    // Nothing to gain from a lone part already on ref's skeleton; a two-sided material turning front-sided needs them all.
    if ((parts.length > 1 || (host && host !== ref)) && (!twoSided || parts.length === list.length)) {
      let geometries = parts.map((o, i) => rebound(o, moves[i], host.geometry));
      if (twoSided) geometries = geometries.map(bothSides);
      merge.geometry = mergeGeometries(geometries);
      if (merge.geometry) merge.geometry.userData.shared = true;
      if (merge.geometry && twoSided) {
        // Three drew the parts far to near. Keep that order, in an index of its own, for a camera at the chase
        // pitch in each of SECTORS directions around the character (rest-pose centres, +z is where it faces).
        const rest = _a.multiplyMatrices(ref.skeleton.bones[0].matrixWorld, bindOf(ref, 0, _b));
        const centers = geometries.map((g) => {
          g.computeBoundingSphere();
          return g.boundingSphere.center.clone().applyMatrix4(rest);
        });
        const src = merge.geometry.index.array, starts = [];
        let at = 0;
        for (const g of geometries) { starts.push(at); at += g.index.count; }
        merge.orders = [];
        for (let k = 0; k < SECTORS; k++) {
          const a = k / SECTORS * 2 * Math.PI, sin = Math.sin(a), cos = Math.cos(a);
          const depth = centers.map((c) => (c.x * sin + c.z * cos) * Math.cos(PITCH) + c.y * Math.sin(PITCH));
          const out = new src.constructor(src.length);
          let n = 0;
          for (const i of geometries.map((g, j) => j).sort((i, j) => depth[i] - depth[j])) {
            out.set(src.subarray(starts[i], starts[i] + geometries[i].index.count), n);
            n += geometries[i].index.count;
          }
          merge.orders.push(new THREE.BufferAttribute(out, 1));
        }
        merge.geometry.setIndex(merge.orders[0]);
      }
    }
    this.merges.set(key, merge);
    return merge;
  }

  /** A copy of a static kit model (geometry and materials are shared). */
  piece(kit, name) {
    const entry = this.kits[kit] && this.kits[kit][name];
    if (!entry) return null;
    const clone = entry.node.clone(true);
    clone.position.set(0, 0, 0);
    clone.userData.box = entry.box;
    return clone;
  }

  box(kit, name) {
    const entry = this.kits[kit] && this.kits[kit][name];
    return entry ? entry.box : null;
  }

  texture(file, srgb = true, repeat = true) {
    if (this.textures[file]) return this.textures[file];
    let t;
    this.pending.push(new Promise((resolve) => { t = this.texLoader.load(RES + file, resolve, undefined, resolve); }));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.textures[file] = t;
    return t;
  }

  async image(file) {
    const img = new Image();
    img.src = RES + file;
    await img.decode();
    return img;
  }

  /**
   * A texture array from a horizontal strip of square textures (colour), with each layer's height map
   * (from a matching grayscale strip) packed into alpha so one fetch gives both.
   */
  async layeredStrip(colorFile, heightFile, count) {
    const [ci, hi] = await Promise.all([this.image(colorFile), this.image(heightFile)]);
    const size = ci.height;
    const canvas = document.createElement('canvas');
    canvas.width = ci.width;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ci, 0, 0);
    const color = ctx.getImageData(0, 0, ci.width, size).data;
    ctx.clearRect(0, 0, ci.width, size);
    ctx.drawImage(hi, 0, 0);
    const height = ctx.getImageData(0, 0, hi.width, size).data;
    const data = new Uint8Array(size * size * 4 * count);
    for (let layer = 0; layer < count; layer++) {
      for (let y = 0; y < size; y++) {
        let src = (y * ci.width + layer * size) * 4;
        let dst = ((layer * size + y) * size) * 4;
        for (let x = 0; x < size; x++, src += 4, dst += 4) {
          data[dst] = color[src];
          data[dst + 1] = color[src + 1];
          data[dst + 2] = color[src + 2];
          data[dst + 3] = height[src];
        }
      }
    }
    const tex = new THREE.DataArrayTexture(data, size, size, count);
    tex.format = THREE.RGBAFormat;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }
}
