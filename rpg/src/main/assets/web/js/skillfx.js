import * as THREE from 'three';
import { hash } from './defs.js';

/**
 * The skill-tree actives' own visuals, read off the frame's "sf" cues
 * ([skill, x, y, tx, ty, dx, dy, progress, value]; see the comment blocks above each cast branch in Game.kt)
 * and the zone kinds 2..7 in "zo" (fx.js hands those over): Judgment's hammer of light, Light Lance, Iron
 * Bulwark, Heaven's Fury, the Ancient Spear and its chain, Rend, Seismic Slam, Avalanche, Blade Dance,
 * Death Trap, Mark for Death, Death Blossom, Frozen Orb, Blizzard, Teleport, Black Hole, and the holy light,
 * bleed and sandstorm zones.
 *
 * Cost: everything flat (ground marks, beams, slashes, chains of light, sigils, swirls) is one dynamic mesh
 * drawn in one call with a procedural atlas; solid things (hammer, dome, orb, ice, rocks, spear, chain,
 * blades, traps) are one instanced mesh per shape, shown only while used; glows, sparks, dust and lights go
 * through fx.js's batches and light pool. Idle, nothing here draws. Nothing in the update allocates, and the
 * particles are stateless (placed from the cue's progress and the game clock), so a frozen frame holds still.
 */

const TAU = Math.PI * 2;
const MAX_QUADS = 3072;

// Skill ordinals (Entities.kt enum Skill).
const JUDGMENT = 16, LIGHT_LANCE = 17, BULWARK = 18, HEAVENS_FURY = 19, HARPOON = 20, REND = 21, SEISMIC_SLAM = 22,
  AVALANCHE = 23, BLADE_DANCE = 24, MARK_FOR_DEATH = 26, DEATH_BLOSSOM = 27, FROZEN_ORB = 28, TELEPORT = 30, BLACK_HOLE = 31;

// Atlas cells (4 x 4). Negative cells are procedural: -1 a soft beam across, -2 the same with soft ends,
// -3 a streak that fades towards its start, -4 a slash crescent (inner edge 0, bright outer rim 1).
const C_GLOW = 0, C_RING = 1, C_RUNES = 2, C_SIGIL = 3, C_FROST = 4, C_CRACK = 5, C_BLOOD = 6, C_SPIRAL = 7,
  C_ARCANE = 8, C_DASH = 9, C_STAR = 10, C_PUFF = 11, C_HOLE = 12, C_SHIELD = 13, C_DISC = 14, C_SAND = 15;
const BEAM = -1, BEAM_ENDS = -2, STREAK = -3, SLASH = -4;

const lin = (hex) => new THREE.Color().setHex(hex);
const GOLD = lin(0xffc548), GOLD_W = lin(0xffe7a8), WHITE = lin(0xffffff), STEEL = lin(0x9cc8ff);
const RED = lin(0xff1f2a), BLOOD = lin(0x7a0008), EMBER = lin(0xff6a1a), DUST_C = lin(0xb5a48c);
const VIOLET = lin(0xa24dff), PINK = lin(0xff4fb4), ICE = lin(0x8fdcff), ICE_W = lin(0xdaf4ff);
const HOLE_V = lin(0x8a3dff), HOLE_M = lin(0xff5ad8), SAND = lin(0xd9b47c), SAND_D = lin(0xa98454), BLACK = lin(0x000000);
const ROCK = { CRYPT: lin(0x6e6a66), CAVE: lin(0x6a625a), HELL: lin(0x5a3a32), OVERWORLD: lin(0x7c6c5a), DESERT: lin(0xb38c5c) };

const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpV = new THREE.Vector3();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const NONE = [];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = (v) => { v = clamp01(v); const k = 1 - v; return 1 - k * k * k; };
/** 0 -> 1 over the first `a` of v, then back to 0 over the last `b`. */
const envelope = (v, a, b) => Math.max(0, Math.min(1, v / a, (1 - v) / b));

