import type { MapBox, MapDef, SpawnPoint } from "./types";

/**
 * "Foundry" greybox: a symmetric 3-lane TDM arena (~64m x 72m).
 * Team 0 spawns at -Z, team 1 at +Z. Every geometric feature exists to exercise
 * the movement kit: steps (0.3m) for step-up, 1.1m / 1.7m crates for mantling,
 * ramps for slope sliding, catwalks for verticality and long sightlines.
 */

const W = 32; // half width (X)
const L = 36; // half length (Z)
const WALL_H = 9;

const C_FLOOR = 0x6b6f76;
const C_WALL = 0x8a8f99;
const C_TEAM0 = 0x4f7cc9;
const C_TEAM1 = 0xc9714f;
const C_CRATE = 0xa88a5c;
const C_METAL = 0x5d6670;
const C_ACCENT = 0xd8c25a;

const boxes: MapBox[] = [];
const add = (b: MapBox): void => {
  boxes.push(b);
};

/** Adds a box and its mirror across Z = 0 (team-symmetric layout). */
function mirrored(b: MapBox, recolor?: [number, number]): void {
  add({ ...b, color: recolor ? recolor[0] : b.color });
  const r = b.r ? ([-b.r[0], -b.r[1], b.r[2]] as [number, number, number]) : undefined;
  add({ ...b, p: [b.p[0], b.p[1], -b.p[2]], ...(r ? { r } : {}), color: recolor ? recolor[1] : b.color });
}

// Floor + outer walls
add({ p: [0, -0.5, 0], s: [W * 2, 1, L * 2], mat: "concrete", color: C_FLOOR });
add({ p: [W + 0.5, WALL_H / 2, 0], s: [1, WALL_H, L * 2], mat: "concrete", color: C_WALL });
add({ p: [-W - 0.5, WALL_H / 2, 0], s: [1, WALL_H, L * 2], mat: "concrete", color: C_WALL });
add({ p: [0, WALL_H / 2, L + 0.5], s: [W * 2 + 2, WALL_H, 1], mat: "concrete", color: C_WALL });
add({ p: [0, WALL_H / 2, -L - 0.5], s: [W * 2 + 2, WALL_H, 1], mat: "concrete", color: C_WALL });

// --- Centre: raised platform with ramps, a mid-tower and cover ---
add({ p: [0, 0.75, 0], s: [12, 1.5, 10], mat: "concrete", color: C_WALL });
// Ramps up to the platform on the Z sides (slope ~17 degrees)
{
  const len = 5.2;
  const ang = Math.atan2(1.5, len);
  const hyp = Math.hypot(1.5, len);
  mirrored({ p: [0, 0.75 - 0.25 * Math.cos(ang), 5 + len / 2], s: [6, 0.5, hyp], r: [ang, 0, 0], mat: "concrete", color: C_ACCENT });
}
// Steps up the X sides (0.3m risers, tests autostep)
for (let i = 0; i < 5; i++) {
  const h = 0.3 * (i + 1);
  add({ p: [6 + 2.2 - i * 0.4, h / 2, 0], s: [0.4, h, 4], mat: "concrete", color: C_WALL });
  add({ p: [-6 - 2.2 + i * 0.4, h / 2, 0], s: [0.4, h, 4], mat: "concrete", color: C_WALL });
}
// Centre pillar cover on top of platform
add({ p: [0, 1.5 + 1.1, 0], s: [2, 2.2, 2], mat: "metal", color: C_METAL });
mirrored({ p: [-3.5, 1.5 + 0.55, 2.8], s: [1.6, 1.1, 0.6], mat: "wood", color: C_CRATE });
mirrored({ p: [3.5, 1.5 + 0.55, -2.8], s: [1.6, 1.1, 0.6], mat: "wood", color: C_CRATE });

