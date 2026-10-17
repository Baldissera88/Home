import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ACT, ENEMY, NPC, P, E, EF, HERO, WEAPON, angleDamp, damp } from './defs.js';
import * as Beasts from './creatures.js';

const CHAR_SCALE = 0.52;

/** Clones every material so this instance can be tinted, flashed or faded on its own. */
function ownMaterials(root) {
  const mats = [];
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      o.material.userData.baseColor = o.material.color.clone();
      mats.push(o.material);
    }
  });
  return mats;
}

function showOnly(root, visible, all) {
  root.traverse((o) => {
    if (o.isMesh && all.includes(o.name)) o.visible = visible.includes(o.name);
  });
}

/** Crossfading animation player over the shared clip library. */
class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    this.current = null;
    this.name = '';
  }

  play(name, { loop = true, fade = 0.18, speed = 1, restart = false } = {}) {
    const clip = this.clips[name];
    if (!clip) return null;
    if (this.name === name && !restart) {
      this.current.timeScale = speed;
      return this.current;
    }
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, fade, false);
    }
    next.play();
    this.current = next;
    this.name = name;
    return next;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

const HERO_MODEL = { KNIGHT: 'knight', BARBARIAN: 'barbarian', ASSASSIN: 'rogue', SORCERESS: 'mage' };
const GEAR = {
  knight: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword'],
  barbarian: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'],
  mage: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff'],
  rogue: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
  bandit: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
};

function heroGear(model, weapon) {
  switch (model) {
    case 'knight': return weapon === 'SPEAR' ? ['2H_Sword'] : ['1H_Sword', weapon === 'STAFF' ? 'Badge_Shield' : 'Round_Shield'];
    case 'barbarian': return weapon === 'MACE' ? ['1H_Axe', '1H_Axe_Offhand'] : weapon === 'SWORD' ? ['1H_Axe', 'Barbarian_Round_Shield'] : ['2H_Axe'];
    case 'mage': return weapon === 'STAFF' ? ['2H_Staff'] : ['1H_Wand', 'Spellbook'];
    default: return ['Knife', 'Knife_Offhand'];
  }
}

function attackClips(model, weapon) {
  switch (model) {
    case 'knight': return weapon === 'SPEAR' ? ['2H_Melee_Attack_Stab', '2H_Melee_Attack_Slice'] : ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal'];
    case 'barbarian': return weapon === 'MACE' ? ['Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice'] : weapon === 'SWORD' ? ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'] : ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'];
    case 'mage': return ['Spellcast_Shoot'];
    default: return ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Chop'];
  }
}

/** The player's hero. */
class Hero {
  constructor(assets, cls, weapon) {
    this.model = HERO_MODEL[cls];
    this.cls = cls;
    this.weapon = weapon;
    this.root = new THREE.Group();
    this.body = assets.character(this.model);
    this.body.scale.setScalar(CHAR_SCALE);
    this.root.add(this.body);
    this.mats = ownMaterials(this.body);
    showOnly(this.body, heroGear(this.model, weapon), GEAR[this.model]);
    this.anim = new Animator(this.body, assets.clips);
    this.attacks = attackClips(this.model, weapon);
    this.attackIndex = 0;
    this.lastSwing = 0;
    this.yaw = 0;
    this.act = -1;
  }

