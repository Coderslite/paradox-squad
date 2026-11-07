import { Client, type Room } from "@colyseus/sdk";
import {
  C2S,
  getMap,
  INPUT_REDUNDANCY,
  INTERP_DELAY_MS,
  S2C,
  TICK_RATE,
  WEAPONS,
  createMoveState,
  encodeInput,
  fromCm,
  unpackAckMove,
  type AckMessage,
  type DamagedMessage,
  type HitMessage,
  type InputCmd,
  type KillMessage,
  type MapDef,
  type PongMessage,
  type ShotMessage,
  type SpawnedMessage,
  type WeaponId,
  type WireInput,
} from "@paradox/shared";
import { getSettings } from "@/stores/settings";
import { patchUi, type ScoreRow } from "@/stores/ui";
import { gameBus } from "../core/events";
import * as THREE from "three";
import { RemotePlayers, type RemotePlayer } from "../remote/remotePlayers";
import type { NetContext, NetSession, NetStats, RemoteRayHit } from "./types";

const TICKS_PER_MS = TICK_RATE / 1000;
const INTERP_TICKS = INTERP_DELAY_MS * TICKS_PER_MS;

/** Shape of the replicated player as seen through schema reflection. */
interface PlayerView {
  name: string;
  team: number;
  alive: boolean;
  connected: boolean;
  bot: boolean;
  health: number;
  kills: number;
  deaths: number;
  ping: number;
  seed: number;
  weapon: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  grounded: boolean;
  anim: number;
}

interface StateView {
  tick: number;
  phase: string;
  scoreA: number;
  scoreB: number;
  scoreLimit: number;
  timeLeft: number;
  players: { forEach(cb: (p: PlayerView, id: string) => void): void; get(id: string): PlayerView | undefined };
}

export type BotDifficulty = "easy" | "normal" | "hard" | "insane";
export type ConnectTarget = { kind: "create" } | { kind: "join"; code: string } | { kind: "quick" } | { kind: "ai"; difficulty: BotDifficulty };

/** Game server URL: env in production, same host on :2567 in development (works over LAN). */
export function gameServerUrl(): string {
  const env = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (env) return env;
  const secure = window.location.protocol === "https:";
  return `${secure ? "wss" : "ws"}://${window.location.hostname}:2567`;
}

/**
 * Simulated network conditions for testing (`?lag=150&loss=2` on the URL): delays both
 * directions by half the RTT each and drops outgoing input messages.
 */
function readNetSim(): { halfLagMs: number; loss: number } {
  if (typeof window === "undefined") return { halfLagMs: 0, loss: 0 };
  const q = new URLSearchParams(window.location.search);
  return { halfLagMs: Math.max(0, Number(q.get("lag") ?? 0)) / 2, loss: Math.max(0, Math.min(50, Number(q.get("loss") ?? 0))) / 100 };
}

/** Client side of an online match. */
export class NetClient implements NetSession {
  readonly stats: NetStats = { ping: 0, jitter: 0, loss: 0, inKbps: 0, outKbps: 0 };
  readonly map: MapDef;
  private ctx: NetContext | null = null;
  remotes: RemotePlayers | null = null;
  private readonly recent: InputCmd[] = [];
  private readonly wire: WireInput[] = [];
  private readonly authMove = createMoveState();
  private readonly muzzle = new THREE.Vector3();
  private clockOffset = Number.NaN;
  private lastTick = -1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private uiTimer = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private bwTimer = 0;
  private ammoMismatch = 0;
  private readonly sim = readNetSim();
  private readonly delayed: { due: number; fn: () => void }[] = [];
  private disposed = false;
  private offCallbacks: (() => void)[] = [];

  /** Messages that arrive before the game attaches (e.g. the first Spawned) are queued, not lost. */
  private early: [number, unknown][] = [];

  private constructor(readonly room: Room) {
    this.map = getMap((room.state as unknown as { map?: string }).map);
    for (const type of Object.values(S2C)) {
      this.offCallbacks.push(room.onMessage(type, (msg: unknown) => this.dispatch(type, msg)));
    }
    room.onStateChange((raw) => this.onState(raw as unknown as StateView));
  }

