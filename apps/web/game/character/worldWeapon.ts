import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WeaponId } from "@paradox/shared";
import { buildWeaponModel, createWeaponMaterials } from "../render/weaponModels";

interface Merged {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  muzzle: THREE.Vector3;
}

const cache = new Map<WeaponId, Merged>();
let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

/** Merge a viewmodel weapon into two geometries (lit body with vertex colours + emissive parts). */
function merged(id: WeaponId): Merged {
  const hit = cache.get(id);
  if (hit) return hit;
  const mats = createWeaponMaterials();
  const model = buildWeaponModel(id, mats);
  model.root.updateMatrixWorld(true);
  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  model.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = (o.geometry as THREE.BufferGeometry).toNonIndexed();
    g.deleteAttribute("uv");
    g.applyMatrix4(o.matrixWorld);
    const mat = o.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if (mat === mats.glow) {
      glow.push(g);
      return;
    }
    if ((mat as THREE.Material).transparent) return; // sight glass
    const c = mat.color.clone();
    const n = g.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    body.push(g);
  });
  const muzzle = model.muzzle.getWorldPosition(new THREE.Vector3());
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  for (const m of Object.values(mats)) m.dispose();
  const result: Merged = { body: mergeGeometries(body)!, glow: glow.length ? mergeGeometries(glow) : null, muzzle };
  for (const g of [...body, ...glow]) g.dispose();
  cache.set(id, result);
  return result;
}

/** A weapon held by a third-person character. Swaps model when the weapon changes. */
export class WorldWeapon {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private readonly bodyMesh: THREE.Mesh;
  private readonly glowMesh: THREE.Mesh;
  private current: WeaponId | null = null;

  constructor() {
    bodyMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
    glowMaterial ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 2.8) });
    this.bodyMesh = new THREE.Mesh(undefined, bodyMaterial);
    this.glowMesh = new THREE.Mesh(undefined, glowMaterial);
    this.bodyMesh.castShadow = true;
    this.group.add(this.bodyMesh, this.glowMesh, this.muzzle);
  }

  set(id: WeaponId): void {
    if (id === this.current) return;
    const m = merged(id);
    this.bodyMesh.geometry = m.body;
    if (m.glow) {
      this.glowMesh.geometry = m.glow;
      this.glowMesh.visible = true;
    } else this.glowMesh.visible = false;
    this.muzzle.position.copy(m.muzzle);
    this.current = id;
  }

  get id(): WeaponId | null {
    return this.current;
  }
}

export function disposeWorldWeapons(): void {
  for (const m of cache.values()) {
    m.body.dispose();
    m.glow?.dispose();
  }
  cache.clear();
  bodyMaterial?.dispose();
  glowMaterial?.dispose();
  bodyMaterial = glowMaterial = null;
}
