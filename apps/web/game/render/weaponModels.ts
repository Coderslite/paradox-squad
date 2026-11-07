import * as THREE from "three";
import type { WeaponId } from "@paradox/shared";

export interface WeaponModel {
  root: THREE.Group;
  /** Muzzle position in model space (flash + tracer origin). */
  muzzle: THREE.Object3D;
  /** Magazine, animated during reloads. */
  mag: THREE.Object3D;
  /** Pistol slide / shotgun pump, animated per shot. */
  action: THREE.Object3D | null;
  /** Hip and ADS offsets in view space: the sight line must sit on the camera axis when aimed. */
  hip: THREE.Vector3;
  ads: THREE.Vector3;
}

/** Hand anchor points in model space (third-person IK targets). */
export const WEAPON_HANDS: Record<WeaponId, { grip: THREE.Vector3; support: THREE.Vector3; stock: number }> = {
  vk12: { grip: new THREE.Vector3(0, -0.085, 0.085), support: new THREE.Vector3(0, -0.04, -0.3), stock: 0.33 },
  p9: { grip: new THREE.Vector3(0, -0.07, 0.035), support: new THREE.Vector3(-0.025, -0.08, 0.04), stock: 0.05 },
  breacher: { grip: new THREE.Vector3(0, -0.085, 0.075), support: new THREE.Vector3(0, -0.06, -0.3), stock: 0.36 },
};

/**
 * Greybox viewmodels built from primitives (replaced by GLB models in the art pass).
 * Units are metres. Model space: barrel points down -Z, sight line along y = sightY.
 */
export function buildWeaponModel(id: WeaponId, mats: WeaponMaterials): WeaponModel {
  switch (id) {
    case "vk12":
      return buildRifle(mats);
    case "p9":
      return buildPistol(mats);
    case "breacher":
      return buildShotgun(mats);
  }
}

export interface WeaponMaterials {
  metal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

export function createWeaponMaterials(): WeaponMaterials {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.38, metalness: 0.85 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.75, metalness: 0.05 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.55, metalness: 0.3 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x5ff2ff }),
  };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function buildRifle(m: WeaponMaterials): WeaponModel {
  const root = new THREE.Group();
  root.add(box(0.055, 0.07, 0.34, m.metal, 0, 0, 0)); // receiver
  root.add(box(0.06, 0.06, 0.26, m.polymer, 0, -0.005, -0.28)); // handguard
  root.add(cyl(0.011, 0.2, m.metal, 0, 0.005, -0.5)); // barrel
  root.add(cyl(0.018, 0.06, m.metal, 0, 0.005, -0.62)); // muzzle brake
  root.add(box(0.045, 0.06, 0.2, m.polymer, 0, -0.01, 0.25)); // stock
  root.add(box(0.05, 0.1, 0.05, m.polymer, 0, -0.075, 0.27)); // stock butt
  root.add(box(0.035, 0.09, 0.04, m.polymer, 0, -0.08, 0.08)); // grip
  root.add(box(0.06, 0.012, 0.36, m.metal, 0, 0.041, -0.06)); // top rail
  // Holographic sight: housing + glowing reticle dot on the sight line (y = 0.075)
  // Open frame (base, posts, hood) so the sight line at y = 0.075 stays clear when aiming.
  root.add(box(0.05, 0.01, 0.07, m.polymer, 0, 0.052, 0.02));
  root.add(box(0.005, 0.04, 0.06, m.polymer, -0.023, 0.075, 0.02));
  root.add(box(0.005, 0.04, 0.06, m.polymer, 0.023, 0.075, 0.02));
  root.add(box(0.05, 0.005, 0.06, m.polymer, 0, 0.097, 0.02));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.026), new THREE.MeshBasicMaterial({ color: 0x88ffee, transparent: true, opacity: 0.12 }));
  glass.position.set(0, 0.075, -0.012);
  root.add(glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 12), m.glow);
  dot.position.set(0, 0.075, -0.0125);
  root.add(dot);
  root.add(box(0.012, 0.006, 0.32, m.glow, 0.031, 0.0, -0.12)); // time-tech accent strip

  const mag = new THREE.Group();
  const magMesh = box(0.035, 0.12, 0.06, m.accent, 0, -0.06, 0);
  magMesh.rotation.x = 0.18;
  mag.add(magMesh);
  mag.position.set(0, -0.035, -0.06);
  root.add(mag);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.67);
  root.add(muzzle);
  return { root, muzzle, mag, action: null, hip: new THREE.Vector3(0.2, -0.205, -0.5), ads: new THREE.Vector3(0, -0.075, -0.3) };
}

function buildPistol(m: WeaponMaterials): WeaponModel {
  const root = new THREE.Group();
  root.add(box(0.034, 0.03, 0.17, m.polymer, 0, -0.01, -0.02)); // frame
  const grip = box(0.03, 0.1, 0.045, m.polymer, 0, -0.07, 0.03);
  grip.rotation.x = 0.2;
  root.add(grip);
  const slide = new THREE.Group();
  slide.add(box(0.032, 0.032, 0.19, m.metal, 0, 0.02, -0.03));
  slide.add(box(0.006, 0.01, 0.006, m.glow, 0, 0.041, -0.115)); // front sight
  slide.add(box(0.02, 0.01, 0.008, m.metal, 0, 0.041, 0.055)); // rear sight
  root.add(slide);
  const mag = new THREE.Group();
  mag.add(box(0.024, 0.09, 0.035, m.accent, 0, -0.06, 0.035));
  root.add(mag);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.13);
  root.add(muzzle);
  return { root, muzzle, mag, action: slide, hip: new THREE.Vector3(0.17, -0.17, -0.4), ads: new THREE.Vector3(0, -0.041, -0.3) };
}

function buildShotgun(m: WeaponMaterials): WeaponModel {
  const root = new THREE.Group();
  root.add(box(0.06, 0.075, 0.3, m.metal, 0, 0, 0)); // receiver
  root.add(cyl(0.017, 0.45, m.metal, 0, 0.012, -0.36)); // barrel
  root.add(cyl(0.014, 0.4, m.metal, 0, -0.024, -0.33)); // tube magazine
  root.add(box(0.05, 0.065, 0.24, m.polymer, 0, -0.01, 0.26)); // stock
  root.add(box(0.035, 0.09, 0.04, m.polymer, 0, -0.08, 0.07)); // grip
  root.add(box(0.006, 0.01, 0.006, m.glow, 0, 0.034, -0.56)); // bead sight
  root.add(box(0.014, 0.012, 0.03, m.metal, 0, 0.043, 0.1)); // rear notch
  const pump = new THREE.Group();
  pump.add(box(0.05, 0.05, 0.14, m.accent, 0, -0.024, -0.3));
  root.add(pump);
  const mag = new THREE.Group(); // shells are loaded into the tube: animate the pump instead
  root.add(mag);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.6);
  root.add(muzzle);
  return { root, muzzle, mag, action: pump, hip: new THREE.Vector3(0.2, -0.205, -0.48), ads: new THREE.Vector3(0, -0.045, -0.28) };
}
