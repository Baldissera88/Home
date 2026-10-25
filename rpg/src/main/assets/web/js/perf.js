// Keeps the live view smooth on any phone (Engine.start): which preset a device starts with, a steady 60
// or 30 fps cadence, frame, JS and GPU times measured robustly, and the ?stats=1 readout. The screenshot
// harness never runs any of this; it draws with exactly the dpr and preset it asks for.

const TIERS = ['low', 'medium', 'high'];
const CAP = 256;

/** Rates a WebGL renderer string: 2 high, 1 medium, 0 low, -1 when the GPU is not recognised. */
export function gpuRank(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return -1;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(s)) return 0;
  const cores = +((s.match(/\bm[pc](\d+)/) || [])[1] || 0);
  let m = s.match(/adreno\D*(\d{3})/);
  if (m) {
    // The first digit is the family, the rest the step within it (610 budget, 619 mid, 650 flagship).
    const n = +m[1], fam = Math.floor(n / 100), step = n % 100;
    if (fam >= 8) return step >= 20 ? 2 : 1;
    if (fam === 7) return step >= 20 ? 2 : step >= 10 ? 1 : 0;
    if (fam === 6) return step >= 40 ? 2 : step >= 15 ? 1 : 0;
    if (fam === 5) return step >= 30 ? 1 : 0;
    return 0;
  }
  if (/immortalis/.test(s)) return 2;
  m = s.match(/mali-?\s*([gt])(\d+)/);
  if (m) {
    if (m[1] === 't') return 0;
    const n = +m[2];
    if (n < 10) return /ultra/.test(s) ? 2 : 1; // Mali-G1 Pro / Premium / Ultra
    if (n >= 700) return 2; // G710 ... G925
    if (n >= 600) return cores && cores < 4 ? 1 : 2; // G610, G615 MC6
    if (n >= 500) return 1; // G510
    if (n >= 100) return 0; // G310
    if (n >= 77) return cores && cores < 7 ? 1 : 2; // G77, G78
    if (n === 76) return cores >= 10 ? 2 : 1;
    if (n === 68 || n === 57) return 1;
    if (n === 71 || n === 72) return cores >= 12 ? 1 : 0;
    return 0; // G31, G51, G52
  }
  m = s.match(/xclipse\D*(\d+)/);
  if (m) return +m[1] >= 900 ? 2 : 1;
  if (/powervr|imagination|\bimg\b/.test(s)) return /dxt|dxd|cxt/.test(s) ? 2 : /bx[mest]/.test(s) ? 1 : 0;
  if (/maleoon|apple|nvidia|geforce|quadro|radeon|\bamd\b|iris|\barc\b/.test(s)) return 2;
  if (/intel/.test(s)) return 1;
  return -1;
}

/**
 * The preset a device starts with. `asked` is the player's ?q= choice: 'high' means the best this device
 * can do, so a weak GPU, little memory or few cores start lower; 'medium' is at most medium; 'low' is low.
 * An unrecognised GPU keeps the choice and leaves the rest to the frame pacer.
 * @returns {{ tier: string, gpu: string, rank: number, cores: number, memory: number }}
 */
export function detectTier(gl, asked) {
  let gpu = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (e) { gpu = ''; }
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const cores = nav.hardwareConcurrency || 0, memory = nav.deviceMemory || 0;
  const rank = gpuRank(gpu);
  let t = asked === 'low' ? 0 : asked === 'medium' ? 1 : 2;
  if (rank >= 0) t = Math.min(t, rank);
  if (memory && memory <= 1) t = 0;
  else if (memory && memory <= 2) t = Math.min(t, 1);
  if (cores && cores <= 2) t = 0;
  else if (cores && cores <= 4) t = Math.min(t, 1);
  return { tier: TIERS[t], gpu, rank, cores, memory };
}

/**
 * One step down from preset q, or null past the last, in the order the frame pacer gives things up: first
 * the extras of the high preset (screen-space occlusion, light shafts, film grain: a few ms of GPU, missed
 * least), then bloom, then a 1024 shadow map with one point light fewer and sparser grass, then lower
 * minimum resolutions (down to 0.8) with fewer lights. Medium and low never have the extras.
 */
