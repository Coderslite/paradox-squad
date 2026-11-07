export type Difficulty = "easy" | "normal" | "hard" | "insane";

export interface DifficultyProfile {
  /** Seconds between first seeing an enemy and being willing to shoot. */
  reaction: number;
  /** Initial aim error (degrees) on acquiring a target at ~20m; grows with distance. */
  aimError: number;
  /** Seconds for the aim error to shrink by ~63% while tracking. */
  trackTau: number;
  /** Max view turn rate (deg/s): no instant snaps. */
  turnRate: number;
  /** Vision cone (full angle, degrees) and range (m). */
  fov: number;
  sight: number;
  /** Burst length and pause between bursts (seconds). */
  burst: [number, number];
  pause: [number, number];
  /** 0..1 chance to use cover when hurt/reloading. */
  cover: number;
  flank: boolean;
  /** Chance to aim at the head instead of the chest. */
  headshot: number;
  /** Crouch-peek while shooting. */
  crouchPeek: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: { reaction: 0.7, aimError: 7, trackTau: 1.3, turnRate: 150, fov: 95, sight: 45, burst: [0.12, 0.3], pause: [0.6, 1.1], cover: 0.15, flank: false, headshot: 0, crouchPeek: 0 },
  normal: { reaction: 0.42, aimError: 4.5, trackTau: 0.75, turnRate: 260, fov: 110, sight: 60, burst: [0.2, 0.45], pause: [0.35, 0.7], cover: 0.5, flank: false, headshot: 0.1, crouchPeek: 0.15 },
  hard: { reaction: 0.26, aimError: 2.8, trackTau: 0.45, turnRate: 420, fov: 120, sight: 75, burst: [0.3, 0.7], pause: [0.2, 0.45], cover: 0.8, flank: true, headshot: 0.25, crouchPeek: 0.3 },
  insane: { reaction: 0.15, aimError: 1.6, trackTau: 0.3, turnRate: 700, fov: 130, sight: 90, burst: [0.4, 0.9], pause: [0.12, 0.3], cover: 1, flank: true, headshot: 0.4, crouchPeek: 0.4 },
};

const NAMES = [
  "Vex", "Kestrel", "Nyx", "Rook", "Sable", "Onyx", "Talon", "Ember", "Quill", "Havoc", "Zephyr", "Mako", "Jinx", "Raptor",
  "Cinder", "Wraith", "Atlas", "Nova", "Fang", "Echo-9", "Glitch", "Rune", "Saber", "Vortex", "Juno", "Kilo", "Pyre", "Drift",
];

export function botName(taken: Set<string>): string {
  const free = NAMES.filter((n) => !taken.has(n));
  const pool = free.length ? free : NAMES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
