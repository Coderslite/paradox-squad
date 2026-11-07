import { beforeAll, describe, expect, it } from "vitest";
import {
  Btn,
  CollisionWorld,
  DEFAULT_ENV,
  RANGE,
  copyMoveState,
  createInputCmd,
  createMoveState,
  initPhysics,
  simulatePlayerTick,
  TICK_DT,
  type MapDef,
} from "@paradox/shared";
import { BotBrain, type BotWorld } from "../src/ai/BotBrain";
import { getNavigation, initNavigation } from "../src/ai/navmesh";
import { ServerPlayer } from "../src/sim/serverPlayer";

beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
});

function setup(map: MapDef, botPos: [number, number], botYaw: number, enemyPos: [number, number]) {
  const world = new CollisionWorld(map);
  const bot = new ServerPlayer("bot", 1);
  const enemy = new ServerPlayer("enemy", 2);
  bot.team = 0;
  enemy.team = 1;
  bot.alive = enemy.alive = true;
  copyMoveState(bot.sim.move, createMoveState(botPos[0], 0.02, botPos[1]));
  copyMoveState(enemy.sim.move, createMoveState(enemyPos[0], 0.02, enemyPos[1]));
  bot.sim.weapon.equipTimer = 0;
  const brain = new BotBrain(bot, "normal");
  brain.onSpawn(botYaw);
  const ctx: BotWorld = { world, nav: getNavigation(map), cover: [], players: [bot, enemy], isEnemy: (a, b) => a.team !== b.team, now: 0 };
  return { world, bot, enemy, brain, ctx };
}

/** Run the bot for `seconds`, returning the time of its first shot (or -1). */
function run(s: ReturnType<typeof setup>, seconds: number): { firstShot: number; maxTurnPerTick: number } {
  const cmd = createInputCmd();
  let firstShot = -1;
  let lastYaw: number | null = null;
  let maxTurn = 0;
  for (let t = 0; t < seconds * 60; t++) {
    s.ctx.now = t * TICK_DT;
    s.brain.think(s.ctx, cmd);
    if (lastYaw !== null) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(cmd.yaw - lastYaw), Math.cos(cmd.yaw - lastYaw))));
    lastYaw = cmd.yaw;
    simulatePlayerTick(s.bot.sim, cmd, s.world, DEFAULT_ENV, true, s.bot.events);
    if (firstShot < 0 && cmd.buttons & Btn.Fire) firstShot = s.ctx.now;
  }
  return { firstShot, maxTurnPerTick: maxTurn };
}

describe("bot brain", () => {
  it("reacts with a human delay, turns without snapping, then shoots", () => {
    // Enemy 15m straight ahead (yaw 0 looks down -Z), in plain view.
    const s = setup(RANGE, [0, -10], 0, [0, -25]);
    const r = run(s, 3);
    expect(r.firstShot).toBeGreaterThan(0.25); // reaction time (normal ≈ 0.42s ± 25%)
    expect(r.firstShot).toBeLessThan(2.5);
    expect(r.maxTurnPerTick).toBeLessThan((260 * Math.PI) / 180 / 60 + 1e-6);
  });

  it("does not see or shoot through walls", () => {
    // A tall wall spanning the whole arena between them (no way around within the test).
    const walled: MapDef = { ...RANGE, id: "range-walled", boxes: [...RANGE.boxes, { p: [0, 2, -17], s: [60, 4, 1], mat: "concrete" }] };
    const s = setup(walled, [0, -10], 0, [0, -25]);
    const r = run(s, 3);
    expect(r.firstShot).toBe(-1);
    expect(s.brain.currentTarget).toBeNull();
  });
});
