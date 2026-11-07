import { z } from "zod";
import type { InputCmd } from "./input";
import type { MoveState } from "./movement";

/** Message type ids. Numeric to keep the wire format small. */
export const C2S = {
  Input: 1,
  Ping: 2,
  Ready: 3,
  SwitchTeam: 4,
  Loadout: 5,
} as const;

export const S2C = {
  Pong: 101,
  /** To the shooter: confirmed hit (hit marker). */
  Hit: 102,
  /** To the victim: you took damage (direction indicator). */
  Damaged: 103,
  /** To everyone but the shooter: tracer + sound. */
  Shot: 104,
  /** To everyone: kill feed. */
  Kill: 105,
  /** To one player: you (re)spawned, hard-reset prediction. */
  Spawned: 106,
  Notice: 107,
  /** To one player: authoritative movement state after their last processed input. */
  Ack: 108,
} as const;

/**
 * Compact input tuple:
 * [seq, buttons, moveX*127, moveY*127, yaw, pitch, viewTick, viewAlpha*255, aimYaw, aimPitch]
 */
const finite = z.number().refine(Number.isFinite);
export const WireInput = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().min(0).max(0xffff),
  z.number().int().min(-127).max(127),
  z.number().int().min(-127).max(127),
  finite,
  finite,
  z.number().int().nonnegative(),
  z.number().int().min(0).max(255),
  finite,
  finite,
]);
export type WireInput = z.infer<typeof WireInput>;

export const InputMessage = z.object({ c: z.array(WireInput).min(1).max(8) });
export type InputMessage = z.infer<typeof InputMessage>;

export const PingMessage = z.object({ t: finite, rtt: z.number().min(0).max(10_000).optional() });
export const SwitchTeamMessage = z.object({ team: z.union([z.literal(0), z.literal(1)]) });
export const LoadoutMessage = z.object({ primary: z.enum(["vk12", "breacher"]) });

export const JoinOptions = z.object({
  name: z.string().trim().min(1).max(20).optional(),
  /** Set when creating a private room. */
  private: z.boolean().optional(),
  /** Map id; only honoured on room creation. */
  map: z.enum(["foundry", "range"]).optional(),
  /** Solo vs bots: the room fills with bots immediately instead of after a short wait. */
  vsAI: z.boolean().optional(),
  difficulty: z.enum(["easy", "normal", "hard", "insane"]).optional(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

export interface PongMessage {
  t: number;
  /** Server tick when the ping was handled. */
  st: number;
  /** Fraction of this client's input messages the server never received. */
  loss: number;
}

export interface HitMessage {
  target: string;
  dmg: number;
  head: boolean;
  kill: boolean;
}

export interface DamagedMessage {
  from: string;
  dmg: number;
  /** Attacker position for the direction indicator. */
  x: number;
  z: number;
}

export interface ShotMessage {
  id: string;
  w: string;
  /** Origin and up to 8 pellet end points in integer cm, flattened [x,y,z,...]. */
  o: [number, number, number];
  e: number[];
  /** Whether each pellet end point hit the world (for impact effects). 1 = world, 2 = player, 0 = nothing. */
  k: number[];
}

export interface KillMessage {
  killer: string;
  victim: string;
  weapon: string;
  head: boolean;
}

export interface SpawnedMessage {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Replicated animation flags (PlayerState.anim) so remote characters animate from real state. */
export const Anim = {
  Ads: 1 << 0,
  /** Fired recently: body squares up to the aim. */
  Combat: 1 << 1,
  Reloading: 1 << 2,
  Sprinting: 1 << 3,
  Sliding: 1 << 4,
} as const;

/** Max angle (rad) between camera look and shot direction (third-person convergence). */
export const MAX_AIM_DEVIATION = 0.6;

export function encodeInput(cmd: InputCmd): WireInput {
  return [
    cmd.seq,
    cmd.buttons,
    Math.round(cmd.moveX * 127),
    Math.round(cmd.moveY * 127),
    cmd.yaw,
    cmd.pitch,
    cmd.viewTick,
    Math.round(cmd.viewAlpha * 255),
    cmd.aimYaw,
    cmd.aimPitch,
  ];
}

export function decodeInput(w: WireInput, out: InputCmd): InputCmd {
  out.seq = w[0];
  out.buttons = w[1];
  out.moveX = w[2] / 127;
  out.moveY = w[3] / 127;
  out.yaw = w[4];
  // Never trust the client's pitch range.
  out.pitch = Math.max(-1.55, Math.min(1.55, w[5]));
  out.viewTick = w[6];
  out.viewAlpha = w[7] / 255;
  // The shot direction may converge on the crosshair target, but never stray far from
  // where the player is actually looking (no 180° snap shots).
  let dYaw = Math.atan2(Math.sin(w[8] - out.yaw), Math.cos(w[8] - out.yaw));
  dYaw = Math.max(-MAX_AIM_DEVIATION, Math.min(MAX_AIM_DEVIATION, dYaw));
  out.aimYaw = out.yaw + dYaw;
  out.aimPitch = Math.max(out.pitch - MAX_AIM_DEVIATION, Math.min(out.pitch + MAX_AIM_DEVIATION, Math.max(-1.55, Math.min(1.55, w[9]))));
  return out;
}

/** Field order for packing a {@link MoveState} into an Ack. Booleans travel as 0/1. */
const MOVE_FIELDS = [
  "x", "y", "z", "vx", "vy", "vz", "grounded", "crouched", "crouchBlend", "slideTime", "slideCooldown",
  "coyote", "jumpBuffer", "prevButtons", "mantleT", "mantleDur", "mantleFromX", "mantleFromY", "mantleFromZ",
  "mantleToX", "mantleToY", "mantleToZ",
] as const satisfies readonly (keyof MoveState)[];

/**
 * Ack payload: [ackSeq, serverTick, ammo, reserve, activeSlot, ...moveState].
 * Plain number array: msgpack keeps full float64 precision so replays match exactly.
 */
export type AckMessage = number[];
export const ACK_HEADER = 5;

export function packAck(ackSeq: number, tick: number, ammo: number, reserve: number, active: number, m: MoveState, out: number[]): AckMessage {
  out.length = ACK_HEADER + MOVE_FIELDS.length;
  out[0] = ackSeq;
  out[1] = tick;
  out[2] = ammo;
  out[3] = reserve;
  out[4] = active;
  for (let i = 0; i < MOVE_FIELDS.length; i++) {
    const v = m[MOVE_FIELDS[i]!];
    out[ACK_HEADER + i] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return out;
}

export function unpackAckMove(a: AckMessage, out: MoveState): MoveState {
  const o = out as unknown as Record<string, number | boolean>;
  for (let i = 0; i < MOVE_FIELDS.length; i++) {
    const k = MOVE_FIELDS[i]!;
    const v = a[ACK_HEADER + i] ?? 0;
    o[k] = k === "grounded" || k === "crouched" ? v !== 0 : v;
  }
  return out;
}

/** Shot end points travel as integer centimetres to keep messages small. */
export const toCm = (m: number): number => Math.round(m * 100);
export const fromCm = (cm: number): number => cm / 100;
