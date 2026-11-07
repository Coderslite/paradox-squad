import * as THREE from "three";

/** Uniforms each character instance can drive. */
export interface CharacterUniforms {
  uTeamColor: { value: THREE.Color };
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uGlow: { value: number };
  uDissolve: { value: number };
}

/**
 * MeshStandardMaterial extended with:
 * - `aTeam` vertex mask: those vertices take the team colour (armour accents),
 * - `aGlow` vertex mask: emissive in the team colour (visor, light strips),
 * - fresnel rim in an arbitrary colour (ally / enemy outline that reads through busy scenes),
 * - noise dissolve with a glowing edge (defeated players dissolve into time particles).
 */
export function createCharacterMaterial(): THREE.MeshStandardMaterial & { userData: { uniforms: CharacterUniforms } } {
  const uniforms: CharacterUniforms = {
    uTeamColor: { value: new THREE.Color(0x4f8cff) },
    uRimColor: { value: new THREE.Color(0x000000) },
    uRimStrength: { value: 0 },
    uGlow: { value: 1.3 },
    uDissolve: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aTeam;
        attribute float aGlow;
        varying float vTeam;
        varying float vGlow;
        varying vec3 vObjPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTeam = aTeam;
        vGlow = aGlow;
        vObjPos = position;`,
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
        varying float vTeam;
        varying float vGlow;
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
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uTeamColor, vTeam);
        float dn = dNoise(vObjPos * 9.0) * 0.7 + dNoise(vObjPos * 23.0) * 0.3;
        if (uDissolve > 0.0 && dn < uDissolve) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uTeamColor * vGlow * uGlow;
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
  // Distinct program cache key: the onBeforeCompile changes must not be shared with plain materials.
  mat.customProgramCacheKey = () => "paradox-character-v1";
  return mat as THREE.MeshStandardMaterial & { userData: { uniforms: CharacterUniforms } };
}
