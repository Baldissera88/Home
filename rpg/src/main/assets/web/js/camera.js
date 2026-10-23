import * as THREE from 'three';
import { OUTDOOR, TILE } from './defs.js';

const HEAD = 1.05; // Look-at height above the hero's feet.
const WALL_TOP = 1.9; // World.buildWalls' wall height.
const DESERT_TOP = 2.6; // About where the desert's ridges top out near open ground.
const WALL_CODE = 48 + TILE.WALL; // '0' in level.tiles.
const PITCH_UP = 0.28; // Most the pitch rises to keep the camera out of wall mass...
const PULL_IN = 0.28; // ...and the share of the distance it gives up.
const STEPS = 12; // Resolution of the wall clearance search,
const AHEAD = 0.25; // which also looks this many seconds ahead.
const LEAD_TIME = 0.16; // Seconds of running the view looks ahead,
const LEAD_MAX = 0.8; // capped to this many units,
const LEAD_IN = 3; // building up this slowly
const LEAD_OUT = 6; // and letting go this quickly.
const LOOK_W = 12; // Spring rates of the look-at point
const PIVOT_W = 10; // and of the orbit pivot.
const KICK = 5; // FOV degrees added while dodging, charging and leaping.
const SHAKE_UNIT = 0.15; // Game.kt sends each shake axis as a random share of 0.15 * shake.
const TAU = Math.PI * 2;

/**
 * Critically damped spring. Each step solves the motion exactly for a goal that moved in a straight line
 * from its previous value over dt, so the result is the same however the frame times fall (no jitter at
 * constant speed with uneven dt) and it is stable for any dt. Trailing a goal at constant speed u it lags
 * 2u/w behind and never overshoots a goal that moves one way. match (0..1) also feeds in that share of
 * the goal's velocity: at 0.5 the lag halves to u/w and a sudden stop still settles without overshoot.
 */
class Spring {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
    this.g = x;
  }

  reset(x) {
    this.x = this.g = x;
    this.v = 0;
    return x;
  }

  /** ramp false treats the goal as a step (for frame times that are not real intervals). */
  step(goal, w, dt, ramp, match = 0) {
    const u = ramp ? (goal - this.g) / dt : 0;
    const lag = 2 * u * (1 - match) / w;
    const d = this.x - (ramp ? this.g : goal) + lag, dv = this.v - u;
    this.g = goal;
    const j = dv + w * d, e = Math.exp(-w * dt);
    this.x = goal - lag + (d + j * dt) * e;
    this.v = u + (dv - w * j * dt) * e;
    return this.x;
  }
}

/** Smooth noise in about [-1, 1]: incommensurate sines, slow enough to stay smooth at 30 fps. */
function wobble(t, seed) {
  return Math.sin(t * 33.3 + seed) * 0.5 + Math.sin(t * 55.9 + seed * 2.3) * 0.32 + Math.sin(t * 82.3 + seed * 3.7) * 0.18;
}

/**
 * Third-person chase camera. The game owns the yaw (so the joystick can turn with it); pitch and
 * distance come from pinch and vertical drags. Springs carry the look-at point and, a little slower,
 * the orbit pivot, so the view trails the hero smoothly and leans a little ahead of where they run.
 * In dungeons it rises and pulls in rather than sit in or low over the wall mass, and it never dips
 * below the ground. Dodges, charges and leaps widen the view a touch; hits shake it smoothly.
 */
