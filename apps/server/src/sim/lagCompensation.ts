import { MAX_LAG_COMP_MS, TICK_RATE, rayVsPlayer, type HitboxPose, type PlayerHit } from "@paradox/shared";
import type { ServerPlayer } from "./serverPlayer";

const MAX_REWIND_TICKS = Math.ceil((MAX_LAG_COMP_MS / 1000) * TICK_RATE);

export interface CompensatedHit {
  target: ServerPlayer;
  distance: number;
  head: boolean;
}

const pose: HitboxPose = { x: 0, y: 0, z: 0, crouch: 0 };
const hit: PlayerHit = { distance: 0, head: false };

/**
 * Lag-compensated hitscan: tests the ray against every other player's hitboxes as they
 * were at the tick the shooter was looking at (`viewTick + viewAlpha`, what their screen
 * showed), clamped to MAX_LAG_COMP_MS. Uses the same history ring buffer as Personal Rewind.
 */
export function lagCompensatedRaycast(
  shooter: ServerPlayer,
  players: Iterable<ServerPlayer>,
  nowTick: number,
  viewTick: number,
  viewAlpha: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  out: CompensatedHit,
): CompensatedHit | null {
  // Never rewind further than allowed, never into the future.
  let t = Math.min(viewTick, nowTick);
  let a = viewTick >= nowTick ? 0 : viewAlpha;
  if (nowTick - t > MAX_REWIND_TICKS) {
    t = nowTick - MAX_REWIND_TICKS;
    a = 0;
  }

  let best = maxDist;
  let found = false;
  for (const p of players) {
    if (p === shooter || !p.alive) continue;
    if (!sampleHistory(p, t, a, pose)) continue;
    if (rayVsPlayer(ox, oy, oz, dx, dy, dz, best, pose, hit)) {
      best = hit.distance;
      out.target = p;
      out.distance = hit.distance;
      out.head = hit.head;
      found = true;
    }
  }
  return found ? out : null;
}

/** Interpolated pose at tick + alpha. Falls back to the current state if history is missing. */
export function sampleHistory(p: ServerPlayer, tick: number, alpha: number, out: HitboxPose): boolean {
  const a = p.history.get(tick);
  const b = p.history.get(tick + 1);
  if (a && b && a.alive && b.alive) {
    out.x = a.pose.x + (b.pose.x - a.pose.x) * alpha;
    out.y = a.pose.y + (b.pose.y - a.pose.y) * alpha;
    out.z = a.pose.z + (b.pose.z - a.pose.z) * alpha;
    out.crouch = a.pose.crouch + (b.pose.crouch - a.pose.crouch) * alpha;
    return true;
  }
  const e = a ?? b;
  if (e) {
    if (!e.alive) return false;
    out.x = e.pose.x;
    out.y = e.pose.y;
    out.z = e.pose.z;
    out.crouch = e.pose.crouch;
    return true;
  }
  const m = p.sim.move;
  out.x = m.x;
  out.y = m.y;
  out.z = m.z;
  out.crouch = m.crouchBlend;
  return true;
}