  update(p, dt, ground) {
    const x = p[P.X], y = p[P.Y];
    this.root.position.set(x, ground(x, y) + p[P.LEAP_Z], y);
    const target = Math.atan2(p[P.FX], p[P.FY]);
    this.yaw = angleDamp(this.yaw, target, 14, dt);
    this.root.rotation.y = this.yaw;
    const act = p[P.ACT];
    const swing = p[P.SWING];
    const a = this.anim;
    const speed = Math.max(0.6, Math.min(1.6, p[P.SPEED] / 3.4));
    switch (act) {
      case ACT.DEAD: a.play('Death_A', { loop: false, fade: 0.25 }); break;
      case ACT.LEAP: a.play('Jump_Full_Short', { loop: false, speed: 1.6 }); break;
      case ACT.CHARGE: a.play('Running_B', { speed: 1.5 }); break;
      case ACT.WHIRLWIND: a.play('2H_Melee_Attack_Spinning', { speed: 1.3 }); break;
      case ACT.SWEEP: a.play('2H_Melee_Attack_Spin', { loop: false, speed: 1.8 }); break;
      case ACT.DODGE: a.play('Dodge_Forward', { loop: false, speed: 1.7, fade: 0.08 }); break;
      case ACT.CAST: a.play(this.model === 'mage' ? 'Spellcast_Long' : this.model === 'rogue' ? 'Throw' : 'Spellcast_Raise', { loop: false, speed: 1.8, fade: 0.1 }); break;
      case ACT.ATTACK: {
        // A new swing starts when the timer jumps back up.
        if (swing > this.lastSwing + 0.01 || this.act !== ACT.ATTACK) {
          const name = this.attacks[this.attackIndex++ % this.attacks.length];
          const clip = a.clips[name];
          const want = Math.max(0.3, p[P.SWING_TIME] * 1.9);
          a.play(name, { loop: false, restart: true, fade: 0.06, speed: clip ? clip.duration / want : 1.5 });
        }
        break;
      }
      case ACT.HURT: if (this.act !== ACT.HURT) a.play('Hit_A', { loop: false, speed: 1.5, fade: 0.08 }); break;
      case ACT.RUN: a.play('Running_A', { speed }); break;
      default:
        if (a.name !== 'Idle' && (!a.current || a.current.loop !== THREE.LoopOnce || !a.current.isRunning())) {
          a.play(this.model === 'barbarian' && this.attacks[0].startsWith('2H') ? '2H_Melee_Idle' : 'Idle', { fade: 0.25 });
        }
    }
    this.lastSwing = swing;
    this.act = act;
    a.update(dt);
    // Stealth turns the hero into a shimmer; hurt flashes red.
    const flags = p[P.FLAGS];
    const stealth = (flags & 1) !== 0;
    for (const m of this.mats) {
      m.transparent = stealth;
      m.opacity = stealth ? 0.32 : 1;
      m.emissive.setRGB((flags & 32) ? 0.16 : 0, 0, 0);
    }
  }
}

/** Which model, scale and tint each monster uses. */
function enemyLook(type, uid) {
  switch (type) {
    case 'SKELETON': return { model: ['skeleton_minion', 'skeleton_warrior', 'skeleton_rogue'][uid % 3], weapon: ['skel_axe', 'skel_blade', 'skel_blade'][uid % 3], shield: uid % 3 === 1 ? 'skel_shield_small' : null };
    case 'SKELETON_KING': return { model: 'skeleton_warrior', scale: 1.5, tint: 0xffe2a0, emissive: 0x2a1a00, weapon: 'skel_blade', shield: 'skel_shield_large' };
    case 'CULTIST': return { model: 'skeleton_mage', tint: 0xb090c8, weapon: 'skel_staff' };
    case 'GHOST': return { model: 'skeleton_rogue', tint: 0x9fe6ff, emissive: 0x1a4a60, ghost: true, float: 0.25 };
    case 'BANDIT': return { model: 'bandit', tint: 0x9a8070, gear: ['Knife'] };
    case 'GOBLIN': return { model: 'rogue', scale: 0.72, tint: 0x8fbf60, gear: ['Knife'] };
    case 'BRUTE': return { model: 'barbarian', scale: 1.3, tint: 0x7ea860, emissive: 0x061000, gear: ['2H_Axe'] };
    case 'TROLL': return { model: 'barbarian', scale: 1.9, tint: 0x7a9a6a, gear: ['2H_Axe'] };
    case 'IMP': return { model: 'mage', scale: 0.62, tint: 0xff7058, emissive: 0x300800, gear: ['1H_Wand'] };
    case 'DEMON_LORD': return { model: 'barbarian', scale: 2.3, tint: 0xd04030, emissive: 0x401000, gear: ['2H_Axe'] };
    case 'SHADOW_KING': return { model: 'knight', scale: 2.2, tint: 0x5a4a78, emissive: 0x100820, gear: ['2H_Sword'] };
    default: return null;
  }
}

