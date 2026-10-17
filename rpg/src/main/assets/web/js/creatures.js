import * as THREE from 'three';

/**
 * Procedural beasts the character packs do not cover: wolves, spiders, bats and slimes.
 * Each returns { root, update(dt, moving, attack, speed) } with its own little rig.
 */

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, metalness: 0, ...opts });
}

function part(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function ellipsoid(rx, ry, rz, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(rx, ry, rz);
  return g;
}

export function wolf(fur = 0x6b6660) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const furMat = mat(fur);
  const dark = mat(new THREE.Color(fur).multiplyScalar(0.55));
  const light = mat(new THREE.Color(fur).lerp(new THREE.Color(0xd8d0c4), 0.5));
  part(ellipsoid(0.17, 0.17, 0.36), furMat, body, 0, 0.5, 0);
  part(ellipsoid(0.15, 0.15, 0.16), light, body, 0, 0.46, 0.2);
  const neck = new THREE.Group();
  neck.position.set(0, 0.58, 0.3);
  body.add(neck);
  part(ellipsoid(0.12, 0.12, 0.14), furMat, neck, 0, 0.04, 0.08);
  part(ellipsoid(0.06, 0.06, 0.13), light, neck, 0, 0.0, 0.22);
  part(ellipsoid(0.03, 0.025, 0.03), mat(0x111111), neck, 0, 0.03, 0.34);
  for (const s of [-1, 1]) {
    const ear = part(new THREE.ConeGeometry(0.04, 0.1, 6), dark, neck, 0.06 * s, 0.15, 0.06);
    ear.rotation.z = -0.25 * s;
    part(new THREE.SphereGeometry(0.018, 8, 6), mat(0xffb020, { emissive: 0x553300 }), neck, 0.05 * s, 0.07, 0.18);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.58, -0.34);
  body.add(tail);
  const tm = part(ellipsoid(0.05, 0.05, 0.2), dark, tail, 0, -0.05, -0.15);
  tm.rotation.x = 0.5;
  const legs = [];
  for (const [x, z] of [[-0.1, 0.24], [0.1, 0.24], [-0.1, -0.22], [0.1, -0.22]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.44, z);
    body.add(hip);
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.24, 6), furMat, hip, 0, -0.12, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.24, 0);
    hip.add(knee);
    part(new THREE.CylinderGeometry(0.025, 0.035, 0.2, 6), dark, knee, 0, -0.1, 0);
    legs.push({ hip, knee });
  }
  let phase = Math.random() * 6;
  return {
    root,
    height: 0.75,
    update(dt, moving, attack, speed) {
      phase += dt * (moving ? 9 * speed : 2);
      const amp = moving ? 0.55 : 0.02;
      legs.forEach((l, i) => {
        const p = phase + (i === 0 || i === 3 ? 0 : Math.PI);
        l.hip.rotation.x = Math.sin(p) * amp;
        l.knee.rotation.x = Math.max(0, -Math.cos(p)) * amp * 0.9;
      });
      body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.04 : Math.sin(phase * 0.5) * 0.01;
      neck.rotation.x = attack > 0 ? -0.5 * Math.sin(attack * Math.PI) : 0.05 * Math.sin(phase * 0.5);
      neck.position.z = 0.3 + (attack > 0 ? 0.12 * Math.sin(attack * Math.PI) : 0);
      tail.rotation.y = Math.sin(phase * (moving ? 1 : 0.7)) * 0.4;
    },
  };
}

