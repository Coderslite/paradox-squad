import { TICK_DT } from "./constants";
import { Btn, type InputCmd } from "./input";
import type { Vec3 } from "./math";
import { copyMoveState, createMoveEvents, createMoveState, eyeHeight, simulateMove, type MoveEnv, type MoveEvents, type MoveState } from "./movement";
import type { CollisionWorld } from "./physics";
import { activeDef, copyWeaponState, createWeaponEvents, createWeaponState, currentSpread, shotDirection, simulateWeapon, type WeaponEvents, type WeaponState } from "./weapons/sim";

/** Everything the client predicts and the server simulates for one player per tick. */
export interface PlayerSimState {
  move: MoveState;
  weapon: WeaponState;
}

export interface PlayerSimEvents {
  move: MoveEvents;
  weapon: WeaponEvents;
}

export const createPlayerSimState = (): PlayerSimState => ({ move: createMoveState(), weapon: createWeaponState() });
export const createPlayerSimEvents = (): PlayerSimEvents => ({ move: createMoveEvents(), weapon: createWeaponEvents() });

export function copyPlayerSimState(dst: PlayerSimState, src: PlayerSimState): PlayerSimState {
  copyMoveState(dst.move, src.move);
  copyWeaponState(dst.weapon, src.weapon);
  return dst;
}

/** One authoritative/predicted tick: movement first, then the weapon (which reads movement). */
export function simulatePlayerTick(s: PlayerSimState, cmd: InputCmd, world: CollisionWorld, env: MoveEnv, alive: boolean, ev: PlayerSimEvents): void {
  if (alive) simulateMove(s.move, cmd, world, TICK_DT, env, ev.move);
  simulateWeapon(s.weapon, cmd, s.move, alive && s.move.mantleT <= 0, TICK_DT, ev.weapon);
}

/**
 * Shot rays for the shots fired this tick, written as [ox, oy, oz, dx, dy, dz] per pellet.
 * Call after {@link simulatePlayerTick}; client and server produce identical rays from the
 * same state, input and seed. Returns the pellet count (0 if nothing fired).
 */
export function computeShotRays(s: PlayerSimState, cmd: InputCmd, seed: number, ev: WeaponEvents, out: Float64Array): number {
  if (ev.shots === 0) return 0;
  const def = activeDef(s.weapon);
  const spread = currentSpread(s.weapon, s.move);
  shotOrigin(s.move, cmd.yaw, cmd.buttons, origin);
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const n = Math.min(def.pellets, Math.floor(out.length / 6));
  for (let p = 0; p < n; p++) {
    shotDirection(cmd.aimYaw, cmd.aimPitch, spread, seed, ev.firstShot, p, rayDir);
    out[p * 6] = ox;
    out[p * 6 + 1] = oy;
    out[p * 6 + 2] = oz;
    out[p * 6 + 3] = rayDir.x;
    out[p * 6 + 4] = rayDir.y;
    out[p * 6 + 5] = rayDir.z;
  }
  return n;
}

const rayDir: Vec3 = { x: 0, y: 0, z: 0 };
const origin: Vec3 = { x: 0, y: 0, z: 0 };

/** Shoulder-mounted weapon offset in third person (right, up, forward), metres. */
export const TP_MUZZLE_OFFSET = { right: 0.24, up: -0.12, forward: 0.35 } as const;

/**
 * Where shots start. First person: the eye. Third person: the weapon at the shoulder
 * (mirrored for the left shoulder), so cover in front of the gun blocks shots even when
 * the camera can see past it.
 */
export function shotOrigin(m: MoveState, yaw: number, buttons: number, out: Vec3): Vec3 {
  const eye = eyeHeight(m);
  out.x = m.x;
  out.y = m.y + eye;
  out.z = m.z;
  if (buttons & Btn.ThirdPerson) {
    const side = buttons & Btn.ShoulderLeft ? -1 : 1;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    // right = (cos, 0, -sin), forward = (-sin, 0, -cos)
    out.x += c * TP_MUZZLE_OFFSET.right * side - s * TP_MUZZLE_OFFSET.forward;
    out.y += TP_MUZZLE_OFFSET.up;
    out.z += -s * TP_MUZZLE_OFFSET.right * side - c * TP_MUZZLE_OFFSET.forward;
  }
  return out;
}
export const MAX_PELLETS = 8;
