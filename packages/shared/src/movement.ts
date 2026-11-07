import { MOVE, PLAYER } from "./constants";
import { Btn, type InputCmd } from "./input";
import type { Vec3 } from "./math";
import { createMoveResult, createRayHit, type CollisionWorld, type RayHit } from "./physics";

/**
 * Complete movement state of one character. Plain numbers only, so it can be
 * copied into ring buffers, serialized into snapshots and restored for
 * reconciliation and Personal Rewind.
 */
export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouched: boolean;
  /** Smoothed 0 (standing) .. 1 (crouched), drives eye height. */
  crouchBlend: number;
  slideTime: number;
  slideCooldown: number;
  coyote: number;
  jumpBuffer: number;
  /** Previous tick's buttons, for edge detection. */
  prevButtons: number;
  /** > 0 while mantling: elapsed seconds. */
  mantleT: number;
  mantleDur: number;
  mantleFromX: number;
  mantleFromY: number;
  mantleFromZ: number;
  mantleToX: number;
  mantleToY: number;
  mantleToZ: number;
}

/** Per-tick events the simulation emits for camera/audio feedback. Not part of state. */
export interface MoveEvents {
  jumped: boolean;
  /** Downward speed at landing (m/s), 0 if no landing this tick. */
  landed: number;
  slideStarted: boolean;
  mantleStarted: boolean;
}

/** Per-environment modifiers (e.g. the Near-Future era lowers gravity). */
export interface MoveEnv {
  gravityScale: number;
}

export const DEFAULT_ENV: MoveEnv = { gravityScale: 1 };

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    crouched: false,
    crouchBlend: 0,
    slideTime: 0,
    slideCooldown: 0,
    coyote: 0,
    jumpBuffer: 0,
    prevButtons: 0,
    mantleT: 0,
    mantleDur: 0,
    mantleFromX: 0,
    mantleFromY: 0,
    mantleFromZ: 0,
    mantleToX: 0,
    mantleToY: 0,
    mantleToZ: 0,
  };
}

export const createMoveEvents = (): MoveEvents => ({ jumped: false, landed: 0, slideStarted: false, mantleStarted: false });

export function copyMoveState(dst: MoveState, src: MoveState): MoveState {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.grounded = src.grounded;
  dst.crouched = src.crouched;
  dst.crouchBlend = src.crouchBlend;
  dst.slideTime = src.slideTime;
  dst.slideCooldown = src.slideCooldown;
  dst.coyote = src.coyote;
  dst.jumpBuffer = src.jumpBuffer;
  dst.prevButtons = src.prevButtons;
  dst.mantleT = src.mantleT;
  dst.mantleDur = src.mantleDur;
  dst.mantleFromX = src.mantleFromX;
  dst.mantleFromY = src.mantleFromY;
  dst.mantleFromZ = src.mantleFromZ;
  dst.mantleToX = src.mantleToX;
  dst.mantleToY = src.mantleToY;
  dst.mantleToZ = src.mantleToZ;
  return dst;
}

export const eyeHeight = (s: MoveState): number => PLAYER.eyeStand + (PLAYER.eyeCrouch - PLAYER.eyeStand) * s.crouchBlend;

export const horizontalSpeed = (s: MoveState): number => Math.sqrt(s.vx * s.vx + s.vz * s.vz);

// Scratch objects: the simulation runs thousands of times per second during
// reconciliation, so it must not allocate.
const moveOut = createMoveResult();
const hitA: RayHit = createRayHit();
const hitB: RayHit = createRayHit();
const feet: Vec3 = { x: 0, y: 0, z: 0 };
const MANTLE_PROBES = [0.25, 0.7, 1.2] as const;

/**
 * Advance one character by one fixed tick. Deterministic: given the same state,
 * input, world and dt it produces the same result on client and server.
 */