export function spider(scale = 1, queen = false) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shell = mat(queen ? 0x2a0a10 : 0x1a1418, { roughness: 0.35, metalness: 0.2 });
  const hair = mat(queen ? 0x3a1018 : 0x241d20);
  part(ellipsoid(0.26, 0.21, 0.3), shell, body, 0, 0.36, -0.28);
  part(ellipsoid(0.16, 0.12, 0.18), shell, body, 0, 0.3, 0.1);
  const mark = part(ellipsoid(0.08, 0.02, 0.12, 1), mat(0xb3121a, { emissive: queen ? 0x550000 : 0x220000 }), body, 0, 0.56, -0.3);
  mark.rotation.x = -0.4;
  for (const s of [-1, 1]) {
    part(new THREE.SphereGeometry(0.03, 8, 6), mat(0xff2a1a, { emissive: 0xaa1100 }), body, 0.05 * s, 0.36, 0.25);
    part(new THREE.SphereGeometry(0.02, 8, 6), mat(0xff2a1a, { emissive: 0xaa1100 }), body, 0.1 * s, 0.38, 0.22);
  }
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const k = i % 4;
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0.3, 0.16 - k * 0.1);
    hip.rotation.y = side * (0.5 + k * 0.45) - (side > 0 ? 0 : Math.PI) + Math.PI / 2;
    body.add(hip);
    const upper = new THREE.Group();
    hip.add(upper);
    upper.rotation.z = 0.9;
    part(new THREE.CylinderGeometry(0.018, 0.026, 0.34, 5).translate(0, 0.17, 0), hair, upper);
    const lower = new THREE.Group();
    lower.position.y = 0.34;
    upper.add(lower);
    lower.rotation.z = -2.2;
    part(new THREE.CylinderGeometry(0.01, 0.018, 0.42, 5).translate(0, 0.21, 0), hair, lower);
    legs.push({ upper, lower, phase: (i % 2) * Math.PI + (i >= 4 ? Math.PI / 2 : 0) });
  }
  root.scale.setScalar(scale);
  let phase = Math.random() * 6;
  return {
    root,
    height: 0.6 * scale,
    update(dt, moving, attack, speed) {
      phase += dt * (moving ? 14 * speed : 1.5);
      for (const l of legs) {
        const p = phase + l.phase;
        l.upper.rotation.z = 0.9 + (moving ? Math.sin(p) * 0.25 : 0.03 * Math.sin(p));
        l.upper.rotation.x = moving ? Math.cos(p) * 0.25 : 0;
      }
      body.position.y = moving ? Math.abs(Math.sin(phase * 2)) * 0.02 : 0;
      body.rotation.x = attack > 0 ? -0.35 * Math.sin(attack * Math.PI) : 0;
    },
  };
}

export function bat() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.0;
  root.add(body);
  const fur = mat(0x2a1f2c);
  const skin = mat(0x4a2c48, { side: THREE.DoubleSide, roughness: 0.6 });
  part(ellipsoid(0.09, 0.1, 0.12), fur, body);
  part(ellipsoid(0.07, 0.07, 0.07), fur, body, 0, 0.05, 0.1);
  for (const s of [-1, 1]) {
    part(new THREE.ConeGeometry(0.025, 0.07, 5), fur, body, 0.04 * s, 0.13, 0.1);
    part(new THREE.SphereGeometry(0.015, 6, 6), mat(0xff3020, { emissive: 0xaa1100 }), body, 0.03 * s, 0.07, 0.16);
  }
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.06 * s, 0.02, 0);
    body.add(pivot);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.06);
    shape.lineTo(0.38, 0.12);
    shape.lineTo(0.32, -0.02);
    shape.lineTo(0.22, 0.02);
    shape.lineTo(0.16, -0.06);
    shape.lineTo(0.06, -0.02);
    shape.lineTo(0, -0.06);
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    if (s < 0) g.scale(-1, 1, 1);
    const w = part(g, skin, pivot);
    w.castShadow = true;
    wings.push({ pivot, s });
  }
  let phase = Math.random() * 6;
  return {
    root,
    height: 1.25,
    update(dt, moving, attack) {
      phase += dt * 18;
      for (const w of wings) w.pivot.rotation.z = Math.sin(phase) * 0.9 * w.s;
      body.position.y = 1.0 + Math.sin(phase * 0.25) * 0.08 - (attack > 0 ? 0.35 * Math.sin(attack * Math.PI) : 0);
    },
  };
}

export function slime(scale = 1) {
  const root = new THREE.Group();
  const jelly = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: 0x46d35a, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.78, emissive: 0x0b3a10 }),
  );
  jelly.geometry.translate(0, -0.08, 0);
  jelly.castShadow = true;
  root.add(jelly);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshBasicMaterial({ color: 0xc8ff8a }));
  core.position.y = 0.1;
  root.add(core);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a1a08 }));
    eye.position.set(0.09 * s, 0.17, 0.22);
    root.add(eye);
  }
  root.scale.setScalar(scale);
  let phase = Math.random() * 6;
  return {
    root,
    height: 0.45 * scale,
    update(dt, moving, attack) {
      phase += dt * (moving ? 8 : 3);
      const squash = 1 + Math.sin(phase) * (moving ? 0.12 : 0.05) + (attack > 0 ? 0.25 * Math.sin(attack * Math.PI) : 0);
      jelly.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      core.position.y = 0.1 * squash;
    },
  };
}
