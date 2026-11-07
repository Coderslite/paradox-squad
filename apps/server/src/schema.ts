import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Replicated state: only what remote clients need to render and the scoreboard.
 * The owner's full movement state for reconciliation is sent separately (Ack message)
 * at full float64 precision.
 */
export const PlayerState = schema(
  {
    name: t.string().default(""),
    team: t.uint8().default(0),
    alive: t.boolean().default(false),
    connected: t.boolean().default(true),
    bot: t.boolean().default(false),
    health: t.uint8().default(100),
    kills: t.uint16().default(0),
    deaths: t.uint16().default(0),
    ping: t.uint16().default(0),
    seed: t.uint32().default(1),
    weapon: t.string().default("vk12"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    // 16-bit angles: ~0.0055° resolution at a quarter of float64's bytes.
    yaw: t.angle({ bits: 16 }),
    pitch: t.float32().default(0),
    crouch: t.float32().default(0),
    grounded: t.boolean().default(true),
    /** Anim bitflags (see shared Anim). */
    anim: t.uint8().default(0),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const GameState = schema(
  {
    /** Server simulation tick when the patch was produced; drives client interpolation. */
    tick: t.uint32().default(0),
    mode: t.string().default("tdm"),
    map: t.string().default("foundry"),
    phase: t.string().default("playing"),
    scoreA: t.uint16().default(0),
    scoreB: t.uint16().default(0),
    scoreLimit: t.uint16().default(50),
    /** Seconds remaining in the match (or until the next one while "ended"). */
    timeLeft: t.uint16().default(0),
    players: t.map(PlayerState),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