class Monster {
  constructor(assets, type, uid) {
    this.type = type;
    this.uid = uid;
    this.root = new THREE.Group();
    this.deadTime = -1;
    this.lastWind = 0;
    this.lastFlash = 0;
    this.yaw = 0;
    const look = enemyLook(type, uid);
    if (look) {
      this.look = look;
      this.body = assets.character(look.model);
      this.body.scale.setScalar(CHAR_SCALE * (look.scale || 1));
      this.root.add(this.body);
      this.mats = ownMaterials(this.body);
      if (GEAR[look.model]) showOnly(this.body, look.gear || [], GEAR[look.model]);
      for (const m of this.mats) {
        if (look.tint) m.color.multiply(new THREE.Color(look.tint));
        if (look.emissive) m.emissive.setHex(look.emissive);
        m.userData.baseColor = m.color.clone();
        m.userData.baseEmissive = m.emissive.clone();
        if (look.ghost) {
          m.transparent = true;
          m.opacity = 0.62;
          m.depthWrite = false;
        }
      }
      const attach = (bone, piece) => {
        const b = this.body.getObjectByName(bone);
        const w = piece && assets.piece('weapons', piece);
        if (b && w) b.add(w);
      };
      attach('handslotr', look.weapon);
      attach('handslotl', look.shield);
      this.anim = new Animator(this.body, assets.clips);
      this.skeletal = look.model.startsWith('skeleton');
      this.height = 1.35 * (look.scale || 1);
    } else {
      const beast = type === 'WOLF' ? Beasts.wolf() : type === 'SPIDER' ? Beasts.spider() : type === 'SPIDER_QUEEN' ? Beasts.spider(2.2, true)
        : type === 'BAT' ? Beasts.bat() : Beasts.slime();
      this.beast = beast;
      this.root.add(beast.root);
      this.height = beast.height;
      this.mats = [];
      beast.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.userData.baseColor = o.material.color.clone(); o.material.userData.baseEmissive = o.material.emissive ? o.material.emissive.clone() : null; this.mats.push(o.material); } });
    }
  }

  update(e, dt, ground, t) {
    const x = e[E.X], y = e[E.Y];
    const size = e[E.SIZE];
    const lift = this.look && this.look.float ? this.look.float + Math.sin(t * 2 + this.uid) * 0.08 : 0;
    this.root.position.set(x, ground(x, y) + lift, y);
    this.root.scale.setScalar(size);
    const target = Math.atan2(e[E.FX], e[E.FY]);
    this.yaw = angleDamp(this.yaw, target, 10, dt);
    this.root.rotation.y = this.yaw;
    const moving = e[E.MOVING] === 1;
    const wind = e[E.WIND];
    const flags = e[E.FLAGS];
    const stunned = (flags & EF.STUN) !== 0, frozen = (flags & EF.FROZEN) !== 0;
    if (this.anim) {
      const a = this.anim;
      if (wind > 0) {
        // Wind up: hold the attack pose in step with the game's telegraph, then let it swing through.
        const name = this.type === 'CULTIST' || this.type === 'IMP' ? 'Spellcast_Shoot' : this.look.model === 'barbarian' ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop';
        const act = a.play(name, { loop: false, fade: 0.1 });
        if (act) {
          act.paused = true;
          act.time = wind * act.getClip().duration * 0.42;
        }
      } else if (this.lastWind > 0 && a.current) {
        a.current.paused = false;
        a.current.timeScale = 1.4;
      } else if (a.current && a.current.loop === THREE.LoopOnce && a.current.isRunning()) {
        // let the swing finish
      } else if (stunned || frozen) {
        a.play('Hit_B', { loop: false, speed: frozen ? 0.05 : 1 });
      } else if (moving) {
        a.play(this.skeletal ? 'Walking_D_Skeletons' : 'Running_A', { speed: this.skeletal ? 1.3 : 1.1 });
      } else {
        a.play(this.skeletal ? 'Idle_Combat' : 'Idle', { fade: 0.3 });
      }
      a.update(frozen ? dt * 0.1 : dt);
    } else if (this.beast) {
      this.beast.update(frozen ? 0 : dt, moving, wind, 1);
    }
    this.lastWind = wind;
    // Status colours and the white flash of a hit.
    const flash = e[E.FLASH];
    for (const m of this.mats) {
      const base = m.userData.baseColor;
      m.color.copy(base);
      if (frozen) m.color.multiply(FROZEN);
      else if (flags & EF.POISON) m.color.multiply(POISONED);
      if (m.emissive) {
        if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive); else m.emissive.setRGB(0, 0, 0);
        if (flash > 0) m.emissive.addScalar(Math.min(1, flash / 0.12) * 0.45);
        if (flags & EF.SHIELD) m.emissive.add(SHIELD_GLOW);
      }
    }
  }

  die() {
    this.deadTime = 0;
    if (this.anim) this.anim.play(this.skeletal ? 'Death_C_Skeletons' : 'Death_A', { loop: false, fade: 0.1, speed: 1.3 });
  }

  /** Plays out the death, then sinks into the ground; returns false when gone. */
  updateDead(dt) {
    this.deadTime += dt;
    if (this.anim) this.anim.update(dt);
    if (this.beast) {
      this.root.rotation.z = Math.min(1.6, this.deadTime * 4);
      this.root.position.y -= dt * 0.1;
    }
    if (this.deadTime > 1.6) this.root.position.y -= dt * 0.5;
    return this.deadTime < 3.2;
  }
}