  get localId(): string {
    return this.room.sessionId;
  }

  get code(): string {
    return this.room.roomId;
  }

  static async connect(target: ConnectTarget): Promise<NetClient> {
    const client = new Client(gameServerUrl());
    const name = getSettings().playerName || undefined;
    const opts = { name };
    const room =
      target.kind === "ai"
        ? await client.create("tdm", { ...opts, private: true, vsAI: true, difficulty: target.difficulty })
        : target.kind === "create"
        ? await client.create("tdm", { ...opts, private: true })
        : target.kind === "join"
          ? await client.joinById(target.code, opts)
          : await client.joinOrCreate("tdm", opts);
    return new NetClient(room);
  }

  attach(ctx: NetContext): void {
    this.ctx = ctx;
    this.remotes = new RemotePlayers(ctx.createCharacter);
    ctx.scene.add(this.remotes.group);
    const room = this.room;
    patchUi({ connection: "connected", roomCode: room.roomId, mode: "online" });

    room.onDrop(() => patchUi({ connection: "reconnecting" }));
    room.onReconnect(() => patchUi({ connection: "connected" }));
    room.onLeave((code) => {
      if (this.disposed) return;
      patchUi({ connection: "failed", error: code === 4001 ? "You were removed for being inactive." : "Disconnected from the match." });
    });

    const early = this.early;
    this.early = [];
    for (const [type, msg] of early) this.dispatch(type, msg);

    this.pingTimer = setInterval(() => this.sendRaw(C2S.Ping, { t: performance.now(), rtt: this.stats.ping || undefined }), 1000);
    this.hookBandwidth();
  }

  sendInput(cmd: InputCmd): void {
    // Keep the last few inputs and resend them with every message (loss redundancy).
    let slot: InputCmd;
    if (this.recent.length < INPUT_REDUNDANCY) {
      slot = { ...cmd };
      this.recent.push(slot);
    } else {
      slot = this.recent.shift()!;
      Object.assign(slot, cmd);
      this.recent.push(slot);
    }
    this.wire.length = 0;
    for (const c of this.recent) this.wire.push(encodeInput(c));
    if (this.sim.loss > 0 && Math.random() < this.sim.loss) return;
    this.sendRaw(C2S.Input, { c: this.wire });
  }

  update(dt: number): void {
    const now = performance.now();
    if (this.delayed.length) {
      let i = 0;
      while (i < this.delayed.length && this.delayed[i]!.due <= now) this.delayed[i++]!.fn();
      if (i) this.delayed.splice(0, i);
    }
    if (this.remotes && this.ctx) this.remotes.update(this.renderTick(now), dt, this.ctx.audio, this.ctx.camera);

    this.bwTimer += dt;
    if (this.bwTimer >= 1) {
      this.stats.inKbps = this.bytesIn / 1024 / this.bwTimer;
      this.stats.outKbps = this.bytesOut / 1024 / this.bwTimer;
      this.bytesIn = this.bytesOut = 0;
      this.bwTimer = 0;
    }
  }

  viewTick(out: { tick: number; alpha: number }): void {
    const t = Math.max(0, this.renderTick(performance.now()));
    out.tick = Math.floor(t);
    out.alpha = t - out.tick;
  }

