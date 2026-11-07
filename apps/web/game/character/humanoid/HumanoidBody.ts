import * as THREE from "three";
import type { CharacterUniforms } from "../characterMaterial";
import type { ClipId } from "./manifest";
import { type CharacterTemplate, type HumanoidLibrary, cloneCharacter, normalizeBoneName, retargetClip } from "./assets";
import { createHumanoidMaterial } from "./humanoidMaterial";

/** Movement input for one animation step, in the character's own frame. */
export interface BodyMotion {
  dt: number;
  /** Velocity along the facing direction (m/s, + = forward). */
  localFwd: number;
  /** Velocity to the character's right (m/s). */
  localRight: number;
  grounded: boolean;
  /** 0 standing .. 1 crouched. */
  crouch: number;
  sliding: boolean;
  sprinting: boolean;
}

/** Mixamo bone names for the roles CharacterView drives procedurally. */
const ROLE_BONES = {
  hips: "Hips",
  spine: "Spine",
  chest: "Spine2",
  neck: "Neck",
  head: "Head",
  upperArmL: "LeftArm",
  forearmL: "LeftForeArm",
  handL: "LeftHand",
  upperArmR: "RightArm",
  forearmR: "RightForeArm",
  handR: "RightHand",
} as const;
export type HumanoidRole = keyof typeof ROLE_BONES;

const LOCOMOTION: ClipId[] = ["idle", "walk_fwd", "walk_back", "strafe_l", "strafe_r", "run", "sprint", "crouch_idle", "crouch_walk"];

/**
 * Ground speed each clip was authored at (m/s, measured from Mixamo's Pro Rifle Pack root motion);
 * playback is scaled so feet don't slide. Backpedal and strafes use the pack's run clips because
 * the game's base movement speed (6.2 m/s) is a run.
 */
const CLIP_SPEED: Partial<Record<ClipId, number>> = {
  walk_fwd: 1.9,
  walk_back: 4.8,
  strafe_l: 4.8,
  strafe_r: 4.8,
  run: 4.8,
  sprint: 7.2,
  crouch_walk: 2.1,
};

/** If a clip wasn't downloaded, borrow another so the blend tree stays complete. */
const FALLBACK: Partial<Record<ClipId, ClipId>> = {
  walk_fwd: "run",
  run: "walk_fwd",
  sprint: "run",
  walk_back: "walk_fwd",
  strafe_l: "walk_fwd",
  strafe_r: "walk_fwd",
  crouch_walk: "crouch_idle",
  crouch_idle: "idle",
  fall: "idle",
};

