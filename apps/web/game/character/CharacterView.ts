import * as THREE from "three";
import { damp, lerpAngle, type WeaponId } from "@paradox/shared";
import { WEAPON_HANDS } from "../render/weaponModels";
import { solveTwoBone } from "./ik";
import { ARM_LOWER, ARM_UPPER, CharacterRig } from "./rig";
import { WorldWeapon } from "./worldWeapon";
import { HumanoidBody, rotateBoneWorld } from "./humanoid/HumanoidBody";
import { type HumanoidLibrary, humanoidLibrary, loadHumanoidLibrary, pickTemplate } from "./humanoid/assets";

/** Everything the animator needs for one frame (local player, remote player, bot or dummy). */
export interface CharacterFrame {
  dt: number;
  /** Feet position (world). */
  x: number;
  y: number;
  z: number;
  /** World velocity (m/s). */
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** 0 standing .. 1 crouched. */
  crouch: number;
  sliding: boolean;
  sprinting: boolean;
  /** 0..1 aim-down-sights. */
  ads: number;
  /** Where the player is looking (radians). */
  lookYaw: number;
  lookPitch: number;
  /** World point the weapon should point at; null = along the look direction. */
  aimTarget: THREE.Vector3 | null;
  /** -1 when not reloading, else 0..1 progress. */
  reload: number;
  weapon: WeaponId;
  /** Recently fired or aiming: the body squares up to the aim direction. */
  combat: boolean;
  alive: boolean;
}

class Spring {
  v = 0;
  vel = 0;
  constructor(
    private readonly k: number,
    private readonly c: number,
  ) {}
  step(dt: number): number {
    this.vel += (-this.v * this.k - this.vel * this.c) * dt;
    this.v += this.vel * dt;
    return this.v;
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qa = new THREE.Quaternion();

/**
 * A visible, animated character. Procedural animation state machine with blended layers:
 *   base:   locomotion blend space (idle/walk/run/sprint × forward/back/strafe), crouch,
 *           airborne (jump/fall), slide, death
 *   upper:  aim pitch + twist, sprint carry, reload, fire recoil (additive), hit reaction (additive)
 *   ik:     both hands placed on the weapon, which is aimed exactly at the target point.
 *
 * When Mixamo character assets are available (see ./humanoid), the procedural body is swapped
 * for a realistic human driven by motion clips; aim, recoil, hit reactions, weapon IK, rim and
 * dissolve are layered on top the same way. Without assets the procedural body is used.
 */
export class CharacterView {
  readonly group = new THREE.Group();
  readonly rig = new CharacterRig();
  readonly weapon = new WorldWeapon();
  private readonly flash: THREE.Mesh;
  private flashT = 0;

  bodyYaw = 0;
  private phase = 0;
  private gait = 0;
  private airW = 0;
  private crouchW = 0;
  private slideW = 0;
  private sprintW = 0;
  private adsW = 0;
  private reloadW = 0;
  private time = Math.random() * 10;
  private deadT = -1;
  private dissolveStarted = false;
  private readonly recoil = new Spring(220, 18);
  private readonly hit = new Spring(160, 12);
  private hitSide = 0;
  private readonly land = new Spring(150, 13);
  private wasGrounded = true;
  private hidden = false;

  private readonly boneList: THREE.Bone[] = Object.values(this.rig.bones);

  /** Realistic body, once the character assets have loaded (null = procedural body). */
  private body: HumanoidBody | null = null;
  /** Character-space frame on the humanoid's chest, matching the procedural chest bone. */
  private readonly chestAnchor = new THREE.Object3D();
  private disposed = false;
  private characterKey: string | undefined;

  /** Called once when a dead character starts dissolving (spawn particles here). */
  onDissolve: ((x: number, y: number, z: number) => void) | null = null;

  constructor(flashMaterial: THREE.Material) {
    this.group.add(this.rig.root, this.weapon.group);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), flashMaterial);
    this.flash.visible = false;
    this.weapon.muzzle.add(this.flash);

    const lib = humanoidLibrary();
    if (lib) this.attachBody(lib);
    else
      void loadHumanoidLibrary().then((l) => {
        if (l && !this.disposed && !this.body) this.attachBody(l);
      });
  }

