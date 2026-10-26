// Coastline Run — a three-lane endless runner along a Mediterranean cliff coast.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Q = new URLSearchParams(location.search);
const MANUAL = Q.has('manual');           // screenshot mode: no rAF loop, game.advance() drives time
const LANE_W = 2.1;
const CHUNK = 40;
const SEG = 10;
const SEA_Y = -20;

/* ---------------------------------------------------------------- utils */
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const $ = (s) => document.querySelector(s);

/* ---------------------------------------------------------------- regions */
const REGIONS = {
  village: {
    name: 'Coastal Village',
    sky: [0x1260cf, 0x3f98ee, 0xbfe4ff], fog: 0xb4dcf6, fogNear: 90, fogFar: 340,
    sun: [0xfff0d2, 3.6, [26, 28, -4]], hemi: [0xcfe6ff, 0xdcb88c, 1.1], sea: 0xffffff, glow: 0xfff3cf, exposure: 1.0,
  },
  sunset: {
    name: 'Sunset Harbor',
    sky: [0x2b3f9a, 0xe97a6c, 0xffc07a], fog: 0xf2a982, fogNear: 80, fogFar: 320,
    sun: [0xff9a4a, 3.6, [34, 9, -26]], hemi: [0xffc7a0, 0x8b5f6c, 1.0], sea: 0xffc9a8, glow: 0xffb066, exposure: 1.0,
  },
};

/* ---------------------------------------------------------------- renderer / scene */
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: MANUAL });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe7f8, 70, 300);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);
const world = new THREE.Group();          // everything that scrolls / lifts for the zipline
scene.add(world);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0xdcb88c, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 3.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xfff4e6, 1.35);
fill.position.set(-8, 14, 40);
scene.add(fill);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.7, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* sky dome */
const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
  sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 20), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top, mid, hor, sunCol, sunDir; varying vec3 vD;
    void main(){ float h = clamp(vD.y, 0.0, 1.0);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.85, h));
      float s = max(dot(normalize(vD), sunDir), 0.0);
      c += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.42 + pow(s, 3.0) * 0.07);
      if (vD.y < 0.0) c = hor;
      gl_FragColor = vec4(c, 1.0); }`,
}));
sky.renderOrder = -10;
scene.add(sky);

/* clouds */
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const puffTex = puffTexture();
const cloudMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
const clouds = new THREE.Group();
{
  const r = mulberry32(77);
  for (let i = 0; i < 9; i++) {
    const cg = new THREE.Group();
    const n = 5 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Sprite(cloudMat);
      s.position.set((j - n / 2) * 34 + r() * 14, r() * 14, r() * 20);
      const sc = 46 + r() * 46; s.scale.set(sc, sc * 0.5, 1);
      cg.add(s);
    }
    cg.position.set((r() - 0.5) * 900, 150 + r() * 120, -260 - r() * 520);
    clouds.add(cg);
  }
}
scene.add(clouds);

/* sea */
function waterTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#c8e4e8'; x.fillRect(0, 0, 512, 512);
  const r = mulberry32(5);
  for (let i = 0; i < 260; i++) {
    const px = r() * 512, py = r() * 512, w = 18 + r() * 46;
    x.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`; x.lineWidth = 1.5 + r() * 2.2; x.lineCap = 'round';
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      x.beginPath(); x.moveTo(px + ox, py + oy); x.quadraticCurveTo(px + ox + w / 2, py + oy - 5 - r() * 5, px + ox + w, py + oy); x.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    const g = x.createRadialGradient(r() * 512, r() * 512, 2, r() * 512, r() * 512, 70);
    x.fillStyle = 'rgba(120,190,205,.06)'; x.beginPath(); x.arc(r() * 512, r() * 512, 40 + r() * 60, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.repeat.set(110, 110); return t;
}
const seaTex = waterTexture();
seaTex.repeat.set(1, 1);
const seaMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: seaTex });
const sea = (() => {
  const xs = [-1200, -80, 0, 6, 12, 20, 30, 42, 58, 80, 110, 160, 260, 600, 1200];
  const zs = [-1200, 1200];
  const ramp = [[0, '#6af2d6'], [14, '#38e0d0'], [30, '#14c4cf'], [58, '#0ea3cf'], [110, '#0b7fc0'], [300, '#0a62a8']];
  const colAt = (x) => { for (let i = 1; i < ramp.length; i++) if (x <= ramp[i][0]) { const a = ramp[i - 1], b = ramp[i]; return new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), (x - a[0]) / (b[0] - a[0])); } return new THREE.Color(ramp[ramp.length - 1][1]); };
  const pos = [], col = [], uv = [], idx = [];
  xs.forEach((x) => zs.forEach((z) => { pos.push(x, 0, z); uv.push(x / 14, z / 14); const c = colAt(Math.max(0, x)); col.push(c.r, c.g, c.b); }));
  for (let i = 0; i < xs.length - 1; i++) idx.push(i * 2, i * 2 + 1, (i + 1) * 2, i * 2 + 1, (i + 1) * 2 + 1, (i + 1) * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, seaMat); m.position.y = SEA_Y; m.receiveShadow = true; return m;
})();
scene.add(sea);

/* path texture */
function cobbleTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = '#9d8a6c'; x.fillRect(0, 0, S, S);
  const r = mulberry32(21);
  const rows = 6, rh = S / rows;
  const tones = ['#e2d2b2', '#d8c6a4', '#e8dbbf', '#cdb998', '#dfcfae', '#d3c09c'];
  for (let ri = 0; ri < rows; ri++) {
    let px = -r() * 80;
    while (px < S) {
      const w = 95 + r() * 70, y = ri * rh;
      const tone = tones[Math.floor(r() * tones.length)];
      x.fillStyle = tone;
      const rr = 9; const xx = px + 3, yy = y + 3, ww = w - 6, hh = rh - 6;
      for (const ox of [0, S]) {
        x.beginPath(); x.moveTo(xx + rr + ox, yy); x.arcTo(xx + ww + ox, yy, xx + ww + ox, yy + hh, rr);
        x.arcTo(xx + ww + ox, yy + hh, xx + ox, yy + hh, rr); x.arcTo(xx + ox, yy + hh, xx + ox, yy, rr); x.arcTo(xx + ox, yy, xx + ww + ox, yy, rr); x.fill();
        const g = x.createLinearGradient(0, yy, 0, yy + hh); g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(120,90,50,.18)');
        x.fillStyle = g; x.fill();
        x.fillStyle = 'rgba(130,100,60,.10)';
        for (let k = 0; k < 6; k++) x.fillRect(xx + ox + r() * ww, yy + r() * hh, 2 + r() * 3, 1.5 + r() * 2.5);
      }
      px += w;
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1.25, CHUNK / 6.4); return t;
}
const pathMat = new THREE.MeshStandardMaterial({ map: cobbleTexture(), roughness: 0.82 });
const sceneryMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const foamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
const shallowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: true });

/* ---------------------------------------------------------------- geometry builder (merged, vertex-coloured) */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed(),
  cone8: new THREE.ConeGeometry(1, 1, 8, 1).toNonIndexed(),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 9, 1).toNonIndexed(),
  sph: new THREE.IcosahedronGeometry(1, 1).toNonIndexed(),
  tri: (() => { const g = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, -1)])); return g.index ? g.toNonIndexed() : g; })(),
  sph0: new THREE.IcosahedronGeometry(1, 0).toNonIndexed(),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1).toNonIndexed(),
};
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
class Builder {
  constructor(shade = true) { this.parts = []; this.shade = shade; }
  add(geo, color, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0, mul = 1) {
    const g = geo.clone();
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    _c.set(color);
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = (this.shade ? 0.6 + 0.4 * clamp((pos.getY(i) - SEA_Y) / 16, 0, 1) : 1) * mul;
      col[i * 3] = _c.r * f; col[i * 3 + 1] = _c.g * f; col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }
  box(x, y0, z, w, h, d, color, ry = 0) { this.add(G.box, color, x, y0 + h / 2, z, w, h, d, ry); }
  cyl(x, y0, z, r, h, color, seg = G.cyl) { this.add(seg, color, x, y0 + h / 2, z, r, h, r); }
  roof(x, y0, z, w, d, h, color) { this.add(G.cone4, color, x, y0 + h / 2, z, w / 2 * Math.SQRT2, h, d / 2 * Math.SQRT2); }
  ball(x, y, z, r, color, sy = 1) { this.add(G.sph, color, x, y, z, r, r * sy, r); }
  bit(x, y, z, r, color) { this.add(G.sph0, color, x, y, z, r, r, r); }
  build(mat) {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, mat);
    return m;
  }
}

/* ---------------------------------------------------------------- palette */
const WALLS = [0xf4e7cc, 0xf2d8aa, 0xf0cba6, 0xeadccb, 0xf7f0e2, 0xe9c48f, 0xdcc6a8, 0xf3c9b0];
const ROOFS = [0xd6622e, 0xca5629, 0xdc7439, 0xc0502a];
const SHUT = [0x2f84a0, 0x3d9d86, 0x2a67a3, 0x7a4d36, 0x4aa07a];
const ROCKS = [0xcaa27e, 0xbb8f6e, 0xd7b793, 0xc29a78, 0xa98466];
const GRASS = [0x6aa84b, 0x5c9a42, 0x78b455];
const LEAF = [0x4f9a45, 0x62ac4a, 0x3f8a3e, 0x74b955];
const WOOD = 0x9a6234, WOOD_D = 0x734625, STONE = 0xd7c7a8, STONE_D = 0xb8a784;

