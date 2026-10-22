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

/**
 * Walk and run clips: ground covered per second at timeScale 1 and CHAR_SCALE (how fast a planted toe slides back),
 * and where in the cycle the left foot lands, both measured from anims.glb, so the legs can match the actual speed and
 * one gait can take over from another in step. 'Brisk' is half Walking_A, half Running_B: the two share a cycle length.
 */
const GAIT = {
  Walking_A: { speed: 0.44, land: 0.09 },
  Walking_D_Skeletons: { speed: 0.38, land: 0.1 },
  Brisk: { speed: 0.81, blend: ['Walking_A', 'Running_B'] },
  Running_B: { speed: 1.18, land: 0.11 },
  Running_A: { speed: 2.35, land: 0.17 },
  Running_C: { speed: 2.37, land: 0.17 },
};
const HERO_GAITS = ['Walking_A', 'Brisk', 'Running_B', 'Running_A'];
const MONSTER_GAITS = ['Walking_A', 'Brisk', 'Running_B', 'Running_A'];
const SKELETON_GAITS = ['Walking_D_Skeletons', 'Running_B', 'Running_A'];
const NPC_GAITS = ['Walking_A', 'Brisk', 'Running_B'];
/** Preferred playback rate: a touch quicker than authored reads lighter on the feet. */
const PACE = 1.15;

/** Swing timing as fractions of each clip: the wind-up apex (weapon cocked) and the strike. */
const SWING = {
  '1H_Melee_Attack_Chop': [0.45, 0.55],
  '1H_Melee_Attack_Slice_Diagonal': [0.28, 0.39],
  '1H_Melee_Attack_Slice_Horizontal': [0.18, 0.24],
  '1H_Melee_Attack_Stab': [0.19, 0.25],
  '2H_Melee_Attack_Chop': [0.34, 0.48],
  '2H_Melee_Attack_Slice': [0.27, 0.36],
  Dualwield_Melee_Attack_Chop: [0.38, 0.44],
  Dualwield_Melee_Attack_Slice: [0.42, 0.5],
  Dualwield_Melee_Attack_Stab: [0.19, 0.25],
  Spellcast_Shoot: [0.2, 0.28],
  Throw: [0.45, 0.53],
};

/** Monster attacks, alternated from one wind-up to the next. */
const MONSTER_SWINGS = {
  light: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'],
  heavy: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'],
  cast: ['Spellcast_Shoot'],
};

/** Clips that break up a long idle now and then. */
const FIDGETS = {
  hero: ['Idle_Combat'],
  SMITH: ['PickUp', 'Idle'],
  ELDER: ['Idle_Combat'],
  VILLAGER_F: ['PickUp', 'Interact', 'Idle_Combat'],
  VILLAGER_M: ['PickUp', 'Interact', 'Idle_Combat'],
};

/** Bones the legs layer drives (the hips too, so the legs stay attached to a moving pelvis). */
const LEG_TRACK = /^(root|hips|upperleg|lowerleg|foot|toes)/;
/** How much the legs layer outweighs a full-body action on the bones it shares (9 = 90 %). */
const LEG_WEIGHT = 9;
const TAU = Math.PI * 2;

const twins = new Map();
const legClips = new Map();

/** A second clip over the same keyframes, so a clip can restart while its previous run fades out. */
function twinOf(clip) {
  let t = twins.get(clip);
  if (!t) twins.set(clip, t = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks));
  return t;
}

/** The clip's tracks for the hips and legs only. */
function legsOf(clip) {
  let l = legClips.get(clip);
  if (!l) legClips.set(clip, l = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => LEG_TRACK.test(t.name))));
  return l;
}

