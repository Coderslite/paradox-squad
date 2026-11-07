import {
  TickRing,
  copyInputCmd,
  copyMoveState,
  createInputCmd,
  createMoveState,
  createMoveEvents,
  createPlayerSimEvents,
  createPlayerSimState,
  damp,
  eyeHeight,
  simulateMove,
  simulatePlayerTick,
  TICK_DT,
  type CollisionWorld,
  type InputCmd,
  type MoveEnv,
  type MoveState,
  type PlayerSimEvents,
  type PlayerSimState,
  type Vec3,
} from "@paradox/shared";

/** Errors larger than this snap instead of smoothing (teleports, respawns, rewinds). */
const SNAP_DISTANCE = 2;
/** Visual correction decay rate (1/s). */
const SMOOTH_RATE = 14;

/**
 * Locally controlled player: runs the shared simulation every tick (prediction),
 * keeps unacknowledged inputs, and reconciles against authoritative server state by
 * replaying them. Render position is interpolated between ticks and includes a
 * decaying visual offset so corrections never pop.
 */
export class LocalPlayer {
  readonly sim: PlayerSimState = createPlayerSimState();
  readonly events: PlayerSimEvents = createPlayerSimEvents();
  alive = true;
  /** Per-player spread seed; the server assigns it online. */
  seed = 1;

  private readonly prev = { x: 0, y: 0, z: 0, eye: 0 };
  private readonly pending = new TickRing<InputCmd>(256, createInputCmd);
  private readonly replayEvents = createMoveEvents();
  private readonly before: MoveState = createMoveState();
  private latestSeq = -1;
  private readonly visualOffset = { x: 0, y: 0, z: 0 };
  /** Running stats for the debug overlay. */
  correctionCount = 0;
  lastCorrection = 0;

  spawn(x: number, y: number, z: number): void {
    const m = this.sim.move;
    const fresh = createMoveState(x, y, z);
    copyMoveState(m, fresh);
    this.prev.x = x;
    this.prev.y = y;
    this.prev.z = z;
    this.prev.eye = eyeHeight(m);
    this.visualOffset.x = this.visualOffset.y = this.visualOffset.z = 0;
    this.alive = true;
  }

  tick(cmd: InputCmd, world: CollisionWorld, env: MoveEnv): void {
    const m = this.sim.move;
    this.prev.x = m.x;
    this.prev.y = m.y;
    this.prev.z = m.z;
    this.prev.eye = eyeHeight(m);
    simulatePlayerTick(this.sim, cmd, world, env, this.alive, this.events);
    copyInputCmd(this.pending.write(cmd.seq), cmd);
    this.latestSeq = cmd.seq;
  }

  /**
   * Server says: after processing input `ackSeq`, your movement state was `auth`.
   * Rewind to it and replay every newer input we have already predicted.
   */
  reconcile(auth: MoveState, ackSeq: number, world: CollisionWorld, env: MoveEnv): void {
    if (ackSeq < 0 || ackSeq > this.latestSeq) return;
    const m = this.sim.move;
    copyMoveState(this.before, m);

    copyMoveState(m, auth);
    // Weapons are not rewound: their state is predicted from the same inputs and the
    // server corrects ammo separately. Only movement is replayed here.
    if (this.alive) {
      for (let seq = ackSeq + 1; seq <= this.latestSeq; seq++) {
        const cmd = this.pending.get(seq);
        if (cmd) simulateMove(m, cmd, world, TICK_DT, env, this.replayEvents);
      }
    }

    const ex = this.before.x - m.x;
    const ey = this.before.y - m.y;
    const ez = this.before.z - m.z;
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (err > 1e-4) {
      this.correctionCount++;
      this.lastCorrection = err;
      if (err > SNAP_DISTANCE) {
        this.visualOffset.x = this.visualOffset.y = this.visualOffset.z = 0;
        this.prev.x = m.x;
        this.prev.y = m.y;
        this.prev.z = m.z;
      } else {
        // Keep rendering where we were; the offset decays toward the corrected path.
        this.visualOffset.x += ex;
        this.visualOffset.y += ey;
        this.visualOffset.z += ez;
        this.prev.x -= ex;
        this.prev.y -= ey;
        this.prev.z -= ez;
      }
    }
  }

  /** Interpolated feet position for rendering, plus smoothed eye height in `out.eye`. */
  renderPosition(alpha: number, dt: number, out: Vec3 & { eye: number }): void {
    const m = this.sim.move;
    const k = damp(SMOOTH_RATE, dt);
    this.visualOffset.x -= this.visualOffset.x * k;
    this.visualOffset.y -= this.visualOffset.y * k;
    this.visualOffset.z -= this.visualOffset.z * k;
    out.x = this.prev.x + (m.x - this.prev.x) * alpha + this.visualOffset.x;
    out.y = this.prev.y + (m.y - this.prev.y) * alpha + this.visualOffset.y;
    out.z = this.prev.z + (m.z - this.prev.z) * alpha + this.visualOffset.z;
    out.eye = this.prev.eye + (eyeHeight(m) - this.prev.eye) * alpha;
  }

  get lastSeq(): number {
    return this.latestSeq;
  }
}
