/** Fixed simulation rate shared by client prediction and server authority. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Server snapshot (state patch) rate. */
export const SNAPSHOT_RATE = 30;
/** Remote entities render this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY_MS = 100;

/** Seconds of per-player state history kept on the server (Personal Rewind + lag compensation). */
export const HISTORY_SECONDS = 4.5;
export const HISTORY_TICKS = Math.ceil(HISTORY_SECONDS * TICK_RATE);
/** Hitscan is never rewound further than this, whatever the shooter claims. */
export const MAX_LAG_COMP_MS = 250;

/** Inputs per network message; older ones are resent for packet-loss redundancy. */
export const INPUT_REDUNDANCY = 3;
export const MAX_INPUT_QUEUE = 20;

export const PLAYER = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  eyeStand: 1.62,
  eyeCrouch: 1.0,
  headRadius: 0.14,
  maxHealth: 100,
} as const;

/**
 * Movement tuning. Units: metres, seconds. These were tuned for a responsive,
 * "modern arena" feel: ~0.1s to full speed, short slide, generous coyote time.
 */
export const MOVE = {
  runSpeed: 6.2,
  sprintSpeed: 8.6,
  crouchSpeed: 3.2,
  adsSpeedMult: 0.72,
  backwardMult: 0.85,
  groundAccel: 13,
  groundFriction: 8.5,
  stopSpeed: 2.5,
  airAccel: 2.4,
  airMaxGain: 6.2,
  gravity: 19.5,
  terminalVelocity: 40,
  jumpVelocity: 6.4,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  slideMinSpeed: 6.6,
  slideBoost: 3.2,
  slideMaxSpeed: 12.5,
  slideDuration: 0.85,
  slideFriction: 1.2,
  slideCooldown: 0.6,
  slideSteer: 1.5,
  crouchTransitionRate: 9,
  stepHeight: 0.42,
  snapDistance: 0.32,
  maxSlopeDeg: 50,
  mantleMinHeight: 0.5,
  mantleMaxHeight: 1.95,
  mantleReach: 0.75,
  mantleBaseTime: 0.16,
  mantleTimePerMetre: 0.1,
} as const;

/** Collision groups (Rapier InteractionGroups: high 16 bits membership, low 16 bits filter). */
export const GROUP_WORLD = 0x0001;
export const GROUP_PROBE = 0x0002;
export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);
