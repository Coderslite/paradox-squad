/** Typed pub/sub between the game systems and React. Game → UI only; never per frame. */
export interface GameEvents {
  hitmarker: { head: boolean; kill: boolean; damage: number };
  /** Screen position, normalized 0..1 from top-left. */
  damageNumber: { sx: number; sy: number; damage: number; head: boolean };
  /** Direction to the attacker relative to view: 0 = ahead, +PI/2 = right. */
  damaged: { angle: number; damage: number };
  killfeed: { killer: string; victim: string; weapon: string; head: boolean; local: "killer" | "victim" | null };
  notice: { text: string; tone?: "info" | "warn" | "error" };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<E[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** One bus per page; the active Game publishes to it, HUD components subscribe. */
export const gameBus = new EventBus<GameEvents>();
