import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** Where the game's own textures live: the app's res/ folder, two levels up from assets/web/. */
export const RES = '../../res/drawable-nodpi/';

const CHARACTERS = ['knight', 'barbarian', 'mage', 'rogue', 'bandit', 'skeleton_warrior', 'skeleton_minion', 'skeleton_mage', 'skeleton_rogue'];
const KITS = ['dungeon', 'village', 'weapons'];

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
      jobs.push(this.loader.loadAsync(`models/${name}.glb`).then((g) => { this.kits[name] = this.indexKit(g.scene); tick(); }));
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

  /** A kit is one scene with a named holder node per model. */
  indexKit(scene) {
    const map = {};
    for (const child of scene.children) {
      child.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.geometry.userData.shared = true;
        }
      });
      const box = new THREE.Box3().setFromObject(child);
      map[child.name] = { node: child, box };
    }
    return map;
  }

  /** A fresh, independently animated copy of a character. */
  character(name) {
    return SkeletonUtils.clone(this.chars[name]);
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
