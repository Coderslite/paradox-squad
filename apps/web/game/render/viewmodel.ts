import * as THREE from "three";
import { WEAPONS, damp, type WeaponId } from "@paradox/shared";
import { WEAPON_HANDS, buildWeaponModel, createWeaponMaterials, type WeaponMaterials, type WeaponModel } from "./weaponModels";

/** Damped spring for procedural animation. */
class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}
  update(target: number, dt: number): number {
    const a = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  impulse(v: number): void {
    this.velocity += v;
  }
  reset(): void {
    this.value = this.velocity = 0;
  }
}

export interface ViewmodelFrame {
  dt: number;
  /** Look delta this frame (radians). */
  lookYaw: number;
  lookPitch: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  sliding: boolean;
  ads: number;
  /** 0..1 progress, or -1 when not reloading. */
  reload: number;
  reloadEmpty: boolean;
  /** 0..1 equip progress (1 = ready). */
  equip: number;
  hidden: boolean;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const window01 = (t: number, a: number, b: number): number => Math.min(1, Math.max(0, (t - a) / (b - a)));

/**
 * First-person weapon, rendered in its own scene with its own camera/FOV after a
 * depth clear, so it never clips into world geometry.
 */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private readonly mats: WeaponMaterials = createWeaponMaterials();
  private readonly models = new Map<WeaponId, WeaponModel>();
  private readonly pivot = new THREE.Group();
  private current: WeaponModel | null = null;
  private currentId: WeaponId | null = null;
  private readonly flash: THREE.Group;
  private flashTime = 0;

  private readonly swayX = new Spring(120, 16);
  private readonly swayY = new Spring(120, 16);
  private readonly kickZ = new Spring(260, 22);
  private readonly kickPitch = new Spring(220, 20);
  private readonly kickYaw = new Spring(200, 20);
  private readonly land = new Spring(160, 14);
  private readonly actionZ = new Spring(500, 30);
  private sprintBlend = 0;
  private slideBlend = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private time = 0;