/* ---------------------------------------------------------------- scenery pieces */
function tree(b, r, x, y0, z, s = 1) {
  if (r() < 0.38) { // cypress
    const h = (4 + r() * 3.2) * s;
    b.cyl(x, y0, z, 0.12 * s, 0.7 * s, 0x6b4a2c);
    b.add(G.cone8, 0x2d6b3b, x, y0 + 0.5 * s + h / 2, z, 0.62 * s, h, 0.62 * s);
    b.add(G.cone8, 0x3b7d45, x - 0.05, y0 + 0.9 * s + h * 0.42, z, 0.5 * s, h * 0.7, 0.5 * s);
  } else {
    const h = (1.0 + r() * 0.8) * s;
    b.cyl(x, y0, z, 0.16 * s, h, 0x735030);
    const k = (1.3 + r() * 0.8) * s;
    b.ball(x, y0 + h + k * 0.55, z, k, pick(r, LEAF), 0.85);
    b.ball(x + k * 0.55, y0 + h + k * 0.25, z + k * 0.2, k * 0.7, pick(r, LEAF), 0.8);
    b.ball(x - k * 0.5, y0 + h + k * 0.3, z - k * 0.25, k * 0.65, pick(r, LEAF), 0.8);
  }
}
function bush(b, r, x, y0, z, s = 1, flowers = true) {
  b.ball(x, y0 + 0.45 * s, z, 0.7 * s, pick(r, LEAF), 0.7);
  if (flowers) {
    const fc = pick(r, [0xff5f9e, 0xffd23c, 0xffffff, 0xff8a3d, 0xe8407a]);
    for (let i = 0; i < 6; i++) b.bit(x + (r() - .5) * 1.1 * s, y0 + 0.55 * s + r() * 0.5 * s, z + (r() - .5) * 1.0 * s, 0.13 * s, fc);
  }
}
function planter(b, r, x, y0, z) {
  b.cyl(x, y0, z, 0.32, 0.5, 0xc2642f);
  b.cyl(x, y0 + 0.5, z, 0.36, 0.1, 0xd0723a);
  b.ball(x, y0 + 0.85, z, 0.42, pick(r, LEAF), 0.8);
  const fc = pick(r, [0xff5f9e, 0xffd23c, 0xff4f5e, 0xffffff]);
  for (let i = 0; i < 5; i++) b.bit(x + (r() - .5) * 0.6, y0 + 0.9 + r() * 0.3, z + (r() - .5) * 0.6, 0.1, fc);
}
function windowAt(b, nx, x, y, z, ww, wh, shutterCol, lit, glow) {
  // nx: 0 = faces +x, 1 = faces +z
  const dk = lit ? 0xffd27a : 0x27384f;
  if (nx === 0) {
    b.box(x + 0.03, y, z, 0.1, wh, ww, dk); b.box(x + 0.08, y - 0.1, z, 0.22, 0.12, ww + 0.34, 0xf1e6d0);
    b.box(x + 0.09, y, z - ww / 2 - 0.2, 0.08, wh, 0.38, shutterCol); b.box(x + 0.09, y, z + ww / 2 + 0.2, 0.08, wh, 0.38, shutterCol);
    if (lit && glow) glow.box(x + 0.1, y + 0.05, z, 0.02, wh - 0.2, ww - 0.2, 0xffc060);
  } else {
    b.box(x, y, z + 0.03, ww, wh, 0.1, dk); b.box(x, y - 0.1, z + 0.08, ww + 0.34, 0.12, 0.22, 0xf1e6d0);
    b.box(x - ww / 2 - 0.2, y, z + 0.09, 0.38, wh, 0.08, shutterCol); b.box(x + ww / 2 + 0.2, y, z + 0.09, 0.38, wh, 0.08, shutterCol);
    if (lit && glow) glow.box(x, y + 0.05, z + 0.1, ww - 0.2, wh - 0.2, 0.02, 0xffc060);
  }
}
function house(b, r, cx, by, cz, w, d, h, detail, glow, lit) {
  const wall = pick(r, WALLS), roof = pick(r, ROOFS);
  b.box(cx, by - 0.5, cz, w, h + 0.5, d, wall);
  b.box(cx, by - 0.5, cz, w + 0.14, 0.9, d + 0.14, STONE_D);
  b.box(cx, by + h - 0.08, cz, w + 0.22, 0.22, d + 0.22, 0xf6ead3);
  const rh = Math.min(w, d) * 0.3 + 0.5;
  b.roof(cx, by + h + 0.1, cz, w + 0.9, d + 0.9, rh, roof);
  b.box(cx, by + h + 0.05, cz, w + 0.9, 0.12, d + 0.9, 0xb5502a);
  if (r() < 0.5) b.box(cx + (r() - .5) * w * .4, by + h + 0.3, cz + (r() - .5) * d * .4, 0.55, rh + 0.5, 0.55, 0xa9715a);
  if (!detail) return;
  const floors = Math.max(1, Math.floor((h - 0.4) / 2.35));
  const colsZ = Math.max(1, Math.floor((d - 0.8) / 2.3));
  const colsX = Math.max(1, Math.floor((w - 0.8) / 2.3));
  const sh = pick(r, SHUT);
  for (let f = 0; f < floors; f++) {
    const wy = by + 0.7 + f * 2.35 + (f === 0 ? 0.35 : 0);
    for (let c = 0; c < colsZ; c++) {
      const wz = cz - d / 2 + (c + 0.5) * d / colsZ;
      if (f === 0 && c === 0 && r() < 0.6) { b.box(cx + w / 2 + 0.03, by, wz, 0.1, 1.9, 1.1, 0x6a4430); b.box(cx + w / 2 + 0.06, by + 1.9, wz, 0.12, 0.2, 1.5, 0xf1e6d0); continue; }
      windowAt(b, 0, cx + w / 2, wy + 0.6, wz, 0.75, 1.15, sh, lit && r() < 0.7, glow);
    }
    for (let c = 0; c < colsX; c++) {
      const wx = cx - w / 2 + (c + 0.5) * w / colsX;
      windowAt(b, 1, wx, wy + 0.6, cz + d / 2, 0.75, 1.15, sh, lit && r() < 0.7, glow);
    }
  }
  if (r() < 0.45 && floors > 1) { // balcony
    const bz = cz + (r() - .5) * d * 0.4, by2 = by + 2.55;
    b.box(cx + w / 2 + 0.4, by2, bz, 0.9, 0.16, 1.9, 0xe9dcc3);
    b.box(cx + w / 2 + 0.82, by2 + 0.16, bz, 0.06, 0.62, 1.9, 0x2c3a4c);
  }
  if (r() < 0.35) { // awning
    const az = cz + (r() - .5) * d * 0.3;
    for (let i = 0; i < 4; i++) b.add(G.box, i % 2 ? 0xffffff : 0xd9302f, cx + w / 2 + 0.55, by + 2.45, az - 1.0 + i * 0.55, 1.3, 0.1, 0.55, 0, 0, -0.35);
  }
}
function tower(b, r, cx, by, cz, w, h) {
  b.box(cx, by - 0.5, cz, w, h + 0.5, w, 0xe6d6b9);
  b.box(cx, by + h * 0.6, cz, w + 0.18, 0.2, w + 0.18, 0xcdb994);
  b.box(cx, by + h, cz, w + 0.5, 0.35, w + 0.5, 0xcdb994);
  b.box(cx, by + h + 0.35, cz, w - 0.2, 1.8, w - 0.2, 0xdcc9a6);
  for (const s of [-1, 1]) { b.box(cx + s * (w / 2 - 0.1), by + h + 0.8, cz, 0.35, 1.1, 0.8, 0x4b3a2a); b.box(cx, by + h + 0.8, cz + s * (w / 2 - 0.1), 0.8, 1.1, 0.35, 0x4b3a2a); }
  b.roof(cx, by + h + 2.1, cz, w + 0.8, w + 0.8, w * 0.9, 0xc9552a);
  b.box(cx, by + h + 2.1 + w * 0.9, cz, 0.08, 1.4, 0.08, 0x3a3a3a);
  b.box(cx + 0.45, by + h + 2.1 + w * 0.9 + 0.9, cz, 0.8, 0.5, 0.04, 0xd8332c);
}
function gate(b, glow, zc) {
  const R = 3.9, CY = 3.0, depth = 3.2;
  for (const sgn of [-1, 1]) b.box(sgn * (R + 2.4), -1.0, zc, 4.8, CY + 1.0, depth, STONE);
  for (let i = 0; i <= 9; i++) { // voussoirs
    const a = i / 9 * Math.PI, x = Math.cos(a) * (R + 0.45), y = CY + Math.sin(a) * (R + 0.45);
    b.add(G.box, i % 2 ? 0xe4d5b6 : STONE, x, y, zc, 1.0, 0.95, depth + 0.3, 0, 0, a + Math.PI / 2);
  }
  const RO = R + 0.9;
  for (let i = 0; i < 18; i++) { const x = -RO + (i + 0.5) * (2 * RO / 18); const yA = CY + Math.sqrt(Math.max(0, RO * RO - x * x)); b.box(x, yA - 0.05, zc, 2 * RO / 18 + 0.02, 10.4 - yA, depth, STONE); }
  for (const sgn of [-1, 1]) b.box(sgn * (RO + 1.7), CY, zc, 3.4, 7.4, depth, STONE);
  b.box(0, 10.3, zc, 2 * RO + 6.8, 0.5, depth + 0.5, 0xcdb994);
  for (let i = -6; i <= 6; i++) b.box(i * 1.38, 10.8, zc, 0.8, 0.9, depth + 0.5, 0xd9c8a6);
  b.box(0, 10.5, zc + depth / 2 + 0.01, 3.2, 1.8, 0.12, 0x8a6d48);
  for (const sgn of [-1, 1]) { b.box(sgn * 5.2, 11.7, zc, 0.12, 3.4, 0.12, 0x3a3a3a); b.box(sgn * 5.2 + 0.7, 14.2, zc, 1.3, 0.8, 0.05, 0xd8332c); }
  for (const sgn of [-1, 1]) { glow.box(sgn * (R - 0.15), 3.6, zc + depth / 2 + 0.12, 0.28, 0.45, 0.28, 0xffd88a); b.box(sgn * (R - 0.15), 3.9, zc + depth / 2 + 0.12, 0.06, 1.4, 0.06, 0x2a2e38); }
}
function bunting(b, z, y0 = 6.1) {
  const cols = [0xff5a5f, 0xffd23c, 0x2fb7ff, 0xffffff, 0x2fd07a, 0xff8a3d], N = 16, x0 = -4.1, x1 = 4.3;
  let px = x0, py = y0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = lerp(x0, x1, t), y = y0 - 0.85 * Math.sin(Math.PI * t) + (t - 0.5) * 0.15;
    const dx = x - px, dy = y - py, len = Math.hypot(dx, dy);
    b.add(G.box, 0x3a2f28, (x + px) / 2, (y + py) / 2, z, len, 0.035, 0.035, 0, 0, Math.atan2(dy, dx));
    if (i < N) b.add(G.tri, cols[i % cols.length], x, y - 0.03, z, 0.34, 0.46, 1, 0, 0, Math.atan2(dy, dx) * 0.6);
    px = x; py = y;
  }
  b.box(-4.1, 0, z, 0.14, y0 + 0.1, 0.14, WOOD_D); b.box(4.3, 0, z, 0.14, y0 + 0.1, 0.14, WOOD_D);
}
function boat(b, x, z, s = 1.6, rot = 0) {
  const y = SEA_Y + 0.1;
  b.add(G.box, 0x7a4a2a, x, y + 0.3 * s, z, 0.9 * s, 0.5 * s, 3 * s, rot);
  b.add(G.box, 0x5e3a20, x, y + 0.62 * s, z, 0.95 * s, 0.1 * s, 3.05 * s, rot);
  const ox = Math.sin(rot), oz = Math.cos(rot);
  b.add(G.cyl, 0x5e3a20, x, y + 2.2 * s, z, 0.05 * s, 3.4 * s, 0.05 * s);
  b.add(G.box, 0xf1e7cf, x + ox * 0.25 * s, y + 2.3 * s, z + oz * 0.2 * s, 0.05 * s, 2.4 * s, 1.5 * s, rot);
  b.add(G.box, 0xe9dcc0, x - ox * 0.15 * s, y + 1.7 * s, z - oz * 0.95 * s, 0.05 * s, 1.5 * s, 0.9 * s, rot);
}

