import { Room, type Client } from "@colyseus/core";
import {
  Anim,
  Btn,
  C2S,
  CollisionWorld,
  DEFAULT_ENV,
  FOUNDRY,
  getMap,
  InputMessage,
  JoinOptions,
  MAX_PELLETS,
  PLAYER,
  PingMessage,
  S2C,
  SNAPSHOT_RATE,
  TICK_DT,
  TICK_RATE,
  activeDef,
  computeShotRays,
  copyInputCmd,
  copyMoveState,
  createInputCmd,
  createMoveState,
  createRayHit,
  damageAt,
  decodeInput,
  eyeHeight,
  packAck,
  resetWeaponState,
  simulatePlayerTick,
  toCm,
  type DamagedMessage,
  type HitMessage,
  type InputCmd,
  type KillMessage,
  type MapDef,
  type PongMessage,
  type ShotMessage,
  type SpawnedMessage,
} from "@paradox/shared";
import { config } from "../config";
import { uniqueRoomCode } from "../matchmaking/codes";
import { GameState, PlayerState } from "../schema";
import { lagCompensatedRaycast, type CompensatedHit } from "../sim/lagCompensation";
import { ServerPlayer } from "../sim/serverPlayer";
import { BotBrain, type BotWorld } from "../ai/BotBrain";
import { buildCoverPoints } from "../ai/cover";
import { botName, type Difficulty } from "../ai/difficulty";
import { getNavigation, type Navigation, type Point } from "../ai/navmesh";

const RESPAWN_MS = 3000;
const SPAWN_PROTECTION_MS = 1500;
const RECONNECT_GRACE_S = 30;
const AFK_KICK_MS = 120_000;
const MATCH_SECONDS = 600;
const INTERMISSION_SECONDS = 12;
const ACK_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;
/** Rooms always fill up to this many players (humans + bots). */
const TARGET_PLAYERS = 8;
/** Wait before bots fill empty slots, so friends following an invite get a chance first. */
const BOT_FILL_DELAY_MS = 5000;

const coverCache = new Map<string, Point[]>();

/** Close code sent to AFK-kicked clients. */
export const CLOSE_AFK = 4001;

/**
 * Authoritative game room shared by all modes. Runs the same movement/weapon code as the
 * client at a fixed 60Hz, validates every input, resolves hitscan with lag compensation and
 * replicates a compact state at 30Hz. Subclasses define team rules and scoring.
 */
export class GameRoom extends Room<{ state: GameState }> {
  override maxClients = 8;
  protected map: MapDef = FOUNDRY;
  protected world!: CollisionWorld;
  protected readonly players = new Map<string, ServerPlayer>();
  protected tick = 0;
  private accumulator = 0;
  private matchClockMs = 0;

  // Scratch
  private readonly cmds: InputCmd[] = [];
  private readonly decoded: InputCmd = createInputCmd();
  private readonly rays = new Float64Array(MAX_PELLETS * 6);
  private readonly worldHit = createRayHit();
  private readonly compHit: CompensatedHit = { target: null as unknown as ServerPlayer, distance: 0, head: false };
  private readonly ackBuf: number[] = [];

  // Bots
  protected readonly bots = new Map<string, BotBrain>();
  private nav!: Navigation;
  private botCtx!: BotWorld;
  private botFillAt = 0;
  private difficulty: Difficulty = "normal";
  private botSeq = 0;
  private readonly botCmd: InputCmd = createInputCmd();