export class ChaseCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 400);
    this.baseFov = 52;
    this.wantPitch = 0.5;
    this.wantDist = 6.4;
    this.yaw = new Spring(0);
    this.pitch = new Spring(0.5);
    this.dist = new Spring(6.4);
    // Look-at point and orbit pivot.
    this.tx = new Spring();
    this.ty = new Spring();
    this.tz = new Spring();
    this.px = new Spring();
    this.py = new Spring();
    this.pz = new Spring();
    this.leadX = new Spring();
    this.leadZ = new Spring();
    this.vx = 0;
    this.vz = 0;
    this.hx = 0;
    this.hz = 0;
    this.avoid = new Spring(); // 0..1: how far the camera has risen and pulled in to clear walls.
    this.lift = new Spring(); // Soft rise over bumps in the ground.
    this.kick = new Spring();
    this.shakeEnv = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.hard = 0;
    this.tiles = null;
    this.tw = 0;
    this.th = 0;
    this.wallTop = WALL_TOP;
    this.ready = false;
  }

  /** A landed hit: a quick nudge in toward the hero and a short shake, bigger for crits. */
  punch(s) {
    this.shakeEnv = Math.max(this.shakeEnv, s * 0.5);
    this.zoomKick = Math.max(this.zoomKick || 0, s);
  }

  setView(pitch, dist) {
    if (pitch != null) this.wantPitch = Math.max(0.18, Math.min(1.25, pitch));
    if (dist != null) this.wantDist = Math.max(3.2, Math.min(12, dist));
  }

  /**
   * The tile grid walls are kept out of: where WALL tiles are solid mass, in dungeons and the desert's
   * rock ridges (taller, hence wallTop), not the overworld's village palisade.
   */
  setLevel(level) {
    const solid = level && typeof level.tiles === 'string' && (!OUTDOOR.has(level.biome) || level.biome === 'DESERT');
    this.tiles = solid ? level.tiles : null;
    this.tw = solid ? level.w : 0;
    this.th = solid ? level.h : 0;
    this.wallTop = level && level.biome === 'DESERT' ? DESERT_TOP : WALL_TOP;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    // Keep the horizontal view wide enough on tall portrait screens.
    this.baseFov = aspect < 1 ? 66 : 52;
    this.camera.fov = this.baseFov + this.kick.x;
    this.camera.updateProjectionMatrix();
  }

  wall(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.tw || tz >= this.th) return true;
    return this.tiles.charCodeAt(tz * this.tw + tx) === WALL_CODE;
  }

  /** Whether a box of half-size r around the point reaches into a wall block (plus margin above it). */
  inWall(x, y, z, r, margin) {
    if (y >= this.wallTop + margin) return false;
    return this.wall(x - r, z - r) || this.wall(x + r, z - r) || this.wall(x - r, z + r) || this.wall(x + r, z + r);
  }

  /**
   * How much of the camera's raise-and-pull-in (0..1) the wall mass asks for: the least that keeps the
   * camera clear of the blocks with some room to spare and not low over thick wall right behind it.
   * Walls between the camera and the hero are see-through (occlude.js), so they don't count. Also sets
   * this.hard, the least that just keeps the lens out of the walls.
   */
  clearance(px, py, pz, sy, cy, pitch, dist) {
    this.hard = 1;
    for (let i = 0; i <= STEPS; i++) {
      const k = i / STEPS;
      const pt = Math.min(1.35, pitch + k * PITCH_UP), d = dist * (1 - k * PULL_IN);
      const hd = Math.cos(pt) * d;
      const x = px + sy * hd, z = pz + cy * hd, y = py + Math.sin(pt) * d;
      if (this.hard === 1 && !this.inWall(x, y, z, 0.22, 0.2)) this.hard = k;
      // (The bigger box and margin only add to the small one: when this one is clear, so is that.)
      if (this.inWall(x, y, z, 0.45, 0.5)) continue;
      // Thick wall right behind and below a low camera fills the bottom of the view.
      const low = Math.min(1, Math.max(0, 1 - (y - this.wallTop - 0.5) / 2));
      if (low > 0) {
        let mass = 0;
        for (let s = 0; s < 5; s++) {
          const t = hd - s * 0.6;
          if (t > 0.8 && this.wall(px + sy * t, pz + cy * t)) mass += 0.2;
        }
        if (mass * low > 0.3) continue;
      }
      return k;
    }
    return 1;
  }

  update(f, dt, hero, ground) {
    const p = f.p;
    // Frame times the pacer clamped (stalls) are not real intervals: take the goals as steps then.
    const live = dt > 1e-4, ramp = live && dt < 0.049;
    if (!live) dt = 1e-4;
    const leap = p.length > 11 ? p[11] : 0;
    const gx = hero.x, gz = hero.z, gy = hero.y - leap * 0.6 + HEAD;
    // Teleports (stairs, respawn) cut instead of sweeping across the map.
    const dx = gx - this.hx, dz = gz - this.hz;
    const snap = !this.ready || dx * dx + dz * dz > 36;
    if (snap) {
      this.yaw.reset(f.cy || 0);
      this.pitch.reset(this.wantPitch);
      this.dist.reset(this.wantDist);
      this.tx.reset(gx); this.ty.reset(gy); this.tz.reset(gz);
      this.px.reset(gx); this.py.reset(gy); this.pz.reset(gz);
      this.leadX.reset(0); this.leadZ.reset(0);
      this.lift.reset(0);
      this.kick.reset(0);
      this.vx = this.vz = 0;
      this.hx = gx;
      this.hz = gz;
      this.shakeEnv = this.shake = 0;
    }

    // Yaw: fast enough to feel attached to the drag (~65 ms behind a steady turn), smooth between drag steps.
    const yg = this.yaw.g, cyw = typeof f.cy === 'number' ? f.cy : yg;
    const yaw = this.yaw.step(yg + (cyw - yg) - Math.round((cyw - yg) / TAU) * TAU, 30, dt, ramp);
    const pitch = this.pitch.step(this.wantPitch, 9, dt, ramp);
    const dist = this.dist.step(this.wantDist, 7, dt, ramp);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);

    // Look ahead of the hero's measured motion: mostly into the screen, less sideways (that swims), less
    // when running at the camera, and only once actually running.
    if (live) {
      this.vx = (gx - this.hx) / dt;
      this.vz = (gz - this.hz) / dt;
    }
    this.hx = gx;
    this.hz = gz;
    const speed = Math.hypot(this.vx, this.vz);
    const run = Math.min(1, Math.max(0, (speed - 1) / 1.5)) * LEAD_TIME;
    let fwd = -(this.vx * sy + this.vz * cy) * run, side = (this.vx * cy - this.vz * sy) * run * 0.5;
    if (fwd < 0) fwd *= 0.6;
    const len = Math.hypot(fwd, side);
    if (len > LEAD_MAX) { fwd *= LEAD_MAX / len; side *= LEAD_MAX / len; }
    const lgx = cy * side - sy * fwd, lgz = -sy * side - cy * fwd;
    // It builds up slowly, so brief turns and lunges don't sway the view, and lets go quickly on a stop.
    const lw = lgx * lgx + lgz * lgz < this.leadX.x * this.leadX.x + this.leadZ.x * this.leadZ.x ? LEAD_OUT : LEAD_IN;
    const lx = this.leadX.step(lgx, lw, dt, ramp);
    const lz = this.leadZ.step(lgz, lw, dt, ramp);

    // The look-at point keeps close to the hero; the pivot the camera orbits trails a little more.
    const tx = this.tx.step(gx + lx, LOOK_W, dt, ramp, 0.5), tz = this.tz.step(gz + lz, LOOK_W, dt, ramp, 0.5);
    const ty = this.ty.step(gy, 10, dt, ramp);
    const px = this.px.step(gx + lx, PIVOT_W, dt, ramp), pz = this.pz.step(gz + lz, PIVOT_W, dt, ramp);
    const py = this.py.step(gy, 7, dt, ramp);

    // Walls: rise and pull in quickly when the camera nears the wall mass (or swings towards it), ease back
    // out slowly.
    let avoid = 0;
    if (this.tiles) {
      // Where the camera is heading a quarter second on, so the rise starts in time.
      const ay = yaw + Math.max(-0.8, Math.min(0.8, this.yaw.v * AHEAD));
      let need = this.clearance(px + this.px.v * AHEAD, py, pz + this.pz.v * AHEAD, Math.sin(ay), Math.cos(ay),
        Math.max(0.18, pitch + this.pitch.v * AHEAD), Math.max(3.2, dist + this.dist.v * AHEAD));
      need = Math.max(need, this.clearance(px, py, pz, sy, cy, pitch, dist));
      if (snap) this.avoid.reset(need);
      avoid = this.avoid.step(need, need > this.avoid.x ? 14 : 2.6, dt, ramp);
      if (avoid < this.hard) avoid = this.avoid.x = this.hard;
      if (avoid > 1) avoid = this.avoid.x = 1;
    } else {
      this.avoid.reset(0);
    }
    this.ready = true;
    this.zoomKick = Math.max(0, (this.zoomKick || 0) - dt * 7);
    const pt = Math.min(1.35, pitch + avoid * PITCH_UP), d = dist * (1 - avoid * PULL_IN) * (1 - 0.06 * this.zoomKick);
    const hd = Math.cos(pt) * d;
    let x = px + sy * hd, z = pz + cy * hd, y = py + Math.sin(pt) * d;

    // Smooth shake: the game's random per-frame offsets only give its strength (a peak hold that decays
    // like Game.kt's shake); the motion itself is smooth noise in offset and roll.
    const sh = f.sh;
    const amp = sh ? Math.max(Math.abs(sh[0] || 0), Math.abs(sh[1] || 0)) / SHAKE_UNIT : 0;
    this.shakeEnv = Math.max(Math.min(1.2, amp), this.shakeEnv - dt * 2.5);
    this.shake += (this.shakeEnv - this.shake) * (1 - Math.exp(-30 * dt));
    this.shakeT += dt;
    const q = this.shake * (0.35 + 0.65 * this.shake), t = this.shakeT;
    let roll = 0, ox = 0, oy = 0, lookX = 0, lookY = 0;
    if (q > 1e-3) {
      ox = q * 0.09 * wobble(t, 0);
      oy = q * 0.07 * wobble(t, 1.7);
      roll = q * 0.026 * wobble(t, 3.1);
      lookX = q * 0.05 * wobble(t, 4.4);
      lookY = q * 0.04 * wobble(t, 5.9);
      x += cy * ox;
      z -= sy * ox;
      y += oy;
    }

    // Last resort when the camera swings faster than the walls can be eased out of: sit just above them.
    if (this.tiles && this.inWall(x, y, z, 0.2, 0.15)) y = this.wallTop + 0.15;
    // Soft rise over bumps, then never below the ground + 0.6.
    const floor = ground(x, z) + 0.6;
    const want = Math.max(0, floor + 0.25 - y);
    y += this.lift.step(want, want > this.lift.x ? 14 : 4, dt, ramp);
    if (y < floor) y = floor;

    // A small FOV kick through dodges, charges and leaps.
    const act = p[4];
    const kg = act === 4 || act === 8 || act === 9 ? KICK : 0;
    const fov = this.baseFov + this.kick.step(kg, kg > this.kick.x ? 14 : 5, dt, ramp);
    const cam = this.camera;
    if (Math.abs(fov - cam.fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    cam.position.set(x, y, z);
    cam.lookAt(tx + cy * lookX, ty + lookY, tz - sy * lookX);
    if (roll !== 0) cam.rotateZ(roll);
  }
}