function ease(w) {
  return w * w * (3 - 2 * w);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Turns yaw toward target, easing in but never faster than rate rad/s; snap allows an instant flip past 150°. */
function turnToward(yaw, target, dt, rate, snap) {
  let d = target - yaw;
  d -= Math.round(d / TAU) * TAU;
  if (snap && Math.abs(d) > 2.62) return target;
  const step = d * (1 - Math.exp(-14 * dt)), max = rate * dt;
  const next = yaw + (step > max ? max : step < -max ? -max : step);
  return next - Math.round(next / TAU) * TAU;
}

/**
 * Crossfading animation player over the shared clip library. Weights are kept summed to one (eased crossfades,
 * no bind pose showing through), a restarted clip blends from its previous run, walks and runs swap in step, and a
 * legs-only layer can keep the feet walking under a swing.
 */
class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    this.current = null;
    this.name = '';
    /** Second clip blended into the current state (the run half of a brisk walk). */
    this.partner = null;
    /**
     * Actions with any weight. Each carries w (fade 0..1), rate (fade per second), on (part of the current state),
     * share and m (its target and actual part of that state), legs (a legs-only layer) and inLive.
     */
    this.live = [];
    this.legs = null;
    this.legsOn = false;
    /** Ground speed in units per second, from position changes. */
    this.speed = 0;
    this.lastX = NaN;
    this.lastY = 0;
    this.dist = 0;
    this.time = 0;
    this.gait = '';
    this.pace = 1;
    /** Seconds spent in the current looped idle, and when to fidget. */
    this.still = 0;
    this.fidgetAt = 6 + Math.random() * 4;
  }

  /** Crossfades to a clip; restart plays it again from the start (or from `at` seconds) even if it is showing. */
  play(name, { loop = true, fade = 0.18, speed = 1, restart = false, at = 0 } = {}) {
    return this.cue(name, fade, speed, loop, restart, at);
  }

  /** play() without the options object, for calls made every frame. */
  cue(name, fade = 0.18, speed = 1, loop = true, restart = false, at = 0) {
    const clip = this.clips[name];
    if (!clip) return null;
    const rate = 1 / Math.max(0.01, fade);
    if (this.partner) {
      this.partner.on = false;
      this.partner.rate = rate;
      this.partner = null;
    }
    if (this.name === name && !restart) {
      this.current.timeScale = speed;
      this.current.share = 1;
      return this.current;
    }
    const next = this.fresh(clip, loop && !restart);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    if (at > 0) next.time = at;
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.legs || a === next) continue;
      a.on = false;
      a.rate = rate;
    }
    next.on = true;
    next.rate = rate;
    next.share = 1;
    if (!this.current) next.w = next.m = 1;
    this.current = next;
    this.name = name;
    this.still = 0;
    return next;
  }

  /** An action for clip ready to fade in: a looping one still fading out resumes where it is, anything else starts over. */
  fresh(clip, resume) {
    let a = Animator.prep(this.mixer.clipAction(clip));
    if (a.inLive) {
      if (resume) return a;
      // Restarting a clip that still shows: use its twin so the old run eases away instead of snapping.
      const b = Animator.prep(this.mixer.clipAction(twinOf(clip)));
      if (!b.inLive || b.w < a.w) a = b;
    }
    this.enlist(a);
    if (GAIT[clip.name]) a.time = this.inStep(clip, a);
    return a;
  }

  /** Starts an action from its first frame, adding it to the live list if it is not there yet. */
  enlist(a) {
    a.reset();
    if (!a.inLive) {
      a.inLive = true;
      a.w = 0;
      a.m = 1;
      a.play();
      this.live.push(a);
    }
  }

  static prep(a) {
    if (a.w === undefined) {
      a.w = 0;
      a.m = 1;
      a.share = 1;
      a.on = false;
      a.rate = 5;
      a.legs = false;
      a.inLive = false;
    }
    return a;
  }

  /** Clip time that puts a walk or run in step with the strongest one already showing (0 if none). */
  inStep(clip, self) {
    let best = null, bw = 0;
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a === self || !GAIT[a.getClip().name]) continue;
      const w = a.w * (a.legs ? 1 : a.m);
      if (w > bw) { best = a; bw = w; }
    }
    if (!best) return 0;
    const from = best.getClip();
    const phase = best.time / from.duration - GAIT[from.name].land + GAIT[clip.name].land;
    return (phase - Math.floor(phase)) * clip.duration;
  }

  /**
   * Measures the actor's ground speed from where the game puts it: distance over time, both summed over the last
   * fraction of a second, so repeated or skipped frames even out.
   */
  track(x, y, dt) {
    if (this.lastX === this.lastX) {
      const dx = x - this.lastX, dy = y - this.lastY;
      const d = Math.sqrt(dx * dx + dy * dy);
      const keep = Math.exp(-dt / 0.2);
      // A jump of two tiles is a teleport or a new level, not a step.
      this.dist = this.dist * keep + (d < 2 ? d : 0);
      this.time = this.time * keep + dt;
      this.speed = this.time > 0 ? this.dist / this.time : 0;
    }
    this.lastX = x;
    this.lastY = y;
    return this.speed;
  }

  /** Picks the gait whose natural pace best fits speed v at scale k (sticking a little to the current one) and sets this.pace. */
  pick(gaits, v, k) {
    let best = gaits[0], cost = Infinity, pace = 1;
    for (let i = 0; i < gaits.length; i++) {
      const p = v / (GAIT[gaits[i]].speed * k);
      const c = Math.abs(Math.log(Math.max(0.05, p) / PACE)) - (gaits[i] === this.gait ? 0.2 : 0);
      if (c < cost) { cost = c; best = gaits[i]; pace = p; }
    }
    this.gait = best;
    this.pace = clamp(pace, 0.5, 2.6);
    return best;
  }

  /** Walks or runs at speed v (units per second) for an actor at scale k, with the legs matching the ground. */
  locomote(gaits, v, k, fade = 0.2) {
    const name = this.pick(gaits, v, k);
    const blend = GAIT[name].blend;
    if (!blend) return this.cue(name, fade, this.pace);
    const a = this.cue(blend[0], fade, this.pace);
    const clip = this.clips[blend[1]];
    if (!a || !clip) return a;
    const b = this.fresh(clip, true);
    if (b.w === 0) b.m = 0.5;
    b.setLoop(THREE.LoopRepeat, Infinity);
    b.clampWhenFinished = false;
    b.on = true;
    b.rate = a.rate;
    b.share = 0.5;
    b.timeScale = this.pace;
    a.share = 0.5;
    this.partner = b;
    return a;
  }

  /** Keeps the legs walking or running under an upper-body action for this frame (call it every frame); null hands them back. */
  legsFor(gaits, v, k) {
    if (!gaits) {
      this.legsOn = false;
      return;
    }
    let name = this.pick(gaits, v, k);
    if (GAIT[name].blend) {
      name = GAIT[name].blend[1];
      this.pace = clamp(v / (GAIT[name].speed * k), 0.5, 2.6);
    }
    const clip = this.clips[name];
    if (!clip) return;
    const leg = legsOf(clip);
    const l = Animator.prep(this.mixer.clipAction(leg));
    l.legs = true;
    if (l !== this.legs) {
      if (!l.inLive) {
        this.enlist(l);
        l.time = this.inStep(leg, l);
      }
      this.legs = l;
    }
    l.timeScale = this.pace;
    l.rate = 8;
    this.legsOn = true;
  }

  /** Idles on `name`, letting a one-shot finish first and now and then playing one of `extras` once. */
  idle(name, extras, dt, fade = 0.25) {
    const c = this.current;
    if (this.name !== name && c && c.loop === THREE.LoopOnce && c.isRunning()) return c;
    if (this.name === name) {
      this.still += dt;
      if (extras && this.still > this.fidgetAt) {
        this.fidgetAt = 7 + Math.random() * 6;
        return this.cue(extras[(Math.random() * extras.length) | 0], 0.45, 1, false, true);
      }
    }
    return this.cue(name, fade);
  }

  update(dt) {
    const live = this.live;
    let total = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const a = live[i];
      if (a.legs ? a === this.legs && this.legsOn : a.on) {
        a.w = Math.min(1, a.w + dt * a.rate);
        if (a.m < a.share) a.m = Math.min(a.share, a.m + dt * a.rate);
        else if (a.m > a.share) a.m = Math.max(a.share, a.m - dt * a.rate);
      } else if ((a.w -= dt * a.rate) <= 0) {
        a.w = 0;
        a.inLive = false;
        a.stop();
        live.splice(i, 1);
        if (a === this.legs) this.legs = null;
        continue;
      }
      if (!a.legs) total += ease(a.w) * a.m;
    }
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      a.weight = a.legs ? ease(a.w) * LEG_WEIGHT : total > 1e-4 ? ease(a.w) * a.m / total : a === this.current ? 1 : 0;
    }
    this.legsOn = false;
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
    case 'knight': return weapon === 'SPEAR' ? ['1H_Melee_Attack_Stab', '2H_Melee_Attack_Slice'] : ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal'];
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
    const act = p[P.ACT];
    const swing = p[P.SWING];
    const a = this.anim;
    const v = a.track(x, y, dt);
    // Turn at a limited rate (flipping at once only when standing still) and lean into turns and sprints.
    const busy = act === ACT.ATTACK || act === ACT.CAST || act === ACT.DODGE || act === ACT.SWEEP;
    const before = this.yaw;
    this.yaw = turnToward(this.yaw, Math.atan2(p[P.FX], p[P.FY]), dt, busy ? 22 : 15, v < 0.3 && act !== ACT.RUN);
    this.root.rotation.y = this.yaw;
    let turned = this.yaw - before;
    turned -= Math.round(turned / TAU) * TAU;
    this.spin = damp(this.spin || 0, dt > 0 && Math.abs(turned) < 2 ? turned / dt : 0, 12, dt);
    const k = this.body.scale.x / CHAR_SCALE;
    const from = this.act, entered = act !== from;
    this.sinceSwing = (this.sinceSwing || 0) + dt;
    let legs = false;
    switch (act) {
      case ACT.DEAD: a.cue('Death_A', 0.2, 1, false); break;
      case ACT.LEAP: a.cue('Jump_Full_Short', 0.08, 1.6, false, entered); break;
      case ACT.CHARGE: a.cue('Running_C', 0.1, 2.2); break;
      case ACT.WHIRLWIND: a.cue('2H_Melee_Attack_Spinning', 0.1, 1.3); break;
      case ACT.SWEEP: a.cue('2H_Melee_Attack_Spin', 0.08, 1.8, false, entered); break;
      case ACT.DODGE: a.cue('Dodge_Forward', 0.06, 1.7, false, entered); break;
      case ACT.CAST:
        if (entered) {
          const name = this.model === 'mage' ? 'Spellcast_Shoot' : this.model === 'rogue' ? 'Throw' : 'Spellcast_Raise';
          if (SWING[name]) this.strike(name, 0.6, 0.08);
          else a.play(name, { loop: false, speed: 1.8, fade: 0.1, restart: true });
        }
        legs = true;
        break;
      case ACT.ATTACK:
        // A new swing starts when the timer jumps back up; after a pause the combo starts over.
        if (swing > this.lastSwing + 0.01 || entered) {
          if (this.sinceSwing > 1.2) this.attackIndex = 0;
          this.strike(this.attacks[this.attackIndex++ % this.attacks.length], Math.max(0.3, p[P.SWING_TIME] * 1.9), 0.05);
          this.sinceSwing = 0;
        }
        legs = true;
        break;
      case ACT.HURT:
        if (entered) a.play('Hit_A', { loop: false, speed: 1.5, fade: 0.06, restart: true });
        legs = true;
        break;
      case ACT.RUN: a.locomote(HERO_GAITS, v, k, from === ACT.ATTACK || from === ACT.CAST || from === ACT.HURT ? 0.12 : 0.18); break;
      default: a.idle(this.model === 'barbarian' && this.attacks[0].startsWith('2H') ? '2H_Melee_Idle' : 'Idle', FIDGETS.hero, dt, from === ACT.RUN ? 0.18 : 0.25);
    }
    // Swings strike fast and follow through calmer; the feet keep running under them while the hero moves.
    if (a.current && a.current === this.swingAction) a.current.timeScale = a.current.time < this.strikeAt ? this.swingFast : this.swingSlow;
    a.legsFor(legs && v > (a.legs ? 0.6 : 0.9) ? HERO_GAITS : null, v, k);
    const running = act === ACT.RUN || act === ACT.CHARGE || a.legsOn;
    const roll = running ? clamp(-this.spin * v * 0.012, -0.2, 0.2) : 0;
    const pitch = act === ACT.CHARGE ? 0.1 : running ? clamp((v - 3) * 0.05, 0, 0.12) : 0;
    this.body.rotation.z = damp(this.body.rotation.z, roll, 8, dt);
    this.body.rotation.x = damp(this.body.rotation.x, pitch, 6, dt);
    this.lastSwing = swing;
    // A short red flash when a hit lands.
    if (act === ACT.HURT && this.act !== ACT.HURT) this.hurtFlash = 1;
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 5);
    this.act = act;
    a.update(dt);
    // Stealth turns the hero into a shimmer; hurt flashes red.
    const flags = p[P.FLAGS];
    const stealth = (flags & 1) !== 0;
    for (const m of this.mats) {
      m.transparent = stealth;
      m.opacity = stealth ? 0.32 : 1;
      m.emissive.setRGB(0.35 * this.hurtFlash, 0.02 * this.hurtFlash, 0);
    }
  }

  /** Starts a swing or cast late in its wind-up so the blow lands just after the press, then follows through over `length` seconds. */
  strike(name, length, fade) {
    const clip = this.anim.clips[name];
    if (!clip) return;
    const t = SWING[name] || SWING.Spellcast_Shoot;
    const d = clip.duration, from = t[0] * 0.7 * d, at = t[1] * d;
    this.swingAction = this.anim.play(name, { loop: false, restart: true, fade, at: from });
    this.strikeAt = at;
    this.swingFast = clamp((at - from) / 0.14, 1, 2.6);
    this.swingSlow = clamp((d - at) / Math.max(0.15, length - (at - from) / this.swingFast), 0.6, 2.4);
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
      const v = a.track(x, y, dt);
      const k = this.body.scale.x * size / CHAR_SCALE;
      const swinging = a.current && a.current.loop === THREE.LoopOnce && a.current.isRunning();
      if (wind > 0) {
        // Wind up: ease into the cocked pose in step with the game's telegraph and hold it there...
        if (this.lastWind <= 0 || !this.swingName) {
          const pool = this.type === 'CULTIST' || this.type === 'IMP' ? MONSTER_SWINGS.cast
            : this.look.model === 'barbarian' || (this.look.gear && this.look.gear[0].startsWith('2H')) ? MONSTER_SWINGS.heavy : MONSTER_SWINGS.light;
          this.swings = (this.swings || 0) + 1;
          this.swingName = pool[(this.swings - 1) % pool.length];
        }
        const act = a.cue(this.swingName, 0.12, 1, false, this.lastWind <= 0);
        if (act) {
          const u = 1 - wind;
          act.paused = true;
          act.time = (1 - u * u * u) * SWING[this.swingName][0] * act.getClip().duration;
        }
      } else if (this.lastWind > 0 && a.current) {
        // ...then let go with a fast swing.
        a.current.paused = false;
        a.current.timeScale = 1.6;
      } else if (swinging && !(moving && a.current.time > 0.75 * a.current.getClip().duration)) {
        // let the swing finish (its tail blends into walking)
      } else if (stunned || frozen) {
        a.cue('Hit_B', 0.18, frozen ? 0.05 : 1, false);
      } else if (moving) {
        if (this.look.float) a.cue('Walking_D_Skeletons', 0.25, 0.9);
        else a.locomote(this.skeletal ? SKELETON_GAITS : MONSTER_GAITS, v, k, 0.2);
      } else {
        a.cue(this.skeletal ? 'Idle_Combat' : 'Idle', 0.25);
      }
      // The feet keep walking under a swing while the monster moves.
      if ((wind > 0 || swinging) && moving && v > 0.4 && !this.look.float) a.legsFor(this.skeletal ? SKELETON_GAITS : MONSTER_GAITS, v, k);
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
    const v = this.anim.track(x, y, dt);
    if (n[6] === 1) this.anim.locomote(NPC_GAITS, v, this.body.scale.x / CHAR_SCALE, 0.3);
    else this.anim.idle(this.kind === 'SMITH' ? 'Interact' : 'Idle', FIDGETS[this.kind], dt, 0.4);
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
