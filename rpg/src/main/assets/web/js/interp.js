// Smooth motion between game frames. Kotlin posts one frame per display frame, but its vsync and the
// WebView's are not in step and postMessage adds jitter, so drawing whatever arrived last shows some
// frames twice and skips others. The interpolator buffers frames with their arrival and game times and
// plays them back on a steady clock about one frame behind the newest, blending positions between the
// two frames around it. Everything that does not move smoothly is taken from the newer of the two.

const N = 16;                 // frames kept
const STALL = 250;            // ms without frames after which playback restarts and everything snaps
const TELEPORT = 2.5 * 2.5;   // squared tiles: a longer move between two frames is a jump, not motion
const SHOT = 1;               // squared tiles a projectile may stray from where it was heading
const RESYNC = 0.12;          // s of clock error fixed by a jump instead of slewing
const SKEW = 0.06;            // most the playback rate may stray from real time
const GAIN = 2.5;             // 1/s: how fast clock error is slewed out
const COARSE = 0.005;         // half the step of a 2-decimal f.t
const TAU = Math.PI * 2;
const NONE = [];

function copy(dst, src) {
  const n = src.length;
  for (let i = 0; i < n; i++) dst[i] = src[i];
  dst.length = n;
  return dst;
}

/** Blends the unit vector at o[i], o[i + 1] from a to b and normalizes it; keeps b's when they cancel. */
function blendDir(o, i, a, b, k) {
  const x = a[i] + (b[i] - a[i]) * k, y = a[i + 1] + (b[i + 1] - a[i + 1]) * k;
  const l = Math.sqrt(x * x + y * y);
  if (l > 1e-4) {
    o[i] = x / l;
    o[i + 1] = y / l;
  }
}

/** One buffered game frame: the message, its (de-quantized) game time, raw f.t, arrival ms and f.fs. */
class Slot {
  constructor() {
    this.f = null;
    this.t = 0;
    this.raw = 0;
    this.at = 0;
    this.fs = -1;
    this.rep = 0; // times the game sent this moment again: twice or more, it is paused, so do not run on past it
  }

  set(f, t, raw, at, fs) {
    this.f = f;
    this.t = t;
    this.raw = raw;
    this.at = at;
    this.fs = fs;
    this.rep = 0;
  }
}

/**
 * Buffers Wire frames as they arrive (push) and returns, for any display time (sample), a frame of the
 * same shape with the hero, enemies, NPCs, loot and projectiles where they were at that moment.
 * The returned frame and its arrays are reused from call to call.
 */
export class FrameInterpolator {
  constructor() {
    this.buf = [];
    for (let i = 0; i < N; i++) this.buf.push(new Slot());
    this.head = 0;
    this.count = 0;
    this.restart = true;
    this.fine = false;      // f.t carries more than 2 decimals
    this.step = 1 / 60;     // game seconds per frame
    this.clock = 0;         // playback time in game seconds
    this.clockAt = 0;       // ms the clock was last advanced to
    this.speed = 1;
    this.err = 0;           // filtered playback lead error at arrivals, s
    this.jit = 0.003;       // mean deviation of that error: arrival jitter, s
    this.out = {};
    this.p = [];
    this.rows = { e: [], n: [], lo: [], pr: [] };
    this.pools = { e: [], n: [], lo: [], pr: [] };
    this.used = new Uint8Array(64);
    this.sa = null;
    this.sb = null;
    this.sk = NaN;
    this.last = null;
  }

  /** The next frame starts playback afresh, without blending from the frames before (a new level). */
  reset() {
    this.restart = true;
  }

  /** How far behind the newest frame playback aims to be when a frame arrives: one frame plus jitter room. */
  target() {
    return this.step + Math.min(0.03, Math.max(0.002, 2 * this.jit));
  }

  /** How far past newest frame s playback may run on before it holds, s. */
  ahead(s) {
    return s.rep > 1 ? 0 : Math.min(this.step, 0.034);
  }

