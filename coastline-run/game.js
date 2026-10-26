// Coastline Run — a three-lane endless runner along a Mediterranean cliff coast.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
    sun: [0xfff0d2, 3.4, [22, 28, -18]], hemi: [0xcfe6ff, 0xdcb88c, 0.35], sea: 0xffffff, glow: 0xfff3cf, exposure: 1.0,
  },
  sunset: {
    name: 'Sunset Harbor',
    sky: [0x2b3f9a, 0xe97a6c, 0xffc07a], fog: 0xf2a982, fogNear: 80, fogFar: 320,
    sun: [0xff9a4a, 3.6, [34, 9, -26]], hemi: [0xffc7a0, 0x8b5f6c, 0.3], sea: 0xffc9a8, glow: 0xffb066, exposure: 1.0,
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
const fill = new THREE.DirectionalLight(0xfff4e6, 1.1);
fill.position.set(-8, 14, 40);
scene.add(fill);

const msaaTarget = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, msaaTarget);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.7, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, sat: { value: 1.14 }, con: { value: 1.07 }, vig: { value: 0.32 }, warm: { value: new THREE.Color(1.04, 1.0, 0.93) }, cool: { value: new THREE.Color(0.94, 0.99, 1.06) }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, sat, con, vig; uniform vec3 warm, cool; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = (c - 0.5) * con + 0.5;
      c *= mix(cool, warm, smoothstep(0.2, 0.85, l));
      float v = smoothstep(0.95, 0.25, length((vUv - 0.5) * vec2(1.0, 1.25)));
      c *= mix(1.0 - vig, 1.0, v);
      c += (hash(vUv * res) - 0.5) * 0.012;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
});
composer.addPass(gradePass);

/* sky dome: gradient, procedural clouds, sun glow */
const skyU = {
  top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: new THREE.Color(0xc9a67a) },
  sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, time: { value: 0 }, cloud: { value: 1 },
  cloudCol: { value: new THREE.Color(1, 1, 1) }, shade: { value: new THREE.Color(0.6, 0.7, 0.85) },
};
const SKY_VERT = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = `uniform vec3 top, mid, hor, gnd, sunCol, sunDir, cloudCol, shade; uniform float time, cloud, sunAmt, envMode; varying vec3 vD;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.85, h));
    if (d.y < 0.0) c = mix(hor, gnd, envMode * smoothstep(0.0, -0.35, d.y));
    float s = max(dot(d, sunDir), 0.0);
    c += sunCol * (pow(s, 900.0) * 4.0 * sunAmt + pow(s, 14.0) * 0.42 + pow(s, 3.0) * 0.07);
    if (cloud > 0.5 && d.y > 0.015) {
      vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(time * 0.012, time * 0.004);
      float f = fbm2(uv * 1.15), f2 = fbm2(uv * 1.15 + sunDir.xz * 0.28);
      float cov = smoothstep(0.50, 0.80, f);
      float lit = clamp(0.55 + (f - f2) * 2.6, 0.0, 1.0);
      vec3 cc = mix(shade, cloudCol, lit) + sunCol * pow(s, 6.0) * 0.4 * cov;
      c = mix(c, cc, cov * smoothstep(0.015, 0.14, d.y) * 0.96);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;
const skyMaterial = (envMode) => new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { ...skyU, envMode: { value: envMode }, sunAmt: { value: envMode ? 0 : 1 } } });
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 20), skyMaterial(0));
sky.renderOrder = -10;
scene.add(sky);

/* image-based lighting baked from the sky */
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(1)));
let envRT = null;
function bakeEnv() { if (envRT) envRT.dispose(); envRT = pmrem.fromScene(envScene, 0, 0.1, 200); scene.environment = envRT.texture; }

/* sea: analytic waves, depth gradient, fresnel sky reflection, sun glints, caustics */
const seaU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
  time: { value: 0 }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() },
  skyTop: { value: new THREE.Color() }, skyHor: { value: new THREE.Color() },
  cShallow: { value: new THREE.Color(0x6af2d6) }, cMid: { value: new THREE.Color(0x12bfcf) }, cDeep: { value: new THREE.Color(0x0a69b0) },
}]);
const seaMat = new THREE.ShaderMaterial({
  uniforms: seaU, fog: true,
  vertexShader: `varying vec3 vW;
    #include <fog_pars_vertex>
    void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    }`,
  fragmentShader: `uniform float time; uniform vec3 sunDir, sunCol, skyTop, skyHor, cShallow, cMid, cDeep; varying vec3 vW;
    #include <fog_pars_fragment>
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    vec2 wave(vec2 dir, float freq, float amp, float spd, vec2 p, inout float h){ float ph = dot(dir, p) * freq + time * spd; h += amp * sin(ph); return dir * (amp * freq * cos(ph)); }
    void main(){
      vec2 p = vW.xz; float dist = length(cameraPosition - vW);
      float h = 0.0; vec2 g = vec2(0.0);
      g += wave(normalize(vec2(1.0, 0.35)), 0.55, 0.10, 0.9, p, h);
      g += wave(normalize(vec2(-0.4, 1.0)), 0.9, 0.07, 1.2, p, h);
      g += wave(normalize(vec2(0.8, 0.9)), 1.7, 0.04, 1.7, p, h);
      g += wave(normalize(vec2(-1.0, 0.3)), 3.1, 0.02, 2.3, p, h);
      g += (n2(p * 2.3 + vec2(time * 0.25, -time * 0.18)) - n2(p * 2.1 + vec2(-time * 0.2, time * 0.1))) * 0.07;
      g *= 1.0 / (1.0 + dist * 0.04);
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y)); vec3 V = normalize(cameraPosition - vW);
      float x = max(vW.x, 0.0);
      vec3 col = mix(cShallow, cMid, smoothstep(2.0, 26.0, x)); col = mix(col, cDeep, smoothstep(40.0, 150.0, x));
      col += vec3(0.04, 0.16, 0.14) * smoothstep(-0.04, 0.2, h) * (1.0 - smoothstep(30.0, 100.0, x));
      float c1 = n2(p * 1.25 + time * 0.15), c2 = n2(p * 1.75 - time * 0.12);
      col += pow(clamp(1.0 - abs(c1 - c2) * 2.2, 0.0, 1.0), 6.0) * 0.11 * (1.0 - smoothstep(4.0, 40.0, x)) * vec3(0.5, 1.0, 0.9);
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
      vec3 R = reflect(-V, N);
      vec3 sk = mix(skyHor, skyTop, smoothstep(0.0, 0.6, max(R.y, 0.0)));
      float sd = max(dot(R, sunDir), 0.0);
      col = mix(col, sk, fres * 0.85) + sunCol * (pow(sd, 350.0) * 6.0 + pow(sd, 30.0) * 0.22);
      gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    }`,
});
const sea = (() => {
  const xs = [-1200, -80, 0, 1200], zs = [-1200, 1200];
  const pos = [], idx = [];
  xs.forEach((x) => zs.forEach((z) => pos.push(x, 0, z)));
  for (let i = 0; i < xs.length - 1; i++) idx.push(i * 2, i * 2 + 1, (i + 1) * 2, i * 2 + 1, (i + 1) * 2 + 1, (i + 1) * 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, seaMat); m.position.y = SEA_Y; m.frustumCulled = false; return m;
})();
scene.add(sea);

/* path texture: colour + height map (rounded pavers, moss in the joints) */
function cobbleTextures() {
  const S = 1024, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  const [cc, x] = mk(), [hc, hx] = mk();
  x.fillStyle = '#8c7a5c'; x.fillRect(0, 0, S, S); hx.fillStyle = '#1c1c1c'; hx.fillRect(0, 0, S, S);
  const r = mulberry32(21), rows = 6, rh = S / rows;
  const tones = ['#e6d7b8', '#dccaa8', '#ecdfc4', '#d2bf9d', '#e2d2b1', '#d6c4a0', '#cdb893'];
  const rrect = (c, X, Y, W, H, R) => { c.beginPath(); c.moveTo(X + R, Y); c.arcTo(X + W, Y, X + W, Y + H, R); c.arcTo(X + W, Y + H, X, Y + H, R); c.arcTo(X, Y + H, X, Y, R); c.arcTo(X, Y, X + W, Y, R); c.closePath(); };
  for (let ri = 0; ri < rows; ri++) {
    let px = -r() * 150;
    while (px < S) {
      const w = 190 + r() * 130, y = ri * rh, tone = tones[Math.floor(r() * tones.length)];
      for (const ox of [0, S]) {
        const X = px + 6 + ox, Y = y + 6, W = w - 12, H = rh - 12;
        rrect(x, X, Y, W, H, 20); x.fillStyle = tone; x.fill();
        const g = x.createLinearGradient(0, Y, 0, Y + H); g.addColorStop(0, 'rgba(255,255,255,.30)'); g.addColorStop(1, 'rgba(110,80,40,.22)'); x.fillStyle = g; x.fill();
        for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(${90 + r() * 40},${70 + r() * 30},${40 + r() * 20},${0.05 + r() * 0.08})`; x.fillRect(X + r() * W, Y + r() * H, 2 + r() * 6, 2 + r() * 5); }
        if (r() < 0.35) { const gx = x.createRadialGradient(X + r() * W, Y + r() * H, 2, X + W / 2, Y + H / 2, 60 + r() * 50); gx.addColorStop(0, 'rgba(120,140,70,.22)'); gx.addColorStop(1, 'rgba(120,140,70,0)'); x.fillStyle = gx; rrect(x, X, Y, W, H, 20); x.fill(); }
        hx.save(); hx.shadowColor = '#000'; hx.shadowBlur = 0; rrect(hx, X, Y, W, H, 20);
        const hg = hx.createRadialGradient(X + W / 2, Y + H / 2, 4, X + W / 2, Y + H / 2, Math.max(W, H) * 0.6); hg.addColorStop(0, '#d8d8d8'); hg.addColorStop(0.75, '#a8a8a8'); hg.addColorStop(1, '#6a6a6a'); hx.fillStyle = hg; hx.fill(); hx.restore();
      }
      px += w;
    }
  }
  x.strokeStyle = 'rgba(105,125,62,.28)'; x.lineWidth = 4; for (let ri = 0; ri < rows; ri++) { x.beginPath(); x.moveTo(0, ri * rh); x.lineTo(S, ri * rh); x.stroke(); }
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(1.25, CHUNK / 6.4); return t; };
  return { map: tex(cc, true), bump: tex(hc, false) };
}
const cobble = cobbleTextures();
const pathMat = new THREE.MeshStandardMaterial({ map: cobble.map, bumpMap: cobble.bump, bumpScale: 2.4, roughness: 0.78, envMapIntensity: 0.8 });
const sceneryMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.9 });