/* ---------------------------------------------------------------- chunk generation */
const coinGeo = (() => {
  const sh = new THREE.Shape(); const pts = [];
  for (let i = 0; i <= 26; i++) { const t = i / 26, th = lerp(Math.PI * 0.08, Math.PI * 0.92, t); const rr = 0.5 - 0.032 * Math.abs(Math.sin(th * 6.5)); pts.push([Math.cos(th) * rr, Math.sin(th) * rr * 0.98 + 0.04]); }
  sh.moveTo(0.07, -0.46); for (const [x, y] of pts) sh.lineTo(x, y); sh.lineTo(-0.07, -0.46); sh.closePath();
  const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.09, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 1 });
  ex.translate(0, 0, -0.045);
  const paint = (g, c) => { const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const strip = (g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
  const parts = [strip(paint(ex.index ? ex.toNonIndexed() : ex, 0xffc82a))];
  for (const a of [-0.78, -0.39, 0, 0.39, 0.78]) {                     // raised ridges, both faces
    for (const zf of [0.078]) {
      const g = new THREE.BoxGeometry(0.05, 0.6, 0.03).toNonIndexed();
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.44, 0).multiply(new THREE.Matrix4().makeRotationZ(-a)).multiply(new THREE.Matrix4().makeTranslation(0, 0.3, zf)));
      parts.push(strip(paint(g, 0xe08e00)));
    }
  }
  const merged = mergeGeometries(parts, false); merged.scale(0.82, 0.82, 0.82); return merged;
})();
const coinMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.28, emissive: 0xa86500, emissiveIntensity: 0.9 });

const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,170,.9)'); g.addColorStop(.4, 'rgba(255,200,60,.35)'); g.addColorStop(1, 'rgba(255,190,40,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const glowSpriteMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });

/* obstacle materials & meshes (each obstacle is one merged, vertex-coloured mesh) */
const M = {
  obs: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
  magRed: new THREE.MeshStandardMaterial({ color: 0xe0272e, roughness: 0.35, metalness: 0.2, emissive: 0x7a0a10, emissiveIntensity: 0.6 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.25, metalness: 0.8 }),
  shield: new THREE.MeshStandardMaterial({ color: 0x3d95f5, roughness: 0.3, metalness: 0.25, emissive: 0x0f3d9a, emissiveIntensity: 0.7 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc82a, roughness: 0.3, metalness: 0.6, emissive: 0x8a5200, emissiveIntensity: 0.6 }),
};
const BX = new THREE.BoxGeometry(1, 1, 1), CY = new THREE.CylinderGeometry(1, 1, 1, 14);
const WOODL = 0xd49650, WOODM = 0x95592a;
function obstacleMesh(type) {
  const o = new Builder(false);
  if (type === 'crate' || type === 'stack') {
    for (let i = 0, n = type === 'stack' ? 2 : 1; i < n; i++) {
      const y = i * 1.7, h = 0.85;
      o.box(0, y, 0, 1.7, 1.7, 1.7, WOODL);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.box(sx * (h - 0.08), y, sz * (h - 0.08), 0.16, 1.72, 0.16, WOODM);
      for (const yy of [0, 1.54]) o.box(0, y + yy, 0, 1.72, 0.16, 1.72, WOODM);
      for (const a of [Math.PI / 4, -Math.PI / 4]) o.add(G.box, WOODM, 0, y + h, h + 0.02, 0.14, 2.0, 0.05, 0, 0, a);
    }
  } else if (type === 'hurdle') {
    for (const sx of [-1, 1]) o.box(sx * 1.55, 0, 0, 0.18, 1.1, 0.18, WOODM);
    for (let i = 0; i < 6; i++) o.box(-1.25 + i * 0.5, 0.65, 0, 0.5, 0.34, 0.14, i % 2 ? 0xf6f1e6 : 0xd9302f);
    o.box(0, 0.5, 0, 3.2, 0.1, 0.1, WOODM);
  } else if (type === 'beam') {
    for (const sx of [-1, 1]) o.box(sx * 1.6, 0, 0, 0.22, 2.8, 0.22, WOODM);
    for (let i = 0; i < 6; i++) o.box(-1.25 + i * 0.5, 1.5, 0, 0.5, 0.42, 0.3, i % 2 ? 0xf6f1e6 : 0xd9302f);
    o.box(0, 1.94, 0, 3.5, 0.12, 0.2, WOODM);
  } else {   // barrel
    o.add(G.cyl12, WOODL, 0, 0.65, 0, 0.62, 1.3, 0.62); o.add(G.cyl12, 0xe0a763, 0, 0.65, 0, 0.7, 0.7, 0.7);
    for (const y of [0.2, 0.65, 1.1]) o.add(G.cyl12, 0x3a3f4a, 0, y, 0, y === 0.65 ? 0.72 : 0.66, 0.07, y === 0.65 ? 0.72 : 0.66);
  }
  const m = o.build(M.obs); m.castShadow = true; m.receiveShadow = true; return m;
}
function pickupGlow(color) { const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 })); gs.scale.set(3.4, 3.4, 1); return gs; }
function makeMagnet() {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.17, 10, 18, Math.PI), M.magRed); arc.rotation.z = Math.PI; arc.castShadow = true; g.add(arc);
  for (const sx of [-1, 1]) {
    const a = new THREE.Mesh(BX, M.magRed); a.position.set(sx * 0.42, 0.28, 0); a.scale.set(0.34, 0.5, 0.34); g.add(a);
    const t = new THREE.Mesh(BX, M.silver); t.position.set(sx * 0.42, 0.62, 0); t.scale.set(0.36, 0.2, 0.36); g.add(t);
  }
  g.add(pickupGlow(0xffffff)); g.scale.setScalar(1.25); return g;
}
const shieldGeo = (() => {
  const sh = new THREE.Shape(); sh.moveTo(0, 0.55); sh.lineTo(0.44, 0.4); sh.lineTo(0.44, 0.02); sh.quadraticCurveTo(0.42, -0.4, 0, -0.62); sh.quadraticCurveTo(-0.42, -0.4, -0.44, 0.02); sh.lineTo(-0.44, 0.4); sh.closePath();
  const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 6 }); ex.translate(0, 0, -0.06); return ex;
})();
function makeShield() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(shieldGeo, M.shield); body.castShadow = true; g.add(body);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), M.gold); star.scale.set(1, 1, 0.45); star.position.set(0, 0.05, 0.16); g.add(star);
  g.add(pickupGlow(0x7fc0ff)); g.scale.setScalar(1.25); return g;
}
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function writeCoin(o, spin) {
  const sc = o.alive ? 1 : 0;
  _cm.compose(_cp.set(o.x, o.y, o.z), _cq.setFromAxisAngle(_up, spin), _cs.set(sc, sc, sc));
  o.inst.setMatrixAt(o.idx, _cm); o.inst.instanceMatrix.needsUpdate = true;
}
function hideItem(o) { o.alive = false; if (o.inst) writeCoin(o, 0); else o.mesh.visible = false; }
function makeCoinBatch(list, parent) {
  const inst = new THREE.InstancedMesh(coinGeo, coinMat, list.length); inst.frustumCulled = false;
  list.forEach((it, i) => { it.inst = inst; it.idx = i; writeCoin(it, it.ph || 0); });
  parent.add(inst); return inst;
}