export function lowerPreset(q) {
  if (q.ao || q.rays || q.grain) return { ...q, ao: false, rays: false, grain: false };
  if (q.bloom) return { ...q, bloom: false };
  if (q.shadowMap > 1024) return { ...q, shadowMap: 1024, pointLights: Math.max(3, q.pointLights - 1), grass: Math.min(q.grass, 0.6) };
  if (q.minDpr > 0.81) return { ...q, minDpr: Math.max(0.8, q.minDpr - 0.2), pointLights: Math.max(2, q.pointLights - 1), grass: Math.min(q.grass, 0.4) };
  return null;
}

/** Sorts the first n values in place: insertion sort, as n is small and nothing may be allocated. */
function sortN(a, n) {
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
}

/** The value at fraction f of the first n sorted values. */
const pick = (a, n, f) => a[Math.min(n - 1, Math.floor(f * n))];

/**
 * Paces the live loop and measures it. tick() says whether a display frame is drawn: every one for 60 fps
 * (every second one on a 120 Hz screen) or, in 30 fps mode, one in two at 60 Hz, counted in display
 * refreshes so the cadence stays even. Drawn frames fill one-second windows; measure() closes a window
 * into `stat`. Samples are ignored for a few seconds after a level loads (shader compiles, uploads) and
 * briefly after every change (settle()). The controller state below is driven by Engine.adapt().
 */
