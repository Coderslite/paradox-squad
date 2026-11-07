import { beforeAll, describe, expect, it } from "vitest";
import {
  Btn,
  CollisionWorld,
  DEFAULT_ENV,
  FOUNDRY,
  MOVE,
  TICK_DT,
  createInputCmd,
  createMoveEvents,
  createMoveState,
  horizontalSpeed,
  initPhysics,
  simulateMove,
  type InputCmd,
  type MapDef,
  type MoveState,
} from "../src";

/** Flat floor plus a few test fixtures, laid out along -Z (yaw 0 = forward). */
const TEST_MAP: MapDef = {
  id: "test",
  name: "test",
  killY: -50,
  halfExtent: 100,
  spawns: [],
  boxes: [
    { p: [0, -0.5, 0], s: [200, 1, 200], mat: "concrete" },
    // Wall 10m ahead in lane x = 0
    { p: [0, 2, -10], s: [4, 4, 1], mat: "concrete" },
    // 0.3m step in lane x = 10
    { p: [10, 0.15, -6], s: [4, 0.3, 4], mat: "concrete" },
    // 1.2m crate in lane x = 20
    { p: [20, 0.6, -5], s: [3, 1.2, 3], mat: "wood" },
    // 3m wall in lane x = 30 (too tall to mantle)
    { p: [30, 1.5, -5], s: [3, 3, 3], mat: "concrete" },
  ],
};

let world: CollisionWorld;

beforeAll(async () => {
  await initPhysics();
  world = new CollisionWorld(TEST_MAP);
});

function cmd(partial: Partial<InputCmd> = {}): InputCmd {
  return { ...createInputCmd(), ...partial };
}

function run(s: MoveState, ticks: number, c: InputCmd | ((t: number) => InputCmd), w = world): void {
  const ev = createMoveEvents();
  for (let t = 0; t < ticks; t++) simulateMove(s, typeof c === "function" ? c(t) : c, w, TICK_DT, DEFAULT_ENV, ev);
}

function settled(x: number, z: number): MoveState {
  const s = createMoveState(x, 0.05, z);
  run(s, 10, cmd());
  return s;
}

describe("movement", () => {
  it("settles onto the floor and reports grounded", () => {
    const s = settled(0, 0);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeGreaterThan(-0.05);
    expect(s.y).toBeLessThan(0.1);
  });

  it("reaches run speed quickly and does not exceed it", () => {
    const s = settled(-50, 50);
    run(s, 12, cmd({ moveY: 1 }));
    expect(horizontalSpeed(s)).toBeGreaterThan(MOVE.runSpeed * 0.9);
    run(s, 60, cmd({ moveY: 1 }));
    expect(horizontalSpeed(s)).toBeLessThanOrEqual(MOVE.runSpeed + 1e-6);
  });

  it("sprints faster than running", () => {
    const s = settled(-50, 50);
    run(s, 60, cmd({ moveY: 1, buttons: Btn.Sprint }));
    expect(horizontalSpeed(s)).toBeGreaterThan(MOVE.runSpeed + 1);
  });

  it("is stopped by walls", () => {
    const s = settled(0, 0);
    run(s, 180, cmd({ moveY: 1 }));
    // Wall front face is at z = -9.5; capsule radius 0.35
    expect(s.z).toBeGreaterThan(-9.5 - 0.01);
    expect(s.z).toBeLessThan(-8.9);
  });

  it("steps up a 0.3m ledge without jumping", () => {
    const s = settled(10, 0);
    run(s, 60, cmd({ moveY: 1 }));
    expect(s.z).toBeLessThan(-4.5);
    expect(s.z).toBeGreaterThan(-8);
    expect(s.y).toBeGreaterThan(0.25);
  });

  it("jumps to roughly the designed apex", () => {
    const s = settled(-50, -50);
    let apex = 0;
    const ev = createMoveEvents();
    for (let t = 0; t < 90; t++) {
      simulateMove(s, cmd({ buttons: t < 2 ? Btn.Jump : 0 }), world, TICK_DT, DEFAULT_ENV, ev);
      apex = Math.max(apex, s.y);
    }
    const expected = (MOVE.jumpVelocity * MOVE.jumpVelocity) / (2 * MOVE.gravity);
    expect(apex).toBeGreaterThan(expected * 0.85);
    expect(apex).toBeLessThan(expected * 1.15);
    expect(s.grounded).toBe(true);
  });

  it("mantles onto a 1.2m crate when jumping into it", () => {
    const s = settled(20, -2);
    // 45 ticks: enough to mantle, not enough to walk off the far side of the crate.
    run(s, 45, (t) => cmd({ moveY: 1, buttons: t > 10 ? Btn.Jump : 0 }));
    expect(s.y).toBeGreaterThan(1.1);
    expect(s.grounded).toBe(true);
  });

  it("cannot mantle a 3m wall", () => {
    const s = settled(30, -2);
    run(s, 120, (t) => cmd({ moveY: 1, buttons: t > 10 ? Btn.Jump : 0 }));
    expect(s.y).toBeLessThan(1.5);
  });

  it("slides when crouching at sprint speed, then slows down", () => {
    const s = settled(-50, 50);
    run(s, 60, cmd({ moveY: 1, buttons: Btn.Sprint }));
    const before = horizontalSpeed(s);
    run(s, 1, cmd({ moveY: 1, buttons: Btn.Sprint | Btn.Crouch }));
    expect(s.slideTime).toBeGreaterThan(0);
    expect(horizontalSpeed(s)).toBeGreaterThan(before);
    run(s, 120, cmd({ moveY: 1, buttons: Btn.Sprint | Btn.Crouch }));
    expect(s.slideTime).toBe(0);
    expect(horizontalSpeed(s)).toBeCloseTo(MOVE.crouchSpeed, 2);
  });

  it("sphere-casts against walls for the camera spring arm", () => {
    // From z = -5 toward the wall face at z = -9.5, sphere radius 0.2
    const d = world.castSphere(0, 2, -5, 0, 0, -1, 10, 0.2);
    expect(d).toBeCloseTo(4.3, 1);
    expect(world.castSphere(0, 2, -5, 0, 0, 1, 10, 0.2)).toBe(10);
  });

  it("is deterministic across independent worlds (client vs server)", async () => {
    const other = new CollisionWorld(FOUNDRY);
    const mine = new CollisionWorld(FOUNDRY);
    const script = (t: number): InputCmd =>
      cmd({
        seq: t,
        moveY: t % 200 < 150 ? 1 : -0.5,
        moveX: Math.sin(t * 0.05),
        yaw: t * 0.013,
        buttons: (t % 47 === 0 ? Btn.Jump : 0) | (t % 300 > 200 ? Btn.Sprint : 0) | (t % 300 === 260 ? Btn.Crouch : 0),
      });
    const a = createMoveState(-4.5, 0.05, -34.5);
    const b = createMoveState(-4.5, 0.05, -34.5);
    run(a, 1200, script, mine);
    run(b, 1200, script, other);
    expect(b).toEqual(a);
    other.dispose();
    mine.dispose();
  });
});
