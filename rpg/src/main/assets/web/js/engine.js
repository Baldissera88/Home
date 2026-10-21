import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Assets } from './assets.js';
import { World } from './world.js';
import { Actors } from './actors.js';
import { Fx } from './fx.js';
import { Atmosphere } from './atmosphere.js';
import { ChaseCamera } from './camera.js';
import { Overlay, loadFonts } from './overlay.js';
import { OCCLUDE } from './occlude.js';
import { FrameInterpolator } from './interp.js';

/** Vignette, a gentle filmic grade, the red edge of low health and the white flash of a new level. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
    uWarm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uHurt, uFlash, uAspect, uWarm;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);
      float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, r);
      vec3 col = c.rgb * vig;
      // split tone: cool shadows, warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l));
      col *= 1.0 + uWarm * vec3(0.06, 0.01, -0.05);
      col = mix(col, vec3(0.6, 0.0, 0.0), uHurt * smoothstep(0.45, 1.1, r) * 0.7);
      col += uFlash * vec3(1.0, 0.95, 0.85);
      gl_FragColor = vec4(col, c.a);
    }`,
};

const QUALITY = {
  high: { maxDpr: 2, minDpr: 1.1, shadowMap: 2048, shadowSpan: 15, pointLights: 6, bloom: true, msaa: 4, grass: 1 },
  low: { maxDpr: 1.25, minDpr: 0.8, shadowMap: 1024, shadowSpan: 13, pointLights: 4, bloom: false, msaa: 0, grass: 0.5 },
};

export class Engine {
  constructor(opts = {}) {
    this.quality = QUALITY[opts.quality] || QUALITY.high;
    this.bridge = opts.bridge || null;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.capture, stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(r.domElement);
    r.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.report('context lost'); });

    this.scene = new THREE.Scene();
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.camera = this.chase.camera;
    this.overlay = new Overlay();
    this.dpr = Math.min(devicePixelRatio || 1, this.quality.maxDpr);
    this.fixedDpr = opts.dpr || 0;

    // HDR needs float colour buffers; a few older GPUs only render to 8-bit ones.
    const hdr = r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float');
    const target = new THREE.WebGLRenderTarget(1, 1, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: this.quality.msaa });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 0.9);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.assets = new Assets(r);
    this.actors = new Actors(this.assets, this.scene);
    this.atmosphere = new Atmosphere(r, this.scene, this.quality);
    this.world = null;
    this.level = null;
    this.frame = null;
    this.building = 0;
    this.pending = null;
    this.lastTime = 0;
    this.frameTimes = [];
    this.ground = (x, y) => (this.world ? this.world.heightAt(x, y) : 0);
    addEventListener('resize', () => this.resize());
  }

  report(msg) {
    console.error(msg);
    if (this.bridge && this.bridge.error) this.bridge.error(String(msg));
  }

  async init() {
    await Promise.all([this.assets.load(), loadFonts()]);
    this.fx = new Fx(this.assets, this.scene);
    this.resize();
    this.ready = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      await this.setLevel(p);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = this.fixedDpr || this.dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.chase.resize(w / h);
    this.overlay.resize(w, h, Math.min(devicePixelRatio || 1, 2));
    this.grade.uniforms.uAspect.value = w / h;
    const scale = h * dpr * this.camera.projectionMatrix.elements[5] * 0.5;
    if (this.fx) this.fx.scale.value = scale;
    this.atmosphere.setPointScale(scale);
  }

  receive(data) {
    let msg = data;
    if (typeof data === 'string') {
      try { msg = JSON.parse(data); } catch (e) { this.report('bad message: ' + e.message); return; }
    }
    if (!msg) return;
    if (msg.k === 'f') (this.interp || (this.interp = new FrameInterpolator())).push(msg, performance.now());
    else if (msg.k === 'level') {
      if (this.interp) this.interp.reset();
      if (this.ready) this.setLevel(msg); else this.pending = msg;
    } else if (msg.k === 'cam') this.chase.setView(msg.p, msg.d);
  }

  async setLevel(level) {
    const id = ++this.building;
    const world = new World(this.assets, level, this.quality);
    let group;
    try {
      group = await world.build();
    } catch (e) {
      this.report('level build failed: ' + (e && e.stack || e));
      return;
    }
    if (id !== this.building) return;
    // Compile the new level's shaders up front so the first frames do not stutter.
    try { await this.renderer.compileAsync(group, this.camera, this.scene); } catch (e) { /* compiles on first draw instead */ }
    if (id !== this.building) return;
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    }
    this.world = world;
    this.level = level;
    this.scene.add(group);
    this.actors.reset();
    this.fx.reset();
    this.actors.placeMerchant(level, this.ground);
    this.atmosphere.setLevel(world);
    this.chase.ready = false;
    if (this.onLevel) this.onLevel(level);
  }

  /** Advances everything by dt with the latest game frame and draws it. */
  step(dt, render = true) {
    if (!this.update(dt)) {
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      return false;
    }
    if (render) this.draw(dt);
    return true;
  }

  /** Moves the scene to the latest game frame; false while there is nothing to show yet. */
  update(dt) {
    // Frames come on the game's clock: show the moment due at this display frame (rAF time when looping).
    const f = this.frame = this.interp ? this.interp.sample(this.lastTime || performance.now()) : null;
    if (!this.ready || !this.world || !f) return false;
    const ground = this.ground;
    this.actors.update(f, dt, ground);
    const hero = this.actors.hero.root.position;
    this.chase.update(f, dt, hero, ground);
    OCCLUDE.uHero.value.set(hero.x, hero.y + 0.8, hero.z);
    OCCLUDE.uCam.value.copy(this.camera.position);
    this.world.update(f, f.t, dt);
    this.fx.update(f, dt, f.t, ground, this.camera);
    this.atmosphere.update(f, dt, f.t, hero, this.camera, this.fx);
    const g = this.grade.uniforms;
    g.uHurt.value = Math.max(0, 1 - f.p[9] / 0.35);
    g.uFlash.value = Math.min(1, f.lf || 0) * 0.8;
    g.uWarm.value = this.world.outdoors ? 1 - f.dl : 0.6;
    this.renderer.toneMappingExposure = this.world.outdoors ? 1.0 : 1.45;
    if (this.bloom) this.bloom.strength = this.world.outdoors ? 0.38 + 0.35 * (1 - f.dl) : 0.65;
    return true;
  }

  draw(dt) {
    this.drawScene(dt);
    this.drawOverlay();
  }

  /** The 3D view with its post-processing. */
  drawScene(dt) {
    this.composer.render(dt);
  }

  /** The 2D labels over it. */
  drawOverlay() {
    this.overlay.draw(this.frame, this.camera, this.ground, this.actors, this.level);
  }

  /** Runs the render loop, trading resolution for frame rate when the phone struggles. */
  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 1 / 60;
      this.lastTime = now;
      try {
        if (this.step(dt)) this.adapt(dt);
      } catch (e) {
        this.report('frame failed: ' + (e && e.stack || e));
      }
    };
    requestAnimationFrame(loop);
  }

  /** Still too slow at the lowest resolution: give up bloom, then shadow detail, then more resolution. */
  degrade() {
    const q = this.quality;
    if (this.bloom && this.bloom.enabled) {
      this.bloom.enabled = false;
    } else if (this.atmosphere.sun.shadow.mapSize.x > 1024) {
      const s = this.atmosphere.sun.shadow;
      s.mapSize.set(1024, 1024);
      if (s.map) { s.map.dispose(); s.map = null; }
    } else if (q.minDpr > 0.75) {
      this.quality = { ...q, minDpr: q.minDpr - 0.2 };
    }
  }

  adapt(dt) {
    if (this.fixedDpr) return;
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    const q = this.quality;
    let next = this.dpr;
    if (avg > 1 / 45 && this.dpr <= q.minDpr + 0.01) this.degrade();
    if (avg > 1 / 45) next = Math.max(q.minDpr, this.dpr - 0.2);
    else if (avg < 1 / 58 && this.dpr < Math.min(devicePixelRatio || 1, q.maxDpr)) next = Math.min(q.maxDpr, this.dpr + 0.1);
    if (Math.abs(next - this.dpr) > 0.01) {
      this.dpr = next;
      this.resize();
    }
  }
}