// ---- procedural atlas

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sixteen white masks (only alpha is read), each 256 px, all fading out before their cell's edge. */
function makeAtlas() {
  const S = 256, R = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const g = c.getContext('2d');
  const rnd = rng(7);
  const W = (a) => `rgba(255,255,255,${a})`;
  const cell = (i, draw) => {
    g.save();
    g.translate((i % 4) * S + R, Math.floor(i / 4) * S + R);
    g.beginPath();
    g.rect(-R, -R, S, S);
    g.clip();
    g.strokeStyle = W(1);
    g.fillStyle = W(1);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    draw();
    g.restore();
  };
  const radial = (stops, r = R) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, a] of stops) gr.addColorStop(o, W(a));
    return gr;
  };
  const circle = (r, lw) => { g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };

  cell(C_GLOW, () => { g.fillStyle = radial([[0, 1], [0.2, 0.75], [0.5, 0.18], [1, 0]]); g.fillRect(-R, -R, S, S); });
  cell(C_RING, () => {
    g.fillStyle = radial([[0, 0.04], [0.68, 0.06], [0.82, 0.4], [0.9, 1], [0.95, 0.35], [1, 0]]);
    g.fillRect(-R, -R, S, S);
  });
  cell(C_RUNES, () => {
    for (const r of [118, 96]) circle(r, 3);
    g.lineWidth = 4;
    for (let i = 0; i < 16; i++) {
      g.save();
      g.rotate(i / 16 * TAU);
      g.translate(0, -107);
      g.beginPath();
      const k = i % 4;
      if (k === 0) { g.moveTo(-5, -6); g.lineTo(5, 6); g.moveTo(5, -6); g.lineTo(-5, 6); }
      else if (k === 1) { g.moveTo(0, -7); g.lineTo(0, 7); g.moveTo(-5, -2); g.lineTo(5, -2); }
      else if (k === 2) g.arc(0, 0, 5, 0, TAU);
      else { g.moveTo(-6, 5); g.lineTo(0, -7); g.lineTo(6, 5); }
      g.stroke();
      g.restore();
    }
    g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = i / 6 * TAU * 2 - Math.PI / 2;
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 82, Math.sin(a) * 82);
    }
    g.stroke();
    circle(40, 2);
  });
  cell(C_SIGIL, () => {
    circle(116, 6);
    circle(98, 2.5);
    // Barbs between the circles, pointing in.
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate(i / 12 * TAU);
      g.beginPath();
      g.moveTo(-7, -114); g.lineTo(0, -99); g.lineTo(7, -114);
      g.fill();
      g.restore();
    }
    // Three hooked blades curling in to a centre.
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate(i / 3 * TAU);
      g.beginPath();
      g.moveTo(0, -96);
      g.quadraticCurveTo(46, -60, 12, -18);
      g.quadraticCurveTo(26, -58, -10, -92);
      g.closePath();
      g.fill();
      g.restore();
    }
    circle(28, 5);
    g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fill();
  });
  cell(C_FROST, () => {
    g.fillStyle = radial([[0, 0.4], [0.6, 0.22], [0.85, 0.08], [1, 0]], 124);
    g.fillRect(-R, -R, S, S);
    const branch = (len, lw, depth) => {
      g.lineWidth = lw;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke();
      if (depth <= 0) return;
      for (let s = 0.25; s < 0.9; s += 0.2) {
        for (const side of [-1, 1]) {
          g.save();
          g.translate(0, -len * s);
          g.rotate(side * 1.0);
          branch(len * (1 - s) * 0.45, lw * 0.6, depth - 1);
          g.restore();
        }
      }
    };
    g.strokeStyle = W(0.95);
    for (let i = 0; i < 6; i++) { g.save(); g.rotate(i / 6 * TAU); branch(112, 4, 2); g.restore(); }
    g.strokeStyle = W(0.7);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, d = 30 + rnd() * 80;
      g.save();
      g.translate(Math.cos(a) * d, Math.sin(a) * d);
      g.rotate(rnd() * TAU);
      const s = 6 + rnd() * 10;
      for (let k = 0; k < 6; k++) { g.rotate(TAU / 6); g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s); g.stroke(); }
      g.restore();
    }
  });
  cell(C_CRACK, () => {
    // A jagged fissure along x with forks, thickest in the middle.
    const pts = [];
    for (let x = -118; x <= 118; x += 12) pts.push([x, (rnd() - 0.5) * 22 * (1 - Math.abs(x) / 140)]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const m = 1 - Math.abs(pts[i][0] + 6) / 124;
      g.lineWidth = 1.5 + 11 * Math.pow(Math.max(0, m), 0.7);
      g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
    }
    for (let b = 0; b < 7; b++) {
      const p = pts[2 + Math.floor(rnd() * (pts.length - 4))];
      let x = p[0], y = p[1], a = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.9) + (rnd() < 0.5 ? 0 : Math.PI);
      let lw = 5;
      for (let s = 0; s < 4; s++) {
        const nx = x + Math.cos(a) * 12, ny = y + Math.sin(a) * 12;
        g.lineWidth = lw;
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        x = nx; y = ny; a += (rnd() - 0.5) * 0.8; lw *= 0.7;
        if (Math.abs(x) > 110 || Math.abs(y) > 110) break;
      }
    }
  });
  cell(C_BLOOD, () => {
    const blob = (x, y, r) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, W(1)); gr.addColorStop(0.75, W(1)); gr.addColorStop(1, W(0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    };
    blob(0, 0, 62);
    for (let i = 0; i < 8; i++) { const a = rnd() * TAU, d = 20 + rnd() * 34; blob(Math.cos(a) * d, Math.sin(a) * d, 30 + rnd() * 28); }
    for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = 78 + rnd() * 36; blob(Math.cos(a) * d, Math.sin(a) * d, 3 + rnd() * 8); }
  });
  cell(C_SPIRAL, () => {
    g.filter = 'blur(3px)';
    for (let arm = 0; arm < 4; arm++) {
      let px = 0, py = 0;
      for (let th = 0; th < 7.2; th += 0.12) {
        const r = 10 * Math.exp(0.36 * th);
        if (r > 116) break;
        const a = th + arm * TAU / 4;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (th > 0) {
          g.strokeStyle = W(0.9 * Math.min(1, r / 30) * (1 - r / 125));
          g.lineWidth = 2 + r * 0.16;
          g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
        }
        px = x; py = y;
      }
    }
    g.filter = 'none';
  });
  cell(C_ARCANE, () => {
    circle(118, 4);
    circle(104, 2);
    g.lineWidth = 3;
    for (const off of [0, Math.PI]) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = off + i / 3 * TAU - Math.PI / 2;
        g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 100, Math.sin(a) * 100);
      }
      g.stroke();
    }
    circle(52, 3);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      g.beginPath(); g.arc(Math.cos(a) * 100, Math.sin(a) * 100, 8, 0, TAU); g.fill();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i + 0.5) / 24 * TAU;
      g.beginPath(); g.arc(Math.cos(a) * 111, Math.sin(a) * 111, 2.5, 0, TAU); g.fill();
    }
  });
  cell(C_DASH, () => {
    g.lineWidth = 8;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      g.beginPath(); g.arc(0, 0, 112, a, a + TAU / 16 * 0.55); g.stroke();
    }
  });
  cell(C_STAR, () => {
    g.fillStyle = radial([[0, 1], [0.15, 0.5], [0.4, 0.08], [1, 0]]);
    g.fillRect(-R, -R, S, S);
    for (const rot of [0, Math.PI / 2]) {
      g.save();
      g.rotate(rot);
      const gr = g.createLinearGradient(-120, 0, 120, 0);
      gr.addColorStop(0, W(0)); gr.addColorStop(0.5, W(1)); gr.addColorStop(1, W(0));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-120, 0); g.lineTo(0, -6); g.lineTo(120, 0); g.lineTo(0, 6); g.fill();
      g.restore();
    }
  });
  cell(C_PUFF, () => {
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, d = rnd() * 42, r = 42 + rnd() * 34;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, W(0.42)); gr.addColorStop(1, W(0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  });
  cell(C_HOLE, () => { g.fillStyle = radial([[0, 1], [0.6, 1], [0.78, 0.7], [1, 0]], 124); g.fillRect(-R, -R, S, S); });
  cell(C_SHIELD, () => {
    const path = () => {
      g.beginPath();
      g.moveTo(-66, -78); g.lineTo(66, -78);
      g.quadraticCurveTo(70, 30, 0, 96);
      g.quadraticCurveTo(-70, 30, -66, -78);
      g.closePath();
    };
    path();
    g.fillStyle = W(0.28);
    g.fill();
    g.lineWidth = 9;
    g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(0, -64); g.lineTo(0, 70); g.moveTo(-46, -22); g.lineTo(46, -22); g.stroke();
  });
  cell(C_DISC, () => {
    g.fillStyle = radial([[0, 0], [0.3, 0], [0.36, 1], [0.48, 0.55], [0.7, 0.22], [0.92, 0.05], [1, 0]], 124);
    g.fillRect(-R, -R, S, S);
    g.filter = 'blur(1px)';
    for (let i = 0; i < 70; i++) {
      const r0 = 44 + rnd() * 70, a0 = rnd() * TAU, len = 0.5 + rnd() * 1.4;
      g.strokeStyle = W((0.2 + rnd() * 0.45) * (1 - (r0 - 44) / 130));
      g.lineWidth = 1.5 + rnd() * 3.5;
      g.beginPath();
      for (let s = 0; s <= 8; s++) {
        const a = a0 + len * s / 8, r = r0 - s * 2.2;
        g[s ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
    }
    g.filter = 'none';
  });
  cell(C_SAND, () => {
    g.fillStyle = radial([[0, 0.12], [0.7, 0.1], [1, 0]], 124);
    g.fillRect(-R, -R, S, S);
    g.filter = 'blur(2px)';
    for (let i = 0; i < 80; i++) {
      const r = 24 + rnd() * 96, a0 = rnd() * TAU, len = 0.4 + rnd() * 1.6;
      g.strokeStyle = W((0.15 + rnd() * 0.4) * (1 - r / 135));
      g.lineWidth = 2 + rnd() * 7;
      g.beginPath(); g.arc(0, 0, r, a0, a0 + len); g.stroke();
    }
    g.filter = 'none';
  });

  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---- one dynamic mesh of textured quads, premultiplied: rgb adds light, alpha covers what is behind

const FLAT_VS = `
attribute vec2 aUv;
attribute vec4 aCol;
attribute float aCell;
varying vec2 vUv;
varying vec4 vCol;
varying float vCell;
#include <fog_pars_vertex>
void main() {
  vUv = aUv;
  vCol = aCol;
  vCell = aCell;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FLAT_FS = `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vCol;
varying float vCell;
#include <fog_pars_fragment>
void main() {
  float m;
  float white = 0.0;
  if (vCell < -3.5) {
    // slash: a crescent body from the inner edge (y 0) to a white-hot outer rim (y 0.9)
    float y = vUv.y;
    float body = smoothstep(0.0, 0.85, y) * (1.0 - smoothstep(0.93, 1.0, y));
    float rim = exp(-(y - 0.88) * (y - 0.88) * 260.0);
    m = body * 0.5 + rim * 1.2;
    white = rim * 0.9;
  } else if (vCell < -0.5) {
    float y = vUv.y * 2.0 - 1.0;
    m = exp(-y * y * 4.5) * (1.0 - y * y);
    float core = exp(-y * y * 40.0);
    white = core * 0.35;
    if (vCell < -1.5 && vCell > -2.5) m *= smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
    if (vCell < -2.5) m *= vUv.x * vUv.x * smoothstep(1.0, 0.94, vUv.x);
  } else {
    vec2 c = vec2(mod(vCell, 4.0), floor(vCell * 0.25 + 0.01));
    m = texture2D(uAtlas, (c + clamp(vUv, 0.004, 0.996)) * 0.25).a;
  }
  float e = max(vCol.r, max(vCol.g, vCol.b));
  vec4 o = vec4(vCol.rgb * m + vec3(white * m * e), vCol.a * m);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    o.rgb = mix(o.rgb, fogColor * o.a, fogFactor);
  #endif
  gl_FragColor = o;
}`;

class Flat {
  constructor(parent, atlas) {
    const nv = MAX_QUADS * 4;
    this.pos = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);
    this.col = new Float32Array(nv * 4);
    this.cell = new Float32Array(nv);
    const geo = this.geo = new THREE.BufferGeometry();
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.attrs = [
      ['position', this.pos, 3], ['aUv', this.uv, 2], ['aCol', this.col, 4], ['aCell', this.cell, 1],
    ].map(([name, arr, size]) => {
      const a = new THREE.BufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    });
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uAtlas: { value: atlas } },
      vertexShader: FLAT_VS,
      fragmentShader: FLAT_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.n = 0;
    /** Camera right and up, for camera-facing quads. */
    this.rx = 1; this.ry = 0; this.rz = 0; this.ux = 0; this.uy = 1; this.uz = 0;
    this.cam = null;
  }

  begin(camera) {
    this.n = 0;
    this.cam = camera.position;
    const e = camera.matrixWorld.elements;
    this.rx = e[0]; this.ry = e[1]; this.rz = e[2];
    this.ux = e[4]; this.uy = e[5]; this.uz = e[6];
  }

  vert(i, x, y, z, u, v, r, g, b, a, cell) {
    const p = this.pos, c = this.col;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = a;
    this.cell[i] = cell;
  }

  /** A quad centred on c spanning ±u, ±v; color k-scaled light plus `ab` coverage. */
  quad(cx, cy, cz, ux, uy, uz, vx, vy, vz, cell, col, k, ab = 0) {
    if (this.n >= MAX_QUADS || (k <= 0.002 && ab <= 0.002)) return;
    const r = col.r * k, g = col.g * k, b = col.b * k;
    const i = this.n++ * 4;
    this.vert(i, cx - ux - vx, cy - uy - vy, cz - uz - vz, 0, 0, r, g, b, ab, cell);
    this.vert(i + 1, cx + ux - vx, cy + uy - vy, cz + uz - vz, 1, 0, r, g, b, ab, cell);
    this.vert(i + 2, cx + ux + vx, cy + uy + vy, cz + uz + vz, 1, 1, r, g, b, ab, cell);
    this.vert(i + 3, cx - ux + vx, cy - uy + vy, cz - uz + vz, 0, 1, r, g, b, ab, cell);
  }

  /** A mark lying on the ground at height y, `rad` in radius, turned by rot. */
  ground(x, y, z, rad, rot, cell, col, k, ab = 0) {
    const c = Math.cos(rot) * rad, s = Math.sin(rot) * rad;
    this.quad(x, y, z, c, 0, -s, s, 0, c, cell, col, k, ab);
  }

  /** A ground quad stretched along (dx, dz) by `half` and `wide` across it. */
  strip(x, y, z, dx, dz, half, wide, cell, col, k, ab = 0) {
    this.quad(x, y, z, dx * half, 0, dz * half, -dz * wide, 0, dx * wide, cell, col, k, ab);
  }

  /** A camera-facing quad `size` across, turned by rot. */
  sprite(x, y, z, size, rot, cell, col, k, ab = 0) {
    const h = size * 0.5, c = Math.cos(rot) * h, s = Math.sin(rot) * h;
    this.quad(x, y, z,
      this.rx * c + this.ux * s, this.ry * c + this.uy * s, this.rz * c + this.uz * s,
      -this.rx * s + this.ux * c, -this.ry * s + this.uy * c, -this.rz * s + this.uz * c, cell, col, k, ab);
  }

  /** A ribbon from a to b, `w` wide, turned about its axis to face the camera (u runs a -> b). */
  beam(ax, ay, az, bx, by, bz, w, cell, col, k, ab = 0) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const cam = this.cam;
    const vx = (ax + bx) * 0.5 - cam.x, vy = (ay + by) * 0.5 - cam.y, vz = (az + bz) * 0.5 - cam.z;
    let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
    const l = w * 0.5 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    sx *= l; sy *= l; sz *= l;
    this.quad((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5, dx * 0.5, dy * 0.5, dz * 0.5, sx, sy, sz, cell, col, k, ab);
  }

  /** One ribbon segment from the (inner, outer) pair at its start to the pair at its end, fading k0 -> k1. */
  seg(i0x, i0y, i0z, o0x, o0y, o0z, i1x, i1y, i1z, o1x, o1y, o1z, cell, col, k0, k1, cover = 0) {
    if (this.n >= MAX_QUADS || (k0 <= 0.002 && k1 <= 0.002)) return;
    const i = this.n++ * 4, a0 = Math.min(1, k0 * cover), a1 = Math.min(1, k1 * cover);
    this.vert(i, i0x, i0y, i0z, 0, 0, col.r * k0, col.g * k0, col.b * k0, a0, cell);
    this.vert(i + 1, i1x, i1y, i1z, 1, 0, col.r * k1, col.g * k1, col.b * k1, a1, cell);
    this.vert(i + 2, o1x, o1y, o1z, 1, 1, col.r * k1, col.g * k1, col.b * k1, a1, cell);
    this.vert(i + 3, o0x, o0y, o0z, 0, 1, col.r * k0, col.g * k0, col.b * k0, a0, cell);
  }

  end() {
    const n = this.n;
    this.mesh.visible = n > 0;
    this.geo.setDrawRange(0, n * 6);
    if (!n) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4 * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ---- solid shapes: one instanced mesh each

const ENERGY_VS = `
attribute float aOpacity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vO;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vC = instanceColor;
  vO = aOpacity;
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ENERGY_FS = `
uniform float uBase;
uniform float uRim;
uniform float uCover;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
varying float vO;
varying vec3 vP;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = f * f;
  vec3 col = vC * (uBase + uRim * rim) + vec3(rim * rim * 0.5);
  #ifdef HEX
    // A honeycomb of light panels with a band of light sweeping up the dome.
    vec2 uv = vec2(atan(vP.z, vP.x) * (16.0 / 6.2831853), vP.y * 4.2);
    vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
    vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(gv);
    float d = max(dot(q, vec2(0.5, 0.8660254)), q.x);
    float line = smoothstep(0.42, 0.49, d);
    float band = vP.y - fract(uTime * 0.45) * 1.25 + 0.1;
    float scan = exp(-band * band * 60.0);
    col += vC * (line * (0.55 + 1.6 * scan) + scan * 0.25);
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.35, vP.y) + 0.6 * (1.0 - smoothstep(0.0, 0.08, vP.y));
  #endif
  // Premultiplied: pure light adds (uCover 0); ice and the hammer also hide a little of what is behind.
  gl_FragColor = vec4(col * vO, uCover * vO * (0.6 + 0.4 * rim));
}`;

function energyMaterial(base, rim, cover, defines, time) {
  return new THREE.ShaderMaterial({
    uniforms: { uBase: { value: base }, uRim: { value: rim }, uCover: { value: cover }, uTime: time },
    defines,
    vertexShader: ENERGY_VS,
    fragmentShader: ENERGY_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: defines.HEX ? THREE.DoubleSide : THREE.FrontSide,
    forceSinglePass: true,
  });
}

class Solid {
  constructor(parent, geo, mat, cap, renderOrder = 0) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.op = null;
    if (mat.transparent) {
      this.op = new Float32Array(cap);
      geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(this.op, 1).setUsage(THREE.DynamicDrawUsage));
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  /** A copy at (x, y, z) turned by tmpQ-style quaternion q and scaled. */
  add(x, y, z, q, sx, sy, sz, color, opacity = 1) {
    if (this.n >= this.cap || opacity <= 0.003) return;
    tmpM.compose(tmpP.set(x, y, z), q, tmpS.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, tmpM);
    this.mesh.setColorAt(this.n, color);
    if (this.op) this.op[this.n] = opacity;
    this.n++;
  }

  end() {
    const m = this.mesh, n = this.n;
    m.count = n;
    m.visible = n > 0;
    if (!n) return;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, n * 16);
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.clearUpdateRanges();
    m.instanceColor.addUpdateRange(0, n * 3);
    m.instanceColor.needsUpdate = true;
    if (this.op) {
      const a = m.geometry.attributes.aOpacity;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n);
      a.needsUpdate = true;
    }
  }
}

/** Joins geometries (non-indexed) into one, each part painted `color` in a vertex colour attribute. */
function merge(parts) {
  let n = 0;
  const flat = parts.map(([geo, color]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    n += g.attributes.position.count;
    return [g, color];
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, color] of flat) {
    const c = lin(color);
    const p = g.attributes.position.array, q = g.attributes.normal.array;
    pos.set(p, o * 3);
    nor.set(q, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** The hammer of light: head along z centred on the origin, handle up +y. */
function hammerGeometry() {
  const parts = [
    [new THREE.BoxGeometry(0.78, 0.78, 1.3), 0xffffff],
    [new THREE.BoxGeometry(0.96, 0.96, 0.2).translate(0, 0, 0.66), 0xffffff],
    [new THREE.BoxGeometry(0.96, 0.96, 0.2).translate(0, 0, -0.66), 0xffffff],
    [new THREE.BoxGeometry(0.9, 0.22, 0.9).translate(0, 0.4, 0), 0xffffff],
    [new THREE.CylinderGeometry(0.1, 0.12, 2.5, 8).translate(0, 1.7, 0), 0xffffff],
    [new THREE.CylinderGeometry(0.16, 0.16, 0.18, 8).translate(0, 2.2, 0), 0xffffff],
    [new THREE.OctahedronGeometry(0.22, 0).translate(0, 3.05, 0), 0xffffff],
  ];
  return merge(parts);
}

/** A lumpy boulder: an icosahedron with its corners pushed in and out (shared corners move together). */
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.78 + 0.4 * hash(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50));
    p.setXYZ(i, x * k, y * k * 0.86, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A jagged rock spike, base on y 0 and point at y 1 (a five-sided cone with its corners pushed about). */
function spikeGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 5, 2).translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.7 + 0.6 * hash(Math.round(x * 40), Math.round(y * 40), Math.round(z * 40));
    p.setXYZ(i, x * k + (y > 0.99 ? 0.15 : 0), y, z * k);
  }
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
}

/** The ancient spear along +z: tip at z 0.9, butt at -0.85 (chain ring). */
function spearGeometry() {
  const along = (geo) => geo.rotateX(Math.PI / 2);
  return merge([
    [along(new THREE.CylinderGeometry(0.032, 0.036, 1.42, 7)).translate(0, 0, -0.14), 0x6b4426],
    [along(new THREE.ConeGeometry(0.085, 0.36, 6)).translate(0, 0, 0.74), 0xc9a25e],
    [along(new THREE.ConeGeometry(0.035, 0.16, 4)).rotateY(0.5).translate(0.06, 0, 0.56), 0xc9a25e],
    [along(new THREE.ConeGeometry(0.035, 0.16, 4)).rotateY(-0.5).translate(-0.06, 0, 0.56), 0xc9a25e],
    [along(new THREE.CylinderGeometry(0.048, 0.048, 0.1, 7)).translate(0, 0, 0.53), 0x3b2a1e],
    [along(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 7)).translate(0, 0, -0.5), 0x3b2a1e],
    [new THREE.TorusGeometry(0.05, 0.014, 5, 10).rotateY(Math.PI / 2).translate(0, 0, -0.88), 0x8a8a90],
  ]);
}