/* Procedural surface detail, driven by a per-vertex material id:
   1 plaster, 2 roof tile, 3 ashlar stone, 4 painted wood, 5 strata rock, 6 foliage/grass, 7 glass */
const PATTERN_PARS = `varying float vMid; varying vec3 vWPos; varying vec3 vWNrm;
  float gR = 0.0; float gH = 0.0; float gB = 0.0;
  float ph31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float pn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(ph31(i), ph31(i + vec3(1,0,0)), f.x), mix(ph31(i + vec3(0,1,0)), ph31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(ph31(i + vec3(0,0,1)), ph31(i + vec3(1,0,1)), f.x), mix(ph31(i + vec3(0,1,1)), ph31(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float pf3(vec3 p){ return pn3(p) * 0.6 + pn3(p * 2.07) * 0.4; }`;
const PATTERN_COLOR = `{
  int id = int(vMid + 0.5);
  if (id > 0) {
    vec3 P = vWPos; vec3 N = normalize(vWNrm);
    float fade = 1.0 - smoothstep(28.0, 95.0, length(vViewPosition));
    vec3 base = diffuseColor.rgb; vec3 col = base;
    bool top = abs(N.y) > 0.7;
    float u = top ? P.x : (abs(N.x) > abs(N.z) ? P.z : P.x);
    float v = top ? P.z : P.y;
    if (id == 1) {
      float a = pf3(P * 2.1), b = pn3(P * 9.0);
      col *= (0.88 + 0.24 * a) * (0.94 + 0.12 * b) * (0.9 + 0.2 * pf3(P * 0.35 + 7.0));
      gH = a * 0.6 + b * 0.4; gB = 0.03; gR = 0.06;
    } else if (id == 2) {
      float ru = abs(N.x) > abs(N.z) ? P.z : P.x;
      float sl = sqrt(max(1.0 - N.y * N.y, 0.06));
      float row = P.y / (0.30 * sl); float ri = floor(row), rf = fract(row);
      float cc = ru / 0.46 + mod(ri, 2.0) * 0.5; float cf = fract(cc), ci = floor(cc);
      float tt = ph31(vec3(ci, ri, 3.0));
      float gap = smoothstep(0.0, 0.14, rf) * smoothstep(0.0, 0.09, cf) * smoothstep(1.0, 0.91, cf);
      col *= (0.80 + 0.34 * tt) * mix(0.5, 1.0, gap) * (0.92 + 0.16 * pf3(P * 0.7));
      gH = sin(cf * 3.14159) * 0.5 + rf * 0.6 - (1.0 - gap) * 0.7; gB = 0.05; gR = 0.1;
    } else if (id == 3) {
      float vv = v / 0.55; float ri = floor(vv), rf = fract(vv);
      float bw = 0.9 + 0.6 * ph31(vec3(ri, 1.0, 2.0)); float uu = u / bw + ph31(vec3(ri, 5.0, 1.0)); float cf = fract(uu), ci = floor(uu);
      float mortar = smoothstep(0.0, 0.08, rf) * smoothstep(1.0, 0.92, rf) * smoothstep(0.0, 0.05, cf) * smoothstep(1.0, 0.95, cf);
      col *= (0.86 + 0.26 * ph31(vec3(ci, ri, 9.0))) * mix(0.6, 1.0, mortar) * (0.94 + 0.12 * pn3(P * 8.0));
      gH = mortar * 0.7 + pn3(P * 11.0) * 0.25; gB = 0.05; gR = 0.05;
    } else if (id == 4) {
      float pl = (P.x + P.z) * 2.4; float pf = fract(pl); float seam = smoothstep(0.0, 0.05, pf) * smoothstep(1.0, 0.95, pf);
      float grain = pn3(vec3((P.x + P.z) * 46.0, P.y * 2.5, 0.0));
      col *= (0.84 + 0.3 * grain) * mix(0.72, 1.0, seam);
      gH = grain * 0.4 + seam * 0.4; gB = 0.025; gR = 0.05;
    } else if (id == 5) {
      float strata = sin(P.y * 3.1 + pf3(P * 0.35) * 6.0) * 0.5 + 0.5; float n = pf3(P * 1.3);
      col *= 0.78 + 0.22 * strata + 0.25 * (n - 0.5);
      float moss = smoothstep(0.55, 0.9, N.y) * smoothstep(0.35, 0.7, pf3(P * 0.8));
      col = mix(col, vec3(0.33, 0.46, 0.2), moss * 0.55);
      gH = n * 1.2 + strata * 0.5; gB = 0.09; gR = 0.0;
    } else if (id == 6) {
      float n = pn3(P * 3.5) * 0.5 + pn3(P * 9.0) * 0.5;
      col *= 0.78 + 0.4 * n; col += vec3(0.04, 0.05, 0.0) * smoothstep(0.3, 1.0, N.y);
      gH = n * 0.7; gB = 0.04; gR = 0.0;
    } else if (id == 7) {
      col = mix(col, vec3(0.05, 0.1, 0.17), 0.5); gR = -0.7; fade = 1.0;
    }
    diffuseColor.rgb = mix(base, col, fade);
    gH *= fade;
  }
}`;
const PATTERN_BUMP = `if (gB > 0.0) {
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(gH), dhy = dFdy(gH);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - gB * grad);
}`;
function patchPattern(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float mid; varying float vMid; varying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMid = mid; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PATTERN_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + PATTERN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + gR, 0.12, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + PATTERN_BUMP);
  };
  mat.customProgramCacheKey = () => 'pattern';
}
patchPattern(sceneryMat);
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const foamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
const shallowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: true });

