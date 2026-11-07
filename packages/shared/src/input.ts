/** One fixed-tick input command. The client sends these; the server simulates them. */
export interface InputCmd {
  /** Monotonic per-client sequence number (one per tick). */
  seq: number;
  /** Bitmask of {@link Btn}. */
  buttons: number;
  /** Strafe axis, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward axis, -1 (back) .. 1 (forward). */
  moveY: number;
  /** Camera look direction in radians (includes recoil). Drives movement and replicated aim. */
  yaw: number;
  pitch: number;
  /**
   * Shot direction from the weapon origin toward what the crosshair is over. Equals
   * yaw/pitch in first person; in third person it converges on the camera's target point.
   */
  aimYaw: number;
  aimPitch: number;
  /** Server tick the client was rendering remote players at (lag compensation). */
  viewTick: number;
  /** Fraction (0..1) between viewTick and viewTick+1. */
  viewAlpha: number;
}

export const Btn = {
  Jump: 1 << 0,
  Crouch: 1 << 1,
  Sprint: 1 << 2,
  Fire: 1 << 3,
  Ads: 1 << 4,
  Reload: 1 << 5,
  Primary: 1 << 6,
  Secondary: 1 << 7,
  Rewind: 1 << 8,
  Echo: 1 << 9,
  Ability: 1 << 10,
  Interact: 1 << 11,
  /** Camera mode: shots originate at the shoulder-mounted weapon instead of the eye. */
  ThirdPerson: 1 << 12,
  /** Over-the-left-shoulder camera (weapon origin mirrors). */
  ShoulderLeft: 1 << 13,
} as const;

export const createInputCmd = (): InputCmd => ({
  seq: 0,
  buttons: 0,
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  aimYaw: 0,
  aimPitch: 0,
  viewTick: 0,
  viewAlpha: 0,
});

export function copyInputCmd(dst: InputCmd, src: InputCmd): InputCmd {
  dst.seq = src.seq;
  dst.buttons = src.buttons;
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.aimYaw = src.aimYaw;
  dst.aimPitch = src.aimPitch;
  dst.viewTick = src.viewTick;
  dst.viewAlpha = src.viewAlpha;
  return dst;
}

/**
 * Quantize analog axes the same way the wire format does, so client prediction
 * simulates exactly what the server will receive.
 */
export const quantizeAxis = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127;