  /** Buffers a game frame that arrived at `now` (ms, performance.now()). */
  push(f, now) {
    const raw = +f.t || 0;
    const fs = typeof f.fs === 'number' ? f.fs : -1;
    if (!this.fine && Math.abs(raw * 100 - Math.round(raw * 100)) > 1e-3) this.fine = true;
    const last = this.count ? this.buf[this.head] : null;
    if (!last || this.restart || now - last.at > STALL || raw < last.raw - 0.5 || (fs >= 0 && last.fs >= 0 && fs < last.fs)) {
      this.begin(f, raw, fs, now);
      return;
    }
    // Frames since the last one: from fs, else from the time (2-decimal times only below ~80 Hz,
    // where their rounding is under half a frame).
    let n = fs >= 0 && last.fs >= 0 ? fs - last.fs : 1;
    if (fs < 0 && (this.fine || this.step > COARSE * 2.5)) n = Math.max(1, Math.round((raw - last.t) / this.step));
    let t = raw;
    if (!this.fine) {
      // 2-decimal times: predict from the last frame and keep within the rounding of this one.
      const lp = last.f.p, p = f.p;
      if (n === 0 || (raw === last.raw && lp && p && lp[0] === p[0] && lp[1] === p[1])) t = last.t;
      else t = Math.min(raw + COARSE, Math.max(raw - COARSE, last.t + this.step * n));
    }
    if (n === 0 || t <= last.t + 1e-5) {
      // The same moment again (a repeat, or the game is paused): keep the newest content.
      last.f = f;
      last.at = now;
      last.rep++;
      return;
    }
    const d = (raw - last.raw) / n;
    if (d > 0.002 && d < 0.05) this.step += (d - this.step) * (this.fine ? 0.1 : 0.04);

    // Steer the clock so that frames arrive about target() ahead of it.
    const pa = Math.min(this.clock + (now - this.clockAt) * 0.001 * this.speed, last.t + this.ahead(last));
    const e = t - pa - this.target();
    if (e > RESYNC) {
      this.clock = t - this.target();
      this.clockAt = now;
      this.err = 0;
    } else {
      this.err += (e - this.err) * 0.08;
      this.jit += (Math.abs(e - this.err) - this.jit) * 0.05;
    }
    this.speed = 1 + Math.max(-SKEW, Math.min(SKEW, this.err * GAIN));

    this.head = (this.head + 1) % N;
    this.buf[this.head].set(f, t, raw, now, fs);
    if (this.count < N) this.count++;
  }

  begin(f, raw, fs, now) {
    for (const s of this.buf) s.f = null;
    this.buf[0].set(f, raw, raw, now, fs);
    this.head = 0;
    this.count = 1;
    this.restart = false;
    this.clock = raw - this.target();
    this.clockAt = now;
    this.err = 0;
    this.speed = 1;
  }

  /** The frame to show at display time `now` (ms); null until a frame has arrived. */
  sample(now) {
    if (!this.count) return this.last;
    const buf = this.buf, h = buf[this.head];
    if (now > this.clockAt) {
      this.clock += (now - this.clockAt) * 0.001 * this.speed;
      this.clockAt = now;
    }
    if (this.clock > h.t + this.ahead(h)) this.clock = h.t + this.ahead(h);
    const clock = this.clock;
    // The newest frame at or before the clock (a) and the one after it (b).
    let i = this.head, left = this.count, b = null;
    while (left > 1 && buf[i].t > clock) {
      b = buf[i];
      i = (i + N - 1) % N;
      left--;
    }
    let a = buf[i];
    if (!b) {
      // Past the newest frame: run on along the last motion for a moment, then hold.
      if (this.count < 2) return (this.last = h.f);
      b = h;
      a = buf[(this.head + N - 1) % N];
    } else if (a.t > clock) {
      return (this.last = a.f);
    }
    const span = b.t - a.t;
    let k = (clock - a.t) / span;
    if (k > 1) k = span < this.step * 0.5 ? 1 : Math.min(k, 2);
    if (a.f === this.sa && b.f === this.sb && k === this.sk) return (this.last = this.out);
    this.sa = a.f;
    this.sb = b.f;
    this.sk = k;
    return (this.last = this.blend(a.f, b.f, k, span, a.t + span * k));
  }