/* ---------------------------------------------------------------- geometry builder (merged, vertex-coloured, material ids) */
const MID = { FLAT: 0, PLASTER: 1, ROOF: 2, STONE: 3, WOOD: 4, ROCK: 5, LEAF: 6, GLASS: 7 };
const G = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.07).toNonIndexed(),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed(),
  cone8: new THREE.ConeGeometry(1, 1, 8, 1).toNonIndexed(),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 9, 1).toNonIndexed(),
  sph: new THREE.IcosahedronGeometry(1, 1).toNonIndexed(),
  tri: (() => { const g = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, -1)])); return g.index ? g.toNonIndexed() : g; })(),
  sph0: new THREE.IcosahedronGeometry(1, 0).toNonIndexed(),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1).toNonIndexed(),
};
function makeRockGeo(seed, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const pos = g.attributes.position, r = mulberry32(seed), o = [r() * 10, r() * 10, r() * 10];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 0.5 * Math.sin(x * 2.3 + o[0]) * Math.cos(z * 2.1 + o[1]) + 0.35 * Math.sin(y * 3.1 + o[2] + x * 1.7) + 0.2 * Math.sin((x + y + z) * 5.0 + o[0]);
    const d = 1 + 0.17 * n; pos.setXYZ(i, x * d, y * d, z * d);
  }
  g.computeVertexNormals(); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g.toNonIndexed();
}
const ROCK_G = [0, 1, 2, 3].map((i) => makeRockGeo(100 + i * 17, 2)).concat([0, 1, 2, 3].map((i) => makeRockGeo(300 + i * 11, 1)));
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
class Builder {
  constructor(shade = true) { this.parts = []; this.shade = shade; this.cur = 0; this.ao = null; this.vgrad = null; }
  add(geo, color, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0, mul = 1) {
    const g = geo.clone();
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    _c.set(color);
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    let y0 = 0, hy = 1;
    if (this.vgrad !== null) { g.computeBoundingBox(); y0 = g.boundingBox.min.y; hy = Math.max(g.boundingBox.max.y - y0, 1e-3); }
    for (let i = 0; i < n; i++) {
      const vy = pos.getY(i);
      let f = (this.shade ? 0.6 + 0.4 * clamp((vy - SEA_Y) / 16, 0, 1) : 1) * mul;
      if (this.ao) f *= 1 - this.ao.k * Math.exp(-Math.max(vy - this.ao.y, 0) / this.ao.h);
      if (this.vgrad !== null) f *= lerp(this.vgrad, 1, (vy - y0) / hy);
      col[i * 3] = _c.r * f; col[i * 3 + 1] = _c.g * f; col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mid', new THREE.BufferAttribute(new Float32Array(n).fill(this.cur), 1));
    this.parts.push(g);
  }
  m(id) { this.cur = id; return this; }
  box(x, y0, z, w, h, d, color, ry = 0) { this.add(G.box, color, x, y0 + h / 2, z, w, h, d, ry); }
  cyl(x, y0, z, r, h, color, seg = G.cyl) { this.add(seg, color, x, y0 + h / 2, z, r, h, r); }
  roof(x, y0, z, w, d, h, color) { this.add(G.cone4, color, x, y0 + h / 2, z, w / 2 * Math.SQRT2, h, d / 2 * Math.SQRT2); }
  ball(x, y, z, r, color, sy = 1) { this.add(G.sph, color, x, y, z, r, r * sy, r); }
  bit(x, y, z, r, color) { this.add(G.sph0, color, x, y, z, r, r, r); }
  rock(i, x, y, z, sx, sy, sz, color, ry = 0) { this.add(ROCK_G[i % ROCK_G.length], color, x, y, z, sx, sy, sz, ry); }
  build(mat) {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    return new THREE.Mesh(merged, mat);
  }
}

/* ---------------------------------------------------------------- palette */
const WALLS = [0xf6e8cd, 0xf3d9ab, 0xf1cca6, 0xece0cf, 0xf8f1e3, 0xeac590, 0xe0cbae, 0xf4cbb2, 0xf0e3b8];
const ROOFS = [0xd9622c, 0xcb5628, 0xde7438, 0xc24f28];
const SHUT = [0x2f84a0, 0x3d9d86, 0x2a67a3, 0x8a4e34, 0x4aa07a, 0x9a3f3a];
const ROCKS = [0xd2ab86, 0xc29674, 0xdcbd99, 0xc9a07c, 0xb08c6c];
const GRASS = [0x6dad4c, 0x5f9d44, 0x7bb857];
const LEAF = [0x4f9a45, 0x62ac4a, 0x3f8a3e, 0x74b955, 0x5aa356];
const WOOD = 0xa56a38, WOOD_D = 0x7a4a27, STONE = 0xdccdae, STONE_D = 0xbfae8a;

/* ---------------------------------------------------------------- scenery pieces */
function tree(b, r, x, y0, z, s = 1) {
  const pc = b.cur, pv = b.vgrad;
  if (r() < 0.38) { // cypress
    const h = (4 + r() * 3.2) * s;
    b.m(MID.WOOD).cyl(x, y0, z, 0.12 * s, 0.7 * s, 0x6b4a2c);
    b.m(MID.LEAF); b.vgrad = 0.6;
    b.add(G.cone8, 0x2d6b3b, x, y0 + 0.5 * s + h / 2, z, 0.62 * s, h, 0.62 * s);
    b.add(G.cone8, 0x3b7d45, x - 0.05, y0 + 0.9 * s + h * 0.42, z, 0.5 * s, h * 0.7, 0.5 * s);
  } else {
    const h = (1.0 + r() * 0.8) * s;
    b.m(MID.WOOD).cyl(x, y0, z, 0.16 * s, h, 0x735030);
    b.m(MID.LEAF); b.vgrad = 0.55;
    const k = (1.3 + r() * 0.8) * s;
    b.ball(x, y0 + h + k * 0.55, z, k, pick(r, LEAF), 0.85);
    b.ball(x + k * 0.55, y0 + h + k * 0.25, z + k * 0.2, k * 0.7, pick(r, LEAF), 0.8);
    b.ball(x - k * 0.5, y0 + h + k * 0.3, z - k * 0.25, k * 0.65, pick(r, LEAF), 0.8);
    b.ball(x + k * 0.1, y0 + h + k * 1.05, z - k * 0.1, k * 0.55, pick(r, LEAF), 0.8);
  }
  b.cur = pc; b.vgrad = pv;
}
function bush(b, r, x, y0, z, s = 1, flowers = true) {
  const pc = b.cur, pv = b.vgrad; b.m(MID.LEAF); b.vgrad = 0.55;
  b.ball(x, y0 + 0.45 * s, z, 0.7 * s, pick(r, LEAF), 0.7);
  b.ball(x + 0.45 * s, y0 + 0.35 * s, z + 0.2 * s, 0.5 * s, pick(r, LEAF), 0.7);
  b.vgrad = null; b.m(MID.FLAT);
  if (flowers) {
    const fc = pick(r, [0xff5f9e, 0xffd23c, 0xffffff, 0xff8a3d, 0xe8407a]);
    for (let i = 0; i < 7; i++) b.bit(x + (r() - .5) * 1.1 * s, y0 + 0.55 * s + r() * 0.5 * s, z + (r() - .5) * 1.0 * s, 0.13 * s, fc);
  }
  b.cur = pc; b.vgrad = pv;
}
function planter(b, r, x, y0, z) {
  const pc = b.cur; b.m(MID.FLAT);
  b.cyl(x, y0, z, 0.32, 0.5, 0xc2642f); b.cyl(x, y0 + 0.5, z, 0.36, 0.1, 0xd0723a);
  b.m(MID.LEAF); b.ball(x, y0 + 0.85, z, 0.42, pick(r, LEAF), 0.8); b.m(MID.FLAT);
  const fc = pick(r, [0xff5f9e, 0xffd23c, 0xff4f5e, 0xffffff]);
  for (let i = 0; i < 5; i++) b.bit(x + (r() - .5) * 0.6, y0 + 0.9 + r() * 0.3, z + (r() - .5) * 0.6, 0.1, fc);
  b.cur = pc;
}
function windowAt(b, r, nx, x, y, z, ww, wh, shutterCol, lit, glow) {
  // nx: 0 = faces +x, 1 = faces +z
  const dk = lit ? 0xffd27a : 0x2a3a52, pc = b.cur;
  const flowers = r() < 0.4, fc = pick(r, [0xff5f9e, 0xffd23c, 0xff4f5e, 0xffffff, 0xff8a3d]);
  if (nx === 0) {
    b.m(MID.GLASS).box(x + 0.03, y, z, 0.1, wh, ww, dk);
    b.m(MID.PLASTER); b.box(x + 0.08, y - 0.12, z, 0.24, 0.13, ww + 0.36, 0xf3e9d3); b.box(x + 0.07, y + wh, z, 0.16, 0.12, ww + 0.3, 0xf3e9d3);
    b.m(MID.WOOD); b.box(x + 0.09, y, z - ww / 2 - 0.2, 0.08, wh, 0.38, shutterCol); b.box(x + 0.09, y, z + ww / 2 + 0.2, 0.08, wh, 0.38, shutterCol);
    if (lit && glow) glow.box(x + 0.1, y + 0.05, z, 0.02, wh - 0.2, ww - 0.2, 0xffc060);
    if (flowers) { b.m(MID.WOOD).box(x + 0.25, y - 0.38, z, 0.26, 0.24, ww + 0.1, 0x8a5430); b.m(MID.FLAT); for (let i = 0; i < 5; i++) b.bit(x + 0.26 + (r() - .5) * 0.1, y - 0.12 + r() * 0.1, z + (i - 2) * ww * 0.22, 0.1, i % 2 ? fc : 0x4f9a45); }
  } else {
    b.m(MID.GLASS).box(x, y, z + 0.03, ww, wh, 0.1, dk);
    b.m(MID.PLASTER); b.box(x, y - 0.12, z + 0.08, ww + 0.36, 0.13, 0.24, 0xf3e9d3); b.box(x, y + wh, z + 0.07, ww + 0.3, 0.12, 0.16, 0xf3e9d3);
    b.m(MID.WOOD); b.box(x - ww / 2 - 0.2, y, z + 0.09, 0.38, wh, 0.08, shutterCol); b.box(x + ww / 2 + 0.2, y, z + 0.09, 0.38, wh, 0.08, shutterCol);
    if (lit && glow) glow.box(x, y + 0.05, z + 0.1, ww - 0.2, wh - 0.2, 0.02, 0xffc060);
    if (flowers) { b.m(MID.WOOD).box(x, y - 0.38, z + 0.25, ww + 0.1, 0.24, 0.26, 0x8a5430); b.m(MID.FLAT); for (let i = 0; i < 5; i++) b.bit(x + (i - 2) * ww * 0.22, y - 0.12 + r() * 0.1, z + 0.26 + (r() - .5) * 0.1, 0.1, i % 2 ? fc : 0x4f9a45); }
  }
  b.cur = pc;
}
function ivy(b, r, x, y0, z, face, hgt) {         // face 0: wall faces +x, 1: faces +z
  const pc = b.cur, pv = b.vgrad; b.m(MID.LEAF); b.vgrad = 0.6;
  for (let i = 0, n = 5 + Math.floor(r() * 5); i < n; i++) {
    const t = r(), yy = y0 + hgt * (1 - t * t), o = (r() - .5) * 1.4, big = 0.35 + r() * 0.35;
    if (face === 0) b.add(G.sph, pick(r, LEAF), x + 0.05, yy, z + o, 0.14, big, big * 0.9); else b.add(G.sph, pick(r, LEAF), x + o, yy, z + 0.05, big * 0.9, big, 0.14);
  }
  b.cur = pc; b.vgrad = pv;
}
function house(b, r, cx, by, cz, w, d, h, detail, glow, lit) {
  const wall = pick(r, WALLS), roof = pick(r, ROOFS), pc = b.cur, pao = b.ao;
  b.ao = { y: by, k: 0.34, h: 1.1 };
  b.m(MID.PLASTER).box(cx, by - 0.5, cz, w, h + 0.5, d, wall);
  b.m(MID.STONE).box(cx, by - 0.5, cz, w + 0.14, 0.95, d + 0.14, 0xc9b995);                 // plinth
  b.m(MID.PLASTER).box(cx, by + h - 0.08, cz, w + 0.24, 0.24, d + 0.24, 0xf8eed9);          // cornice
  if (detail) { b.m(MID.PLASTER); b.box(cx, by + h * 0.5 + 0.3, cz, w + 0.1, 0.12, d + 0.1, 0xf3e7cf); }   // string course
  b.ao = pao;
  const rh = Math.min(w, d) * 0.3 + 0.5;
  b.m(MID.ROOF).roof(cx, by + h + 0.1, cz, w + 0.95, d + 0.95, rh, roof);
  b.m(MID.FLAT).box(cx, by + h + 0.05, cz, w + 0.95, 0.12, d + 0.95, 0xa8472a);
  if (r() < 0.55) { b.m(MID.STONE).box(cx + (r() - .5) * w * .4, by + h + 0.3, cz + (r() - .5) * d * .4, 0.55, rh + 0.6, 0.55, 0xa9715a); }
  if (!detail) { b.cur = pc; return; }
  // corner quoins on the +x/+z corner
  b.m(MID.STONE);
  for (let i = 0, n = Math.floor(h / 0.62); i < n; i++) { const q = i % 2 ? 0.5 : 0.7; b.box(cx + w / 2 - 0.02, by + 0.95 + i * 0.62, cz + d / 2 - q / 2 + 0.02, 0.14, 0.58, q, 0xe6d9bd); b.box(cx + w / 2 - q / 2 + 0.02, by + 0.95 + i * 0.62, cz + d / 2 - 0.02, q, 0.58, 0.14, 0xe6d9bd); }
  const floors = Math.max(1, Math.floor((h - 0.4) / 2.35));
  const colsZ = Math.max(1, Math.floor((d - 0.8) / 2.3)), colsX = Math.max(1, Math.floor((w - 0.8) / 2.3));
  const sh = pick(r, SHUT);
  for (let f = 0; f < floors; f++) {
    const wy = by + 0.7 + f * 2.35 + (f === 0 ? 0.35 : 0);
    for (let c = 0; c < colsZ; c++) {
      const wz = cz - d / 2 + (c + 0.5) * d / colsZ;
      if (f === 0 && c === 0 && r() < 0.65) {                      // arched door
        b.m(MID.WOOD).box(cx + w / 2 + 0.03, by, wz, 0.1, 1.85, 1.05, 0x6a4430); b.add(G.cyl12, 0x6a4430, cx + w / 2 + 0.03, by + 1.85, wz, 0.525, 0.1, 0.525, 0, 0, Math.PI / 2);
        b.m(MID.STONE).box(cx + w / 2 + 0.07, by, wz - 0.62, 0.16, 2.1, 0.2, 0xeadfc4); b.box(cx + w / 2 + 0.07, by, wz + 0.62, 0.16, 2.1, 0.2, 0xeadfc4); b.box(cx + w / 2 + 0.07, by + 2.1, wz, 0.18, 0.2, 1.5, 0xeadfc4);
        continue;
      }
      windowAt(b, r, 0, cx + w / 2, wy + 0.6, wz, 0.75, 1.15, sh, lit && r() < 0.7, glow);
    }
    for (let c = 0; c < colsX; c++) { const wx = cx - w / 2 + (c + 0.5) * w / colsX; windowAt(b, r, 1, wx, wy + 0.6, cz + d / 2, 0.75, 1.15, sh, lit && r() < 0.7, glow); }
  }
  if (r() < 0.45 && floors > 1) {                                  // balcony
    const bz = cz + (r() - .5) * d * 0.4, by2 = by + 2.55;
    b.m(MID.STONE).box(cx + w / 2 + 0.4, by2, bz, 0.9, 0.16, 1.9, 0xe9dcc3);
    b.m(MID.FLAT).box(cx + w / 2 + 0.82, by2 + 0.16, bz, 0.06, 0.62, 1.9, 0x2c3a4c); b.box(cx + w / 2 + 0.5, by2 + 0.16 + 0.6, bz, 0.7, 0.05, 0.06, 0x2c3a4c);
    for (let i = 0; i < 6; i++) b.box(cx + w / 2 + 0.82, by2 + 0.16, bz - 0.85 + i * 0.34, 0.04, 0.6, 0.04, 0x2c3a4c);
  }
  if (r() < 0.35) {                                                // striped awning
    const az = cz + (r() - .5) * d * 0.3; b.m(MID.FLAT);
    for (let i = 0; i < 4; i++) b.add(G.box, i % 2 ? 0xffffff : 0xd9302f, cx + w / 2 + 0.55, by + 2.45, az - 1.0 + i * 0.55, 1.3, 0.1, 0.55, 0, 0, -0.35);
  }
  if (r() < 0.55) ivy(b, r, cx + w / 2, by + 0.6, cz - d / 2 + 0.6 + r() * 1.2, 0, h * 0.8);
  if (r() < 0.4) ivy(b, r, cx - w / 2 + 0.8 + r() * 1.2, by + 0.6, cz + d / 2, 1, h * 0.7);
  b.cur = pc;
}
function tower(b, r, cx, by, cz, w, h) {
  const pc = b.cur; b.m(MID.PLASTER);
  b.box(cx, by - 0.5, cz, w, h + 0.5, w, 0xe9d9bb);
  b.m(MID.STONE).box(cx, by - 0.5, cz, w + 0.2, 0.9, w + 0.2, 0xc9b995);
  b.m(MID.PLASTER).box(cx, by + h * 0.6, cz, w + 0.18, 0.2, w + 0.18, 0xd0bc96); b.box(cx, by + h, cz, w + 0.5, 0.35, w + 0.5, 0xd0bc96);
  b.box(cx, by + h + 0.35, cz, w - 0.2, 1.8, w - 0.2, 0xe0cdaa);
  b.m(MID.GLASS);
  for (const s of [-1, 1]) { b.box(cx + s * (w / 2 - 0.1), by + h + 0.8, cz, 0.35, 1.1, 0.8, 0x2a2018); b.box(cx, by + h + 0.8, cz + s * (w / 2 - 0.1), 0.8, 1.1, 0.35, 0x2a2018); }
  b.m(MID.ROOF).roof(cx, by + h + 2.1, cz, w + 0.8, w + 0.8, w * 0.9, 0xc9552a);
  b.m(MID.FLAT).box(cx, by + h + 2.1 + w * 0.9, cz, 0.08, 1.4, 0.08, 0x3a3a3a); b.box(cx + 0.45, by + h + 2.1 + w * 0.9 + 0.9, cz, 0.8, 0.5, 0.04, 0xd8332c);
  b.cur = pc;
}
function gate(b, glow, zc) {
  const R = 3.9, CY = 3.0, depth = 3.2, pc = b.cur; b.m(MID.STONE);
  for (const sgn of [-1, 1]) b.box(sgn * (R + 2.4), -1.0, zc, 4.8, CY + 1.0, depth, STONE);
  for (let i = 0; i <= 9; i++) { const a = i / 9 * Math.PI, x = Math.cos(a) * (R + 0.45), y = CY + Math.sin(a) * (R + 0.45); b.add(G.rbox, i % 2 ? 0xe9dcc0 : STONE, x, y, zc, 1.0, 0.95, depth + 0.3, 0, 0, a + Math.PI / 2); }
  const RO = R + 0.9;
  for (let i = 0; i < 18; i++) { const x = -RO + (i + 0.5) * (2 * RO / 18); const yA = CY + Math.sqrt(Math.max(0, RO * RO - x * x)); b.box(x, yA - 0.05, zc, 2 * RO / 18 + 0.02, 10.4 - yA, depth, STONE); }
  for (const sgn of [-1, 1]) b.box(sgn * (RO + 1.7), CY, zc, 3.4, 7.4, depth, STONE);
  b.box(0, 10.3, zc, 2 * RO + 6.8, 0.5, depth + 0.5, 0xcdb994);
  for (let i = -6; i <= 6; i++) b.add(G.rbox, 0xdccaa6, i * 1.38, 11.25, zc, 0.8, 0.9, depth + 0.5);
  b.m(MID.WOOD).box(0, 10.5, zc + depth / 2 + 0.01, 3.2, 1.8, 0.12, 0x8a6d48);
  b.m(MID.FLAT);
  for (const sgn of [-1, 1]) { b.box(sgn * 5.2, 11.7, zc, 0.12, 3.4, 0.12, 0x3a3a3a); b.box(sgn * 5.2 + 0.7, 14.2, zc, 1.3, 0.8, 0.05, 0xd8332c); }
  for (const sgn of [-1, 1]) { glow.box(sgn * (R - 0.15), 3.6, zc + depth / 2 + 0.12, 0.28, 0.45, 0.28, 0xffd88a); b.box(sgn * (R - 0.15), 3.9, zc + depth / 2 + 0.12, 0.06, 1.4, 0.06, 0x2a2e38); }
  b.cur = pc;
}
function bunting(b, z, y0 = 6.1) {
  const cols = [0xff5a5f, 0xffd23c, 0x2fb7ff, 0xffffff, 0x2fd07a, 0xff8a3d], N = 16, x0 = -4.1, x1 = 4.3, pc = b.cur; b.m(MID.FLAT);
  let px = x0, py = y0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = lerp(x0, x1, t), y = y0 - 0.85 * Math.sin(Math.PI * t) + (t - 0.5) * 0.15;
    const dx = x - px, dy = y - py, len = Math.hypot(dx, dy);
    b.add(G.box, 0x3a2f28, (x + px) / 2, (y + py) / 2, z, len, 0.035, 0.035, 0, 0, Math.atan2(dy, dx));
    if (i < N) b.add(G.tri, cols[i % cols.length], x, y - 0.03, z, 0.34, 0.46, 1, 0, 0, Math.atan2(dy, dx) * 0.6);
    px = x; py = y;
  }
  b.m(MID.WOOD).box(-4.1, 0, z, 0.14, y0 + 0.1, 0.14, WOOD_D); b.box(4.3, 0, z, 0.14, y0 + 0.1, 0.14, WOOD_D);
  b.cur = pc;
}
function boat(b, x, z, s = 1.6, rot = 0) {
  const y = SEA_Y + 0.1, pc = b.cur; b.m(MID.WOOD);
  b.add(G.box, 0x8a4f2a, x, y + 0.3 * s, z, 0.9 * s, 0.5 * s, 3 * s, rot);
  b.add(G.box, 0x5e3a20, x, y + 0.62 * s, z, 0.95 * s, 0.1 * s, 3.05 * s, rot);
  const ox = Math.sin(rot), oz = Math.cos(rot);
  b.add(G.box, 0xe8e0cc, x, y + 0.45 * s, z, 0.92 * s, 0.1 * s, 3.02 * s, rot);
  b.m(MID.FLAT).add(G.cyl, 0x5e3a20, x, y + 2.2 * s, z, 0.05 * s, 3.4 * s, 0.05 * s);
  b.add(G.box, 0xf6efdc, x + ox * 0.25 * s, y + 2.3 * s, z + oz * 0.2 * s, 0.05 * s, 2.4 * s, 1.5 * s, rot);
  b.add(G.box, 0xefe3c4, x - ox * 0.15 * s, y + 1.7 * s, z - oz * 0.95 * s, 0.05 * s, 1.5 * s, 0.9 * s, rot);
  b.cur = pc;
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
  obs: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.9 }),
  magRed: new THREE.MeshStandardMaterial({ color: 0xe0272e, roughness: 0.35, metalness: 0.2, emissive: 0x7a0a10, emissiveIntensity: 0.6 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.25, metalness: 0.8 }),
  shield: new THREE.MeshStandardMaterial({ color: 0x3d95f5, roughness: 0.3, metalness: 0.25, emissive: 0x0f3d9a, emissiveIntensity: 0.7 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc82a, roughness: 0.3, metalness: 0.6, emissive: 0x8a5200, emissiveIntensity: 0.6 }),
};
const BX = new THREE.BoxGeometry(1, 1, 1), CY = new THREE.CylinderGeometry(1, 1, 1, 14);
const WOODL = 0xd9a05a, WOODM = 0x9a5d2c;
patchPattern(M.obs);
function obstacleMesh(type) {
  const o = new Builder(false); o.m(MID.WOOD);
  if (type === 'crate' || type === 'stack') {
    for (let i = 0, n = type === 'stack' ? 2 : 1; i < n; i++) {
      const y = i * 1.7, h = 0.85;
      o.add(G.rbox, WOODL, 0, y + h, 0, 1.7, 1.7, 1.7);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.add(G.rbox, WOODM, sx * (h - 0.07), y + h, sz * (h - 0.07), 0.17, 1.74, 0.17);
      for (const yy of [0.08, 1.62]) o.add(G.rbox, WOODM, 0, y + yy, 0, 1.74, 0.17, 1.74);
      for (const a of [Math.PI / 4, -Math.PI / 4]) o.add(G.box, WOODM, 0, y + h, h + 0.03, 0.14, 2.0, 0.05, 0, 0, a);
    }
  } else if (type === 'hurdle') {
    for (const sx of [-1, 1]) o.add(G.rbox, WOODM, sx * 1.55, 0.55, 0, 0.2, 1.1, 0.2);
    o.m(MID.FLAT); for (let i = 0; i < 6; i++) o.box(-1.25 + i * 0.5, 0.65, 0, 0.5, 0.34, 0.14, i % 2 ? 0xf6f1e6 : 0xd9302f);
    o.m(MID.WOOD).box(0, 0.5, 0, 3.2, 0.1, 0.1, WOODM);
  } else if (type === 'beam') {
    for (const sx of [-1, 1]) o.add(G.rbox, WOODM, sx * 1.6, 1.4, 0, 0.24, 2.8, 0.24);
    o.m(MID.FLAT); for (let i = 0; i < 6; i++) o.box(-1.25 + i * 0.5, 1.5, 0, 0.5, 0.42, 0.3, i % 2 ? 0xf6f1e6 : 0xd9302f);
    o.m(MID.WOOD).box(0, 1.94, 0, 3.5, 0.12, 0.2, WOODM);
  } else {   // barrel
    o.add(G.cyl12, WOODL, 0, 0.65, 0, 0.62, 1.3, 0.62); o.add(G.cyl12, 0xe0a763, 0, 0.65, 0, 0.7, 0.7, 0.7);
    o.m(MID.FLAT); for (const y of [0.2, 0.65, 1.1]) o.add(G.cyl12, 0x3a3f4a, 0, y, 0, y === 0.65 ? 0.72 : 0.66, 0.07, y === 0.65 ? 0.72 : 0.66);
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
  b.m(MID.STONE);
  b.box(-3.55, 0, zc, 0.34, 0.03, CHUNK, 0xc4a77a); b.box(3.55, 0, zc, 0.34, 0.03, CHUNK, 0xc4a77a);
  for (let z = z0 - 10; z > z1; z -= 24) bunting(b, z);
  b.m(MID.STONE);
  b.box(-4.0, -1.0, zc, 0.7, 2.1, CHUNK, STONE);                  // left wall
  b.box(-4.0, 1.1, zc, 0.95, 0.2, CHUNK, 0xeadfc6);               // coping
  b.box(4.2, -1.0, zc, 0.7, 1.0, CHUNK, STONE);                   // right kerb
  b.m(MID.LEAF).box(5.2, -1.2, zc, 1.6, 0.9, CHUNK, pick(r, GRASS));
  b.m(MID.WOOD);
  for (let z = z0 - 1.5; z > z1; z -= 3) { b.box(4.2, 0, z, 0.2, 1.25, 0.2, WOOD); b.box(4.2, 1.25, z, 0.28, 0.1, 0.28, WOOD_D); }
  b.box(4.2, 0.9, zc, 0.12, 0.16, CHUNK, WOOD); b.box(4.2, 0.45, zc, 0.12, 0.12, CHUNK, WOOD);

  // --- right: organic cliff face, rocks at the foot, sea stacks, boats
  for (let zs = z0; zs > z1; zs -= 6.7) {
    const len = 6.9, d = r() * 1.2, zz = zs - 3.3;
    f.m(MID.ROCK);
    for (let j = 0; j < 4; j++) f.rock(j + (r() * 4 | 0), 5.9 + r() * 0.6 + (j > 1 ? 0.8 * (j - 1) : 0), -5.6 - j * 4.4, zz + (r() - .5) * 1.5, 2.4 + r() * 0.8, 3.3 + r() * 0.6, 3.9 + r() * 1.0, pick(r, ROCKS), r() * 6);
    f.rock(4 + (r() * 4 | 0), 8.2 + d + r(), SEA_Y + 1.2, zz, 2.4 + r() * 1.2, 2.2 + r() * 1.6, 3.0 + r() * 1.5, pick(r, ROCKS), r() * 6);
    for (let i = 0; i < 2; i++) f.rock(4 + (r() * 4 | 0), 9.5 + d + r() * 3.5, SEA_Y + 0.5, zz + (r() - .5) * 5, 1.0 + r() * 1.1, 0.8 + r() * 0.8, 1.0 + r() * 1.1, pick(r, ROCKS), r() * 6);
    foam.box(8.8 + d, SEA_Y + 0.12, zz, 3.6, 0.04, len + 0.8, 0xffffff);
    shallow.box(12 + d, SEA_Y + 0.08, zz, 12, 0.04, len + 1, 0x58ecd4);
    if (r() < 0.6) bush(b, r, 5.0 + r() * 1.0, -0.3, zz + (r() - .5) * 4, 0.7 + r() * 0.4);
    if (r() < 0.14) tree(b, r, 5.2 + r() * 0.6, -0.3, zz, 0.8);
  }
  for (let z = z0 - 5; z > z1; z -= 10) {                          // lamp posts
    b.m(MID.FLAT).cyl(4.2, 0, z, 0.08, 3.3, 0x2a2e38); b.box(4.2, 3.25, z, 0.5, 0.12, 0.5, 0x2a2e38); b.box(4.2, 2.65, z, 0.12, 0.7, 0.12, 0x2a2e38);
    glow.box(4.2, 2.95, z, 0.34, 0.5, 0.34, lit ? 0xffd98a : 0xe8d9ae);
  }
  for (let i = 0, nStack = r() < 0.7 ? 1 : 0; i < nStack; i++) {
    const sx = 26 + r() * 30, sz = z1 + r() * CHUNK, rad = 2.6 + r() * 2.8, hh = 8 + r() * 14;
    f.m(MID.ROCK);
    f.rock(r() * 4 | 0, sx, SEA_Y + hh / 2 - 1, sz, rad, hh / 2 + 1.5, rad * (0.8 + r() * 0.4), pick(r, ROCKS), r() * 6);
    f.rock(r() * 4 | 0, sx + 1.2, SEA_Y + hh * 0.3, sz + 1.0, rad * 1.35, hh * 0.35, rad * 1.15, pick(r, ROCKS), r() * 6);
    f.m(MID.LEAF).ball(sx, SEA_Y + hh - 0.3, sz, rad * 0.92, pick(r, GRASS), 0.18);
    for (let t = 0; t < 2; t++) tree(f, r, sx + (r() - .5) * rad, SEA_Y + hh + 0.1, sz + (r() - .5) * rad, 1.1);
    foam.add(G.cyl, 0xffffff, sx, SEA_Y + 0.1, sz, rad * 1.7, 0.04, rad * 1.7);
    shallow.add(G.cyl, 0x58ecd4, sx, SEA_Y + 0.07, sz, rad * 2.9, 0.04, rad * 2.9);
  }
  for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) {     // low islets
    const sx = 14 + r() * 26, sz = z1 + r() * CHUNK, rad = 2 + r() * 2.2, hh = 2.5 + r() * 3;
    f.m(MID.ROCK).rock(4 + (r() * 4 | 0), sx, SEA_Y + hh * 0.4, sz, rad, hh, rad * 0.9, pick(r, ROCKS), r() * 6);
    f.m(MID.LEAF).ball(sx, SEA_Y + hh * 1.25, sz, rad * 0.8, pick(r, GRASS), 0.25);
    if (r() < 0.6) tree(f, r, sx + (r() - .5) * rad * 0.5, SEA_Y + hh * 1.3, sz + (r() - .5) * rad * 0.5, 0.9);
    foam.add(G.cyl, 0xffffff, sx, SEA_Y + 0.1, sz, rad * 1.6, 0.04, rad * 1.6); shallow.add(G.cyl, 0x58ecd4, sx, SEA_Y + 0.07, sz, rad * 2.7, 0.04, rad * 2.7);
  }
  for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) boat(f, 11 + r() * 38, z1 + r() * CHUNK, 1.5 + r() * 0.6, r() * 3.1);

  // far headland village on the opposite shore
  for (let q = 0; q < 5; q++) {
    const hx = 64 + q * 17, top = SEA_Y + 9 + q * 8.5;
    f.m(MID.ROCK).box(hx, SEA_Y - 0.5, zc, 17, top - SEA_Y + 0.5, CHUNK, pick(r, ROCKS));
    f.m(MID.LEAF).box(hx, top - 0.4, zc, 17, 0.5, CHUNK, pick(r, GRASS));
    shallow.box(hx - 12, SEA_Y + 0.08, zc, 12, 0.04, CHUNK + 1, 0x58ecd4);
    for (let zs = z0; zs > z1; zs -= SEG) {
      if (r() < 0.78) house(f, r, hx + (r() - .5) * 5, top, zs - SEG / 2 + (r() - .5) * 1.5, 5 + r() * 3, 5 + r() * 3.5, 3 + r() * 2.5, false);
      else tree(f, r, hx + (r() - .5) * 6, top, zs - SEG / 2, 1.3);
    }
  }
  for (let i = 0; i < 2; i++) { const mx = 120 + r() * 140, mh = 40 + r() * 60, mr = 26 + r() * 26; f.m(MID.ROCK).add(G.cone8, 0x7aa38e, mx, SEA_Y + mh / 2 - 1, z1 + r() * CHUNK, mr, mh, mr * 0.9); }

  // --- left: village terraces climbing the hillside
  const hgt = (row, z) => row * 3.4 + 1.3 * Math.sin(z * 0.045 + row * 1.7) + 0.7 * Math.sin(z * 0.11 + row);
  for (let row = 0; row < 6; row++) {
    const xr0 = 5.0 + row * 8.2, xcR = -(xr0 + 4.1), T = row < 2 ? b : f;
    for (let zs = z0; zs > z1; zs -= SEG) {
      const zm = zs - SEG / 2, by = row === 0 ? 0 : hgt(row, zm);
      if (row > 0) {
        T.m(MID.ROCK).box(xcR, SEA_Y - 0.5, zm, 8.6, by - SEA_Y - 0.1, SEG + 0.02, pick(r, ROCKS));
        T.m(MID.LEAF).box(xcR, by - 0.5, zm, 8.6, 0.55, SEG + 0.02, pick(r, GRASS));
      } else {
        T.m(MID.STONE).box(xcR, -1.5, zm, 8.6, 1.4, SEG + 0.02, 0xc7b794);
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
      if (row === 0 && r() < 0.8) bush(T, r, -5.0, 0, zm + (r() - .5) * 8, 1.0);
    }
  }
  f.m(MID.LEAF).box(-66, SEA_Y - 0.5, zc, 36, 70, CHUNK, 0x7fa56c);       // ridge behind the village
  for (let z = z0 - 3; z > z1; z -= 8 + r() * 4) planter(b, r, -3.55, 1.3, z);
  b.m(MID.STONE); for (let z = z0 - 2; z > z1; z -= 5) b.box(-3.9, 1.3, z, 0.34, 0.9, 0.34, 0xeadfc6);

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

/* ---------------------------------------------------------------- characters (rigged glTF models + animation mixer) */
const CHARACTERS = [
  { id: 'rusty', name: 'Rusty', tag: 'Quick paws. Sharp nose.', url: 'assets/models/Fox.glb', height: 1.5, flip: 0,
    clips: { run: 'Run', idle: 'Survey', jump: 'Run', die: 'Survey', zip: 'Run', slide: 'Run' }, zipH: 1.75, runRate: 1.0, stats: [['Speed', 5], ['Jump', 3], ['Stamina', 2]] },
  { id: 'bolt', name: 'Bolt', tag: 'Built to run. Never tired.', url: 'assets/models/RobotExpressive.glb', height: 1.8, flip: 0,
    clips: { run: 'Running', idle: 'Idle', jump: 'Jump', die: 'Death', zip: 'WalkJump', slide: 'Sitting' }, zipH: 2.45, runRate: 1.35, stats: [['Speed', 4], ['Jump', 4], ['Stamina', 3]] },
];
const runner = new THREE.Group();                     // feet position, faces -Z
scene.add(runner);
const models = [];
let charIdx = 0;
async function loadCharacters() {
  const loader = new GLTFLoader();
  for (const def of CHARACTERS) {
    const gltf = await loader.loadAsync(def.url);
    const model = gltf.scene;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.envMapIntensity = 1.0; }); } });
    const mixer = new THREE.AnimationMixer(model);
    const actions = {}; for (const c of gltf.animations) actions[c.name] = mixer.clipAction(c);
    const idle = actions[def.clips.idle]; if (idle) { idle.play(); mixer.update(0); }
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true); const size = box.getSize(new THREE.Vector3());   // precise: measures the skinned pose
    const k = def.height / size.y; model.scale.multiplyScalar(k); model.updateMatrixWorld(true);
    box.setFromObject(model, true); const ctr = box.getCenter(new THREE.Vector3());
    model.position.set(-ctr.x, -box.min.y, -ctr.z);
    const holder = new THREE.Group(); holder.add(model);
    const pivot = new THREE.Group(); pivot.rotation.y = Math.PI + def.flip; pivot.add(holder);   // glTF models face +Z; the game runs toward -Z
    pivot.visible = false; runner.add(pivot);
    if (idle) idle.stop();
    models.push({ def, pivot, holder, model, mixer, actions, cur: null, curName: '', h: def.height });
  }
  selectCharacter(0);
}
function selectCharacter(i) {
  charIdx = i; if (typeof setZipHeight === 'function') setZipHeight(CHARACTERS[i].zipH); models.forEach((m, j) => { m.pivot.visible = j === i; }); const m = models[i]; if (m) m.curName = '';
}
function playClip(m, key, { once = false, rate = 1, fade = 0.18, hold = false } = {}) {
  const name = m.def.clips[key], a = m.actions[name]; if (!a) return;
  const id = key + name; if (m.curName === id && !once) { a.timeScale = rate; return; }
  if (m.cur && m.cur !== a) m.cur.fadeOut(fade);
  a.reset().setEffectiveTimeScale(rate).setEffectiveWeight(1).fadeIn(fade);
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once || hold; a.play();
  m.cur = a; m.curName = id;
}
let lastMode = '';
function animateRunner(dt, mode, jumpPhase) {
  const m = models[charIdx]; if (!m) return;
  const rate = m.def.runRate * (0.85 + state.speed / 34 * 0.5);
  const h = m.holder; h.rotation.set(0, 0, 0); h.position.set(0, 0, 0); h.scale.set(1, 1, 1);
  if (mode !== lastMode) {
    if (mode === 'jump') { if (m.def.id === 'bolt') playClip(m, 'jump', { once: true, rate: 1.15 }); else playClip(m, 'jump', { rate: 0.25 }); }
    lastMode = mode; m.curName = mode === 'jump' ? m.curName : '';
  }
  if (mode === 'run') playClip(m, 'run', { rate });
  else if (mode === 'idle') playClip(m, 'idle', { rate: 1 });
  else if (mode === 'slide') { playClip(m, 'slide', { rate: 0.8, hold: true }); h.rotation.x = 0.0; h.position.y = 0.0; h.scale.y = 0.82; }
  else if (mode === 'zip') { playClip(m, 'zip', { rate: m.def.id === 'bolt' ? 0.5 : 0.3 }); }
  else if (mode === 'crash') playClip(m, 'die', { once: true, rate: 1.4 });
  if (mode === 'jump') { h.rotation.x = m.def.id === 'bolt' ? 0 : -0.35 + jumpPhase * 0.7; }
  if (mode === 'zip') { h.rotation.x = m.def.id === 'bolt' ? 0.05 : 1.1; }
  m.mixer.update(dt);
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
function setZipHeight(h) { zip.children[0].position.y = h + 0.12; zip.children[1].position.y = h; zip.children[2].position.y = h + 0.12; }
setZipHeight(CHARACTERS[0].zipH);

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

let envFor = null;
function applyLook() {
  skyU.top.value.set(region.sky[0]); skyU.mid.value.set(region.sky[1]); skyU.hor.value.set(region.sky[2]);
  skyU.sunCol.value.set(region.glow); skyU.sunDir.value.set(...region.sun[2]).normalize();
  scene.fog.color.set(region.fog); scene.fog.near = region.fogNear; scene.fog.far = region.fogFar;
  hemi.color.set(region.hemi[0]); hemi.groundColor.set(region.hemi[1]); hemi.intensity = region.hemi[2];
  sun.color.set(region.sun[0]); sun.intensity = region.sun[1];
  skyU.cloud.value = 1;
  skyU.cloudCol.value.set(region.id === 'sunset' ? 0xffc9a0 : 0xffffff); skyU.shade.value.set(region.id === 'sunset' ? 0x8a5a78 : 0x9bb4d6);
  seaU.sunDir.value.copy(skyU.sunDir.value); seaU.sunCol.value.set(region.glow); seaU.skyTop.value.set(region.sky[1]); seaU.skyHor.value.set(region.sky[2]);
  seaU.cShallow.value.set(region.id === 'sunset' ? 0x7fe0c8 : 0x6af2d6); seaU.cMid.value.set(region.id === 'sunset' ? 0x1f9bb4 : 0x12bfcf); seaU.cDeep.value.set(region.id === 'sunset' ? 0x15508f : 0x0a69b0);
  bloom.strength = region.id === 'sunset' ? 0.42 : 0.3;
  if (envFor !== region.id) { bakeEnv(); envFor = region.id; }
}
function menuLook() {            // pale, hazy backdrop so a menu character stays vivid in the foreground
  skyU.top.value.set(0xcfe4f7); skyU.mid.value.set(0xdcecf9); skyU.hor.value.set(0xe8f3fc);
  scene.fog.color.set(0xdcecf9); scene.fog.near = 4.5; scene.fog.far = 19; skyU.cloud.value = 0;
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
  

  // character pose + placement
  let mode = 'idle';
  if (running) mode = state.dead ? 'crash' : state.zip ? 'zip' : !state.grounded ? 'jump' : state.slide > 0 ? 'slide' : 'run';
  if (state.mode === 'chars') mode = 'idle';
  const jp = state.grounded ? 0 : clamp(jumpT / 0.75, 0, 1);
  animateRunner(dt, mode, jp);
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
  seaU.time.value = state.t; skyU.time.value = state.t; gradePass.uniforms.time.value = state.t % 10;

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
    camTargetLook.set(px * 0.3 + 2.7, -1.4 + py * 0.3 - lift * 3.2, pz - 12);
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
function avatarSVG({ kind = 'robot', bg = '#cfe3f7', letter = '?', color = '#3d8bf0' }) {
  const head = {
    robot: `<rect x="31" y="6" width="2.4" height="9" fill="#9aa7bb"/><circle cx="32.2" cy="6" r="3.2" fill="#ffc928"/>
      <rect x="11" y="28" width="5" height="12" rx="2.5" fill="#ffc928"/><rect x="48" y="28" width="5" height="12" rx="2.5" fill="#ffc928"/>
      <rect x="15" y="14" width="34" height="30" rx="12" fill="#f4f7fb" stroke="#b9c6da" stroke-width="1.5"/>
      <rect x="19" y="21" width="26" height="16" rx="8" fill="#26334d"/><circle cx="26.500" cy="29" r="3.600" fill="#5ee6ff"/><circle cx="37.500" cy="29" r="3.600" fill="#5ee6ff"/>
      <circle cx="27.500" cy="28" r="1.100" fill="#fff"/><circle cx="38.500" cy="28" r="1.100" fill="#fff"/><path d="M27 41h10" stroke="#9aa7bb" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 64c1-9 9-12 22-12s21 3 22 12z" fill="#e9eef6"/>`,
    fox: `<path d="M12 8l12 12-14 8z" fill="#e8742a"/><path d="M52 8L40 20l14 8z" fill="#e8742a"/><path d="M15 12l7 8-8 4z" fill="#2a2018"/><path d="M49 12l-7 8 8 4z" fill="#2a2018"/>
      <path d="M8 30c0-12 10-17 24-17s24 5 24 17c0 12-10 24-24 24S8 42 8 30z" fill="#ee8434"/>
      <path d="M32 54c-9 0-18-8-21-17 8 3 14 1 21-7 7 8 13 10 21 7-3 9-12 17-21 17z" fill="#fff5e6"/>
      <ellipse cx="22.500" cy="28" rx="2.600" ry="3.200" fill="#26180f"/><ellipse cx="41.500" cy="28" rx="2.600" ry="3.200" fill="#26180f"/><circle cx="23.300" cy="27" r="1" fill="#fff"/><circle cx="42.300" cy="27" r="1" fill="#fff"/>
      <ellipse cx="32" cy="40" rx="4" ry="3" fill="#2a1a12"/><path d="M32 43v3M28 47q4 3 8 0" stroke="#2a1a12" stroke-width="1.600" fill="none" stroke-linecap="round"/>`,
    locked: `<circle cx="32" cy="26" r="11" fill="#9db3cf"/><path d="M12 64c1-14 9-19 20-19s19 5 20 19z" fill="#9db3cf"/><rect x="22" y="30" width="20" height="16" rx="4" fill="#e9f1fb" stroke="#6f87a8" stroke-width="2"/><path d="M26 30v-5a6 6 0 0 1 12 0v5" fill="none" stroke="#6f87a8" stroke-width="3"/><circle cx="32" cy="38" r="2.200" fill="#6f87a8"/>`,
    initial: `<circle cx="32" cy="32" r="22" fill="${color}"/><text x="32" y="41" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="26" fill="#fff">${letter}</text>`,
  }[kind];
  return `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${head}</svg>`;
}
const CHARS = [
  { n: 'Rusty', t: 'Quick paws. Sharp nose.', stats: [['Speed', 5], ['Jump', 3], ['Stamina', 2]], a: { kind: 'fox' }, model: 0 },
  { n: 'Bolt', t: 'Built to run. Never tired.', stats: [['Speed', 4], ['Jump', 4], ['Stamina', 3]], a: { kind: 'robot' }, model: 1 },
  { n: 'Luna', t: 'Unlocks in a later update.', stats: [['Speed', 4], ['Jump', 3], ['Stamina', 4]], a: { kind: 'locked' }, locked: true },
  { n: 'Marco', t: 'Unlocks in a later update.', stats: [['Speed', 3], ['Jump', 4], ['Stamina', 3]], a: { kind: 'locked' }, locked: true },
  { n: 'Zoe', t: 'Unlocks in a later update.', stats: [['Speed', 4], ['Jump', 2], ['Stamina', 5]], a: { kind: 'locked' }, locked: true },
];
let viewIdx = 0;                       // character highlighted in the picker
function renderChars() {
  const c = CHARS[viewIdx];
  $('#charName').textContent = c.n; $('#charTag').textContent = c.t;
  $('#charStats').innerHTML = c.stats.map(([k, v]) => `<div class="stat"><span>${k}</span><div class="meter"><i style="width:${v * 20}%"></i></div></div>`).join('');
  $('#avatars').innerHTML = CHARS.map((ch, i) => `<button class="av ${i === viewIdx ? 'on' : ''}" data-i="${i}">${avatarSVG(ch.a)}</button>`).join('');
  $('#avatars').querySelectorAll('.av').forEach((b) => b.addEventListener('click', () => { viewIdx = +b.dataset.i; const ch = CHARS[viewIdx]; if (!ch.locked) selectCharacter(ch.model); renderChars(); }));
  $('#btnSelect').textContent = c.locked ? 'Locked' : (c.model === charIdx ? 'Selected' : 'Select');
  $('#btnSelect').classList.toggle('dim', !!c.locked);
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
const BOARD = [['Alex', 268742, '#e8742a'], ['Emma', 243561, '#a259e6'], ['Daniel', 219830, '#2fae6b'], ['Sofia', 198412, '#e8559a'], ['Lucas', 176205, '#3d8bf0']];
function openOver(score, newBest, you = 'You') {
  $('#overScore').textContent = score.toLocaleString('en-US');
  $('#overSub').textContent = newBest ? 'New personal best!' : 'Best: ' + state.best.toLocaleString('en-US');
  const rows = BOARD.map(([n, s, color]) => ({ n, s, a: { kind: 'initial', letter: n[0], color }, me: false })); rows.push({ n: you, s: score, a: CHARS.find((c) => c.model === charIdx).a, me: true });
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
$('#btnSelect').addEventListener('click', () => { const c = CHARS[viewIdx]; if (c.locked) { toast('Coming soon'); return; } selectCharacter(c.model); try { localStorage.setItem('coastline.char', String(c.model)); } catch (e) { /* ignore */ } toast(c.n + ' selected'); renderChars(); });
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const g = b.dataset.go; if (g === 'chars' || g === 'missions' || g === 'title') showScreen(g); }));

/* sizing */
function resize() {
  const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
  renderer.setSize(w, h, false); composer.setSize(w, h); gradePass.uniforms.res.value.set(w * pr, h * pr); composer.setPixelRatio(pr); bloom.setSize(w * pr, h * pr);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------------------------------------------------------------- boot */
function render() { composer.render(); }
const regionId = Q.get('region') || 'village';
applyRegion(regionId);
renderMissions();
resize();
state.camMode = 'title';
showScreen(Q.get('screen') === 'none' ? null : 'title');
ensureChunks();

let quality = 1;
function setQuality(l) {                 // 0 = low (no MSAA / bloom, smaller shadow map), 1 = full
  quality = l; bloom.enabled = l > 0;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = l > 0 ? 4 : 0; rt.dispose(); }
  const sz = l > 0 ? 2048 : 1024; sun.shadow.mapSize.set(sz, sz); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
if (Q.get('q') === 'low') setQuality(0);
let last = performance.now(), avg = 1 / 60, ratio = renderer.getPixelRatio(), calm = 0, slow = 0;
function adapt(dtRaw) {                 // dynamic resolution: trade sharpness for a steady frame rate
  avg = lerp(avg, dtRaw, 0.05);
  if (state.mode !== 'run') return;
  if (avg > 1 / 32 && ratio <= 1 && quality > 0) { if (++slow > 90) { setQuality(0); slow = 0; } } else slow = 0;
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

const ready = loadCharacters().then(() => { try { const sv = parseInt(localStorage.getItem('coastline.char') || '0', 10); if (models[sv]) selectCharacter(sv); } catch (e) { /* ignore */ } if (Q.has('char') && models[+Q.get('char')]) selectCharacter(+Q.get('char')); viewIdx = CHARS.findIndex((c) => c.model === charIdx); renderChars(); });
window.game = {
  state, THREE, scene, camera, region,
  advance(sec, step = 1 / 60) { let n = Math.round(sec / step); while (n-- > 0) update(step); render(); },
  until(fn, max = 8, step = 1 / 60) { let n = Math.round(max / step); while (n-- > 0 && !fn()) update(step); render(); },
  snap() { camSnap = true; update(0.001); render(); },
  runner, models, startRun, startZip, showScreen, openOver, applyRegion, render, jump, slide, moveLane, get ready() { return ready; }, setChar(i) { selectCharacter(i); viewIdx = CHARS.findIndex((c) => c.model === i); renderChars(); },
  setAuto(v) { state.auto = v; },
  rendererInfo() { renderer.info.reset(); renderer.render(scene, camera); const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, chunks: chunks.size }; },
  clear(ahead = 3, behind = 7) {
    const gates = [...chunks.keys()].filter((k) => k % 5 === 3).map((k) => -(k * CHUNK + CHUNK / 2) - 4);
    const gateOk = gates.every((gz) => !(gz < state.pz + 25 && gz > state.pz - 55));
    return gateOk && state.grounded && state.slide <= 0 && !state.zip && Math.abs(state.x - state.lane * LANE_W) < 0.05 && !allItems.some((o) => o.alive && o.type === 'obs' && o.z < state.pz + behind && o.z > state.pz - ahead);
  },
};