/** A curved two-bladed glaive lying flat (in xz), spinning about y. */
function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.1, -0.05);
  s.quadraticCurveTo(0.46, -0.08, 0.64, 0.24);
  s.quadraticCurveTo(0.38, 0.06, 0.04, 0.08);
  s.lineTo(-0.1, 0.05);
  s.quadraticCurveTo(-0.46, 0.08, -0.64, -0.24);
  s.quadraticCurveTo(-0.38, -0.06, -0.04, -0.08);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
  blade.translate(0, 0, -0.01).rotateX(-Math.PI / 2);
  return merge([
    [blade, 0xd6dae4],
    [new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), 0x4a2a52],
  ]);
}

/** A spiked mechanical trap, 1 across: base plate, jaws of teeth, a brass pressure plate and the lamp housing. */
function trapGeometry() {
  const parts = [
    [new THREE.CylinderGeometry(0.86, 0.96, 0.12, 20).translate(0, 0.06, 0), 0x3b3b40],
    [new THREE.TorusGeometry(0.64, 0.05, 6, 24).rotateX(Math.PI / 2).translate(0, 0.14, 0), 0x6a4a35],
    [new THREE.CylinderGeometry(0.34, 0.38, 0.08, 16).translate(0, 0.15, 0), 0x9a7a3a],
    [new THREE.CylinderGeometry(0.1, 0.13, 0.12, 10).translate(0, 0.24, 0), 0x2a2a2e],
  ];
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU;
    const tooth = new THREE.ConeGeometry(0.1, 0.42, 4).rotateZ(0.42).translate(-0.02, 0.3, 0).rotateY(-a).translate(Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78);
    parts.push([tooth, 0xa4a6ae]);
  }
  for (const s of [-1, 1]) parts.push([new THREE.BoxGeometry(0.22, 0.16, 0.34).translate(s * 0.92, 0.1, 0), 0x2e2e33]);
  return merge(parts);
}

/** One oval chain link, long axis along z. */
function linkGeometry() {
  return new THREE.TorusGeometry(0.065, 0.02, 5, 10).rotateY(Math.PI / 2).scale(1, 1, 1.5);
}

export class SkillFx {
  /**
   * @param fx the Fx whose glow, particle batches and light pool this shares
   * @param quality () => the engine's current render preset (fewer particles on low)
   */
  constructor(fx, quality) {
    this.fx = fx;
    this.quality = quality || (() => null);
    this.group = new THREE.Group();
    fx.group.add(this.group);
    this.time = { value: 0 };
    this.atlas = makeAtlas();
    this.flat = new Flat(this.group, this.atlas);

    const lit = (rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, ...extra });
    this.hammer = new Solid(this.group, hammerGeometry(), energyMaterial(0.75, 2.6, 0.35, {}, this.time), 4, 5);
    this.dome = new Solid(this.group, new THREE.SphereGeometry(1, 40, 18, 0, TAU, 0, Math.PI * 0.56), energyMaterial(0.05, 1.5, 0, { HEX: 1 }, this.time), 4, 5);
    this.orb = new Solid(this.group, new THREE.IcosahedronGeometry(1, 1), energyMaterial(0.6, 2.2, 0.6, {}, this.time), 6, 5);
    this.ice = new Solid(this.group, new THREE.OctahedronGeometry(1, 0).scale(0.32, 1, 0.32), energyMaterial(0.45, 2.0, 0.6, {}, this.time), 96, 5);
    const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
    this.rock = new Solid(this.group, rockGeometry(), rockMat, 48);
    this.spike = new Solid(this.group, spikeGeometry(), rockMat, 64);
    this.spear = new Solid(this.group, spearGeometry(), lit(0.55, 0.35), 4);
    this.chain = new Solid(this.group, linkGeometry(), new THREE.MeshStandardMaterial({ color: 0x8c8f96, roughness: 0.35, metalness: 0.9 }), 160);
    this.blade = new Solid(this.group, bladeGeometry(), lit(0.22, 0.85, { emissive: 0x3a0a30 }), 24);
    this.trap = new Solid(this.group, trapGeometry(), lit(0.45, 0.65), 12);
    this.solids = [this.hammer, this.dome, this.orb, this.ice, this.rock, this.spike, this.spear, this.chain, this.blade, this.trap];