function buildChunk(k) {
  const r = mulberry32(k * 7919 + 104729);
  const z0 = -k * CHUNK, z1 = z0 - CHUNK, zc = (z0 + z1) / 2;
  const b = new Builder(), f = new Builder(), foam = new Builder(false), shallow = new Builder(false), glow = new Builder(false);
  const grp = new THREE.Group();
  const lit = region.lit;

  // --- path & edges
  const path = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.8, CHUNK), pathMat);
  path.position.set(0, -0.4, zc); path.receiveShadow = true; grp.add(path);
  b.box(-3.5, 0, zc, 0.3, 0.025, CHUNK, 0xb99a6c); b.box(3.5, 0, zc, 0.3, 0.025, CHUNK, 0xb99a6c);
  for (let z = z0 - 10; z > z1; z -= 24) bunting(b, z);
  b.box(-4.0, -1.0, zc, 0.7, 2.1, CHUNK, STONE);          // left wall
  b.box(-4.0, 1.1, zc, 0.95, 0.2, CHUNK, 0xe9dcc0);         // coping
  b.box(4.2, -1.0, zc, 0.7, 1.0, CHUNK, STONE);            // right kerb
  b.box(5.2, -1.2, zc, 1.6, 0.9, CHUNK, pick(r, GRASS));
  for (let z = z0 - 1.5; z > z1; z -= 3) {
    b.box(4.2, 0, z, 0.2, 1.25, 0.2, WOOD); b.box(4.2, 1.25, z, 0.28, 0.1, 0.28, WOOD_D);
  }
  b.box(4.2, 0.9, zc, 0.12, 0.16, CHUNK, WOOD); b.box(4.2, 0.45, zc, 0.12, 0.12, CHUNK, WOOD);

  // --- right: cliffs, ledge props, sea stacks, boats
  for (let zs = z0; zs > z1; zs -= 6.7) {
    const len = 6.9, d = r() * 1.2, zz = zs - 3.3;
    b.box(5.45, SEA_Y - 0.5, zz, 1.7, -1.3 - SEA_Y + 0.5, len, pick(r, ROCKS));                                  // cliff face under the rail
    f.box(6.6 + d, SEA_Y - 0.5, zz, 2.4, 8 + r() * 4, len * 0.92, pick(r, ROCKS));                               // stepped strata
    f.box(8.2 + d, SEA_Y - 0.5, zz + (r() - .5) * 2, 2.2, 3 + r() * 3, len * 0.7, pick(r, ROCKS));
    for (let i = 0; i < 2; i++) f.ball(8.8 + d + r() * 2.4, SEA_Y + 0.6, zz + (r() - .5) * 5, 1.2 + r() * 1.3, pick(r, ROCKS), 0.75);
    foam.box(8.8 + d, SEA_Y + 0.12, zz, 3.6, 0.04, len + 0.8, 0xffffff);
    shallow.box(12 + d, SEA_Y + 0.08, zz, 12, 0.04, len + 1, 0x58ecd4);
    if (r() < 0.55) bush(b, r, 5.0 + r() * 1.0, -0.3, zz + (r() - .5) * 4, 0.7 + r() * 0.4);
    if (r() < 0.12) tree(b, r, 5.2 + r() * 0.6, -0.3, zz, 0.8);
  }
  for (let z = z0 - 5; z > z1; z -= 10) { // lamp posts
    b.cyl(4.2, 0, z, 0.08, 3.3, 0x2a2e38); b.box(4.2, 3.25, z, 0.5, 0.12, 0.5, 0x2a2e38); b.box(4.2, 2.65, z, 0.12, 0.7, 0.12, 0x2a2e38);
    glow.box(4.2, 2.95, z, 0.34, 0.5, 0.34, lit ? 0xffd98a : 0xe8d9ae);
  }
  const nStack = 1 + Math.floor(r() * 2);
  for (let i = 0; i < nStack; i++) {
    const sx = 16 + r() * 36, sz = z1 + r() * CHUNK, rad = 3 + r() * 3.6, hh = 10 + r() * 22;
    f.add(G.cyl, pick(r, ROCKS), sx, SEA_Y + hh / 2 - 0.5, sz, rad, hh + 0.5, rad * (0.8 + r() * 0.4));
    f.add(G.cyl, pick(r, ROCKS), sx + 1, SEA_Y + hh * 0.35, sz + 1, rad * 1.35, hh * 0.7, rad * 1.1);
    f.cyl(sx, SEA_Y + hh - 0.4, sz, rad * 0.98, 0.9, pick(r, GRASS));
    for (let t = 0; t < 2; t++) tree(f, r, sx + (r() - .5) * rad, SEA_Y + hh + 0.4, sz + (r() - .5) * rad, 1.1);
    foam.add(G.cyl, 0xffffff, sx, SEA_Y + 0.1, sz, rad * 1.7, 0.04, rad * 1.7);
    shallow.add(G.cyl, 0x58ecd4, sx, SEA_Y + 0.07, sz, rad * 2.9, 0.04, rad * 2.9);
  }
  for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) boat(f, 11 + r() * 38, z1 + r() * CHUNK, 1.5 + r() * 0.6, r() * 3.1);

  // far headland village on the opposite shore (right-hand side of the bay)
  for (let q = 0; q < 5; q++) {
    const hx = 64 + q * 17, top = SEA_Y + 9 + q * 8.5;
    f.box(hx, SEA_Y - 0.5, zc, 17, top - SEA_Y + 0.5, CHUNK, pick(r, ROCKS));
    f.box(hx, top - 0.4, zc, 17, 0.5, CHUNK, pick(r, GRASS));
    shallow.box(hx - 12, SEA_Y + 0.08, zc, 12, 0.04, CHUNK + 1, 0x58ecd4);
    for (let zs = z0; zs > z1; zs -= SEG) {
      if (r() < 0.78) house(f, r, hx + (r() - .5) * 5, top, zs - SEG / 2 + (r() - .5) * 1.5, 5 + r() * 3, 5 + r() * 3.5, 3 + r() * 2.5, false);
      else tree(f, r, hx + (r() - .5) * 6, top, zs - SEG / 2, 1.3);
    }
  }
  for (let i = 0; i < 2; i++) { const mx = 120 + r() * 140, mh = 40 + r() * 60, mr = 26 + r() * 26; f.add(G.cone8, 0x6f9f86, mx, SEA_Y + mh / 2 - 1, z1 + r() * CHUNK, mr, mh, mr * 0.9); }  // hazy mountains

  // --- left: village terraces climbing the hillside
  const hgt = (row, z) => row * 3.4 + 1.3 * Math.sin(z * 0.045 + row * 1.7) + 0.7 * Math.sin(z * 0.11 + row);
  for (let row = 0; row < 6; row++) {
    const xr0 = 5.0 + row * 8.2, xcR = -(xr0 + 4.1), T = row < 2 ? b : f;
    for (let zs = z0; zs > z1; zs -= SEG) {
      const zm = zs - SEG / 2, by = row === 0 ? 0 : hgt(row, zm);
      if (row > 0) {
        T.box(xcR, SEA_Y - 0.5, zm, 8.6, by - SEA_Y - 0.1, SEG + 0.02, pick(r, ROCKS));
        T.box(xcR, by - 0.5, zm, 8.6, 0.55, SEG + 0.02, pick(r, GRASS));
      } else {
        T.box(xcR, -1.5, zm, 8.6, 1.4, SEG + 0.02, 0xbfae8c);
      }
      const roll = r();
      if (roll < 0.72) {
        const w = 4.4 + r() * 2.4, d = 5.4 + r() * 3.3, h = row === 0 ? 2.8 + r() * 2.0 : 3.2 + r() * 3.4;
        house(T, r, xcR + 4.1 - w / 2 - 0.2 - r() * 0.6, by, zm + (r() - .5) * 0.8, w, d, h, row < 2, glow, lit);
        if (r() < 0.4) tree(T, r, xcR - 3.6 + r() * 1.2, by, zm + (r() - .5) * 6, 0.9);
      } else if (roll < 0.82 && row > 0) {
        tower(T, r, xcR + (r() - .5) * 2, by, zm, 3.6 + r() * 0.8, 7 + r() * 3);
      } else {
        for (let t = 0; t < 2; t++) tree(T, r, xcR + (r() - .5) * 6, by, zm + (r() - .5) * 8, 1.1 + r() * 0.4);
        bush(T, r, xcR + 2 + r() * 2, by, zm + (r() - .5) * 6, 1.2);
      }
      if (row === 0 && r() < 0.8) bush(b, r, -5.0, 0, zm + (r() - .5) * 8, 1.0);
    }
  }
  f.box(-66, SEA_Y - 0.5, zc, 36, 70, CHUNK, 0x7fa56c);       // ridge behind the village
  for (let z = z0 - 3; z > z1; z -= 8 + r() * 4) planter(b, r, -3.55, 1.3, z);
  for (let z = z0 - 2; z > z1; z -= 5) b.box(-3.9, 1.3, z, 0.34, 0.9, 0.34, 0xe9dcc0);

  if (k % 5 === 3) gate(b, glow, zc - 4);

  const sc = b.build(sceneryMat); if (sc) { sc.castShadow = true; sc.receiveShadow = true; grp.add(sc); }
  const fs = f.build(sceneryMat); if (fs) grp.add(fs);                      // far scenery: no shadows
  const gl = glow.build(glowMat); if (gl) grp.add(gl);
  const fm = foam.build(foamMat); if (fm) { fm.renderOrder = 2; grp.add(fm); }
  const sh = shallow.build(shallowMat); if (sh) { sh.renderOrder = 1; grp.add(sh); }

  // --- gameplay objects
  const items = [], coinList = [];
  const addCoin = (lane, y, z) => { const it = { type: 'coin', x: lane * LANE_W, y, z, alive: true, ph: r() * 6 }; coinList.push(it); items.push(it); };
  const addObs = (type, lane, z) => {
    const box = { crate: { hw: 0.85, y0: 0, y1: 1.7, hd: 0.85 }, stack: { hw: 0.85, y0: 0, y1: 3.4, hd: 0.85 }, hurdle: { hw: 1.6, y0: 0, y1: 1.05, hd: 0.25 }, beam: { hw: 1.6, y0: 1.2, y1: 2.4, hd: 0.25 }, barrel: { hw: 0.65, y0: 0, y1: 1.3, hd: 0.65 } }[type];
    const m = obstacleMesh(type); m.position.set(lane * LANE_W, 0, z); grp.add(m);
    items.push({ type: 'obs', mesh: m, x: lane * LANE_W, z, box, alive: true });
  };
  if (k >= 2) {
    const rows = [z0 - 9, z0 - 21, z0 - 33];
    let prevFree = 0;
    rows.forEach((rz, ri) => {
      const roll = r(); const lanes = [-1, 0, 1]; const free = Math.floor(r() * 3) - 1;
      let freeLane = free;
      if (roll < 0.28) { const l = free; for (const x of lanes) if (x !== l) addObs('crate', x, rz); freeLane = l; }
      else if (roll < 0.46) { const l = pick(r, lanes); addObs('crate', l, rz); if (r() < 0.5) addObs('barrel', pick(r, lanes.filter((x) => x !== l)), rz); freeLane = lanes.find((x) => x !== l && !items.some((o) => o.type === 'obs' && o.z === rz && o.x === x * LANE_W)) ?? -l; }
      else if (roll < 0.62) { addObs('hurdle', 0, rz); for (const x of [-1, 1]) addObs('hurdle', x, rz); freeLane = 0; for (let i = -3; i <= 3; i++) addCoin(0, 1.0 + 1.9 * (1 - (i / 3) ** 2), rz + i * 1.5); }
      else if (roll < 0.76) { for (const x of lanes) addObs('beam', x, rz); freeLane = pick(r, lanes); }
      else if (roll < 0.88) { const l = free; addObs('stack', pick(r, lanes.filter((x) => x !== l)), rz); addObs('barrel', l, rz - 1); freeLane = pick(r, lanes); }
      else { for (const x of lanes) if (r() < 0.6) addObs('barrel', x, rz); freeLane = 0; }
      // coin trails
      const tl = roll >= 0.46 && roll < 0.62 ? 0 : freeLane;
      if (!(roll >= 0.46 && roll < 0.62)) for (let i = -4; i <= 4; i++) addCoin(tl, 1.0, rz + i * 1.5);
      prevFree = freeLane;
      const between = pick(r, lanes);
      for (let i = 0; i < 5; i++) addCoin(between, 1.0, rz - 6 - i * 1.6 + (ri === 2 ? -0 : 0));
    });
    if (k % 3 === 0) { const l = pick(r, [-1, 0, 1]); const m = makeMagnet(); m.position.set(l * LANE_W, 1.2, z0 - 15); grp.add(m); items.push({ type: 'magnet', mesh: m, x: l * LANE_W, y: 1.2, z: z0 - 15, alive: true }); }
    if (k % 7 === 0) { const l = pick(r, [-1, 0, 1]); const m = makeShield(); m.position.set(l * LANE_W, 1.2, z0 - 27); grp.add(m); items.push({ type: 'shield', mesh: m, x: l * LANE_W, y: 1.2, z: z0 - 27, alive: true }); }
  } else {
    for (let i = 0; i < 8; i++) addCoin(0, 1.0, z0 - 8 - i * 1.6);
  }
  const coinInst = coinList.length ? makeCoinBatch(coinList, grp) : null;
  grp.userData = { k, items, coinInst, zc };
  world.add(grp);
  return grp;
}

