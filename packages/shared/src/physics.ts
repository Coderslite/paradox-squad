import RAPIER from "@dimforge/rapier3d-compat";
import { GROUP_PROBE, GROUP_WORLD, MOVE, PLAYER, groups } from "./constants";
import { DEG2RAD, type Vec3 } from "./math";
import type { MapDef, SurfaceMaterial } from "./maps/types";

let initPromise: Promise<void> | null = null;

/** Loads the Rapier WASM module once. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export interface RayHit {
  distance: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  material: SurfaceMaterial;
}

export interface CharacterMoveResult {
  dx: number;
  dy: number;
  dz: number;
  grounded: boolean;
  hitCeiling: boolean;
  /** Up to 4 wall contact normals (x, z pairs, horizontal and normalized). */
  wallCount: number;
  walls: Float64Array;
}

export const createMoveResult = (): CharacterMoveResult => ({
  dx: 0,
  dy: 0,
  dz: 0,
  grounded: false,
  hitCeiling: false,
  wallCount: 0,
  walls: new Float64Array(8),
});

/** Queries only hit static world geometry, never the probes. */
const QUERY_GROUPS = groups(0xffff, GROUP_WORLD);

/**
 * Static collision world built from a {@link MapDef}. Character movement is a pure
 * function of (feet position, crouched, desired delta): a shared probe collider is
 * teleported for each query, so the same world can simulate any number of players
 * and replay inputs for reconciliation without per-player physics state.
 */
export class CollisionWorld {
  readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly standProbe: RAPIER.Collider;
  private readonly crouchProbe: RAPIER.Collider;
  private readonly standShape: RAPIER.Capsule;
  private readonly materials = new Map<number, SurfaceMaterial>();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly computed = { x: 0, y: 0, z: 0 };
  private readonly probePos = { x: 0, y: 0, z: 0 };
  private readonly identity = { x: 0, y: 0, z: 0, w: 1 };
  private readonly collision = new RAPIER.CharacterCollision();
  private readonly ball = new RAPIER.Ball(0.2);
  private readonly castVel = { x: 0, y: 0, z: 0 };

  /** Call {@link initPhysics} first. */
  constructor(map: MapDef) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    for (const b of map.boxes) {
      const desc = RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2)
        .setTranslation(b.p[0], b.p[1], b.p[2])
        .setCollisionGroups(groups(GROUP_WORLD, 0xffff));
      if (b.r) desc.setRotation(eulerToQuat(b.r[0], b.r[1], b.r[2]));
      const c = this.world.createCollider(desc);
      this.materials.set(c.handle, b.mat);
    }

    const r = PLAYER.radius;
    this.standShape = new RAPIER.Capsule((PLAYER.standHeight - 2 * r) / 2, r);
    const probeGroups = groups(GROUP_PROBE, 0);
    this.standProbe = this.world.createCollider(
      RAPIER.ColliderDesc.capsule((PLAYER.standHeight - 2 * r) / 2, r).setCollisionGroups(probeGroups).setTranslation(0, -1000, 0),
    );
    this.crouchProbe = this.world.createCollider(
      RAPIER.ColliderDesc.capsule((PLAYER.crouchHeight - 2 * r) / 2, r).setCollisionGroups(probeGroups).setTranslation(0, -1010, 0),
    );

    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(MOVE.stepHeight, 0.15, false);
    this.controller.enableSnapToGround(MOVE.snapDistance);
    this.controller.setMaxSlopeClimbAngle(MOVE.maxSlopeDeg * DEG2RAD);
    this.controller.setMinSlopeSlideAngle((MOVE.maxSlopeDeg + 5) * DEG2RAD);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    // Build the broad-phase / query acceleration structure for the static geometry.
    this.world.step();
  }

  /**
   * Collide-and-slide a character capsule. `feet` is the bottom of the capsule.
   * Writes the actually applied translation into `out`.
   */
  moveCharacter(feet: Vec3, crouched: boolean, dx: number, dy: number, dz: number, out: CharacterMoveResult): CharacterMoveResult {
    const probe = crouched ? this.crouchProbe : this.standProbe;
    const height = crouched ? PLAYER.crouchHeight : PLAYER.standHeight;
    this.probePos.x = feet.x;
    this.probePos.y = feet.y + height / 2;
    this.probePos.z = feet.z;
    probe.setTranslation(this.probePos);

    this.desired.x = dx;
    this.desired.y = dy;
    this.desired.z = dz;
    this.controller.computeColliderMovement(probe, this.desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_GROUPS);
    const m = this.controller.computedMovement(this.computed);
    out.dx = m.x;
    out.dy = m.y;
    out.dz = m.z;
    out.grounded = this.controller.computedGrounded();
    out.hitCeiling = false;
    out.wallCount = 0;
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      // normal1 is the obstacle's surface normal, pointing back toward the character.
      const c = this.controller.computedCollision(i, this.collision);
      if (!c) continue;
      const ny = c.normal1.y;
      if (ny < -0.7) out.hitCeiling = true;
      else if (Math.abs(ny) < 0.7 && out.wallCount < 4) {
        const hx = c.normal1.x;
        const hz = c.normal1.z;
        const len = Math.sqrt(hx * hx + hz * hz);
        if (len > 1e-4) {
          out.walls[out.wallCount * 2] = hx / len;
          out.walls[out.wallCount * 2 + 1] = hz / len;
          out.wallCount++;
        }
      }
    }
    return out;
  }

  /** True if a standing capsule fits at this feet position (used for uncrouch and mantle). */
  canStand(x: number, y: number, z: number): boolean {
    this.probePos.x = x;
    this.probePos.y = y + PLAYER.standHeight / 2 + 0.01;
    this.probePos.z = z;
    return this.world.intersectionWithShape(this.probePos, this.identity, this.standShape, undefined, QUERY_GROUPS) === null;
  }

  /** Raycast against static geometry. Direction must be normalized. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit): RayHit | null {
    this.ray.origin.x = ox;
    this.ray.origin.y = oy;
    this.ray.origin.z = oz;
    this.ray.dir.x = dx;
    this.ray.dir.y = dy;
    this.ray.dir.z = dz;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, QUERY_GROUPS);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    out.distance = t;
    out.x = ox + dx * t;
    out.y = oy + dy * t;
    out.z = oz + dz * t;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    out.material = this.materials.get(hit.collider.handle) ?? "concrete";
    return out;
  }

  /**
   * Sweep a sphere from an origin along a normalized direction against static geometry.
   * Returns the free distance before contact (maxDist if nothing is hit). Used by the
   * third-person camera spring arm.
   */
  castSphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, radius: number): number {
    if (this.ball.radius !== radius) this.ball.radius = radius;
    this.probePos.x = ox;
    this.probePos.y = oy;
    this.probePos.z = oz;
    this.castVel.x = dx;
    this.castVel.y = dy;
    this.castVel.z = dz;
    const hit = this.world.castShape(this.probePos, this.identity, this.castVel, this.ball, 0, maxDist, true, undefined, QUERY_GROUPS);
    return hit ? Math.min(maxDist, hit.time_of_impact) : maxDist;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.free();
  }
}

export const createRayHit = (): RayHit => ({ distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, material: "concrete" });

export function eulerToQuat(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  // XYZ order, matching THREE.Euler's default.
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}
