import { PLAYER } from "./constants";

/** Minimal pose needed to place a player's hitboxes. */
export interface HitboxPose {
  x: number;
  y: number;
  z: number;
  /** 0 standing .. 1 crouched. */
  crouch: number;
}

export interface PlayerHit {
  distance: number;
  head: boolean;
}

const BODY_RADIUS = 0.3;

/**
 * Ray vs player hitboxes: a head sphere and a body capsule. Direction must be normalized.
 * Returns the nearest hit within maxDist, preferring the head when both are hit at the
 * same point (the head sphere pokes out of the capsule top).
 */
export function rayVsPlayer(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  pose: HitboxPose,
  out: PlayerHit,
): boolean {
  const eye = PLAYER.eyeStand + (PLAYER.eyeCrouch - PLAYER.eyeStand) * pose.crouch;
  const headY = pose.y + eye + 0.06;
  const bodyTop = headY - PLAYER.headRadius - 0.04;
  const bodyBottom = pose.y + BODY_RADIUS;

  const tHead = raySphere(ox, oy, oz, dx, dy, dz, pose.x, headY, pose.z, PLAYER.headRadius);
  const tBody = rayCapsule(ox, oy, oz, dx, dy, dz, pose.x, bodyBottom, pose.z, pose.x, bodyTop - BODY_RADIUS, pose.z, BODY_RADIUS);

  let best = Infinity;
  let head = false;
  if (tHead >= 0 && tHead <= maxDist) {
    best = tHead;
    head = true;
  }
  if (tBody >= 0 && tBody <= maxDist && tBody < best - 0.02) {
    best = tBody;
    head = false;
  }
  if (best === Infinity) return false;
  out.distance = best;
  out.head = head;
  return true;
}

/** Returns distance along the ray or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Ray vs capsule (segment a-b, radius r). Returns distance along the ray or -1. */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const oax = ox - ax;
  const oay = oy - ay;
  const oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (Math.abs(a) > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // Hit one of the hemispherical caps.
    return y <= 0 ? raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r) : raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  }
  // Ray parallel to the capsule axis: nearest cap.
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}
