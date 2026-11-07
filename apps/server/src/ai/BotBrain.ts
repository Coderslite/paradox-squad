import {
  Btn,
  DEG2RAD,
  TICK_DT,
  activeDef,
  createRayHit,
  eyeHeight,
  type CollisionWorld,
  type InputCmd,
  type RayHit,
} from "@paradox/shared";
import type { ServerPlayer } from "../sim/serverPlayer";
import { hiddenFrom } from "./cover";
import { DIFFICULTY, type Difficulty, type DifficultyProfile } from "./difficulty";
import type { Navigation, Point } from "./navmesh";

export interface BotWorld {
  world: CollisionWorld;
  nav: Navigation;
  cover: Point[];
  players: Iterable<ServerPlayer>;
  isEnemy(a: ServerPlayer, b: ServerPlayer): boolean;
  /** Seconds (monotonic). */
  now: number;
}

type Mode = "roam" | "engage" | "hunt" | "cover";

const PERCEPTION_INTERVAL = 0.1;
const HEARING_RANGE = 45;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A server-side bot. Produces one InputCmd per tick, exactly like a human client, so bots
 * use the same movement, weapons, hit detection and replication as everyone else.
 */
export class BotBrain {
  readonly profile: DifficultyProfile;
  private mode: Mode = "roam";
  private target: ServerPlayer | null = null;
  private targetVisible = false;
  private lastKnown: Point | null = null;
  private lastSeenAt = -Infinity;
  private reactionUntil = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private path: Point[] = [];
  private pathIdx = 0;
  private goal: Point | null = null;
  private repathAt = 0;
  private perceiveAt = 0;
  private strafe = 0;
  private strafeUntil = 0;
  private crouchUntil = 0;
  private burstUntil = 0;
  private pauseUntil = 0;
  private triggerPrev = false;
  private stuckCheckAt = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private jumpUntil = 0;
  private lookAroundAt = 0;
  private lookYaw = 0;
  private coverUntil = 0;
  private flankSide = Math.random() < 0.5 ? -1 : 1;
  private readonly hit: RayHit = createRayHit();
  /** Teammate bots engaging the same target (set by the room for flanking). */
  flanking = false;

  constructor(
    readonly self: ServerPlayer,
    difficulty: Difficulty,
  ) {
    this.profile = DIFFICULTY[difficulty];
  }

  get currentTarget(): ServerPlayer | null {
    return this.targetVisible ? this.target : null;
  }

  /** A gunshot at (x, z): investigate if idle. */
  hear(x: number, y: number, z: number): void {
    if (this.targetVisible) return;
    const m = this.self.sim.move;
    if (Math.hypot(x - m.x, z - m.z) > HEARING_RANGE) return;
    this.lastKnown = { x, y, z };
    if (this.mode === "roam") {
      this.mode = "hunt";
      this.lastSeenAt = Number.NEGATIVE_INFINITY;
      this.goal = null;
    }
  }

  onSpawn(yaw: number): void {
    this.mode = "roam";
    this.target = null;
    this.targetVisible = false;
    this.path = [];
    this.goal = null;
    this.aimYaw = yaw;
    this.aimPitch = 0;
    this.lookYaw = yaw;
  }

