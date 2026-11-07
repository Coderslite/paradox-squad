import { Btn, DEG2RAD } from "@paradox/shared";
import { getSettings, type Action } from "@/stores/settings";

/** Source-engine style: degrees of rotation per mouse count at sensitivity 1. */
const DEG_PER_COUNT = 0.022;
const PAD_DEADZONE = 0.14;
/** Gamepad look speed at full deflection, degrees per second (yaw, pitch). */
const PAD_LOOK_SPEED: [number, number] = [260, 170];

/**
 * Keyboard + mouse (pointer lock, raw input where supported) + Gamepad API.
 * The game loop reads it once per render frame (look) and once per tick (buttons/axes).
 */
export class InputManager {
  private readonly down = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private adsToggled = false;
  private wheelSlot: 0 | 1 | -1 = -1;
  private padButtons = 0;
  private padMoveX = 0;
  private padMoveY = 0;
  private padLookX = 0;
  private padLookY = 0;
  private lastPadY = false;

  locked = false;
  usingGamepad = false;
  /** Set by the game: < 1 while the crosshair is over an enemy (controller aim assist "friction"). */
  aimAssistScale = 1;

  onLockChange: ((locked: boolean) => void) | null = null;
  onKeyPress: ((code: string) => void) | null = null;

  constructor(private readonly element: HTMLElement) {}

  attach(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.element.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("mousemove", this.handleMouseMove);
    this.element.addEventListener("wheel", this.handleWheel, { passive: true });
    this.element.addEventListener("contextmenu", this.preventDefault);
    document.addEventListener("pointerlockchange", this.handleLockChange);
  }

