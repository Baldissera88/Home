import * as THREE from 'three';
import { SKY_VS, SKY_FS, makeSkyNoise, Rain } from './sky.js';
import { PointBatch } from './fx.js';
import { hash, TILE } from './defs.js';

/**
 * Time of day, weather and light: a procedural sky with sun, moon, clouds and stars, the sun's
 * shadow-casting light, a hemisphere fill, fog, a pool of point lights for fires and magic,
 * an environment map for reflections, rain, fireflies and dust motes.
 */

// Sky palette (sRGB): clear day, overcast, dusk and moonlit night; rain streak colours.
const SKY = {
  zenith: new THREE.Color(0x2c62b4), zenithRain: new THREE.Color(0x4a5462), zenithDusk: new THREE.Color(0x2a3270), zenithNight: new THREE.Color(0x0b1a3c),
  horizon: new THREE.Color(0xaccae6), horizonRain: new THREE.Color(0x7a828c), horizonDusk: new THREE.Color(0xf29058), horizonNight: new THREE.Color(0x203c66),
  sun: new THREE.Color(0xfff2dc), sunDusk: new THREE.Color(0xff8a40), flash: new THREE.Color(0xa8b8e8),
  rainDay: new THREE.Color(0xb4bfcf), rainNight: new THREE.Color(0x3a4a66), white: new THREE.Color(0xffffff),
};
const _zenith = new THREE.Color(), _horizon = new THREE.Color(), _sunColor = new THREE.Color(), _fog = new THREE.Color(), _mote = new THREE.Color();

const DUNGEON = {
  CRYPT: { fog: 0x0a0c12, fogDensity: 0.06, hemiSky: 0x5a6680, hemiGround: 0x1a1612, hemi: 0.8, key: 0x8090b0, keyI: 0.5, lantern: 0xffc488 },
  CAVE: { fog: 0x0c0a07, fogDensity: 0.05, hemiSky: 0x7a7060, hemiGround: 0x2a2018, hemi: 1.1, key: 0xb0a088, keyI: 0.7, lantern: 0xffc080 },
  HELL: { fog: 0x1a0602, fogDensity: 0.055, hemiSky: 0x803020, hemiGround: 0x200804, hemi: 0.7, key: 0xff7040, keyI: 0.45, lantern: 0xffa070 },
};

// The sun's shadow box (placeShadow) covers the ground the chase camera sees, out to fog or SHADOW_REACH
// times the preset's shadowSpan ahead of the hero, plus receivers from SHADOW_LOW below the hero's feet to
// SHADOW_HIGH above them. Its half sizes move in SHADOW_STEP steps, with a step of slack before shrinking,
// so camera springs and shake do not keep resizing (and re-rasterising) it.
const SHADOW_REACH = 1.4, SHADOW_LOW = 2, SHADOW_HIGH = 3, SHADOW_STEP = 0.5;
// Static casters smaller than this (bounding radius) give no shadow worth a draw in the shadow pass.
const SHADOW_MIN_RADIUS = 0.3;
// Point light pool (assignLights): fade times in seconds, how much a source that holds a light is favoured
// (its score is multiplied by this) and how far an effect's light may move in a frame and still be the same.
const LIGHT_IN = 0.25, LIGHT_OUT = 0.35, LIGHT_OUT_BUSY = 0.12, LIGHT_KEEP = 0.6, LIGHT_TRACK = 2.5;
// The reflection map's cube size: the sky is soft and most materials rough, so 64 texels a face do.
const ENV_SIZE = 64;
const _fwd = new THREE.Vector3(), _box = new THREE.Box3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _back = new THREE.Vector3();
const _envA = new THREE.Color(), _envB = new THREE.Color();

/**
 * Live uniforms of the patched fog (installFog), shared by every material: plain objects and a typed array,
 * which three's uniform cloning passes on by reference, so one write per frame reaches every program.
 * fogRay turns (gl_FragCoord.xy, 1) into the world-space view ray per unit of view depth; fogSun is the
 * world direction toward the sun with the in-scattering strength in w, fogSunColor its colour; fogHeight is
 * (height below which the fog is densest, thinning per unit above it, share of the density that thins).
 */
const FOG = {
  fogRay: { value: new Float32Array(9) },
  fogSun: { value: { x: 0, y: 1, z: 0, w: 0 } },
  fogSunColor: { value: { x: 1, y: 0.85, z: 0.6 } },
  fogHeight: { value: { x: 0, y: 0, z: 0 } },
};

/**
 * Fog with height and light: thinner above the ground the hero walks on (tree crowns and wall tops stand out
 * of the haze, low ground keeps it) and, under open sky, brighter and sun-coloured toward the sun. A
 * material without these uniforms (a custom shader not built from UniformsLib.fog) gets three's plain fog.
 */
const FOG_FRAGMENT = `
#ifdef USE_FOG
	vec3 fogView = fogRay * vec3( gl_FragCoord.xy, 1.0 );
	float fogThin = 1.0 - fogHeight.z + fogHeight.z * exp( - max( cameraPosition.y + fogView.y * vFogDepth - fogHeight.x, 0.0 ) * fogHeight.y );
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * fogThin );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ) * fogThin;
	#endif
	float fogSunAmt = fogSun.w * pow( max( dot( fogView, fogSun.xyz ) * inversesqrt( dot( fogView, fogView ) + 1e-8 ), 0.0 ), 5.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunColor * fogSunAmt, fogFactor );
#endif
`;

