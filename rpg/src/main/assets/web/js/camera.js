import * as THREE from 'three';
import { angleDamp, damp } from './defs.js';

/**
 * Third-person chase camera. The game owns the yaw (so the joystick can turn with it); pitch and
 * distance come from pinch and vertical drags. The camera trails the hero smoothly, leans a little
 * ahead of where they run and never dips below the ground.
 */
export class ChaseCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 400);
    this.yaw = 0;
    this.pitch = 0.5;
    this.dist = 6.4;
    this.wantPitch = 0.5;
    this.wantDist = 6.4;
    this.target = new THREE.Vector3();
    this.lead = new THREE.Vector3();
    this.ready = false;
  }

  setView(pitch, dist) {
    if (pitch != null) this.wantPitch = Math.max(0.18, Math.min(1.25, pitch));
    if (dist != null) this.wantDist = Math.max(3.2, Math.min(12, dist));
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    // Keep the horizontal view wide enough on tall portrait screens.
    this.camera.fov = aspect < 1 ? 66 : 52;
    this.camera.updateProjectionMatrix();
  }

  update(f, dt, hero, ground) {
    const p = f.p;
    const head = 1.05;
    const vx = p[2] * Math.min(1, p[13] / 3), vz = p[3] * Math.min(1, p[13] / 3);
    if (!this.ready) {
      this.yaw = f.cy;
      this.target.set(hero.x, hero.y + head, hero.z);
      this.ready = true;
    }
    this.yaw = angleDamp(this.yaw, f.cy, 10, dt);
    this.pitch = damp(this.pitch, this.wantPitch, 8, dt);
    this.dist = damp(this.dist, this.wantDist, 6, dt);
    // Look a little ahead of the hero when running.
    this.lead.x = damp(this.lead.x, vx * 0.9, 3, dt);
    this.lead.z = damp(this.lead.z, vz * 0.9, 3, dt);
    const tx = hero.x + this.lead.x, tz = hero.z + this.lead.z;
    this.target.x = damp(this.target.x, tx, 12, dt);
    this.target.z = damp(this.target.z, tz, 12, dt);
    this.target.y = damp(this.target.y, hero.y + head, 8, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cam = this.camera;
    let x = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    let z = this.target.z + Math.cos(this.yaw) * cp * this.dist;
    let y = this.target.y + sp * this.dist;
    const floor = ground(x, z) + 0.6;
    if (y < floor) y = floor;
    // Screen shake from hits and explosions.
    const sh = f.sh || [0, 0];
    x += sh[0] * 0.6 * Math.cos(this.yaw);
    z -= sh[0] * 0.6 * Math.sin(this.yaw);
    y += sh[1] * 0.6;
    cam.position.set(x, y, z);
    cam.lookAt(this.target.x + sh[0] * 0.3, this.target.y, this.target.z);
  }
}
