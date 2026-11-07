import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createCharacterMaterial, type CharacterUniforms } from "./characterMaterial";

/**
 * Bone roles. A GLB character can replace the procedural one by mapping its bones to these
 * names (Mixamo / Quaternius rigs map 1:1: Hips, Spine, Spine2, Neck, Head, LeftArm…).
 */
export const BONES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "forearmL",
  "handL",
  "upperArmR",
  "forearmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
] as const;
export type BoneName = (typeof BONES)[number];

/** Parent and rest offset of each bone. Model space: Y up, character faces -Z, right is +X. */
const SKELETON: Record<BoneName, [BoneName | null, number, number, number]> = {
  root: [null, 0, 0, 0],
  hips: ["root", 0, 0.95, 0],
  spine: ["hips", 0, 0.1, 0],
  chest: ["spine", 0, 0.2, 0],
  neck: ["chest", 0, 0.25, 0],
  head: ["neck", 0, 0.08, 0],
  upperArmL: ["chest", -0.2, 0.17, 0],
  forearmL: ["upperArmL", 0, -0.28, 0],
  handL: ["forearmL", 0, -0.26, 0],
  upperArmR: ["chest", 0.2, 0.17, 0],
  forearmR: ["upperArmR", 0, -0.28, 0],
  handR: ["forearmR", 0, -0.26, 0],
  thighL: ["hips", -0.1, -0.05, 0],
  shinL: ["thighL", 0, -0.42, 0],
  footL: ["shinL", 0, -0.42, 0],
  thighR: ["hips", 0.1, -0.05, 0],
  shinR: ["thighR", 0, -0.42, 0],
  footR: ["shinR", 0, -0.42, 0],
};

export const ARM_UPPER = 0.28;
export const ARM_LOWER = 0.26;

const C_SUIT = 0x2b3038;
const C_ARMOR = 0x8a8f96;
const C_DARK = 0x16181c;
const C_SKIN = 0x9b7a62;

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  color: number;
  team?: boolean;
  glow?: boolean;
}

function rbox(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.03): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2)).translate(x, y, z);
}

function capsule(r: number, len: number, y: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, y, 0);
}

function sphere(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
}

/** Body parts in bone-local space (limbs extend down -Y from their joint). */
function buildParts(): Part[] {
  const p: Part[] = [];
  const add = (bone: BoneName, geo: THREE.BufferGeometry, color: number, opts: { team?: boolean; glow?: boolean } = {}) => p.push({ bone, geo, color, ...opts });

  // Torso
  add("hips", rbox(0.33, 0.17, 0.21, 0, -0.01, 0), C_SUIT);
  add("hips", rbox(0.36, 0.05, 0.23, 0, 0.06, 0, 0.02), C_DARK); // belt
  add("hips", rbox(0.08, 0.07, 0.05, 0.12, 0.04, -0.12, 0.015), C_ARMOR); // pouch
  add("spine", rbox(0.3, 0.2, 0.2, 0, 0.09, 0), C_SUIT);
  add("chest", rbox(0.42, 0.3, 0.26, 0, 0.11, 0, 0.05), C_ARMOR);
  add("chest", rbox(0.3, 0.05, 0.02, 0, 0.13, -0.135, 0.01), C_DARK, { team: true });
  add("chest", rbox(0.06, 0.18, 0.015, -0.1, 0.08, -0.135, 0.005), C_DARK, { glow: true });
  add("chest", rbox(0.3, 0.32, 0.13, 0, 0.1, 0.18, 0.04), C_DARK); // backpack ("chrono pack")
  add("chest", new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8).rotateZ(Math.PI / 2).translate(0, 0.2, 0.25), C_DARK, { glow: true });
  add("neck", new THREE.CylinderGeometry(0.06, 0.065, 0.1, 10).translate(0, 0.03, 0), C_SKIN);

  // Head: helmet, visor, jaw
  add("head", sphere(0.13, 0, 0.1, 0.005, 1, 1.02, 1.1), C_ARMOR, { team: false });
  add("head", rbox(0.21, 0.065, 0.06, 0, 0.1, -0.11, 0.02), C_DARK, { glow: true });
  add("head", rbox(0.15, 0.08, 0.1, 0, 0.02, -0.06, 0.03), C_SKIN);
  add("head", rbox(0.04, 0.03, 0.18, 0, 0.225, 0, 0.012), C_DARK, { team: true }); // helmet crest

  // Arms
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? -1 : 1;
    add(`upperArm${side}`, rbox(0.15, 0.09, 0.17, s * 0.015, -0.01, 0, 0.03), C_ARMOR, { team: true });
    add(`upperArm${side}`, capsule(0.058, 0.18, -0.14), C_SUIT);
    add(`forearm${side}`, capsule(0.052, 0.16, -0.12), C_SUIT);
    add(`forearm${side}`, rbox(0.11, 0.1, 0.11, 0, -0.15, 0, 0.02), C_ARMOR);
    add(`hand${side}`, rbox(0.075, 0.1, 0.055, 0, -0.045, 0, 0.02), C_DARK);
  }

  // Legs
  for (const side of ["L", "R"] as const) {
    add(`thigh${side}`, capsule(0.08, 0.27, -0.21), C_SUIT);
    add(`thigh${side}`, rbox(0.12, 0.12, 0.05, 0, -0.18, -0.07, 0.02), C_ARMOR); // thigh plate
    add(`shin${side}`, rbox(0.12, 0.11, 0.06, 0, -0.01, -0.075, 0.025), C_ARMOR, { team: true }); // knee pad
    add(`shin${side}`, capsule(0.065, 0.28, -0.2), C_SUIT);
    add(`foot${side}`, rbox(0.12, 0.12, 0.26, 0, -0.02, -0.045, 0.035), C_DARK);
  }
  return p;
}

