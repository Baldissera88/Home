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

/**
 * World-anchored 2D labels drawn on a canvas over the 3D view: damage numbers, health bars over
 * wounded monsters, champion names, speech bubbles and the names of loot on the ground.
 */
export class Overlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'overlay';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.v = new THREE.Vector3();
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w;
    this.h = h;
  }

  /** World point to CSS pixels; null when behind the camera or off screen. */
  project(camera, x, y, z) {
    const v = this.v.set(x, y, z).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    const sx = (v.x * 0.5 + 0.5) * this.w, sy = (-v.y * 0.5 + 0.5) * this.h;
    if (sx < -80 || sy < -80 || sx > this.w + 80 || sy > this.h + 80) return null;
    return [sx, sy, camera.position.distanceTo(this.v.set(x, y, z))];
  }

  draw(f, camera, ground, actors, levelInfo) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (!f) return;
    const unit = Math.min(this.w, this.h) / 400;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';

    // Entrance names over the dungeon mouths.
    if (levelInfo && levelInfo.ent) {
      for (const [x, y, region, open] of levelInfo.ent) {
        const p = this.project(camera, x + 0.5, ground(x + 0.5, y + 0.5) + 2.6, y + 0.5);
        if (!p || p[2] > 18) continue;
        const name = ['The Crypt', 'The Caves', 'The Gate of Hell'][region];
        this.label(p[0], p[1], open ? name : name + ' (sealed)', 12 * unit, open ? '#f2e6c8' : '#a09080', '700 ', 'Cinzel');
      }
    }

    // Loot names near the hero.
    const hx = f.p[0], hy = f.p[1];
    for (const [uid, kind, x, y, z, rarity, , name] of f.lo) {
      const d2 = (x - hx) ** 2 + (y - hy) ** 2;
      if (kind === 2 && d2 < 36) {
        const p = this.project(camera, x, ground(x, y) + 0.45 + z, y);
        if (p) this.plate(p[0], p[1], name, RARITY_COLORS[rarity] || 0xffffff, 10.5 * unit, d2 < 6.25 ? 1 : 0.75);
      } else if (kind === 0 && d2 < 12) {
        const p = this.project(camera, x, ground(x, y) + 0.35 + z, y);
        if (p) this.plate(p[0], p[1], name, 0xffd54a, 9.5 * unit, 0.85);
      }
    }

    // Health bars and champion names.
    for (const e of f.e) {
      const flags = e[E.FLAGS], hp = e[E.HP];
      const elite = (flags & EF.ELITE) !== 0, boss = (flags & EF.BOSS) !== 0;
      if (hp >= 0.999 && !elite) continue;
      if (boss) continue; // the HUD shows the boss bar
      const x = e[E.X], y = e[E.Y];
      const top = actors.heightOf(e[E.UID]);
      const p = this.project(camera, x, ground(x, y) + top + 0.25, y);
      if (!p) continue;
      const w = (elite ? 46 : 32) * unit * Math.min(1.4, 8 / Math.max(4, p[2])), h = 4 * unit;
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.fillRect(p[0] - w / 2 - 1, p[1] - h / 2 - 1, w + 2, h + 2);
      c.fillStyle = elite ? '#ffb340' : '#e53935';
      c.fillRect(p[0] - w / 2, p[1] - h / 2, w * Math.max(0, hp), h);
      if (elite && e[E.NAME]) {
        const [n, affix] = String(e[E.NAME]).split('|');
        this.label(p[0], p[1] - 9 * unit, n, 10 * unit, '#ffcf6a', '700 ', 'Cinzel');
        if (affix) this.label(p[0], p[1] - 19 * unit, affix, 8 * unit, '#c8b8ff', '700 ', 'Alegreya Sans');
      }
    }

    // Villagers' speech.
    for (const n of f.n) {
      const say = n[7];
      if (!say) continue;
      const p = this.project(camera, n[2], ground(n[2], n[3]) + 1.75, n[3]);
      if (p && p[2] < 16) this.bubble(p[0], p[1], say, 10 * unit);
    }

    // Damage numbers and other floating texts.
    for (const [x, y, text, col, big, age] of f.tx) {
      const rise = 1.35 + age * 0.9;
      const p = this.project(camera, x, ground(x, y) + rise, y);
      if (!p) continue;
      const a = Math.max(0, Math.min(1, 1.4 - age * 1.1));
      const pop = 1 + Math.max(0, 0.35 - age) * 1.4;
      const size = (big ? 19 : 13.5) * unit * pop * Math.min(1.3, 7 / Math.max(4, p[2]));
      c.globalAlpha = a;
      this.label(p[0], p[1], text, size, css(col), big ? '900 ' : '700 ', big ? 'Cinzel' : 'Alegreya Sans');
      c.globalAlpha = 1;
    }
  }

  label(x, y, text, size, color, weight, family) {
    const c = this.ctx;
    c.font = `${weight}${size.toFixed(1)}px "${family}", serif`;
    c.lineWidth = Math.max(2, size * 0.22);
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, x, y);
    c.fillStyle = color;
    c.fillText(text, x, y);
  }

  plate(x, y, text, rgb, size, alpha) {
    const c = this.ctx;
    c.font = `700 ${size.toFixed(1)}px "Alegreya Sans", sans-serif`;
    const w = c.measureText(text).width + size * 0.9, h = size * 1.45;
    c.globalAlpha = alpha;
    c.fillStyle = 'rgba(8,6,5,0.72)';
    this.round(x - w / 2, y - h / 2, w, h, size * 0.25);
    c.fill();
    c.strokeStyle = hex(rgb, 0.55);
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = hex(rgb);
    c.fillText(text, x, y + 0.5);
    c.globalAlpha = 1;
  }

  bubble(x, y, text, size) {
    const c = this.ctx;
    c.font = `700 ${size.toFixed(1)}px "Alegreya Sans", sans-serif`;
    const maxW = size * 16;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    const lh = size * 1.25;
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + size * 1.2;
    const h = lines.length * lh + size * 0.7;
    const top = y - h - size * 0.6;
    c.fillStyle = 'rgba(244,234,210,0.95)';
    this.round(x - w / 2, top, w, h, size * 0.5);
    c.fill();
    c.beginPath();
    c.moveTo(x - size * 0.4, top + h - 1);
    c.lineTo(x, top + h + size * 0.6);
    c.lineTo(x + size * 0.4, top + h - 1);
    c.fill();
    c.fillStyle = '#2a1e14';
    lines.forEach((l, i) => c.fillText(l, x, top + size * 0.35 + lh * (i + 0.5)));
  }

  round(x, y, w, h, r) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