    // Smoothed positions of moving cues, by (skill, nth cue of that skill, point): x, y and the tick last seen.
    this.sm = new Float32Array(32 * 4 * 2 * 2);
    this.seen = new Int32Array(32 * 4 * 2).fill(-9);
    this.spin = new Float32Array(32 * 4);
    this.slot = new Int32Array(32);
    this.tick = 0;
    this.dens = 1;
    this.rockColor = ROCK.CRYPT;
    this.hx = 0; this.hz = 0;
    this.ox = 0; this.oy = 0;
    this.prev = new Float32Array(7);
  }

  setLevel(level) {
    this.rockColor = (level && ROCK[level.biome]) || ROCK.CRYPT;
    this.seen.fill(-9);
  }

  begin(camera, t) {
    this.flat.begin(camera);
    for (let i = 0; i < this.solids.length; i++) this.solids[i].begin();
    this.time.value = t;
    const q = this.quality();
    this.dens = q && q.name === 'low' ? 0.4 : q && q.name === 'medium' ? 0.7 : 1;
    this.light = this.fx.particleLight.value;
  }

  end() {
    this.flat.end();
    for (let i = 0; i < this.solids.length; i++) this.solids[i].end();
  }

  /** How many of n particles to draw on this preset. */
  count(n) { return Math.max(1, Math.round(n * this.dens)); }

  /** Smooths a moving cue point toward (x, y); the result is in this.ox, this.oy. */
  follow(key, x, y, dt) {
    const s = this.sm, o = key * 2;
    if (this.seen[key] < this.tick - 1 || Math.abs(s[o] - x) + Math.abs(s[o + 1] - y) > 2.5) {
      s[o] = x; s[o + 1] = y;
    } else {
      const k = 1 - Math.exp(-30 * dt);
      s[o] += (x - s[o]) * k;
      s[o + 1] += (y - s[o + 1]) * k;
    }
    this.seen[key] = this.tick;
    this.ox = s[o];
    this.oy = s[o + 1];
  }

  /** A spin angle that turns `rate` rad/s on its own and is eased toward the game's; returns it. */
  spinAt(key, target, rate, dt) {
    const k = key >> 1;
    if (this.seen[key] < this.tick - 1) this.spin[k] = target;
    else {
      const p = this.spin[k] + rate * dt;
      let d = target - p;
      d -= Math.round(d / TAU) * TAU;
      this.spin[k] = Math.abs(d) > 1.5 ? target : p + d * Math.min(1, dt * 8);
    }
    this.seen[key] = this.tick;
    return this.spin[k];
  }

  update(f, dt, t, ground, camera, hero) {
    this.tick++;
    const sf = f.sf || NONE;
    this.slot.fill(0);
    if (hero) { this.hx = hero.x; this.hz = hero.z; } else if (f.p) { this.hx = f.p[0]; this.hz = f.p[1]; }
    for (let i = 0; i < sf.length; i++) {
      const c = sf[i];
      const s = c[0] | 0;
      const n = s < 32 ? Math.min(3, this.slot[s]++) : 0;
      const key = ((s & 31) * 4 + n) * 2;
      switch (s) {
        case JUDGMENT: this.judgment(c, ground, t); break;
        case LIGHT_LANCE: this.lance(c, ground, t); break;
        case BULWARK: this.bulwark(c, ground, t); break;
        case HEAVENS_FURY: if (c[8] < 0) this.fury(c, ground, t); else this.pillar(c, ground, t); break;
        case HARPOON: this.harpoon(c, ground, t, key, dt); break;
        case REND: this.rend(c, ground, t); break;
        case SEISMIC_SLAM: this.seismic(c, ground, t, key, dt); break;
        case AVALANCHE: this.avalanche(c, ground, t); break;
        case BLADE_DANCE: this.bladeDance(c, ground, t); break;
        case MARK_FOR_DEATH: this.mark(c, ground, t, key, dt, f); break;
        case DEATH_BLOSSOM: this.blossom(c, ground, t, key, dt); break;
        case FROZEN_ORB: this.frozenOrb(c, ground, t, key, dt); break;
        case TELEPORT: this.teleport(c, ground, t); break;
        case BLACK_HOLE: if (c[8] < 0) this.implosion(c, ground, t); else this.vortex(c, ground, t, key, dt); break;
        default: break;
      }
    }
  }

  // ---- zones 2..7 (fx.js draws 0 and 1)

  zone(zn, ground, t) {
    const x = zn[0], y = zn[1], r = zn[2], kind = zn[3], k = zn[4];
    const gy = ground(x, y) + 0.05;
    switch (kind) {
      case 2: this.blizzard(x, y, r, k, gy, t); break;
      case 3: this.well(x, y, r, k, gy, t); break;
      case 4: this.deathTrap(x, y, r, k, gy, t); break;
      case 5: this.holyLight(x, y, r, k, gy, t); break;
      case 6: this.bleed(x, y, r, k, gy, t); break;
      case 7: this.sandstorm(x, y, r, k, gy, t); break;
      default: break;
    }
  }

  // ---- Knight

  /** JUDGMENT: a giant hammer of golden light drops on (tx, ty), lands at progress 0.5, then shockwave and afterglow. */
  judgment(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const tx = c[3], ty = c[4], p = c[7], R = c[8] || 2.3;
    let dx = c[5], dy = c[6];
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const gy = ground(tx, ty) + 0.05;
    const yaw = Math.atan2(dx, dy);
    if (p < 0.5) {
      const k = p / 0.5, e = Math.pow(k, 2.6);
      // Where it will land: a turning circle of runes and a pool of light, brighter as it nears.
      F.ground(tx, gy, ty, R * (0.7 + 0.3 * k), t * 1.6, C_RUNES, GOLD, 0.4 + 1.1 * k);
      F.ground(tx, gy, ty, R * 1.25, 0, C_GLOW, GOLD, 0.15 + 0.55 * k);
      F.ground(tx, gy + 0.01, ty, R * (1.15 - 0.15 * k), -t * 0.8, C_RING, GOLD_W, 0.3 + 0.6 * k);
      // The hammer swings down out of the sky, head first.
      const fall = 1 - e;
      const hx = tx - dx * 0.8 * fall, hz = ty - dy * 0.8 * fall, hy = gy + 0.55 * 1.25 + 5.5 * fall;
      tmpE.set(-0.7 * fall, yaw, 0);
      tmpQ.setFromEuler(tmpE);
      // It appears out of a burst of light, then hangs a moment before the blow.
      const s = 1.25 * easeOut(k / 0.2);
      if (k < 0.3) F.sprite(hx, hy + 0.4, hz, 6 * (1 - k / 0.3), k * 4, C_STAR, GOLD_W, 1.5 * (1 - k / 0.3));
      this.hammer.add(hx, hy, hz, tmpQ, s, s, s, tmpC.copy(GOLD).multiplyScalar(1.6), 0.9);
      fx.halo(hx, hy + 0.3, hz, 4.2, GOLD, 0.55, 0.5, 1.4);
      // Its wake: a shaft of light back up to the heavens, and motes shed along it.
      F.beam(hx - dx * 2.4, hy + 9, hz - dy * 2.4, hx, hy + 0.6, hz, 1.6, STREAK, GOLD, 0.7);
      const n = this.count(18);
      for (let j = 0; j < n; j++) {
        const u = (hash(j, 3) + t * 1.7) % 1;
        const a = hash(j, 5) * TAU, rr = 0.3 + hash(j, 7) * 0.8;
        fx.additive.add(hx - dx * 2.4 * u * 0.3 + Math.cos(a) * rr, hy + u * 4, hz - dy * 2.4 * u * 0.3 + Math.sin(a) * rr,
          GOLD_W.r, GOLD_W.g, GOLD_W.b, 0.8 * (1 - u), 0.14, 1);
      }
      fx.light(hx, hy, hz, 0xffd27a, 8, 2 + 3 * k);
    } else {
      const k = (p - 0.5) / 0.5, eo = easeOut(k), fade = 1 - k;
      // The hammer stays a moment in the ground, then breaks into light.
      if (k < 0.5) {
        const s = 1.25 * (1 + 0.15 * k);
        tmpE.set(0, yaw, 0);
        tmpQ.setFromEuler(tmpE);
        this.hammer.add(tx, gy + 0.6 - k * 0.3, ty, tmpQ, s, s, s, tmpC.copy(GOLD).multiplyScalar(1.6 + 2 * (1 - k * 2)), 1 - k * 2);
      }
      // Flash and shock waves.
      fx.halo(tx, gy + 1, ty, R * 3.6 * (0.6 + 0.4 * eo), GOLD, fade * fade, fade * fade * fade * 1.4, R * 1.4);
      F.sprite(tx, gy + 0.8, ty, R * 5 * (0.5 + eo), 0, C_STAR, GOLD_W, 1.4 * fade * fade * fade);
      F.ground(tx, gy + 0.02, ty, R * (0.25 + 1.45 * eo), 0, C_RING, GOLD, 2.2 * fade);
      F.ground(tx, gy + 0.03, ty, R * (0.1 + 1.0 * easeOut(k * 1.4)), 0, C_RING, WHITE, 1.4 * fade * fade);
      F.ground(tx, gy, ty, R * 1.5, 0, C_GLOW, GOLD, 1.3 * fade * fade);
      F.ground(tx, gy + 0.01, ty, R * 0.95, t * 0.5, C_RUNES, GOLD_W, 1.2 * fade);
      for (let j = 0; j < 3; j++) F.ground(tx, gy + 0.005, ty, R * 0.75, j * 1.05 + 0.3, C_CRACK, BLACK, 0, 0.55 * (1 - k * k));
      // Rays of light bursting up from the blow.
      for (let j = 0; j < 8; j++) {
        const a = j / 8 * TAU + hash(j, 9) * 0.6, s = (0.5 + hash(j, 11) * 0.7) * (0.35 + 0.65 * eo);
        F.beam(tx, gy + 0.1, ty, tx + Math.cos(a) * 1.8 * s, gy + 4.2 * s, ty + Math.sin(a) * 1.8 * s, 0.45, STREAK, GOLD_W, 1.6 * fade * fade);
      }
      // Sparks thrown out and up.
      const n = this.count(36);
      for (let j = 0; j < n; j++) {
        const a = hash(j, 13) * TAU, sp = 0.4 + hash(j, 15);
        const d = R * 1.3 * sp * eo, up = 3.2 * sp * k * (1.2 - k);
        fx.additive.add(tx + Math.cos(a) * d, gy + 0.2 + up, ty + Math.sin(a) * d, GOLD_W.r, GOLD_W.g, GOLD_W.b, fade, 0.16, 1);
      }
      const nd = this.count(10);
      for (let j = 0; j < nd; j++) {
        const a = j / nd * TAU + hash(j, 17), d = R * (0.4 + 0.9 * eo);
        fx.normal.add(tx + Math.cos(a) * d, gy + 0.3 + 0.4 * k, ty + Math.sin(a) * d, DUST_C.r, DUST_C.g, DUST_C.b, 0.45 * fade, 1.2 + 1.2 * k, 2);
      }
      fx.light(tx, gy + 1.4, ty, 0xffd27a, 10, 8 * fade * fade);
    }
  }

  /** LIGHT_LANCE: a blinding beam from (x, y) to (tx, ty), brightest at the start. */
  lance(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const sx = c[1], sy = c[2], ex = c[3], ey = c[4], p = c[7], w = c[8] || 0.55;
    const len = Math.hypot(ex - sx, ey - sy) || 1, dx = (ex - sx) / len, dy = (ey - sy) / len;
    const reach = Math.min(1, p / 0.1);
    const fade = Math.pow(1 - p, 1.4) * (0.92 + 0.08 * Math.sin(t * 70));
    const h0 = ground(sx, sy) + 0.95, h1 = ground(ex, ey) + 0.95;
    const bx = sx + (ex - sx) * reach, by = sy + (ey - sy) * reach, bh = h0 + (h1 - h0) * reach;
    const narrow = 0.6 + 0.4 * (1 - p);
    F.beam(sx, h0, sy, bx, bh, by, w * 3.4 * narrow, BEAM_ENDS, GOLD, 0.9 * fade);
    F.beam(sx, h0, sy, bx, bh, by, w * 1.5 * narrow, BEAM_ENDS, GOLD_W, 1.8 * fade);
    F.beam(sx, h0, sy, bx, bh, by, w * 0.45, BEAM_ENDS, WHITE, 3.2 * fade);
    // Light spilled on the ground under it.
    const mx = (sx + bx) / 2, my = (sy + by) / 2, ml = len * reach / 2;
    F.strip(mx, ground(mx, my) + 0.04, my, dx, dy, ml, w * 2.2, BEAM_ENDS, GOLD, 0.7 * fade);
    // Muzzle and end flares.
    fx.halo(sx, h0, sy, 2.2, GOLD, fade, fade, 0.8);
    F.sprite(sx, h0, sy, 2.6, t * 3, C_STAR, GOLD_W, 1.4 * fade);
    if (reach >= 1) {
      fx.halo(ex, h1, ey, 3, GOLD, fade, fade * 0.8, 1);
      F.sprite(ex, h1, ey, 3.2, -t * 2, C_STAR, GOLD_W, 1.2 * fade);
    }
    // Motes spiralling about the beam.
    const n = this.count(44);
    const px = -dy, pz = dx;
    for (let j = 0; j < n; j++) {
      const u = hash(j, 21) * reach;
      const a = t * 9 + j * 2.39 + u * 6;
      const rr = w * (0.5 + 0.9 * p + hash(j, 23) * 0.4);
      const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
      fx.additive.add(sx + (ex - sx) * u + px * ca, h0 + (h1 - h0) * u + sa, sy + (ey - sy) * u + pz * ca,
        GOLD_W.r, GOLD_W.g, GOLD_W.b, fade, 0.12 + 0.06 * hash(j, 25), 1);
    }
    fx.light(sx + (ex - sx) * 0.4 * reach, h0 + 0.2, sy + (ey - sy) * 0.4 * reach, 0xffe08a, len * 0.6 + 3, 5 * fade);
  }

  /** BULWARK: a honeycomb dome of steel light over the hero and a turning ring of runes at his feet. */
  bulwark(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const x = this.hx, z = this.hz, p = c[7];
    const gy = ground(x, z) + 0.04;
    const a = envelope(p, 0.04, 0.08);
    const pop = 1 + 0.35 * Math.pow(1 - Math.min(1, p * 14), 2);
    const s = 1.2 * pop;
    tmpQ.identity();
    this.dome.add(x, gy - 0.05, z, tmpQ, s, s * 1.15, s, tmpC.copy(STEEL).lerp(GOLD, 0.2), 0.65 * a);
    F.ground(x, gy, z, 1.5 * pop, t * 0.7, C_RUNES, GOLD, 1.2 * a);
    F.ground(x, gy + 0.01, z, 1.38 * pop, -t * 1.1, C_RING, STEEL, 0.9 * a);
    F.ground(x, gy, z, 1.6, 0, C_GLOW, STEEL, 0.35 * a);
    // Three shield sigils orbiting at chest height.
    for (let j = 0; j < 3; j++) {
      const ang = t * 1.4 + j * TAU / 3;
      const ox = x + Math.cos(ang) * 1.32 * pop, oz = z + Math.sin(ang) * 1.32 * pop, oy = gy + 0.85 + 0.12 * Math.sin(t * 2 + j * 2);
      F.sprite(ox, oy, oz, 0.62, 0, C_SHIELD, GOLD, 2 * a);
      fx.halo(ox, oy, oz, 0.9, GOLD, 0.35 * a);
    }
    fx.light(x, gy + 1.2, z, 0xa8ccff, 4, 1.2 * a, true);
  }

  /** HEAVEN'S FURY aura (value < 0): a halo of holy light about the hero for the whole storm. */
  fury(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const x = this.hx, z = this.hz, p = c[7], range = -c[8] || 6.5;
    const gy = ground(x, z) + 0.04;
    const a = envelope(p, 0.04, 0.1);
    F.ground(x, gy, z, 1.75, -t * 0.9, C_RUNES, GOLD, 1.3 * a);
    F.ground(x, gy, z, 2.4, 0, C_GLOW, GOLD, 0.45 * a);
    F.ground(x, gy + 0.01, z, range, t * 0.15, C_DASH, GOLD, 0.35 * a);
    F.ground(x, gy, z, range * 1.02, 0, C_RING, GOLD, 0.3 * a);
    // A wide soft shaft of light down from the sky onto the hero.
    F.beam(x, gy + 9, z, x, gy, z, 2.4, BEAM_ENDS, GOLD, 0.35 * a);
    fx.halo(x, gy + 2.1, z, 1.6, GOLD, 0.55 * a, 0.25 * a, 0.5);
    const n = this.count(26);
    for (let j = 0; j < n; j++) {
      const u = (t * 0.55 + hash(j, 31)) % 1;
      const ang = hash(j, 33) * TAU + t * 0.6, rr = 0.5 + hash(j, 35) * 1.3;
      fx.additive.add(x + Math.cos(ang) * rr, gy + u * 2.6, z + Math.sin(ang) * rr, GOLD_W.r, GOLD_W.g, GOLD_W.b, a * Math.sin(u * Math.PI), 0.13, 1);
    }
    fx.light(x, gy + 1.6, z, 0xffd27a, 5, 1.4 * a, true);
  }

  /** HEAVEN'S FURY pillar (value > 0): a column of light lances down onto (x, y), striking at progress 0.5. */
  pillar(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const x = c[3], z = c[4], p = c[7], r = c[8] || 1.3;
    const gy = ground(x, z) + 0.04, top = gy + 15;
    if (p < 0.5) {
      const k = p / 0.5;
      const front = top - (top - gy) * Math.pow(k, 1.6);
      F.beam(x, top, z, x, front, z, 0.25 + 0.5 * k, STREAK, GOLD_W, 1.6);
      F.beam(x, top, z, x, front, z, 0.9 + 0.6 * k, STREAK, GOLD, 0.6);
      fx.halo(x, front, z, 1.6, GOLD, 0.8, 0.6, 0.5);
      F.ground(x, gy, z, r * (1.3 - 0.4 * k), t * 3, C_RING, GOLD, 1.2 * k);
      F.ground(x, gy, z, r * 1.2, 0, C_GLOW, GOLD, 0.6 * k);
      fx.light(x, front, z, 0xffe08a, 5, 1.5 + 2 * k);
    } else {
      const k = (p - 0.5) / 0.5, fade = 1 - k, eo = easeOut(k);
      F.beam(x, top, z, x, gy, z, r * 2.2 * (1 - 0.55 * k), BEAM, GOLD, 1.5 * Math.pow(fade, 1.5));
      F.beam(x, top, z, x, gy, z, r * 0.7 * (1 - 0.6 * k), BEAM, WHITE, 2.6 * fade * fade);
      fx.halo(x, gy + 0.4, z, r * 3.4, GOLD, fade * fade, 1.2 * fade * fade * fade, r);
      F.ground(x, gy + 0.02, z, r * (0.4 + 1.4 * eo), 0, C_RING, GOLD_W, 2 * fade);
      F.ground(x, gy, z, r * 1.6, 0, C_GLOW, GOLD, 1.2 * fade);
      const n = this.count(16);
      for (let j = 0; j < n; j++) {
        const a = hash(j, 41) * TAU, sp = 0.4 + hash(j, 43);
        const d = r * 1.2 * sp * eo;
        fx.additive.add(x + Math.cos(a) * d, gy + 0.15 + 2.2 * sp * k * (1.1 - k), z + Math.sin(a) * d, GOLD_W.r, GOLD_W.g, GOLD_W.b, fade, 0.14, 1);
      }
      fx.light(x, gy + 1, z, 0xffe08a, 6, 6 * fade * fade);
    }
  }

  // ---- Barbarian

  /** HARPOON: the ancient spear flies to (tx, ty) on a chain from the hero's hand. value: 0 out, 1 dragging, 2 reeling in. */
  harpoon(c, ground, t, key, dt) {
    const fx = this.fx;
    const phase = c[8];
    this.follow(key, c[3], c[4], dt);
    const tipX = this.ox, tipZ = this.oy;
    let dx = tipX - this.hx, dz = tipZ - this.hz;
    let dist = Math.hypot(dx, dz);
    if (dist < 0.3) { dx = c[5]; dz = c[6]; dist = 0.3; }
    const ux = dx / (Math.hypot(dx, dz) || 1), uz = dz / (Math.hypot(dx, dz) || 1);
    const gyH = ground(this.hx, this.hz), gyT = ground(tipX, tipZ);
    const handX = this.hx + ux * 0.35 - uz * 0.12, handY = gyH + 0.95, handZ = this.hz + uz * 0.35 + ux * 0.12;
    const tipY = gyT + (phase === 1 ? 0.8 : 0.95);
    // The spear points away from the hero; its butt ring is 1.75 behind the tip.
    const pitch = Math.atan2(tipY - handY, Math.max(0.3, dist));
    tmpE.set(-pitch, Math.atan2(ux, uz), 0);
    tmpQ.setFromEuler(tmpE);
    const cx = tipX - ux * 0.9, cz = tipZ - uz * 0.9;
    this.spear.add(cx, tipY - Math.sin(pitch) * 0.9, cz, tmpQ, 1, 1, 1, WHITE);
    const buttX = tipX - ux * 1.75, buttZ = tipZ - uz * 1.75, buttY = tipY - Math.sin(pitch) * 1.75;
    // The chain: oval links, alternately turned, sagging more when it hangs slack on the way back.
    const lx = buttX - handX, ly = buttY - handY, lz = buttZ - handZ;
    const cl = Math.hypot(lx, ly, lz);
    if (dist > 1.8 && cl > 0.05) {
      const links = Math.min(150, Math.ceil(cl / 0.16));
      const sag = (phase === 2 ? 0.22 : phase === 1 ? 0.05 : 0.09) * Math.min(cl, 6);
      const wave = phase === 0 ? 0.06 : 0;
      for (let i = 0; i < links; i++) {
        const u = (i + 0.5) / links;
        const drop = sag * 4 * u * (1 - u);
        const wv = wave * Math.sin(u * 9 - t * 28) * u;
        const px = handX + lx * u - uz * wv, py = handY + ly * u - drop, pz = handZ + lz * u + ux * wv;
        // Tangent: along the chain, tipped by the sag's slope.
        tmpV.set(lx, ly - sag * 4 * (1 - 2 * u), lz).normalize();
        tmpQ.setFromUnitVectors(Z_AXIS, tmpV);
        if (i & 1) tmpQ.multiply(tmpQ2.setFromAxisAngle(Z_AXIS, Math.PI / 2));
        this.chain.add(px, py, pz, tmpQ, 1, 1, 1, WHITE);
      }
    }
    if (phase === 0) {
      // An ember gleam at the head and a streak behind it.
      fx.halo(tipX, tipY, tipZ, 0.9, EMBER, 0.6, 0.4, 0.25);
      this.flat.beam(tipX - ux * 2.4, tipY - Math.sin(pitch) * 2.4, tipZ - uz * 2.4, tipX, tipY, tipZ, 0.35, STREAK, EMBER, 0.8);
    }
  }

  /** REND: a blood-red crescent sweeping across the front of the hero. */
  rend(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const x = this.hx, z = this.hz, p = c[7], reach = c[8] || 2.3;
    const base = Math.atan2(c[6], c[5]);
    const gy = ground(x, z);
    const half = 1.7;
    const head = -half + 2 * half * easeOut(p / 0.5);
    const tail = -half + 2 * half * easeOut((p - 0.1) / 0.55);
    const fade = 1 - smooth((p - 0.55) / 0.45);
    const segs = 22;
    const rIn = 0.45, rOut = reach * 0.98;
    const y0 = gy + 0.78;
    const prev = this.prev;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const off = tail + (head - tail) * u;
      const a = base + off;
      const ca = Math.cos(a), sa = Math.sin(a);
      // A diagonal slash: one end higher than the other.
      const yy = y0 + off * 0.16;
      const k = Math.pow(u, 1.2) * fade;
      const ix = x + ca * rIn, iz = z + sa * rIn, ox = x + ca * rOut, oz = z + sa * rOut;
      if (i) {
        F.seg(prev[0], prev[1], prev[2], prev[3], prev[4], prev[5], ix, yy, iz, ox, yy + 0.06, oz, SLASH, BLOOD, prev[6] * 0.3, k * 0.3, 1.6);
        F.seg(prev[0], prev[1], prev[2], prev[3], prev[4], prev[5], ix, yy, iz, ox, yy + 0.06, oz, SLASH, RED, prev[6] * 1.5, k * 1.5);
      }
      prev[0] = ix; prev[1] = yy; prev[2] = iz; prev[3] = ox; prev[4] = yy + 0.06; prev[5] = oz; prev[6] = k;
    }
    // The leading edge glows; blood is flung out behind it.
    const ha = base + head, hx = x + Math.cos(ha) * rOut * 0.85, hz = z + Math.sin(ha) * rOut * 0.85;
    fx.halo(hx, y0 + head * 0.16, hz, 1.1, RED, 0.7 * fade, 0.25 * fade, 0.3);
    const n = this.count(18);
    for (let j = 0; j < n; j++) {
      const off = -half + 2 * half * hash(j, 51);
      if (off > head) continue;
      const a = base + off, since = Math.max(0, (head - off) / (2 * half)) * 1.6;
      const d = rOut * (0.7 + 0.25 * hash(j, 53)) + since * 1.4;
      const up = 0.78 + off * 0.16 + since * 1.2 - since * since * 2.4;
      if (up < 0.05) continue;
      fx.normal.add(x + Math.cos(a) * d, gy + up, z + Math.sin(a) * d, BLOOD.r * 2, BLOOD.g, BLOOD.b, 0.9 * fade, 0.09, 0);
    }
    fx.light(hx, y0, hz, 0xff2a20, 3, 1.6 * fade, true);
  }

  /** SEISMIC_SLAM: a glowing fissure tears from (x, y) to the wave front (tx, ty), rock spikes bursting up at it. */
  seismic(c, ground, t, key, dt) {
    const F = this.flat, fx = this.fx;
    const ox = c[1], oz = c[2], p = c[7], hw = c[8] || 0.8;
    this.follow(key, c[3], c[4], dt);
    const fxp = this.ox, fzp = this.oy;
    let dx = c[5], dz = c[6];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const L = Math.max(0, (fxp - ox) * dx + (fzp - oz) * dz);
    const fade = 1 - smooth((p - 0.57) / 0.43);
    const nx = -dz, nz = dx;
    // The crack: dark segments with a hot seam, hottest near the front.
    for (let s = 0.5, i = 0; s < L; s += 0.85, i++) {
      const j = (hash(i, 61) - 0.5) * 0.25;
      const px = ox + dx * s + nx * j, pz = oz + dz * s + nz * j;
      const gy = ground(px, pz) + 0.03;
      const rot = (hash(i, 63) - 0.5) * 0.5;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const ddx = dx * cr - dz * sr, ddz = dx * sr + dz * cr;
      const wide = 0.42 + 0.4 * s / 7;
      F.strip(px, gy, pz, ddx, ddz, 0.66, wide, C_CRACK, BLACK, 0, 0.85 * fade);
      const heat = fade * (0.3 + 0.7 * Math.exp(-(L - s) * 0.5));
      F.strip(px, gy + 0.005, pz, ddx, ddz, 0.62, wide * 0.5, C_CRACK, EMBER, 2.2 * heat);
      if (s > 1.6 && hash(i, 65) > 0.4) {
        const side = hash(i, 67) > 0.5 ? 1 : -1, w = hw * 0.7 * (s / L);
        F.strip(px + nx * side * w, gy, pz + nz * side * w, ddx * 0.8 + nx * side * 0.6, ddz * 0.8 + nz * side * 0.6, 0.45, wide * 0.6, C_CRACK, BLACK, 0, 0.6 * fade);
      }
    }
    // Rock spikes jut up as the front passes, then sink back.
    const rc = this.rockColor;
    for (let s = 0.7, i = 0; s < L + 0.2; s += 0.5, i++) {
      const since = Math.max(0, L - s) / 13;
      const up = smooth(since / 0.05) * (1 - smooth((since - 0.16) / 0.3)) * fade;
      if (up < 0.03) continue;
      const w = 0.8 + (hw - 0.8) * Math.min(1, s / Math.max(L, 0.01));
      for (let k = -1; k <= 1; k += 2) {
        const lat = (k * 0.42 + (hash(i, k + 70) - 0.5) * 0.35) * w;
        const px = ox + dx * s + nx * lat, pz = oz + dz * s + nz * lat;
        const gy = ground(px, pz);
        const hgt = (0.55 + 0.6 * hash(i, k + 74)) * up;
        // Tilted out from the line and a little forward.
        tmpE.set(0.3, Math.atan2(dx, dz) + hash(i, k + 78) * 1.2, -k * (0.35 + 0.3 * hash(i, k + 82)));
        tmpQ.setFromEuler(tmpE);
        const wd = 0.16 + 0.1 * hash(i, k + 86);
        this.spike.add(px, gy - 0.12, pz, tmpQ, wd, hgt, wd, tmpC.copy(rc).multiplyScalar(0.55 + 0.25 * hash(i, k + 90)));
      }
    }
    // Dust and a low ember glow at the front.
    const gyF = ground(fxp, fzp);
    const n = this.count(8);
    for (let j = 0; j < n; j++) {
      const lat = (hash(j, 93) - 0.5) * 2 * hw, back = hash(j, 95) * 1.2;
      fx.normal.add(fxp + nx * lat - dx * back, gyF + 0.25 + back * 0.4, fzp + nz * lat - dz * back, DUST_C.r, DUST_C.g, DUST_C.b, 0.55 * fade, 0.9 + back, 2);
    }
    fx.halo(fxp, gyF + 0.25, fzp, 1.6, EMBER, 0.45 * fade);
    fx.light(fxp, gyF + 0.6, fzp, 0xff7a30, 4, 1.4 * fade, true);
  }

  /** AVALANCHE: one boulder crashing down onto (tx, ty), landing at progress 0.5 in a burst of dust. */
  avalanche(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const tx = c[3], tz = c[4], p = c[7], R = c[8] || 1.25;
    let dx = c[5], dz = c[6];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const gy = ground(tx, tz) + 0.03;
    const seed = Math.floor(tx * 13.7 + tz * 7.3);
    const size = R * (0.48 + 0.12 * hash(seed, 1));
    const rc = this.rockColor;
    const spin = hash(seed, 3) * TAU;
    if (p < 0.5) {
      const k = p / 0.5, e = k * k, fall = 1 - e;
      const bx = tx + dx * 3 * fall, by = gy + size * 0.8 + 7 * fall, bz = tz + dz * 3 * fall;
      tmpE.set(spin + k * 5, spin, k * 3);
      tmpQ.setFromEuler(tmpE);
      this.rock.add(bx, by, bz, tmpQ, size, size, size, tmpC.copy(rc));
      // Its shadow grows dark on the landing spot.
      F.ground(tx, gy, tz, size * (0.8 + 0.8 * k), 0, C_GLOW, BLACK, 0, 0.75 * k);
      F.ground(tx, gy + 0.01, tz, R * (1.1 - 0.2 * k), 0, C_RING, DUST_C, 0, 0.25 * k);
      // A trail of dust behind it.
      const n = this.count(6);
      for (let j = 1; j <= n; j++) {
        const q = j * 0.6;
        fx.normal.add(bx + dx * q * 0.43, by + q, bz + dz * q * 0.43, DUST_C.r, DUST_C.g, DUST_C.b, 0.42 * (1 - j / (n + 1)), 0.8 + j * 0.12, 2);
      }
    } else {
      const k = (p - 0.5) / 0.5, eo = easeOut(k), fade = 1 - k;
      // Embedded, then it crumbles away.
      const s = size * (1 - smooth((k - 0.55) / 0.45));
      if (s > 0.02) {
        tmpE.set(spin + 5, spin, 3);
        tmpQ.setFromEuler(tmpE);
        this.rock.add(tx, gy + size * 0.45 - k * size * 0.35, tz, tmpQ, s, s, s, tmpC.copy(rc));
      }
      for (let j = 0; j < 3; j++) F.ground(tx, gy + 0.005, tz, R * 1.1, spin + j * 1.05, C_CRACK, BLACK, 0, 0.6 * fade);
      F.ground(tx, gy, tz, R * 0.9, 0, C_GLOW, BLACK, 0, 0.45 * fade);
      const n = this.count(12);
      for (let j = 0; j < n; j++) {
        const a = j / n * TAU + hash(j, seed) * 0.5, d = R * (0.3 + 1.0 * eo) * (0.8 + 0.4 * hash(j, 5));
        fx.normal.add(tx + Math.cos(a) * d, gy + 0.2 + 0.6 * eo * hash(j, 7), tz + Math.sin(a) * d, DUST_C.r, DUST_C.g, DUST_C.b, 0.6 * fade, 1.0 + 1.6 * eo, 2);
      }
      const nc = this.count(12);
      for (let j = 0; j < nc; j++) {
        const a = hash(j, seed + 9) * TAU, sp = 0.5 + hash(j, 11);
        const d = R * 1.5 * sp * eo, up = 2.4 * sp * k * (1 - k) * 2;
        fx.normal.add(tx + Math.cos(a) * d, gy + 0.1 + up, tz + Math.sin(a) * d, rc.r, rc.g, rc.b, fade, 0.08 + 0.06 * hash(j, 13), 0);
      }
    }
  }

  // ---- Assassin

  /** BLADE_DANCE: one hop: a violet slash streak from (x, y) to the strike at (tx, ty), crossed cuts there. */
  bladeDance(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const sx = c[1], sz = c[2], ex = c[3], ez = c[4], p = c[7];
    const fade = Math.pow(1 - p, 1.3);
    const h0 = ground(sx, sz) + 0.75, h1 = ground(ex, ez) + 0.8;
    F.beam(sx, h0, sz, ex, h1, ez, 1.1, STREAK, VIOLET, 1.6 * fade);
    F.beam(sx, h0, sz, ex, h1, ez, 0.24, STREAK, PINK, 2.6 * fade);
    // Two crossed cuts at the strike, opening fast.
    let dx = c[5], dz = c[6];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const nx = -dz, nz = dx;
    const open = easeOut(p / 0.18) * 0.75;
    for (const s of [-1, 1]) {
      F.beam(ex - nx * open, h1 + 0.45 * open * s + 0.1, ez - nz * open, ex + nx * open, h1 - 0.45 * open * s + 0.1, ez + nz * open,
        0.24, BEAM_ENDS, VIOLET, 2.4 * fade);
      F.beam(ex - nx * open, h1 + 0.45 * open * s + 0.1, ez - nz * open, ex + nx * open, h1 - 0.45 * open * s + 0.1, ez + nz * open,
        0.07, BEAM_ENDS, WHITE, 2.4 * fade);
    }
    fx.halo(ex, h1, ez, 1.5, VIOLET, 0.8 * fade, 0.5 * fade, 0.4);
    const n = this.count(10);
    const seed = c[8] | 0;
    for (let j = 0; j < n; j++) {
      const a = hash(j, 101, seed) * TAU, d = 0.3 + 1.1 * easeOut(p * 2) * hash(j, 103, seed);
      fx.additive.add(ex + Math.cos(a) * d, h1 + (hash(j, 105, seed) - 0.3) * 0.9 * easeOut(p * 2), ez + Math.sin(a) * d,
        PINK.r, PINK.g, PINK.b, fade, 0.12, 1);
    }
    fx.light(ex, h1, ez, 0xb060ff, 3, 1.5 * fade, true);
  }

  /** DEATH_TRAP zone: the trap on the ground; its lamp blinks red once armed. */
  deathTrap(x, z, r, k, gy, t) {
    const F = this.flat, fx = this.fx;
    const deploy = Math.min(1, k / 0.033);
    const armed = k >= 0.033;
    const a = Math.min(1, (1 - k) * 40);
    const seed = Math.floor(x * 17 + z * 31);
    tmpE.set(0, hash(seed, 1) * TAU, 0);
    tmpQ.setFromEuler(tmpE);
    const s = 0.5 * (0.6 + 0.4 * easeOut(deploy));
    this.trap.add(x, gy - 0.04, z, tmpQ, s, s * (0.3 + 0.7 * easeOut(deploy)), s, tmpC.setScalar(this.light < 0.6 ? 1.3 : 1));
    const blink = armed ? ((t * 2.2 + hash(seed, 3)) % 1 < 0.45 ? 1 : 0.18) : 0.5 * deploy;
    const lampY = gy + 0.2;
    if (armed) {
      fx.halo(x, lampY, z, 0.7, RED, 0.9 * blink * a, 0.7 * blink * a, 0.15);
      F.ground(x, gy + 0.01, z, r, t * 0.4, C_DASH, RED, (0.25 + 0.45 * blink) * a);
      F.ground(x, gy, z, 0.9, 0, C_GLOW, RED, 0.45 * blink * a);
      fx.light(x, lampY + 0.2, z, 0xff2a1a, 2.2, 1.0 * blink * a, true);
    } else {
      fx.halo(x, lampY, z, 0.5, EMBER, 0.6 * deploy);
      F.ground(x, gy + 0.01, z, r * (0.3 + 0.7 * deploy), 0, C_RING, EMBER, 0.5 * deploy);
    }
  }

  /** MARK_FOR_DEATH: a turning red sigil under the marked foe, a smaller one over its head, a faint tether to the hero. */
  mark(c, ground, t, key, dt, f) {
    const F = this.flat, fx = this.fx;
    const p = c[7], br = c[8] || 0.4;
    // Stick to the enemy as it is drawn: the frame's (interpolated) enemy nearest the cue.
    let ex = c[1], ez = c[2];
    const en = f.e || NONE;
    let best = 1.0;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      const d = (e[2] - c[1]) * (e[2] - c[1]) + (e[3] - c[2]) * (e[3] - c[2]);
      if (d < best) { best = d; ex = e[2]; ez = e[3]; }
    }
    this.follow(key, ex, ez, dt);
    ex = this.ox; ez = this.oy;
    const a = envelope(p, 0.015, 0.03);
    const pulse = 0.8 + 0.2 * Math.sin(t * 6);
    const gy = ground(ex, ez) + 0.05;
    const sr = br * 1.6 + 0.55;
    F.ground(ex, gy, ez, sr, t * 1.3, C_SIGIL, RED, 1.5 * a * pulse);
    F.ground(ex, gy + 0.01, ez, sr * 1.18, -t * 0.7, C_DASH, RED, 0.7 * a);
    F.ground(ex, gy, ez, sr * 1.3, 0, C_GLOW, RED, 0.35 * a);
    const top = gy + 1.05 + br * 2.1 + 0.07 * Math.sin(t * 3);
    F.sprite(ex, top, ez, 0.6, -t * 2, C_SIGIL, RED, 2.0 * a);
    fx.halo(ex, top, ez, 0.9, RED, 0.45 * a * pulse);
    // The tether: a thin thread of red with pulses running from the hero to the mark.
    const hy = ground(this.hx, this.hz) + 0.9, my = gy + 0.7;
    const d = Math.hypot(ex - this.hx, ez - this.hz);
    if (d > 0.8) {
      F.beam(this.hx, hy, this.hz, ex, my, ez, 0.06, BEAM_ENDS, RED, 1.1 * a);
      for (let j = 0; j < 3; j++) {
        const u = (t * 0.9 + j / 3) % 1;
        fx.halo(this.hx + (ex - this.hx) * u, hy + (my - hy) * u, this.hz + (ez - this.hz) * u, 0.3, RED, 0.7 * a * Math.sin(u * Math.PI));
      }
    }
    fx.light(ex, gy + 0.6, ez, 0xff2030, 2.2, 0.8 * a, true);
  }

  /** DEATH_BLOSSOM: a whirling ring of glaives about the hero, each trailing a pink arc. */
  blossom(c, ground, t, key, dt) {
    const F = this.flat, fx = this.fx;
    const x = this.hx, z = this.hz, p = c[7], R = c[8] || 2.3;
    const ang = this.spinAt(key, Math.atan2(c[6], c[5]), 11, dt);
    const a = envelope(p, 0.04, 0.08);
    const gy = ground(x, z);
    const N = 8, grow = 0.6 + 0.4 * easeOut(p / 0.06);
    for (let j = 0; j < N; j++) {
      const th = ang + j * TAU / N;
      const rr = R * (0.8 + 0.07 * Math.sin(t * 5 + j * 1.7)) * grow;
      const hy = gy + 0.75 + 0.12 * Math.sin(th * 2 + t * 3);
      const bx = x + Math.cos(th) * rr, bz = z + Math.sin(th) * rr;
      tmpE.set(0.28 * Math.sin(j * 1.3), -t * 26 - j, 0.18);
      tmpQ.setFromEuler(tmpE);
      this.blade.add(bx, hy, bz, tmpQ, 0.85, 0.85, 0.85, WHITE, a);
      // The trail: a flat arc band behind the blade, fading back.
      const segs = 7, span = 0.95;
      for (let i = 0; i < segs; i++) {
        const t0 = th - span * (i + 1) / segs, t1 = th - span * i / segs;
        const k0 = (1 - (i + 1) / segs) * 1.5 * a, k1 = (1 - i / segs) * 1.5 * a;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        F.seg(x + c0 * (rr - 0.32), hy, z + s0 * (rr - 0.32), x + c0 * (rr + 0.32), hy, z + s0 * (rr + 0.32),
          x + c1 * (rr - 0.32), hy, z + s1 * (rr - 0.32), x + c1 * (rr + 0.32), hy, z + s1 * (rr + 0.32), BEAM, PINK, k0, k1);
      }
      fx.halo(bx, hy, bz, 0.8, PINK, 0.35 * a);
    }
    F.ground(x, gy + 0.04, z, R * 0.82, 0, C_RING, PINK, 0.3 * a);
    F.ground(x, gy + 0.03, z, R * 1.15, 0, C_GLOW, PINK, 0.22 * a);
    fx.light(x, gy + 1, z, 0xff5ab8, 5, 1.4 * a, true);
  }

  // ---- Sorceress

  /** FROZEN_ORB: an icy core wreathed in crystals, with a frost trail and snow shed behind it. */
  frozenOrb(c, ground, t, key, dt) {
    const F = this.flat, fx = this.fx;
    this.follow(key, c[1], c[2], dt);
    const x = this.ox, z = this.oy, p = c[7], r = c[8] || 0.45;
    let dx = c[5], dz = c[6];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const a = Math.min(1, p * 25);
    const gy = ground(x, z), h = gy + 0.95;
    tmpE.set(t * 2.1, t * 3.3, t * 1.3);
    tmpQ.setFromEuler(tmpE);
    const cs = r * 0.62 * a;
    this.orb.add(x, h, z, tmpQ, cs, cs, cs, ICE, 1);
    fx.halo(x, h, z, r * 4.5, ICE, 0.7 * a, 0.35 * a, r * 0.9);
    // Crystals turning about it.
    for (let j = 0; j < 6; j++) {
      const th = t * 4 + j * TAU / 6, tilt = Math.sin(t * 3 + j) * 0.5;
      tmpE.set(tilt, -th, 0.6);
      tmpQ.setFromEuler(tmpE);
      const rr = r * 1.55;
      this.ice.add(x + Math.cos(th) * rr, h + Math.sin(th * 2 + j) * r * 0.5, z + Math.sin(th) * rr, tmpQ, 0.2, 0.2, 0.2, ICE, a);
    }
    // Frost trail.
    for (let k = 1; k <= 9; k++) {
      const b = k * 0.24;
      fx.halo(x - dx * b, h - k * 0.015, z - dz * b, r * (3.4 - k * 0.25), ICE, 0.35 * (1 - k / 10) * a);
    }
    const n = this.count(26);
    for (let j = 0; j < n; j++) {
      const s = (hash(j, 111) + t * 1.4) % 1;
      const back = s * 2.6, ang = hash(j, 113) * TAU, sp = r * (0.4 + 1.2 * s);
      fx.additive.add(x - dx * back + Math.cos(ang) * sp, h - s * 0.7 + Math.sin(ang) * sp * 0.5, z - dz * back + Math.sin(ang) * sp,
        ICE_W.r, ICE_W.g, ICE_W.b, (1 - s) * a, 0.08 + 0.05 * hash(j, 115), 1);
    }
    F.ground(x, gy + 0.04, z, 1.0, t * 0.8, C_FROST, ICE, 0.55 * a);
    F.ground(x, gy + 0.03, z, 1.8, 0, C_GLOW, ICE, 0.35 * a);
    fx.light(x, h, z, 0x9fe0ff, 6, 2.8 * a);
  }

  /** BLIZZARD zone: frost on the ground, ice shards slanting down in a storm of snow. */
  blizzard(x, z, r, k, gy, t) {
    const F = this.flat, fx = this.fx;
    const a = envelope(k, 0.08, 0.12);
    const seed = Math.floor(x * 7 + z * 13);
    F.ground(x, gy, z, r * 1.05, hash(seed, 1) * TAU, C_FROST, ICE, 0.6 * a, 0.25 * a);
    F.ground(x, gy + 0.005, z, r * 0.7, hash(seed, 2) * TAU + 1, C_FROST, ICE_W, 0.4 * a);
    F.ground(x, gy, z, r * 1.25, 0, C_GLOW, ICE, 0.35 * a);
    F.ground(x, gy + 0.01, z, r * 1.02, t * 0.3, C_RING, ICE_W, 0.35 * a);
    // Wind slant of the fall.
    const wx = 0.38, wz = -0.22;
    const ns = this.count(24);
    for (let j = 0; j < ns; j++) {
      const ph = t * 1.15 + hash(j, 121, seed);
      const cyc = Math.floor(ph), u = ph - cyc;
      const ang = hash(j, cyc, seed) * TAU, d = Math.sqrt(hash(j, cyc + 7, seed)) * r * 0.92;
      const lx = x + Math.cos(ang) * d, lz = z + Math.sin(ang) * d;
      const lg = gy;
      if (u < 0.78) {
        const fall = 1 - u / 0.78, hgt = 7.5 * fall;
        const px = lx - wx * hgt, pz = lz - wz * hgt;
        tmpE.set(-0.35, Math.atan2(wx, -wz), 0);
        tmpQ.setFromEuler(tmpE);
        const sz = 0.16 + 0.1 * hash(j, 123, seed);
        this.ice.add(px, lg + hgt + 0.3, pz, tmpQ, sz, sz * 1.8, sz, ICE, a * smooth(u / 0.1));
      } else {
        // Shattered on landing: a glint and a few chips.
        const q = (u - 0.78) / 0.22;
        fx.halo(lx, lg + 0.15, lz, 0.9, ICE, (1 - q) * 0.8 * a, (1 - q) * 0.4 * a, 0.2);
        for (let m = 0; m < 3; m++) {
          const ca = hash(j, m + 125, cyc) * TAU, cd = 0.5 * q;
          fx.additive.add(lx + Math.cos(ca) * cd, lg + 0.1 + 0.5 * q * (1 - q) * 2, lz + Math.sin(ca) * cd, ICE_W.r, ICE_W.g, ICE_W.b, (1 - q) * a, 0.08, 1);
        }
      }
    }
    const nf = this.count(70);
    for (let j = 0; j < nf; j++) {
      const u = (hash(j, 131, seed) - t * 0.32) % 1, uu = u < 0 ? u + 1 : u;
      const hgt = uu * 5.5;
      const ang = hash(j, 133, seed) * TAU + t * 0.4, d = Math.sqrt(hash(j, 135, seed)) * r * 1.05;
      fx.additive.add(x + Math.cos(ang) * d - wx * hgt * 0.6, gy + hgt, z + Math.sin(ang) * d - wz * hgt * 0.6,
        ICE_W.r, ICE_W.g, ICE_W.b, 0.45 * a * Math.min(1, uu * 6), 0.06 + 0.04 * hash(j, 137), 1);
    }
    const nm = this.count(7);
    for (let j = 0; j < nm; j++) {
      const ang = j / nm * TAU + t * 0.5, d = r * 0.6;
      fx.normal.add(x + Math.cos(ang) * d, gy + 0.3, z + Math.sin(ang) * d, 0.75, 0.88, 1, 0.16 * a, 1.8, 2);
    }
    fx.light(x, gy + 1.5, z, 0xa8dcff, r * 2.4, 1.8 * a);
  }

  /** TELEPORT: arcane bursts where the hero leaves and lands, a violet streak between. */
  teleport(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const p = c[7], R = c[8] || 1.6, fade = 1 - p;
    for (let e = 0; e < 2; e++) {
      const x = e ? c[3] : c[1], z = e ? c[4] : c[2];
      const gy = ground(x, z) + 0.04;
      const eo = easeOut(p);
      fx.halo(x, gy + 0.9, z, 2.6, VIOLET, fade * fade, 0.7 * Math.pow(fade, 4), 0.5);
      F.ground(x, gy + 0.01, z, R * (0.25 + 0.95 * eo), 0, C_RING, VIOLET, 2 * fade);
      F.ground(x, gy, z, 1.25, (e ? t : -t) * 2.2, C_ARCANE, VIOLET, 1.8 * Math.pow(fade, 1.5));
      F.ground(x, gy, z, R * 1.1, 0, C_GLOW, VIOLET, 0.7 * fade);
      // A column of light, collapsing where he left and fading where he arrived.
      const cw = e ? 0.9 * (0.4 + 0.6 * fade) : 0.9 * fade;
      const f3 = fade * fade * fade;
      F.beam(x, gy, z, x, gy + 2.4, z, cw, BEAM_ENDS, VIOLET, 1.1 * f3);
      F.beam(x, gy, z, x, gy + 2.4, z, cw * 0.3, BEAM_ENDS, WHITE, 0.9 * f3);
      const n = this.count(14);
      for (let j = 0; j < n; j++) {
        const a = hash(j, 141 + e) * TAU, sp = 0.4 + hash(j, 143 + e);
        const d = e ? R * sp * eo : R * sp * (1 - eo);
        fx.additive.add(x + Math.cos(a) * d, gy + 0.2 + 1.8 * hash(j, 145) * (e ? eo : 1 - eo), z + Math.sin(a) * d, VIOLET.r, VIOLET.g, VIOLET.b, fade, 0.13, 1);
      }
      fx.light(x, gy + 1, z, 0xb070ff, 4, 3.2 * fade * fade);
    }
    if (p < 0.4) {
      const k = 1 - p / 0.4;
      const h0 = ground(c[1], c[2]) + 0.9, h1 = ground(c[3], c[4]) + 0.9;
      F.beam(c[1], h0, c[2], c[3], h1, c[4], 0.8, STREAK, VIOLET, 1.8 * k);
      F.beam(c[1], h0, c[2], c[3], h1, c[4], 0.15, STREAK, WHITE, 2.2 * k);
      const n = this.count(16);
      for (let j = 0; j < n; j++) {
        const u = hash(j, 151);
        fx.additive.add(c[1] + (c[3] - c[1]) * u, h0 + (h1 - h0) * u + (hash(j, 153) - 0.5) * 0.5 + p, c[2] + (c[4] - c[2]) * u,
          PINK.r, PINK.g, PINK.b, k, 0.1, 1);
      }
    }
  }

  /** BLACK_HOLE vortex (value > 0): a black core in a blazing accretion disc, light spiralling in. */
  vortex(c, ground, t, key, dt) {
    const F = this.flat, fx = this.fx;
    const x = c[1], z = c[2], p = c[7], R = c[8] || 4.5;
    const ang = this.spinAt(key, Math.atan2(c[6], c[5]), 6, dt);
    const a = Math.min(1, p * 12);
    const grow = easeOut(p / 0.15);
    const gy = ground(x, z), h = gy + 1.3;
    // The disc, flat about the core; then the core over it, edged with light.
    F.ground(x, gy + 0.06, z, 1.5 * grow, 0, C_GLOW, BLACK, 0, 0.7 * a);
    F.ground(x, h, z, 2.4 * grow, -ang * 0.6, C_DISC, HOLE_V, 1.0 * a, 0.2 * a);
    F.ground(x, h + 0.01, z, 1.6 * grow, -ang, C_DISC, HOLE_M, 1.4 * a);
    F.ground(x, h + 0.02, z, 1.05 * grow, -ang * 1.6, C_DISC, WHITE, 1.5 * a);
    fx.halo(x, h, z, 4 * grow, HOLE_V, 0.45 * a);
    F.sprite(x, h, z, 1.2 * grow, 0, C_RING, WHITE, 1.4 * a);
    F.sprite(x, h, z, 1.0 * grow, 0, C_HOLE, BLACK, 0, 1);
    // Light and dust drawn in on spirals.
    const n = this.count(48);
    for (let j = 0; j < n; j++) {
      const u = (t * 0.45 + hash(j, 161)) % 1;
      const rr = R * Math.pow(1 - u, 1.25) * (0.75 + 0.25 * hash(j, 163)) + 0.3;
      const th = hash(j, 165) * TAU - ang - u * 4.5;
      const yy = gy + 0.15 + (h - gy - 0.15) * u * u;
      const col = u > 0.7 ? WHITE : j & 1 ? HOLE_M : HOLE_V;
      fx.additive.add(x + Math.cos(th) * rr, yy, z + Math.sin(th) * rr, col.r, col.g, col.b, a * Math.sin(u * Math.PI), 0.1 + 0.08 * (1 - u), 1);
    }
    fx.light(x, h, z, 0xa060ff, 6, 2.4 * a);
  }

  /** BLACK_HOLE implosion (value < 0): the core collapses into a flash and a ring of force. */
  implosion(c, ground, t) {
    const F = this.flat, fx = this.fx;
    const x = c[1], z = c[2], p = c[7], R = -c[8] || 2.8, fade = 1 - p;
    const gy = ground(x, z), h = gy + 1.3;
    if (p < 0.2) {
      const k = 1 - p / 0.2;
      F.ground(x, h, z, 1.6 * k, t * 6, C_DISC, HOLE_V, 1.8 * k);
      F.sprite(x, h, z, 1.3 * k, 0, C_RING, WHITE, 2.4);
      F.sprite(x, h, z, 0.95 * k, 0, C_HOLE, BLACK, 0, 1);
    }
    const fl = easeOut((p - 0.1) / 0.3);
    fx.halo(x, h, z, R * 3 * (0.3 + 0.7 * fl), HOLE_V, fade * fade, 1.6 * fade * fade * fade, R);
    F.sprite(x, h, z, R * 4 * fl, 0, C_STAR, HOLE_M, 1.5 * fade * fade);
    const eo = easeOut(p);
    F.ground(x, gy + 0.05, z, R * (0.2 + 1.15 * eo), 0, C_RING, HOLE_M, 2.4 * fade);
    F.ground(x, gy + 0.06, z, R * (0.1 + 0.9 * easeOut(p * 1.3)), 0, C_RING, WHITE, 1.2 * fade * fade);
    F.ground(x, gy + 0.04, z, R * 1.3, 0, C_GLOW, HOLE_V, 0.9 * fade);
    for (let j = 0; j < 12; j++) {
      const a = j / 12 * TAU + hash(j, 171) * 0.4;
      const r0 = R * 0.2 * eo, r1 = R * (0.3 + 0.95 * eo);
      F.beam(x + Math.cos(a) * r0, h - 0.2, z + Math.sin(a) * r0, x + Math.cos(a) * r1, gy + 0.3, z + Math.sin(a) * r1, 0.32, STREAK, HOLE_M, 1.8 * fade);
    }
    fx.light(x, h, z, 0xc090ff, 8, 7 * fade * fade);
  }

  /** BLACK_HOLE zone: the pull's gravity well darkening the ground in a slow spiral. */
  well(x, z, r, k, gy, t) {
    const F = this.flat;
    const a = envelope(k, 0.05, 0.05);
    F.ground(x, gy, z, r * 1.05, -t * 1.2, C_SPIRAL, BLACK, 0, 0.5 * a);
    F.ground(x, gy + 0.005, z, r * 0.95, -t * 1.6 + 0.8, C_SPIRAL, HOLE_V, 0.22 * a);
    F.ground(x, gy + 0.01, z, r, t * 0.2, C_DASH, HOLE_V, 0.25 * a);
    F.ground(x, gy, z, r * 0.6, 0, C_GLOW, BLACK, 0, 0.45 * a);
  }

  // ---- other zones

  /** HOLY_LIGHT zone: a searing patch of light where a pillar struck. */
  holyLight(x, z, r, k, gy, t) {
    const F = this.flat, fx = this.fx;
    const a = envelope(k, 0.06, 0.4);
    F.ground(x, gy, z, r * 1.5, 0, C_GLOW, GOLD_W, 1.3 * a);
    F.ground(x, gy + 0.01, z, r * 1.05, t * 2, C_RUNES, GOLD, 1.0 * a);
    F.ground(x, gy + 0.01, z, r * (1 + 0.08 * Math.sin(t * 9 + x)), 0, C_RING, GOLD_W, 0.8 * a);
    F.beam(x, gy, z, x, gy + 3.2, z, r * 1.2, BEAM_ENDS, GOLD, 0.45 * a);
    fx.halo(x, gy + 0.3, z, r * 2.4, GOLD, 0.45 * a);
    const n = this.count(10);
    for (let j = 0; j < n; j++) {
      const u = (t * 1.3 + hash(j, 181)) % 1;
      const ang = hash(j, 183) * TAU, d = Math.sqrt(hash(j, 185)) * r * 0.9;
      fx.additive.add(x + Math.cos(ang) * d, gy + u * 1.8, z + Math.sin(ang) * d, GOLD_W.r, GOLD_W.g, GOLD_W.b, a * (1 - u), 0.12, 1);
    }
    fx.light(x, gy + 0.8, z, 0xffe08a, r * 3, 1.6 * a, true);
  }

  /** BLEED zone: a dark pool of blood that spreads, then dries away. */
  bleed(x, z, r, k, gy, t) {
    const F = this.flat, fx = this.fx;
    const a = envelope(k, 0.04, 0.25);
    const spread = 0.55 + 0.45 * easeOut(k / 0.15);
    const L = this.light;
    const seed = Math.floor(x * 11 + z * 5);
    const rot = hash(seed, 1) * TAU;
    tmpC.setRGB(0.075 * L, 0.002 * L, 0.003 * L);
    F.ground(x, gy, z, r * 0.95 * spread, rot, C_BLOOD, tmpC, 0.85 * a, 0.85 * a);
    tmpC.setRGB(0.03 * L, 0, 0);
    F.ground(x, gy + 0.004, z, r * 0.62 * spread, rot + 2.1, C_BLOOD, tmpC, 0.6 * a, 0.6 * a);
    // A wet sheen.
    F.ground(x, gy + 0.008, z, r * 0.45 * spread, rot + 4, C_BLOOD, RED, 0.035 * a);
    const n = this.count(5);
    for (let j = 0; j < n; j++) {
      const u = (t * 0.8 + hash(j, 191, seed)) % 1;
      const ang = hash(j, 193, seed) * TAU, d = Math.sqrt(hash(j, 195, seed)) * r * 0.6;
      fx.normal.add(x + Math.cos(ang) * d, gy + 0.04 + u * 0.12, z + Math.sin(ang) * d, BLOOD.r * 1.6, BLOOD.g, BLOOD.b, a * (1 - u) * 0.9, 0.05, 0);
    }
  }

  /** SANDSTORM zone: a whirling funnel of sand over a swirl on the ground. */
  sandstorm(x, z, r, k, gy, t) {
    const F = this.flat, fx = this.fx;
    const a = envelope(k, 0.1, 0.2);
    const build = 0.35 + 0.65 * smooth(k / 0.14);
    const L = Math.max(0.35, this.light);
    tmpC.copy(SAND).multiplyScalar(L);
    tmpC2.copy(SAND_D).multiplyScalar(L);
    F.ground(x, gy, z, r * 1.25, -t * 1.8, C_SAND, tmpC2, 0.5 * a, 0.5 * a);
    F.ground(x, gy + 0.01, z, r * 0.95, -t * 2.6, C_SPIRAL, tmpC, 0.45 * a, 0.45 * a);
    // The funnel: rings of blown sand, wider and fainter going up.
    const layers = 10;
    for (let i = 0; i < layers; i++) {
      const u = i / (layers - 1);
      const hy = gy + 0.2 + u * 4.6 * build;
      const rr = r * (0.32 + 0.75 * Math.pow(u, 0.85)) * (0.9 + 0.1 * Math.sin(t * 3 + i));
      const wob = 0.25 * u;
      const cx = x + Math.cos(t * 1.7 + i * 0.6) * wob, cz = z + Math.sin(t * 1.7 + i * 0.6) * wob;
      const k2 = (0.5 - 0.22 * u) * a * build;
      F.ground(cx, hy, cz, rr, -t * (4 - u * 1.5) + i * 1.3, C_SAND, i & 1 ? tmpC : tmpC2, k2, k2);
    }
    // A haze of sand through the column.
    F.beam(x, gy, z, x, gy + 5 * build, z, r * 1.7, BEAM_ENDS, tmpC, 0.22 * a, 0.22 * a);
    const n = this.count(80);
    for (let j = 0; j < n; j++) {
      const u = (t * 0.32 + hash(j, 201)) % 1;
      const hgt = u * 4.8 * build;
      const rr = r * (0.3 + 0.8 * Math.pow(u, 0.85)) * (0.75 + 0.4 * hash(j, 203));
      const th = hash(j, 205) * TAU - t * 3.6 - u * 3;
      const col = j & 3 ? SAND : SAND_D;
      fx.normal.add(x + Math.cos(th) * rr, gy + 0.1 + hgt, z + Math.sin(th) * rr, col.r, col.g, col.b, a * Math.min(1, (1 - u) * 3), 0.05 + 0.05 * hash(j, 207), 0);
    }
    const nd = this.count(9);
    for (let j = 0; j < nd; j++) {
      const th = j / nd * TAU - t * 2.2, d = r * (0.75 + 0.2 * Math.sin(t + j));
      fx.normal.add(x + Math.cos(th) * d, gy + 0.4, z + Math.sin(th) * d, SAND.r, SAND.g, SAND.b, 0.55 * a, 1.8, 2);
    }
  }
}