export function simulateMove(s: MoveState, cmd: InputCmd, world: CollisionWorld, dt: number, env: MoveEnv, ev: MoveEvents): void {
  ev.jumped = false;
  ev.landed = 0;
  ev.slideStarted = false;
  ev.mantleStarted = false;

  const buttons = cmd.buttons;
  const pressed = buttons & ~s.prevButtons;
  s.prevButtons = buttons;

  // --- Mantle in progress: scripted, ignores input ---
  if (s.mantleT > 0) {
    s.mantleT += dt;
    const t = Math.min(1, s.mantleT / s.mantleDur);
    // Rise first, then move forward: reads as "pulling up" rather than a teleport.
    const up = 1 - (1 - Math.min(1, t * 1.6)) ** 2;
    const fwd = t * t * (3 - 2 * t);
    s.x = s.mantleFromX + (s.mantleToX - s.mantleFromX) * fwd;
    s.y = s.mantleFromY + (s.mantleToY - s.mantleFromY) * up;
    s.z = s.mantleFromZ + (s.mantleToZ - s.mantleFromZ) * fwd;
    if (t >= 1) {
      s.mantleT = 0;
      s.grounded = true;
      const sin = Math.sin(cmd.yaw);
      const cos = Math.cos(cmd.yaw);
      s.vx = -sin * 2.5;
      s.vz = -cos * 2.5;
      s.vy = 0;
    }
    updateCrouchBlend(s, dt);
    return;
  }

  // --- Wish direction in world space ---
  let mx = cmd.moveX;
  let my = cmd.moveY;
  const mlen = Math.sqrt(mx * mx + my * my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  const sinY = Math.sin(cmd.yaw);
  const cosY = Math.cos(cmd.yaw);
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  let wishX = -sinY * my + cosY * mx;
  let wishZ = -cosY * my - sinY * mx;
  const wishLen = Math.sqrt(wishX * wishX + wishZ * wishZ);
  if (wishLen > 1e-6) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }
  const wishAmount = Math.min(1, mlen);

  const wantSprint = (buttons & Btn.Sprint) !== 0 && my > 0.5 && (buttons & Btn.Ads) === 0;
  const wantCrouch = (buttons & Btn.Crouch) !== 0;

  // --- Timers ---
  if (s.slideCooldown > 0) s.slideCooldown = Math.max(0, s.slideCooldown - dt);
  if (s.coyote > 0) s.coyote = Math.max(0, s.coyote - dt);
  if (s.jumpBuffer > 0) s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  if (pressed & Btn.Jump) s.jumpBuffer = MOVE.jumpBuffer;

  // --- Slide start: sprinting fast on the ground and crouch pressed ---
  const hSpeed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (
    pressed & Btn.Crouch &&
    s.grounded &&
    s.slideTime <= 0 &&
    s.slideCooldown <= 0 &&
    hSpeed > MOVE.slideMinSpeed
  ) {
    const boosted = Math.min(MOVE.slideMaxSpeed, hSpeed + MOVE.slideBoost);
    s.vx = (s.vx / hSpeed) * boosted;
    s.vz = (s.vz / hSpeed) * boosted;
    s.slideTime = MOVE.slideDuration;
    ev.slideStarted = true;
  }
  const sliding = s.slideTime > 0;

  // --- Crouch state (uncrouch only with headroom) ---
  if (wantCrouch || sliding) {
    s.crouched = true;
  } else if (s.crouched && world.canStand(s.x, s.y, s.z)) {
    s.crouched = false;
  }

  // --- Jump ---
  if (s.jumpBuffer > 0 && (s.grounded || s.coyote > 0)) {
    // Jumping from a crouch needs headroom; from a slide it keeps the momentum.
    if (!s.crouched || world.canStand(s.x, s.y, s.z)) {
      s.vy = MOVE.jumpVelocity;
      s.grounded = false;
      s.coyote = 0;
      s.jumpBuffer = 0;
      if (sliding) {
        s.slideTime = 0;
        s.slideCooldown = MOVE.slideCooldown;
      }
      if (!wantCrouch) s.crouched = false;
      ev.jumped = true;
    }
  }

  // --- Horizontal acceleration ---
  if (s.grounded) {
    if (s.slideTime > 0) {
      applyFriction(s, MOVE.slideFriction, dt);
      accelerate(s, wishX, wishZ, wishAmount * MOVE.crouchSpeed, MOVE.slideSteer, dt);
      s.slideTime -= dt;
      if (s.slideTime <= 0 || horizontalSpeed(s) < MOVE.crouchSpeed) {
        s.slideTime = 0;
        s.slideCooldown = MOVE.slideCooldown;
      }
    } else {
      let target = s.crouched ? MOVE.crouchSpeed : wantSprint ? MOVE.sprintSpeed : MOVE.runSpeed;
      if (buttons & Btn.Ads) target *= MOVE.adsSpeedMult;
      if (my < 0) target *= MOVE.backwardMult;
      applyFriction(s, MOVE.groundFriction, dt);
      accelerate(s, wishX, wishZ, wishAmount * target, MOVE.groundAccel, dt);
    }
  } else {
    // Air control: can steer, but cannot gain speed beyond airMaxGain by strafing.
    const cur = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    accelerate(s, wishX, wishZ, wishAmount * MOVE.airMaxGain, MOVE.airAccel, dt);
    const next = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    const cap = Math.max(cur, MOVE.airMaxGain);
    if (next > cap) {
      s.vx *= cap / next;
      s.vz *= cap / next;
    }
  }

  // --- Gravity ---
  if (!s.grounded) {
    s.vy = Math.max(-MOVE.terminalVelocity, s.vy - MOVE.gravity * env.gravityScale * dt);
  } else if (s.vy < 0) {
    s.vy = 0;
  }

  // --- Mantle: airborne, pushing forward, facing a ledge ---
  if (!s.grounded && my > 0.5 && tryStartMantle(s, world, sinY, cosY)) {
    ev.mantleStarted = true;
    updateCrouchBlend(s, dt);
    return;
  }

  // --- Collide and slide ---
  const wasGrounded = s.grounded;
  // No downward bias while grounded: snap-to-ground keeps contact, and a bias makes the
  // controller dig into flat floors and occasionally block horizontal motion.
  feet.x = s.x;
  feet.y = s.y;
  feet.z = s.z;
  const r = world.moveCharacter(feet, s.crouched, s.vx * dt, s.vy * dt, s.vz * dt, moveOut);
  s.x += r.dx;
  s.y += r.dy;
  s.z += r.dz;

  // Clip velocity against walls we were actually stopped by (step risers that autostep
  // climbed also report contacts, but do not impede horizontal motion).
  const wantH = Math.sqrt(s.vx * s.vx + s.vz * s.vz) * dt;
  const gotH = Math.sqrt(r.dx * r.dx + r.dz * r.dz);
  const impeded = wantH > 1e-5 && gotH < wantH * 0.9;
  for (let i = 0; impeded && i < r.wallCount; i++) {
    const nx = r.walls[i * 2] as number;
    const nz = r.walls[i * 2 + 1] as number;
    const into = s.vx * nx + s.vz * nz;
    if (into < 0) {
      s.vx -= nx * into;
      s.vz -= nz * into;
    }
  }
  if (r.hitCeiling && s.vy > 0) s.vy = 0;

  const groundedNow = r.grounded && s.vy <= 0.01;
  if (groundedNow && !wasGrounded) {
    ev.landed = -Math.min(0, s.vy);
    s.vy = 0;
  }
  if (!groundedNow && wasGrounded && !ev.jumped) {
    s.coyote = MOVE.coyoteTime;
    if (s.vy < 0) s.vy = 0;
  }
  s.grounded = groundedNow;
  // Leaving the ground ends a slide unless we are just cresting a bump.
  if (!s.grounded && s.slideTime > 0 && s.coyote <= 0) s.slideTime = 0;

  updateCrouchBlend(s, dt);
}