  override async onCreate(options: unknown): Promise<void> {
    const opts = JoinOptions.safeParse(options ?? {});
    this.roomId = await uniqueRoomCode();
    if (opts.success && opts.data.private) await this.setPrivate(true);
    if (opts.success && opts.data.map) this.map = getMap(opts.data.map);
    await this.setMetadata({ mode: "tdm", region: config.region, map: this.map.id });

    this.world = new CollisionWorld(this.map);
    this.nav = getNavigation(this.map);
    let cover = coverCache.get(this.map.id);
    if (!cover) {
      cover = buildCoverPoints(this.map, this.nav);
      coverCache.set(this.map.id, cover);
    }
    this.botCtx = {
      world: this.world,
      nav: this.nav,
      cover,
      players: this.players.values(),
      isEnemy: (a, b) => !this.isFriendly(a, b),
      now: 0,
    };
    this.difficulty = (opts.success && opts.data.difficulty) || "normal";
    this.botFillAt = Date.now() + (opts.success && opts.data.vsAI ? 0 : BOT_FILL_DELAY_MS);
    this.setState(new GameState());
    this.state.map = this.map.id;
    this.state.mode = "tdm";
    this.state.timeLeft = MATCH_SECONDS;
    this.matchClockMs = MATCH_SECONDS * 1000;
    this.setPatchRate(1000 / SNAPSHOT_RATE);

    this.onMessage(C2S.Input, (client, raw) => this.handleInput(client, raw));
    this.onMessage(C2S.Ping, (client, raw) => {
      const msg = PingMessage.safeParse(raw);
      if (!msg.success) return;
      const sp = this.players.get(client.sessionId);
      const ps = this.state.players.get(client.sessionId);
      // Clients report their measured RTT for the scoreboard.
      if (ps && msg.data.rtt !== undefined) ps.ping = Math.min(999, Math.round(msg.data.rtt));
      const pong: PongMessage = { t: msg.data.t, st: this.tick, loss: sp?.packetLoss ?? 0 };
      client.send(S2C.Pong, pong);
    });
    this.onMessage("*", () => {
      // Unknown message types are ignored (and never crash the room).
    });

    // Fixed-step simulation independent of the timer's jitter.
    this.setSimulationInterval((deltaMs) => {
      this.accumulator += Math.min(deltaMs, 250) / 1000;
      while (this.accumulator >= TICK_DT) {
        this.accumulator -= TICK_DT;
        this.step();
      }
    }, 1000 / TICK_RATE);
  }

  override onJoin(client: Client, options: unknown): void {
    const opts = JoinOptions.safeParse(options ?? {});
    const name = (opts.success && opts.data.name) || `Agent-${client.sessionId.slice(0, 4)}`;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const sp = new ServerPlayer(client.sessionId, seed);
    sp.team = this.pickTeam();
    this.players.set(client.sessionId, sp);

    const ps = new PlayerState();
    ps.name = name;
    ps.team = sp.team;
    ps.seed = seed;
    ps.alive = false;
    this.state.players.set(client.sessionId, ps);
    this.spawn(sp, client);
    // A human takes a bot's slot (from their own team, keeping teams even).
    if (this.players.size > TARGET_PLAYERS) this.removeBot(sp.team);
    if (opts.success && opts.data.vsAI) this.fillBots();
  }

  // ---------------------------------------------------------------------------
  // Bots
  // ---------------------------------------------------------------------------

  private fillBots(): void {
    if (Date.now() < this.botFillAt) return;
    const taken = new Set<string>();
    this.state.players.forEach((p) => taken.add(p.name));
    while (this.players.size < TARGET_PLAYERS) {
      const id = `bot-${(++this.botSeq).toString(36)}`;
      const sp = new ServerPlayer(id, (Math.random() * 0xffffffff) >>> 0);
      sp.team = this.pickTeam();
      this.players.set(id, sp);
      this.bots.set(id, new BotBrain(sp, this.difficulty));
      const ps = new PlayerState();
      ps.name = botName(taken);
      taken.add(ps.name);
      ps.team = sp.team;
      ps.seed = sp.seed;
      ps.bot = true;
      this.state.players.set(id, ps);
      this.spawn(sp, undefined);
    }
  }

  private removeBot(preferTeam: number): void {
    let pick: string | null = null;
    for (const [id, brain] of this.bots) {
      if (brain.self.team === preferTeam) {
        pick = id;
        break;
      }
      pick ??= id;
    }
    if (!pick) return;
    this.bots.delete(pick);
    this.players.delete(pick);
    this.state.players.delete(pick);
  }

  /** Bots generate their input for this tick through the same queue as human clients. */
  private thinkBots(now: number): void {
    this.botCtx.now = now / 1000;
    this.botCtx.players = this.players.values();
    for (const brain of this.bots.values()) {
      this.botCtx.players = this.players.values();
      const sp = brain.self;
      const c = this.botCmd;
      brain.think(this.botCtx, c);
      c.seq = sp.lastQueuedSeq + 1;
      c.viewTick = this.tick;
      c.viewAlpha = 0;
      sp.enqueue(c);
      sp.lastActiveAt = now;
    }
  }

