import { NetClient, type ConnectTarget } from "./NetClient";

/**
 * Keeps one live session per room code across React remounts (Strict Mode, route
 * transitions from the hub into /play/CODE). Releasing schedules a disconnect that a
 * quick re-acquire cancels.
 */
interface Entry {
  promise: Promise<NetClient>;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Entry>();

/** Creates or matchmakes a room; the result is registered under its invite code. */
export async function openSession(target: ConnectTarget): Promise<NetClient> {
  const net = await NetClient.connect(target);
  sessions.set(net.code, { promise: Promise.resolve(net), refs: 0, timer: scheduleDispose(net.code, 15_000) });
  return net;
}

export function acquireSession(code: string): Promise<NetClient> {
  let e = sessions.get(code);
  if (!e) {
    e = { promise: NetClient.connect({ kind: "join", code }), refs: 0, timer: null };
    sessions.set(code, e);
    e.promise.catch(() => sessions.delete(code));
  }
  if (e.timer) {
    clearTimeout(e.timer);
    e.timer = null;
  }
  e.refs++;
  return e.promise;
}

export function releaseSession(code: string): void {
  const e = sessions.get(code);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0) e.timer = scheduleDispose(code, 300);
}

function scheduleDispose(code: string, ms: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const e = sessions.get(code);
    if (!e || e.refs > 0) return;
    sessions.delete(code);
    void e.promise.then((n) => n.dispose()).catch(() => {});
  }, ms);
}