function updateCrouchBlend(s: MoveState, dt: number): void {
  const target = s.crouched ? 1 : 0;
  const step = MOVE.crouchTransitionRate * dt;
  if (s.crouchBlend < target) s.crouchBlend = Math.min(target, s.crouchBlend + step);
  else if (s.crouchBlend > target) s.crouchBlend = Math.max(target, s.crouchBlend - step);
}

function applyFriction(s: MoveState, friction: number, dt: number): void {
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (speed < 1e-4) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
  const drop = control * friction * dt;
  const scale = Math.max(0, speed - drop) / speed;
  s.vx *= scale;
  s.vz *= scale;
}

/** Quake-style acceleration: only adds speed along the wish direction up to wishSpeed. */
function accelerate(s: MoveState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const current = s.vx * wx + s.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(add, accel * wishSpeed * dt);
  s.vx += wx * a;
  s.vz += wz * a;
}

function tryStartMantle(s: MoveState, world: CollisionWorld, sinY: number, cosY: number): boolean {
  const fx = -sinY;
  const fz = -cosY;
  // 1. A wall in front. Probed at several heights: low ledges pass under a chest-height ray mid-jump.
  const reach = PLAYER.radius + MOVE.mantleReach;
  let chest: RayHit | null = null;
  for (let i = 0; i < MANTLE_PROBES.length && !chest; i++) {
    chest = world.raycast(s.x, s.y + (MANTLE_PROBES[i] as number), s.z, fx, 0, fz, reach, hitA);
    if (chest && Math.abs(chest.ny) > 0.3) chest = null;
  }
  if (!chest) return false;
  // 2. Find the top surface just past the wall face.
  const px = chest.x + fx * (PLAYER.radius + 0.05);
  const pz = chest.z + fz * (PLAYER.radius + 0.05);
  const topStart = s.y + MOVE.mantleMaxHeight + 0.3;
  const top = world.raycast(px, topStart, pz, 0, -1, 0, MOVE.mantleMaxHeight + 0.3 - MOVE.mantleMinHeight + 0.3, hitB);
  if (!top || top.ny < 0.7) return false;
  const h = top.y - s.y;
  if (h < MOVE.mantleMinHeight || h > MOVE.mantleMaxHeight) return false;
  // 3. Room to stand on top.
  if (!world.canStand(px, top.y + 0.02, pz)) return false;

  s.mantleT = 1e-6;
  s.mantleDur = MOVE.mantleBaseTime + h * MOVE.mantleTimePerMetre;
  s.mantleFromX = s.x;
  s.mantleFromY = s.y;
  s.mantleFromZ = s.z;
  s.mantleToX = px;
  s.mantleToY = top.y + 0.02;
  s.mantleToZ = pz;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.slideTime = 0;
  s.grounded = false;
  return true;
}