  constructor(flashTexture: THREE.Texture, envMap: THREE.Texture | null) {
    this.scene.add(this.pivot);
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight(0xdce8ff, 0x3a3430, 1.4));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(0.6, 1, 0.4);
    this.scene.add(key);

    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
    // Two planes along the barrel axis (YZ and XZ) give the flash volume from the side.
    const side1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.09), flashMat);
    side1.rotation.y = Math.PI / 2;
    side1.position.z = -0.1;
    const side2 = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.22), flashMat);
    side2.rotation.x = Math.PI / 2;
    side2.position.z = -0.1;
    this.flash.add(front, side1, side2);
    this.flash.visible = false;
  }

  setWeapon(id: WeaponId): void {
    if (id === this.currentId) return;
    if (this.current) this.pivot.remove(this.current.root);
    let model = this.models.get(id);
    if (!model) {
      model = buildWeaponModel(id, this.mats);
      this.addArms(model, id);
      model.root.traverse((o) => {
        o.frustumCulled = false;
      });
      this.models.set(id, model);
    }
    this.current = model;
    this.currentId = id;
    this.pivot.add(model.root);
    model.muzzle.add(this.flash);
  }

  private armMats: { sleeve: THREE.MeshStandardMaterial; glove: THREE.MeshStandardMaterial } | null = null;

  /** First-person arms: glove on each hand anchor, sleeved forearm reaching back toward the camera. */
  private addArms(model: WeaponModel, id: WeaponId): void {
    this.armMats ??= {
      sleeve: new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.8 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.1 }),
    };
    const hands = WEAPON_HANDS[id];
    const arm = (hand: THREE.Vector3, elbow: THREE.Vector3) => {
      const g = new THREE.Group();
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.1), this.armMats!.glove);
      glove.position.copy(hand);
      g.add(glove);
      const dir = new THREE.Vector3().subVectors(elbow, hand);
      const len = dir.length();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, len, 10), this.armMats!.sleeve);
      sleeve.position.copy(hand).addScaledVector(dir, 0.5);
      sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(sleeve);
      model.root.add(g);
    };
    // Forearms run down and back out of frame (not straight at the lens).
    arm(hands.grip, new THREE.Vector3(hands.grip.x + 0.16, hands.grip.y - 0.3, hands.grip.z + 0.2));
    arm(hands.support, new THREE.Vector3(hands.support.x - 0.2, hands.support.y - 0.3, hands.support.z + 0.22));
  }

  /** Called once per shot. */
  fire(adsAmount: number): void {
    if (!this.currentId) return;
    const k = WEAPONS[this.currentId].recoil.visualKick * (1 - adsAmount * 0.55);
    this.kickZ.impulse(0.9 * k);
    this.kickPitch.impulse(2.6 * k);
    this.kickYaw.impulse((Math.random() - 0.5) * 1.2 * k);
    this.actionZ.impulse(4);
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.75 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s * (1 + Math.random() * 0.4));
    this.flash.visible = true;
  }

  landed(impact: number): void {
    this.land.impulse(-Math.min(1.8, impact * 0.18));
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(f: ViewmodelFrame): void {
    const m = this.current;
    if (!m) return;
    const dt = Math.min(f.dt, 0.05);
    this.time += dt;
    this.pivot.visible = !f.hidden;

    const ads = smooth(f.ads);
    const sprint = f.sprinting && f.reload < 0 ? 1 : 0;
    this.sprintBlend += (sprint - this.sprintBlend) * damp(10, dt);
    this.slideBlend += ((f.sliding ? 1 : 0) - this.slideBlend) * damp(10, dt);

    // Bob: phase advances with distance travelled.
    const moving = f.grounded ? Math.min(1, f.speed / 6.2) : 0;
    this.bobAmount += (moving * (1 - this.slideBlend) - this.bobAmount) * damp(8, dt);
    this.bobPhase += dt * (6 + f.speed * 0.9) * (f.sprinting ? 1.15 : 1);
    const bobK = this.bobAmount * (1 - ads * 0.88) * (1 + this.sprintBlend * 0.8);
    const bobX = Math.sin(this.bobPhase) * 0.009 * bobK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.011 * bobK;
    const breathe = Math.sin(this.time * 1.6) * 0.0012 * (1 - ads * 0.8);

    // Sway lags behind look motion.
    const swayScale = 1 - ads * 0.75;
    const sx = this.swayX.update(Math.max(-0.06, Math.min(0.06, f.lookYaw * 1.6)) * swayScale, dt);
    const sy = this.swayY.update(Math.max(-0.05, Math.min(0.05, f.lookPitch * 1.6)) * swayScale, dt);

    const kz = this.kickZ.update(0, dt);
    const kp = this.kickPitch.update(0, dt);
    const ky = this.kickYaw.update(0, dt);
    const ld = this.land.update(0, dt);
    const az = this.actionZ.update(0, dt);

    // Reload choreography: tilt, drop mag, insert, settle.
    let rTilt = 0;
    let rDrop = 0;
    let magY = 0;
    if (f.reload >= 0) {
      const p = f.reload;
      const inOut = smooth(window01(p, 0, 0.15)) * (1 - smooth(window01(p, 0.82, 1)));
      rTilt = inOut;
      rDrop = inOut;
      magY = -0.28 * smooth(window01(p, 0.12, 0.32)) * (1 - smooth(window01(p, 0.45, 0.7)));
      if (f.reloadEmpty && p > 0.78 && p < 0.9) this.actionZ.impulse(0.5);
    }
    const eq = 1 - smooth(f.equip);

    const hip = m.hip;
    const adsPos = m.ads;
    const px = hip.x + (adsPos.x - hip.x) * ads;
    const py = hip.y + (adsPos.y - hip.y) * ads;
    const pz = hip.z + (adsPos.z - hip.z) * ads;

    this.pivot.position.set(
      px + bobX + sx * 0.25 - this.sprintBlend * 0.03 + this.slideBlend * -0.02,
      py + bobY + breathe - sy * 0.25 - this.sprintBlend * 0.035 - rDrop * 0.04 - eq * 0.22 + ld * 0.03 - this.slideBlend * 0.02,
      pz + kz * 0.04 + this.sprintBlend * 0.02,
    );
    this.pivot.rotation.set(
      sy + kp * 0.05 - this.sprintBlend * 0.28 + rTilt * 0.25 - eq * 0.7 + ld * 0.04,
      sx + ky * 0.03 + this.sprintBlend * 0.55,
      bobX * 2 + this.sprintBlend * 0.28 + rTilt * 0.55 + this.slideBlend * 0.22,
    );
    m.mag.position.y = (m.mag.userData.baseY ??= m.mag.position.y) + magY;
    m.mag.visible = magY > -0.27;
    if (m.action) m.action.position.z = (m.action.userData.baseZ ??= m.action.position.z) + Math.max(0, az) * 0.012;

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
  }

  /** Muzzle position in view space (camera-relative), for tracer origins in the world. */
  muzzleViewPosition(out: THREE.Vector3): THREE.Vector3 {
    if (!this.current) return out.set(0.15, -0.12, -0.6);
    this.pivot.updateMatrixWorld(true);
    return this.current.muzzle.getWorldPosition(out);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) mat.dispose();
      }
    });
    for (const model of this.models.values()) {
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    for (const mat of Object.values(this.mats)) mat.dispose();
    this.armMats?.sleeve.dispose();
    this.armMats?.glove.dispose();
  }
}
