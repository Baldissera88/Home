import * as THREE from 'three';
import { E, EF, RARITY_COLORS } from './defs.js';

const FONT_DIR = '../../res/font/';

/** Loads the game's own fonts so labels match the HUD; falls back to system fonts if that fails. */
export async function loadFonts() {
  const faces = [
    new FontFace('Cinzel', `url(${FONT_DIR}cinzel_black.ttf)`, { weight: '900' }),
    new FontFace('Cinzel', `url(${FONT_DIR}cinzel_bold.ttf)`, { weight: '700' }),
    new FontFace('Alegreya Sans', `url(${FONT_DIR}alegreya_sans_bold.ttf)`, { weight: '700' }),
  ];
  await Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff)).catch(() => {})));
}

const css = (argb, alpha = 1) => `rgba(${(argb >>> 16) & 255},${(argb >>> 8) & 255},${argb & 255},${(((argb >>> 24) & 255) / 255) * alpha})`;
const hex = (rgb, alpha = 1) => `rgba(${(rgb >>> 16) & 255},${(rgb >>> 8) & 255},${rgb & 255},${alpha})`;
/** The colour's rgb moved a fraction k towards `to` (255 white, 0 black). */
const blend = (rgb, to, k) => `rgb(${Math.round(((rgb >>> 16) & 255) * (1 - k) + to * k)},${Math.round(((rgb >>> 8) & 255) * (1 - k) + to * k)},${Math.round((rgb & 255) * (1 - k) + to * k)})`;
const serif = (weight, size) => `${weight} ${size.toFixed(1)}px "Cinzel", serif`;
const sans = (size) => `700 ${size.toFixed(1)}px "Alegreya Sans", sans-serif`;

// The overlay is mostly outlined text, which reads fine below the screen's full density and costs
// fill rate in proportion to the pixel count.
const MAX_DPR = 1.5;
const ATLAS = 1024; // sprite atlas size in device pixels
const MAX_LOOT = 12;
const MAX_TEXTS = 40;
const MAX_ELITES = 32;
const MAX_RECTS = 192;
const LN_STEP = Math.log(1.15); // damage text sizes are bucketed in 15% steps so their sprites are reused
const ENTRANCES = ['The Crypt', 'The Caves', 'The Gate of Hell'];
const K_LABEL = 0, K_ELITE = 1, K_PLATE = 2, K_BUBBLE = 3, K_NUM = 4;

/**
 * World-anchored 2D labels drawn on a canvas over the 3D view: damage numbers, health bars over
 * wounded monsters, champion names, speech bubbles and the names of loot on the ground.
 *
 * Every label is painted once into a shared atlas canvas (a sprite, cached per style and text; shelves of
 * the atlas are recycled least recently used first) and stamped with drawImage, so a frame costs a few
 * dozen blits from one texture instead of text layout, strokes and paths. Only the area drawn last frame
 * is cleared, and nothing at all when it was empty.
 */