  think(ctx: BotWorld, out: InputCmd): void {
    const sp = this.self;
    const m = sp.sim.move;
    const now = ctx.now;
    out.buttons = 0;
    out.moveX = 0;
    out.moveY = 0;
    if (!sp.alive) {
      out.yaw = this.aimYaw;
      out.pitch = this.aimPitch;
      out.aimYaw = out.yaw;
      out.aimPitch = out.pitch;
      return;
    }

    if (now >= this.perceiveAt) {
      this.perceiveAt = now + PERCEPTION_INTERVAL;
      this.perceive(ctx);
    }

    const w = sp.sim.weapon;
    const slot = w.slots[w.active];
    const def = activeDef(w);
    const lowHealth = sp.health < 40;
    const reloading = w.reloadTimer > 0;

    // ---------------- Mode transitions ----------------
    if (this.targetVisible && this.target) {
      if ((lowHealth || reloading) && Math.random() < this.profile.cover * TICK_DT * 4 && now > this.coverUntil) {
        if (this.findCover(ctx)) this.mode = "cover";
      }
      if (this.mode !== "cover") this.mode = "engage";
    } else if (this.mode === "engage") {
      this.mode = this.lastKnown ? "hunt" : "roam";
      this.goal = null;
    }
    if (this.mode === "hunt" && now - this.lastSeenAt > 7) {
      this.mode = "roam";
      this.goal = null;
    }
    if (this.mode === "cover" && (now > this.coverUntil || (!reloading && !lowHealth && this.targetVisible))) {
      this.mode = this.targetVisible ? "engage" : "roam";
      this.goal = null;
    }

    // ---------------- Movement goal ----------------
    let wantSprint = false;
    if (this.mode === "roam") {
      if (!this.goal || this.reached(m, this.goal, 1.5) || this.path.length === 0) this.pickRoamGoal(ctx);
      wantSprint = true;
    } else if (this.mode === "hunt" && this.lastKnown) {
      if (!this.goal || now > this.repathAt) this.setGoal(ctx, this.lastKnown);
      if (this.reached(m, this.lastKnown, 2)) {
        this.lastKnown = null;
        this.mode = "roam";
      }
    } else if (this.mode === "engage" && this.target) {
      const t = this.target.sim.move;
      const dist = Math.hypot(t.x - m.x, t.z - m.z);
      const ideal = def.pellets > 1 ? 6 : 18;
      const weak = this.target.health < 40;
      if (now > this.repathAt) {
        if (this.flanking && this.profile.flank && dist > 8) {
          // Swing wide to the target's side instead of walking straight at them.
          const fx = -(t.z - m.z) / Math.max(dist, 0.1);
          const fz = (t.x - m.x) / Math.max(dist, 0.1);
          this.setGoal(ctx, { x: t.x + fx * 9 * this.flankSide, y: t.y, z: t.z + fz * 9 * this.flankSide });
        } else if (dist > ideal + 10 || (weak && dist > 5)) this.setGoal(ctx, { x: t.x, y: t.y, z: t.z });
        else if (dist < ideal * 0.4) {
          // Too close: back off a little.
          this.setGoal(ctx, { x: m.x - (t.x - m.x) * 0.5, y: m.y, z: m.z - (t.z - m.z) * 0.5 });
        } else {
          this.path = [];
          this.goal = null;
        }
        this.repathAt = now + rand(0.6, 1.2);
      }
    }

    // ---------------- Aim ----------------
    const dt = TICK_DT;
    let desiredYaw: number;
    let desiredPitch: number;
    const eyeY = m.y + eyeHeight(m);
    if ((this.mode === "engage" || (this.mode === "cover" && this.targetVisible)) && this.target) {
      const t = this.target.sim.move;
      const ty = t.y + (this.aimHead ? eyeHeight(t) + 0.05 : eyeHeight(t) * 0.68);
      const dx = t.x - m.x;
      const dz = t.z - m.z;
      desiredYaw = Math.atan2(-dx, -dz) + this.errYaw;
      desiredPitch = Math.atan2(ty - eyeY, Math.hypot(dx, dz)) + this.errPitch;
      // Error shrinks while tracking; a little jitter keeps it human.
      const decay = Math.exp(-dt / this.profile.trackTau);
      this.errYaw = this.errYaw * decay + (Math.random() - 0.5) * 0.0015;
      this.errPitch = this.errPitch * decay + (Math.random() - 0.5) * 0.001;
    } else {
      // Look along the path, occasionally glancing around.
      const next = this.path[this.pathIdx];
      if (next && Math.hypot(next.x - m.x, next.z - m.z) > 0.3) this.lookYaw = Math.atan2(-(next.x - m.x), -(next.z - m.z));
      if (now > this.lookAroundAt) {
        this.lookAroundAt = now + rand(2, 5);
        if (!next) this.lookYaw += rand(-1.2, 1.2);
      }
      desiredYaw = this.lookYaw;
      desiredPitch = 0;
    }
    const maxTurn = this.profile.turnRate * DEG2RAD * dt;
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, wrap(desiredYaw - this.aimYaw)));
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, desiredPitch - this.aimPitch));
    this.aimPitch = Math.max(-1.4, Math.min(1.4, this.aimPitch));
    out.yaw = this.aimYaw;
    out.pitch = this.aimPitch;
    out.aimYaw = this.aimYaw;
    out.aimPitch = this.aimPitch;

    // ---------------- Fire ----------------
    let fire = false;
    if (this.mode !== "roam" && this.targetVisible && this.target && now > this.reactionUntil && slot.ammo > 0 && !reloading) {
      const t = this.target.sim.move;
      const dist = Math.hypot(t.x - m.x, t.z - m.z);
      const trueYaw = Math.atan2(-(t.x - m.x), -(t.z - m.z));
      const off = Math.abs(wrap(trueYaw - this.aimYaw));
      // Only pull the trigger when roughly on target (wider tolerance up close).
      const tolerance = Math.atan2(0.5, Math.max(dist, 1)) + 0.02;
      const inRange = dist < def.range * 0.8 && (def.pellets === 1 || dist < 18);
      if (off < tolerance && inRange) {
        if (now < this.burstUntil) fire = true;
        else if (now > this.pauseUntil) {
          // Longer pauses at long range (less spray, more taps).
          const rangeK = 1 + Math.max(0, dist - 30) / 25;
          this.burstUntil = now + rand(...this.profile.burst) / rangeK;
          this.pauseUntil = this.burstUntil + rand(...this.profile.pause) * rangeK;
          fire = true;
        }
      }
    }
    // Semi-auto weapons need trigger releases between shots.
    if (fire && def.fireMode === "semi" && this.triggerPrev) fire = false;
    this.triggerPrev = fire;
    if (fire) out.buttons |= Btn.Fire;
    if (!this.targetVisible && slot.ammo < def.magSize * 0.5 && slot.reserve > 0) out.buttons |= Btn.Reload;
    if (this.mode === "engage" && this.target && Math.hypot(this.target.sim.move.x - m.x, this.target.sim.move.z - m.z) > 22) out.buttons |= Btn.Ads;

    // ---------------- Locomotion ----------------
    let wx = 0;
    let wz = 0;
    const next = this.followPath(m);
    if (next) {
      wx = next.x - m.x;
      wz = next.z - m.z;
    }
    if (this.mode === "engage") {
      // Strafe while fighting, switching direction unpredictably.
      if (now > this.strafeUntil) {
        this.strafe = Math.random() < 0.2 ? 0 : Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = now + rand(0.4, 1.3);
        if (Math.random() < this.profile.crouchPeek) this.crouchUntil = now + rand(0.4, 1.0);
      }
      const rx = Math.cos(this.aimYaw);
      const rz = -Math.sin(this.aimYaw);
      wx += rx * this.strafe * 0.8;
      wz += rz * this.strafe * 0.8;
      if (now < this.crouchUntil) out.buttons |= Btn.Crouch;
    }
    const len = Math.hypot(wx, wz);
    if (len > 0.05) {
      wx /= len;
      wz /= len;
      // World direction → local input axes relative to the view yaw.
      const s = Math.sin(this.aimYaw);
      const c = Math.cos(this.aimYaw);
      out.moveY = wx * -s + wz * -c;
      out.moveX = wx * c + wz * -s;
      if (wantSprint && out.moveY > 0.7 && !this.targetVisible) out.buttons |= Btn.Sprint;
    }

    // Unstick: jump (and mantle) when not making progress, then repath.
    if (now > this.stuckCheckAt) {
      const moved = Math.hypot(m.x - this.stuckX, m.z - this.stuckZ);
      if (len > 0.05 && moved < 0.4 && this.mode !== "engage") {
        this.jumpUntil = now + 0.25;
        this.repathAt = 0;
        if (this.mode === "roam") this.goal = null;
      }
      this.stuckX = m.x;
      this.stuckZ = m.z;
      this.stuckCheckAt = now + 1;
    }
    if (now < this.jumpUntil) out.buttons |= Btn.Jump;
  }

  // ---------------------------------------------------------------------------

  private perceive(ctx: BotWorld): void {
    const sp = this.self;
    const m = sp.sim.move;
    const eyeY = m.y + eyeHeight(m);
    const halfFov = (this.profile.fov / 2) * DEG2RAD;
    let best: ServerPlayer | null = null;
    let bestScore = Infinity;
    for (const o of ctx.players) {
      if (o === sp || !o.alive || !ctx.isEnemy(sp, o)) continue;
      const t = o.sim.move;
      const dx = t.x - m.x;
      const dz = t.z - m.z;
      const dist = Math.hypot(dx, dz);
      if (dist > this.profile.sight) continue;
      const bearing = Math.atan2(-dx, -dz);
      const inCone = Math.abs(wrap(bearing - this.aimYaw)) < halfFov;
      const alreadyTracking = o === this.target && this.targetVisible;
      if (!inCone && !alreadyTracking && dist > 5) continue;
      if (!this.canSee(ctx.world, m.x, eyeY, m.z, o)) continue;
      // Prefer close enemies, and the current target (no flip-flopping).
      const score = dist * (o === this.target ? 0.6 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) this.acquire(best, ctx.now);
      this.target = best;
      this.targetVisible = true;
      const t = best.sim.move;
      this.lastKnown = { x: t.x, y: t.y, z: t.z };
      this.lastSeenAt = ctx.now;
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  private canSee(world: CollisionWorld, x: number, eyeY: number, z: number, o: ServerPlayer): boolean {
    const t = o.sim.move;
    const head = t.y + eyeHeight(t);
    for (const ty of [head, t.y + 1.0]) {
      const dx = t.x - x;
      const dy = ty - eyeY;
      const dz = t.z - z;
      const len = Math.hypot(dx, dy, dz);
      if (!world.raycast(x, eyeY, z, dx / len, dy / len, dz / len, len - 0.3, this.hit)) return true;
    }
    return false;
  }

  /** New target: start with a human reaction delay and an aim error that grows with distance. */
  private acquire(t: ServerPlayer, now: number): void {
    const m = this.self.sim.move;
    const dist = Math.hypot(t.sim.move.x - m.x, t.sim.move.z - m.z);
    this.reactionUntil = now + this.profile.reaction * rand(0.8, 1.25) * (dist > 40 ? 1.3 : 1);
    const err = this.profile.aimError * DEG2RAD * (0.6 + dist / 30);
    const a = Math.random() * Math.PI * 2;
    this.errYaw = Math.cos(a) * err;
    this.errPitch = Math.sin(a) * err * 0.6;
    this.aimHead = Math.random() < this.profile.headshot;
    this.burstUntil = 0;
    this.pauseUntil = 0;
  }

  private findCover(ctx: BotWorld): boolean {
    const m = this.self.sim.move;
    const t = this.target?.sim.move;
    if (!t) return false;
    const ey = t.y + eyeHeight(t);
    let best: Point | null = null;
    let bestD = 16;
    for (const p of ctx.cover) {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d >= bestD || Math.abs(p.y - m.y) > 2) continue;
      if (hiddenFrom(ctx.world, t.x, ey, t.z, p)) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return false;
    this.setGoal(ctx, best);
    this.coverUntil = ctx.now + rand(2.5, 4.5);
    return true;
  }

  private pickRoamGoal(ctx: BotWorld): void {
    const m = this.self.sim.move;
    // Drift toward the middle and the enemy side, with plenty of randomness.
    const cx = m.x * 0.3;
    const cz = m.z * 0.2 + (this.self.team === 0 ? 8 : -8);
    for (let i = 0; i < 4; i++) {
      const p = ctx.nav.randomAround({ x: cx, y: 0, z: cz }, 24);
      if (p && p.y < 4 && this.setGoal(ctx, p)) return;
    }
    this.path = [];
  }

  private setGoal(ctx: BotWorld, goal: Point): boolean {
    const m = this.self.sim.move;
    const path = ctx.nav.path({ x: m.x, y: m.y, z: m.z }, goal);
    this.goal = goal;
    this.path = path;
    this.pathIdx = path.length > 1 ? 1 : 0;
    return path.length > 0;
  }

  private followPath(m: { x: number; z: number }): Point | null {
    while (this.pathIdx < this.path.length) {
      const p = this.path[this.pathIdx]!;
      if (Math.hypot(p.x - m.x, p.z - m.z) > 0.55) return p;
      this.pathIdx++;
    }
    return null;
  }

  private reached(m: { x: number; z: number }, p: Point, r: number): boolean {
    return Math.hypot(p.x - m.x, p.z - m.z) < r;
  }
}