  /**
   * Choose which character this view shows (e.g. a player's id or name) so the same
   * player always looks the same. Without a key, characters are dealt round-robin.
   */
  setCharacterKey(key: string): void {
    if (key === this.characterKey) return;
    this.characterKey = key;
    const lib = humanoidLibrary();
    if (lib && this.body && this.body.template !== pickTemplate(lib, key)) this.attachBody(lib);
  }

  private attachBody(lib: HumanoidLibrary): void {
    const body = HumanoidBody.create(lib, pickTemplate(lib, this.characterKey), this.rig.uniforms);
    if (!body) return;
    this.body?.dispose();
    this.body = body;
    this.rig.root.add(body.root);
    this.rig.mesh.visible = false;
    // Chest anchor: follows the chest bone, axes aligned with the character (faces -Z, +X right)
    // in the bind pose, at the procedural chest height so the weapon offsets carry over.
    body.root.updateMatrixWorld(true);
    const chest = body.bones.chest;
    chest.add(this.chestAnchor);
    chest.getWorldPosition(_v);
    chest.getWorldQuaternion(_q).invert();
    chest.getWorldScale(_v2);
    this.chestAnchor.quaternion.copy(_q);
    this.chestAnchor.scale.set(1 / _v2.x, 1 / _v2.y, 1 / _v2.z);
    chest.worldToLocal(this.chestAnchor.position.set(_v.x, 1.25, _v.z));
  }

  /** True when the realistic (Mixamo) body is shown. */
  get realistic(): boolean {
    return this.body !== null;
  }


  setTeam(color: number): void {
    this.rig.setTeamColor(color);
  }

  setRim(color: number, strength: number): void {
    this.rig.setRim(color, strength);
  }

  setVisible(v: boolean): void {
    this.hidden = !v;
    this.group.visible = v && this.deadT < 2;
  }

  fire(): void {
    this.recoil.vel += 6;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  hitReact(fromRight: boolean): void {
    this.hit.vel += 7;
    this.hitSide = fromRight ? -1 : 1;
  }

  /** World position of the muzzle (tracer origin). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.weapon.muzzle.getWorldPosition(out);
  }

  /** Point above the head for name tags. */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    if (this.body) return this.body.headTop(out);
    this.rig.bones.head.getWorldPosition(out);
    out.y += 0.42;
    return out;
  }

  get isDissolved(): boolean {
    return this.deadT >= 2;
  }

  update(f: CharacterFrame, camera: THREE.Camera): void {
    const dt = Math.min(f.dt, 0.05);
    this.time += dt;
    const b = this.rig.bones;

    // ---- Death state ----
    if (!f.alive) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT += dt;
    } else if (this.deadT >= 0) {
      this.deadT = -1;
      this.dissolveStarted = false;
      this.rig.setDissolve(0);
      this.body?.clearDeath();
      if (this.body) this.body.root.rotation.set(0, 0, 0);
    }
    const dead = this.deadT >= 0;
    this.group.visible = !this.hidden && this.deadT < 2;
    if (!this.group.visible) return;
    if (this.body) {
      // Distant characters animate at a lower rate (the M1 budget is 8 skinned people on screen).
      const dist = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
      this.body.updateInterval = dist > 50 ? 1 / 15 : dist > 25 ? 1 / 30 : 0;
    }

    // ---- Facing: square up when aiming/shooting, otherwise face the movement direction ----
    const speed = Math.hypot(f.vx, f.vz);
    if (!dead) {
      const target = f.combat || f.ads > 0.1 || speed < 0.4 ? f.lookYaw : Math.atan2(-f.vx, -f.vz);
      this.bodyYaw = lerpAngle(this.bodyYaw, target, damp(f.combat ? 18 : 10, dt));
    }
    const sinY = Math.sin(this.bodyYaw);
    const cosY = Math.cos(this.bodyYaw);
    const localFwd = f.vx * -sinY + f.vz * -cosY;
    const localRight = f.vx * cosY + f.vz * -sinY;
    let aimOff = f.lookYaw - this.bodyYaw;
    aimOff = Math.atan2(Math.sin(aimOff), Math.cos(aimOff));
    aimOff = Math.max(-1.3, Math.min(1.3, aimOff));

