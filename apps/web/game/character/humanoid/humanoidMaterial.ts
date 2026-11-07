import * as THREE from "three";
import type { CharacterUniforms } from "../characterMaterial";

/**
 * Per-instance copy of a realistic character material, extended with the same effects as the
 * procedural character (see characterMaterial.ts):
 * - fresnel rim in the ally / enemy colour so people read through busy scenes,
 * - a faint team-coloured sheen,
 * - noise dissolve with a glowing edge when defeated.
 * Textures and geometry stay shared; only the material object and uniforms are per character.
 */
export function createHumanoidMaterial(base: THREE.Material, uniforms: CharacterUniforms, noiseScale: number): THREE.MeshStandardMaterial {
  const mat = (base as THREE.MeshStandardMaterial).clone();
  const extra = { uNoiseScale: { value: noiseScale } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uNoiseScale;
        varying vec3 vObjPos;`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
        vObjPos = transformed * uNoiseScale;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uTeamColor;
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uGlow;
        uniform float uDissolve;
        varying vec3 vObjPos;
        float dHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float dNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>
        float dn = dNoise(vObjPos * 9.0) * 0.7 + dNoise(vObjPos * 23.0) * 0.3;
        if (uDissolve > 0.0 && dn < uDissolve) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uTeamColor * 0.035 * uGlow;
        if (uDissolve > 0.0) {
          float edge = 1.0 - smoothstep(0.0, 0.08, dn - uDissolve);
          totalEmissiveRadiance += vec3(0.4, 2.4, 3.2) * edge * 3.0;
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          vec3 viewDir = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normal, viewDir)), 0.0, 1.0), 2.5);
          outgoingLight += uRimColor * fres * uRimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  // Separate program cache key from plain materials and from the procedural character.
  mat.customProgramCacheKey = () => "paradox-humanoid-v1";
  return mat;
}