  /** Teammates engaging the same enemy: all but the first swing wide to flank. */
  private assignFlanks(): void {
    const byTarget = new Map<ServerPlayer, number>();
    for (const brain of this.bots.values()) {
      const t = brain.currentTarget;
      if (!t) {
        brain.flanking = false;
        continue;
      }
      const n = byTarget.get(t) ?? 0;
      brain.flanking = n > 0;
      byTarget.set(t, n + 1);
    }
  }

  override async onDrop(client: Client): Promise<void> {
    const ps = this.state.players.get(client.sessionId);
    if (ps) ps.connected = false;
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_S);
    } catch {
      // Grace period expired: onLeave removes the player.
    }
  }

  override onReconnect(client: Client): void {
    const ps = this.state.players.get(client.sessionId);
    if (ps) ps.connected = true;
    const sp = this.players.get(client.sessionId);
    if (sp) {
      sp.lastActiveAt = Date.now();
      // The client lost its prediction history: hand it a clean authoritative start.
      const m = sp.sim.move;
      const msg: SpawnedMessage = { x: m.x, y: m.y, z: m.z, yaw: sp.lastCmd.yaw };
      client.send(S2C.Spawned, msg);
    }
  }

  override onLeave(client: Client): void {
    this.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    // Without humans the room disposes; otherwise a bot takes the empty slot.
    if (this.clients.length > 0) this.fillBots();
  }

  override onDispose(): void {
    this.world?.dispose();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private handleInput(client: Client, raw: unknown): void {
    const sp = this.players.get(client.sessionId);
    if (!sp) return;
    const parsed = InputMessage.safeParse(raw);
    if (!parsed.success) return;
    const list = parsed.data.c;
    // Message-level loss accounting: the newest input's seq identifies the message.
    const newest = list[list.length - 1]![0];
    if (newest > sp.lastMessageSeq) {
      if (sp.firstMessageSeq < 0) sp.firstMessageSeq = newest;
      sp.lastMessageSeq = newest;
      sp.messagesReceived++;
    }
    for (const w of list) {
      const cmd = decodeInput(w, this.decoded);
      // A client can never claim to be looking at the future.
      if (cmd.viewTick > this.tick) cmd.viewTick = this.tick;
      sp.enqueue(cmd);
    }
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private step(): void {
    this.tick++;
    const now = Date.now();
    const playing = this.state.phase === "playing";
    if (this.bots.size) this.thinkBots(now);

    for (const [id, sp] of this.players) {
      const n = sp.takeInputs(this.cmds);
      for (let i = 0; i < n; i++) {
        const cmd = this.cmds[i]!;
        if (cmd.buttons !== 0 || cmd.moveX !== 0 || cmd.moveY !== 0 || cmd.yaw !== sp.lastCmd.yaw) sp.lastActiveAt = now;
        // Dead players' inputs still advance the sequence so reconciliation stays aligned.
        simulatePlayerTick(sp.sim, cmd, this.world, DEFAULT_ENV, sp.alive && playing, sp.events);
        if (sp.events.weapon.shots > 0 && sp.alive) {
          if (now < sp.protectedUntil) sp.protectedUntil = 0; // firing ends spawn protection
          this.resolveShots(sp, cmd);
        }
        sp.lastProcessedSeq = cmd.seq;
        copyInputCmd(sp.lastCmd, cmd);
      }
      sp.recycle(this.cmds);

      if (sp.alive && sp.sim.move.y < this.map.killY) this.kill(sp, null, "fall", false);
      if (!sp.alive && sp.respawnAt > 0 && now >= sp.respawnAt && playing) this.spawn(sp, this.clientOf(id));
      if (now - sp.lastActiveAt > AFK_KICK_MS) this.clientOf(id)?.leave(CLOSE_AFK, "AFK");
    }

    // History + replication.
    for (const [id, sp] of this.players) {
      sp.record(this.tick, sp.lastCmd.yaw, sp.lastCmd.pitch);
      const ps = this.state.players.get(id);
      if (!ps) continue;
      const m = sp.sim.move;
      ps.x = m.x;
      ps.y = m.y;
      ps.z = m.z;
      ps.yaw = sp.lastCmd.yaw;
      ps.pitch = sp.lastCmd.pitch;
      ps.crouch = m.crouchBlend;
      ps.grounded = m.grounded;
      ps.alive = sp.alive;
      ps.health = Math.max(0, Math.ceil(sp.health));
      ps.weapon = activeDef(sp.sim.weapon).id;
      const w = sp.sim.weapon;
      const b = sp.lastCmd.buttons;
      ps.anim =
        (w.ads > 0.5 ? Anim.Ads : 0) |
        (w.sinceShot < 1.2 ? Anim.Combat : 0) |
        (w.reloadTimer > 0 ? Anim.Reloading : 0) |
        (b & Btn.Sprint && sp.lastCmd.moveY > 0.5 && m.grounded ? Anim.Sprinting : 0) |
        (m.slideTime > 0 ? Anim.Sliding : 0);
    }
    this.state.tick = this.tick;

    if (this.tick % ACK_EVERY_TICKS === 0) this.sendAcks();
    if (this.tick % TICK_RATE === 0) this.everySecond();
  }

  private sendAcks(): void {
    for (const client of this.clients) {
      const sp = this.players.get(client.sessionId);
      if (!sp || sp.lastProcessedSeq < 0) continue;
      const w = sp.sim.weapon;
      const slot = w.slots[w.active];
      client.send(S2C.Ack, packAck(sp.lastProcessedSeq, this.tick, slot.ammo, slot.reserve, w.active, sp.sim.move, this.ackBuf));
    }
  }

  private everySecond(): void {
    if (this.clients.length > 0) this.fillBots();
    this.assignFlanks();
    if (this.state.phase === "playing") {
      this.matchClockMs -= 1000;
      this.state.timeLeft = Math.max(0, Math.round(this.matchClockMs / 1000));
      if (this.matchClockMs <= 0) this.endMatch();
    } else {
      this.matchClockMs -= 1000;
      this.state.timeLeft = Math.max(0, Math.round(this.matchClockMs / 1000));
      if (this.matchClockMs <= 0) this.startMatch();
    }
  }

  private resolveShots(shooter: ServerPlayer, cmd: InputCmd): void {
    const def = activeDef(shooter.sim.weapon);
    const n = computeShotRays(shooter.sim, cmd, shooter.seed, shooter.events.weapon, this.rays);
    const shot: ShotMessage = { id: shooter.id, w: def.id, o: [0, 0, 0], e: [], k: [] };
    const damageByTarget = new Map<ServerPlayer, { dmg: number; head: boolean }>();

    for (let i = 0; i < n; i++) {
      const o = i * 6;
      const ox = this.rays[o]!;
      const oy = this.rays[o + 1]!;
      const oz = this.rays[o + 2]!;
      const dx = this.rays[o + 3]!;
      const dy = this.rays[o + 4]!;
      const dz = this.rays[o + 5]!;
      if (i === 0) shot.o = [toCm(ox), toCm(oy), toCm(oz)];
      const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, def.range, this.worldHit);
      const maxD = wh ? wh.distance : def.range;
      const ph = lagCompensatedRaycast(shooter, this.players.values(), this.tick, cmd.viewTick, cmd.viewAlpha, ox, oy, oz, dx, dy, dz, maxD, this.compHit);

      let end = maxD;
      let kind = wh ? 1 : 0;
      if (ph && !this.isFriendly(shooter, ph.target)) {
        end = ph.distance;
        kind = 2;
        const acc = damageByTarget.get(ph.target) ?? { dmg: 0, head: false };
        acc.dmg += damageAt(def, ph.distance, ph.head);
        acc.head ||= ph.head;
        damageByTarget.set(ph.target, acc);
      } else if (ph) {
        end = ph.distance;
        kind = 0;
      }
      shot.e.push(toCm(ox + dx * end), toCm(oy + dy * end), toCm(oz + dz * end));
      shot.k.push(kind);
    }

    // Bots hear gunfire.
    const sm = shooter.sim.move;
    for (const brain of this.bots.values()) if (brain.self !== shooter) brain.hear(sm.x, sm.y, sm.z);

    const shooterClient = this.clientOf(shooter.id);
    this.broadcast(S2C.Shot, shot, shooterClient ? { except: shooterClient } : undefined);

    const now = Date.now();
    for (const [target, { dmg, head }] of damageByTarget) {
      if (now < target.protectedUntil) continue;
      if (!config.testNoDeath) target.health -= dmg;
      const killed = target.health <= 0;
      if (shooterClient) {
        const hit: HitMessage = { target: target.id, dmg, head, kill: killed };
        shooterClient.send(S2C.Hit, hit);
      }
      const victimClient = this.clientOf(target.id);
      if (victimClient) {
        const m = shooter.sim.move;
        const msg: DamagedMessage = { from: shooter.id, dmg, x: m.x, z: m.z };
        victimClient.send(S2C.Damaged, msg);
      }
      if (killed) this.kill(target, shooter, def.id, head);
    }
  }

  protected kill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: string, head: boolean): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    const vs = this.state.players.get(victim.id);
    if (vs) vs.deaths++;
    if (killer && killer !== victim) {
      const ks = this.state.players.get(killer.id);
      if (ks) ks.kills++;
      this.onScore(killer);
    }
    const msg: KillMessage = { killer: killer?.id ?? "", victim: victim.id, weapon, head };
    this.broadcast(S2C.Kill, msg);
  }

  /** Mode hook: award points for a kill. */
  protected onScore(killer: ServerPlayer): void {
    if (killer.team === 0) this.state.scoreA++;
    else this.state.scoreB++;
    if (this.state.scoreA >= this.state.scoreLimit || this.state.scoreB >= this.state.scoreLimit) this.endMatch();
  }

  protected isFriendly(a: ServerPlayer, b: ServerPlayer): boolean {
    return a.team === b.team;
  }

  private endMatch(): void {
    if (this.state.phase !== "playing") return;
    this.state.phase = "ended";
    this.matchClockMs = INTERMISSION_SECONDS * 1000;
    this.state.timeLeft = INTERMISSION_SECONDS;
  }

  private startMatch(): void {
    this.state.phase = "playing";
    this.state.scoreA = 0;
    this.state.scoreB = 0;
    this.matchClockMs = MATCH_SECONDS * 1000;
    this.state.timeLeft = MATCH_SECONDS;
    for (const [id, sp] of this.players) {
      const ps = this.state.players.get(id);
      if (ps) {
        ps.kills = 0;
        ps.deaths = 0;
      }
      this.spawn(sp, this.clientOf(id));
    }
  }

  // ---------------------------------------------------------------------------
  // Spawning / teams
  // ---------------------------------------------------------------------------

  protected pickTeam(): number {
    let a = 0;
    let b = 0;
    for (const p of this.players.values()) {
      if (p.team === 0) a++;
      else b++;
    }
    return a <= b ? 0 : 1;
  }

  protected spawn(sp: ServerPlayer, client: Client | undefined): void {
    const points = this.map.spawns.filter((s) => s.team === sp.team);
    const candidates = points.length ? points : this.map.spawns;
    // Pick the spawn point farthest from the nearest living enemy.
    let best = candidates[0]!;
    let bestScore = -Infinity;
    for (const s of candidates) {
      let nearest = Infinity;
      for (const o of this.players.values()) {
        if (o === sp || !o.alive || this.isFriendly(o, sp)) continue;
        const m = o.sim.move;
        nearest = Math.min(nearest, Math.hypot(m.x - s.p[0], m.z - s.p[2]));
      }
      const score = nearest + Math.random() * 2;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    copyMoveState(sp.sim.move, createMoveState(best.p[0], best.p[1], best.p[2]));
    resetWeaponState(sp.sim.weapon);
    sp.alive = true;
    sp.health = PLAYER.maxHealth;
    sp.respawnAt = 0;
    sp.protectedUntil = Date.now() + SPAWN_PROTECTION_MS;
    sp.lastCmd.yaw = best.yaw;
    sp.lastCmd.pitch = 0;
    this.bots.get(sp.id)?.onSpawn(best.yaw);
    if (client) {
      const msg: SpawnedMessage = { x: best.p[0], y: best.p[1], z: best.p[2], yaw: best.yaw };
      client.send(S2C.Spawned, msg);
    }
  }

  protected clientOf(id: string): Client | undefined {
    for (const c of this.clients) if (c.sessionId === id) return c;
    return undefined;
  }

  /** Eye position helper for subclasses (bots, abilities). */
  protected eye(sp: ServerPlayer): [number, number, number] {
    const m = sp.sim.move;
    return [m.x, m.y + eyeHeight(m), m.z];
  }
}
