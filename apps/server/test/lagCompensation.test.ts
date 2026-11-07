import { describe, expect, it } from "vitest";
import { MAX_INPUT_QUEUE, MAX_LAG_COMP_MS, TICK_RATE, createInputCmd } from "@paradox/shared";
import { lagCompensatedRaycast, sampleHistory, type CompensatedHit } from "../src/sim/lagCompensation";
import { ServerPlayer } from "../src/sim/serverPlayer";

/** Target strafes along +X at 6 m/s, 20m down -Z from a shooter at the origin. */
function setup(ticks: number): { shooter: ServerPlayer; target: ServerPlayer; now: number } {
  const shooter = new ServerPlayer("shooter", 1);
  const target = new ServerPlayer("target", 2);
  shooter.alive = target.alive = true;
  for (let t = 1; t <= ticks; t++) {
    target.sim.move.x = (t / TICK_RATE) * 6;
    target.sim.move.z = -20;
    shooter.record(t, 0, 0);
    target.record(t, 0, 0);
  }
  return { shooter, target, now: ticks };
}

const out: CompensatedHit = { target: null as unknown as ServerPlayer, distance: 0, head: false };

/** Ray from the shooter's eye toward a point at chest height. */
function shoot(shooter: ServerPlayer, players: ServerPlayer[], now: number, viewTick: number, alpha: number, aimX: number) {
  const ox = 0;
  const oy = 1.62;
  const oz = 0;
  const dx = aimX - ox;
  const dy = 1.1 - oy;
  const dz = -20 - oz;
  const len = Math.hypot(dx, dy, dz);
  return lagCompensatedRaycast(shooter, players, now, viewTick, alpha, ox, oy, oz, dx / len, dy / len, dz / len, 100, out);
}

describe("lag compensation", () => {
  it("hits the target where the shooter saw it (rewound), not where it is now", () => {
    const { shooter, target, now } = setup(120);
    const viewTick = now - 9; // ~150ms ago
    const seenX = (viewTick / TICK_RATE) * 6;
    const nowX = (now / TICK_RATE) * 6;
    expect(nowX - seenX).toBeGreaterThan(0.8); // target has moved well out of the old spot

    expect(shoot(shooter, [shooter, target], now, viewTick, 0, seenX)?.target).toBe(target);
    // Aiming at the *current* position with an old view tick misses: the server is fair to the target too.
    expect(shoot(shooter, [shooter, target], now, viewTick, 0, nowX)).toBeNull();
  });

  it("interpolates between history ticks using viewAlpha", () => {
    const { target } = setup(60);
    const pose = { x: 0, y: 0, z: 0, crouch: 0 };
    sampleHistory(target, 30, 0.5, pose);
    expect(pose.x).toBeCloseTo((30.5 / TICK_RATE) * 6, 6);
  });

  it("clamps rewinds beyond the maximum lag compensation window", () => {
    const { shooter, target, now } = setup(200);
    const maxTicks = Math.ceil((MAX_LAG_COMP_MS / 1000) * TICK_RATE);
    const claimedTick = now - 120; // claims 2s of latency
    const claimedX = (claimedTick / TICK_RATE) * 6;
    const clampedX = ((now - maxTicks) / TICK_RATE) * 6;
    expect(shoot(shooter, [shooter, target], now, claimedTick, 0, claimedX)).toBeNull();
    expect(shoot(shooter, [shooter, target], now, claimedTick, 0, clampedX)?.target).toBe(target);
  });

  it("never hits the shooter or dead players", () => {
    const { shooter, target, now } = setup(30);
    target.alive = false;
    expect(shoot(shooter, [shooter, target], now, now, 0, (now / TICK_RATE) * 6)).toBeNull();
  });
});

describe("input queue", () => {
  it("ignores redundant copies and caps flooding", () => {
    const p = new ServerPlayer("p", 1);
    const c = createInputCmd();
    for (const seq of [0, 1, 2, 1, 2, 3]) {
      c.seq = seq;
      p.enqueue(c);
    }
    expect(p.queueLength).toBe(4);
    for (let seq = 4; seq < 100; seq++) {
      c.seq = seq;
      p.enqueue(c);
    }
    expect(p.queueLength).toBe(MAX_INPUT_QUEUE);
    const taken: ReturnType<typeof createInputCmd>[] = [];
    expect(p.takeInputs(taken)).toBe(2); // backed up: catches up two per tick
    expect(taken[1]!.seq).toBe(taken[0]!.seq + 1);
  });
});
