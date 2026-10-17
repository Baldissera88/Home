import * as THREE from 'three';
import { TILE } from './defs.js';

/** GLSL value noise shared by the ground and water shaders. */
export const NOISE_GLSL = /* glsl */`
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * The walkable ground: a height field (lakes dip into basins, the rest stays almost flat for the game's
 * flat physics) drawn with a splat shader that blends material textures by height, like the 2D baker.
 */
export class Ground {
  constructor(level, layers, opts) {
    this.level = level;
    this.w = level.w;
    this.h = level.h;
    this.res = 2; // height samples per tile
    this.layers = layers;
    this.opts = opts;
    this.heights = this.computeHeights();
  }

  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TILE.WALL;
    return this.level.tiles.charCodeAt(y * this.w + x) - 48;
  }

  computeHeights() {
    const { w, h, res } = this;
    const gw = w * res + 1, gh = h * res + 1;
    const water = new Float32Array(gw * gh);
    // Water fraction around each sample, blurred so shores slope gently.
    const r = 1.4;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x = gx / res, y = gy / res;
        let sum = 0, n = 0;
        for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++) {
          for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
            const dx = tx + 0.5 - x, dy = ty + 0.5 - y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r * r) continue;
            const wgt = 1 - d2 / (r * r);
            sum += (this.tile(tx, ty) === TILE.WATER ? 1 : 0) * wgt;
            n += wgt;
          }
        }
        water[gy * gw + gx] = n > 0 ? sum / n : 0;
      }
    }
    const heights = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      const k = Math.min(1, Math.max(0, (water[i] - 0.25) / 0.6));
      heights[i] = -0.62 * k * k * (3 - 2 * k);
    }
    this.gw = gw;
    this.gh = gh;
    return heights;
  }

  /** Ground height at a point in tiles (bilinear over the height field). */
  heightAt(x, y) {
    const { res, gw, gh } = this;
    const fx = Math.min(gw - 1.001, Math.max(0, x * res));
    const fy = Math.min(gh - 1.001, Math.max(0, y * res));
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const h = this.heights;
    const a = h[iy * gw + ix], b = h[iy * gw + ix + 1], c = h[(iy + 1) * gw + ix], d = h[(iy + 1) * gw + ix + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }

  materialTexture() {
    const { w, h } = this;
    const data = new Uint8Array(w * h * 4);
    const mat = this.level.mat;
    for (let i = 0; i < w * h; i++) data[i * 4] = mat.charCodeAt(i) - 48;
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /** Standard PBR material with the splat blend injected in place of the colour map and a height bump. */
  material(extra = {}) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
    const uniforms = {
      uMat: { value: this.materialTexture() },
      uLayers: { value: this.layers },
      uSize: { value: new THREE.Vector2(this.w, this.h) },
      uTexScale: { value: extra.texScale || 4.0 },
      uWaterLayer: { value: extra.waterLayer ?? 4.0 },
      uLayerCount: { value: extra.count || 7.0 },
      uHeightBlend: { value: 0.6 },
      uBump: { value: extra.bump ?? 1.6 },
      uMacro: { value: extra.macro ?? 0.22 },
      uTint: { value: new THREE.Color(extra.tint ?? 0xffffff) },
    };
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vGroundPos;
uniform sampler2D uMat;
uniform highp sampler2DArray uLayers;
uniform vec2 uSize;
uniform float uTexScale, uWaterLayer, uLayerCount, uHeightBlend, uBump, uMacro;
uniform vec3 uTint;
float splatH = 0.0;
${NOISE_GLSL}
float matAt(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uSize) - 1);
  float m = floor(texelFetch(uMat, c, 0).r * 255.0 + 0.5);
  return m >= uLayerCount ? uWaterLayer : m;
}
vec4 layerAt(float m, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(uLayers, vec3(uv, m), dx, dy); }
`)
        .replace('#include <map_fragment>', `
{
  vec2 tp = vGroundPos.xz;
  vec2 warp = vec2(tNoise(tp * 1.7), tNoise(tp * 1.7 + 31.7)) - 0.5;
  warp += (vec2(tNoise(tp * 4.1 + 7.3), tNoise(tp * 4.1 + 13.1)) - 0.5) * 0.4;
  vec2 s = tp + warp * 0.75 - 0.5;
  ivec2 i0 = ivec2(floor(s));
  vec2 f = fract(s);
  float m00 = matAt(i0), m10 = matAt(i0 + ivec2(1, 0)), m01 = matAt(i0 + ivec2(0, 1)), m11 = matAt(i0 + ivec2(1, 1));
  vec2 uv = tp / uTexScale;
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 c00 = layerAt(m00, uv, dx, dy);
  vec4 c10 = m10 == m00 ? c00 : layerAt(m10, uv, dx, dy);
  vec4 c01 = m01 == m00 ? c00 : (m01 == m10 ? c10 : layerAt(m01, uv, dx, dy));
  vec4 c11 = m11 == m00 ? c00 : (m11 == m10 ? c10 : (m11 == m01 ? c01 : layerAt(m11, uv, dx, dy)));
  float s00 = (1.0 - f.x) * (1.0 - f.y) + c00.a * uHeightBlend;
  float s10 = f.x * (1.0 - f.y) + c10.a * uHeightBlend;
  float s01 = (1.0 - f.x) * f.y + c01.a * uHeightBlend;
  float s11 = f.x * f.y + c11.a * uHeightBlend;
  float top = max(max(s00, s10), max(s01, s11)) - 0.1;
  vec4 b = max(vec4(s00, s10, s01, s11) - top, 0.0);
  vec4 col = (c00 * b.x + c10 * b.y + c01 * b.z + c11 * b.w) / max(b.x + b.y + b.z + b.w, 1e-4);
  splatH = col.a;
  float macro = 1.0 + (tNoise(tp * 0.13) + tNoise(tp * 0.37) * 0.5 - 0.75) * uMacro;
  diffuseColor.rgb *= col.rgb * macro * uTint;
}
`)
        .replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
{
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(splatH), dhdy = dFdy(splatH);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  normal = normalize(abs(det) * normal - grad * uBump * 0.02);
}
`);
    };
    return mat;
  }

  /** The playable area as a displaced mesh, plus a flat apron beyond the edges that fades into fog. */
  build(material) {
    const group = new THREE.Group();
    const { w, h, res, gw, gh } = this;
    const geo = new THREE.PlaneGeometry(w, h, w * res, h * res);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w / 2, 0, h / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = Math.round(pos.getX(i) * res), gy = Math.round(pos.getZ(i) * res);
      pos.setY(i, this.heights[Math.min(gh - 1, gy) * gw + Math.min(gw - 1, gx)]);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    if (this.opts.apron) {
      const pad = 70;
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(w + pad * 2, h + pad * 2, 1, 1), material);
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(w / 2, -0.015, h / 2);
      apron.receiveShadow = true;
      group.add(apron);
    }
    this.mesh = mesh;
    return group;
  }
}

/** Open water: deep colour, sky reflection by fresnel, drifting ripples and the sun's glitter. */
export function makeWater(w, h, assets) {
  const ripples = assets.texture('tex_water_ripples.png', false);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSky: { value: new THREE.Color(0.55, 0.7, 0.9) },
      uHorizon: { value: new THREE.Color(0.8, 0.85, 0.9) },
      uDeep: { value: new THREE.Color(0.015, 0.06, 0.075) },
      uShallow: { value: new THREE.Color(0.05, 0.16, 0.17) },
      uRipples: { value: ripples },
      uLight: { value: 1.0 },
    },
  ]);
  uniforms.uRipples.value = ripples;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLight;
      uniform vec3 uSun, uSunColor, uSky, uHorizon, uDeep, uShallow;
      uniform sampler2D uRipples;
      varying vec3 vPos;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      float waves(vec2 p) {
        return tNoise(p * 1.3 + vec2(uTime * 0.25, uTime * 0.13)) * 0.6 + tNoise(p * 3.1 - vec2(uTime * 0.31, -uTime * 0.2)) * 0.3
          + tNoise(p * 7.0 + vec2(uTime * 0.6, uTime * 0.4)) * 0.1;
      }
      void main() {
        vec2 p = vPos.xz;
        float e = 0.08;
        float hx = waves(p + vec2(e, 0.0)) - waves(p - vec2(e, 0.0));
        float hz = waves(p + vec2(0.0, e)) - waves(p - vec2(0.0, e));
        vec3 n = normalize(vec3(-hx * 1.6, 1.0, -hz * 1.6));
        vec3 v = normalize(cameraPosition - vPos);
        float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uHorizon, uSky, clamp(r.y * 1.5, 0.0, 1.0)) * uLight;
        vec3 base = mix(uDeep, uShallow, 0.5 + 0.5 * tNoise(p * 0.3)) * (0.35 + 0.65 * uLight);
        float rip = texture2D(uRipples, p * 0.22 + vec2(uTime * 0.03, uTime * 0.017)).a * texture2D(uRipples, p * 0.3 - vec2(uTime * 0.021, -uTime * 0.026)).a;
        vec3 col = mix(base, sky, 0.18 + 0.75 * fres) + rip * 0.35 * uLight;
        float spec = pow(max(dot(r, normalize(uSun)), 0.0), 220.0);
        col += uSunColor * spec * 3.0 * uLight;
        gl_FragColor = vec4(col, 0.82 + 0.18 * fres);
        #include <fog_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(w + 140, h + 140, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(w / 2, -0.17, h / 2);
  mesh.renderOrder = 2;
  return mesh;
}
