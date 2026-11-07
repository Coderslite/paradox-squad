import {
  HISTORY_TICKS,
  MAX_INPUT_QUEUE,
  PLAYER,
  TickRing,
  copyInputCmd,
  copyPlayerSimState,
  createInputCmd,
  createPlayerSimEvents,
  createPlayerSimState,
  type HitboxPose,
  type InputCmd,
  type PlayerSimEvents,
  type PlayerSimState,
} from "@paradox/shared";

/** One tick of authoritative history: lag compensation reads the pose, Rewind restores `sim`. */
export interface HistoryEntry {
  pose: HitboxPose;
  alive: boolean;
  health: number;
  yaw: number;
  pitch: number;
  sim: PlayerSimState;
}

const createHistoryEntry = (): HistoryEntry => ({
  pose: { x: 0, y: 0, z: 0, crouch: 0 },
  alive: false,
  health: 0,
  yaw: 0,
  pitch: 0,
  sim: createPlayerSimState(),
});

/** Server-side player: authoritative sim state, buffered inputs and state history. */
export class ServerPlayer {
  readonly sim: PlayerSimState = createPlayerSimState();
  readonly events: PlayerSimEvents = createPlayerSimEvents();
  readonly history = new TickRing<HistoryEntry>(HISTORY_TICKS + 2, createHistoryEntry);
  /** Pending inputs, ascending by seq. Pool-backed to avoid allocation per message. */
  private readonly queue: InputCmd[] = [];
  private readonly pool: InputCmd[] = [];
  lastQueuedSeq = -1;
  lastProcessedSeq = -1;
  readonly lastCmd: InputCmd = createInputCmd();

  alive = false;
  health: number = PLAYER.maxHealth;
  respawnAt = 0;
  protectedUntil = 0;
  lastActiveAt = Date.now();
  team = 0;

  // Packet-loss accounting (input messages carry redundant inputs; this counts messages).
  messagesReceived = 0;
  firstMessageSeq = -1;
  lastMessageSeq = -1;

  constructor(
    readonly id: string,
    readonly seed: number,
  ) {}

  /** Queue new inputs (redundant copies of already-queued seqs are ignored). */
  enqueue(cmd: InputCmd): void {
    if (cmd.seq <= this.lastQueuedSeq) return;
    if (this.queue.length >= MAX_INPUT_QUEUE) {
      // Client is sending faster than real time (or we stalled): drop the oldest.
      const dropped = this.queue.shift()!;
      this.pool.push(dropped);
    }
    const slot = this.pool.pop() ?? createInputCmd();
    copyInputCmd(slot, cmd);
    this.queue.push(slot);
    this.lastQueuedSeq = cmd.seq;
  }

  /** Inputs to process this tick: normally one, two when the buffer is backing up. */
  takeInputs(out: InputCmd[]): number {
    out.length = 0;
    const n = this.queue.length > 4 ? 2 : this.queue.length > 0 ? 1 : 0;
    for (let i = 0; i < n; i++) out.push(this.queue.shift()!);
    return n;
  }

  recycle(cmds: InputCmd[]): void {
    for (const c of cmds) this.pool.push(c);
    cmds.length = 0;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  record(tick: number, yaw: number, pitch: number): void {
    const e = this.history.write(tick);
    const m = this.sim.move;
    e.pose.x = m.x;
    e.pose.y = m.y;
    e.pose.z = m.z;
    e.pose.crouch = m.crouchBlend;
    e.alive = this.alive;
    e.health = this.health;
    e.yaw = yaw;
    e.pitch = pitch;
    copyPlayerSimState(e.sim, this.sim);
  }

  /** Fraction of input messages lost over the session so far. */
  get packetLoss(): number {
    if (this.firstMessageSeq < 0) return 0;
    const expected = this.lastMessageSeq - this.firstMessageSeq + 1;
    return expected > 0 ? Math.max(0, 1 - this.messagesReceived / expected) : 0;
  }
}
