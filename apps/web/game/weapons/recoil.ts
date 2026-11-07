import { DEG2RAD, type WeaponDef } from "@paradox/shared";

/**
 * Applies a weapon's fixed recoil pattern to the player's aim. The kick moves the real
 * aim (what gets sent to the server), is eased in over a few frames for feel, and
 * after the spray the view drifts back by the portion the player did not compensate.
 */
export class RecoilController {
  private pendingYaw = 0;
  private pendingPitch = 0;
  private recoverable = 0;
  private sinceShot = 10;
  private recoverySpeed = 10;

  onShot(def: WeaponDef, sprayIndex: number, ads: number): void {
    const pat = def.recoil.pattern;
    const k = pat[Math.min(pat.length - 1, Math.max(0, sprayIndex - 1))]!;
    const mult = 1 + (def.recoil.adsMult - 1) * ads;
    // Slight per-shot variance keeps it organic while the pattern stays learnable.
    const jitter = 1 + (Math.random() - 0.5) * 0.08;
    this.pendingYaw += k[0] * mult * jitter * DEG2RAD;
    this.pendingPitch += k[1] * mult * jitter * DEG2RAD;
    this.recoverable += k[1] * mult * def.recoil.recoveryFraction * DEG2RAD;
    this.recoverySpeed = def.recoil.recoverySpeed * DEG2RAD;
    this.sinceShot = 0;
  }

  /** The player pulling down during a spray reduces how much recovery will return. */
  onLook(pitchDelta: number): void {
    if (pitchDelta < 0 && this.recoverable > 0) this.recoverable = Math.max(0, this.recoverable + pitchDelta);
  }

  /** Returns the aim delta to apply this frame (yaw, pitch in radians). */
  update(dt: number, out: { yaw: number; pitch: number }): void {
    this.sinceShot += dt;
    // Ease the kick in over ~40ms.
    const k = 1 - Math.exp(-dt * 38);
    let dy = this.pendingYaw * k;
    let dp = this.pendingPitch * k;
    this.pendingYaw -= dy;
    this.pendingPitch -= dp;
    if (Math.abs(this.pendingYaw) < 1e-6) {
      dy += this.pendingYaw;
      this.pendingYaw = 0;
    }
    if (Math.abs(this.pendingPitch) < 1e-6) {
      dp += this.pendingPitch;
      this.pendingPitch = 0;
    }
    if (this.sinceShot > 0.12 && this.recoverable > 0) {
      const r = Math.min(this.recoverable, this.recoverySpeed * dt * Math.min(1, (this.sinceShot - 0.12) * 6));
      this.recoverable -= r;
      dp -= r;
    }
    out.yaw = -dy;
    out.pitch = dp;
  }

  reset(): void {
    this.pendingYaw = this.pendingPitch = this.recoverable = 0;
  }
}