let fogInstalled = false;
function installFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  Object.assign(THREE.UniformsLib.fog, FOG);
  for (const k in THREE.ShaderLib) {
    const u = THREE.ShaderLib[k].uniforms;
    if (u && u.fogColor) Object.assign(u, FOG);
  }
  THREE.ShaderChunk.fog_pars_fragment += `
#ifdef USE_FOG
	uniform mat3 fogRay;
	uniform vec4 fogSun;
	uniform vec3 fogSunColor, fogHeight;
#endif
`;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
}

// Contact-hardening sun shadows (high preset): a blocker search on a rotated 6-tap disk finds how far the
// occluder is above the receiver, which sizes a 12-tap rotated Vogel-disk filter from one texel (at the feet)
// to PCSS_MAX texels (under a tall tree), with the depth of each tap moved along the receiver's plane so
// the wider filter brings no acne. Lit pixels stop after the search, so it costs less than PCFSoft there.
// The light's angular size comes in as the shadow's `radius` (texels per unit of shadow depth, placeShadow).
const PCSS_MAX = 6;
const vogel = (n, turn) => Array.from({ length: n }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.3999632 + turn;
  return `vec2(${(r * Math.cos(a)).toFixed(4)}, ${(r * Math.sin(a)).toFixed(4)})`;
}).join(', ');
const PCSS = `
	const vec2 PCSS_SEARCH[6] = vec2[6](${vogel(6, 0.9)});
	const vec2 PCSS_TAPS[12] = vec2[12](${vogel(12, 0.0)});
	float pcssShadow( sampler2D map, vec2 size, float spread, vec3 c, vec2 plane ) {
		vec2 texel = 1.0 / size;
		float a = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		mat2 rot = mat2( cos( a ), sin( a ), - sin( a ), cos( a ) );
		float sum = 0.0, count = 0.0;
		for ( int i = 0; i < 6; i ++ ) {
			vec2 off = rot * PCSS_SEARCH[ i ] * ( ${PCSS_MAX.toFixed(1)} * texel );
			float d = unpackRGBAToDepth( texture2D( map, c.xy + off ) );
			if ( d < c.z + clamp( dot( plane, off ), - 0.006, 0.006 ) ) { sum += d; count += 1.0; }
		}
		if ( count < 0.5 ) return 1.0;
		float pen = clamp( 1.0 + ( c.z - sum / count ) * spread, 1.0, ${PCSS_MAX.toFixed(1)} );
		float lit = 0.0;
		for ( int i = 0; i < 12; i ++ ) {
			vec2 off = rot * PCSS_TAPS[ i ] * ( pen * texel );
			lit += step( c.z + clamp( dot( plane, off ), - 0.006, 0.006 ), unpackRGBAToDepth( texture2D( map, c.xy + off ) ) );
		}
		return lit * ( 1.0 / 12.0 );
	}
`;

let shadowsInstalled = false;
/** Swaps PCFSoft's filter for the contact-hardening one in every lit shader compiled from now on. */
function installSoftShadows() {
  if (shadowsInstalled) return;
  let s = THREE.ShaderChunk.shadowmap_pars_fragment;
  const head = '\tfloat getShadow( sampler2D shadowMap,';
  const bias = 'shadowCoord.z += shadowBias;';
  const soft = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )';
  const next = '#elif defined( SHADOWMAP_TYPE_VSM )';
  const h = s.indexOf(head), b = s.indexOf(bias, h), a = s.indexOf(soft, b), e = s.indexOf(next, a);
  if (h < 0 || b < 0 || a < 0 || e < 0) return; // three changed: keep its filter
  shadowsInstalled = true;
  // The receiver plane's depth slope over the shadow map, taken before any branch (derivatives need all
  // pixels of a quad): the depth a tap at offset `off` should be compared with is z + dot(plane, off).
  const plane = `${bias}
		vec3 sdx = dFdx( shadowCoord.xyz ), sdy = dFdy( shadowCoord.xyz );
		float sdet = sdx.x * sdy.y - sdx.y * sdy.x;
		vec2 plane = abs( sdet ) > 1e-12 ? vec2( sdy.y * sdx.z - sdx.y * sdy.z, sdx.x * sdy.z - sdy.x * sdx.z ) / sdet : vec2( 0.0 );`;
  s = s.slice(0, h) + PCSS + s.slice(h, b) + plane + s.slice(b + bias.length, a)
    + `${soft}\n\t\t\tshadow = pcssShadow( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz, plane );\n\t\t`
    + s.slice(e);
  THREE.ShaderChunk.shadowmap_pars_fragment = s;
}

/** Sun's angular radius for the soft shadow filter (tangent): about twice the real sun's, for a softer look. */
const SUN_TAN = 0.012;

/** Dungeon reflections and ambient: a room, not a colour. Dark vault above, torch-lit walls around (with a
 * few hot spots), dim floor below; rendered into the reflection cube and prefiltered like the sky. */
const ROOM_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ROOM_FS = `
uniform vec3 uCeil, uWall, uFloor, uTorch;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(uWall, uCeil, smoothstep(0.15, 0.85, d.y));
  c = mix(c, uFloor, 1.0 - smoothstep(-0.55, -0.05, d.y));
  float az = atan(d.z, d.x);
  float spots = pow(max(0.0, cos(az * 2.5 + 0.7)), 16.0) * (1.0 - smoothstep(0.0, 0.35, abs(d.y - 0.15)));
  gl_FragColor = vec4(c + uTorch * spots, 1.0);
}`;

// Contact occlusion baked into the ground for presets without screen-space occlusion (bakeContact): texels
// per tile, the radii (texels) of the tight and the broad blur and how dark full occlusion gets.
const CONTACT_RES = 4, CONTACT_TIGHT = 2, CONTACT_BROAD = 5, CONTACT_DARK = 0.62;