    // ---- Layer weights ----
    const k = damp(12, dt);
    this.gait += (Math.min(speed, 9) - this.gait) * damp(10, dt);
    this.airW += ((f.grounded || f.sliding ? 0 : 1) - this.airW) * k;
    this.crouchW += (f.crouch - this.crouchW) * k;
    this.slideW += ((f.sliding ? 1 : 0) - this.slideW) * k;
    this.sprintW += ((f.sprinting && f.reload < 0 && f.ads < 0.1 && !f.combat ? 1 : 0) - this.sprintW) * damp(8, dt);
    this.adsW += (f.ads - this.adsW) * damp(16, dt);
    this.reloadW += ((f.reload >= 0 ? 1 : 0) - this.reloadW) * k;
    if (f.grounded && !this.wasGrounded && f.vy < -3) this.land.vel -= Math.min(4, -f.vy * 0.4);
    this.wasGrounded = f.grounded;

    // ---- Locomotion blend space ----
    const amp = Math.min(1.25, this.gait / 6.2) * (1 - this.slideW) * (1 - this.airW);
    const stride = 0.9 + Math.min(1, this.gait / 8.6) * 1.0;
    if (f.grounded && !f.sliding) this.phase += (this.gait * dt * Math.PI * 2) / stride;
    const dirAngle = speed > 0.2 ? Math.atan2(localRight, localFwd) : 0;
    const fwdK = Math.cos(dirAngle);
    const sideK = Math.sin(dirAngle);
    const legSwing = 0.55 * amp;

    const body = this.body;
    const landDip = this.land.step(dt);
    const pitch = Math.max(-1.2, Math.min(1.2, f.lookPitch));
    const rec = this.recoil.step(dt);
    const hit = this.hit.step(dt);
    const cw = this.crouchW * (1 - this.slideW);
    const sw = this.slideW;

    if (!body) {
      for (const bone of this.boneList) bone.rotation.set(0, 0, 0);
      b.root.position.set(0, 0, 0);

      const leg = (thigh: THREE.Bone, shin: THREE.Bone, foot: THREE.Bone, ph: number) => {
        const s = Math.sin(ph);
        const c = Math.cos(ph);
        thigh.rotation.x = s * legSwing * fwdK;
        thigh.rotation.z = s * legSwing * sideK * 0.55;
        // Knee lifts while the leg swings through (direction-aware so backpedals look right).
        shin.rotation.x = -(0.08 + amp * 0.95 * Math.max(0, c * Math.sign(fwdK || 1)));
        foot.rotation.x = -(thigh.rotation.x + shin.rotation.x) * 0.7;
      };
      leg(b.thighL, b.shinL, b.footL, this.phase);
      leg(b.thighR, b.shinR, b.footR, this.phase + Math.PI);

      // Crouch
      b.thighL.rotation.x += 1.15 * cw;
      b.thighR.rotation.x += 1.15 * cw;
      b.shinL.rotation.x += -1.9 * cw;
      b.shinR.rotation.x += -1.9 * cw;
      b.footL.rotation.x += 0.75 * cw;
      b.footR.rotation.x += 0.75 * cw;

      // Airborne (tuck / fall)
      const a = this.airW;
      const falling = f.vy < 0 ? 1 : 0;
      b.thighL.rotation.x += a * (0.65 - falling * 0.25);
      b.shinL.rotation.x += a * (-1.1 + falling * 0.4);
      b.thighR.rotation.x += a * -0.15;
      b.shinR.rotation.x += a * -0.45;

      // Slide
      b.thighR.rotation.x += sw * 1.4;
      b.shinR.rotation.x += sw * -0.05;
      b.thighL.rotation.x += sw * 0.35;
      b.shinL.rotation.x += sw * -1.8;
      b.thighL.rotation.z += sw * -0.25;

      // Hips: height, bob, twist
      b.hips.position.y = 0.95 - cw * 0.36 - sw * 0.5 - amp * 0.035 * Math.abs(Math.cos(this.phase)) + landDip * 0.12;
      b.hips.rotation.y = Math.sin(this.phase) * 0.14 * amp * fwdK;
      b.hips.rotation.z = Math.cos(this.phase) * 0.04 * amp;

      // ---- Upper body ----
      b.spine.rotation.x = pitch * 0.25 - this.sprintW * 0.22 - cw * 0.12 + sw * 0.4 + hit * 0.12;
      b.spine.rotation.y = aimOff * 0.35 - b.hips.rotation.y;
      b.spine.rotation.z = this.hitSide * hit * 0.12;
      b.chest.rotation.x = pitch * 0.3 + rec * 0.05 + Math.sin(this.time * 1.7) * 0.012;
      b.chest.rotation.y = aimOff * 0.4;
      b.neck.rotation.x = pitch * 0.2;
      b.head.rotation.x = pitch * 0.25 - sw * 0.3;
      b.neck.rotation.y = aimOff * 0.25;

      // ---- Death pose (falls backward, then dissolves) ----
      if (dead) {
        const t = smooth(Math.min(1, this.deadT / 0.55));
        b.root.rotation.x = t * 1.45;
        b.root.position.z = t * 0.25;
        b.hips.position.y = 0.95 - t * 0.25;
        b.thighL.rotation.x = 0.5 * t;
        b.shinL.rotation.x = -0.9 * t;
        b.spine.rotation.x = -0.2 * t;
        b.head.rotation.x = 0.5 * t;
      }
    } // end procedural body