  /** Frame b with everything that moves placed a fraction k of the way from frame a. */
  blend(a, b, k, span, t) {
    const o = Object.assign(this.out, b);
    o.t = t;
    if (typeof a.cy === 'number' && typeof b.cy === 'number') {
      let d = b.cy - a.cy;
      d -= Math.round(d / TAU) * TAU;
      if (Math.abs(d) < 1.5) o.cy = a.cy + d * k;
    }
    const pa = a.p, pb = b.p;
    if (pa && pb) {
      const p = o.p = copy(this.p, pb);
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      if (dx * dx + dy * dy <= TELEPORT) {
        p[0] = pa[0] + dx * k;
        p[1] = pa[1] + dy * k;
        if (pb.length > 11) p[11] = pa[11] + (pb[11] - pa[11]) * k;
        blendDir(p, 2, pa, pb, k);
      }
    }
    const r = this.rows, q = this.pools;
    o.e = this.blendRows(r.e, q.e, a.e || NONE, b.e || NONE, k, 4, -1);
    o.n = this.blendRows(r.n, q.n, a.n || NONE, b.n || NONE, k, 4, -1);
    o.lo = this.blendRows(r.lo, q.lo, a.lo || NONE, b.lo || NONE, k, -1, 4);
    o.pr = this.blendShots(r.pr, q.pr, a.pr || NONE, b.pr || NONE, k, span);
    return o;
  }

  /** Rows keyed by uid at [0] with x, y at [2], [3], a facing at [fi] and a height at [zi] (-1: none). */
  blendRows(out, pool, a, b, k, fi, zi) {
    const n = b.length;
    let off = 0;
    for (let i = 0; i < n; i++) {
      const rb = b[i];
      const r = copy(pool[i] || (pool[i] = []), rb);
      const uid = rb[0];
      let ra = a[i + off];
      if (!ra || ra[0] !== uid) {
        ra = null;
        for (let j = 0; j < a.length; j++) {
          if (a[j][0] === uid) {
            ra = a[j];
            off = j - i;
            break;
          }
        }
      }
      if (ra) {
        const dx = rb[2] - ra[2], dy = rb[3] - ra[3];
        if (dx * dx + dy * dy <= TELEPORT) {
          // These rows also hold strings, so every new fraction is boxed: rewrite only what changed.
          if (dx !== 0) r[2] = ra[2] + dx * k;
          if (dy !== 0) r[3] = ra[3] + dy * k;
          if (zi >= 0 && ra[zi] !== rb[zi]) r[zi] = ra[zi] + (rb[zi] - ra[zi]) * k;
          if (fi >= 0 && (ra[fi] !== rb[fi] || ra[fi + 1] !== rb[fi + 1])) blendDir(r, fi, ra, rb, k);
        }
      }
      out[i] = r;
    }
    out.length = n;
    return out;
  }

  /** Projectiles have no uid: each one follows on from the older shot whose flight leads closest to it. */
  blendShots(out, pool, a, b, k, span) {
    const n = b.length, m = a.length;
    if (this.used.length < m) this.used = new Uint8Array(m * 2);
    const used = this.used;
    used.fill(0, 0, m);
    for (let i = 0; i < n; i++) {
      const rb = b[i];
      const r = copy(pool[i] || (pool[i] = []), rb);
      let best = -1, bd = SHOT;
      for (let j = 0; j < m; j++) {
        const ra = a[j];
        if (used[j] || ra[4] !== rb[4] || ra[6] !== rb[6]) continue;
        const dx = ra[0] + ra[2] * span - rb[0], dy = ra[1] + ra[3] * span - rb[1];
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best >= 0) {
        const ra = a[best];
        used[best] = 1;
        r[0] = ra[0] + (rb[0] - ra[0]) * k;
        r[1] = ra[1] + (rb[1] - ra[1]) * k;
      } else {
        // Fired since frame a: place it along its flight.
        r[0] = rb[0] - rb[2] * span * (1 - k);
        r[1] = rb[1] - rb[3] * span * (1 - k);
      }
      out[i] = r;
    }
    out.length = n;
    return out;
  }
}