  raycastRemotes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RemoteRayHit): RemoteRayHit | null {
    return this.remotes?.raycast(ox, oy, oz, dx, dy, dz, maxDist, out) ? out : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const off of this.offCallbacks) off();
    this.remotes?.dispose();
    void this.room.leave(true);
    patchUi({ connection: "offline", roomCode: null });
  }

  // ---------------------------------------------------------------------------

  private later(fn: () => void): void {
    if (this.sim.halfLagMs > 0) this.delayed.push({ due: performance.now() + this.sim.halfLagMs, fn });
    else fn();
  }

  private dispatch(type: number, msg: unknown): void {
    if (!this.ctx) {
      this.early.push([type, msg]);
      return;
    }
    this.later(() => this.handleMessage(type, msg));
  }

  private handleMessage(type: number, msg: unknown): void {
    const ctx = this.ctx;
    if (!ctx) return;
    switch (type) {
      case S2C.Ack:
        this.handleAck(msg as AckMessage);
        break;
      case S2C.Pong:
        this.handlePong(msg as PongMessage);
        break;
      case S2C.Shot: {
        const m = msg as ShotMessage;
        // Tracers start at the shooter's visible muzzle rather than the server-side origin.
        const shooter = this.remotes?.players.get(m.id);
        let ox = fromCm(m.o[0]);
        let oy = fromCm(m.o[1]);
        let oz = fromCm(m.o[2]);
        if (shooter?.alive) {
          shooter.view.fire();
          const p = shooter.view.muzzleWorld(this.muzzle);
          ox = p.x;
          oy = p.y;
          oz = p.z;
        }
        ctx.remoteShot(ox, oy, oz, m.e.map(fromCm), m.k, m.w, m.id);
        // Shots that hit a character make it flinch.
        for (let i = 0; i < m.k.length; i++) {
          if (m.k[i] !== 2) continue;
          const hx = fromCm(m.e[i * 3]!);
          const hz = fromCm(m.e[i * 3 + 2]!);
          let best: RemotePlayer | null = null;
          let bestD = 1.2;
          for (const rp of this.remotes?.players.values() ?? []) {
            const d = Math.hypot(rp.pose.x - hx, rp.pose.z - hz);
            if (d < bestD) {
              bestD = d;
              best = rp;
            }
          }
          best?.view.hitReact(Math.random() < 0.5);
        }
        break;
      }
      case S2C.Hit: {
        const m = msg as HitMessage;
        this.remotes?.players.get(m.target)?.view.hitReact(Math.random() < 0.5);
        ctx.onHitConfirmed(m.dmg, m.head, m.kill);
        break;
      }
      case S2C.Damaged: {
        const m = msg as DamagedMessage;
        ctx.onDamaged(m.x, m.z, m.dmg);
        break;
      }
      case S2C.Kill:
        this.handleKill(msg as KillMessage);
        break;
      case S2C.Spawned: {
        const m = msg as SpawnedMessage;
        ctx.onLocalSpawn(m.x, m.y, m.z, m.yaw);
        break;
      }
    }
  }

  private onState(state: StateView): void {
    if (!this.ctx) return;
    // Copy out now (the live state object keeps mutating); deliver later if simulating lag.
    const tick = state.tick;
    const snaps: [string, number, PlayerView][] = [];
    state.players.forEach((p, id) => {
      if (id !== this.localId) snaps.push([id, tick, { ...p }]);
    });
    this.later(() => this.applySnapshot(tick, snaps, state));
  }

  /** Server tick being displayed for remote players: estimated server time minus the interpolation buffer. */
  private renderTick(now: number): number {
    if (Number.isNaN(this.clockOffset)) return this.lastTick - INTERP_TICKS;
    return now * TICKS_PER_MS + this.clockOffset - INTERP_TICKS;
  }

  private applySnapshot(tick: number, snaps: [string, number, PlayerView][], state: StateView): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    // Clock sync: follow the upper envelope of arrival times (late packets only nudge it).
    const sample = tick - performance.now() * TICKS_PER_MS;
    if (Number.isNaN(this.clockOffset) || Math.abs(sample - this.clockOffset) > 30) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * (sample > this.clockOffset ? 0.25 : 0.02);

    const remotes = this.remotes;
    if (!remotes) return;
    const seen = new Set<string>();
    for (const [id, t, p] of snaps) {
      seen.add(id);
      const rp = remotes.ensure(id);
      rp.info.name = p.name;
      rp.info.team = p.team;
      rp.info.bot = p.bot;
      rp.push(t, p.x, p.y, p.z, p.yaw, p.pitch, p.crouch, p.alive && p.connected, p.grounded, p.anim, p.weapon as WeaponId);
    }
    for (const id of remotes.players.keys()) if (!seen.has(id)) remotes.remove(id);

    const me = state.players.get(this.localId);
    if (me) {
      patchUi({ health: me.health, alive: me.alive, localTeam: me.team });
      if (this.ctx) this.ctx.local.seed = me.seed;
    }
    const now = performance.now();
    if (now - this.uiTimer > 250) {
      this.uiTimer = now;
      const rows: ScoreRow[] = [];
      state.players.forEach((p, id) =>
        rows.push({ id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, ping: p.ping, local: id === this.localId, bot: p.bot }),
      );
      rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      patchUi({ scoreboard: rows, teamScores: [state.scoreA, state.scoreB], scoreLimit: state.scoreLimit, matchTimeLeft: state.timeLeft, phase: state.phase });
    }
  }

  private handleAck(a: AckMessage): void {
    const ctx = this.ctx;
    if (!ctx) return;
    unpackAckMove(a, this.authMove);
    ctx.local.reconcile(this.authMove, a[0]!, ctx.world, ctx.env);
    // Weapons are predicted; adopt the server's ammo only if it disagrees persistently
    // (e.g. inputs lost beyond redundancy).
    const w = ctx.local.sim.weapon;
    const slot = w.slots[w.active];
    if (a[4] === w.active && (a[2] !== slot.ammo || a[3] !== slot.reserve) && w.reloadTimer <= 0) {
      if (++this.ammoMismatch > 6) {
        slot.ammo = a[2]!;
        slot.reserve = a[3]!;
        this.ammoMismatch = 0;
      }
    } else this.ammoMismatch = 0;
  }

  private handlePong(m: PongMessage): void {
    const rtt = performance.now() - m.t;
    this.stats.jitter += (Math.abs(rtt - this.stats.ping) - this.stats.jitter) * 0.2;
    this.stats.ping = this.stats.ping === 0 ? rtt : this.stats.ping + (rtt - this.stats.ping) * 0.3;
    this.stats.loss = m.loss;
  }

  private handleKill(m: KillMessage): void {
    const state = this.room.state as unknown as StateView;
    const name = (id: string): string => (id === this.localId ? "You" : (state.players.get(id)?.name ?? "Unknown"));
    const weapon = WEAPONS[m.weapon as keyof typeof WEAPONS]?.name ?? (m.weapon === "fall" ? "Gravity" : m.weapon);
    const local = m.killer === this.localId ? "killer" : m.victim === this.localId ? "victim" : null;
    gameBus.emit("killfeed", { killer: m.killer ? name(m.killer) : "", victim: name(m.victim), weapon, head: m.head, local });
    if (m.victim === this.localId) this.ctx?.onLocalDeath();
  }

  private sendRaw(type: number, payload: unknown): void {
    if (this.disposed) return;
    const send = (): void => {
      if (!this.disposed) this.room.send(type, payload);
    };
    if (this.sim.halfLagMs > 0) setTimeout(send, this.sim.halfLagMs);
    else send();
  }

  /** Counts WebSocket bytes for the F3 overlay (best effort; transport internals). */
  private hookBandwidth(): void {
    const ws = (this.room.connection.transport as unknown as { ws?: WebSocket }).ws;
    if (!ws || typeof ws.addEventListener !== "function") return;
    ws.addEventListener("message", (e: MessageEvent) => {
      const d = e.data as ArrayBuffer | Blob | string;
      this.bytesIn += d instanceof ArrayBuffer ? d.byteLength : typeof d === "string" ? d.length : d.size;
    });
    const send = ws.send.bind(ws);
    ws.send = (data: Parameters<WebSocket["send"]>[0]) => {
      this.bytesOut += data instanceof ArrayBuffer ? data.byteLength : ArrayBuffer.isView(data) ? data.byteLength : typeof data === "string" ? data.length : 0;
      send(data);
    };
  }
}