/* ---------------------------------------------------------------- character (Luna) */
const SKINS = { luna: 0xf2b88f };
function makeRunner() {
  const root = new THREE.Group();            // feet position, faces -Z
  const body = new THREE.Group(); root.add(body);   // pitch / slide pivot
  const lam = (c, rough = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
  const mats = { hood: lam(0xdfe3ea), hoodD: lam(0xb9c0cc), black: lam(0x20232b), navy: lam(0x2a3a52), skin: lam(SKINS.luna, 0.55), hair: lam(0xa5612b, 0.6), cap: lam(0x1d2740), white: lam(0xf5f6f8, 0.5), sole: lam(0x2b2e36), teal: lam(0x2f9e8e), eye: lam(0xffffff, 0.3), iris: lam(0x4a2d1a, 0.3), pupil: lam(0x050505, 0.2), blush: lam(0xff9a8a, 0.7) };
  const S = new THREE.SphereGeometry(1, 14, 10), C = (rad, len) => new THREE.CapsuleGeometry(rad, len, 3, 10);
  const add = (p, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; p.add(m); return m; };

  // torso (hoodie)
  const torso = new THREE.Group(); torso.position.y = 0.98; body.add(torso);
  add(torso, C(0.255, 0.36), mats.hood, 0, 0.27, 0, 1.08, 1, 0.84);
  add(torso, new THREE.TorusGeometry(0.2, 0.06, 8, 18, Math.PI * 1.25), mats.hoodD, 0, 0.68, 0.0).rotation.set(Math.PI / 2 - 0.2, 0, Math.PI * 0.62); // hood rim
  // backpack (back = +Z)
  const pack = new THREE.Group(); pack.position.set(0, 0.33, 0.3); torso.add(pack);
  add(pack, new THREE.BoxGeometry(0.46, 0.56, 0.26), mats.navy, 0, 0.05, 0.03);
  add(pack, new THREE.BoxGeometry(0.4, 0.2, 0.12), mats.teal, 0, -0.08, 0.17);
  add(pack, new THREE.CylinderGeometry(0.2, 0.2, 0.46, 16, 1, false, 0, Math.PI), mats.navy, 0, 0.33, 0.03).rotation.set(0, 0, Math.PI / 2);
  add(pack, new THREE.BoxGeometry(0.06, 0.42, 0.04), mats.black, -0.12, 0.2, -0.13);
  add(pack, new THREE.BoxGeometry(0.06, 0.42, 0.04), mats.black, 0.12, 0.2, -0.13);

  // head
  const head = new THREE.Group(); head.position.set(0, 0.86, 0); head.scale.setScalar(1.12); torso.add(head);
  add(head, S, mats.skin, 0, 0.3, 0, 0.27, 0.285, 0.265);
  add(head, new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10), mats.skin, 0, 0.0, 0.0);
  add(head, S, mats.hair, 0, 0.31, 0.075, 0.278, 0.262, 0.245);                      // hair mass (back and sides only)
  const pony = new THREE.Group(); pony.position.set(0, 0.34, 0.27); head.add(pony);
  add(pony, C(0.07, 0.3), mats.hair, 0, -0.18, 0.08, 1, 1, 1).rotation.x = -0.35;
  add(pony, S, mats.teal, 0, 0.0, 0.0, 0.055, 0.055, 0.055);
  // cap
  const capG = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const cap = add(head, capG, mats.cap, 0, 0.35, 0.0, 0.3, 0.3, 0.295);
  add(head, new THREE.BoxGeometry(0.4, 0.03, 0.2), mats.cap, 0, 0.36, -0.27).rotation.x = -0.12; // brim
  add(head, new THREE.BoxGeometry(0.52, 0.035, 0.1), mats.cap, 0, 0.36, 0.0);                         // band
  // face (toward -Z)
  for (const sx of [-1, 1]) {
    add(head, S, mats.eye, sx * 0.095, 0.28, -0.235, 0.062, 0.075, 0.03);
    add(head, S, mats.iris, sx * 0.095, 0.275, -0.255, 0.04, 0.05, 0.02);
    add(head, S, mats.pupil, sx * 0.095, 0.275, -0.265, 0.022, 0.028, 0.012);
    add(head, S, mats.eye, sx * 0.085, 0.29, -0.272, 0.011, 0.011, 0.01);
    add(head, S, mats.blush, sx * 0.15, 0.2, -0.205, 0.05, 0.028, 0.02);
    add(head, new THREE.BoxGeometry(0.1, 0.016, 0.02), mats.hair, sx * 0.095, 0.355, -0.245).rotation.z = sx * -0.15;
  }
  const mouth = add(head, new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI), mats.pupil, 0, 0.175, -0.255); mouth.rotation.z = Math.PI;
  add(head, S, mats.skin, 0, 0.235, -0.268, 0.022, 0.02, 0.02);

  // arms
  const arm = (sx) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.3, 0.62, 0); torso.add(sh);
    add(sh, S, mats.hood, 0, 0, 0, 0.085, 0.085, 0.085);
    add(sh, C(0.066, 0.2), mats.hood, 0, -0.17, 0);
    const el = new THREE.Group(); el.position.set(0, -0.33, 0); sh.add(el);
    add(el, C(0.062, 0.16), mats.hood, 0, -0.14, 0);
    add(el, S, mats.skin, 0, -0.3, 0, 0.058, 0.058, 0.058);
    return { sh, el };
  };
  const armL = arm(-1), armR = arm(1);

  // legs
  const leg = (sx) => {
    const hip = new THREE.Group(); hip.position.set(sx * 0.13, 0.98, 0); body.add(hip);
    add(hip, C(0.105, 0.22), mats.black, 0, -0.2, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.44, 0); hip.add(knee);
    add(knee, C(0.092, 0.2), mats.black, 0, -0.17, 0);
    const foot = new THREE.Group(); foot.position.set(0, -0.4, 0); knee.add(foot);
    add(foot, new THREE.BoxGeometry(0.17, 0.11, 0.34), mats.white, 0, -0.01, -0.07);
    add(foot, new THREE.BoxGeometry(0.18, 0.04, 0.36), mats.sole, 0, -0.07, -0.07);
    add(foot, S, mats.white, 0, 0.0, -0.2, 0.085, 0.06, 0.08);
    return { hip, knee, foot };
  };
  const legL = leg(-1), legR = leg(1);

  root.userData = { body, torso, head, pony, armL, armR, legL, legR };
  return root;
}
const runner = makeRunner();
function outlineMaterial(thick) {
  const m = new THREE.MeshBasicMaterial({ color: 0x142544, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.uniforms.thick = { value: thick }; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float thick;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * thick;'); };
  m.customProgramCacheKey = () => 'outline';
  return m;
}
{
  const meshes = []; runner.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const avg = (Math.abs(m.scale.x) + Math.abs(m.scale.y) + Math.abs(m.scale.z)) / 3;
    if (avg < 0.09 && m.geometry.type === 'SphereGeometry') continue;                    // eyes, nose, hands stay clean
    const o = new THREE.Mesh(m.geometry, outlineMaterial(0.016 / Math.max(avg, 0.05)));
    o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.copy(m.scale); o.castShadow = false; o.userData.outline = true;
    m.parent.add(o);
  }
}
scene.add(runner);

function poseRunner(t, mode, speed01, jumpPhase = 0) {
  const u = runner.userData;
  const ph = t * 11.5;
  const set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);
  u.body.rotation.set(0, 0, 0); u.body.position.set(0, 0, 0); u.torso.rotation.set(0, 0, 0);
  if (mode === 'run') {
    const a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    set(u.legL.hip, a * 0.95, 0, 0.04); set(u.legR.hip, b * 0.95, 0, -0.04);
    set(u.legL.knee, -Math.max(0, -Math.cos(ph)) * 1.45 - 0.1, 0, 0); set(u.legR.knee, -Math.max(0, Math.cos(ph)) * 1.45 - 0.1, 0, 0);
    set(u.legL.foot, 0.15, 0, 0); set(u.legR.foot, 0.15, 0, 0);
    set(u.armL.sh, b * 1.0, 0, 0.12); set(u.armR.sh, a * 1.0, 0, -0.12);
    set(u.armL.el, -0.9 - Math.max(0, b) * 0.4, 0, 0); set(u.armR.el, -0.9 - Math.max(0, a) * 0.4, 0, 0);
    u.torso.rotation.set(-0.2, Math.sin(ph) * 0.1, Math.sin(ph) * 0.03);
    u.body.position.y = Math.abs(Math.cos(ph)) * 0.09 - 0.03;
    set(u.head, 0.2, -Math.sin(ph) * 0.06, 0);
    u.pony.rotation.set(Math.sin(ph * 1.0 - 0.8) * 0.25, 0, Math.sin(ph * 0.5) * 0.2);
  } else if (mode === 'jump') {
    const k = clamp(jumpPhase, 0, 1);
    set(u.legL.hip, -1.15 + k * 0.5, 0, 0.06); set(u.legL.knee, -1.35 + k * 0.4, 0, 0);
    set(u.legR.hip, 0.55 + k * 0.1, 0, -0.06); set(u.legR.knee, -0.55, 0, 0);
    set(u.armL.sh, -0.3 - 1.9 * (1 - k), 0, 0.55); set(u.armR.sh, -0.3 - 1.9 * (1 - k) + 0.25, 0, -0.55);
    set(u.armL.el, -0.3, 0, 0); set(u.armR.el, -0.3, 0, 0);
    u.torso.rotation.set(-0.12, 0, 0); set(u.head, 0.12, 0, 0);
    u.pony.rotation.set(0.7, 0, 0);
  } else if (mode === 'slide') {
    u.body.rotation.set(1.25, 0, 0); u.body.position.set(0, 0.28, 0.55);
    set(u.legL.hip, -0.35, 0, 0.05); set(u.legR.hip, -0.2, 0, -0.05); set(u.legL.knee, -0.25, 0, 0); set(u.legR.knee, -0.45, 0, 0);
    set(u.armL.sh, -1.7, 0, 0.5); set(u.armR.sh, -1.7, 0, -0.5); set(u.armL.el, -0.2, 0, 0); set(u.armR.el, -0.2, 0, 0);
    set(u.head, -1.0, 0, 0); u.pony.rotation.set(0.6, 0, 0);
  } else if (mode === 'zip') {
    const sw = Math.sin(t * 3.2);
    set(u.armL.sh, -3.0, 0, 0.1); set(u.armR.sh, -3.0, 0, -0.1); set(u.armL.el, -0.1, 0, 0); set(u.armR.el, -0.1, 0, 0);
    set(u.legL.hip, 0.25 + sw * 0.15, 0, 0.05); set(u.legR.hip, 0.1 - sw * 0.15, 0, -0.05); set(u.legL.knee, -0.35, 0, 0); set(u.legR.knee, -0.6, 0, 0);
    u.torso.rotation.set(-0.05, 0, sw * 0.05); set(u.head, 0.25, 0, 0); u.pony.rotation.set(0.55 + sw * 0.1, 0, 0);
  } else if (mode === 'crash') {
    u.body.rotation.set(-0.5, 0, 0.2); set(u.legL.hip, 0.5, 0, 0); set(u.legR.hip, -0.4, 0, 0); set(u.armL.sh, -2.0, 0, 0.8); set(u.armR.sh, -1.2, 0, -0.8);
    set(u.head, 0.3, 0, 0.2);
  } else { // idle
    const br = Math.sin(t * 2.0) * 0.012;
    set(u.legL.hip, 0, 0, 0.05); set(u.legR.hip, 0, 0, -0.05); set(u.legL.knee, 0, 0, 0); set(u.legR.knee, 0, 0, 0);
    set(u.armL.sh, 0.1, 0, 0.12); set(u.armR.sh, 0.1, 0, -0.12); set(u.armL.el, -0.15, 0, 0); set(u.armR.el, -0.15, 0, 0);
    u.torso.scale.set(1, 1 + br, 1); set(u.head, 0.02, Math.sin(t * 0.9) * 0.12, 0); u.pony.rotation.set(0.05 + Math.sin(t * 1.7) * 0.05, 0, 0);
  }
  if (mode !== 'idle') u.torso.scale.set(1, 1, 1);
}