export class FramePacer {
  constructor() {
    /** Target cadence: 60, or 30 when the device can't hold 60 at its lowest settings. */
    this.fps = 60;
    /** Display refresh interval in ms, learnt from the rAF timestamps (never assumed slower than 57 Hz). */
    this.vsync = 1000 / 60;
    this.now = 0;
    this.level = undefined;
    this.lastRaf = 0;
    this.lastDraw = 0;
    this.prevDrawn = 0;
    this.ignoreUntil = 0;
    this.changedAt = 0;
    this.resumed = false;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { this.resumed = true; });
    // Engine.adapt(): consecutive good / slow windows, the resolution that last failed after a step up
    // (and until when to keep below it), when to next try 60 fps again from 30, and the probe requests.
    this.good = 0;
    this.slow = 0;
    this.upAt = -1e9;
    this.ceil = Infinity;
    this.ceilUntil = 0;
    this.ceilTtl = 30000;
    this.retry = 15000;
    this.retryAt = 0;
    this.trialUntil = 0;
    this.trialDpr = 0;
    this.gpuTrust = true;
    this.gpuDoubt = 0;
    this.probeDue = false;
    this.probeMs = -1;
    this.probeAt = -1e9;
    this.probeGap = 2500;
    this.raw = new Float32Array(CAP * 2);
    this.nRaw = 0;
    this.iv = new Float32Array(CAP);
    this.js = new Float32Array(CAP);
    this.gpu = new Float32Array(CAP);
    this.n = 0;
    this.nGpu = 0;
    this.sum = 0;
    this.tmp = new Float32Array(CAP * 2);
    /**
     * The last closed window: drawn fps, median and 90th-percentile frame interval (ms), load (mean interval
     * without hitches over the budget; 1 holds the cadence), the share of late frames, median JS and GPU ms
     * (gpu -1 when unknown), the budget (ms per drawn frame), and whether it was slow or comfortably on time.
     */
    this.stat = { fps: 0, med: 0, p90: 0, load: 1, late: 0, js: 0, gpu: -1, budget: 1000 / 60, n: 0, slow: false, good: false };
  }

  /** Display refreshes per drawn frame. */
  get every() { return Math.max(1, Math.round(1000 / this.fps / this.vsync)); }

  /** Time between drawn frames at the target cadence, ms. */
  get budget() { return this.every * this.vsync; }

  /** Called on every animation frame: dt in seconds (accumulated over skipped frames) to draw it, or 0 to skip. */
  tick(now, level) {
    const gap = this.lastRaf ? now - this.lastRaf : 0;
    this.lastRaf = now;
    if (level !== this.level) {
      // A new level compiles shaders and uploads textures for a while; its load also differs from the last.
      this.level = level;
      this.restart(now, 2500);
      this.ceil = Infinity;
      this.ceilUntil = 0;
      this.ceilTtl = 30000;
      this.retry = 15000;
      this.retryAt = 0;
      this.trialUntil = 0;
    }
    if (this.resumed) {
      // Back from the background: the gap is not a frame time.
      this.resumed = false;
      this.restart(now, 1000);
      this.lastDraw = 0;
      this.prevDrawn = 0;
    } else if (gap >= 3 && gap < 100 && this.nRaw < this.raw.length) this.raw[this.nRaw++] = gap;
    if (this.lastDraw && now - this.lastDraw < (this.every - 0.5) * this.vsync) return 0;
    const dt = this.lastDraw ? Math.min(0.05, (now - this.lastDraw) / 1000) : 1 / 60;
    this.lastDraw = now;
    this.now = now;
    return dt;
  }

  /** The frame tick() allowed drew nothing (no level yet): the next one starts a fresh interval. */
  drop() { this.prevDrawn = 0; }

  /** Adds the frame just drawn: its JS ms and a GPU ms that has come back meanwhile (-1 if none). */
  record(js, gpu) {
    const now = this.now, prev = this.prevDrawn;
    this.prevDrawn = now;
    if (now < this.ignoreUntil || !prev) { this.clear(); return; }
    if (gpu >= 0 && this.nGpu < CAP) this.gpu[this.nGpu++] = gpu;
    if (this.n >= CAP) return;
    const iv = now - prev;
    this.iv[this.n] = iv;
    this.js[this.n] = js;
    this.n++;
    this.sum += iv;
  }

  /** The result of a sync probe: ms from the start of a frame until the GPU had drawn it. */
  probed(ms) {
    this.probeMs = ms;
    this.probeAt = this.now;
    this.probeDue = false;
  }

  /** A frame's work in ms: the GPU timer while trusted, else a recent sync probe at the current settings; -1 if unknown. */
  cost() {
    const s = this.stat;
    if (this.gpuTrust && s.gpu >= 0) return Math.max(s.gpu, s.js);
    return this.probeMs >= 0 && this.now - this.probeAt < this.probeGap + 2000 ? this.probeMs : -1;
  }

  /** Something changed (resolution, effects, cadence): judge it only after it settles, on fresh windows. */
  settle(ms = 500) {
    this.changedAt = this.now;
    this.restart(this.now, ms);
    this.good = 0;
    this.slow = 0;
    this.probeMs = -1;
    this.probeGap = 2500;
  }

  setFps(fps) {
    if (fps === this.fps) return;
    this.fps = fps;
    this.settle();
  }

  /** 60 fps does not hold: a steady 30, and twice as long as last time before trying 60 again. */
  toThirty() {
    this.retry = Math.min(240000, this.retry * 2);
    this.retryAt = this.now + this.retry;
    this.trialUntil = 0;
    this.setFps(30);
  }

  restart(now, ms) {
    this.ignoreUntil = Math.max(this.ignoreUntil, now + ms);
    this.clear();
  }

  clear() {
    this.n = 0;
    this.nGpu = 0;
    this.nRaw = 0;
    this.sum = 0;
  }

  /** Closes the window once it spans a second (three on a crawling device); true when `stat` is new. */
  measure() {
    const n = this.n;
    if (!(this.sum >= 1000 && n >= 6) && !(this.sum >= 3000 && n >= 2) && n < CAP) return false;
    const t = this.tmp, s = this.stat;
    this.learnVsync();
    const budget = this.budget;
    for (let i = 0; i < n; i++) t[i] = this.iv[i];
    sortN(t, n);
    const med = pick(t, n, 0.5);
    // The rate leaves out lone hitches (a shader compile, a GC pause); the late share counts them.
    let sum = 0, k = 0, late = 0;
    for (let i = 0; i < n; i++) {
      const v = t[i];
      if (v > budget * 1.3) late++;
      if (v > med * 4 && v > budget * 2) continue;
      sum += v;
      k++;
    }
    s.n = n;
    s.med = med;
    s.p90 = pick(t, n, 0.9);
    s.fps = 1000 * n / this.sum;
    s.budget = budget;
    s.load = sum / k / budget;
    s.late = late / n;
    for (let i = 0; i < n; i++) t[i] = this.js[i];
    sortN(t, n);
    s.js = pick(t, n, 0.5);
    s.gpu = -1;
    if (this.nGpu >= 4) {
      for (let i = 0; i < this.nGpu; i++) t[i] = this.gpu[i];
      sortN(t, this.nGpu);
      s.gpu = pick(t, this.nGpu, 0.5);
    }
    // Good: on time, a lone late frame at most. Slow: a few frames a second late (about 58 fps or less at
    // 60), or far behind (load over 1.3; Engine.adapt waits for a second slow window otherwise).
    s.good = s.late <= 0.02 && s.load < 1.02;
    s.slow = (s.late > 0.025 && s.load > 1.015) || s.load > 1.3;
    if (s.gpu >= 0 && this.gpuTrust) {
      // Some drivers report zeros or nonsense; and late frames while GPU and JS both look idle mean the
      // timer can't see where the time goes. Either way, stop steering by it.
      this.gpuDoubt = s.slow && s.gpu < budget * 0.5 && s.js < budget * 0.5 ? this.gpuDoubt + 1 : 0;
      if (s.gpu < 0.05 || s.gpu > med * 2 + 5 || this.gpuDoubt >= 2) this.gpuTrust = false;
    }
    this.clear();
    return true;
  }

  /** The refresh interval: the mean of the shortest cluster of rAF gaps (timestamps are vsync-aligned). */
  learnVsync() {
    const nr = this.nRaw, t = this.tmp;
    if (nr < 8) return;
    for (let i = 0; i < nr; i++) t[i] = this.raw[i];
    sortN(t, nr);
    const lo = pick(t, nr, 0.1);
    let sum = 0, k = 0;
    for (let i = 0; i < nr; i++) {
      if (t[i] >= lo * 0.8 && t[i] <= lo * 1.25) { sum += t[i]; k++; }
    }
    const v = Math.max(6, sum / k);
    // Adopt a faster screen at once; drift slowly otherwise. A device too slow for its 60 Hz screen looks
    // like a 30 Hz one, hence the cap.
    this.vsync = Math.min(17.5, v < this.vsync * 0.9 ? v : this.vsync + (v - this.vsync) * 0.3);
  }
}