  detach(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.element.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("mousemove", this.handleMouseMove);
    this.element.removeEventListener("wheel", this.handleWheel);
    this.element.removeEventListener("contextmenu", this.preventDefault);
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Must be called from a user gesture. Tries raw (unaccelerated) input first. */
  async requestLock(): Promise<void> {
    const el = this.element as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      if (getSettings().rawInput) {
        await el.requestPointerLock({ unadjustedMovement: true });
        return;
      }
    } catch {
      // NotSupportedError (Safari, some Linux setups): fall back to standard lock.
    }
    try {
      await el.requestPointerLock();
    } catch {
      // Lock was refused (e.g. called too soon after an exit); the UI will offer to retry.
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Accumulated look since the last call, in radians (yaw, pitch). */
  consumeLook(dt: number, adsAmount: number, zoom: number, out: { yaw: number; pitch: number }): void {
    const s = getSettings();
    // Scale ADS sensitivity by the zoom so the crosshair moves "the same" on screen.
    const adsScale = 1 + (s.adsSensitivity * zoom - 1) * adsAmount;
    const k = s.sensitivity * DEG_PER_COUNT * DEG2RAD * adsScale;
    out.yaw = -this.lookDX * k;
    out.pitch = -this.lookDY * k * (s.invertY ? -1 : 1);
    this.lookDX = 0;
    this.lookDY = 0;

    if (this.usingGamepad) {
      const assist = this.aimAssistScale;
      out.yaw -= this.padLookX * PAD_LOOK_SPEED[0] * DEG2RAD * dt * adsScale * assist;
      out.pitch -= this.padLookY * PAD_LOOK_SPEED[1] * DEG2RAD * dt * adsScale * assist * (s.invertY ? -1 : 1);
    }
  }

  isDown(action: Action): boolean {
    const codes = getSettings().bindings[action];
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Movement axes for this tick (keyboard or left stick). */
  moveAxes(out: { x: number; y: number }): void {
    let x = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0);
    let y = (this.isDown("forward") ? 1 : 0) - (this.isDown("back") ? 1 : 0);
    if (this.usingGamepad && x === 0 && y === 0) {
      x = this.padMoveX;
      y = this.padMoveY;
    }
    out.x = x;
    out.y = y;
  }

  /** Button bitmask for this tick. Inputs are ignored while the pointer is not locked (paused). */
  buttons(): number {
    if (!this.locked && !this.usingGamepad) return 0;
    let b = this.padButtons;
    if (this.isDown("jump")) b |= Btn.Jump;
    if (this.isDown("crouch")) b |= Btn.Crouch;
    if (this.isDown("sprint")) b |= Btn.Sprint;
    if (this.isDown("reload")) b |= Btn.Reload;
    if (this.isDown("primary")) b |= Btn.Primary;
    if (this.isDown("secondary")) b |= Btn.Secondary;
    if (this.isDown("rewind")) b |= Btn.Rewind;
    if (this.isDown("echo")) b |= Btn.Echo;
    if (this.isDown("ability")) b |= Btn.Ability;
    if (this.isDown("interact")) b |= Btn.Interact;
    if (this.down.has("Mouse0")) b |= Btn.Fire;
    const ads = getSettings().toggleAds ? this.adsToggled : this.down.has("Mouse2");
    if (ads) b |= Btn.Ads;
    if (this.wheelSlot !== -1) {
      b |= this.wheelSlot === 0 ? Btn.Primary : Btn.Secondary;
      this.wheelSlot = -1;
    }
    return b;
  }

  /** Mouse wheel cycles weapons; the game tells us which slot is active. */
  activeSlot: 0 | 1 = 0;

  /** Poll the Gamepad API once per frame. */
  pollGamepad(): void {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.padButtons = 0;
      this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
      return;
    }
    const ax = (i: number): number => pad.axes[i] ?? 0;
    const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    const value = (i: number): number => pad.buttons[i]?.value ?? 0;
    const [mx, my] = radialDeadzone(ax(0), ax(1), PAD_DEADZONE, 1);
    const [lx, ly] = radialDeadzone(ax(2), ax(3), PAD_DEADZONE, 2);
    let anyInput = mx !== 0 || my !== 0 || lx !== 0 || ly !== 0;
    for (let i = 0; i < pad.buttons.length && !anyInput; i++) anyInput = pressed(i);
    if (anyInput) this.usingGamepad = true;

    this.padMoveX = mx;
    this.padMoveY = -my;
    this.padLookX = lx;
    this.padLookY = ly;

    // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 10 L3.
    let b = 0;
    if (pressed(0)) b |= Btn.Jump;
    if (pressed(1)) b |= Btn.Crouch;
    if (pressed(2)) b |= Btn.Reload;
    if (pressed(10)) b |= Btn.Sprint;
    if (value(7) > 0.35) b |= Btn.Fire;
    if (value(6) > 0.35) b |= Btn.Ads;
    if (pressed(4)) b |= Btn.Ability;
    if (pressed(5)) b |= Btn.Rewind;
    // Y cycles weapons on press.
    if (pressed(3) && !this.lastPadY) this.wheelSlot = this.activeSlot === 0 ? 1 : 0;
    this.padButtons = b;
    this.lastPadY = pressed(3);
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Tab" || (this.locked && (e.code === "Space" || e.code.startsWith("Arrow")))) e.preventDefault();
    // Ctrl+W etc. must never close the tab mid-match when Ctrl is bound to crouch.
    if (this.locked && e.ctrlKey && e.code !== "ControlLeft") e.preventDefault();
    if (!e.repeat) this.onKeyPress?.(e.code);
    this.down.add(e.code);
    this.usingGamepad = false;
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly handleBlur = (): void => {
    this.down.clear();
  };

  private readonly handleMouseDown = (e: MouseEvent): void => {
    this.usingGamepad = false;
    if (!this.locked) return;
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
    this.down.add(`Mouse${e.button}`);
    this.onKeyPress?.(`Mouse${e.button}`);
    if (e.button === 2) this.adsToggled = !this.adsToggled;
  };

  private readonly handleMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // Chrome occasionally reports a huge spike right after locking; drop it.
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    if (!this.locked || Math.abs(e.deltaY) < 1) return;
    this.wheelSlot = this.activeSlot === 0 ? 1 : 0;
  };

  private readonly handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      this.down.clear();
      this.adsToggled = false;
    }
    this.lookDX = this.lookDY = 0;
    this.onLockChange?.(this.locked);
  };

  private readonly preventDefault = (e: Event): void => e.preventDefault();
}

/** Radial deadzone with a power response curve, so small stick motions give fine aim. */
function radialDeadzone(x: number, y: number, dz: number, power: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < dz) return [0, 0];
  const scaled = Math.min(1, (mag - dz) / (1 - dz)) ** power;
  return [(x / mag) * scaled, (y / mag) * scaled];
}
