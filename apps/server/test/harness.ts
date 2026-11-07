/**
 * Network test harness: headless bot clients against a real local server with simulated
 * latency and packet loss. Bots run the same prediction/reconciliation as the browser.
 *
 *   pnpm --filter @paradox/server harness              # 150ms RTT, 2% loss
 *   LAG=250 LOSS=5 pnpm --filter @paradox/server harness
 *
 * Reports reconciliation corrections (should stay ~0: same deterministic sim) and the
 * fraction of shots fired at the target's *rendered* position that the server confirms
 * (lag compensation fairness; misses come only from spread and spawn protection).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Client, type Room } from "@colyseus/sdk";
import {
  Btn,
  C2S,
  CollisionWorld,
  DEFAULT_ENV,
  RANGE,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  S2C,
  TICK_DT,
  TICK_RATE,
  TickRing,
  copyInputCmd,
  copyMoveState,
  createInputCmd,
  createMoveEvents,
  createMoveState,
  createPlayerSimEvents,
  createPlayerSimState,
  encodeInput,
  initPhysics,
  simulateMove,
  simulatePlayerTick,
  unpackAckMove,
  createRayHit,
  type AckMessage,
  type HitMessage,
  type InputCmd,
} from "@paradox/shared";

const LAG = Number(process.env.LAG ?? 150);
const LOSS = Number(process.env.LOSS ?? 2) / 100;
const PORT = 2599;
const DURATION_S = Number(process.env.DURATION ?? 20);

interface Snap {
  tick: number;
  x: number;
  y: number;
  z: number;
  crouch: number;
  alive: boolean;
}

class Bot {
  readonly sim = createPlayerSimState();
  readonly ev = createPlayerSimEvents();
  readonly pending = new TickRing<InputCmd>(512, createInputCmd);
  readonly recent: InputCmd[] = [];
  seq = 0;
  corrections: number[] = [];
  hits = 0;
  shotsFired = 0;
  clockOffset = Number.NaN;
  lastTick = -1;
  remote = new Map<string, Snap[]>();
  private readonly auth = createMoveState();
  private readonly before = createMoveState();
  private readonly replayEv = createMoveEvents();

  constructor(
    readonly name: string,
    readonly room: Room,
    readonly world: CollisionWorld,
  ) {
    room.onMessage(S2C.Ack, (a: AckMessage) => this.reconcile(a));
    room.onMessage(S2C.Hit, (_m: HitMessage) => this.hits++);
    room.onMessage(S2C.Spawned, (m: { x: number; y: number; z: number }) => {
      copyMoveState(this.sim.move, createMoveState(m.x, m.y, m.z));
    });
    room.onMessage("*", () => {});
    room.onStateChange((state: any) => {
      const tick = state.tick as number;
      if (tick <= this.lastTick) return;
      this.lastTick = tick;
      const sample = tick - performance.now() * (TICK_RATE / 1000);
      if (Number.isNaN(this.clockOffset) || Math.abs(sample - this.clockOffset) > 30) this.clockOffset = sample;
      else this.clockOffset += (sample - this.clockOffset) * (sample > this.clockOffset ? 0.25 : 0.02);
      state.players.forEach((p: any, id: string) => {
        if (id === room.sessionId) return;
        const list = this.remote.get(id) ?? [];
        list.push({ tick, x: p.x, y: p.y, z: p.z, crouch: p.crouch, alive: p.alive });
        if (list.length > 64) list.shift();
        this.remote.set(id, list);
      });
    });
  }

  renderTick(): number {
    return performance.now() * (TICK_RATE / 1000) + this.clockOffset - INTERP_DELAY_MS * (TICK_RATE / 1000);
  }

  /** Interpolated remote pose at the current render tick (what a player would see). */
  view(id: string): Snap | null {
    const list = this.remote.get(id);
    if (!list || list.length < 2) return null;
    const rt = this.renderTick();
    for (let i = list.length - 1; i > 0; i--) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (a.tick <= rt && b.tick >= rt) {
        const t = (rt - a.tick) / (b.tick - a.tick);
        return { tick: rt, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, crouch: a.crouch, alive: a.alive && b.alive };
      }
    }
    return null;
  }

  tick(c: InputCmd): void {
    c.seq = this.seq++;
    const rt = Math.max(0, this.renderTick());
    c.viewTick = Math.floor(rt);
    c.viewAlpha = rt - c.viewTick;
    simulatePlayerTick(this.sim, c, this.world, DEFAULT_ENV, true, this.ev);
    this.shotsFired += this.ev.weapon.shots;
    copyInputCmd(this.pending.write(c.seq), c);
    this.recent.push({ ...c });
    if (this.recent.length > INPUT_REDUNDANCY) this.recent.shift();
    if (Math.random() < LOSS) return;
    const payload = { c: this.recent.map(encodeInput) };
    setTimeout(() => this.room.send(C2S.Input, payload), LAG / 2);
  }

  private reconcile(a: AckMessage): void {
    setTimeout(() => {
      const ack = a[0]!;
      copyMoveState(this.before, this.sim.move);
      unpackAckMove(a, this.auth);
      copyMoveState(this.sim.move, this.auth);
      for (let s = ack + 1; s < this.seq; s++) {
        const c = this.pending.get(s);
        if (c) simulateMove(this.sim.move, c, this.world, TICK_DT, DEFAULT_ENV, this.replayEv);
      }
      const m = this.sim.move;
      this.corrections.push(Math.hypot(m.x - this.before.x, m.y - this.before.y, m.z - this.before.z));
    }, LAG / 2);
  }
}

