import { FOUNDRY } from "./foundry";
import { RANGE } from "./range";
import type { MapDef } from "./types";

export const MAPS: Record<string, MapDef> = { [FOUNDRY.id]: FOUNDRY, [RANGE.id]: RANGE };

/** Map by id, falling back to Foundry for unknown ids. */
export const getMap = (id: string | undefined): MapDef => (id && MAPS[id]) || FOUNDRY;