/** Creates a fresh bone hierarchy in rest pose. */
export function createBones(): Record<BoneName, THREE.Bone> {
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const [parent, x, y, z] = SKELETON[name];
    b.position.set(x, y, z);
    bones[name] = b;
    if (parent) bones[parent].add(b);
  }
  return bones;
}

let sharedGeometry: THREE.BufferGeometry | null = null;

/** Skinned geometry shared by every procedural character (built once, ~6k triangles). */
function getCharacterGeometry(): THREE.BufferGeometry {
  if (sharedGeometry) return sharedGeometry;
  const bones = createBones();
  bones.root.updateMatrixWorld(true);
  const color = new THREE.Color();
  const geos: THREE.BufferGeometry[] = [];
  for (const part of buildParts()) {
    const g = part.geo.toNonIndexed();
    part.geo.dispose();
    g.deleteAttribute("uv");
    g.applyMatrix4(bones[part.bone].matrixWorld);
    const n = g.attributes.position!.count;
    const boneIndex = BONES.indexOf(part.bone);
    color.setHex(part.color).convertSRGBToLinear();
    const colors = new Float32Array(n * 3);
    const team = new Float32Array(n).fill(part.team ? 1 : 0);
    const glow = new Float32Array(n).fill(part.glow ? 1 : 0);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      skinIndex[i * 4] = boneIndex;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aTeam", new THREE.BufferAttribute(team, 1));
    g.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error("character geometry merge failed");
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  sharedGeometry = merged;
  return merged;
}

/** One character instance: skinned body + bones + per-instance material uniforms. */
export class CharacterRig {
  readonly root: THREE.Group = new THREE.Group();
  readonly bones: Record<BoneName, THREE.Bone>;
  readonly mesh: THREE.SkinnedMesh;
  readonly uniforms: CharacterUniforms;
  private readonly material: THREE.MeshStandardMaterial;

  constructor() {
    this.bones = createBones();
    this.material = createCharacterMaterial();
    this.uniforms = (this.material.userData as { uniforms: CharacterUniforms }).uniforms;
    this.mesh = new THREE.SkinnedMesh(getCharacterGeometry(), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Skinned bounds follow the bones; cull with a generous static sphere instead.
    this.mesh.frustumCulled = false;
    this.mesh.add(this.bones.root);
    // Inverse bind matrices come from the bones' world matrices: update them first.
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(BONES.map((n) => this.bones[n])));
    this.root.add(this.mesh);
  }

  setTeamColor(hex: number): void {
    this.uniforms.uTeamColor.value.setHex(hex).convertSRGBToLinear();
  }

  /** Outline/rim colour; strength 0 disables. */
  setRim(hex: number, strength: number): void {
    this.uniforms.uRimColor.value.setHex(hex).convertSRGBToLinear();
    this.uniforms.uRimStrength.value = strength;
  }

  setDissolve(v: number): void {
    this.uniforms.uDissolve.value = v;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
    this.mesh.skeleton.dispose();
  }
}

export function disposeSharedCharacterGeometry(): void {
  sharedGeometry?.dispose();
  sharedGeometry = null;
}
