import type { CollisionWorld, MapDef, RayHit } from "@paradox/shared";
import { createRayHit } from "@paradox/shared";
import type { Navigation, Point } from "./navmesh";

/**
 * Cover points: walkable spots hugging the sides of chest-high-or-taller boxes,
 * snapped to the navmesh. Computed once per map.
 */
export function buildCoverPoints(map: MapDef, nav: Navigation): Point[] {
  const out: Point[] = [];
  for (const b of map.boxes) {
    if (b.r || b.s[1] < 1.0 || b.p[1] - b.s[1] / 2 > 0.6) continue; // tall enough, standing on the ground
    if (b.s[0] > 40 || b.s[2] > 40) continue; // skip floors/outer walls
    const [w, , d] = b.s;
    const y = b.p[1] - b.s[1] / 2 + 0.05;
    const edges: [number, number, number, number, number][] = [
      // start x, start z, dir x, dir z, length (points stepped along each face, 0.8m out)
      [b.p[0] - w / 2, b.p[2] - d / 2 - 0.8, 1, 0, w],
      [b.p[0] - w / 2, b.p[2] + d / 2 + 0.8, 1, 0, w],
      [b.p[0] - w / 2 - 0.8, b.p[2] - d / 2, 0, 1, d],
      [b.p[0] + w / 2 + 0.8, b.p[2] - d / 2, 0, 1, d],
    ];
    for (const [sx, sz, dx, dz, len] of edges) {
      for (let t = 0.6; t < len - 0.3; t += 1.6) {
        const p = nav.closest({ x: sx + dx * t, y, z: sz + dz * t });
        if (p && Math.abs(p.y - y) < 0.5) out.push(p);
      }
    }
  }
  return out;
}

const hit: RayHit = createRayHit();

/** True if `p` (standing, chest height) cannot be seen from the eye position. */
export function hiddenFrom(world: CollisionWorld, eyeX: number, eyeY: number, eyeZ: number, p: Point, height = 1.1): boolean {
  const dx = p.x - eyeX;
  const dy = p.y + height - eyeY;
  const dz = p.z - eyeZ;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return false;
  return world.raycast(eyeX, eyeY, eyeZ, dx / len, dy / len, dz / len, len - 0.2, hit) !== null;
}