    // Dissolve: the realistic body plays its death animation first.
    if (dead) {
      const start = body?.hasDeathAnimation ? 1.4 : 1.1;
      if (this.deadT > start) {
        if (!this.dissolveStarted) {
          this.dissolveStarted = true;
          const p = this.group.getWorldPosition(_v);
          this.onDissolve?.(p.x, p.y + 0.3, p.z);
        }
        this.rig.setDissolve(Math.min(1, (this.deadT - start) / (2 - start - 0.05)));
      }
    }

    // Place and orient the character.
    const root = this.rig.root;
    root.position.set(f.x, f.y, f.z);
    root.rotation.set(0, this.bodyYaw, 0);
    root.updateMatrixWorld(true);

    if (body) {
      if (dead) body.startDeath();
      body.animate({ dt, localFwd, localRight, grounded: f.grounded, crouch: f.crouch, sliding: f.sliding, sprinting: f.sprinting });
      if (dead && !body.hasDeathAnimation) body.root.rotation.x = smooth(Math.min(1, this.deadT / 0.55)) * 1.45;
      root.updateMatrixWorld(true);
      if (!dead) {
        // Procedural aim / recoil / hit layers, as world-space rotations so they work on any skeleton.
        const right = _v.set(cosY, 0, -sinY);
        const back = _v2.set(sinY, 0, cosY);
        const layer = (bone: THREE.Bone, x: number, y: number, z: number) => {
          if (x) rotateBoneWorld(bone, _qa.setFromAxisAngle(right, x));
          if (y) rotateBoneWorld(bone, _qa.setFromAxisAngle(_up, y));
          if (z) rotateBoneWorld(bone, _qa.setFromAxisAngle(back, z));
        };
        const hb = body.bones;
        layer(hb.spine, pitch * 0.25 - this.sprintW * 0.12 + sw * 0.25 + hit * 0.12, aimOff * 0.35, this.hitSide * hit * 0.12);
        layer(hb.chest, pitch * 0.3 + rec * 0.05, aimOff * 0.4, 0);
        layer(hb.neck, pitch * 0.2, aimOff * 0.25, 0);
        layer(hb.head, pitch * 0.25 - sw * 0.3, 0, 0);
      }
    }
    const chest = body ? this.chestAnchor : b.chest;

