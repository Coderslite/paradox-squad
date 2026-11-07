import { beforeAll, describe, expect, it } from "vitest";
import { FOUNDRY, RANGE } from "@paradox/shared";
import { getNavigation, initNavigation } from "../src/ai/navmesh";

beforeAll(async () => {
  await initNavigation();
});

describe("navmesh", () => {
  it("connects both team spawns on Foundry through the arena", () => {
    const nav = getNavigation(FOUNDRY);
    const a = FOUNDRY.spawns.find((s) => s.team === 0)!;
    const b = FOUNDRY.spawns.find((s) => s.team === 1)!;
    const path = nav.path({ x: a.p[0], y: a.p[1], z: a.p[2] }, { x: b.p[0], y: b.p[1], z: b.p[2] });
    expect(path.length).toBeGreaterThan(1);
    const end = path[path.length - 1]!;
    expect(Math.hypot(end.x - b.p[0], end.z - b.p[2])).toBeLessThan(1);
  });

  it("reaches the raised centre platform via its ramps/steps", () => {
    const nav = getNavigation(FOUNDRY);
    const path = nav.path({ x: 0, y: 0, z: -30 }, { x: 3.5, y: 1.5, z: 0 });
    const end = path[path.length - 1]!;
    expect(end.y).toBeGreaterThan(1.3);
  });

  it("finds random roam points", () => {
    const nav = getNavigation(RANGE);
    const p = nav.randomAround({ x: 0, y: 0, z: 0 }, 15);
    expect(p).not.toBeNull();
    expect(Math.abs(p!.y)).toBeLessThan(0.5);
  });
});
