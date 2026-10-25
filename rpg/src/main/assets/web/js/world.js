import * as THREE from 'three';
import { Ground, makeWater } from './terrain.js';
import { Flora } from './flora.js';
import { OUTDOOR, PROP, TILE, hash } from './defs.js';
import { applyOcclusion } from './occlude.js';
import { buildDressing } from './dressing.js';
import { batchStatic } from './batch.js';
import { buildBackdrop, updateBackdrop } from './backdrop.js';
import { DesertField, SAND, SAND_LAYERS, bakeSandLayers, desertNoise } from './desert.js';
import { buildDesert, desertGate, desertProp, desertStairs, updateDesert } from './cliffs.js';

const WALL_HEIGHT = 1.9;

const BIOME = {
  OVERWORLD: { layers: ['tex_terrain.jpg', 'tex_terrain_h.png', 7], water: 4 },
  CRYPT: { layers: ['tex_floorset_crypt.jpg', 'tex_floorset_crypt_h.png', 4], wall: 'crypt' },
  CAVE: { layers: ['tex_floorset_cave.jpg', 'tex_floorset_cave_h.png', 4], wall: 'cave' },
  HELL: { layers: ['tex_floorset_hell.jpg', 'tex_floorset_hell_h.png', 4], wall: 'hell' },
  // Baked at load (desert.js): fine sand, dune sand, hardpan, paving, oasis grass; the pool bed is sand.
  DESERT: { layers: [null, null, SAND_LAYERS], water: 0 },
};

/** Fits a kit model to a footprint: scales by width, centres it and puts it on the ground. */
function fit(obj, width, height) {
  const box = obj.userData.box || new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  let s = width / Math.max(size.x, size.z);
  if (height) s = Math.min(s, height / size.y);
  obj.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  const holder = new THREE.Group();
  holder.add(obj);
  return holder;
}

/**
 * Dungeon walls: the game's own wall and top textures in world space, bump from their shading, grime
 * creeping up from the floor and the see-through cutaway around the hero.
 */
