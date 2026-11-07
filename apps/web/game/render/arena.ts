import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MapDef, SurfaceMaterial } from "@paradox/shared";

const MATERIAL_PROPS: Record<SurfaceMaterial, { roughness: number; metalness: number }> = {
  concrete: { roughness: 0.92, metalness: 0 },
  metal: { roughness: 0.45, metalness: 0.65 },
  wood: { roughness: 0.8, metalness: 0 },
  dirt: { roughness: 1, metalness: 0 },
  glass: { roughness: 0.1, metalness: 0.2 },
};

/**
 * Builds the greybox visual set: one merged mesh per surface material with vertex
 * colours, world-scaled UVs (1 texture tile = 1m) and shadows. ~4 draw calls total.
 */
export function buildArena(map: MapDef, grid: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = "arena";
  const byMat = new Map<SurfaceMaterial, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const color = new THREE.Color();

  for (const b of map.boxes) {
    const [sx, sy, sz] = b.s;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    scaleBoxUVs(g, sx, sy, sz);
    color.setHex(b.color ?? 0x888888).convertSRGBToLinear();
    const n = g.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    e.set(b.r?.[0] ?? 0, b.r?.[1] ?? 0, b.r?.[2] ?? 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(b.p[0], b.p[1], b.p[2]), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m4);
    const list = byMat.get(b.mat) ?? [];
    list.push(g);
    byMat.set(b.mat, list);
  }

  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const material = new THREE.MeshStandardMaterial({
      map: grid,
      vertexColors: true,
      ...MATERIAL_PROPS[mat],
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `arena-${mat}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return group;
}

/** BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each. */
function scaleBoxUVs(g: THREE.BoxGeometry, sx: number, sy: number, sz: number): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let face = 0; face < 6; face++) {
    const [u, v] = dims[face]!;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * u, uv.getY(idx) * v);
    }
  }
  uv.needsUpdate = true;
}