const FROZEN = new THREE.Color(0.6, 0.85, 1.3);
const POISONED = new THREE.Color(0.7, 1.2, 0.6);
const SHIELD_GLOW = new THREE.Color(0.35, 0.28, 0.05);

class Townsfolk {
  constructor(assets, kind) {
    const model = { SMITH: 'barbarian', ELDER: 'mage', VILLAGER_F: 'rogue', VILLAGER_M: 'knight' }[kind];
    this.kind = kind;
    this.root = new THREE.Group();
    this.body = assets.character(model);
    this.body.scale.setScalar(CHAR_SCALE);
    this.root.add(this.body);
    const mats = ownMaterials(this.body);
    const hidden = [...(GEAR[model] || []), 'Knight_Helmet', 'Knight_Cape', 'Mage_Cape', 'Rogue_Cape', 'Barbarian_Cape', 'Barbarian_Hat'];
    const keep = kind === 'SMITH' ? ['1H_Axe'] : kind === 'ELDER' ? ['2H_Staff'] : [];
    this.body.traverse((o) => { if (o.isMesh && hidden.includes(o.name)) o.visible = keep.includes(o.name); });
    const tint = { SMITH: 0xd8b8a0, ELDER: 0xc8c8d8, VILLAGER_F: 0xe8c8b0, VILLAGER_M: 0xb8d0a0 }[kind];
    for (const m of mats) m.color.multiply(new THREE.Color(tint));
    this.anim = new Animator(this.body, assets.clips);
    this.yaw = 0;
  }

  update(n, dt, ground) {
    const x = n[2], y = n[3];
    this.root.position.set(x, ground(x, y), y);
    this.yaw = angleDamp(this.yaw, Math.atan2(n[4], n[5]), 8, dt);
    this.root.rotation.y = this.yaw;
    if (n[6] === 1) this.anim.play('Walking_A', { speed: 1 });
    else this.anim.play(this.kind === 'SMITH' ? 'Interact' : 'Idle', { fade: 0.4 });
    this.anim.update(dt);
  }
}

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0x2a64c8, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });

/** Frozen, glowing copies of the hero's pose left behind by dodges and charges. */
class Afterimages {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.live = new Map();
    this.source = null;
  }

  bones(root) {
    const list = [];
    root.traverse((o) => { if (o.isBone) list.push(o); });
    return list;
  }

  update(gh, hero, ground) {
    if (this.source !== hero) {
      for (const g of this.pool) this.scene.remove(g.root);
      this.pool = [];
      this.live.clear();
      this.source = hero;
    }
    const seen = new Set();
    for (let i = gh.length - 1; i >= 0; i -= 2) {
      const [x, y, age] = gh[i];
      const key = x.toFixed(2) + ',' + y.toFixed(2);
      seen.add(key);
      let g = this.live.get(key);
      if (!g) {
        g = this.pool.find((p) => !p.used);
        if (!g) {
          if (this.pool.length >= 10) continue;
          const root = new THREE.Group();
          const body = SkeletonUtils.clone(hero.body);
          body.traverse((o) => { if (o.isMesh) { o.material = GHOST_MAT.clone(); o.castShadow = false; o.receiveShadow = false; } });
          root.add(body);
          g = { root, body, bones: this.bones(body), src: this.bones(hero.body), used: false };
          this.pool.push(g);
          this.scene.add(root);
        }
        g.used = true;
        g.src.forEach((b, i) => { const d = g.bones[i]; if (d) { d.position.copy(b.position); d.quaternion.copy(b.quaternion); d.scale.copy(b.scale); } });
        g.body.scale.copy(hero.body.scale);
        g.body.traverse((o) => { if (o.isMesh) { const src = hero.body.getObjectByName(o.name); o.visible = src ? src.visible : o.visible; } });
        g.root.rotation.y = hero.root.rotation.y;
        g.root.position.set(x, ground(x, y), y);
        this.live.set(key, g);
      }
      g.root.visible = true;
      const a = Math.max(0, 1 - age / 0.3);
      g.body.traverse((o) => { if (o.isMesh) o.material.opacity = 0.14 * a * a; });
    }
    for (const [key, g] of this.live) {
      if (!seen.has(key)) {
        g.used = false;
        g.root.visible = false;
        this.live.delete(key);
      }
    }
  }
}