// --- Side lanes (X = +-22): long corridors with a catwalk overhead ---
for (const sx of [-1, 1]) {
  const x = 22 * sx;
  // Lane divider walls with doorways
  mirrored({ p: [x - 6 * sx, 2.5, 20], s: [1, 5, 14], mat: "concrete", color: C_WALL });
  mirrored({ p: [x - 6 * sx, 2.5, 4.5], s: [1, 5, 5], mat: "concrete", color: C_WALL });
  // Catwalk (3.2m high) along the outer wall, reachable via stairs at each end
  add({ p: [x + 5.5 * sx, 3.1, 0], s: [4, 0.2, 40], mat: "metal", color: C_METAL });
  // Catwalk railing
  add({ p: [x + 3.6 * sx, 3.7, 0], s: [0.1, 1, 40], mat: "metal", color: C_METAL });
  // Stairs up to the catwalk (0.3m steps)
  for (let i = 0; i < 10; i++) {
    const h = 0.32 * (i + 1);
    mirrored({ p: [x + 5.5 * sx, h / 2, 20.225 + (9 - i) * 0.45], s: [4, h, 0.45], mat: "concrete", color: C_WALL });
  }
  // Mantle crates in the lane: 1.1m, 1.7m and a stacked pair
  mirrored({ p: [x, 0.55, 12], s: [1.6, 1.1, 1.6], mat: "wood", color: C_CRATE });
  mirrored({ p: [x - 1.4 * sx, 0.85, 26], s: [1.8, 1.7, 1.8], mat: "wood", color: C_CRATE });
  mirrored({ p: [x + 1.6 * sx, 0.55, 26.8], s: [1.4, 1.1, 1.4], mat: "wood", color: C_CRATE });
  // Low cover wall
  add({ p: [x, 0.5, 0], s: [3, 1, 0.5], mat: "concrete", color: C_WALL });
}

// --- Mid-field cover between lanes ---
mirrored({ p: [-9, 0.6, 12], s: [3.2, 1.2, 0.6], mat: "concrete", color: C_WALL });
mirrored({ p: [9, 0.6, 12], s: [3.2, 1.2, 0.6], mat: "concrete", color: C_WALL });
mirrored({ p: [-11, 1.4, 17], s: [1, 2.8, 1], mat: "metal", color: C_METAL });
mirrored({ p: [11, 1.4, 17], s: [1, 2.8, 1], mat: "metal", color: C_METAL });
mirrored({ p: [0, 0.45, 15], s: [2.4, 0.9, 1.2], mat: "wood", color: C_CRATE });
// Shipping containers (big sightline blockers)
mirrored({ p: [-6, 1.3, 22], s: [6, 2.6, 2.5], mat: "metal", color: C_METAL }, [C_TEAM1, C_TEAM0]);
mirrored({ p: [6, 1.3, 23.5], s: [2.5, 2.6, 6], mat: "metal", color: C_METAL }, [C_TEAM1, C_TEAM0]);

// --- Spawn rooms ---
// Spawn-room front walls leave a 12m opening that all spawn points face.
// mirrored() places the original at +Z (team 1's side) and the copy at -Z (team 0's side).
mirrored({ p: [-9.5, 2.5, 33], s: [7, 5, 1], mat: "concrete", color: C_WALL }, [C_TEAM1, C_TEAM0]);
mirrored({ p: [9.5, 2.5, 33], s: [7, 5, 1], mat: "concrete", color: C_WALL }, [C_TEAM1, C_TEAM0]);

const spawns: SpawnPoint[] = [];
for (let i = 0; i < 4; i++) {
  const x = -4.5 + i * 3;
  // Team 0 at -Z looking toward +Z (yaw = PI), team 1 at +Z looking toward -Z (yaw = 0).
  spawns.push({ team: 0, p: [x, 0.05, -34.5], yaw: Math.PI });
  spawns.push({ team: 1, p: [x, 0.05, 34.5], yaw: 0 });
}
const ffaSpots: [number, number, number][] = [
  [-22, 0.05, -10],
  [22, 0.05, 10],
  [3.5, 1.55, 0],
  [-14, 0.05, 28],
  [14, 0.05, -28],
  [27.5, 3.25, 8],
  [-27.5, 3.25, -8],
  [0, 0.05, -18],
];
for (const p of ffaSpots) spawns.push({ team: -1, p, yaw: Math.atan2(p[0], p[2]) });

export const FOUNDRY: MapDef = {
  id: "foundry",
  name: "Foundry (Greybox)",
  boxes,
  spawns,
  killY: -20,
  halfExtent: Math.max(W, L),
};