function wallMaterial(map, top) {
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: top ? 2.5 : 4, roughness: 0.92, metalness: 0 });
  // Sides and tops bake different shading into the shader, so they must not share one compiled program.
  mat.customProgramCacheKey = () => (top ? 'wall-top' : 'wall-side');
  mat.onBeforeCompile = (shader) => {
    applyOcclusion(shader, 1.6, 0.32);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWallY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallY = transformed.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWallY;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= ${top ? '1.3' : 'mix(1.0, 1.9, smoothstep(0.0, 1.1, vWallY))'};`);
  };
  return mat;
}

/** The torch flame: two crossed additive quads with a flickering gradient. */
function flameSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 40, 2, 32, 34, 30);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,190,80,0.95)');
  grad.addColorStop(0.6, 'rgba(255,90,20,0.5)');
  grad.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(32, 36, 16, 28, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}

/** The static level: ground, water, plants, walls, buildings, props and light sources. */
export class World {
  constructor(assets, level, quality) {
    this.assets = assets;
    this.level = level;
    this.quality = quality;
    this.group = new THREE.Group();
    this.biome = level.biome;
    this.outdoors = OUTDOOR.has(level.biome);
    this.desert = level.biome === 'DESERT';
    this.lights = []; // { x, y, z, color, radius, flicker }
    this.flames = [];
    this.props = [];
  }

  tile(x, y) {
    const lv = this.level;
    if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return TILE.WALL;
    return lv.tiles.charCodeAt(y * lv.w + x) - 48;
  }

  async build() {
    const lv = this.level;
    const cfg = BIOME[this.biome] || BIOME.CRYPT;
    let layers, ground = lv, relief = null, desert = null;
    if (this.desert) {
      // The ridges' distance field shapes the dunes, the cliffs and where scenery may stand.
      this.field = new DesertField(lv);
      layers = bakeSandLayers(this.assets.renderer);
      ground = this.field.groundLevel();
      relief = this.field.relief;
      SAND.uNoise.value = desertNoise();
      desert = SAND;
    } else {
      layers = await this.assets.layeredStrip(cfg.layers[0], cfg.layers[1], cfg.layers[2]);
    }
    this.ground = new Ground(ground, layers, { apron: this.outdoors, relief });
    const mat = this.ground.material({
      count: cfg.layers[2], waterLayer: cfg.water ?? 1, texScale: 4, bump: this.desert ? 2.6 : this.outdoors ? 1.6 : 2.2,
      macro: this.desert ? 0.3 : this.outdoors ? 0.22 : 0.3, quality: this.quality, desert,
    });
    this.group.add(this.ground.build(mat));
    this.flameMat = flameSprite();
    if (this.outdoors) {
      if (lv.tiles.includes(String(TILE.WATER))) {
        this.water = makeWater(lv.w, lv.h, this.assets, this.ground, this.desert);
        this.water.userData.dynamic = true;
        this.group.add(this.water);
      }
      this.flora = new Flora(lv, this.ground, this.quality, this.desert ? this.field : null);
      const flora = this.flora.build();
      flora.userData.dynamic = true;
      this.group.add(flora);
      if (this.desert) {
        // Sandstone ridges and ruins, their torches, the scenery and the stairs down.
        buildDesert(this);
        this.buildTorches();
        this.buildExit();
      } else {
        this.buildRocks();
      }
      // Village buildings and the entrances to the regions, wherever the level has them.
      this.buildBuildings();
      this.buildEntrances();
      this.backdrop = buildBackdrop(this);
      this.group.add(this.backdrop);
    } else {
      this.buildWalls(cfg);
      this.buildExit();
    }
    this.buildProps();
    batchStatic(this.group);
    return this.group;
  }

  heightAt(x, y) {
    return this.ground ? this.ground.heightAt(x, y) : 0;
  }

  buildRocks() {
    const names = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'];
    for (let y = 0; y < this.level.h; y++) {
      for (let x = 0; x < this.level.w; x++) {
        if (this.tile(x, y) !== TILE.ROCK) continue;
        const piece = this.assets.piece('village', names[Math.floor(hash(x, y, 1) * names.length)]);
        if (!piece) continue;
        const r = fit(piece, 0.9 + hash(x, y, 2) * 0.4);
        r.position.set(x + 0.5, this.heightAt(x + 0.5, y + 0.5) - 0.05, y + 0.5);
        r.rotation.y = hash(x, y, 3) * 6.28;
        this.group.add(r);
      }
    }
  }

  buildBuildings() {
    // Building sprites in the 2D game: timber house, stone house, smithy, well, market stall, cart, lamp post, haystack, dummy, tent.
    const MAP = ['building_home_A', 'building_home_B', 'building_blacksmith', 'building_well', 'building_market', 'wheelbarrow', null, 'building_grain', 'target', 'tent'];
    for (const [sprite, bx, by, bw, bh, light, lx, ly] of this.level.bld) {
      const cx = bx + bw / 2, cy = by + bh / 2;
      if (sprite === 6) {
        this.lampPost(cx, cy);
        continue;
      }
      const piece = this.assets.piece('village', MAP[sprite]);
      if (!piece) continue;
      const big = sprite <= 2 || sprite === 4;
      const b = fit(piece, Math.max(bw, bh) * (big ? 1.25 : 1.0));
      b.position.set(cx, 0, cy);
      // Face the village square.
      const vil = this.level.vil;
      if (vil && big) {
        const dx = vil[0] + vil[2] / 2 - cx, dz = vil[1] + vil[3] / 2 - cy;
        b.rotation.y = Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) * (Math.PI / 2);
      }
      this.group.add(b);
      if (light) this.lights.push({ x: cx + lx, y: 1.2, z: by + bh + ly - 0.2, color: 0xffb060, radius: 5, intensity: 0.7, flicker: true });
    }
  }

  lampPost(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.6 }));
    pole.position.set(x, 0.95, z);
    pole.castShadow = true;
    this.group.add(pole);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 1.4 }));
    lamp.position.set(x, 1.95, z);
    lamp.userData.dynamic = true;
    this.group.add(lamp);
    this.lights.push({ x, y: 1.95, z, color: 0xffb870, radius: 6, intensity: 0.7, flicker: false, lamp });
  }

  buildEntrances() {
    for (const [x, y, region] of this.level.ent) {
      const g = new THREE.Group();
      g.position.set(x + 0.5, 0, y + 0.5);
      if (region === 0) {
        // The crypt: a stone doorway into the hillside.
        const door = this.assets.piece('dungeon', 'wall_doorway');
        if (door) g.add(fit(door, 2.2));
        const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        dark.position.set(0, 0.65, 0.02);
        g.add(dark);
      } else if (region === 3) {
        // The way to the desert: a sandstone gateway facing into the map, the glare of the sands beyond.
        g.add(desertGate());
        const lv = this.level;
        g.rotation.y = Math.round(Math.atan2(lv.w / 2 - x, lv.h / 2 - y) / (Math.PI / 2)) * (Math.PI / 2);
        this.lights.push({ x: x + 0.5, y: 1.2, z: y + 0.5, color: 0xffb060, radius: 5, intensity: 1.2, flicker: false });
      } else if (region === 1) {
        // The caves: a heap of boulders around a dark mouth.
        for (let k = 0; k < 7; k++) {
          const rock = this.assets.piece('village', ['rock_single_C', 'rock_single_D', 'rock_single_E'][k % 3]);
          if (!rock) continue;
          const r = fit(rock, 1.0 + hash(x, k) * 0.8);
          const a = Math.PI * (0.15 + 0.7 * k / 6);
          r.position.set(Math.cos(a) * 1.1, 0, -Math.sin(a) * 0.6);
          r.rotation.y = k;
          g.add(r);
        }
        const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x050403 }));
        mouth.rotation.x = -Math.PI / 2;
        mouth.position.y = 0.02;
        g.add(mouth);
      } else {
        // The gate of hell: a ring of black stone around a roaring portal.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.18, 10, 28), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.4, metalness: 0.3 }));
        ring.position.y = 1.1;
        ring.castShadow = true;
        g.add(ring);
        const portal = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        portal.position.y = 1.1;
        g.add(portal);
        portal.userData.dynamic = true;
        this.portal = portal;
        this.lights.push({ x: x + 0.5, y: 1.1, z: y + 0.8, color: 0xff5a20, radius: 7, intensity: 2.5, flicker: true });
      }
      this.group.add(g);
    }
  }

  buildWalls(cfg) {
    const lv = this.level;
    const wall = (x, y) => this.tile(x, y) === TILE.WALL;
    const near = (x, y, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!wall(x + dx, y + dy)) return true;
      return false;
    };
    // Side faces only where a wall meets open floor; tops over the wall mass near the rooms.
    const side = { pos: [], nor: [], uv: [] }, top = { pos: [], nor: [], uv: [] };
    const H = WALL_HEIGHT, TEX_W = 2, TEX_H = 0.75;
    const quad = (g, p, n, uv) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        g.pos.push(...p[i]);
        g.nor.push(...n);
        g.uv.push(...uv[i]);
      }
    };
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        if (!wall(x, y) || !near(x, y, 2)) continue;
        quad(top, [[x, H, y], [x, H, y + 1], [x + 1, H, y + 1], [x + 1, H, y]], [0, 1, 0],
          [[x / 2, y / 2], [x / 2, (y + 1) / 2], [(x + 1) / 2, (y + 1) / 2], [(x + 1) / 2, y / 2]]);
        const v1 = H / TEX_H;
        if (!wall(x, y + 1)) quad(side, [[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, H, y + 1], [x, H, y + 1]], [0, 0, 1],
          [[x / TEX_W, 0], [(x + 1) / TEX_W, 0], [(x + 1) / TEX_W, v1], [x / TEX_W, v1]]);
        if (!wall(x, y - 1)) quad(side, [[x + 1, 0, y], [x, 0, y], [x, H, y], [x + 1, H, y]], [0, 0, -1],
          [[-(x + 1) / TEX_W, 0], [-x / TEX_W, 0], [-x / TEX_W, v1], [-(x + 1) / TEX_W, v1]]);
        if (!wall(x + 1, y)) quad(side, [[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, H, y], [x + 1, H, y + 1]], [1, 0, 0],
          [[-(y + 1) / TEX_W, 0], [-y / TEX_W, 0], [-y / TEX_W, v1], [-(y + 1) / TEX_W, v1]]);
        if (!wall(x - 1, y)) quad(side, [[x, 0, y], [x, 0, y + 1], [x, H, y + 1], [x, H, y]], [-1, 0, 0],
          [[y / TEX_W, 0], [(y + 1) / TEX_W, 0], [(y + 1) / TEX_W, v1], [y / TEX_W, v1]]);
      }
    }
    const mesh = (g, mat) => {
      if (!g.pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    };
    mesh(side, wallMaterial(this.assets.texture(`tex_${cfg.wall}_wall.png`), false));
    mesh(top, wallMaterial(this.assets.texture(`tex_${cfg.wall}_top.png`), true));
    this.buildTorches();
    buildDressing(this);
  }

  /** Torches on the walls they belong to, facing the floor. */
  buildTorches() {
    const lv = this.level;
    for (const idx of lv.torch || []) {
      const x = idx % lv.w, y = Math.floor(idx / lv.w);
      let fx = 0, fz = 1;
      if (this.tile(x, y + 1) !== TILE.WALL) { fx = 0; fz = 1; } else if (this.tile(x + 1, y) !== TILE.WALL) { fx = 1; fz = 0; } else if (this.tile(x - 1, y) !== TILE.WALL) { fx = -1; fz = 0; } else { fx = 0; fz = -1; }
      const px = x + 0.5 + fx * 0.52, pz = y + 0.5 + fz * 0.52;
      const torch = this.assets.piece('dungeon', 'torch_mounted');
      if (torch) {
        const t = fit(torch, 0.32);
        t.position.set(px, 1.05, pz);
        t.rotation.y = Math.atan2(fx, fz);
        this.group.add(t);
      }
      this.addFlame(px + fx * 0.08, 1.42, pz + fz * 0.08, 0.32);
      this.lights.push({ x: px + fx * 0.3, y: 1.5, z: pz + fz * 0.3, color: 0xff9a4a, radius: 6.5, intensity: 2.2, flicker: true });
    }
  }

  addFlame(x, y, z, size) {
    const s = new THREE.Sprite(this.flameMat);
    s.position.set(x, y, z);
    s.scale.set(size, size * 1.5, 1);
    s.userData.base = size;
    s.userData.seed = Math.random() * 10;
    s.userData.dynamic = true;
    this.group.add(s);
    this.flames.push(s);
  }

  buildExit() {
    const [x, y] = this.level.exit;
    const stairs = this.desert ? null : this.assets.piece('dungeon', 'stairs');
    if (this.desert) {
      const s = desertStairs();
      s.position.set(x + 0.5, this.heightAt(x + 0.5, y + 0.5), y + 0.5);
      this.group.add(s);
    } else if (stairs) {
      const s = fit(stairs, 1.1);
      s.position.set(x + 0.5, -0.02, y + 0.5);
      this.group.add(s);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x + 0.5, this.heightAt(x + 0.5, y + 0.5) + 0.04, y + 0.5);
    this.group.add(ring);
    ring.userData.dynamic = true;
    this.exitRing = ring;
    this.lights.push({ x: x + 0.5, y: 1.4, z: y + 0.5, color: 0x6fd0ff, radius: 4, intensity: 0.6, flicker: false });
  }

  /** Every prop of the level, mapped onto the kits. */
  buildProps() {
    const lv = this.level;
    lv.props.forEach(([type, x, y, used], i) => {
      const name = PROP[type];
      const obj = this.makeProp(name, x, y, i);
      if (!obj) return;
      obj.position.x = x;
      obj.position.z = y;
      obj.position.y += this.heightAt(x, y);
      if (name === 'BARREL' || name === 'URN' || name === 'CRATE' || name === 'CHEST') obj.userData.dynamic = true;
      this.group.add(obj);
      this.props[i] = { obj, name, used };
    });
  }

  makeProp(name, x, y, i) {
    const k = (n, w, h) => {
      const p = this.assets.piece('dungeon', n) || this.assets.piece('village', n);
      return p ? fit(p, w, h) : null;
    };
    const r = hash(Math.floor(x * 7), Math.floor(y * 7), i);
    let o = this.desert ? desertProp(name, r) : null;
    if (o) {
      o.rotation.y = r * Math.PI * 2;
      return o;
    }
    switch (name) {
      case 'BARREL': o = k(r < 0.5 ? 'barrel_large' : 'keg', 0.55); break;
      case 'URN': o = k(r < 0.5 ? 'bottle_A_green' : 'bottle_B_brown', 0.32); break;
      case 'CRATE': o = k(r < 0.5 ? 'box_small' : 'box_stacked', 0.6); break;
      case 'CHEST': o = k(r < 0.3 ? 'chest_gold' : 'chest', 0.62); break;
      case 'STASH': o = k('trunk_large_A', 0.7); break;
      case 'TABLE': o = k('table_medium', 0.9); if (o) this.addCandle(o, 0.42); break;
      case 'BOOKSHELF': o = k('shelf_small_candles', 0.95); break;
      case 'WEAPON_RACK': o = k('sword_shield', 0.7); break;
      case 'BANNER': o = k('banner_patternA_red', 0.7); break;
      case 'COLUMN': o = k('pillar_decorated', 0.6); break;
      case 'PILLAR': o = k('pillar', 0.55); break;
      case 'SARCOPHAGUS': o = k('bed_frame', 1.0); if (o) o.children[0].traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.setHex(0x8a8580); } }); break;
      case 'ALTAR': o = this.altar(); break;
      case 'BRAZIER': o = this.brazier(); break;
      case 'CAMPFIRE': o = this.campfire(); break;
      case 'SHRINE': o = this.shrine(); break;
      case 'GRAVESTONE': o = this.gravestone(r); break;
      case 'SKULLS': case 'BONEPILE': o = k('rubble_half', 0.5); break;
      case 'STALAGMITES': o = this.stalagmites(r); break;
      case 'CRYSTALS': o = this.crystals(r, 0x56c8ff); break;
      case 'OBSIDIAN': o = this.crystals(r, 0x2a1a1a, 0xff4010); break;
      case 'MUSHROOMS': o = this.mushrooms(r); break;
      case 'CAGE': o = k('barrier_column', 0.5); break;
      case 'SIGN': o = this.signpost(); break;
      default: o = null;
    }
    if (o) o.rotation.y += r * Math.PI * 2 * (name === 'BANNER' || name === 'BOOKSHELF' ? 0 : 1);
    return o;
  }

  addCandle(obj, y) {
    const c = this.assets.piece('dungeon', 'candle_triple');
    if (c) {
      const cc = fit(c, 0.18);
      cc.position.y = y;
      obj.add(cc);
    }
  }

  altar() {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: this.desert ? 0xc8a478 : 0x5a524c, roughness: 0.8 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.55), stone);
    base.position.y = 0.25;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.58), new THREE.MeshStandardMaterial({ color: this.desert ? 0x1e3a7a : 0x7a1010, roughness: 0.9 }));
    cloth.position.y = 0.51;
    g.add(cloth);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshStandardMaterial({ color: 0xff2040, emissive: 0xff1030, emissiveIntensity: 2 }));
    gem.position.y = 0.75;
    gem.userData.dynamic = true;
    g.add(gem);
    this.spinners = (this.spinners || []).concat(gem);
    return g;
  }

  brazier() {
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.45, metalness: 0.7 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.16, 12, 1, true), iron);
    bowl.position.y = 0.66;
    g.add(bowl);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.6, 6), iron);
    leg.position.y = 0.3;
    g.add(leg);
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), new THREE.MeshStandardMaterial({ color: 0x401000, emissive: 0xff5010, emissiveIntensity: 1.5 }));
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 0.7;
    g.add(coals);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.userData.flame = [0, 0.86, 0, 0.42];
    return g;
  }

  campfire() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.9 });
    for (let k = 0; k < 5; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 7), wood);
      log.rotation.z = Math.PI / 2 - 0.35;
      log.rotation.y = k * 1.25;
      log.position.y = 0.12;
      log.castShadow = true;
      g.add(log);
    }
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 0.9 }));
      st.position.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42);
      g.add(st);
    }
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshStandardMaterial({ color: 0x300800, emissive: 0xff4a10, emissiveIntensity: 1.6 }));
    embers.rotation.x = -Math.PI / 2;
    embers.position.y = 0.03;
    g.add(embers);
    g.userData.flame = [0, 0.4, 0, 0.9];
    return g;
  }

  shrine() {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: this.desert ? 0xd2b088 : 0x8a8a92, roughness: 0.7 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.3, 8), stone);
    plinth.position.y = 0.15;
    g.add(plinth);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 8), stone);
    pillar.position.y = 0.7;
    g.add(pillar);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: 0x40e8ff, emissive: 0x20c8ff, emissiveIntensity: 2.2, roughness: 0.1 }));
    orb.position.y = 1.25;
    g.add(orb);
    orb.userData.dynamic = true;
    g.userData.orb = orb;
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  gravestone(r) {
    const g = new THREE.Group();
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.1), new THREE.MeshStandardMaterial({ color: 0x6a6a68, roughness: 0.95 }));
    stone.position.y = 0.27;
    stone.rotation.z = (r - 0.5) * 0.2;
    stone.castShadow = true;
    g.add(stone);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16, 1, false, 0, Math.PI), stone.material);
    top.rotation.x = Math.PI / 2;
    top.rotation.z = Math.PI / 2;
    top.position.y = 0.55;
    g.add(top);
    return g;
  }

  stalagmites(r) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.85 });
    for (let k = 0; k < 4; k++) {
      const h = 0.4 + hash(k, r * 100) * 0.8;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.12 + h * 0.08, h, 7), m);
      c.position.set((hash(k, 1, r * 50) - 0.5) * 0.5, h / 2, (hash(k, 2, r * 50) - 0.5) * 0.5);
      c.castShadow = true;
      g.add(c);
    }
    return g;
  }

  crystals(r, color, glow = color) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 });
    for (let k = 0; k < 5; k++) {
      const h = 0.3 + hash(k, r * 100) * 0.5;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), m);
      c.scale.set(1, h * 4, 1);
      c.position.set((hash(k, 1, r * 77) - 0.5) * 0.4, h * 0.35, (hash(k, 2, r * 77) - 0.5) * 0.4);
      c.rotation.set((hash(k, 3) - 0.5) * 0.6, hash(k, 4) * 3, (hash(k, 5) - 0.5) * 0.6);
      g.add(c);
    }
    return g;
  }

  mushrooms(r) {
    const g = new THREE.Group();
    const stem = new THREE.MeshStandardMaterial({ color: 0xc8e0e0 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x40d0ff, emissive: 0x20a0e0, emissiveIntensity: 1.6 });
    for (let k = 0; k < 5; k++) {
      const h = 0.1 + hash(k, r * 30) * 0.18;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, h, 6), stem);
      const px = (hash(k, 1, r * 9) - 0.5) * 0.4, pz = (hash(k, 2, r * 9) - 0.5) * 0.4;
      s.position.set(px, h / 2, pz);
      g.add(s);
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.05 + h * 0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap);
      c.position.set(px, h, pz);
      g.add(c);
    }
    return g;
  }

  signpost() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 7), wood);
    post.position.y = 0.6;
    g.add(post);
    for (const [y, a] of [[1.0, 0.3], [0.8, -0.5]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.03), wood);
      b.position.set(0.18, y, 0);
      b.rotation.y = a;
      g.add(b);
    }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  /** Flicker flames, spin gems, open chests and break barrels as the game says. */
  update(f, t, dt) {
    for (const s of this.flames) {
      const k = 0.85 + 0.15 * Math.sin(t * 11 + s.userData.seed * 7) + 0.08 * Math.sin(t * 23 + s.userData.seed);
      s.scale.set(s.userData.base * k, s.userData.base * 1.5 * (2 - k), 1);
    }
    if (this.spinners) for (const g of this.spinners) g.rotation.y = t * 1.5;
    if (this.exitRing) this.exitRing.material.opacity = 0.45 + 0.3 * Math.sin(t * 2.5);
    if (this.portal) this.portal.material.opacity = 0.7 + 0.2 * Math.sin(t * 4);
    const pu = f.pu || '';
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p) continue;
      const used = pu.charCodeAt(i) === 49;
      if (used === !!p.wasUsed) continue;
      p.wasUsed = used;
      if (['BARREL', 'URN', 'CRATE'].includes(p.name)) p.obj.visible = !used;
      if (p.name === 'CHEST') p.obj.rotation.x = used ? 0 : 0;
      if (p.name === 'SHRINE' && p.obj.userData.orb) p.obj.userData.orb.material.emissiveIntensity = used ? 0.1 : 2.2;
    }
    if (!this.propFlames) {
      this.propFlames = true;
      for (const p of this.props) {
        if (!p || !p.obj.userData.flame) continue;
        const [fx, fy, fz, fs] = p.obj.userData.flame;
        this.addFlame(p.obj.position.x + fx, p.obj.position.y + fy, p.obj.position.z + fz, fs);
        this.lights.push({ x: p.obj.position.x, y: p.obj.position.y + fy + 0.3, z: p.obj.position.z, color: 0xff8a30, radius: p.name === 'CAMPFIRE' ? 9 : 6, intensity: p.name === 'CAMPFIRE' ? 3 : 2, flicker: true });
      }
      for (const p of this.props) {
        if (!p) continue;
        if (p.name === 'CRYSTALS') this.lights.push({ x: p.obj.position.x, y: 0.6, z: p.obj.position.z, color: 0x40c4ff, radius: 4, intensity: 1.4 });
        if (p.name === 'MUSHROOMS') this.lights.push({ x: p.obj.position.x, y: 0.4, z: p.obj.position.z, color: 0x40d0ff, radius: 3, intensity: 1.0 });
        if (p.name === 'SHRINE') this.lights.push({ x: p.obj.position.x, y: 1.3, z: p.obj.position.z, color: 0x40e0ff, radius: 4, intensity: 1.5 });
        if (p.name === 'ALTAR') this.lights.push({ x: p.obj.position.x, y: 0.9, z: p.obj.position.z, color: 0xff2040, radius: 4, intensity: 1.5 });
      }
    }
    if (this.flora) this.flora.update(t, this.desert ? 1.3 : 1 + f.rn * 1.5);
    if (this.desert) updateDesert(this, f, t);
    if (this.water) this.water.material.uniforms.uTime.value = t;
    if (this.backdrop) updateBackdrop(this.backdrop, f, t);
  }
}
