import * as THREE from "three";
import { Anim, WEAPONS, damp, lerpAngle, rayVsPlayer, type HitboxPose, type PlayerHit, type WeaponId } from "@paradox/shared";
import type { AudioEngine } from "../audio/audioEngine";
import type { CharacterView } from "../character/CharacterView";

const BUFFER = 32;
const STEP_DISTANCE = 2.2;

interface Snapshot {
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  alive: boolean;
  grounded: boolean;
  anim: number;
  weapon: WeaponId;
}

export interface RemoteState {
  name: string;
  team: number;
  bot: boolean;
}

/** One remote player: a ring of server snapshots, rendered `INTERP_DELAY` in the past. */
export class RemotePlayer {
  readonly snapshots: Snapshot[] = Array.from({ length: BUFFER }, () => ({
    tick: -1,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    crouch: 0,
    alive: false,
    grounded: true,
    anim: 0,
    weapon: "vk12" as WeaponId,
  }));
  private head = -1;
  readonly pose: HitboxPose = { x: 0, y: 0, z: 0, crouch: 0 };
  yaw = 0;
  pitch = 0;
  /** Alive at the rendered time (hitboxes only exist while alive). */
  alive = false;
  grounded = true;
  anim = 0;
  weapon: WeaponId = "vk12";
  private hasPose = false;
  private stepAcc = 0;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  readonly vel = new THREE.Vector3();
  private reloadStart = -1;
  private clock = 0;
  readonly info: RemoteState = { name: "", team: 0, bot: false };

  constructor(
    readonly id: string,
    readonly view: CharacterView,
  ) {}

  push(tick: number, x: number, y: number, z: number, yaw: number, pitch: number, crouch: number, alive: boolean, grounded: boolean, anim: number, weapon: WeaponId): void {
    const last = this.head >= 0 ? this.snapshots[this.head]! : null;
    if (last && tick <= last.tick) return;
    this.head = (this.head + 1) % BUFFER;
    const s = this.snapshots[this.head]!;
    s.tick = tick;
    s.x = x;
    s.y = y;
    s.z = z;
    s.yaw = yaw;
    s.pitch = pitch;
    s.crouch = crouch;
    s.alive = alive;
    s.grounded = grounded;
    s.anim = anim;
    s.weapon = weapon;
  }

  /** Interpolate to `renderTick` (fractional). Holds the latest snapshot when starved. */
  sample(renderTick: number): void {
    if (this.head < 0) return;
    let older: Snapshot | null = null;
    let newer: Snapshot | null = null;
    for (let i = 0; i < BUFFER; i++) {
      const s = this.snapshots[(this.head - i + BUFFER) % BUFFER]!;
      if (s.tick < 0) break;
      if (s.tick > renderTick) newer = s;
      else {
        older = s;
        break;
      }
    }
    const latest = this.snapshots[this.head]!;
    let src: Snapshot;
    if (older && newer) {
      const t = (renderTick - older.tick) / (newer.tick - older.tick);
      // Never interpolate across a respawn/teleport.
      const jump = Math.abs(newer.x - older.x) + Math.abs(newer.z - older.z) > 4 || older.alive !== newer.alive;
      const a = jump ? newer : older;
      const k = jump ? 0 : t;
      this.pose.x = a.x + (newer.x - a.x) * k;
      this.pose.y = a.y + (newer.y - a.y) * k;
      this.pose.z = a.z + (newer.z - a.z) * k;
      this.pose.crouch = a.crouch + (newer.crouch - a.crouch) * k;
      this.yaw = lerpAngle(a.yaw, newer.yaw, k);
      this.pitch = a.pitch + (newer.pitch - a.pitch) * k;
      src = k > 0.5 ? newer : a;
    } else {
      src = older ?? latest;
      this.pose.x = src.x;
      this.pose.y = src.y;
      this.pose.z = src.z;
      this.pose.crouch = src.crouch;
      this.yaw = src.yaw;
      this.pitch = src.pitch;
    }
    this.alive = src.alive;
    this.grounded = src.grounded;
    this.anim = src.anim;
    this.weapon = src.weapon;
  }

