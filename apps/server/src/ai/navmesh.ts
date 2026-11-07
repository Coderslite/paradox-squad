import { init as initRecast, NavMeshQuery, type NavMesh } from "@recast-navigation/core";
import { generateSoloNavMesh } from "@recast-navigation/generators";
import { PLAYER, eulerToQuat, type MapDef } from "@paradox/shared";

let ready: Promise<void> | null = null;
/** Loads the Recast/Detour WASM module once. */
export const initNavigation = (): Promise<void> => (ready ??= initRecast());

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Navigation for one map: path queries over a Recast navmesh built from the collision boxes. */
export class Navigation {
  private readonly query: NavMeshQuery;
  private readonly halfExtents = { x: 2, y: 3, z: 2 };

  constructor(
    readonly navMesh: NavMesh,
    readonly map: MapDef,
  ) {
    this.query = new NavMeshQuery(navMesh);
  }

  /** Straight-path waypoints from a to b (empty if unreachable). */
  path(a: Point, b: Point): Point[] {
    const r = this.query.computePath(a, b, { halfExtents: this.halfExtents, maxStraightPathPoints: 64 });
    return r.success ? r.path : [];
  }

  closest(p: Point): Point | null {
    const r = this.query.findClosestPoint(p, { halfExtents: this.halfExtents });
    return r.success ? r.point : null;
  }

  /** Random reachable point within `radius` of `p` (on the same connected region). */
  randomAround(p: Point, radius: number): Point | null {
    const r = this.query.findRandomPointAroundCircle(p, radius, { halfExtents: this.halfExtents });
    return r.success ? r.randomPoint : null;
  }

  dispose(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }
}

const cache = new Map<string, Navigation>();

/** Builds (once per map) the navmesh from the map's boxes. */
export function getNavigation(map: MapDef): Navigation {
  const hit = cache.get(map.id);
  if (hit) return hit;
  const { positions, indices } = boxesToTriangles(map);
  const cs = 0.25;
  const ch = 0.15;
  const result = generateSoloNavMesh(positions, indices, {
    cs,
    ch,
    walkableSlopeAngle: 48,
    walkableHeight: Math.ceil(PLAYER.standHeight / ch),
    walkableClimb: Math.floor(0.4 / ch),
    walkableRadius: Math.ceil(PLAYER.radius / cs),
    maxEdgeLen: 12 / cs,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: cs * 6,
    detailSampleMaxError: ch,
  });
  if (!result.success) throw new Error(`navmesh generation failed for ${map.id}: ${result.error}`);
  const nav = new Navigation(result.navMesh, map);
  cache.set(map.id, nav);
  return nav;
}

/** Each collision box becomes 12 triangles (rotated boxes supported). */
function boxesToTriangles(map: MapDef): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const corners: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  // Faces as quads of corner indices, wound counter-clockwise seen from outside.
  const faces = [
    [0, 2, 3, 1], // -z
    [4, 5, 7, 6], // +z
    [0, 1, 5, 4], // -y
    [2, 6, 7, 3], // +y
    [0, 4, 6, 2], // -x
    [1, 3, 7, 5], // +x
  ];
  for (const b of map.boxes) {
    const q = b.r ? eulerToQuat(b.r[0], b.r[1], b.r[2]) : { x: 0, y: 0, z: 0, w: 1 };
    const base = positions.length / 3;
    for (const [cx, cy, cz] of corners) {
      const [x, y, z] = rotate(q, (cx * b.s[0]) / 2, (cy * b.s[1]) / 2, (cz * b.s[2]) / 2);
      positions.push(b.p[0] + x, b.p[1] + y, b.p[2] + z);
    }
    for (const [a, bb, c, d] of faces) indices.push(base + a!, base + bb!, base + c!, base + a!, base + c!, base + d!);
  }
  return { positions, indices };
}

function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number): [number, number, number] {
  // v' = q v q*
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
}
