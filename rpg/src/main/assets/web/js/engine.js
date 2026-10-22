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
import { Impact } from './impact.js';
import { Atmosphere } from './atmosphere.js';
import { ChaseCamera } from './camera.js';
import { Overlay, loadFonts } from './overlay.js';
import { detectTier, FramePacer, GpuTimer, StatsView } from './perf.js';
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

/**
 * Render presets, picked by ?q= (see detectTier in perf.js: 'high' means the best the device can do).
 * maxDpr/minDpr bound the dynamic resolution, shadowMap/shadowSpan size the sun's shadow, pointLights is the
 * pool for fires and magic, bloom and msaa (samples) switch post effects, grass scales tuft density, and
 * name is the preset's key. Engine.degrade() swaps in lowered copies and tells `engine.onQuality`.
 */
const QUALITY = {
  high: { name: 'high', maxDpr: 2, minDpr: 1.1, shadowMap: 2048, shadowSpan: 15, pointLights: 6, bloom: true, msaa: 4, grass: 1 },
  medium: { name: 'medium', maxDpr: 1.6, minDpr: 0.95, shadowMap: 1536, shadowSpan: 14, pointLights: 5, bloom: true, msaa: 2, grass: 0.75 },
  low: { name: 'low', maxDpr: 1.25, minDpr: 0.8, shadowMap: 1024, shadowSpan: 13, pointLights: 4, bloom: false, msaa: 0, grass: 0.5 },
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
    // ?q= is the player's choice and 'high' means the best this device can do, so a weak GPU starts lower.
    // The screenshot harness (capture, a fixed dpr, or tier: false) gets exactly the preset it names.
    this.device = opts.tier === false || opts.capture || opts.dpr ? null : detectTier(r.getContext(), opts.quality);
    if (this.device) this.quality = QUALITY[this.device.tier];
    /** The preset the device started with; `quality` is it after `degraded` degrade() steps. */
    this.preset = this.quality;
    this.degraded = 0;
    /** Called as onQuality(next, prev) when the live loop changes `quality`; the next level is built with it. */
    this.onQuality = null;
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
    this.impact = new Impact(this.scene, this.assets);
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
    this.impact.reset();
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
    this.actors.update(f, dt, ground, this.camera);
    const hero = this.actors.hero.root.position;
    this.chase.update(f, dt, hero, ground);
    OCCLUDE.uHero.value.set(hero.x, hero.y + 0.8, hero.z);
    OCCLUDE.uCam.value.copy(this.camera.position);
    this.world.update(f, f.t, dt);
    this.fx.update(f, dt, f.t, ground, this.camera);
    this.impact.update(f, dt, this.ground, this.camera, this.actors);
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

  /**
   * Runs the render loop at a steady 60 fps, or a steady 30 (every second display frame, dt accumulated)
   * when the phone can't hold 60 even at its lowest settings; adapt() steers between them. ?stats=1 shows
   * a readout of what it measures.
   */
  start() {
    const p = this.pacer = new FramePacer();
    const r = this.renderer, gl = r.getContext(), info = r.info, px = new Uint8Array(4);
    const timer = this.gpuTimer = new GpuTimer(gl);
    const stats = this.stats = new URLSearchParams(location.search).get('stats') === '1' ? new StatsView() : null;
    this.paced = new Map();
    this.paceKey = undefined;
    if (this.device) console.info(`[perf] ${this.device.gpu || 'unknown GPU'}, ${this.device.cores} cores, ${this.device.memory} GB: ${this.quality.name}${timer.ok ? ', GPU timer' : ''}`);
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (this.level && this.level !== p.level && !this.fixedDpr) this.relevel();
      const dt = p.tick(now, this.level);
      if (!dt) return;
      this.lastTime = now;
      // Once a second the readout counts a whole frame's draw calls (all passes), then autoReset is back on.
      const sample = stats !== null && now >= stats.infoAt;
      try {
        if (sample) { info.autoReset = false; info.reset(); }
        const t0 = performance.now();
        let drawn = false;
        timer.begin();
        try { drawn = this.step(dt); } finally { timer.end(); }
        if (!drawn) { p.drop(); return; }
        const js = performance.now() - t0;
        if (p.probeDue && now >= p.ignoreUntil) {
          // A one-off sync: wait for the GPU to finish this frame, which shows how much room is left.
          r.setRenderTarget(null);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          p.probed(performance.now() - t0);
        }
        this.adapt(js);
      } catch (e) {
        this.report('frame failed: ' + (e && e.stack || e));
      } finally {
        if (sample) {
          stats.calls = info.render.calls;
          stats.tris = info.render.triangles;
          info.autoReset = true;
          stats.infoAt = now + 1000;
        }
      }
    };
    requestAnimationFrame(loop);
  }

  /** Sets the dynamic resolution (two decimals) and lets the frame pacer settle; false if unchanged. */
  setDpr(v) {
    const next = Math.round(v * 100) / 100;
    if (this.fixedDpr || Math.abs(next - this.dpr) < 0.01) return false;
    this.dpr = next;
    this.resize();
    if (this.pacer) this.pacer.settle();
    return true;
  }

  /**
   * The preset after `steps` degrade steps, or null past the last: bloom off, then a 1024 shadow map with
   * one point light fewer and sparser grass, then lower minimum resolutions (down to 0.8) with fewer lights.
   */
  lowered(steps) {
    let q = this.preset;
    for (let i = 0; i < steps; i++) {
      if (q.bloom) q = { ...q, bloom: false };
      else if (q.shadowMap > 1024) q = { ...q, shadowMap: 1024, pointLights: Math.max(3, q.pointLights - 1), grass: Math.min(q.grass, 0.6) };
      else if (q.minDpr > 0.81) q = { ...q, minDpr: Math.max(0.8, q.minDpr - 0.2), pointLights: Math.max(2, q.pointLights - 1), grass: Math.min(q.grass, 0.4) };
      else return null;
    }
    return q;
  }

  /** Applies the preset lowered by `steps` (bloom pass, sun shadow map) and tells onQuality; false if past the last. */
  setDegraded(steps) {
    const q = this.lowered(steps);
    if (!q) return false;
    const prev = this.quality;
    this.degraded = steps;
    this.quality = q;
    if (this.bloom) this.bloom.enabled = q.bloom;
    const s = this.atmosphere.sun.shadow;
    if (s.mapSize.x !== q.shadowMap) {
      s.mapSize.set(q.shadowMap, q.shadowMap);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    if (q !== prev && this.onQuality) this.onQuality(q, prev);
    return true;
  }

  /**
   * Still too slow at the lowest resolution: give up bloom, then shadow detail (announcing fewer point
   * lights and sparser grass), then more resolution. False when there is nothing left to give.
   */
  degrade() {
    if (!this.setDegraded(this.degraded + 1)) return false;
    if (this.dpr > this.quality.minDpr) this.setDpr(this.quality.minDpr);
    return true;
  }

  /**
   * A new level: remember where the last kind of level (its biome) settled, and start this one where its
   * kind last did, or from the full preset the first time, so a light dungeon gets back what a heavy
   * overworld cost and a heavy one does not have to find its settings again.
   */
  relevel() {
    const p = this.pacer, key = this.level.biome;
    if (this.paceKey !== undefined) this.paced.set(this.paceKey, { dpr: this.dpr, fps: p.fps, degraded: this.degraded });
    this.paceKey = key;
    const m = this.paced.get(key);
    this.setDegraded(m ? m.degraded : 0);
    p.fps = m ? m.fps : 60;
    if (m) this.setDpr(m.dpr);
  }

  /**
   * Called after each drawn frame with its JS ms. Once per measured second it steers toward a steady frame
   * rate: resolution down at once when frames run late, up slowly when there is room (and not back to one
   * that just failed, for a while longer each time); at the lowest resolution effects go, then 60 fps
   * gives way to a steady 30, which goes back to 60 when the work clearly fits.
   */
  adapt(js) {
    const p = this.pacer;
    p.record(js, this.gpuTimer.poll());
    if (!p.measure()) return;
    const s = p.stat, q = this.quality, now = p.now;
    if (this.stats) this.stats.show(this, s);
    if (this.fixedDpr) return;
    const top = Math.min(devicePixelRatio || 1, q.maxDpr);
    const cost = p.cost();
    const sure = p.fps === 30 || (p.gpuTrust && s.gpu >= 0);
    // Without a trusted GPU timer, a sync probe measures the work while frames are on time: each second at
    // 30 fps, where the stall fits in the spare frame, and now and then at 60 while resolution could grow.
    p.probeDue = s.good && !(p.gpuTrust && s.gpu >= 0) && (p.fps === 30 || this.dpr < top - 0.01)
      && now - p.probeAt > (p.fps === 30 ? 900 : p.probeGap);
    if (s.slow) {
      p.good = 0;
      if (s.load < 1.3 && ++p.slow < 2) return; // only a little late: make sure first
      p.slow = 0;
      if (p.fps === 60 && now < p.trialUntil) {
        p.toThirty(); // the way back from 30 did not hold
        this.setDpr(p.trialDpr);
      } else if (p.fps === 60 && s.js > s.budget * 0.85) {
        p.toThirty(); // the CPU is the limit: fewer pixels would not help
      } else if (this.dpr > q.minDpr + 0.01) {
        if (now - p.upAt < 15000) {
          // The last step up was too far: stay below it for a while, longer each time.
          p.ceil = now < p.ceilUntil ? Math.min(p.ceil, this.dpr) : this.dpr;
          p.ceilUntil = now + p.ceilTtl;
          p.ceilTtl = Math.min(240000, p.ceilTtl * 2);
        }
        // Size the step by measured work only when it is exact; a little late never costs more than 15%.
        const f = cost > 0 && sure ? Math.sqrt(0.8 * s.budget / cost) : 0.95 / Math.sqrt(s.load);
        this.setDpr(Math.max(q.minDpr, Math.min(this.dpr - 0.05, Math.floor(this.dpr * Math.max(s.load < 1.3 ? 0.85 : 0.6, f) * 20) / 20)));
      } else if (p.fps === 60 && s.load > 1.6) {
        p.toThirty(); // far off even at the lowest resolution: effects alone won't get there
      } else if (this.degrade()) {
        p.settle();
      } else if (p.fps === 60) {
        p.toThirty();
      }
      return;
    }
    if (!s.good) {
      p.good = 0;
      p.slow = Math.max(0, p.slow - 0.5); // late now and then: a slow window soon after still counts twice
      return;
    }
    p.slow = 0;
    p.good++;
    if (p.good < 3) return;
    if (p.fps === 30 && now >= p.retryAt && cost > 0) {
      // Try 60 when the measured work fits 70% of its budget, at a lower resolution if need be (assuming
      // only half the work scales with pixels).
      const t60 = p.vsync * Math.max(1, Math.round(1000 / 60 / p.vsync));
      const fit = 0.7 * t60 / cost;
      const d = fit >= 1 ? this.dpr : fit > 0.5 ? Math.floor(this.dpr * Math.sqrt((fit - 0.5) / 0.5) * 20) / 20 : 0;
      if (d >= q.minDpr) {
        p.trialDpr = this.dpr;
        p.trialUntil = now + 6000;
        p.retryAt = now + p.retry;
        p.setFps(60);
        this.setDpr(d);
        return;
      }
    }
    if (this.dpr < top - 0.01 && now - p.changedAt >= 4000) {
      let next = this.dpr + 0.1;
      if (cost > 0) {
        // At 60 fps a probe also counts GPU work that would overlap the next frame, so there only a clear
        // lack of room stops the climb (a near miss gets a small step; the ceiling catches overshoot).
        const room = 0.75 * s.budget / cost;
        if (room >= 1.1) next = Math.max(next, this.dpr * Math.min(1.25, Math.sqrt(room)));
        else if (sure || room < 0.88) {
          p.probeGap = Math.min(32000, p.probeGap * 2);
          return;
        }
      }
      // Below a resolution that failed while the ceiling lasts; after that, that resolution once more, and
      // past it only once it has held.
      if (now < p.ceilUntil) next = Math.min(next, p.ceil - 0.05);
      else if (this.dpr >= p.ceil - 0.01) p.ceil = Infinity;
      else next = Math.min(next, p.ceil);
      next = Math.min(top, Math.floor(next * 20) / 20);
      if (next > this.dpr + 0.02 && this.setDpr(next)) p.upAt = now;
    }
  }
}
