import * as THREE from 'three';
import { ACT, P, E, EF, RARITY_COLORS, hash } from './defs.js';

/**
 * Combat feedback read off the frames the game already sends: weapon swing trails, sparks and a flash ring
 * under every new damage number, footstep dust, dodge and charge streaks, death bursts and loot pickup
 * sparkles.
 *
 * It costs at most two draw calls: every sprite is one instanced quad batch (premultiplied blending lets
 * glowing and dusty sprites share it) and the trails are one ribbon mesh. Pools have a fixed size, nothing
 * in the update allocates, and everything runs on the game clock (f.t), so a paused or frozen frame holds still.
 */

const MAX_QUADS = 1024;
const MAX_PARTS = 320;
const HIT_SLOTS = 32;
/** Damage numbers older than this (seconds) have finished their burst. */
const HIT_LIFE = 0.42;
const MAX_ENEMIES = 512;
const MAX_LOOT = 128;
const ARC_SLOTS = 4;
const ARC_SEG = 40;
const TAU = Math.PI * 2;

// Sprite kinds: glow, spark, ring and star add light; puff and chip are alpha-blended.
const K_GLOW = 0, K_SPARK = 1, K_RING = 2, K_PUFF = 3, K_CHIP = 4, K_STAR = 5;

// Pooled particle layout, PS floats each.
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, S0 = 8, S1 = 9, CR = 10, CG = 11, CB = 12,
  CA = 13, KIND = 14, GRAV = 15, DRAG = 16, FLOOR = 17, STRETCH = 18, BOUNCE = 19;
const PS = 20;
// Hit slot layout, HS floats each: live, text key, birth (game time), last text x / y, origin, style, seed.
const H_LIVE = 0, H_KEY = 1, H_BORN = 2, H_TX = 3, H_TY = 4, H_X = 5, H_Y = 6, H_Z = 7, H_STYLE = 8, H_SEED = 9;
const HS = 10;

const SKELETONS = [2, 12];
const GHOST = 8;
/** Trail reach per weapon (SWORD, AXE, MACE, DAGGER, SPEAR, STAFF). */
const REACH = [1.25, 1.35, 1.2, 1.0, 1.55, 1.3];
/** Swing shapes: half the arc's angle, how far it starts open, when the head and tail finish and when it fades. */
const SLASH = { half: 1.25, open: 0.1, head: 0.45, tailFrom: 0.1, tail: 0.55, fadeFrom: 0.5, fadeTo: 0.8 };
const SWEEP = { half: Math.PI, open: 0.08, head: 0.6, tailFrom: 0.15, tail: 0.65, fadeFrom: 0.6, fadeTo: 0.9 };
const SWEEP_TIME = 0.42;

function linear(hex) { return new THREE.Color().setHex(hex); }
/** Trail tints by class: knight steel, barbarian ember, assassin venom, sorceress arcane. */
const CLASS_TINT = [0xdfe9ff, 0xff8a2a, 0x3dffc8, 0xb36bff].map(linear);
const RARITY = RARITY_COLORS.map(linear);
/** Loot kinds other than gear: gold, potion, (gear), shard. */
const LOOT_TINT = [linear(0xffd04a), linear(0xff5370), null, linear(0xc77dff)];
const HIT = linear(0xffd9a0), CRIT = linear(0xffc23a), HURT = linear(0xff3b2a);
const BONE = linear(0xd8cfb4), WISP = linear(0x9fe8ff), DODGE = linear(0xcfe0ff);
const DUST_OUT = linear(0xc4b49c), DUST_IN = linear(0xa29e98);

const QUAD_VS = `
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
void main() {
  // iA: centre and half size; iB: a world-space stretch (the tail trails behind the centre) and kind; iC: rgba.
  vec4 mv = modelViewMatrix * vec4(iA.xyz, 1.0);
  vec2 sv = (modelViewMatrix * vec4(iB.xyz, 0.0)).xy;
  float sl = length(sv);
  vec2 ax = sl > 1e-5 ? sv / sl : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float hl = iA.w + sl * 0.5;
  mv.xy += ax * (position.x * hl - sl * 0.5) + ay * (position.y * iA.w);
  gl_Position = projectionMatrix * mv;
  // Test depth a sprite's size nearer the camera, so puffs are not sliced by the ground they sit on.
  vec4 near = projectionMatrix * vec4(mv.xy, mv.z + iA.w, 1.0);
  gl_Position.z = near.z / near.w * gl_Position.w;
  vUv = position.xy;
  vCol = iC;
  vKind = iB.w;
}`;