/* zipline fittings */
const zip = new THREE.Group();
{
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 500, 6), new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.9 }));
  rope.rotation.x = Math.PI / 2; rope.position.set(0, 2.62, -240); zip.add(rope);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.07), new THREE.MeshStandardMaterial({ color: 0x20232b, roughness: 0.5, metalness: 0.4 })); handle.position.set(0, 2.5, 0); zip.add(handle);
  const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xaab4c4, metalness: 0.8, roughness: 0.3 })); pulley.rotation.z = Math.PI / 2; pulley.position.set(0, 2.62, 0); zip.add(pulley);
  zip.visible = false;
}
scene.add(zip);

/* ---------------------------------------------------------------- game state */
const region = { id: 'village', lit: false, ...REGIONS.village };
const state = {
  mode: 'title',            // title | chars | missions | run | pause | over
  t: 0, speed: 0, dist: 0, coins: 0, score: 0, mult: 3,
  lane: 0, x: 0, y: 0, vy: 0, grounded: true, slide: 0, dead: 0,
  magnet: 0, shield: 0, zip: 0, zipBlend: 0, shake: 0, auto: false, best: 125430,
  camMode: 'title',
};
try { const b = parseInt(localStorage.getItem('coastline.best') || '0', 10); if (b) state.best = Math.max(b, 125430); } catch (e) { /* storage unavailable */ }
const chunks = new Map();
let allItems = [];
let jumpT = 0;

function applyLook() {
  skyU.top.value.set(region.sky[0]); skyU.mid.value.set(region.sky[1]); skyU.hor.value.set(region.sky[2]);
  skyU.sunCol.value.set(region.glow); skyU.sunDir.value.set(...region.sun[2]).normalize();
  scene.fog.color.set(region.fog); scene.fog.near = region.fogNear; scene.fog.far = region.fogFar;
  hemi.color.set(region.hemi[0]); hemi.groundColor.set(region.hemi[1]); hemi.intensity = region.hemi[2];
  sun.color.set(region.sun[0]); sun.intensity = region.sun[1];
  seaMat.color.set(region.sea);
  cloudMat.color.set(region.id === 'sunset' ? 0xffd2b0 : 0xffffff); cloudMat.opacity = 0.9;
  bloom.strength = region.id === 'sunset' ? 0.42 : 0.3;
}
function menuLook() {            // pale, hazy backdrop so a menu character stays vivid in the foreground
  skyU.top.value.set(0xcfe4f7); skyU.mid.value.set(0xdcecf9); skyU.hor.value.set(0xe8f3fc);
  scene.fog.color.set(0xdcecf9); scene.fog.near = 4.5; scene.fog.far = 19; cloudMat.opacity = 0;
}
function applyRegion(id) {
  Object.assign(region, REGIONS[id], { id, lit: id === 'sunset' });
  applyLook();
  rebuildWorld();
}
function rebuildWorld() {
  for (const g of chunks.values()) disposeChunk(g);
  chunks.clear(); allItems = [];
  ensureChunks(true);
}
const SHARED = new Set([coinGeo, BX, CY, shieldGeo]);
function disposeChunk(g) {
  world.remove(g);
  g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.isMesh && o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose(); });
}
function ensureChunks(force) {
  const k0 = Math.floor(-state.pz / CHUNK); let changed = false;
  for (let k = k0 - 1; k <= k0 + 6; k++) if (!chunks.has(k) && (force || !changed)) { chunks.set(k, buildChunk(k)); changed = true; }   // at most one new chunk per frame
  for (const [k, g] of chunks) if (k < k0 - 2) { disposeChunk(g); chunks.delete(k); changed = true; }
  if (changed) { allItems = []; for (const g of chunks.values()) allItems.push(...g.userData.items); }
}
state.pz = 0;

/* ---------------------------------------------------------------- particles */
const sparks = [];
function burst(x, y, z, color = 0xffe27a, n = 4) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color, opacity: 1 }));
    s.scale.setScalar(0.22 + Math.random() * 0.25); s.position.set(x, y, z); world.add(s);
    sparks.push({ s, vx: (Math.random() - .5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - .5) * 4, life: 0.5 });
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.life -= dt; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt; p.vy -= 6 * dt;
    p.s.material.opacity = Math.max(0, p.life * 1.2);
    if (p.life <= 0) { world.remove(p.s); p.s.material.dispose(); sparks.splice(i, 1); }
  }
}

