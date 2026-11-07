import type { MapDef } from "./types";

/**
 * "Range": open flat test arena (60m x 60m) with a few low cover blocks. Used by the
 * network harness and handy for netcode / feel testing: long clear sightlines.
 */
export const RANGE: MapDef = {
  id: "range",
  name: "Range (Test)",
  killY: -20,
  halfExtent: 30,
  boxes: [
    { p: [0, -0.5, 0], s: [60, 1, 60], mat: "concrete", color: 0x6b6f76 },
    { p: [30.5, 3, 0], s: [1, 6, 60], mat: "concrete", color: 0x8a8f99 },
    { p: [-30.5, 3, 0], s: [1, 6, 60], mat: "concrete", color: 0x8a8f99 },
    { p: [0, 3, 30.5], s: [62, 6, 1], mat: "concrete", color: 0x8a8f99 },
    { p: [0, 3, -30.5], s: [62, 6, 1], mat: "concrete", color: 0x8a8f99 },
    { p: [-12, 0.5, 0], s: [3, 1, 0.6], mat: "concrete", color: 0x8a8f99 },
    { p: [12, 0.5, 0], s: [3, 1, 0.6], mat: "concrete", color: 0x8a8f99 },
    { p: [-20, 0.6, 10], s: [1.4, 1.2, 1.4], mat: "wood", color: 0xa88a5c },
    { p: [20, 0.6, -10], s: [1.4, 1.2, 1.4], mat: "wood", color: 0xa88a5c },
  ],
  spawns: [
    { team: 0, p: [-3, 0.05, -20], yaw: Math.PI },
    { team: 0, p: [3, 0.05, -20], yaw: Math.PI },
    { team: 1, p: [-3, 0.05, 20], yaw: 0 },
    { team: 1, p: [3, 0.05, 20], yaw: 0 },
    { team: -1, p: [-20, 0.05, 0], yaw: -Math.PI / 2 },
    { team: -1, p: [20, 0.05, 0], yaw: Math.PI / 2 },
  ],
};
