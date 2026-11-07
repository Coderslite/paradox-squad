import * as THREE from "three";
import { PLAYER, rayVsPlayer, type HitboxPose, type PlayerHit } from "@paradox/shared";
import type { CharacterView } from "../character/CharacterView";

interface Dummy {
  name: string;
  pose: HitboxPose;
  view: CharacterView;
  health: number;
  respawnIn: number;
  baseX: number;
  baseZ: number;
  /** Strafe amplitude (m) and speed (rad/s); 0 = static. */
  amp: number;
  speed: number;
  phase: number;
  crouchCycle: boolean;
  yaw: number;
  vx: number;
  combatT: number;
}

export interface DummyHit extends PlayerHit {
  index: number;
}

const RESPAWN = 3.5;

/**
 * Practice-range targets for offline play: static, strafing and crouch-peeking dummies
 * using the exact same hitboxes and characters as real players.
 */
export class PracticeDummies {
  readonly group = new THREE.Group();
  private readonly dummies: Dummy[] = [];
  private readonly hit: PlayerHit = { distance: 0, head: false };
  private time = 0;

  constructor(createView: () => CharacterView) {
    const layout: [number, number, number, number, boolean][] = [
      // x, z, amp, speed, crouchCycle
      [-3, -18, 0, 0, false],
      [3, -18, 0, 0, false],
      [0, -24, 3, 1.6, false],
      [-9, -12.5, 0, 0, true],
      [9, -12.5, 2, 2.4, false],
      [0, 0, 2.5, 1.1, false],
      [22, -6, 0, 0, false],
      [-22, -6, 4, 1.8, false],
    ];
    layout.forEach(([x, z, amp, speed, crouchCycle], i) => {
      const view = createView();
      this.group.add(view.group);
      this.dummies.push({
        name: `Target ${i + 1}`,
        pose: { x, y: x === 0 && z === 0 ? 1.5 : 0.02, z, crouch: 0 },
        view,
        health: PLAYER.maxHealth,
        respawnIn: 0,
        baseX: x,
        baseZ: z,
        amp,
        speed,
        phase: Math.random() * 6,
        crouchCycle,
        yaw: Math.PI,
        vx: 0,
        combatT: 0,
      });
    });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    for (const d of this.dummies) {
      if (d.respawnIn > 0) {
        d.respawnIn -= dt;
        if (d.respawnIn <= 0) d.health = PLAYER.maxHealth;
      }
      const alive = d.respawnIn <= 0;
      if (alive) {
        const before = d.pose.x;
        if (d.amp > 0) d.pose.x = d.baseX + Math.sin(this.time * d.speed + d.phase) * d.amp;
        d.vx = dt > 0 ? (d.pose.x - before) / dt : 0;
        if (d.crouchCycle) d.pose.crouch = Math.sin(this.time * 1.3 + d.phase) > 0 ? 1 : 0;
      }
      d.combatT = Math.max(0, d.combatT - dt);
      d.view.update(
        {
          dt,
          x: d.pose.x,
          y: d.pose.y,
          z: d.pose.z,
          vx: d.vx,
          vy: 0,
          vz: 0,
          grounded: true,
          crouch: d.pose.crouch,
          sliding: false,
          sprinting: false,
          ads: 0,
          lookYaw: d.yaw,
          lookPitch: 0,
          aimTarget: null,
          reload: -1,
          weapon: "vk12",
          // Strafers face the shooter (combat stance) so legs show strafe steps.
          combat: true,
          alive,
        },
        camera,
      );
    }
  }

  /** Nearest dummy hit along a ray, or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: DummyHit): DummyHit | null {
    let best = maxDist;
    let found = false;
    for (let i = 0; i < this.dummies.length; i++) {
      const d = this.dummies[i]!;
      if (d.respawnIn > 0) continue;
      if (rayVsPlayer(ox, oy, oz, dx, dy, dz, best, d.pose, this.hit)) {
        best = this.hit.distance;
        out.index = i;
        out.distance = this.hit.distance;
        out.head = this.hit.head;
        found = true;
      }
    }
    return found ? out : null;
  }

  /** Applies damage; returns true if this killed the dummy. */
  damage(index: number, amount: number, fromRight: boolean): boolean {
    const d = this.dummies[index];
    if (!d || d.respawnIn > 0) return false;
    d.health -= amount;
    d.view.hitReact(fromRight);
    if (d.health <= 0) {
      d.respawnIn = RESPAWN;
      return true;
    }
    return false;
  }

  name(index: number): string {
    return this.dummies[index]?.name ?? "Target";
  }

  /** For name tags: alive dummies with their views. */
  forEach(cb: (name: string, view: CharacterView, pose: HitboxPose, index: number) => void): void {
    this.dummies.forEach((d, i) => {
      if (d.respawnIn <= 0) cb(d.name, d.view, d.pose, i);
    });
  }

  dispose(): void {
    for (const d of this.dummies) d.view.dispose();
  }
}