    // ---- Weapon: anchored at the chest, aimed exactly at the target ----
    this.weapon.set(f.weapon);
    const hands = WEAPON_HANDS[f.weapon];
    const w = this.weapon.group;
    w.visible = !dead || this.deadT < 0.3;
    // Chest-local anchors: hip fire, ADS (cheek weld), sprint carry, reload.
    const adsK = this.adsW;
    const sprintK = this.sprintW;
    const reloadK = this.reloadW;
    // The realistic body holds the rifle tucked into the shoulder so a human-length arm reaches the handguard.
    const baseX = body ? 0.08 : 0.14;
    const baseZ = body ? 0.06 : -0.18;
    _v.set(baseX - adsK * 0.07 - sprintK * 0.08, 0.16 + adsK * 0.12 - sprintK * 0.08 - reloadK * 0.07, baseZ - adsK * 0.05 - sprintK * 0.05);
    chest.localToWorld(_v);

    // Aim direction: toward the target point, or along the look direction.
    if (f.aimTarget && !dead) _dir.subVectors(f.aimTarget, _v).normalize();
    else _dir.set(-Math.sin(f.lookYaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(f.lookYaw) * Math.cos(pitch));
    // Stock sits at the shoulder: push the model forward along the barrel.
    w.position.copy(_v).addScaledVector(_dir, hands.stock * 0.75);
    _m.lookAt(w.position, _v2.copy(w.position).add(_dir), _up);
    w.quaternion.setFromRotationMatrix(_m);
    // Sprint carry and reload tilt are rotations on top of the aim.
    if (sprintK > 0.01 || reloadK > 0.01 || dead) {
      const deadK = dead ? smooth(Math.min(1, this.deadT / 0.4)) : 0;
      _e.set(-0.75 * sprintK - 0.45 * reloadK - deadK, 0.8 * sprintK, 0.5 * reloadK + deadK);
      _q.setFromEuler(_e);
      w.quaternion.multiply(_q);
    }
    w.translateZ(rec * -0.03);
    w.updateMatrixWorld(true);

    // ---- Arm IK onto the weapon ----
    if (body && dead) {
      // The death animation moves the arms.
    } else if (!dead || this.deadT < 0.3) {
      const solve = (side: "L" | "R") =>
        body
          ? body.solveArm(side, _target, _pole)
          : side === "L"
            ? solveTwoBone(b.upperArmL, b.forearmL, ARM_UPPER, ARM_LOWER, _target, _pole)
            : solveTwoBone(b.upperArmR, b.forearmR, ARM_UPPER, ARM_LOWER, _target, _pole);
      _target.copy(hands.grip);
      w.localToWorld(_target);
      _pole.set(0.45, -0.7, 0.35).applyQuaternion(_q2.setFromAxisAngle(_up, this.bodyYaw));
      _pole.add(chest.getWorldPosition(_v2));
      solve("R");

      // Support hand: on the handguard, or on the magazine/belt during reloads.
      _target.copy(hands.support);
      if (f.reload >= 0) {
        const r = f.reload;
        const toMag = smooth(win(r, 0.05, 0.2)) * (1 - smooth(win(r, 0.3, 0.42)));
        const toBelt = smooth(win(r, 0.3, 0.42)) * (1 - smooth(win(r, 0.5, 0.65)));
        const toMag2 = smooth(win(r, 0.5, 0.65)) * (1 - smooth(win(r, 0.75, 0.9)));
        const magK = Math.max(toMag, toMag2);
        _target.lerp(_v2.set(0, -0.14, -0.05), magK);
        w.localToWorld(_target);
        if (toBelt > 0) {
          (body ? body.bones.hips : b.hips).getWorldPosition(_v2);
          _v2.y += 0.05;
          _target.lerp(_v2, toBelt);
        }
      } else w.localToWorld(_target);
      _pole.set(-0.5, -0.6, 0.2).applyQuaternion(_q2.setFromAxisAngle(_up, this.bodyYaw));
      _pole.add(chest.getWorldPosition(_v2));
      solve("L");
    } else {
      // Dead: arms go limp.
      b.upperArmL.rotation.set(-0.3, 0, -0.4);
      b.upperArmR.rotation.set(-0.3, 0, 0.4);
    }

    // Muzzle flash billboard.
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.quaternion.copy(camera.quaternion);
      this.weapon.muzzle.getWorldQuaternion(_q).invert();
      this.flash.quaternion.premultiply(_q);
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.body?.dispose();
    this.body = null;
    this.group.removeFromParent();
    this.rig.dispose();
    this.flash.geometry.dispose();
  }
}