const QUAD_FS = `
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
void main() {
  vec2 d = vUv;
  float r = length(d);
  vec3 c = vCol.rgb;
  float a;
  float add = 1.0;
  if (vKind < 0.5) {
    a = exp(-r * r * 4.5) * (1.0 - smoothstep(0.75, 1.0, r));
  } else if (vKind < 1.5) {
    // spark: a white-hot head with its tail fading back along the streak
    float head = d.x * 0.5 + 0.5;
    float w = exp(-d.y * d.y * 6.0);
    a = w * head * head * (1.0 - smoothstep(0.8, 1.0, d.x));
    c = mix(c * 1.8, vec3(2.2), w * w * w * smoothstep(0.4, 0.95, head) * 0.8);
  } else if (vKind < 2.5) {
    float ring = 1.0 - smoothstep(0.0, 0.1, abs(r - 0.82));
    a = ring * ring + exp(-r * r * 5.0) * 0.1;
    c *= 1.3;
  } else if (vKind < 3.5) {
    a = exp(-r * r * 3.0) * (1.0 - smoothstep(0.6, 1.0, r));
    add = 0.0;
  } else if (vKind < 4.5) {
    a = 1.0 - smoothstep(0.5, 0.8, r);
    c *= 1.15 - 0.4 * r;
    add = 0.0;
  } else {
    // star: a four-point glint
    vec2 q = abs(d);
    a = exp(-q.x * 12.0 - q.y * 2.2) + exp(-q.y * 12.0 - q.x * 2.2) + exp(-r * r * 14.0) * 0.8;
    a *= 1.0 - smoothstep(0.85, 1.0, r);
    c = mix(c * 1.7, vec3(2.0), exp(-r * r * 30.0));
  }
  a *= vCol.a;
  gl_FragColor = vec4(c * a, add > 0.5 ? 0.0 : a);
}`;

const ARC_VS = `
attribute vec2 aUv;
attribute vec4 aCol;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = aUv;
  vCol = aCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ARC_FS = `