/**
 * GPU time per frame from EXT_disjoint_timer_query_webgl2 where the driver offers it; poll() returns
 * -1 otherwise. Results come back a few frames late; disjoint ones (clock changes) are dropped.
 */
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = null;
    this.free = [];
    this.pending = [];
    this.active = null;
    try {
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      }
      if (this.ext) for (let i = 0; i < 4; i++) this.free.push(gl.createQuery());
    } catch (e) { this.ext = null; }
    this.ok = !!this.ext;
  }

  begin() {
    if (!this.ok || this.active || !this.free.length) return;
    try {
      const q = this.free.pop();
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
      this.active = q;
    } catch (e) { this.ok = false; }
  }

  end() {
    if (!this.active) return;
    try { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch (e) { this.ok = false; }
    this.pending.push(this.active);
    this.active = null;
  }

  /** GPU ms of the oldest frame whose result has come back, or -1. */
  poll() {
    if (!this.ok || !this.pending.length) return -1;
    const gl = this.gl, q = this.pending[0];
    try {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return -1;
      this.pending.shift();
      this.free.push(q);
      if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) return -1;
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      return ms >= 0 && ms < 1000 ? ms : -1;
    } catch (e) {
      this.ok = false;
      return -1;
    }
  }
}

/** The ?stats=1 readout: a small text box over the view, rewritten once a second. */
export class StatsView {
  constructor() {
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:4px;top:max(4px,env(safe-area-inset-top));z-index:9;padding:2px 6px;'
      + 'border-radius:3px;font:11px/1.35 monospace;color:#dfe8d8;background:rgba(0,0,0,0.6);pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    /** When to next count a whole frame's draw calls and triangles (renderer.info). */
    this.infoAt = 0;
    this.calls = 0;
    this.tris = 0;
  }

  /** Shows a closed window: fps, frame ms, JS and GPU (or probe) ms, dpr, preset, cadence, calls, triangles. */
  show(engine, s) {
    const p = engine.pacer, q = engine.quality;
    const gpu = s.gpu >= 0 ? (p.gpuTrust ? 'gpu ' : 'gpu? ') + s.gpu.toFixed(1) : p.probeMs >= 0 ? 'sync ' + p.probeMs.toFixed(1) : 'gpu -';
    const tris = this.tris >= 1e6 ? (this.tris / 1e6).toFixed(2) + 'M' : (this.tris / 1e3).toFixed(0) + 'k';
    this.el.textContent = `${s.fps.toFixed(0)} fps  ${s.med.toFixed(1)} ms  p90 ${s.p90.toFixed(1)}  late ${(s.late * 100).toFixed(0)}%\n`
      + `js ${s.js.toFixed(1)}  ${gpu}  load ${s.load.toFixed(2)}\n`
      + `dpr ${(engine.fixedDpr || engine.dpr).toFixed(2)}  ${q.name || '?'} @${p.fps}${q.bloom ? '' : ' -bloom'}${q.ao ? ' +ao' : ''}${q.rays ? ' +rays' : ''}  vsync ${p.vsync.toFixed(1)}\n`
      + `${this.calls} calls  ${tris} tris`;
  }
}