const losHit = createRayHit();
function hasLineOfSight(w: CollisionWorld, x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
  const dx = tx - x;
  const dy = ty - y;
  const dz = tz - z;
  const d = Math.hypot(dx, dy, dz);
  return !w.raycast(x, y, z, dx / d, dy / d, dz / d, d, losHit);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${PORT}/matchmake/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("server did not start");
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] ?? 0;
};

async function main(): Promise<void> {
  await initPhysics();
  // Server-side half of the latency is applied by the bots (both directions), so the server runs clean.
  const server: ChildProcess = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), PARADOX_TEST_MODE: "1" }, stdio: "inherit" });
  try {
    await waitForServer();
    const client = new Client(`ws://localhost:${PORT}`);
    const roomA = await client.create("tdm", { name: "shooter", private: true, map: "range" });
    const roomB = await client.joinById(roomA.roomId, { name: "target" });
    const a = new Bot("shooter", roomA, new CollisionWorld(RANGE));
    const b = new Bot("target", roomB, new CollisionWorld(RANGE));
    console.log(`[harness] room ${roomA.roomId}: ${LAG}ms RTT, ${LOSS * 100}% input loss, ${DURATION_S}s`);

    // Teleport-free setup: wait for spawns and initial snapshots.
    await new Promise((r) => setTimeout(r, 1500));

    const ca = createInputCmd();
    const cb = createInputCmd();
    let t = 0;
    let aimedTicks = 0;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        // Keep real-time pacing even if the timer drifts.
        const due = Math.floor((performance.now() - start) / (1000 / TICK_RATE));
        while (t < due) {
          t++;
          // Target: walks into the field, then strafes left/right (hard to hit without lag comp).
          cb.moveY = b.sim.move.z > 12 ? 1 : 0;
          cb.moveX = cb.moveY ? 0 : Math.sin(t / 25) > 0 ? 1 : -1;
          cb.buttons = t % 180 === 90 ? Btn.Jump : 0;
          cb.yaw = 0;
          b.tick(cb);

          // Shooter: aims exactly at the *rendered* target chest and taps fire (ADS).
          const v = a.view(roomB.sessionId);
          const m = a.sim.move;
          ca.buttons = Btn.Ads;
          ca.moveX = 0;
          // Walk out of spawn facing the field before engaging.
          ca.moveY = m.z < -12 ? 1 : 0;
          if (ca.moveY) ca.yaw = Math.PI;
          if (v && v.alive && !ca.moveY && hasLineOfSight(a.world, m.x, m.y + 1.62, m.z, v.x, v.y + 1.15, v.z)) {
            const ex = m.x;
            const ey = m.y + 1.62;
            const ez = m.z;
            const dx = v.x - ex;
            const dy = v.y + 1.15 - ey;
            const dz = v.z - ez;
            ca.yaw = Math.atan2(-dx, -dz);
            ca.pitch = Math.atan2(dy, Math.hypot(dx, dz));
            ca.aimYaw = ca.yaw;
            ca.aimPitch = ca.pitch;
            aimedTicks++;
            if (t % 12 < 6) ca.buttons |= Btn.Fire;
          }
          a.tick(ca);
        }
        if (performance.now() - start > DURATION_S * 1000) {
          clearInterval(timer);
          resolve();
        }
      }, 4);
    });
    await new Promise((r) => setTimeout(r, LAG + 300));

    for (const bot of [a, b]) {
      // The first acks include the initial spawn (sent before handlers exist in this harness).
      const c = bot.corrections.slice(30);
      const nonzero = c.filter((x) => x > 1e-4);
      console.log(
        `[harness] ${bot.name}: acks ${c.length}, corrections>0.1mm ${nonzero.length}, p50 ${(pct(c, 0.5) * 100).toFixed(3)}cm, p99 ${(pct(c, 0.99) * 100).toFixed(2)}cm, max ${(Math.max(0, ...c) * 100).toFixed(2)}cm`,
      );
    }
    const ratio = a.shotsFired ? a.hits / a.shotsFired : 0;
    console.log(`[harness] shooter fired ${a.shotsFired}, server-confirmed hits ${a.hits} (${(ratio * 100).toFixed(1)}%), aimed ticks ${aimedTicks}`);
    await roomA.leave();
    await roomB.leave();
    const ok = ratio > 0.8 && pct(a.corrections.slice(30), 0.99) < 0.05 && pct(b.corrections.slice(30), 0.99) < 0.05;
    console.log(ok ? "[harness] PASS" : "[harness] FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    server.kill("SIGTERM");
  }
}

void main();