export class Overlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'overlay';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.mctx = document.createElement('canvas').getContext('2d'); // measures text for new sprites
    this.mctx.textBaseline = 'middle';
    this.v = new THREE.Vector3();
    this.p = { x: 0, y: 0, d: 0 };
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.unit = 1;
    this.frame = 0;
    this.last = 0;
    // Bounds of what the previous frame drew, the only area that needs clearing.
    this.dirty = false;
    this.bx0 = this.by0 = this.bx1 = this.by1 = 0;
    // Label boxes placed this frame (centre x, centre y, width, height) for nudging overlaps apart.
    this.rects = new Float32Array(MAX_RECTS * 4);
    this.nr = 0;
    this.ei = new Int32Array(MAX_ELITES);
    this.eb = new Int32Array(MAX_ELITES);
    this.ex = new Float32Array(MAX_ELITES * 2);
    // Sprite cache: the atlas, its shelves (rows of sprites), spare sprite records and the damage text styles.
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = ATLAS;
    this.actx = this.atlas.getContext('2d');
    this.shelves = [];
    this.shelfY = 0;
    this.free = [];
    this.pd = 1;
    this.nums = new Map();
    // Lagging "damage taken" segment of each enemy's health bar, by uid.
    this.bars = new Map();
    this.barPool = [];
    this.sweepBar = (b, uid) => {
      if (b.seen === this.frame) return;
      this.bars.delete(uid);
      this.barPool.push(b);
    };
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => this.flush());
  }

  resize(w, h, dpr) {
    this.dpr = Math.min(dpr, MAX_DPR);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this.unit = Math.min(w, h) / 400;
    this.dirty = false;
    this.flush();
  }

  /** Drops every cached sprite and rebuilds the styles for the current size. */
  flush() {
    if (!this.w) return;
    this.resetAtlas();
    this.nums.clear();
    const u = this.unit;
    const label = (size, fill, suffix) => ({ kind: K_LABEL, size, font: serif(700, size), fill, suffix, map: new Map() });
    this.entOpen = label(12 * u, '#f2e6c8', '');
    this.entSealed = label(12 * u, '#a09080', ' (sealed)');
    this.elite = { kind: K_ELITE, size: 10 * u, size2: 8 * u, font: serif(700, 10 * u), font2: sans(8 * u), map: new Map() };
    this.bubbleStyle = { kind: K_BUBBLE, size: 10 * u, font: sans(10 * u), map: new Map() };
    const plate = (size, rgb, glow) => ({ kind: K_PLATE, size, font: sans(size), rgb, glow: glow * size, map: new Map() });
    this.plates = RARITY_COLORS.map((rgb, i) => plate(10.5 * u, rgb, i < 3 ? 0 : 0.2 + (i - 3) * 0.2));
    this.gold = plate(9.5 * u, 0xffd54a, 0);
  }

  /** World point to CSS pixels (and camera distance) in a reused object; null when behind the camera or off screen. */
  project(camera, x, y, z) {
    const cp = camera.position, dx = x - cp.x, dy = y - cp.y, dz = z - cp.z;
    const v = this.v.set(x, y, z).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    const sx = (v.x * 0.5 + 0.5) * this.w, sy = (-v.y * 0.5 + 0.5) * this.h;
    if (sx < -80 || sy < -80 || sx > this.w + 80 || sy > this.h + 80) return null;
    const p = this.p;
    p.x = sx;
    p.y = sy;
    p.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return p;
  }

  draw(f, camera, ground, actors, levelInfo) {
    if (!this.w) return;
    const c = this.ctx, now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    this.nr = 0;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.dirty) {
      c.clearRect(this.bx0 - 2, this.by0 - 2, this.bx1 - this.bx0 + 4, this.by1 - this.by0 + 4);
      this.dirty = false;
    }
    this.bx0 = this.by0 = Infinity;
    this.bx1 = this.by1 = -Infinity;
    if (!f) return;
    const unit = this.unit;

    // Entrance names over the dungeon mouths.
    if (levelInfo && levelInfo.ent) {
      const ent = levelInfo.ent;
      for (let i = 0; i < ent.length; i++) {
        const en = ent[i], x = en[0] + 0.5, y = en[1] + 0.5, name = ENTRANCES[en[2]];
        const p = name && this.project(camera, x, ground(x, y) + 2.6, y);
        if (!p || p.d > 18) continue;
        this.blit(this.sprite(en[3] ? this.entOpen : this.entSealed, name), p.x, p.y, 1);
      }
    }

    // Loot names near the hero, the closest ones first.
    const lo = f.lo, hx = f.p[0], hy = f.p[1], lg = this.nr;
    let shown = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < lo.length && shown < MAX_LOOT; i++) {
        const l = lo[i], kind = l[1];
        if ((kind !== 2 && kind !== 0) || !l[7]) continue;
        const x = l[2], y = l[3], d2 = (x - hx) * (x - hx) + (y - hy) * (y - hy);
        if (d2 >= (kind === 2 ? 36 : 12) || (d2 < 6.25) !== (pass === 0)) continue;
        const p = this.project(camera, x, ground(x, y) + (kind === 2 ? 0.45 : 0.35) + l[4], y);
        if (!p) continue;
        const sp = this.sprite(kind === 2 ? this.plates[Math.max(0, Math.min(this.plates.length - 1, l[5] | 0))] : this.gold, l[7]);
        const ny = this.nudge(p.x, p.y, sp.bw, sp.bh, lg, -1);
        c.globalAlpha = kind === 0 ? 0.85 : d2 < 6.25 ? 1 : 0.75;
        this.blit(sp, p.x, ny, 1);
        shown++;
      }
    }
    c.globalAlpha = 1;

    // Health bars, then champion names nudged off the bars and each other.
    const es = f.e, bg = this.nr, d = this.dpr;
    let ne = 0, seen = 0;
    for (let i = 0; i < es.length; i++) {
      const e = es[i], flags = e[E.FLAGS];
      if (flags & EF.BOSS) continue; // the HUD shows the boss bar
      const uid = e[E.UID], hp = Math.max(0, Math.min(1, e[E.HP])), b = this.track(uid, hp, dt);
      seen++;
      const elite = (flags & EF.ELITE) !== 0;
      if (hp >= 0.999 && !elite) continue;
      const x = e[E.X], y = e[E.Y];
      const p = this.project(camera, x, ground(x, y) + actors.heightOf(uid) + 0.25, y);
      if (!p) continue;
      const bw = (elite ? 46 : 32) * unit * Math.min(1.4, 8 / Math.max(4, p.d));
      const w = Math.round(bw * d) / d, h = Math.max(2, Math.round(4 * unit * d)) / d;
      const x0 = Math.round((p.x - w / 2) * d) / d, y0 = Math.round((p.y - h / 2) * d) / d;
      c.fillStyle = 'rgba(0,0,0,0.7)';
      c.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
      if (b.lag > hp) {
        c.fillStyle = 'rgba(255,244,222,0.92)';
        c.fillRect(x0 + w * hp, y0, w * (b.lag - hp), h);
      }
      if (hp > 0) {
        c.fillStyle = elite ? '#ffb340' : '#e53935';
        c.fillRect(x0, y0, w * hp, h);
        c.fillStyle = 'rgba(255,255,255,0.28)';
        c.fillRect(x0, y0, w * hp, h * 0.4);
      }
      this.mark(x0 - 1, y0 - 1, x0 + w + 1, y0 + h + 1);
      if (elite && e[E.NAME] && ne < MAX_ELITES) {
        this.ei[ne] = i;
        this.eb[ne] = this.nr;
        this.ex[ne * 2] = p.x;
        this.ex[ne * 2 + 1] = p.y;
        ne++;
      }
      this.rect(p.x, p.y, w + 2, h + 2);
    }
    if (this.bars.size > seen) this.bars.forEach(this.sweepBar);
    for (let j = 0; j < ne; j++) {
      const sp = this.sprite(this.elite, String(es[this.ei[j]][E.NAME]));
      const x = this.ex[j * 2], y = this.ex[j * 2 + 1] + sp.cy;
      const ny = this.nudge(x, y, sp.bw, sp.bh, bg, this.eb[j]);
      this.blit(sp, x, ny - sp.cy, 1);
    }

    // Villagers' speech.
    const ns = f.n;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], say = n[7];
      if (!say) continue;
      const p = this.project(camera, n[2], ground(n[2], n[3]) + 1.75, n[3]);
      if (p && p.d < 16) this.blit(this.sprite(this.bubbleStyle, say), p.x, p.y, 1);
    }

    // Damage numbers and other floating texts, the newest ones when there are too many: they slam in
    // with an elastic pop, then rise and drift sideways on an arc.
    const tx = f.tx, tg = this.nr;
    for (let i = Math.max(0, tx.length - MAX_TEXTS); i < tx.length; i++) {
      const t = tx[i], x = t[0], y = t[1], age = t[5];
      const a = Math.min(1, 1.4 - age * 1.1);
      if (a <= 0.02 || !t[2]) continue;
      const p = this.project(camera, x, ground(x, y) + 1.35 + age * 0.9, y);
      if (!p) continue;
      const big = t[4] ? 1 : 0;
      const base = (big ? 23 : 15.5) * unit * Math.min(1.25, Math.sqrt(7 / Math.max(4, p.d)));
      const st = this.numStyle(t[3] >>> 0, big, base), sp = this.sprite(st, t[2]);
      const k = Math.min(1, age / 0.55);
      const pop = 1 + (big ? 0.75 : 0.45) * Math.pow(2, -9 * k) * Math.cos(k * 10);
      const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, side = (r - Math.floor(r)) * 2 - 1;
      const sx = p.x + side * 14 * unit * (1 - Math.exp(-2.5 * age)), s0 = base / st.size, s = s0 * pop, sb = s0 * Math.max(1, pop);
      const cy = p.y + sp.cy * sb, ny = this.nudge(sx, cy, sp.bw * sb, sp.bh * sb, tg, -1);
      c.globalAlpha = a;
      this.blit(sp, sx, ny - sp.cy * sb, s);
    }
    c.globalAlpha = 1;
  }

  /** Health bar state for an enemy: the white segment holds briefly after a hit, then drains to the hp. */
  track(uid, hp, dt) {
    let b = this.bars.get(uid);
    if (b === undefined) {
      b = this.barPool.pop() || { lag: 0, last: 0, hold: 0, seen: 0 };
      b.lag = b.last = hp;
      b.hold = 0;
      this.bars.set(uid, b);
    }
    if (hp < b.last - 1e-4) b.hold = 0.38;
    b.last = hp;
    b.seen = this.frame;
    if (hp >= b.lag) {
      b.lag = hp;
      b.hold = 0;
    } else if (b.hold > 0) b.hold -= dt;
    else b.lag = Math.max(hp, b.lag - dt * (0.35 + (b.lag - hp) * 2.5));
    return b;
  }

  /** Remembers a placed box for this frame's overlap checks. */
  rect(x, y, w, h) {
    if (this.nr >= MAX_RECTS) return;
    const i = this.nr++ * 4, r = this.rects;
    r[i] = x;
    r[i + 1] = y;
    r[i + 2] = w;
    r[i + 3] = h;
  }

  /** Moves a box centred at (x, y) up until it clears the boxes placed since `from` (bar `skip` excepted); returns its centre y. */
  nudge(x, y, w, h, from, skip) {
    const r = this.rects, end = this.nr * 4, sk = skip * 4;
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (let i = from * 4; i < end; i += 4) {
        if (i === sk) continue;
        if (Math.abs(x - r[i]) * 2 < w + r[i + 2] && Math.abs(y - r[i + 1]) * 2 < h + r[i + 3]) {
          y = r[i + 1] - (h + r[i + 3]) * 0.5 - 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    this.rect(x, y, w, h);
    return y;
  }

  mark(x0, y0, x1, y1) {
    if (x0 < this.bx0) this.bx0 = x0;
    if (y0 < this.by0) this.by0 = y0;
    if (x1 > this.bx1) this.bx1 = x1;
    if (y1 > this.by1) this.by1 = y1;
    this.dirty = true;
  }

  /** Stamps a sprite with its anchor at (x, y), scaled by s; unscaled ones land on whole device pixels. */
  blit(sp, x, y, s) {
    const w = sp.w * s, h = sp.h * s;
    let x0 = x - sp.ax * s, y0 = y - sp.ay * s;
    if (s === 1) {
      const d = this.dpr;
      x0 = Math.round(x0 * d) / d;
      y0 = Math.round(y0 * d) / d;
    }
    this.ctx.drawImage(this.atlas, sp.sx, sp.sy, sp.cw, sp.ch, x0, y0, w, h);
    this.mark(x0, y0, x0 + w, y0 + h);
  }

  /** Style of a floating text: its colour, weight and size bucket. Sprites are painted larger than the bucket so the pop mostly scales them down. */
  numStyle(col, big, base) {
    const bi = Math.max(0, Math.min(63, Math.round(Math.log(base) / LN_STEP)));
    const key = col * 128 + bi * 2 + big;
    let st = this.nums.get(key);
    if (st === undefined) {
      if (this.nums.size > 96) this.flush();
      const size = Math.exp(bi * LN_STEP) * (big ? 1.5 : 1.2);
      st = { kind: K_NUM, size, font: big ? serif(900, size) : sans(size), col, big, map: new Map() };
      this.nums.set(key, st);
    }
    return st;
  }

  /** The cached sprite of a text in a style, painted on first use. */
  sprite(st, text) {
    let sp = st.map.get(text);
    if (sp === undefined) {
      sp = this.free.pop() || { sx: 0, sy: 0, cw: 0, ch: 0, w: 0, h: 0, ax: 0, ay: 0, cy: 0, bw: 0, bh: 0, style: null, text: '', used: -1, shelf: null };
      this.actx.save();
      switch (st.kind) {
        case K_LABEL: this.paintLabel(sp, st, text); break;
        case K_ELITE: this.paintElite(sp, st, text); break;
        case K_PLATE: this.paintPlate(sp, st, text); break;
        case K_BUBBLE: this.paintBubble(sp, st, text); break;
        default: this.paintNum(sp, st, text);
      }
      this.actx.restore();
      sp.style = st;
      sp.text = text;
      st.map.set(text, sp);
    }
    sp.used = this.frame;
    sp.shelf.used = this.frame;
    return sp;
  }

  /** Finds room for a cw x ch sprite: a shelf of about its height, a new shelf, else the least recently used shelf. */
  place(sp, cw, ch) {
    const hh = Math.ceil((ch + 2) / 8) * 8, ww = cw + 2, shelves = this.shelves;
    let best = null;
    for (let i = 0; i < shelves.length && best === null; i++) {
      const s = shelves[i];
      if (s.h >= hh && s.h <= hh + 16 && s.x + ww <= ATLAS) best = s;
    }
    if (best === null && this.shelfY + hh <= ATLAS) {
      best = { y: this.shelfY, h: hh, x: 0, used: -1, sprites: [] };
      shelves.push(best);
      this.shelfY += hh;
    }
    if (best === null) {
      for (let i = 0; i < shelves.length; i++) {
        const s = shelves[i];
        if (s.h >= hh && s.used < this.frame && (best === null || s.used < best.used)) best = s;
      }
      if (best === null) {
        this.resetAtlas();
        return this.place(sp, cw, ch);
      }
      this.evict(best);
    }
    sp.sx = best.x;
    sp.sy = best.y;
    sp.shelf = best;
    best.x += ww;
    best.sprites.push(sp);
  }

  /** Empties a shelf, dropping its sprites from the cache. */
  evict(shelf) {
    for (const sp of shelf.sprites) {
      if (sp.style) sp.style.map.delete(sp.text);
      sp.style = null;
      this.free.push(sp);
    }
    shelf.sprites.length = 0;
    shelf.x = 0;
  }

  resetAtlas() {
    for (const s of this.shelves) this.evict(s);
    this.shelves.length = 0;
    this.shelfY = 0;
    this.actx.clearRect(0, 0, ATLAS, ATLAS);
  }

  /** Places a sprite of w x h CSS pixels with its anchor at (ax, ay) and returns the atlas context set up to paint it. */
  prep(sp, w, h, ax, ay) {
    // Device pixels, unless the sprite would not fit the atlas.
    const d = this.dpr * Math.min(1, (ATLAS - 4) / (w * this.dpr), (ATLAS - 4) / (h * this.dpr));
    const cw = Math.max(1, Math.ceil(w * d)), ch = Math.max(1, Math.ceil(h * d)), g = this.actx;
    this.place(sp, cw, ch);
    g.clearRect(sp.sx, sp.sy, cw + 2, sp.shelf.h);
    g.beginPath();
    g.rect(sp.sx, sp.sy, cw, ch);
    g.clip();
    g.setTransform(d, 0, 0, d, sp.sx, sp.sy);
    this.pd = d;
    sp.cw = cw;
    sp.ch = ch;
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
    sp.w = cw / d;
    sp.h = ch / d;
    sp.ax = ax;
    sp.ay = ay;
    sp.cy = 0;
    sp.bw = w;
    sp.bh = h;
    return g;
  }

  paintLabel(sp, st, text) {
    const s = st.suffix ? text + st.suffix : text, lw = Math.max(2, st.size * 0.22), m = this.mctx;
    m.font = st.font;
    const tw = m.measureText(s).width, pad = lw / 2 + 1;
    const g = this.prep(sp, tw + pad * 2, st.size * 1.3 + pad * 2, tw / 2 + pad, st.size * 0.65 + pad);
    sp.bw = tw;
    sp.bh = st.size;
    g.font = st.font;
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(s, sp.ax, sp.ay);
    g.fillStyle = st.fill;
    g.fillText(s, sp.ax, sp.ay);
  }

  /** A champion's name with its affix line above, anchored at the centre of its health bar. */
  paintElite(sp, st, text) {
    const k = text.indexOf('|'), name = k < 0 ? text : text.slice(0, k), affix = k < 0 ? '' : text.slice(k + 1);
    const u = this.unit, s1 = st.size, s2 = st.size2, lw1 = Math.max(2, s1 * 0.22), lw2 = Math.max(2, s2 * 0.22), m = this.mctx;
    m.font = st.font;
    const tw1 = m.measureText(name).width;
    m.font = st.font2;
    const tw2 = affix ? m.measureText(affix).width : 0;
    const w = Math.max(tw1 + lw1, tw2 + lw2) + 2, y1 = -9 * u, y2 = -19 * u;
    const top = (affix ? y2 - s2 * 0.65 - lw2 / 2 : y1 - s1 * 0.65 - lw1 / 2) - 1, bottom = y1 + s1 * 0.65 + lw1 / 2 + 1;
    const g = this.prep(sp, w, bottom - top, w / 2, -top);
    sp.cy = (top + bottom) / 2;
    sp.bw = Math.max(tw1, tw2);
    sp.bh = bottom - top - lw1 - 2;
    const x = sp.ax, ny = sp.ay + y1;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.font = st.font;
    g.lineWidth = lw1;
    g.strokeText(name, x, ny);
    const gr = g.createLinearGradient(0, ny - s1 * 0.4, 0, ny + s1 * 0.4);
    gr.addColorStop(0, '#fff2c4');
    gr.addColorStop(0.5, '#ffcf6a');
    gr.addColorStop(1, '#e0952e');
    g.fillStyle = gr;
    g.fillText(name, x, ny);
    if (affix) {
      g.font = st.font2;
      g.lineWidth = lw2;
      g.strokeText(affix, x, sp.ay + y2);
      g.fillStyle = '#c8b8ff';
      g.fillText(affix, x, sp.ay + y2);
    }
  }

  /** A loot name on a dark plate edged in its rarity colour; the rarest ones glow. */
  paintPlate(sp, st, text) {
    const s = st.size, m = this.mctx;
    m.font = st.font;
    const tw = m.measureText(text).width, pw = tw + s * 0.9, ph = s * 1.45, glow = st.glow, pad = glow + 1.5;
    const g = this.prep(sp, pw + pad * 2, ph + pad * 2, pw / 2 + pad, ph / 2 + pad);
    sp.bw = pw;
    sp.bh = ph;
    this.round(g, pad, pad, pw, ph, s * 0.25);
    if (glow) {
      g.shadowColor = hex(st.rgb, 0.75);
      g.shadowBlur = glow * this.pd;
    }
    const gr = g.createLinearGradient(0, pad, 0, pad + ph);
    gr.addColorStop(0, 'rgba(28,22,16,0.86)');
    gr.addColorStop(1, 'rgba(6,4,3,0.78)');
    g.fillStyle = gr;
    g.fill();
    g.shadowBlur = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
    g.strokeStyle = hex(st.rgb, 0.6);
    g.lineWidth = 1;
    g.stroke();
    g.font = st.font;
    g.fillStyle = hex(st.rgb);
    g.fillText(text, sp.ax, sp.ay + 0.5);
  }

  /** A word-wrapped speech bubble whose tail tip is the anchor. */
  paintBubble(sp, st, text) {
    const s = st.size, m = this.mctx, maxW = s * 16, lines = [];
    m.font = st.font;
    let line = '';
    for (const w of text.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (m.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, m.measureText(l).width);
    const lh = s * 1.25, bw = tw + s * 1.2, bh = lines.length * lh + s * 0.7, tail = s * 0.6, pad = 4, d = this.pd;
    const g = this.prep(sp, bw + pad * 2, bh + tail + pad * 2, bw / 2 + pad, pad + bh + tail);
    sp.cy = -tail - bh / 2;
    sp.bw = bw;
    sp.bh = bh;
    const L = pad, T = pad, R = L + bw, B = T + bh, cx = L + bw / 2, r = s * 0.5, tw2 = s * 0.4;
    g.beginPath();
    g.moveTo(L + r, T);
    g.arcTo(R, T, R, B, r);
    g.arcTo(R, B, cx, B, r);
    g.lineTo(cx + tw2, B);
    g.lineTo(cx, B + tail);
    g.lineTo(cx - tw2, B);
    g.arcTo(L, B, L, T, r);
    g.arcTo(L, T, R, T, r);
    g.closePath();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 3 * d;
    g.shadowOffsetY = d;
    g.fillStyle = 'rgba(244,234,210,0.95)';
    g.fill();
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
    g.strokeStyle = 'rgba(90,62,34,0.5)';
    g.lineWidth = 1;
    g.stroke();
    g.font = st.font;
    g.fillStyle = '#2a1e14';
    lines.forEach((l, i) => g.fillText(l, cx, T + s * 0.35 + lh * (i + 0.5)));
  }

  /** A floating text with a dark outline and drop shadow; big ones get a white-to-gold fill and a glow. */
  paintNum(sp, st, text) {
    const S = st.size, big = st.big, col = st.col, m = this.mctx;
    m.font = st.font;
    const mt = m.measureText(text), tw = mt.width, asc = mt.actualBoundingBoxAscent || S * 0.4, desc = mt.actualBoundingBoxDescent || S * 0.4;
    const lw = big ? S * 0.3 : Math.max(2, S * 0.24), glow = big ? S * 0.4 : 0, drop = S * 0.07;
    const pad = lw / 2 + glow + 2, w = tw + pad * 2;
    const g = this.prep(sp, w, S * 1.2 + pad * 2 + drop, w / 2, S * 0.6 + pad);
    // The glyphs' own box (plus half the outline) is what must not overlap.
    sp.bw = tw + lw * 0.5;
    sp.bh = asc + desc + lw * 0.5;
    sp.cy = (desc - asc) / 2;
    const x = sp.ax, y = sp.ay;
    g.font = st.font;
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(text, x, y + drop);
    if (glow) {
      g.shadowColor = css(col, 0.6);
      g.shadowBlur = glow * this.pd;
    }
    g.strokeStyle = 'rgba(14,8,4,0.95)';
    g.strokeText(text, x, y);
    g.shadowBlur = 0;
    g.shadowColor = 'rgba(0,0,0,0)';
    if (big) {
      const gr = g.createLinearGradient(0, y - S * 0.42, 0, y + S * 0.42);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.38, blend(col, 255, 0.45));
      gr.addColorStop(0.62, css(col));
      gr.addColorStop(1, blend(col, 0, 0.4));
      g.fillStyle = gr;
    } else g.fillStyle = css(col);
    g.fillText(text, x, y);
  }

  round(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}
