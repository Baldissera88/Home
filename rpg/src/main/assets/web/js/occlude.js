import * as THREE from 'three';

/**
 * See-through walls and trees: fragments close to the line between the camera and the hero are
 * dithered away, so the hero never disappears behind scenery. Shadows are unaffected.
 */
export const OCCLUDE = {
  uHero: { value: new THREE.Vector3(0, -999, 0) },
  uCam: { value: new THREE.Vector3(0, -999, 0) },
};

/** stub >= 0 keeps the part of a wall below that height, so the floor plan stays readable. */
export function applyOcclusion(shader, radius = 1.0, stub = -1.0) {
  shader.uniforms.uHero = OCCLUDE.uHero;
  shader.uniforms.uCam = OCCLUDE.uCam;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vOccWp;')
    .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 occP = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      occP = instanceMatrix * occP;
    #endif
    vOccWp = (modelMatrix * occP).xyz;
  }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vOccWp;
uniform vec3 uHero, uCam;
float occBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  return (mod(i * 7.0 + floor(i / 4.0) * 3.0, 16.0) + 0.5) / 16.0;
}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  {
    vec3 ab = uHero - uCam;
    float tt = dot(vOccWp - uCam, ab) / max(dot(ab, ab), 0.001);
    float dd = length(vOccWp - (uCam + ab * clamp(tt, 0.0, 1.0)));
    float cut = (1.0 - smoothstep(${(radius * 0.5).toFixed(2)}, ${(radius * 1.25).toFixed(2)}, dd)) * smoothstep(0.97, 0.85, tt) * step(0.0, tt) * 0.92;
    if (cut > occBayer(gl_FragCoord.xy) && vOccWp.y > ${stub.toFixed(2)}) discard;
  }`);
}
