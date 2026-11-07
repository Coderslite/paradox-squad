import { describe, expect, it } from "vitest";
import {
  Btn,
  INVITE_ALPHABET,
  TICK_DT,
  TickRing,
  WEAPONS,
  createInputCmd,
  createMoveState,
  createWeaponEvents,
  createWeaponState,
  damageAt,
  decodeInput,
  encodeInput,
  generateInviteCode,
  isValidInviteCode,
  mulberry32,
  normalizeInviteCode,
  rayVsPlayer,
  shotDirection,
  shotOrigin,
  MAX_AIM_DEVIATION,
  simulateWeapon,
} from "../src";

describe("TickRing", () => {
  it("stores and retrieves by tick and forgets overwritten ticks", () => {
    const ring = new TickRing(8, () => ({ v: 0 }));
    for (let t = 0; t < 20; t++) ring.write(t).v = t * 10;
    expect(ring.get(19)?.v).toBe(190);
    expect(ring.get(12)?.v).toBe(120);
    expect(ring.get(11)).toBeNull();
    expect(ring.oldestTick).toBe(12);
    expect(ring.floor(25)?.v).toBe(190);
  });
});

describe("hitboxes", () => {
  const pose = { x: 0, y: 0, z: -10, crouch: 0 };
  const hit = { distance: 0, head: false };

  it("hits the head at eye level", () => {
    expect(rayVsPlayer(0, 1.68, 0, 0, 0, -1, 100, pose, hit)).toBe(true);
    expect(hit.head).toBe(true);
    expect(hit.distance).toBeCloseTo(10 - 0.14, 2);
  });

  it("hits the body at chest level", () => {
    expect(rayVsPlayer(0, 1.1, 0, 0, 0, -1, 100, pose, hit)).toBe(true);
    expect(hit.head).toBe(false);
  });

  it("misses beside the player and above a crouched head", () => {
    expect(rayVsPlayer(0.6, 1.1, 0, 0, 0, -1, 100, pose, hit)).toBe(false);
    expect(rayVsPlayer(0, 1.68, 0, 0, 0, -1, 100, { ...pose, crouch: 1 }, hit)).toBe(false);
  });

  it("respects max distance", () => {
    expect(rayVsPlayer(0, 1.1, 0, 0, 0, -1, 5, pose, hit)).toBe(false);
  });
});

describe("damage falloff", () => {
  const rifle = WEAPONS.vk12;
  it("deals full damage up close and min damage far away", () => {
    expect(damageAt(rifle, 5, false)).toBe(25);
    expect(damageAt(rifle, 200, false)).toBe(Math.round(25 * 0.7));
    expect(damageAt(rifle, 5, true)).toBe(40);
  });
  it("interpolates linearly inside the falloff band", () => {
    const mid = (rifle.damage.falloffStart + rifle.damage.falloffEnd) / 2;
    expect(damageAt(rifle, mid, false)).toBe(Math.round(25 * 0.85));
  });
});

describe("weapon simulation", () => {
  it("enforces fire rate and magazine size", () => {
    const w = createWeaponState("vk12", "p9");
    const move = createMoveState();
    move.grounded = true;
    const ev = createWeaponEvents();
    const c = { ...createInputCmd(), buttons: Btn.Fire };
    let shots = 0;
    for (let t = 0; t < 60 * 10; t++) {
      simulateWeapon(w, c, move, true, TICK_DT, ev);
      shots += ev.shots;
      if (t === 60 + 30) {
        // 1s of fire after the 0.45s equip: 720rpm = 12/s
        expect(shots).toBeGreaterThanOrEqual(11);
        expect(shots).toBeLessThanOrEqual(13);
      }
    }
    // 10 seconds of holding fire: mag, auto-reloads, keeps going but never exceeds ammo supply
    expect(shots).toBeLessThanOrEqual(30 + 150);
    expect(w.slots[0].ammo + w.slots[0].reserve + shots).toBe(180);
  });

  it("semi-auto needs a trigger release per shot", () => {
    const w = createWeaponState("vk12", "p9");
    w.active = 1;
    w.equipTimer = 0;
    const move = createMoveState();
    const ev = createWeaponEvents();
    let shots = 0;
    for (let t = 0; t < 120; t++) {
      simulateWeapon(w, { ...createInputCmd(), buttons: Btn.Fire }, move, true, TICK_DT, ev);
      shots += ev.shots;
    }
    expect(shots).toBe(1);
  });

  it("produces identical spread directions for the same seed", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    shotDirection(0.3, 0.1, 3, 1234, 7, 2, a);
    shotDirection(0.3, 0.1, 3, 1234, 7, 2, b);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 6);
  });
});

describe("protocol", () => {
  it("round-trips inputs through the wire format", () => {
    const c = { ...createInputCmd(), seq: 42, buttons: Btn.Fire | Btn.Jump, moveX: -1, moveY: 1, yaw: 1.234, pitch: -0.5, viewTick: 900, viewAlpha: 0.5 };
    const d = decodeInput(encodeInput(c), createInputCmd());
    expect(d.seq).toBe(42);
    expect(d.buttons).toBe(c.buttons);
    expect(d.moveX).toBe(-1);
    expect(d.yaw).toBe(1.234);
    expect(d.viewAlpha).toBeCloseTo(0.5, 2);
  });

  it("clamps the shot direction to stay near the look direction (no snap shots)", () => {
    const c = { ...createInputCmd(), yaw: 0, pitch: 0, aimYaw: Math.PI, aimPitch: 1.5 };
    const d = decodeInput(encodeInput(c), createInputCmd());
    expect(Math.abs(d.aimYaw)).toBeCloseTo(MAX_AIM_DEVIATION, 6);
    expect(d.aimPitch).toBeCloseTo(MAX_AIM_DEVIATION, 6);
    const ok = decodeInput(encodeInput({ ...c, aimYaw: 0.1, aimPitch: -0.05 }), createInputCmd());
    expect(ok.aimYaw).toBeCloseTo(0.1, 9);
    expect(ok.aimPitch).toBeCloseTo(-0.05, 9);
  });
});

describe("shot origin", () => {
  it("fires from the eye in first person and from the shoulder in third person", () => {
    const m = createMoveState(0, 0, 0);
    const o = { x: 0, y: 0, z: 0 };
    shotOrigin(m, 0, 0, o);
    expect(o).toEqual({ x: 0, y: 1.62, z: 0 });
    shotOrigin(m, 0, Btn.ThirdPerson, o);
    // yaw 0 looks down -Z, so right is +X and forward is -Z
    expect(o.x).toBeCloseTo(0.24, 6);
    expect(o.z).toBeCloseTo(-0.35, 6);
    shotOrigin(m, 0, Btn.ThirdPerson | Btn.ShoulderLeft, o);
    expect(o.x).toBeCloseTo(-0.24, 6);
  });
});

describe("invite codes", () => {
  it("generates valid 6-character codes from the unambiguous alphabet", () => {
    const rng = mulberry32(99);
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateInviteCode(() => Math.floor(rng() * 2 ** 32));
      expect(isValidInviteCode(code)).toBe(true);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
      codes.add(code);
    }
    expect(codes.size).toBeGreaterThan(995);
    expect(isValidInviteCode(generateInviteCode())).toBe(true);
  });

  it("normalizes pasted codes and rejects ambiguous characters", () => {
    expect(normalizeInviteCode("abc-xyz")).toBe("ABCXYZ");
    expect(isValidInviteCode("ABCDE0")).toBe(false);
    expect(isValidInviteCode("ABCDE")).toBe(false);
  });
});