varying vec2 vUv;
varying vec4 vCol;
void main() {
  // x runs from the trail's tail (0) to the blade (1), y from the hilt side (0) to the tip (1).
  float along = clamp(vUv.x, 0.0, 1.0), across = clamp(vUv.y, 0.0, 1.0);
  float body = smoothstep(0.0, 0.9, across) * (1.0 - smoothstep(0.9, 1.0, across));
  float rim = exp(-(across - 0.9) * (across - 0.9) * 160.0);
  float a = (body * 0.75 + rim * 1.2) * along * sqrt(along) * vCol.a;
  vec3 c = mix(vCol.rgb, vec3(1.0), rim * along * 0.6) * (1.0 + rim * along * 1.2);
  gl_FragColor = vec4(c, a);
}`;

/** A fixed-size batch of camera-facing quads, drawn as one instanced call. */
class QuadBatch {
  constructor(cap) {
    this.cap = cap;
    this.n = 0;
    const geo = this.geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(cap * 4);
    this.b = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 4);
    this.attrs = [
      new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage),
      new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage),
      new THREE.InstancedBufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage),
    ];
    geo.setAttribute('iA', this.attrs[0]);
    geo.setAttribute('iB', this.attrs[1]);
    geo.setAttribute('iC', this.attrs[2]);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: QUAD_FS,
      transparent: true,
      depthWrite: false,
      // Premultiplied: additive sprites write alpha 0, dusty ones cover what is behind them.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  begin() { this.n = 0; }

  add(x, y, z, size, sx, sy, sz, kind, r, g, b, alpha) {
    if (this.n >= this.cap || alpha <= 0.004) return;
    const i = this.n++ * 4, A = this.a, B = this.b, C = this.c;
    A[i] = x; A[i + 1] = y; A[i + 2] = z; A[i + 3] = size;
    B[i] = sx; B[i + 1] = sy; B[i + 2] = sz; B[i + 3] = kind;
    C[i] = r; C[i + 1] = g; C[i + 2] = b; C[i + 3] = alpha;
  }

  end() {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (let i = 0; i < 3; i++) {
      const at = this.attrs[i];
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}

/** Swing state: progress u (0..1) over dur seconds, facing yaw, direction sign, tilt and reach. */
function arcState() {
  return { live: false, shape: SLASH, u: 0, dur: 0.3, yaw: 0, sign: 1, tilt: 0, reach: 1.25, cls: 0 };
}

function smooth01(v) { return v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v); }
function easeOut(v) { if (v <= 0) return 0; if (v >= 1) return 1; const k = 1 - v; return 1 - k * k * k; }

/** 1 for a damage number dealt to an enemy ("37"), 2 for one taken by the hero ("-12"), otherwise 0. */
function damageKind(s) {
  const n = s.length;
  if (n === 0 || n > 7) return 0;
  let i = 0, kind = 1;
  if (s.charCodeAt(0) === 45) {
    if (n === 1) return 0;
    i = 1;
    kind = 2;
  }
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return 0;
  }
  return kind;
}

function textKey(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export class Impact {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    /** Strength of the hardest hit landed this frame (0.55 normal, 1 crit), for the camera to punch with. */
    this.punch = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.quads = new QuadBatch(MAX_QUADS);
    this.group.add(this.quads.mesh);

    // Swing trails: ARC_SLOTS arcs of ARC_SEG quads in one ribbon, refilled while a trail is alive.
    const verts = ARC_SLOTS * (ARC_SEG + 1) * 2;
    this.arcPos = new Float32Array(verts * 3);
    this.arcUv = new Float32Array(verts * 2);
    this.arcCol = new Float32Array(verts * 4);
    const index = new Uint16Array(ARC_SLOTS * ARC_SEG * 6);
    for (let s = 0, k = 0; s < ARC_SLOTS; s++) {
      const base = s * (ARC_SEG + 1) * 2;
      for (let i = 0; i < ARC_SEG; i++, k += 6) {
        const v = base + i * 2;
        index[k] = v; index[k + 1] = v + 1; index[k + 2] = v + 3;
        index[k + 3] = v; index[k + 4] = v + 3; index[k + 5] = v + 2;
      }
    }
    const geo = this.arcGeo = new THREE.BufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aUv', new THREE.BufferAttribute(this.arcUv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.arcCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.arcMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: ARC_VS,
      fragmentShader: ARC_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }));
    this.arcMesh.frustumCulled = false;
    this.arcMesh.renderOrder = 4;
    this.arcMesh.visible = false;
    this.group.add(this.arcMesh);
    this.arcs = 0;
    this.swing = arcState();
    this.prevSwing = arcState();

    this.parts = new Float32Array(MAX_PARTS * PS);
    this.slots = new Float64Array(HIT_SLOTS * HS);
    // Last frame's enemies and loot, to notice the ones that vanish.
    this.enemyUid = new Float64Array(MAX_ENEMIES);
    this.enemyRow = new Float32Array(MAX_ENEMIES * 4);
    this.lootUid = new Float64Array(MAX_LOOT);
    this.lootRow = new Float32Array(MAX_LOOT * 4);
    this.reset();
  }

  /** Forgets everything: a new level starts with no effects and no one to mourn. */
  reset() {
    this.parts.fill(0);
    this.slots.fill(0);
    this.cursor = 0;
    this.enemyN = 0;
    this.lootN = 0;
    this.lastT = -1;
    this.prevAct = -1;
    this.lastSwing = 0;
    this.heroX = NaN;
    this.heroY = 0;
    this.stepIn = 0;
    this.foot = 1;
    this.streakIn = 0;
    this.spin = 0;
    this.swing.live = false;
    this.prevSwing.live = false;
  }

  update(f, dt, ground, camera, actors) {
    const p = f.p, hero = actors.hero;
    if (!p || !hero) return;
    // Game time drives everything, so effects pause and slow with the game.
    let gdt = this.lastT < 0 ? 0 : f.t - this.lastT;
    if (!(gdt > 0)) gdt = 0; else if (gdt > 0.1) gdt = 0.1;
    this.lastT = f.t;
    const hp = hero.root.position;
    const act = p[P.ACT];
    // A jump in the hero's position means a new level or a teleport: whoever vanished did not die.
    const jumped = !(Math.abs(p[P.X] - this.heroX) + Math.abs(p[P.Y] - this.heroY) < 3);
    this.heroX = p[P.X];
    this.heroY = p[P.Y];
    const outdoors = !this.scene.background;
    this.light = outdoors ? 0.4 + 0.6 * (f.dl ?? 1) : 0.55;
    this.dust = outdoors ? DUST_OUT : DUST_IN;

    this.quads.begin();
    this.arcs = 0;
    this.trails(f, p, act, hp, gdt);
    this.motion(p, act, hp, gdt);
    this.deaths(f, ground, jumped);
    this.pickups(f, p, ground, jumped);
    this.hits(f, ground, hp);
    this.simulate(gdt);
    this.quads.end();
    this.endArcs();
    this.prevAct = act;
    this.lastSwing = p[P.SWING];
  }

  // ---- swing trails ----

  trails(f, p, act, hp, gdt) {
    const sw = this.swing;
    const attacking = act === ACT.ATTACK && p[P.SWING_TIME] > 0;
    if (attacking && (this.prevAct !== ACT.ATTACK || p[P.SWING] > this.lastSwing + 0.01 || !sw.live)) {
      this.startArc(p, SLASH, p[P.SWING_TIME]);
    } else if (act === ACT.SWEEP && this.prevAct !== ACT.SWEEP) {
      this.startArc(p, SWEEP, SWEEP_TIME);
    }
    // A slash follows the game's swing timer; sweeps and fading trails run on the clock.
    if (attacking && sw.shape === SLASH) sw.u = 1 - p[P.SWING] / p[P.SWING_TIME];
    else if (sw.live) sw.u += gdt / sw.dur;
    if (sw.live && !this.drawSwing(sw, hp)) sw.live = false;
    const old = this.prevSwing;
    if (old.live) {
      old.u += gdt / old.dur;
      if (!this.drawSwing(old, hp)) old.live = false;
    }

    // Whirlwind: a full ring of two blades chasing each other round the hero.
    if (act === ACT.WHIRLWIND) this.spin = 1;
    else if (this.spin > 0) this.spin = Math.max(0, this.spin - gdt * 6);
    if (this.spin > 0) {
      const cls = p[P.CLS] | 0, tint = CLASS_TINT[cls] || CLASS_TINT[0];
      const reach = (REACH[p[P.WPN]] || 1.25) + 0.15;
      const phase = f.t * TAU * 2.2 + Math.atan2(p[P.FX], p[P.FY]);
      for (let m = 0; m < 2; m++) {
        const head = phase + m * Math.PI, h = hp.y + 0.72 + m * 0.14;
        this.arc(hp.x, hp.z, head - Math.PI * 0.95, head, h, h, 0.45, reach, tint, 0.85 * this.spin);
      }
    }
  }

  startArc(p, shape, dur) {
    const sw = this.swing, old = this.prevSwing;
    if (sw.live && sw.u < shape.fadeTo) Object.assign(old, sw);
    sw.live = true;
    sw.shape = shape;
    sw.u = 0;
    sw.dur = Math.max(0.12, dur);
    sw.yaw = Math.atan2(p[P.FX], p[P.FY]);
    // Alternate the direction and slant of consecutive blows, like the combo animations do.
    sw.sign = -sw.sign;
    sw.tilt = shape === SLASH ? sw.sign * 0.28 : 0.08;
    sw.reach = REACH[p[P.WPN]] || 1.25;
    sw.cls = p[P.CLS] | 0;
  }

  /** Draws one swing at its progress; false once it has faded out. */
  drawSwing(sw, hp) {
    const s = sw.shape, u = sw.u;
    if (u >= s.fadeTo) return false;
    const head = s.open + (1 - s.open) * easeOut(u / s.head);
    const tail = Math.min(head, easeOut((u - s.tailFrom) / s.tail));
    if (head - tail < 0.004) return true;
    // Fades as it ends, and as the tail catches up with the head (no thin sliver left behind).
    const fade = (1 - smooth01((u - s.fadeFrom) / (s.fadeTo - s.fadeFrom))) * smooth01((head - tail) / 0.15);
    const a0 = -s.half, span = 2 * s.half;
    const h = hp.y + 0.8, tilt = sw.tilt;
    this.arc(hp.x, hp.z,
      sw.yaw + sw.sign * (a0 + span * tail), sw.yaw + sw.sign * (a0 + span * head),
      h + tilt * (0.5 - tail) * 2, h + tilt * (0.5 - head) * 2,
      0.35, sw.reach, CLASS_TINT[sw.cls] || CLASS_TINT[0], fade);
    return true;
  }

  /** Queues a ribbon arc around (cx, cz) from angle t0 (tail) to t1 (head), at heights h0 to h1. */
  arc(cx, cz, t0, t1, h0, h1, rIn, rOut, tint, alpha) {
    if (this.arcs >= ARC_SLOTS || alpha <= 0.004) return;
    const pos = this.arcPos, uv = this.arcUv, col = this.arcCol;
    let v = this.arcs++ * (ARC_SEG + 1) * 2;
    for (let i = 0; i <= ARC_SEG; i++, v += 2) {
      const k = i / ARC_SEG, t = t0 + (t1 - t0) * k, h = h0 + (h1 - h0) * k;
      const sx = Math.sin(t), sz = Math.cos(t);
      // The tip edge lifts a touch, so the blade's path reads as a cone rather than a flat disc.
      pos[v * 3] = cx + sx * rIn; pos[v * 3 + 1] = h - 0.05; pos[v * 3 + 2] = cz + sz * rIn;
      pos[v * 3 + 3] = cx + sx * rOut; pos[v * 3 + 4] = h + 0.05; pos[v * 3 + 5] = cz + sz * rOut;
      uv[v * 2] = k; uv[v * 2 + 1] = 0;
      uv[v * 2 + 2] = k; uv[v * 2 + 3] = 1;
      for (let j = 0; j < 8; j += 4) {
        col[v * 4 + j] = tint.r; col[v * 4 + j + 1] = tint.g; col[v * 4 + j + 2] = tint.b; col[v * 4 + j + 3] = alpha;
      }
    }
  }

  endArcs() {
    const n = this.arcs;
    this.arcMesh.visible = n > 0;
    if (!n) return;
    this.arcGeo.setDrawRange(0, n * ARC_SEG * 6);
    const at = this.arcGeo.attributes, used = n * (ARC_SEG + 1) * 2;
    for (let i = 0; i < ARC_ATTRS.length; i += 2) {
      const a = at[ARC_ATTRS[i]];
      a.clearUpdateRanges();
      a.addUpdateRange(0, used * ARC_ATTRS[i + 1]);
      a.needsUpdate = true;
    }
  }

  // ---- footsteps, dodges and charges ----

  motion(p, act, hp, gdt) {
    const fx = p[P.FX], fz = p[P.FY];
    const running = act === ACT.RUN || act === ACT.CHARGE;
    if (running) {
      this.stepIn -= gdt;
      if (this.stepIn <= 0) {
        const speed = p[P.SPEED] || 4;
        this.stepIn = Math.max(this.stepIn + Math.min(0.36, Math.max(0.2, 1.2 / speed)), 0.05);
        this.foot = -this.foot;
        const side = this.foot * 0.13;
        this.puff(hp.x + fz * side - fx * 0.06, hp.y + 0.06, hp.z - fx * side - fz * 0.06, -fx * 0.6, 0.3, -fz * 0.6, act === ACT.CHARGE ? 1.3 : 1);
      }
    } else {
      this.stepIn = 0.08;
    }

    const dodge = act === ACT.DODGE, charge = act === ACT.CHARGE;
    if ((dodge || charge) && this.prevAct !== act) {
      for (let i = 0; i < (charge ? 12 : 9); i++) this.streak(p, hp, charge);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        this.puff(hp.x + Math.sin(a) * 0.2, hp.y + 0.08, hp.z + Math.cos(a) * 0.2, -fx * 1.2 + Math.sin(a) * 0.5, 0.25, -fz * 1.2 + Math.cos(a) * 0.5, 1.2);
      }
      this.streakIn = 0.03;
    }
    if (charge) {
      this.streakIn -= gdt;
      while (this.streakIn <= 0) {
        this.streakIn += 0.03;
        this.streak(p, hp, true);
      }
    }
  }

  /** A soft dust puff at the feet; `big` scales it. */
  puff(x, y, z, vx, vy, vz, big) {
    const d = this.parts, o = this.emit(K_PUFF, x, y, z, vx, vy, vz, 0.5 + Math.random() * 0.2, 0.12 * big, (0.4 + Math.random() * 0.12) * big, this.dust, 0.6, this.light);
    d[o + DRAG] = 2.5;
    d[o + GRAV] = -0.25;
  }

  /** A wind streak flung back from the hero's body. */
  streak(p, hp, charge) {
    const fx = p[P.FX], fz = p[P.FY];
    const side = (Math.random() - 0.5) * 0.7, back = Math.random() * 0.3, up = 0.25 + Math.random() * 1.0;
    const v = 4 + Math.random() * 3;
    const tint = charge ? CLASS_TINT[p[P.CLS] | 0] || CLASS_TINT[0] : DODGE;
    const d = this.parts, o = this.emit(K_SPARK,
      hp.x + fz * side - fx * back, hp.y + up, hp.z - fx * side - fz * back,
      -fx * v + fz * side * 0.8, 0.1, -fz * v - fx * side * 0.8,
      0.2 + Math.random() * 0.12, 0.045, 0.03, tint, charge ? 0.9 : 0.7, 1);
    d[o + DRAG] = 4;
    d[o + STRETCH] = 0.09;
  }

  // ---- deaths and pickups ----

  deaths(f, ground, jumped) {
    const e = f.e, n = Math.min(e.length, MAX_ENEMIES), uid = this.enemyUid, row = this.enemyRow;
    if (!jumped) {
      let at = 0, bursts = 0;
      for (let i = 0; i < this.enemyN; i++) {
        const j = findUid(e, n, uid[i], at);
        if (j >= 0) { at = j; continue; }
        // Gone: a death. Far ones and mass exits (a level swap the hero check missed) are skipped.
        const x = row[i * 4], y = row[i * 4 + 1];
        if (bursts++ < 6 && Math.abs(x - this.heroX) + Math.abs(y - this.heroY) < 24) this.deathBurst(row[i * 4 + 2], x, y, row[i * 4 + 3], ground);
      }
    }
    for (let i = 0; i < n; i++) {
      const r = e[i];
      uid[i] = r[E.UID];
      row[i * 4] = r[E.X]; row[i * 4 + 1] = r[E.Y]; row[i * 4 + 2] = r[E.TYPE];
      row[i * 4 + 3] = (r[E.SIZE] || 1) * (r[E.FLAGS] & EF.BOSS ? 1.6 : 1);
    }
    this.enemyN = n;
  }

  deathBurst(type, x, z, size, ground) {
    const gy = ground(x, z), d = this.parts, k = Math.min(2.2, Math.max(0.7, size));
    if (SKELETONS.includes(type)) {
      // Bones fly apart and clatter onto the floor.
      for (let i = 0; i < Math.round(10 * k); i++) {
        const a = Math.random() * TAU, v = (1.2 + Math.random() * 2) * k;
        const o = this.emit(K_CHIP, x + Math.sin(a) * 0.15, gy + 0.4 + Math.random() * 0.6 * k, z + Math.cos(a) * 0.15,
          Math.sin(a) * v, 2.5 + Math.random() * 2.5, Math.cos(a) * v, 0.9 + Math.random() * 0.4, 0.04 * k, 0.035 * k, BONE, 1, this.light * 0.6);
        d[o + GRAV] = 14;
        d[o + DRAG] = 0.6;
        d[o + FLOOR] = gy + 0.03;
        d[o + BOUNCE] = 0.35;
        d[o + STRETCH] = 0.025;
      }
    } else if (type === GHOST) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, v = 0.6 + Math.random();
        const o = this.emit(K_GLOW, x, gy + 0.6 + Math.random() * 0.6, z, Math.sin(a) * v, 0.8 + Math.random(), Math.cos(a) * v,
          0.6 + Math.random() * 0.3, 0.18, 0.35, WISP, 0.6, 1);
        d[o + DRAG] = 2;
      }
      return;
    }
    for (let i = 0; i < Math.round(6 * k); i++) {
      const a = Math.random() * TAU, v = (0.7 + Math.random() * 0.8) * k;
      const o = this.emit(K_PUFF, x + Math.sin(a) * 0.2, gy + 0.15 + Math.random() * 0.4, z + Math.cos(a) * 0.2,
        Math.sin(a) * v, 0.4 + Math.random() * 0.4, Math.cos(a) * v, 0.65 + Math.random() * 0.3, 0.2 * k, 0.6 * k, this.dust, 0.5, this.light);
      d[o + DRAG] = 2.2;
      d[o + GRAV] = -0.2;
    }
  }

  pickups(f, p, ground, jumped) {
    const lo = f.lo, n = Math.min(lo.length, MAX_LOOT), uid = this.lootUid, row = this.lootRow;
    if (!jumped) {
      let at = 0;
      for (let i = 0; i < this.lootN; i++) {
        const j = findUid(lo, n, uid[i], at);
        if (j >= 0) { at = j; continue; }
        const x = row[i * 4], y = row[i * 4 + 1], dx = x - p[P.X], dy = y - p[P.Y];
        if (dx * dx + dy * dy > 1.5 * 1.5) continue;
        const kind = row[i * 4 + 2];
        const tint = kind === 2 ? RARITY[row[i * 4 + 3]] || RARITY[0] : LOOT_TINT[kind] || RARITY[0];
        this.sparkle(x, ground(x, y), y, tint, kind === 2 ? 1 + row[i * 4 + 3] * 0.15 : 0.8);
      }
    }
    for (let i = 0; i < n; i++) {
      const r = lo[i];
      uid[i] = r[0];
      row[i * 4] = r[2]; row[i * 4 + 1] = r[3]; row[i * 4 + 2] = r[1]; row[i * 4 + 3] = r[5];
    }
    this.lootN = n;
  }

  sparkle(x, gy, z, tint, k) {
    const d = this.parts;
    this.emit(K_GLOW, x, gy + 0.3, z, 0, 1.2, 0, 0.3, 0.3, 0.6 * k, tint, 0.9, 1);
    for (let i = 0; i < Math.round(12 * k); i++) {
      const a = Math.random() * TAU, r = Math.random() * 0.25;
      const o = this.emit(K_STAR, x + Math.sin(a) * r, gy + 0.1 + Math.random() * 0.4, z + Math.cos(a) * r,
        Math.sin(a) * 0.4, 1.8 + Math.random() * 1.8, Math.cos(a) * 0.4, 0.5 + Math.random() * 0.4, 0.09 + Math.random() * 0.05, 0.03, tint, 1, 1);
      d[o + DRAG] = 2.2;
    }
  }

  // ---- hits ----

  /** New damage numbers become hits; each hit's burst is then drawn from its age alone. */
  hits(f, ground, hp) {
    const tx = f.tx, s = this.slots, now = f.t;
    for (let i = 0; i < tx.length; i++) {
      const t = tx[i], age = t[5];
      if (!(age <= HIT_LIFE)) continue;
      const kind = damageKind(t[2]);
      if (!kind) continue;
      const key = textKey(t[2]), born = now - age, x = t[0], y = t[1];
      let found = -1, free = -1, oldest = 0, oldestT = Infinity;
      for (let j = 0; j < HIT_SLOTS; j++) {
        const o = j * HS;
        if (!s[o + H_LIVE]) { if (free < 0) free = j; continue; }
        if (s[o + H_KEY] === key && Math.abs(s[o + H_BORN] - born) < 0.12 && Math.abs(s[o + H_TX] - x) + Math.abs(s[o + H_TY] - y) < 1.5) { found = j; break; }
        if (s[o + H_BORN] < oldestT) { oldestT = s[o + H_BORN]; oldest = j; }
      }
      if (found >= 0) {
        s[found * HS + H_TX] = x;
        s[found * HS + H_TY] = y;
        continue;
      }
      const o = (free >= 0 ? free : oldest) * HS;
      s[o + H_LIVE] = 1;
      s[o + H_KEY] = key;
      s[o + H_BORN] = born;
      s[o + H_TX] = x;
      s[o + H_TY] = y;
      s[o + H_STYLE] = kind === 2 ? 2 : t[4] === 1 ? 1 : 0;
      if (kind !== 2 && age < 0.15) this.punch = Math.max(this.punch, t[4] === 1 ? 1 : 0.55);
      s[o + H_SEED] = (key ^ Math.round(born * 64)) | 0;
      if (kind === 2) {
        s[o + H_X] = hp.x; s[o + H_Y] = hp.y + 0.95; s[o + H_Z] = hp.z;
      } else {
        // Damage numbers spawn a tile above the enemy and arc away; undo that, then snap to the nearest enemy.
        let ex = x, ey = y + 1 + 3.7 * age - 3.75 * age * age, size = 1, best = 1.6;
        const e = f.e;
        for (let j = 0; j < e.length; j++) {
          const r = e[j], dd = Math.abs(r[E.X] - ex) + Math.abs(r[E.Y] - ey);
          if (dd < best) { best = dd; ex = r[E.X]; ey = r[E.Y]; size = r[E.SIZE] || 1; }
        }
        s[o + H_X] = ex; s[o + H_Y] = ground(ex, ey) + 0.55 + 0.45 * Math.min(2.5, size); s[o + H_Z] = ey;
      }
    }

    const q = this.quads;
    for (let j = 0; j < HIT_SLOTS; j++) {
      const o = j * HS;
      if (!s[o + H_LIVE]) continue;
      let a = now - s[o + H_BORN];
      if (a > HIT_LIFE || a < -1) { s[o + H_LIVE] = 0; continue; }
      if (a < 0) a = 0;
      const style = s[o + H_STYLE], big = style === 1;
      const k = big ? 1.5 : style === 2 ? 0.8 : 1;
      const c = big ? CRIT : style === 2 ? HURT : HIT;
      const x = s[o + H_X], y = s[o + H_Y], z = s[o + H_Z];
      if (a < 0.09) {
        const w = 1 - a / 0.09;
        q.add(x, y, z, 0.32 * k * (0.5 + 0.5 * w), 0, 0, 0, K_GLOW, c.r, c.g, c.b, w * 0.9);
      }
      const ra = a / 0.2;
      if (ra < 1) {
        const rad = (0.1 + 0.42 * easeOut(ra)) * k;
        q.add(x, y, z, rad / 0.82, 0, 0, 0, K_RING, c.r, c.g, c.b, (1 - ra) * (1 - ra) * 0.85);
      }
      const seed = s[o + H_SEED];
      const n = big ? 16 : 9;
      for (let i = 0; i < n; i++) {
        const h1 = hash(seed, i, 1), h2 = hash(seed, i, 2), h3 = hash(seed, i, 3);
        const life = 0.18 + 0.2 * h3;
        if (a >= life) continue;
        const th = h1 * TAU, el = (h2 - 0.25) * 1.1, sp = (3.5 + 3.5 * h3) * (big ? 1.35 : 1);
        const dx = Math.cos(el) * Math.sin(th), dy = Math.sin(el), dz = Math.cos(el) * Math.cos(th);
        const decay = Math.exp(-7 * a), travel = sp * (1 - decay) / 7, v = sp * decay;
        const fade = 1 - a / life;
        q.add(x + dx * travel, y + dy * travel - 3 * a * a, z + dz * travel, 0.032 * k,
          dx * v * 0.05, (dy * v - 6 * a) * 0.05, dz * v * 0.05, K_SPARK, c.r, c.g, c.b, fade * fade);
      }
    }
  }

  // ---- particle pool ----

  /** Starts a pooled particle (over the oldest when full); returns its offset for the optional fields. */
  emit(kind, x, y, z, vx, vy, vz, life, s0, s1, color, alpha, light) {
    const o = this.cursor * PS, d = this.parts;
    this.cursor = (this.cursor + 1) % MAX_PARTS;
    d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z;
    d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + AGE] = 0; d[o + LIFE] = life;
    d[o + S0] = s0; d[o + S1] = s1;
    d[o + CR] = color.r * light; d[o + CG] = color.g * light; d[o + CB] = color.b * light; d[o + CA] = alpha;
    d[o + KIND] = kind;
    d[o + GRAV] = 0; d[o + DRAG] = 0; d[o + FLOOR] = 0; d[o + STRETCH] = 0; d[o + BOUNCE] = -1;
    return o;
  }

  simulate(gdt) {
    const d = this.parts, q = this.quads;
    for (let i = 0; i < MAX_PARTS; i++) {
      const o = i * PS, life = d[o + LIFE];
      if (life <= 0) continue;
      const age = d[o + AGE] + gdt;
      if (age >= life) { d[o + LIFE] = 0; continue; }
      d[o + AGE] = age;
      if (gdt > 0) {
        const k = d[o + DRAG] > 0 ? Math.exp(-d[o + DRAG] * gdt) : 1;
        d[o + VX] *= k; d[o + VZ] *= k;
        d[o + VY] = d[o + VY] * k - d[o + GRAV] * gdt;
        d[o + PX] += d[o + VX] * gdt; d[o + PY] += d[o + VY] * gdt; d[o + PZ] += d[o + VZ] * gdt;
        if (d[o + BOUNCE] >= 0 && d[o + PY] < d[o + FLOOR]) {
          d[o + PY] = d[o + FLOOR];
          d[o + VY] = d[o + VY] < -1 ? -d[o + VY] * d[o + BOUNCE] : 0;
          d[o + VX] *= 0.55; d[o + VZ] *= 0.55;
        }
      }
      const u = age / life, kind = d[o + KIND];
      const grow = 1 - (1 - u) * (1 - u);
      let alpha = d[o + CA];
      if (kind === K_PUFF) alpha *= Math.min(1, u * 8) * (1 - u);
      else if (kind === K_CHIP) alpha *= Math.min(1, (1 - u) * 5);
      else if (kind === K_STAR) alpha *= (1 - u) * (0.65 + 0.35 * Math.sin(age * 38 + i));
      else alpha *= (1 - u) * (1 - u);
      const st = d[o + STRETCH];
      q.add(d[o + PX], d[o + PY], d[o + PZ], d[o + S0] + (d[o + S1] - d[o + S0]) * grow,
        d[o + VX] * st, d[o + VY] * st, d[o + VZ] * st, kind, d[o + CR], d[o + CG], d[o + CB], alpha);
    }
  }
}

/** Ribbon attributes and their item sizes. */
const ARC_ATTRS = ['position', 3, 'aUv', 2, 'aCol', 4];

/** Index of the row with this uid, looking from `from` on first (rows keep their order between frames). */
function findUid(rows, n, uid, from) {
  for (let i = from; i < n; i++) if (rows[i][0] === uid) return i;
  for (let i = 0; i < from && i < n; i++) if (rows[i][0] === uid) return i;
  return -1;
}
