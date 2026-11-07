import * as THREE from "three";
import { damp, type CollisionWorld } from "@paradox/shared";

export type CameraMode = "third" | "first";

/** Over-the-shoulder offsets in camera space (right, up, back), hip and ADS. */
const HIP = { right: 0.62, up: 0.28, back: 2.55 };
const ADS = { right: 0.62, up: 0.14, back: 1.45 };
const ARM_RADIUS = 0.22;
/** Third-person ADS narrows the FOV a bit more than first person (over-the-shoulder zoom). */
export const TP_ADS_ZOOM = 0.78;

const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * Positions the camera. Third person: a spring arm from the head out over the shoulder,
 * swept as a sphere against the world so it pulls in instantly when a wall is behind
 * the player and eases back out. First person: at the eye.
 */
export class CameraRig {
  mode: CameraMode = "third";
  /** +1 right shoulder, -1 left. */
  shoulder: 1 | -1 = 1;
  private side = 1;
  private armLength = HIP.back;
  /** Distance from pivot to camera this frame; small values mean the camera is inside the player. */
  currentArm = HIP.back;

  toggleMode(): void {
    this.mode = this.mode === "third" ? "first" : "third";
  }

  swapShoulder(): void {
    this.shoulder = this.shoulder === 1 ? -1 : 1;
  }

  get thirdPerson(): boolean {
    return this.mode === "third";
  }

  /**
   * @param eye head/eye position (already interpolated and smoothed)
   * @param yaw,pitch,roll camera orientation
   * @param ads 0..1
   */
  update(camera: THREE.PerspectiveCamera, world: CollisionWorld, eye: THREE.Vector3, yaw: number, pitch: number, roll: number, ads: number, dt: number): void {
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitch, yaw, roll);
    camera.updateMatrix();
    if (this.mode === "first") {
      camera.position.copy(eye);
      this.currentArm = 0;
      return;
    }

    this.side += (this.shoulder - this.side) * damp(10, dt);
    const a = ads * ads * (3 - 2 * ads);
    const right = (HIP.right + (ADS.right - HIP.right) * a) * this.side;
    const up = HIP.up + (ADS.up - HIP.up) * a;
    const back = HIP.back + (ADS.back - HIP.back) * a;

    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    // Pivot: above the head, shifted over the shoulder (checked so the shift itself can't enter a wall).
    _pivot.copy(eye);
    _pivot.y += up;
    const sideFree = world.castSphere(_pivot.x, _pivot.y, _pivot.z, _right.x * Math.sign(right), 0, _right.z * Math.sign(right), Math.abs(right), ARM_RADIUS);
    _pivot.addScaledVector(_right, Math.sign(right) * Math.max(0, sideFree - 0.02));

    // Arm: straight back from the pivot.
    _dir.copy(_fwd).negate();
    const free = world.castSphere(_pivot.x, _pivot.y, _pivot.z, _dir.x, _dir.y, _dir.z, back, ARM_RADIUS);
    const targetLen = Math.max(0.1, free - 0.05);
    // Pull in instantly (never clip), ease back out.
    this.armLength = targetLen < this.armLength ? targetLen : this.armLength + (targetLen - this.armLength) * damp(6, dt);
    this.currentArm = this.armLength;
    _desired.copy(_pivot).addScaledVector(_dir, this.armLength);
    camera.position.copy(_desired);
  }
}
