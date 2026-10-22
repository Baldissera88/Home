import * as THREE from 'three';
import { E, EF, P } from './defs.js';

/**
 * The characters' look: a rim light and a little more colour on their materials, a soft contact shadow under
 * every visible actor and a pulsing ring under elites and bosses (all of them one instanced draw).
 */

/** Colour of the rim light on every character (shared by all their programs; set each frame by updateBlobs). */
export const rimColor = { value: new THREE.Color(0, 0, 0) };

// After the lights and emissive (so hit flashes and status tints stay as they were): lift the saturation a
// little, then add a soft bright edge where the surface turns away from the camera, strongest on top.
// Fog and transparency (ghosts, stealth) apply to it like to the rest of the surface.
const RIM_FS = `{
  float rimLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = max(mix(vec3(rimLum), outgoingLight, 1.14), 0.0);
  vec3 rimView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float rim = smoothstep(0.4, 1.0, 1.0 - saturate(dot(normal, rimView)));
  rim *= 0.45 + 0.55 * saturate(dot(normal, viewMatrix[1].xyz) + 0.45);
  outgoingLight += uRim * rim * (0.65 + 0.35 * diffuseColor.rgb);
}
#include <opaque_fragment>`;

function rimCompile(shader) {
  shader.uniforms.uRim = rimColor;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
    .replace('#include <opaque_fragment>', RIM_FS);
}

const rimKey = () => 'charRim';

/** Gives a character's own (cloned) material the rim light; every character shares the one program. */
export function enhanceCharacter(material) {
  if (!material.isMeshStandardMaterial) return material;
  material.onBeforeCompile = rimCompile;
  material.customProgramCacheKey = rimKey;
  return material;
}

/** Rim colours (linear, strength included): warm sun, cool moonlight, torchlight underground. */
const RIM_DAY = new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(0.4);
const RIM_NIGHT = new THREE.Color(0.38, 0.55, 1.0).multiplyScalar(0.42);
const RIM_TORCH = new THREE.Color(1.0, 0.55, 0.22).multiplyScalar(0.4);

/** Sets the rim colour for the place and the hour: the open world has no background colour (its sky is a dome). */
function setRim(scene, f) {
  const c = rimColor.value;
  if (scene.background) c.copy(RIM_TORCH);
  else c.copy(RIM_NIGHT).lerp(RIM_DAY, f.dl);
}

// Contact shadows: soft dark blobs under the actors, and rings under elites and bosses.
/** Height of the blobs above the ground (with a polygon offset against z-fighting). */
const BLOB_LIFT = 0.035;
/** How dark a blob is at its centre. */
const BLOB_DARK = 0.38;
/** Blob radius of a KayKit character at scale 1 (its body at CHAR_SCALE in actors.js). */
const FIGURE_R = 0.56, CHAR_SCALE = 0.52;
/** Beasts (creatures.js): blob radius and how high the body flies, at scale 1. */
const BEAST = { WOLF: [0.5, 0], SPIDER: [0.5, 0], SPIDER_QUEEN: [1.1, 0], BAT: [0.3, 1.0], SLIME: [0.38, 0] };
/** Ring colours (linear): gold for elites, ember red for bosses. */
const ELITE_RING = new THREE.Color(1.0, 0.72, 0.25);
const BOSS_RING = new THREE.Color(1.0, 0.22, 0.08);
/** Half the step used to find the ground's slope under a blob. */
const SLOPE_STEP = 0.3;

// Each copy carries aBlob: a blob is (0, 0, 0, darkness); a ring is (glow rgb, 2 + darkness). Blending is
// premultiplied (one, one - alpha), so blobs darken and rings glow in the same draw.
const BLOB_VS_HEAD = '#include <common>\nattribute vec4 aBlob;\nvarying vec4 vBlob;\nvarying vec2 vBlobUv;';
const BLOB_VS_BODY = '#include <begin_vertex>\nvBlob = aBlob;\nvBlobUv = position.xz;';
const BLOB_FS_HEAD = '#include <common>\nvarying vec4 vBlob;\nvarying vec2 vBlobUv;';
const BLOB_FS_BODY = `float blobR2 = dot(vBlobUv, vBlobUv);
  float blobG = max(1.0 - blobR2, 0.0);
  if (vBlob.w < 1.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, vBlob.w * blobG * (0.4 + 0.6 * blobG));
  } else {
    float blobR = sqrt(blobR2);
    float band = smoothstep(0.7, 0.86, blobR) * (1.0 - smoothstep(0.86, 1.0, blobR)) + 0.06 * blobG;
    gl_FragColor = vec4(vBlob.rgb * band, (vBlob.w - 2.0) * band);
  }`;
// Fog over premultiplied colour: the result fades to the fogged ground under it, as if drawn before the fog.
const BLOB_FOG = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor);
#endif`;

