export type EraId = "prehistoric" | "medieval" | "ww2" | "future";
export type WeaponId = "vk12" | "p9" | "breacher";
export type FireMode = "auto" | "semi";

export interface DamageProfile {
  base: number;
  headMult: number;
  /** Full damage up to this distance (m). */
  falloffStart: number;
  /** Minimum damage from this distance on. */
  falloffEnd: number;
  /** Damage multiplier at falloffEnd and beyond. */
  minMult: number;
}

export interface SpreadProfile {
  /** Cone half-angles in degrees. */
  hip: number;
  ads: number;
  moving: number;
  air: number;
  crouchMult: number;
  /** Extra spread per consecutive shot, decays with recovery. */
  perShot: number;
  maxBloom: number;
}

export interface RecoilProfile {
  /**
   * Fixed, learnable pattern: [yaw, pitch] kick in degrees for each shot of a spray.
   * Positive pitch kicks up, positive yaw kicks right. The last entry repeats.
   */
  pattern: readonly (readonly [number, number])[];
  adsMult: number;
  /** Degrees per second the view drifts back toward the pre-spray aim once you stop firing. */
  recoverySpeed: number;
  /** Fraction of the accumulated vertical kick that recovery returns. */
  recoveryFraction: number;
  /** Seconds without firing before the pattern index resets. */
  resetTime: number;
  /** Cosmetic view-model kick strength. */
  visualKick: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 0 | 1;
  fireMode: FireMode;
  rpm: number;
  pellets: number;
  damage: DamageProfile;
  spread: SpreadProfile;
  recoil: RecoilProfile;
  magSize: number;
  reserve: number;
  reloadTime: number;
  /** Reload from empty (adds a bolt / slide release). */
  reloadEmptyTime: number;
  /** Fraction of the reload after which the magazine counts as refilled. */
  reloadCommit: number;
  equipTime: number;
  adsTime: number;
  /** ADS zoom as a multiplier on the base FOV. */
  adsZoom: number;
  range: number;
  /** Optional projectile ballistics (e.g. crossbow in the Medieval era). Hitscan if absent. */
  projectile?: { speed: number; gravity: number };
  /** Sound bank id used by the client audio system. */
  sound: string;
}

/** Per-era override. Each slot morphs between eras (milestone 5). */
export type WeaponOverride = Partial<Omit<WeaponDef, "id" | "slot">> & { model?: string };

/** Degrees of recoil per shot. Starts vertical, then a readable S-curve drift. */
const RIFLE_PATTERN: readonly (readonly [number, number])[] = [
  [0, 0.55], [0.05, 0.6], [-0.05, 0.62], [0.1, 0.6], [0.18, 0.55], [0.22, 0.5], [0.25, 0.45], [0.2, 0.42],
  [0.1, 0.4], [-0.05, 0.38], [-0.2, 0.36], [-0.3, 0.34], [-0.32, 0.32], [-0.28, 0.3], [-0.2, 0.3], [-0.05, 0.3],
  [0.1, 0.3], [0.22, 0.28], [0.28, 0.28], [0.25, 0.28], [0.15, 0.27], [0, 0.27], [-0.15, 0.27], [-0.25, 0.26],
  [-0.25, 0.26], [-0.15, 0.26], [0, 0.26], [0.15, 0.25], [0.2, 0.25], [0.1, 0.25],
];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  vk12: {
    id: "vk12",
    name: "VK-12 Chronorifle",
    slot: 0,
    fireMode: "auto",
    rpm: 720,
    pellets: 1,
    damage: { base: 25, headMult: 1.6, falloffStart: 28, falloffEnd: 60, minMult: 0.7 },
    spread: { hip: 2.4, ads: 0.08, moving: 1.6, air: 3.5, crouchMult: 0.75, perShot: 0.12, maxBloom: 1.4 },
    recoil: { pattern: RIFLE_PATTERN, adsMult: 0.8, recoverySpeed: 9, recoveryFraction: 0.65, resetTime: 0.28, visualKick: 1 },
    magSize: 30,
    reserve: 150,
    reloadTime: 1.9,
    reloadEmptyTime: 2.35,
    reloadCommit: 0.72,
    equipTime: 0.45,
    adsTime: 0.2,
    adsZoom: 0.72,
    range: 300,
    sound: "rifle",
  },
  p9: {
    id: "p9",
    name: "P9 Tempo",
    slot: 1,
    fireMode: "semi",
    rpm: 420,
    pellets: 1,
    damage: { base: 32, headMult: 1.75, falloffStart: 15, falloffEnd: 35, minMult: 0.6 },
    spread: { hip: 1.5, ads: 0.15, moving: 1.0, air: 2.5, crouchMult: 0.8, perShot: 0.3, maxBloom: 1.2 },
    recoil: { pattern: [[0, 1.2], [0.15, 1.1], [-0.15, 1.0]], adsMult: 0.85, recoverySpeed: 14, recoveryFraction: 0.9, resetTime: 0.35, visualKick: 1.4 },
    magSize: 12,
    reserve: 72,
    reloadTime: 1.35,
    reloadEmptyTime: 1.6,
    reloadCommit: 0.7,
    equipTime: 0.3,
    adsTime: 0.15,
    adsZoom: 0.85,
    range: 200,
    sound: "pistol",
  },
  breacher: {
    id: "breacher",
    name: "Breacher-8",
    slot: 0,
    fireMode: "semi",
    rpm: 85,
    pellets: 8,
    damage: { base: 14, headMult: 1.25, falloffStart: 7, falloffEnd: 20, minMult: 0.25 },
    spread: { hip: 4.8, ads: 3.6, moving: 0.6, air: 1.2, crouchMult: 0.9, perShot: 0, maxBloom: 0 },
    recoil: { pattern: [[0, 3.2], [0.4, 3.0]], adsMult: 0.9, recoverySpeed: 12, recoveryFraction: 0.85, resetTime: 0.8, visualKick: 2.2 },
    magSize: 6,
    reserve: 36,
    reloadTime: 2.6,
    reloadEmptyTime: 3.0,
    reloadCommit: 0.8,
    equipTime: 0.5,
    adsTime: 0.22,
    adsZoom: 0.85,
    range: 80,
    sound: "shotgun",
  },
};

/** Damage at a given distance, including headshot multiplier. */
export function damageAt(def: WeaponDef, distance: number, headshot: boolean): number {
  const d = def.damage;
  let mult = 1;
  if (distance > d.falloffStart) {
    const t = Math.min(1, (distance - d.falloffStart) / Math.max(1e-3, d.falloffEnd - d.falloffStart));
    mult = 1 + (d.minMult - 1) * t;
  }
  return Math.round(d.base * mult * (headshot ? d.headMult : 1));
}

export const fireInterval = (def: WeaponDef): number => 60 / def.rpm;
