export type SurfaceMaterial = "concrete" | "metal" | "wood" | "dirt" | "glass";

/** An oriented box: the only collision primitive greybox maps need. */
export interface MapBox {
  /** Centre position. */
  p: [number, number, number];
  /** Full size (width, height, depth). */
  s: [number, number, number];
  /** Euler rotation in radians (XYZ order). */
  r?: [number, number, number];
  mat: SurfaceMaterial;
  /** Greybox tint; ignored once the art pass replaces the visual set. */
  color?: number;
}

export interface SpawnPoint {
  /** 0 / 1 for team spawns, -1 for free-for-all. */
  team: 0 | 1 | -1;
  p: [number, number, number];
  yaw: number;
}

export interface MapDef {
  id: string;
  name: string;
  boxes: MapBox[];
  spawns: SpawnPoint[];
  /** Players below this height are killed (fell out of the map). */
  killY: number;
  /** Half-extent of the playable square, used for the minimap and shadow frustum. */
  halfExtent: number;
}
