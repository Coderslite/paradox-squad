import type * as THREE from "three";
import type { CollisionWorld, InputCmd, MoveEnv, MapDef } from "@paradox/shared";
import type { LocalPlayer } from "../player/localPlayer";
import type { AudioEngine } from "../audio/audioEngine";
import type { CharacterView } from "../character/CharacterView";
import type { RemotePlayers } from "../remote/remotePlayers";

export interface NetStats {
  ping: number;
  jitter: number;
  loss: number;
  inKbps: number;
  outKbps: number;
}

export interface RemoteRayHit {
  id: string;
  distance: number;
  head: boolean;
}

/** What the networking layer needs from the game each frame. */
export interface NetContext {
  local: LocalPlayer;
  world: CollisionWorld;
  env: MoveEnv;
  scene: THREE.Scene;
  audio: AudioEngine;
  camera: THREE.Camera;
  /** Builds a character (shared materials, dissolve particles wired up). */
  createCharacter: () => CharacterView;
  /** Spawns tracer + impact effects for another player's shot. */
  remoteShot(ox: number, oy: number, oz: number, ends: number[], kinds: number[], weapon: string, shooterId: string): void;
  onLocalSpawn(x: number, y: number, z: number, yaw: number): void;
  onLocalDeath(): void;
  onHitConfirmed(damage: number, head: boolean, kill: boolean): void;
  onDamaged(fromX: number, fromZ: number, damage: number): void;
}

/** Online session (milestone 2). Practice mode runs with no session. */
export interface NetSession {
  readonly localId: string;
  readonly map: MapDef;
  attach(ctx: NetContext): void;
  /** After each predicted tick. */
  sendInput(cmd: InputCmd): void;
  /** Per render frame: apply snapshots, reconcile, interpolate remotes. */
  update(dt: number): void;
  /** Server tick (and fraction) remote players are currently rendered at. */
  viewTick(out: { tick: number; alpha: number }): void;
  /** Client-side prediction of hits on remote players, for immediate impact effects only. */
  raycastRemotes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RemoteRayHit): RemoteRayHit | null;
  readonly stats: NetStats;
  /** Remote players (for name tags, rims and aim checks). */
  readonly remotes: RemotePlayers | null;
  dispose(): void;
}