/* ---------------------------------------------------------------- gameplay */
const JUMP_V = 13.5, GRAV = 36, ZIP_LIFT = 17;
function startRun() {
  state.mode = 'run'; state.camMode = 'run';
  Object.assign(state, { speed: 15, dist: 0, coins: 0, score: 0, lane: 0, x: 0, y: 0, vy: 0, grounded: true, slide: 0, dead: 0, magnet: 0, shield: 0, zip: 0, zipBlend: 0, pz: 0 });
  runner.rotation.set(0, 0, 0);
  rebuildWorld(); showScreen(null); $('#hud').classList.add('on'); $('#hint').classList.remove('off');
  setTimeout(() => $('#hint').classList.add('off'), 4000);
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1400); }
function jump() { if (state.mode !== 'run' || state.dead || state.zip) return; if (state.grounded) { state.vy = JUMP_V; state.grounded = false; state.slide = 0; jumpT = 0; } }
function slide() { if (state.mode !== 'run' || state.dead || state.zip) return; if (!state.grounded) state.vy = -22; state.slide = 0.75; }
function moveLane(d) { if (state.mode !== 'run' || state.dead) return; state.lane = clamp(state.lane + d, -1, 1); }
function crash() {
  if (state.god) return false;
  if (state.shield > 0) { state.shield = 0; state.shake = 0.4; toast('Shield!'); burst(state.x, 1.2, state.pz, 0x6fc3ff, 12); return false; }
  state.dead = 0.001; state.shake = 0.6; state.camMode = 'crash';
  return true;
}
function autopilot() {
  const ahead = (lane, far) => allItems.filter((o) => o.alive && o.type === 'obs' && Math.abs(o.x - lane * LANE_W) < 1.0 && o.z < state.pz - 0.5 && o.z > state.pz - far);
  const solid = (o) => o.box.y1 > 1.5 && o.box.y0 < 0.5;           // must be dodged by switching lane
  const order = [state.lane, state.lane - 1, state.lane + 1].filter((l) => l >= -1 && l <= 1);
  const best = order.find((l) => !ahead(l, 15).some(solid));
  if (best !== undefined && best !== state.lane) state.lane += Math.sign(best - state.lane);
  for (const o of ahead(state.lane, 5 + state.speed * 0.12)) {
    if (o.box.y1 < 1.2 && state.grounded) jump();
    else if (o.box.y0 > 1.0 && state.grounded && state.slide <= 0) slide();
  }
}
function collide() {
  const ph = state.slide > 0 ? 0.7 : 1.65, x0 = state.x, py0 = state.y + 0.05, py1 = state.y + ph;
  for (const o of allItems) {
    if (!o.alive) continue;
    const dz = o.z - state.pz;
    if (Math.abs(dz) > 3) continue;
    if (o.type === 'obs') {
      if (state.zip || state.zipBlend > 0.25) continue;
      if (Math.abs(o.x - x0) < o.box.hw + 0.3 && Math.abs(dz) < o.box.hd + 0.25 && py1 > o.box.y0 + 0.05 && py0 < o.box.y1 - 0.1) { if (crash()) return; else hideItem(o); }
    } else {
      const dx = o.x - x0, oy = o.zip ? 0 : o.y - (state.y + 0.9);
      if (Math.abs(dx) < 0.85 && Math.abs(dz) < 0.9 && Math.abs(oy) < 1.1 && (!state.zip === !o.zip)) {
        hideItem(o);
        if (o.type === 'coin') { state.coins++; state.score += 10; burst(o.x, o.y, o.z, 0xffe27a, 3); }
        else if (o.type === 'magnet') { state.magnet = 9; toast('Magnet!'); burst(o.x, o.y, o.z, 0xff6a5c, 12); }
        else if (o.type === 'shield') { state.shield = 1; toast('Shield!'); burst(o.x, o.y, o.z, 0x6fc3ff, 12); }
      }
    }
  }
}
function update(dt) {
  state.t += dt;
  const running = state.mode === 'run';
  if (running) {
    if (state.auto) autopilot();
    if (state.dead) {
      state.dead += dt; state.speed = damp(state.speed, 0, 5, dt);
      if (state.dead > 0.9 && state.mode === 'run') endRun();
    } else {
      state.speed = Math.min(34, state.speed + dt * 0.28);
      if (state.zip) state.speed = Math.max(state.speed, 22);
    }
    state.pz -= state.speed * dt; state.dist += state.speed * dt;
    state.x = damp(state.x, state.lane * LANE_W, 16, dt);
    if (state.slide > 0) state.slide -= dt;
    if (!state.zip) {
      if (!state.grounded) { state.vy -= GRAV * dt; state.y += state.vy * dt; jumpT += dt; if (state.y <= 0) { state.y = 0; state.vy = 0; state.grounded = true; } }
    } else {
      state.zip -= dt; state.y = damp(state.y, 0, 6, dt);
      if (state.zip <= 0) { state.zip = 0; state.grounded = false; state.vy = 0; state.y = 0.01; }
    }
    ensureChunks();
    if (!state.dead) {
      // magnet pull
      if (state.magnet > 0) {
        state.magnet -= dt;
        for (const o of allItems) if (o.alive && o.type === 'coin') {
          const dx = state.x - o.x, dy = state.y + 1 - o.y, dz = state.pz - o.z, d = Math.hypot(dx, dy, dz);
          if (d < 9 && dz > -9) { const s = Math.min(1, 34 * dt / Math.max(d, 0.1)); o.x += dx * s; o.y += dy * s; o.z += dz * s; }
        }
      }
      collide();
      state.score += state.speed * dt * 0.6;
      if (state.zip) for (const o of allItems) if (o.alive && o.type === 'coin' && o.z < state.pz && o.z > state.pz - 3) { /* zip coins are collected via collide */ }
    }
  } else if (state.mode === 'title' || state.mode === 'chars') {
    state.speed = 0;
  }
  // zip blend (world drops away beneath the player)
  state.zipBlend = damp(state.zipBlend, state.zip ? 1 : 0, 3.2, dt);
  world.position.y = -ZIP_LIFT * state.zipBlend;
  world.position.x = 0;
  // animate collectables
  for (const o of allItems) {
    if (!o.alive || o.type === 'obs' || Math.abs(o.z - state.pz) > 80) continue;
    if (o.type === 'coin') writeCoin(o, state.t * 3 + (o.ph || 0));
    else { o.mesh.rotation.y = state.t * 2.4; o.mesh.position.y = o.y + Math.sin(state.t * 3) * 0.12; }
  }
  updateSparks(dt);
  
  clouds.position.x += dt * 1.2;

  // character pose + placement
  let mode = 'idle';
  if (running) mode = state.dead ? 'crash' : state.zip ? 'zip' : !state.grounded ? 'jump' : state.slide > 0 ? 'slide' : 'run';
  if (state.mode === 'chars') mode = 'idle';
  const jp = state.grounded ? 0 : clamp(jumpT / 0.75, 0, 1);
  poseRunner(state.t, mode, state.speed / 34, jp);
  const hangY = state.zip ? -1.35 : 0;
  runner.position.set(state.x, state.y + hangY * Math.min(1, state.zipBlend * 1.2), state.pz);
  if (state.mode === 'run') runner.rotation.set(0, (state.lane * LANE_W - state.x) * -0.12, (state.lane * LANE_W - state.x) * 0.05);
  zip.visible = state.zipBlend > 0.05; zip.position.set(state.x, runner.position.y, state.pz);
  if (state.dead) runner.position.z += Math.min(state.dead, 0.6) * 0.8;

  // lights follow the runner
  sun.position.set(state.x + region.sun[2][0], region.sun[2][1] + 10, state.pz + region.sun[2][2]);
  sun.target.position.set(state.x, 0, state.pz - 6); sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  sea.position.set(0, SEA_Y + world.position.y, state.pz);
  seaTex.offset.set(state.t * 0.012, state.pz / 14 + state.t * 0.006);

  updateCamera(dt);
  hud();
}
function endRun() {
  state.mode = 'over';
  const sc = Math.floor(state.score) + state.coins * 5;
  const nb = sc > state.best; if (nb) { state.best = sc; try { localStorage.setItem('coastline.best', String(sc)); } catch (e) { /* ignore */ } }
  $('#hud').classList.remove('on');
  openOver(sc, nb);
}