function blobCompile(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', BLOB_VS_HEAD)
    .replace('#include <begin_vertex>', BLOB_VS_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', BLOB_FS_HEAD)
    .replace('#include <opaque_fragment>', BLOB_FS_BODY)
    .replace('#include <fog_fragment>', BLOB_FOG);
}

const blobKey = () => 'charBlob';

/** The blobs and rings of one scene: a single InstancedMesh, refilled every frame and grown when needed. */
class Blobs {
  constructor(scene) {
    this.scene = scene;
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    mat.onBeforeCompile = blobCompile;
    mat.customProgramCacheKey = blobKey;
    this.material = mat;
    this.mesh = null;
    this.cap = 0;
    this.n = 0;
    this.ground = null;
    this.t = 0;
    this.alloc(48);
    // Bound once: no garbage per frame.
    this.addFolk = (a) => this.figure(a, 1);
  }

  alloc(cap) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const data = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    data.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBlob', data);
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = false;
    // Under ghosts, effects and water.
    mesh.renderOrder = -1;
    mesh.count = 0;
    if (this.mesh) {
      mesh.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
      data.array.set(this.data.array);
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
    this.scene.add(mesh);
    this.mesh = mesh;
    this.data = data;
    this.cap = cap;
  }

  /** One ground-aligned copy at (x, y, z) with slopes gx, gz, radius r, glow rgb and aBlob.w = w. */
  put(x, y, z, gx, gz, r, cr, cg, cb, w) {
    if (this.n === this.cap) this.alloc(this.cap * 2);
    const i = this.n++;
    const m = this.mesh.instanceMatrix.array, o = i * 16;
    m[o] = r; m[o + 1] = r * gx; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = r * gz; m[o + 10] = r; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const d = this.data.array, q = i * 4;
    d[q] = cr; d[q + 1] = cg; d[q + 2] = cb; d[q + 3] = w;
  }

  /**
   * The blob under an actor's root, radius r, darkness scaled by dim; `fly` is how high its body is above the root.
   * It grows and fades as the actor rises, and fades as a dead one sinks. rank (EF.ELITE / EF.BOSS) adds a ring.
   */
  blob(root, r, dim, fly, rank) {
    if (!root.visible) return;
    const ground = this.ground, p = root.position, x = p.x, z = p.z;
    const g = ground(x, z);
    const lift = p.y - g + fly;
    const a = BLOB_DARK * dim * (lift > 0 ? Math.max(0, 1 - lift * 0.4) : Math.max(0, 1 + lift * 2.5));
    if (a < 0.01) return;
    const s = SLOPE_STEP;
    const gx = clamp((ground(x + s, z) - ground(x - s, z)) / (2 * s), -0.8, 0.8);
    const gz = clamp((ground(x, z + s) - ground(x, z - s)) / (2 * s), -0.8, 0.8);
    const size = r * (1 + Math.max(0, lift) * 0.3);
    this.put(x, g + BLOB_LIFT, z, gx, gz, size, 0, 0, 0, a);
    if (!rank) return;
    const c = rank & EF.BOSS ? BOSS_RING : ELITE_RING;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3 + x * 0.7);
    const k = (rank & EF.BOSS ? 0.32 : 0.24) * (0.55 + 0.45 * pulse);
    this.put(x, g + BLOB_LIFT, z, gx, gz, size * 1.3 * (1 + 0.04 * pulse) + 0.1, c.r * k, c.g * k, c.b * k, 2 + 0.25 * k);
  }

  /** A KayKit character (hero, townsfolk, merchant). */
  figure(a, dim) {
    this.blob(a.root, FIGURE_R * a.body.scale.x * a.root.scale.x / CHAR_SCALE, dim, 0, 0);
  }

  /** A monster; rank flags only for the living. */
  monster(m, rank) {
    const s = m.root.scale.x;
    if (m.body) this.blob(m.root, FIGURE_R * m.body.scale.x * s / CHAR_SCALE, 1, 0, rank);
    else {
      const b = BEAST[m.type] || BEAST.SLIME;
      this.blob(m.root, b[0] * s, 1, b[1] * s, rank);
    }
  }

  /** Uploads this frame's copies. */
  end() {
    const mesh = this.mesh;
    mesh.count = this.n;
    mesh.visible = this.n > 0;
    if (!this.n) return;
    mesh.instanceMatrix.needsUpdate = true;
    this.data.needsUpdate = true;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

let blobs = null;

/**
 * Lays a contact shadow under every visible actor (rings under elites and bosses) and sets the rim light's colour.
 * Called at the end of Actors.update with the frame f; adds its mesh to actors.scene the first time.
 */
export function updateBlobs(actors, ground, f) {
  setRim(actors.scene, f);
  if (!blobs || blobs.scene !== actors.scene) blobs = new Blobs(actors.scene);
  const b = blobs;
  b.ground = ground;
  b.t = f.t;
  b.n = 0;
  // A stealthy hero is a shimmer: half a shadow.
  if (actors.hero) b.figure(actors.hero, f.p[P.FLAGS] & 1 ? 0.5 : 1);
  const list = f.e, enemies = actors.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const m = enemies.get(e[E.UID]);
    if (m) b.monster(m, e[E.FLAGS] & (EF.ELITE | EF.BOSS));
  }
  const dying = actors.dying;
  for (let i = 0; i < dying.length; i++) b.monster(dying[i], 0);
  actors.npcs.forEach(b.addFolk);
  if (actors.merchant) b.figure(actors.merchant, 1);
  b.end();
}
