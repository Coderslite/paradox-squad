import { Btn, type InputCmd } from "../input";
import { DEG2RAD, type Vec3 } from "../math";
import type { MoveState } from "../movement";
import { hashFloat } from "../rng";
import { WEAPONS, fireInterval, type WeaponDef, type WeaponId } from "./defs";

export interface WeaponSlotState {
  id: WeaponId;
  ammo: number;
  reserve: number;
}

/** Deterministic weapon state, simulated identically by client prediction and the server. */
export interface WeaponState {
  slots: [WeaponSlotState, WeaponSlotState];
  active: 0 | 1;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  /** > 0 while reloading: seconds remaining. */
  reloadTimer: number;
  reloadTotal: number;
  reloadCommitted: boolean;
  /** > 0 while switching / equipping. */
  equipTimer: number;
  /** Index into the recoil pattern for the current spray. */
  sprayIndex: number;
  /** Seconds since last shot. */
  sinceShot: number;
  /** Extra spread from sustained fire, degrees. */
  bloom: number;
  /** 0..1 ADS progress. */
  ads: number;
  /** Total shots ever fired; seeds the deterministic spread. */
  shotCounter: number;
  /** Semi-auto trigger must be released between shots. */
  triggerLatched: boolean;
}

export interface WeaponEvents {
  /** Number of shots fired this tick (0 or 1 at 60Hz for all current weapons). */
  shots: number;
  /** shotCounter value of the first shot fired this tick. */
  firstShot: number;
  reloadStarted: boolean;
  reloadFinished: boolean;
  switched: boolean;
  dryFire: boolean;
}

export const createWeaponEvents = (): WeaponEvents => ({ shots: 0, firstShot: 0, reloadStarted: false, reloadFinished: false, switched: false, dryFire: false });

export function createWeaponState(primary: WeaponId = "vk12", secondary: WeaponId = "p9"): WeaponState {
  const p = WEAPONS[primary];
  const s = WEAPONS[secondary];
  return {
    slots: [
      { id: primary, ammo: p.magSize, reserve: p.reserve },
      { id: secondary, ammo: s.magSize, reserve: s.reserve },
    ],
    active: 0,
    cooldown: 0,
    reloadTimer: 0,
    reloadTotal: 0,
    reloadCommitted: false,
    equipTimer: p.equipTime,
    sprayIndex: 0,
    sinceShot: 10,
    bloom: 0,
    ads: 0,
    shotCounter: 0,
    triggerLatched: false,
  };
}

export function copyWeaponState(dst: WeaponState, src: WeaponState): WeaponState {
  for (let i = 0; i < 2; i++) {
    const d = dst.slots[i as 0 | 1];
    const s = src.slots[i as 0 | 1];
    d.id = s.id;
    d.ammo = s.ammo;
    d.reserve = s.reserve;
  }
  dst.active = src.active;
  dst.cooldown = src.cooldown;
  dst.reloadTimer = src.reloadTimer;
  dst.reloadTotal = src.reloadTotal;
  dst.reloadCommitted = src.reloadCommitted;
  dst.equipTimer = src.equipTimer;
  dst.sprayIndex = src.sprayIndex;
  dst.sinceShot = src.sinceShot;
  dst.bloom = src.bloom;
  dst.ads = src.ads;
  dst.shotCounter = src.shotCounter;
  dst.triggerLatched = src.triggerLatched;
  return dst;
}

export const activeDef = (w: WeaponState): WeaponDef => WEAPONS[w.slots[w.active].id];

/** Refill both magazines and reserves (spawn / respawn). */
export function resetWeaponState(w: WeaponState): void {
  for (const slot of w.slots) {
    const d = WEAPONS[slot.id];
    slot.ammo = d.magSize;
    slot.reserve = d.reserve;
  }
  w.active = 0;
  w.cooldown = 0;
  w.reloadTimer = 0;
  w.reloadCommitted = false;
  w.equipTimer = WEAPONS[w.slots[0].id].equipTime;
  w.sprayIndex = 0;
  w.bloom = 0;
  w.ads = 0;
  w.triggerLatched = false;
}

/**
 * Advance weapon state by one tick. `canAct` is false while dead, mantling, etc.
 * Sprinting blocks firing (the weapon is lowered).
 */