  /** Drive the character from the interpolated state. */
  animate(dt: number, camera: THREE.Camera): void {
    this.clock += dt;
    if (dt > 0) {
      const teleport = !this.hasPose || Math.abs(this.pose.x - this.lastX) + Math.abs(this.pose.z - this.lastZ) > 2;
      if (teleport) this.vel.set(0, 0, 0);
      else {
        const k = damp(14, dt);
        this.vel.x += ((this.pose.x - this.lastX) / dt - this.vel.x) * k;
        this.vel.y += ((this.pose.y - this.lastY) / dt - this.vel.y) * k;
        this.vel.z += ((this.pose.z - this.lastZ) / dt - this.vel.z) * k;
      }
    }
    this.hasPose = true;
    const reloading = (this.anim & Anim.Reloading) !== 0;
    if (reloading && this.reloadStart < 0) this.reloadStart = this.clock;
    if (!reloading) this.reloadStart = -1;
    const def = WEAPONS[this.weapon];
    this.view.update(
      {
        dt,
        x: this.pose.x,
        y: this.pose.y,
        z: this.pose.z,
        vx: this.vel.x,
        vy: this.vel.y,
        vz: this.vel.z,
        grounded: this.grounded,
        crouch: this.pose.crouch,
        sliding: (this.anim & Anim.Sliding) !== 0,
        sprinting: (this.anim & Anim.Sprinting) !== 0,
        ads: this.anim & Anim.Ads ? 1 : 0,
        lookYaw: this.yaw,
        lookPitch: this.pitch,
        aimTarget: null,
        reload: this.reloadStart >= 0 ? Math.min(0.999, (this.clock - this.reloadStart) / def.reloadTime) : -1,
        weapon: this.weapon,
        combat: (this.anim & Anim.Combat) !== 0,
        alive: this.alive,
      },
      camera,
    );
  }

  /** Positional footsteps from rendered motion. */
  footsteps(dt: number, audio: AudioEngine): void {
    const dx = this.pose.x - this.lastX;
    const dz = this.pose.z - this.lastZ;
    this.lastX = this.pose.x;
    this.lastY = this.pose.y;
    this.lastZ = this.pose.z;
    if (!this.alive || !this.grounded || dt <= 0) return;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1) return; // teleport
    const speed = d / dt;
    if (speed < 1.5) return;
    const before = this.stepAcc;
    this.stepAcc += d;
    if (Math.floor(before / STEP_DISTANCE) !== Math.floor(this.stepAcc / STEP_DISTANCE)) {
      audio.footstep("concrete", this.pose, this.pose.crouch > 0.5 ? 0.3 : speed > 7 ? 1.2 : 0.9);
    }
  }
}

/** All remote players: lifecycle, interpolation, animation and client-side hit prediction. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  readonly players = new Map<string, RemotePlayer>();
  private readonly hit: PlayerHit = { distance: 0, head: false };

  constructor(private readonly createView: () => CharacterView) {
    this.group.name = "remote-players";
  }

  ensure(id: string): RemotePlayer {
    let p = this.players.get(id);
    if (!p) {
      const view = this.createView();
      // Same player, same character, on every client.
      view.setCharacterKey(id);
      this.group.add(view.group);
      p = new RemotePlayer(id, view);
      this.players.set(id, p);
    }
    return p;
  }

  remove(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.view.dispose();
    this.players.delete(id);
  }

  update(renderTick: number, dt: number, audio: AudioEngine, camera: THREE.Camera): void {
    for (const p of this.players.values()) {
      p.sample(renderTick);
      p.animate(dt, camera);
      p.footsteps(dt, audio);
    }
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: { id: string; distance: number; head: boolean }): boolean {
    let best = maxDist;
    let found = false;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (rayVsPlayer(ox, oy, oz, dx, dy, dz, best, p.pose, this.hit)) {
        best = this.hit.distance;
        out.id = p.id;
        out.distance = this.hit.distance;
        out.head = this.hit.head;
        found = true;
      }
    }
    return found;
  }

  dispose(): void {
    for (const id of [...this.players.keys()]) this.remove(id);
    this.group.removeFromParent();
  }
}