/* ---------------------------------------------------------------- camera */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camTargetPos = new THREE.Vector3(), camTargetLook = new THREE.Vector3();
let camSnap = true;
function updateCamera(dt) {
  const px = runner.position.x, py = runner.position.y, pz = runner.position.z;
  const cm = state.camMode;
  const wy = world.position.y;
  if (cm === 'run' || cm === 'crash') {
    const lift = state.zipBlend;
    camTargetPos.set(px * 0.5 - 0.1, 4.6 + py * 0.35 + lift * 0.4, pz + 6.0 + lift * 2.6 + (cm === 'crash' ? 1.2 : 0));
    camTargetLook.set(px * 0.3 + 1.4, -1.4 + py * 0.3 - lift * 3.2, pz - 12);
  } else if (cm === 'title') {
    camTargetPos.set(0.1, 2.5, pz + 5.0); camTargetLook.set(0.6, 2.1, pz - 14);
  } else if (cm === 'chars') {
    camTargetPos.set(0.4, 1.5, pz - 4.8); camTargetLook.set(-0.85, 1.25, pz);
  } else if (cm === 'over') {
    camTargetPos.set(2.2, 3.4, pz + 8); camTargetLook.set(-1, 3.4, pz - 14);
  }
  if (camSnap) { camPos.copy(camTargetPos); camLook.copy(camTargetLook); camSnap = false; }
  else { const k = cm === 'run' ? 9 : 4; camPos.x = damp(camPos.x, camTargetPos.x, k, dt); camPos.y = damp(camPos.y, camTargetPos.y, k, dt); camPos.z = damp(camPos.z, camTargetPos.z, 14, dt); camLook.x = damp(camLook.x, camTargetLook.x, k, dt); camLook.y = damp(camLook.y, camTargetLook.y, k, dt); camLook.z = damp(camLook.z, camTargetLook.z, 14, dt); }
  camera.position.copy(camPos);
  if (state.shake > 0) { state.shake -= dt; camera.position.x += (Math.random() - .5) * state.shake * 0.5; camera.position.y += (Math.random() - .5) * state.shake * 0.5; }
  camera.lookAt(camLook);
  const asp = camera.aspect;
  camera.fov = (asp < 1 ? 74 : 54) + (state.mode === 'run' ? (state.speed - 15) * 0.18 : 0);
  camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------- HUD & UI */
const fmt = (n) => String(Math.floor(n)).padStart(6, '0');
let hudAcc = 0;
function hud() {
  if (state.mode !== 'run' && state.mode !== 'pause') return;
  $('#hudScore').textContent = fmt(state.score + state.coins * 5);
  $('#hudCoins').textContent = state.coins;
  $('#hudMult').textContent = 'x' + state.mult;
  const seg = (el, v, max) => { const n = 8, on = Math.ceil(clamp(v / max, 0, 1) * n); if (el.childElementCount !== n) el.innerHTML = '<i></i>'.repeat(n); [...el.children].forEach((c, i) => c.classList.toggle('off', i >= on)); };
  $('#powMagnet').classList.toggle('on', state.magnet > 0); if (state.magnet > 0) seg($('#segMagnet'), state.magnet, 9);
  $('#powShield').classList.toggle('on', state.shield > 0); if (state.shield > 0) seg($('#segShield'), 1, 1);
}
const SCREENS = ['title', 'chars', 'missions', 'over', 'pause'];
function showScreen(name) {
  for (const s of SCREENS) $('#' + s).classList.toggle('on', s === name);
  if (name === 'title') { state.mode = 'title'; state.camMode = 'title'; }
  if (name === 'chars') { state.mode = 'chars'; state.camMode = 'chars'; }
  if (name === 'chars') menuLook(); else applyLook();
  if (name === 'missions') { state.mode = 'missions'; state.camMode = 'over'; }
  if (name === 'over') { state.camMode = 'over'; }
  if (name && name !== 'pause') $('#hud').classList.remove('on');
  runner.visible = name !== 'missions' && name !== 'over';
  runner.rotation.set(0, name === 'chars' ? 0.35 : 0, 0);
}
function avatarSVG({ skin = '#f2b88f', hair = '#6a3f24', hat = '#17191f', kind = 'cap', bg = '#cfe3f7', shirt = '#dfe3ea', glasses = false }) {
  const hatShape = kind === 'cap' ? `<path d="M17 30a15 15 0 0 1 30 0z" fill="${hat}"/><rect x="14" y="29" width="36" height="4" rx="2" fill="${hat}"/><path d="M14 31h14" stroke="${hat}" stroke-width="5" stroke-linecap="round"/>`
    : kind === 'beanie' ? `<path d="M16 31a16 16 0 0 1 32 0z" fill="${hat}"/><rect x="15" y="28" width="34" height="6" rx="3" fill="#fff" opacity=".85"/><circle cx="32" cy="14" r="3.2" fill="#fff"/>`
    : kind === 'curly' ? `<circle cx="20" cy="25" r="8" fill="${hair}"/><circle cx="32" cy="20" r="9" fill="${hair}"/><circle cx="44" cy="25" r="8" fill="${hair}"/><circle cx="24" cy="19" r="6" fill="${hair}"/><circle cx="40" cy="19" r="6" fill="${hair}"/>`
    : kind === 'phones' ? `<path d="M16 32a16 16 0 0 1 32 0" fill="none" stroke="${hat}" stroke-width="4"/><rect x="11" y="28" width="7" height="12" rx="3.500" fill="${hat}"/><rect x="46" y="28" width="7" height="12" rx="3.500" fill="${hat}"/><path d="M17 31a15 15 0 0 1 30 0z" fill="${hair}"/>`
    : `<path d="M17 31a15 15 0 0 1 30 0z" fill="${hair}"/>`;
  return `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><path d="M6 64c1-13 11-18 26-18s25 5 26 18z" fill="${shirt}"/><rect x="27" y="40" width="10" height="9" rx="3" fill="${skin}"/><circle cx="32" cy="31" r="14" fill="${skin}"/>${hatShape}
    <ellipse cx="26.500" cy="33" rx="2.200" ry="2.700" fill="#2a1a10"/><ellipse cx="37.500" cy="33" rx="2.200" ry="2.700" fill="#2a1a10"/><circle cx="27.200" cy="32" r=".8" fill="#fff"/><circle cx="38.200" cy="32" r=".8" fill="#fff"/>
    ${glasses ? '<rect x="21.500" y="29.500" width="10" height="8" rx="3" fill="none" stroke="#222" stroke-width="1.600"/><rect x="32.500" y="29.500" width="10" height="8" rx="3" fill="none" stroke="#222" stroke-width="1.600"/><path d="M31.500 33h1" stroke="#222" stroke-width="1.600"/>' : ''}
    <path d="M28 40q4 3.200 8 0" fill="none" stroke="#7a3b2a" stroke-width="1.700" stroke-linecap="round"/><circle cx="22" cy="38" r="2.400" fill="#ff8f8f" opacity=".45"/><circle cx="42" cy="38" r="2.400" fill="#ff8f8f" opacity=".45"/></svg>`;
}
const CHARS = [
  { n: 'Luna', t: 'Fast feet. Bigger dreams.', stats: [['Speed', 4], ['Jump', 3], ['Stamina', 4]], a: { kind: 'cap', hat: '#17191f', hair: '#6a3f24', skin: '#f2b88f', bg: '#d4e6f6' } },
  { n: 'Marco', t: 'Cool head. Warm heart.', stats: [['Speed', 3], ['Jump', 4], ['Stamina', 3]], a: { kind: 'hair', hair: '#25180f', skin: '#c98e63', bg: '#d4e6f6', shirt: '#c9d6e6', glasses: true } },
  { n: 'Zoe', t: 'Never misses a beat.', stats: [['Speed', 4], ['Jump', 2], ['Stamina', 5]], a: { kind: 'curly', hair: '#1f130d', skin: '#8a5a3c', bg: '#d4e6f6', shirt: '#6aa8d8', glasses: true } },
  { n: 'Leo', t: 'Small. Fast. Big attitude.', stats: [['Speed', 5], ['Jump', 3], ['Stamina', 2]], a: { kind: 'beanie', hat: '#5aa6c9', hair: '#c68a3a', skin: '#f0c4a0', bg: '#d4e6f6', shirt: '#d9604a' } },
  { n: 'Mia', t: 'Music in every step.', stats: [['Speed', 3], ['Jump', 5], ['Stamina', 3]], a: { kind: 'phones', hat: '#e8559a', hair: '#7a3a5a', skin: '#f2b88f', bg: '#d4e6f6', shirt: '#ffd4e6' } },
];
let charIdx = 0;
function renderChars() {
  const c = CHARS[charIdx];
  $('#charName').textContent = c.n; $('#charTag').textContent = c.t;
  $('#charStats').innerHTML = c.stats.map(([k, v]) => `<div class="stat"><span>${k}</span><div class="meter"><i style="width:${v * 20}%"></i></div></div>`).join('');
  $('#avatars').innerHTML = CHARS.map((ch, i) => `<button class="av ${i === charIdx ? 'on' : ''}" data-i="${i}">${avatarSVG(ch.a)}</button>`).join('');
  $('#avatars').querySelectorAll('.av').forEach((b) => b.addEventListener('click', () => { charIdx = +b.dataset.i; renderChars(); }));
}
const MISSIONS = [
  ['i-shell', 'Collect 500 coins', 342, 500, '+2'], ['i-jump', 'Jump 20 times', 12, 20, '+2'],
  ['i-magnet', 'Use 3 power-ups', 1, 3, '+3'], ['i-run', 'Run 2,000 meters', 1280, 2000, '+3'],
];
function renderMissions() {
  $('#missionList').innerHTML = MISSIONS.map(([ic, t, v, m, r]) => `<div class="m"><div class="m-ic"><svg><use href="#${ic}"/></svg></div>
    <div class="m-body"><b>${t}</b><div class="bar"><i style="width:${v / m * 100}%"></i><em>${v.toLocaleString('en-US')} / ${m.toLocaleString('en-US')}</em></div></div>
    <div class="m-rew"><svg><use href="#i-star"/></svg>${r}</div></div>`).join('');
}
const BOARD = [['Alex', 268742, 0], ['Emma', 243561, 2], ['Daniel', 219830, 1], ['Sofia', 198412, 4], ['Lucas', 176205, 3]];
function openOver(score, newBest, you = 'You') {
  $('#overScore').textContent = score.toLocaleString('en-US');
  $('#overSub').textContent = newBest ? 'New personal best!' : 'Best: ' + state.best.toLocaleString('en-US');
  const rows = BOARD.map(([n, s, a]) => ({ n, s, a: CHARS[a].a, me: false })); rows.push({ n: you, s: score, a: CHARS[charIdx].a, me: true });
  rows.sort((a, b) => b.s - a.s); const top = rows.slice(0, 5);
  if (!top.some((r) => r.me)) top[4] = rows.find((r) => r.me);
  $('#boardList').innerHTML = top.map((r, i) => `<div class="b-row ${r.me ? 'me' : ''}"><span class="rk ${i === 0 ? 'gold' : ''}">${rows.indexOf(r) + 1}</span><span class="pf">${avatarSVG(r.a)}</span><span class="nm">${r.n}</span><span class="sc">${r.s.toLocaleString('en-US')}</span></div>`).join('');
  showScreen('over'); $('#over').classList.add('on'); state.mode = 'over';
}

/* input */
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { if (state.mode === 'title') startRun(); else jump(); }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') slide();
  else if (k === 'z' || k === 'Z') startZip();
  else if (k === 'Escape' || k === 'p' || k === 'P') togglePause();
  else if (k === 'Enter' && (state.mode === 'title' || state.mode === 'over')) startRun();
});
let tx = 0, ty = 0, tt = 0;
addEventListener('touchstart', (e) => { if (e.target.closest?.('button')) return; const t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; tt = performance.now(); }, { passive: true });
addEventListener('touchend', (e) => {
  if (e.target.closest?.('button') || state.mode !== 'run') return; const t = e.changedTouches[0]; const dx = t.clientX - tx, dy = t.clientY - ty;
  if (Math.hypot(dx, dy) < 24) { jump(); return; }
  if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1); else if (dy < 0) jump(); else slide();
}, { passive: true });
function startZip() {
  if (state.mode !== 'run' || state.dead) return;
  state.zip = 6; state.grounded = false; state.y = 0; state.vy = 0; state.slide = 0;
  const list = [];
  for (let i = 0; i < 24; i++) list.push({ type: 'coin', zip: true, x: Math.sin(i * 0.35) * LANE_W * 0.8, y: ZIP_LIFT - 0.4 + Math.sin(i * 0.5) * 0.5, z: state.pz - 14 - i * 1.7, alive: true, ph: i });
  const g = chunks.get(Math.floor(-state.pz / CHUNK));
  if (g) { makeCoinBatch(list, g); g.userData.items.push(...list); allItems.push(...list); }
  toast('Zipline!');
}
function togglePause() { if (state.mode === 'run') { state.mode = 'pause'; showScreen('pause'); $('#hud').classList.add('on'); } else if (state.mode === 'pause') { state.mode = 'run'; showScreen(null); $('#hud').classList.add('on'); } }
$('#btnPlay').addEventListener('click', startRun);
$('#btnAgain').addEventListener('click', startRun);
$('#btnPause').addEventListener('click', togglePause);
$('#btnResume').addEventListener('click', togglePause);
$('#btnQuit').addEventListener('click', () => { state.mode = 'title'; showScreen('title'); });
$('#btnSelect').addEventListener('click', () => { toast(CHARS[charIdx].n + ' selected'); });
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const g = b.dataset.go; if (g === 'chars' || g === 'missions' || g === 'title') showScreen(g); }));

/* sizing */
function resize() {
  const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
  renderer.setSize(w, h, false); composer.setSize(w, h); composer.setPixelRatio(pr); bloom.setSize(w * pr, h * pr);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------------------------------------------------------------- boot */
function render() { composer.render(); }
const regionId = Q.get('region') || 'village';
applyRegion(regionId);
renderChars(); renderMissions();
resize();
state.camMode = 'title';
showScreen(Q.get('screen') === 'none' ? null : 'title');
ensureChunks();

let last = performance.now(), avg = 1 / 60, ratio = renderer.getPixelRatio(), calm = 0;
function adapt(dtRaw) {                 // dynamic resolution: trade sharpness for a steady frame rate
  avg = lerp(avg, dtRaw, 0.05);
  if (state.mode !== 'run') return;
  if (avg > 1 / 40 && ratio > 1) { ratio = Math.max(1, ratio - 0.25); renderer.setPixelRatio(ratio); resize(); avg = 1 / 60; calm = 0; }
  else if (avg < 1 / 58 && ratio < Math.min(window.devicePixelRatio || 1, 2) && ++calm > 600) { ratio = Math.min(Math.min(window.devicePixelRatio || 1, 2), ratio + 0.25); renderer.setPixelRatio(ratio); resize(); calm = 0; }
}
function frame(now) {
  const dtRaw = (now - last) / 1000; const dt = Math.min(0.05, dtRaw); last = now; adapt(dtRaw);
  if (state.mode !== 'pause') update(dt);
  render();
  requestAnimationFrame(frame);
}
if (!MANUAL) requestAnimationFrame(frame);
update(0.016); render();

window.game = {
  state, THREE, scene, camera, region,
  advance(sec, step = 1 / 60) { let n = Math.round(sec / step); while (n-- > 0) update(step); render(); },
  until(fn, max = 8, step = 1 / 60) { let n = Math.round(max / step); while (n-- > 0 && !fn()) update(step); render(); },
  snap() { camSnap = true; update(0.001); render(); },
  startRun, startZip, showScreen, openOver, applyRegion, render, jump, slide, moveLane, setChar(i) { charIdx = i; renderChars(); },
  setAuto(v) { state.auto = v; },
  rendererInfo() { renderer.info.reset(); renderer.render(scene, camera); const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, chunks: chunks.size }; },
  clear(ahead = 3, behind = 7) {
    const gates = [...chunks.keys()].filter((k) => k % 5 === 3).map((k) => -(k * CHUNK + CHUNK / 2) - 4);
    const gateOk = gates.every((gz) => !(gz < state.pz + 25 && gz > state.pz - 55));
    return gateOk && state.grounded && state.slide <= 0 && !state.zip && Math.abs(state.x - state.lane * LANE_W) < 0.05 && !allItems.some((o) => o.alive && o.type === 'obs' && o.z < state.pz + behind && o.z > state.pz - ahead);
  },
};