const RUN_SPEED = 6.2;
const SPRINT_SPEED = 8.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Rotate a bone by a world-space rotation, keeping its children attached. */
export function rotateBoneWorld(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(rotation).multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * A realistic Mixamo human, animated from motion clips. CharacterView layers its procedural
 * aim, recoil, hit reactions and two-hand weapon IK on top, exactly as for the procedural rig.
 */
export class HumanoidBody {
  /** Faces -Z with +X to the right, like CharacterRig. */
  readonly root = new THREE.Group();
  readonly bones: Record<HumanoidRole, THREE.Bone>;
  readonly template: CharacterTemplate;

  private readonly mixer: THREE.AnimationMixer;
  private readonly model: THREE.Object3D;
  private readonly materials: THREE.Material[] = [];
  private readonly loco = new Map<ClipId, THREE.AnimationAction>();
  private readonly weights = new Map<ClipId, number>();
  private readonly fall: THREE.AnimationAction | null;
  private readonly jump: THREE.AnimationAction | null;
  private readonly land: THREE.AnimationAction | null;
  private readonly deaths: THREE.AnimationAction[] = [];
  private readonly headTopBone: THREE.Object3D | null;
  private airW = 0;
  private landT = 0;
  private wasGrounded = true;
  private death: THREE.AnimationAction | null = null;

  /** Seconds between animation updates (raise for distant characters). */
  updateInterval = 0;
  private acc = 0;

  private constructor(lib: HumanoidLibrary, template: CharacterTemplate, bones: Record<HumanoidRole, THREE.Bone>, model: THREE.Object3D, uniforms: CharacterUniforms) {
    this.template = template;
    this.bones = bones;
    this.model = model;
    // Mixamo characters face +Z; turn them to face -Z like the rest of the game.
    model.rotation.y = Math.PI;
    this.root.add(model);
    this.headTopBone = model.getObjectByName("HeadTop_End") ?? null;

    // Per-instance materials so rim / dissolve / team are per player.
    let noiseScale = 1;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone && noiseScale === 1) noiseScale = o.getWorldScale(_a).x || 1;
    });
    const matCache = new Map<THREE.Material, THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        let out = matCache.get(m);
        if (!out) {
          out = createHumanoidMaterial(m, uniforms, noiseScale);
          matCache.set(m, out);
          this.materials.push(out);
        }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (id: ClipId, i = 0) => {
      const c = lib.clips[id]?.[i];
      return c ? retargetClip(c, template) : null;
    };
    const resolve = (id: ClipId): THREE.AnimationClip | null => {
      for (let cur: ClipId | undefined = id; cur; cur = FALLBACK[cur]) {
        const c = clip(cur);
        if (c) return c;
      }
      return clip("idle");
    };
    const action = (c: THREE.AnimationClip, loop: boolean) => {
      const a = this.mixer.clipAction(c);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };
    for (const id of LOCOMOTION) {
      const c = resolve(id);
      if (c) this.loco.set(id, action(c, true));
    }
    this.loco.get("idle")?.setEffectiveWeight(1);
    this.weights.set("idle", 1);
    const fall = resolve("fall");
    this.fall = fall ? action(fall, true) : null;
    const jump = clip("jump");
    this.jump = jump ? action(jump, false) : null;
    const land = clip("land");
    this.land = land ? action(land, false) : null;
    for (let i = 0; i < (lib.clips.death?.length ?? 0); i++) {
      const c = clip("death", i);
      if (c) {
        const a = action(c, false);
        a.stop();
        this.deaths.push(a);
      }
    }
    // Desynchronise identical characters standing side by side.
    this.mixer.setTime(Math.random() * 3);
  }

  /** Build a body from a loaded library; null if the model lacks the bones we need. */
  static create(lib: HumanoidLibrary, template: CharacterTemplate, uniforms: CharacterUniforms): HumanoidBody | null {
    const model = cloneCharacter(template);
    const byName = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(normalizeBoneName(o.name), o as THREE.Bone);
    });
    const bones = {} as Record<HumanoidRole, THREE.Bone>;
    for (const [role, name] of Object.entries(ROLE_BONES) as [HumanoidRole, string][]) {
      const b = byName.get(name) ?? (role === "chest" ? byName.get("Spine1") : undefined);
      if (!b) {
        console.warn(`[humanoid] ${template.name} has no "${name}" bone; using the procedural character`);
        return null;
      }
      bones[role] = b;
    }
    return new HumanoidBody(lib, template, bones, model, uniforms);
  }

  /** Advance the motion clips. Procedural layers are applied by the caller afterwards. */
  animate(m: BodyMotion): void {
    this.acc += m.dt;
    if (this.acc < this.updateInterval) return;
    const dt = this.acc;
    this.acc = 0;
    if (!this.death) this.blend(m, dt);
    this.mixer.update(dt);
  }

  private blend(m: BodyMotion, dt: number): void {
    const speed = Math.hypot(m.localFwd, m.localRight);
    const moving = Math.min(1, speed / 1.6);
    const crouch = m.sliding ? 1 : m.crouch;
    const target = new Map<ClipId, number>();
    const add = (id: ClipId, w: number) => target.set(id, (target.get(id) ?? 0) + w);

    // Crouched set.
    add("crouch_idle", crouch * (m.sliding ? 1 : 1 - moving));
    if (!m.sliding) add("crouch_walk", crouch * moving);
    // Standing set: idle → walk/run/sprint, blended by direction.
    const stand = 1 - crouch;
    add("idle", stand * (1 - moving));
    if (speed > 0.01 && stand > 0) {
      const fwd = Math.max(0, m.localFwd);
      const back = Math.max(0, -m.localFwd);
      const right = Math.max(0, m.localRight);
      const left = Math.max(0, -m.localRight);
      const sum = fwd + back + right + left || 1;
      const k = stand * moving;
      const walkT = 1 - Math.min(1, Math.max(0, (speed - 1.8) / 2.2));
      const sprintT = m.sprinting ? Math.min(1, Math.max(0, (speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED))) : 0;
      const f = (fwd / sum) * k;
      add("walk_fwd", f * walkT);
      add("run", f * (1 - walkT) * (1 - sprintT));
      add("sprint", f * (1 - walkT) * sprintT);
      add("walk_back", (back / sum) * k);
      add("strafe_r", (right / sum) * k);
      add("strafe_l", (left / sum) * k);
    }

    // Airborne: jump on take-off, then fall; a short landing settle.
    if (this.wasGrounded && !m.grounded && !m.sliding) this.jump?.reset().play();
    if (!this.wasGrounded && m.grounded) {
      this.landT = 0.3;
      this.land?.reset().play();
    }
    this.wasGrounded = m.grounded;
    this.landT = Math.max(0, this.landT - dt);
    this.airW = approach(this.airW, m.grounded || m.sliding ? 0 : 1, m.grounded ? 16 : 7, dt);
    const jumpW = this.jump && this.jump.time < this.jump.getClip().duration * 0.55 ? this.airW : 0;
    this.jump?.setEffectiveWeight(jumpW);
    this.fall?.setEffectiveWeight(this.airW - jumpW);
    const landW = this.landT > 0 ? (this.landT / 0.3) * 0.5 : 0;
    this.land?.setEffectiveWeight(landW);

    const ground = (1 - this.airW) * (1 - landW);
    for (const id of LOCOMOTION) {
      const a = this.loco.get(id);
      if (!a) continue;
      const w = approach(this.weights.get(id) ?? 0, target.get(id) ?? 0, 12, dt);
      this.weights.set(id, w);
      a.setEffectiveWeight(w * ground);
      const ref = CLIP_SPEED[id];
      a.setEffectiveTimeScale(ref && speed > 0.05 ? Math.min(2.1, Math.max(0.5, speed / ref)) : 1);
    }
  }

  /** Play a random death animation. */
  startDeath(): void {
    if (this.death || !this.deaths.length) return;
    this.death = this.deaths[Math.floor(Math.random() * this.deaths.length)]!;
    for (const a of [...this.loco.values(), this.fall, this.jump, this.land]) a?.setEffectiveWeight(0);
    this.death.reset();
    this.death.setEffectiveWeight(1);
    // Mixamo deaths run ~3 s; the game dissolves bodies from 1.4 s, so play them faster
    // to reach the ground first.
    const d = this.death.getClip().duration;
    this.death.setEffectiveTimeScale(Math.min(2.6, Math.max(1, d / 1.3)));
    this.death.play();
  }

  get hasDeathAnimation(): boolean {
    return this.deaths.length > 0;
  }

  clearDeath(): void {
    if (!this.death) return;
    this.death.stop();
    this.death = null;
    this.airW = 0;
    this.loco.get("idle")?.setEffectiveWeight(1);
  }

  /** Point above the head (for name tags). */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    if (this.headTopBone) {
      this.headTopBone.getWorldPosition(out);
      out.y += 0.25;
    } else {
      this.bones.head.getWorldPosition(out);
      out.y += 0.45;
    }
    return out;
  }

  /**
   * Two-bone arm IK for any skeleton: rotates the upper arm and forearm (keeping their twist)
   * so the wrist reaches `target`, with the elbow bending toward `pole`.
   */
  solveArm(side: "L" | "R", target: THREE.Vector3, pole: THREE.Vector3): void {
    const upper = side === "L" ? this.bones.upperArmL : this.bones.upperArmR;
    const lower = side === "L" ? this.bones.forearmL : this.bones.forearmR;
    const hand = side === "L" ? this.bones.handL : this.bones.handR;
    upper.getWorldPosition(_a);
    lower.getWorldPosition(_b);
    hand.getWorldPosition(_c);
    const lu = _a.distanceTo(_b);
    const ll = _b.distanceTo(_c);
    _d.subVectors(target, _a);
    const dist = Math.min(Math.max(_d.length(), 1e-3), lu + ll - 1e-3);
    _d.normalize();
    _p.subVectors(pole, _a);
    _p.addScaledVector(_d, -_p.dot(_d));
    if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0).addScaledVector(_d, -_d.y);
    _p.normalize();
    const cosA = Math.min(1, Math.max(-1, (lu * lu + dist * dist - ll * ll) / (2 * lu * dist)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    _elbow.copy(_a).addScaledVector(_d, lu * cosA).addScaledVector(_p, lu * sinA);

    // Upper arm: swing its current direction onto the desired elbow direction.
    _from.subVectors(_b, _a).normalize();
    _to.subVectors(_elbow, _a).normalize();
    rotateBoneWorld(upper, _q.setFromUnitVectors(_from, _to));
    // Forearm: swing onto the target.
    lower.getWorldPosition(_b);
    hand.getWorldPosition(_c);
    _from.subVectors(_c, _b).normalize();
    _to.copy(_a).addScaledVector(_d, dist).sub(_b).normalize();
    rotateBoneWorld(lower, _q.setFromUnitVectors(_from, _to));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
