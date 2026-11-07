/**
 * Fixed-capacity ring buffer of preallocated entries keyed by simulation tick.
 * Used for the server's per-player state history (lag compensation and Personal
 * Rewind) and the client's pending-input / predicted-state buffers. Never allocates
 * after construction.
 */
export class TickRing<T> {
  private readonly entries: T[];
  private readonly ticks: Int32Array;
  private newest = -1;

  constructor(
    readonly capacity: number,
    factory: () => T,
  ) {
    this.entries = Array.from({ length: capacity }, factory);
    this.ticks = new Int32Array(capacity).fill(-1);
  }

  /** Returns the slot for `tick` to be filled in place. Ticks must be non-decreasing. */
  write(tick: number): T {
    const i = tick % this.capacity;
    this.ticks[i] = tick;
    if (tick > this.newest) this.newest = tick;
    return this.entries[i] as T;
  }

  /** Entry stored for exactly `tick`, or null if never written or already overwritten. */
  get(tick: number): T | null {
    if (tick < 0) return null;
    const i = tick % this.capacity;
    return this.ticks[i] === tick ? (this.entries[i] as T) : null;
  }

  get newestTick(): number {
    return this.newest;
  }

  /** Oldest tick still guaranteed to be present (if it was written). */
  get oldestTick(): number {
    return Math.max(0, this.newest - this.capacity + 1);
  }

  /** Latest stored entry at or before `tick`, searching back at most `maxBack` ticks. */
  floor(tick: number, maxBack = this.capacity): T | null {
    const lo = Math.max(this.oldestTick, tick - maxBack);
    for (let t = Math.min(tick, this.newest); t >= lo; t--) {
      const e = this.get(t);
      if (e) return e;
    }
    return null;
  }

  clear(): void {
    this.ticks.fill(-1);
    this.newest = -1;
  }
}