/** Two box blurs of radius r (about a Gaussian) over a w x h field, in place; tmp is scratch of the same size. */
function blur2(a, tmp, w, h, r) {
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / (2 * r + 1);
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

export class Atmosphere {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // Before anything compiles: the fog with height and sun, and on high the soft shadow filter.
    installFog();
    if (quality.softShadows) installSoftShadows();
    this.soft = shadowsInstalled;
    /** Golden hour (0..1) and night (0..1) under open sky, for the grade; 0 underground. */
    this.dusk = 0;
    this.night = 0;
    /** The grade's reflection intensity and fog scattering and haze (setLook). */
    this.envIntensity = 0.5;
    this.scatter = 0;
    this.haze = 0;
    this.vw = this.vh = 1;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const size = quality.shadowMap;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    this.shadowSpan = quality.shadowSpan;
    cam.left = -this.shadowSpan; cam.right = this.shadowSpan; cam.top = this.shadowSpan; cam.bottom = -this.shadowSpan;
    cam.near = 1; cam.far = 80;
    this.shadowX = this.shadowY = 0; // the fitted box's half width and height, in light space (placeShadow)
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4030, 0.8);
    scene.add(this.hemi);

    // Point lights for fires and magic. Each keeps its source while that is chosen and fades in and out;
    // `slots` holds what it shows (copied, as effect lights are reused records), `cands` and `pick` are
    // assignLights' scratch, reused frame to frame.
    this.pool = [];
    this.slots = [];
    for (let i = 0; i < quality.pointLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      scene.add(l);
      this.pool.push(l);
      this.slots.push({ src: null, fx: false, on: false, level: 0, x: 0, y: 0, z: 0, color: 0xffffff, radius: 5, intensity: 0, flicker: false });
    }
    this.cands = [];
    this.pick = new Array(this.pool.length).fill(0);
    this.lightT = 0;
    this.lightSnap = true;
    // The hero carries a soft light below ground; useful in dark dungeons.
    this.lantern = new THREE.PointLight(0xffc488, 0, 7, 1.4);
    scene.add(this.lantern);

    this.skyUniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCloud: { value: 0 },
      uRain: { value: 0 },
      uFog: { value: new THREE.Color() },
      uHaze: { value: 8 },
      uFlash: { value: 0 },
      uNoise: { value: makeSkyNoise() },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    }));
    this.sky.frustumCulled = false;
    // Drawn after all opaque geometry, so the depth test skips every pixel the scene already covers.
    this.sky.renderOrder = 1000;
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.envKey = -1;

    this.fog = new THREE.FogExp2(0x000000, 0.02);
    scene.fog = this.fog;

    this.motes = new PointBatch(THREE.AdditiveBlending, { value: 600 });
    this.motes.points.renderOrder = 6;
    scene.add(this.motes.points);
    this.rain = this.makeRain();
    scene.add(this.rain.group);
    this.moonDir = new THREE.Vector3();
    this.sunDir = new THREE.Vector3();
    this.flash = 0;
  }

  makeRain() {
    // Splashes land on the ground, or on the water where a lake dips below it.
    this.rainGround = (x, z) => {
      const w = this.world;
      const g = w ? w.heightAt(x, z) : 0;
      return w && w.water ? Math.max(g, w.water.position.y) : g;
    };
    return new Rain(this.motes.mat.uniforms.uScale);
  }

  setPointScale(v) { this.motes.mat.uniforms.uScale.value = v; }

  /** Size of the target the scene is drawn into (device pixels), for the fog's view rays. */
  setViewport(w, h) {
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
  }

  /** Takes the biome grade's reflection intensity, fog scattering and haze (post.js GRADE, blended). */
  setLook(g) {
    this.envIntensity = g.env;
    this.scatter = g.scatter;
    this.haze = g.haze;
    if (this.scene.environment) this.scene.environmentIntensity = g.env;
  }

  /**
   * Points the shared fog uniforms at this frame: view rays from the camera, the sun and its scattering
   * (open sky only), and the height above which the fog thins (a little over the hero's feet).
   */
  updateFog(focus, camera, sunColor) {
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements, p = camera.projectionMatrix.elements;
    _right.set(m[0], m[1], m[2]);
    _up.set(m[4], m[5], m[6]);
    _back.set(m[8], m[9], m[10]);
    const sx = 2 / (this.vw * p[0]), sy = 2 / (this.vh * p[5]);
    const ox = (p[8] - 1) / p[0], oy = (p[9] - 1) / p[5];
    const r = FOG.fogRay.value;
    r[0] = _right.x * sx; r[1] = _right.y * sx; r[2] = _right.z * sx;
    r[3] = _up.x * sy; r[4] = _up.y * sy; r[5] = _up.z * sy;
    r[6] = _right.x * ox + _up.x * oy - _back.x; r[7] = _right.y * ox + _up.y * oy - _back.y; r[8] = _right.z * ox + _up.z * oy - _back.z;
    const sun = FOG.fogSun.value, dir = this.keyDir || _up.set(0, 1, 0);
    sun.x = dir.x; sun.y = dir.y; sun.z = dir.z;
    sun.w = this.outdoors ? this.scatter * Math.min(1, Math.max(0, dir.y * 4 + 0.2)) : 0;
    if (sunColor) {
      const c = FOG.fogSunColor.value;
      c.x = sunColor.r * 0.55; c.y = sunColor.g * 0.55; c.z = sunColor.b * 0.55;
    }
    const h = FOG.fogHeight.value;
    h.x = focus.y + 0.5;
    h.y = 0.55;
    h.z = this.haze;
  }

  /**
   * Contact occlusion for presets without screen-space occlusion: where walls, rocks, trees, buildings and
   * props stand, blurred at a tight and a broad radius into a small texture over the level, which the
   * ground's shader multiplies into its ambient light (and a little of the direct), so floors darken into
   * the corners and around what stands on them. Call before the level's shaders compile.
   */
  bakeContact(world) {
    const lv = world.level, R = CONTACT_RES, W = lv.w * R, H = lv.h * R;
    let mat = null;
    world.group.traverse((o) => {
      const m = o.material;
      if (!mat && o.isMesh && m && !Array.isArray(m) && m.userData.uniforms && m.userData.uniforms.uSplat0) mat = m;
    });
    if (!mat || !W || !H) return;
    const occ = new Float32Array(W * H);
    const disc = (cx, cy, rad, v) => {
      const x0 = Math.max(0, Math.floor((cx - rad) * R)), x1 = Math.min(W - 1, Math.ceil((cx + rad) * R));
      const y0 = Math.max(0, Math.floor((cy - rad) * R)), y1 = Math.min(H - 1, Math.ceil((cy + rad) * R));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5) / R - cx, dy = (y + 0.5) / R - cy;
          if (dx * dx + dy * dy <= rad * rad) occ[y * W + x] = Math.max(occ[y * W + x], v);
        }
      }
    };
    const rect = (x0, y0, x1, y1, v) => {
      for (let y = Math.max(0, Math.floor(y0 * R)); y < Math.min(H, Math.ceil(y1 * R)); y++) {
        for (let x = Math.max(0, Math.floor(x0 * R)); x < Math.min(W, Math.ceil(x1 * R)); x++) occ[y * W + x] = Math.max(occ[y * W + x], v);
      }
    };
    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const t = world.tile(x, y);
        if (t === TILE.WALL) rect(x, y, x + 1, y + 1, 1);
        else if (t === TILE.TREE) { rect(x, y, x + 1, y + 1, 0.3); disc(x + 0.5, y + 0.5, 0.32, 0.85); }
        else if (t === TILE.ROCK) disc(x + 0.5, y + 0.5, 0.45, 0.9);
        else if (t === TILE.BLOCK) disc(x + 0.5, y + 0.5, 0.4, 0.8);
      }
    }
    if (lv.bld) for (const [sprite, bx, by, bw, bh] of lv.bld) {
      if (sprite === 6) disc(bx + bw / 2, by + bh / 2, 0.15, 0.8);
      else rect(bx + 0.15, by + 0.15, bx + bw - 0.15, by + bh - 0.15, 1);
    }
    for (const p of world.props || []) {
      const o = p.obj;
      if (o && o.position) disc(o.position.x, o.position.z, 0.32, 0.7);
    }
    const tight = Float32Array.from(occ), tmp = new Float32Array(W * H);
    blur2(tight, tmp, W, H, CONTACT_TIGHT);
    blur2(occ, tmp, W, H, CONTACT_BROAD);
    const data = new Uint8Array(W * H);
    for (let i = 0; i < data.length; i++) {
      const o = Math.min(1, 0.55 * tight[i] + 0.45 * occ[i]);
      data[i] = Math.round(255 * (1 - CONTACT_DARK * o * (2 - o)));
    }
    if (this.contactTex) this.contactTex.dispose();
    const tex = this.contactTex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const size = new THREE.Vector2(lv.w, lv.h);
    const base = mat.onBeforeCompile, key = mat.customProgramCacheKey();
    mat.onBeforeCompile = (shader, renderer) => {
      base.call(mat, shader, renderer);
      shader.uniforms.uContact = { value: tex };
      shader.uniforms.uContactSize = { value: size };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uContact;\nuniform vec2 uContactSize;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    float contact = texture2D(uContact, vGroundPos.xz / uContactSize).r;
    reflectedLight.indirectDiffuse *= contact;
    reflectedLight.indirectSpecular *= contact;
    reflectedLight.directDiffuse *= mix(1.0, contact, 0.45);
  }`);
    };
    mat.customProgramCacheKey = () => key + '-contact';
    mat.needsUpdate = true;
  }

  /** Switches between the open world and the underground look. */
  setLevel(world) {
    this.world = world;
    this.outdoors = world.outdoors;
    this.biome = world.biome;
    if (this.outdoors) {
      this.scene.add(this.sky);
      this.scene.background = null;
    } else {
      this.scene.remove(this.sky);
      const d = DUNGEON[this.biome] || DUNGEON.CRYPT;
      this.scene.background = new THREE.Color(d.fog);
      this.updateEnvironment(true);
    }
    this.envKey = -1;
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.slots[i];
      s.src = null; s.fx = false; s.on = false; s.level = 0;
      this.pool[i].intensity = 0;
    }
    this.lightSnap = true; // a new level starts with its lights already lit
    this.shadowX = this.shadowY = 0;
    this.trimShadows(world);
  }

  /**
   * Stops the shadow pass drawing what casts no shadow worth its draw: small props and flat, decal-like
   * pieces (floors, rugs, the tops of walls, whose faces the shadow pass culls anyway) and see-through
   * ones. Flora keeps its own casters, and actors are not part of the level.
   */
  trimShadows(world) {
    const flora = world.flora && world.flora.group;
    const visit = (o) => {
      if (o === flora) return;
      if (o.isMesh && o.castShadow && !o.isInstancedMesh && !o.isSkinnedMesh) {
        const g = o.geometry, m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        o.updateWorldMatrix(true, false);
        _box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
        const small = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() < SHADOW_MIN_RADIUS;
        const flat = _box.max.y - _box.min.y < 0.02;
        if (small || flat || (m && (m.transparent || !m.depthWrite || m.polygonOffset))) o.castShadow = false;
      }
      for (let i = 0; i < o.children.length; i++) visit(o.children[i]);
    };
    visit(world.group);
  }

  /**
   * Re-renders the reflection map from the sky (or, underground, a generated torch-lit room) when the light
   * has changed enough to notice: into a small cube, then prefiltered into the same target every time, so a
   * refresh neither allocates nor draws the sky at full size. Its intensity is the biome grade's (setLook).
   */
  updateEnvironment(dungeon) {
    if (!this.envCube) {
      this.envCube = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType });
      this.envCam = new THREE.CubeCamera(0.1, 100, this.envCube);
      this.envRoom = new THREE.Scene();
      this.roomUniforms = { uCeil: { value: new THREE.Color() }, uWall: { value: new THREE.Color() }, uFloor: { value: new THREE.Color() }, uTorch: { value: new THREE.Color() } };
      const room = new THREE.Mesh(this.sky.geometry, new THREE.ShaderMaterial({
        uniforms: this.roomUniforms, vertexShader: ROOM_VS, fragmentShader: ROOM_FS, side: THREE.BackSide, depthWrite: false, fog: false,
      }));
      room.scale.setScalar(50);
      this.envRoom.add(room);
    }
    if (dungeon) {
      const d = DUNGEON[this.biome] || DUNGEON.CRYPT, u = this.roomUniforms;
      // Linear colours: a vault lost in the fog, walls in the lantern's and torches' light, a dim floor.
      u.uCeil.value.setHex(d.fog).multiplyScalar(0.6);
      u.uWall.value.setHex(d.lantern).multiplyScalar(0.12).add(_envA.setHex(d.hemiSky).multiplyScalar(0.08));
      u.uFloor.value.setHex(d.hemiGround).multiplyScalar(0.25);
      u.uTorch.value.setHex(d.lantern).multiplyScalar(0.9);
      this.envCam.update(this.renderer, this.envRoom);
    } else {
      this.envSky.scale.setScalar(50);
      this.envCam.update(this.renderer, this.envScene);
    }
    this.scene.environmentIntensity = this.envIntensity;
    this.envTarget = this.pmrem.fromCubemap(this.envCube.texture, this.envTarget);
    this.scene.environment = this.envTarget.texture;
  }

  update(f, dt, t, focus, camera, fx) {
    if (fx) fx.particleLight.value = this.outdoors ? 0.35 + 0.65 * f.dl : 0.45;
    if (this.outdoors) this.updateOutdoors(f, t, focus);
    else this.updateDungeon(f, t, focus);
    this.updateFog(focus, camera, this.outdoors ? this.sun.color : null);
    this.placeShadow(focus, camera);
    this.assignLights(f, t, focus, fx);
    this.updateRain(f, dt, focus, camera);
    this.updateMotes(f, t, focus);
  }

  updateOutdoors(f, t, focus) {
    const phase = t * Math.PI * 2 / 360;
    const day = f.dl;
    const rain = f.rn;
    // The sun climbs to 62 degrees at noon and sets in the west; at night the moon takes over.
    const elev = Math.asin(Math.max(-1, Math.min(1, Math.cos(phase)))) * 0.69;
    const az = phase + 0.6;
    const sun = this.sunDir.set(-Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev) * 0.9 + 0.35).normalize();
    const moon = this.moonDir.set(-sun.x, Math.abs(sun.y) * 0.9 + 0.25, -sun.z).normalize();
    const night = THREE.MathUtils.smoothstep(-sun.y, -0.05, 0.2);
    const dusk = Math.max(0, 1 - Math.abs(sun.y) / 0.32);
    const flash = this.flash = this.lightning(t, rain);

    // Clear blue, overcast grey, a warm dusk and a deep moonlit blue; fog is the horizon's colour.
    const warm = dusk * (1 - night) * (1 - rain);
    this.dusk = warm;
    this.night = night;
    const zenith = _zenith.copy(SKY.zenith).lerp(SKY.zenithRain, rain).lerp(SKY.zenithDusk, warm * 0.6).lerp(SKY.zenithNight, night);
    const horizon = _horizon.copy(SKY.horizon).lerp(SKY.horizonRain, rain).lerp(SKY.horizonDusk, warm * 0.75).lerp(SKY.horizonNight, night);
    zenith.multiplyScalar(1 - 0.3 * rain * night);
    horizon.multiplyScalar(1 - 0.3 * rain * night);
    const sunColor = _sunColor.copy(SKY.sun).lerp(SKY.sunDusk, dusk);
    const fogCol = _fog.copy(horizon).lerp(zenith, 0.15).lerp(SKY.flash, flash * 0.3);
    // The sky draws the moon lower than its light comes from, where the chase camera can see it.
    const me = Math.min(Math.asin(moon.y), 0.2), mh = Math.cos(me) / (Math.hypot(moon.x, moon.z) || 1);
    const u = this.skyUniforms;
    u.uSun.value.copy(sun);
    u.uMoon.value.set(moon.x * mh, Math.sin(me), moon.z * mh);
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uGround.value.copy(horizon).multiplyScalar(0.6);
    u.uSunColor.value.copy(sunColor);
    u.uTime.value = t;
    u.uNight.value = night;
    u.uCloud.value = Math.min(1, 0.15 + rain * 0.9);
    u.uRain.value = rain;
    u.uFlash.value = flash;

    // Key light: the sun by day, a cold moon at night.
    const lightDir = night > 0.5 ? moon : sun;
    this.keyDir = lightDir;
    const sunI = (1 - night) * Math.min(1, Math.max(0, sun.y) * 4) * (1 - rain * 0.65);
    const moonI = night * 1.1;
    if (night > 0.5) this.sun.color.setHex(0x8aa4e0); else this.sun.color.copy(sunColor);
    this.sun.intensity = night > 0.5 ? moonI : 3.0 * sunI + 0.05;
    this.hemi.color.copy(zenith).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.setHex(0x5a4a36).lerp(new THREE.Color(0x1a2232), night);
    this.hemi.intensity = 0.8 + 0.5 * day - 0.15 * rain + flash * 2.5;

    this.fog.color.copy(fogCol);
    this.fog.density = 0.012 + f.fg * 0.09 + rain * 0.012 + night * 0.012;
    // The sky's horizon haze is the fog colour exactly, in a band that widens with the fog.
    u.uFog.value.copy(fogCol);
    u.uHaze.value = 1 / (0.05 + this.fog.density * 4);
    this.lantern.intensity = night * 3.5;
    this.lantern.color.setHex(0xffc488);
    this.lantern.position.set(focus.x, focus.y + 2.2, focus.z);

    if (this.world && this.world.water) {
      const w = this.world.water.material.uniforms;
      w.uSun.value.copy(lightDir);
      w.uSunColor.value.copy(this.sun.color).multiplyScalar(night > 0.5 ? 0.5 : 1);
      w.uSky.value.copy(zenith);
      w.uHorizon.value.copy(horizon);
      w.uLight.value = 0.25 + 0.75 * day;
    }
    // Refresh reflections as the light changes over the day.
    const key = Math.round(day * 12) + Math.round(rain * 4) * 100;
    if (key !== this.envKey) {
      this.envKey = key;
      this.updateEnvironment(false);
    }
  }

  updateDungeon(f, t, focus) {
    const d = DUNGEON[this.biome] || DUNGEON.CRYPT;
    this.dusk = this.night = 0;
    this.keyDir = (this.keyDir0 ||= new THREE.Vector3(0.35, 1, 0.55).normalize());
    this.sun.color.setHex(d.key);
    this.sun.intensity = d.keyI;
    this.hemi.color.setHex(d.hemiSky);
    this.hemi.groundColor.setHex(d.hemiGround);
    this.hemi.intensity = d.hemi;
    this.fog.color.setHex(d.fog);
    this.fog.density = d.fogDensity + f.fg * 0.05;
    this.lantern.color.setHex(d.lantern);
    this.lantern.intensity = 5;
    this.lantern.distance = 10;
    this.lantern.position.set(focus.x, focus.y + 2.4, focus.z + 0.4);
  }

  /**
   * Fits the sun's shadow box to the ground the chase camera sees: from the bottom of the screen, just
   * behind the hero, to where fog (or the preset's reach) takes over ahead. The circle around that patch
   * gives the box's width whichever way the camera turns, and its height in light space is the circle
   * foreshortened by the light's slant, plus the height of what receives shadows. The box is centred on
   * the circle and snapped to whole shadow texels in light space, so edges do not crawl as it follows.
   */
  placeShadow(focus, camera) {
    const dir = this.keyDir, shadow = this.sun.shadow, cam = shadow.camera;
    camera.getWorldDirection(_fwd);
    const pitch = Math.asin(Math.max(-0.99, Math.min(0.99, -_fwd.y)));
    _fwd.y = 0;
    _fwd.normalize();
    const p = camera.position;
    const h = Math.max(0.5, p.y - focus.y); // camera height over the hero's feet
    const back = (focus.x - p.x) * _fwd.x + (focus.z - p.z) * _fwd.z; // and how far behind the hero it is
    const half = camera.fov * Math.PI / 360, wide = Math.tan(half) * camera.aspect;
    // Ground distances (from the camera) at the bottom and top edges of the screen; a receiver standing
    // up is seen nearer, hence the margin behind.
    const lo = pitch + half, hi = pitch - half;
    const dNear = lo < Math.PI - 0.01 ? h * Math.cos(lo) / Math.sin(lo) : -h;
    const ahead = Math.min(this.shadowSpan * SHADOW_REACH, Math.max(10, 1.25 / this.fog.density - back));
    const dFar = Math.min(hi > 0.02 ? h * Math.cos(hi) / Math.sin(hi) : Infinity, back + ahead);
    const zn = Math.min(dNear - back - 1.2, 0), zf = Math.max(dFar - back, 4);
    // Half widths there, from the depth along the view axis, plus a margin for the corners.
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const wn = Math.max(0, (zn + back) * cp + h * sp) * wide + 1, wf = Math.max(0, (zf + back) * cp + h * sp) * wide + 1;
    // The smallest circle around that trapezoid: centred on its axis, between its middle and far edge.
    const c = Math.min(zf, Math.max((zn + zf) / 2, (wf * wf - wn * wn + zf * zf - zn * zn) / (2 * (zf - zn))));
    const r = Math.max(Math.hypot(wf, zf - c), Math.hypot(wn, c - zn));
    // Light space: x is level across the light, y climbs towards it, foreshortening the ground.
    const sinE = Math.max(0.05, dir.y), cosE = Math.sqrt(1 - sinE * sinE);
    const ry = r * sinE + (SHADOW_LOW + SHADOW_HIGH) / 2 * cosE;
    if (r > this.shadowX || r < this.shadowX - 2 * SHADOW_STEP || ry > this.shadowY || ry < this.shadowY - 2 * SHADOW_STEP) {
      this.shadowX = Math.ceil(r / SHADOW_STEP) * SHADOW_STEP;
      this.shadowY = Math.ceil(ry / SHADOW_STEP) * SHADOW_STEP;
      cam.left = -this.shadowX; cam.right = this.shadowX; cam.top = this.shadowY; cam.bottom = -this.shadowY;
      cam.updateProjectionMatrix();
    }
    // Snap the centre to the texel grid along the light's x and y axes (as the shadow camera's lookAt
    // builds them); moving along those keeps every texel where it was.
    const lh = Math.max(1e-4, Math.hypot(dir.x, dir.z));
    const ax = dir.z / lh, az = -dir.x / lh; // x = up × dir
    const bx = -dir.x * dir.y / lh, by = lh, bz = -dir.z * dir.y / lh; // y = dir × x
    const tx = 2 * this.shadowX / shadow.mapSize.x, ty = 2 * this.shadowY / shadow.mapSize.y;
    const cx = focus.x + _fwd.x * c, cy = focus.y + (SHADOW_HIGH - SHADOW_LOW) / 2, cz = focus.z + _fwd.z * c;
    const u = cx * ax + cz * az, v = cx * bx + cy * by + cz * bz;
    const du = Math.round(u / tx) * tx - u, dv = Math.round(v / ty) * ty - v;
    const sx = cx + ax * du + bx * dv, sy = cy + by * dv, sz = cz + az * du + bz * dv;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + dir.x * 40, sy + dir.y * 40, sz + dir.z * 40);
    this.sun.target.updateMatrixWorld();
    // A normal offset of about two and a half texels clears acne under the soft filter at a low sun, and is
    // still thin beside the chunky characters, so their feet stay on their shadows. The contact-hardening
    // filter compares along the receiver's plane, so it needs less (and gets its light size as `radius`:
    // penumbra texels per unit of shadow depth).
    shadow.normalBias = Math.min(0.05, Math.max(this.soft ? 0.012 : 0.02, (this.soft ? 1.5 : 2.5) * Math.max(tx, ty)));
    if (this.soft) shadow.radius = (cam.far - cam.near) * SUN_TAN / (0.5 * (tx + ty));
  }

  /**
   * Gives the pool's point lights to the brightest light sources near the hero. A source keeps its light
   * while it stays chosen (and is favoured, so near ties do not swap), lights fade in and out instead of
   * popping, and a newly chosen source takes a light once one has faded out.
   */
  assignLights(f, t, focus, fx) {
    const dt = Math.min(0.1, Math.max(0, t - this.lightT));
    this.lightT = t;
    const slots = this.slots, ns = slots.length, cands = this.cands, pick = this.pick;
    if (!ns) return;
    for (let i = 0; i < ns; i++) slots[i].on = false;
    let n = 0;
    if (this.world) for (let i = 0, ls = this.world.lights; i < ls.length; i++) n = this.consider(ls[i], false, focus, n);
    if (fx) for (let i = 0, ls = fx.lights; i < ls.length; i++) n = this.consider(ls[i], true, focus, n);
    // The best `ns` by score, in order.
    let np = 0;
    for (let i = 0; i < n; i++) {
      const s = cands[i].score;
      if (np === ns && !(s < cands[pick[np - 1]].score)) continue;
      let j = np < ns ? np++ : ns - 1;
      for (; j > 0 && cands[pick[j - 1]].score > s; j--) pick[j] = pick[j - 1];
      pick[j] = i;
    }
    // Chosen sources keep their lights, then the rest take lights that have faded out.
    let waiting = 0;
    for (let k = 0; k < np; k++) if (cands[pick[k]].slot >= 0) slots[cands[pick[k]].slot].on = true;
    for (let k = 0; k < np; k++) {
      const c = cands[pick[k]];
      let i = c.slot;
      if (i < 0) {
        for (i = 0; i < ns; i++) if (!slots[i].on && slots[i].level === 0) break;
        if (i === ns) { waiting++; continue; }
      }
      // Copy what to show: effect records are reused, and a light fades out where its source was last.
      const s = slots[i], l = c.l;
      s.on = true;
      s.src = c.fx ? null : l;
      s.fx = c.fx;
      s.x = l.x; s.y = l.y; s.z = l.z;
      s.color = l.color;
      s.radius = l.radius || 5;
      s.intensity = l.intensity || 1;
      s.flicker = !!l.flicker;
    }
    const dayDim = this.outdoors ? 1 - 0.75 * f.dl : 1;
    const up = dt / LIGHT_IN, down = dt / (waiting ? LIGHT_OUT_BUSY : LIGHT_OUT);
    for (let i = 0; i < ns; i++) {
      const s = slots[i], pl = this.pool[i];
      s.level = this.lightSnap ? (s.on ? 1 : 0) : s.on ? Math.min(1, s.level + up) : Math.max(0, s.level - down);
      if (s.level === 0) {
        if (!s.on) { s.src = null; s.fx = false; }
        pl.intensity = 0;
        continue;
      }
      let k = 1, jx = 0, jy = 0, jz = 0;
      if (s.flicker) {
        // A flame: a slow breath, a quicker waver and fast licks, now and then a gutter; the light wanders
        // a few centimetres with it, so the shading under it moves like firelight.
        const ph = (s.x * 3.7 + s.z * 1.3) % 10;
        const gutter = Math.max(0, Math.sin(t * 1.3 + ph * 2.1)) ** 12;
        k = 0.84 + 0.07 * Math.sin(t * 7.3 + ph) + 0.05 * Math.sin(t * 17.9 + ph * 2.3) + 0.04 * Math.sin(t * 31.7 + ph * 4.1) - 0.18 * gutter;
        jx = 0.035 * Math.sin(t * 11.1 + ph * 1.7);
        jy = 0.025 * Math.sin(t * 13.7 + ph * 2.9);
        jz = 0.035 * Math.sin(t * 9.7 + ph * 3.3);
      }
      if (pl.userData.color !== s.color) { pl.userData.color = s.color; pl.color.setHex(s.color); }
      pl.position.set(s.x + jx, s.y + jy, s.z + jz);
      // Inverse-square falloff (with three's smooth cut-off at `distance`): hot near the flame, a soft pool
      // farther out; brighter at the source than the old 1.5 decay so the pool keeps its size.
      pl.distance = s.radius * 1.7;
      pl.decay = 2;
      pl.intensity = s.intensity * 4.4 * k * dayDim * s.level * s.level * (3 - 2 * s.level);
    }
    this.lightSnap = false;
  }

  /**
   * Adds light source `l` to the candidates (as the n-th) if it is near enough to matter, and returns the
   * new count. Finds the pool light it already holds: a level light by identity, an effect's light by
   * colour and place, as its record may be another one next frame.
   */
  consider(l, isFx, focus, n) {
    const dx = l.x - focus.x, dz = l.z - focus.z;
    const d2 = dx * dx + dz * dz;
    const reach = (l.radius || 5) + 9;
    if (d2 > reach * reach) return n;
    const slots = this.slots;
    let slot = -1;
    if (isFx) {
      let best = LIGHT_TRACK * LIGHT_TRACK;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.fx || s.color !== l.color) continue;
        const ex = s.x - l.x, ey = s.y - l.y, ez = s.z - l.z, e2 = ex * ex + ey * ey + ez * ez;
        if (e2 < best && !this.claimed(i, n)) { best = e2; slot = i; }
      }
    } else {
      for (let i = 0; i < slots.length; i++) if (slots[i].src === l) { slot = i; break; }
    }
    let c = this.cands[n];
    if (!c) c = this.cands[n] = { l: null, fx: false, slot: -1, score: 0 };
    c.l = l;
    c.fx = isFx;
    c.slot = slot;
    c.score = d2 / ((l.intensity || 1) * (l.minor ? 0.4 : 1)) * (slot >= 0 ? LIGHT_KEEP : 1);
    return n + 1;
  }

  /** Whether one of the first n candidates already tracks pool light i. */
  claimed(i, n) {
    for (let k = 0; k < n; k++) if (this.cands[k].slot === i) return true;
    return false;
  }

  /** A rare double flash of lightning in heavy rain; 0 almost all the time. */
  lightning(t, rain) {
    if (rain < 0.7) return 0;
    const win = Math.floor(t / 8);
    if (hash(win, 31) > (rain - 0.7) * 1.6) return 0;
    const s = t - win * 8 - 1 - hash(win, 32) * 5;
    if (s < 0 || s > 1.2) return 0;
    return Math.exp(-s * 12) + (s > 0.18 ? 0.75 * Math.exp(-(s - 0.18) * 8) : 0);
  }

  updateRain(f, dt, focus, camera) {
    const r = this.outdoors ? f.rn : 0;
    // Streaks catch the daylight; at night they turn faint and blue, and lightning shows them all.
    if (r > 0.03) this.rain.uniforms.uColor.value.copy(SKY.rainNight).lerp(SKY.rainDay, f.dl).lerp(SKY.white, Math.min(1, this.flash) * 0.5);
    this.rain.update(r, dt, focus, camera, this.rainGround);
  }

  updateMotes(f, t, focus) {
    const m = this.motes;
    m.begin();
    const c = _mote;
    if (this.outdoors) {
      // Fireflies after dusk.
      const night = 1 - f.dl;
      if (night > 0.45 && f.rn < 0.3) {
        c.setHex(0xc8ff60);
        for (let i = 0; i < 40; i++) {
          const ph = t * 0.3 + hash(i, 9) * 10;
          const x = focus.x + (hash(i, 1) - 0.5) * 22 + Math.sin(ph * 1.3) * 0.8;
          const z = focus.z + (hash(i, 2) - 0.5) * 22 + Math.cos(ph) * 0.8;
          const blink = Math.max(0, Math.sin(t * 2 + i * 1.7));
          m.add(x, focus.y + 0.4 + hash(i, 3) * 1.2 + Math.sin(ph * 2) * 0.2, z, c.r, c.g, c.b, blink * (night - 0.45) * 1.8, 0.14, 1);
        }
      }
    } else {
      // Dust hanging in the torchlight.
      c.setHex(this.biome === 'HELL' ? 0xff9a50 : 0xd8c8a8);
      for (let i = 0; i < 70; i++) {
        const ph = t * 0.08 + hash(i, 9) * 10;
        const x = focus.x + (((hash(i, 1) * 18 + Math.sin(ph) * 0.6) % 18) - 9);
        const z = focus.z + (((hash(i, 2) * 18 + Math.cos(ph * 0.7) * 0.6) % 18) - 9);
        const y = focus.y + ((hash(i, 3) * 2.4 + t * 0.05 * (this.biome === 'HELL' ? 4 : 1)) % 2.4);
        m.add(x, y, z, c.r, c.g, c.b, 0.25 + 0.2 * Math.sin(t + i), this.biome === 'HELL' ? 0.06 : 0.035, 1);
      }
    }
    m.end();
  }
}