export function simulateWeapon(w: WeaponState, cmd: InputCmd, move: MoveState, canAct: boolean, dt: number, ev: WeaponEvents): void {
  ev.shots = 0;
  ev.firstShot = w.shotCounter;
  ev.reloadStarted = false;
  ev.reloadFinished = false;
  ev.switched = false;
  ev.dryFire = false;

  const b = cmd.buttons;
  w.sinceShot += dt;
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.equipTimer > 0) w.equipTimer = Math.max(0, w.equipTimer - dt);

  let def = activeDef(w);

  // Switching
  const want: 0 | 1 | -1 = b & Btn.Primary ? 0 : b & Btn.Secondary ? 1 : -1;
  if (canAct && want !== -1 && want !== w.active) {
    w.active = want;
    def = activeDef(w);
    w.equipTimer = def.equipTime;
    w.reloadTimer = 0;
    w.reloadCommitted = false;
    w.sprayIndex = 0;
    w.bloom = 0;
    ev.switched = true;
  }
  const slot = w.slots[w.active];

  // ADS progress
  const sprinting = (b & Btn.Sprint) !== 0 && cmd.moveY > 0.5 && move.grounded && move.slideTime <= 0 && (b & Btn.Ads) === 0;
  const wantAds = canAct && (b & Btn.Ads) !== 0 && w.reloadTimer <= 0;
  const adsRate = dt / def.adsTime;
  w.ads = wantAds ? Math.min(1, w.ads + adsRate) : Math.max(0, w.ads - adsRate);

  // Reload progress
  if (w.reloadTimer > 0) {
    w.reloadTimer = Math.max(0, w.reloadTimer - dt);
    if (!w.reloadCommitted && w.reloadTimer <= w.reloadTotal * (1 - def.reloadCommit)) {
      const need = def.magSize - slot.ammo;
      const take = Math.min(need, slot.reserve);
      slot.ammo += take;
      slot.reserve -= take;
      w.reloadCommitted = true;
    }
    if (w.reloadTimer <= 0) ev.reloadFinished = true;
  }

  const fireHeld = (b & Btn.Fire) !== 0;
  if (!fireHeld) w.triggerLatched = false;

  // Start reload: manual, or automatically when trying to fire an empty mag.
  const wantsReload = (b & Btn.Reload) !== 0 || (fireHeld && slot.ammo === 0 && !w.triggerLatched);
  if (canAct && wantsReload && w.reloadTimer <= 0 && w.equipTimer <= 0 && slot.ammo < def.magSize && slot.reserve > 0) {
    w.reloadTotal = slot.ammo === 0 ? def.reloadEmptyTime : def.reloadTime;
    w.reloadTimer = w.reloadTotal;
    w.reloadCommitted = false;
    w.sprayIndex = 0;
    ev.reloadStarted = true;
  }

  // Fire
  const ready = canAct && !sprinting && w.reloadTimer <= 0 && w.equipTimer <= 0 && w.cooldown <= 0;
  if (fireHeld && ready && !(def.fireMode === "semi" && w.triggerLatched)) {
    if (slot.ammo > 0) {
      slot.ammo -= 1;
      w.cooldown += fireInterval(def);
      if (w.sinceShot > def.recoil.resetTime) w.sprayIndex = 0;
      ev.shots = 1;
      ev.firstShot = w.shotCounter;
      w.shotCounter += 1;
      w.sprayIndex += 1;
      w.sinceShot = 0;
      w.bloom = Math.min(def.spread.maxBloom, w.bloom + def.spread.perShot);
      if (def.fireMode === "semi") w.triggerLatched = true;
    } else if (!w.triggerLatched) {
      ev.dryFire = true;
      w.triggerLatched = true;
    }
  }
  // Bloom recovers once you stop firing.
  if (w.sinceShot > 0.08) w.bloom = Math.max(0, w.bloom - dt * def.spread.maxBloom * 3);
}

/** Current spread cone half-angle in degrees. */
export function currentSpread(w: WeaponState, move: MoveState): number {
  const def = activeDef(w);
  const sp = def.spread;
  let base = sp.hip + (sp.ads - sp.hip) * w.ads;
  const hSpeed = Math.sqrt(move.vx * move.vx + move.vz * move.vz);
  base += sp.moving * Math.min(1, hSpeed / 6) * (1 - w.ads * 0.7);
  if (!move.grounded) base += sp.air;
  if (move.crouched && move.grounded) base *= sp.crouchMult;
  return base + w.bloom * (1 - w.ads * 0.6);
}

/**
 * Deterministic pellet direction: a uniform sample in a cone around (yaw, pitch).
 * Client and server compute identical directions for the same (seed, shot, pellet).
 */
export function shotDirection(yaw: number, pitch: number, spreadDeg: number, seed: number, shot: number, pellet: number, out: Vec3): Vec3 {
  const r = Math.sqrt(hashFloat(seed, shot, pellet * 2)) * spreadDeg * DEG2RAD;
  const theta = hashFloat(seed, shot, pellet * 2 + 1) * Math.PI * 2;
  // Offset in view space, then rotate by pitch and yaw.
  const ox = Math.sin(r) * Math.cos(theta);
  const oy = Math.sin(r) * Math.sin(theta);
  const oz = -Math.cos(r);
  // Pitch about X.
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y1 = oy * cp - oz * sp;
  const z1 = oy * sp + oz * cp;
  // Yaw about Y.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  out.x = ox * cy + z1 * sy;
  out.y = y1;
  out.z = -ox * sy + z1 * cy;
  return out;
}