/** Every living thing in the scene, kept in step with the game's frames. */
export class Actors {
  constructor(assets, scene) {
    this.assets = assets;
    this.scene = scene;
    this.hero = null;
    this.enemies = new Map();
    this.dying = [];
    this.npcs = new Map();
    this.merchant = null;
    this.afterimages = new Afterimages(scene);
  }

  reset() {
    for (const m of this.enemies.values()) this.scene.remove(m.root);
    for (const m of this.dying) this.scene.remove(m.root);
    for (const n of this.npcs.values()) this.scene.remove(n.root);
    if (this.merchant) this.scene.remove(this.merchant.root);
    this.enemies.clear();
    this.dying = [];
    this.npcs.clear();
    this.merchant = null;
  }

  placeMerchant(level, ground) {
    if (!level.mer) return;
    const m = new Townsfolk(this.assets, 'VILLAGER_M');
    m.body.traverse((o) => { if (o.isMesh && o.name === 'Knight_Helmet') o.visible = false; });
    m.root.position.set(level.mer[0], ground(level.mer[0], level.mer[1]), level.mer[1]);
    this.scene.add(m.root);
    this.merchant = m;
  }

  update(f, dt, ground) {
    const p = f.p;
    const cls = HERO[p[P.CLS]], wpn = WEAPON[p[P.WPN]];
    if (!this.hero || this.hero.cls !== cls || this.hero.weapon !== wpn) {
      if (this.hero) this.scene.remove(this.hero.root);
      this.hero = new Hero(this.assets, cls, wpn);
      this.scene.add(this.hero.root);
    }
    this.hero.update(p, dt, ground);
    this.afterimages.update(f.gh, this.hero, ground);

    const seen = new Set();
    for (const e of f.e) {
      const uid = e[E.UID];
      seen.add(uid);
      let m = this.enemies.get(uid);
      if (!m) {
        m = new Monster(this.assets, ENEMY[e[E.TYPE]], uid);
        this.enemies.set(uid, m);
        this.scene.add(m.root);
      }
      m.update(e, dt, ground, f.t);
    }
    for (const [uid, m] of this.enemies) {
      if (!seen.has(uid)) {
        this.enemies.delete(uid);
        m.die();
        this.dying.push(m);
      }
    }
    this.dying = this.dying.filter((m) => {
      if (m.updateDead(dt)) return true;
      this.scene.remove(m.root);
      return false;
    });

    const npcSeen = new Set();
    for (const n of f.n) {
      npcSeen.add(n[0]);
      let a = this.npcs.get(n[0]);
      if (!a) {
        a = new Townsfolk(this.assets, NPC[n[1]]);
        this.npcs.set(n[0], a);
        this.scene.add(a.root);
      }
      a.update(n, dt, ground);
    }
    for (const [uid, a] of this.npcs) if (!npcSeen.has(uid)) { this.scene.remove(a.root); this.npcs.delete(uid); }
    if (this.merchant) this.merchant.anim.play('Idle'), this.merchant.anim.update(dt);
  }

  /** Head height above the ground for labels and health bars. */
  heightOf(uid) {
    const m = this.enemies.get(uid);
    return m ? m.height * m.root.scale.x : 1.4;
  }
}
