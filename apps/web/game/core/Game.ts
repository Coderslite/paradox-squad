import * as THREE from "three";
import {
  Btn,
  CollisionWorld,
  DEFAULT_ENV,
  FOUNDRY,
  MAX_PELLETS,
  MOVE,
  PLAYER,
  RAD2DEG,
  TICK_DT,
  WEAPONS,
  activeDef,
  clamp,
  computeShotRays,
  createInputCmd,
  createRayHit,
  eyeHeight,
  currentSpread,
  damageAt,
  damp,
  horizontalSpeed,
  initPhysics,
  resetWeaponState,
  shotOrigin,
  type InputCmd,
  type MapDef,
  type MoveEnv,
  type SurfaceMaterial,
} from "@paradox/shared";
import { getSettings, useSettings } from "@/stores/settings";
import { patchUi, useUi } from "@/stores/ui";
import { AudioEngine } from "../audio/audioEngine";
import { DecalPool } from "../fx/decals";
import { spawnBodyHit, spawnDissolve, spawnImpact } from "../fx/impacts";
import { ParticlePool } from "../fx/particles";
import { TracerPool } from "../fx/tracers";
import type { NetSession, RemoteRayHit } from "../net/types";
import { InputManager } from "../player/input";
import { LocalPlayer } from "../player/localPlayer";
import { PracticeDummies, type DummyHit } from "../practice/dummies";
import { buildArena } from "../render/arena";
import { createEnvironment, type EnvironmentRig } from "../render/environment";
import { DynamicResolution, QUALITY, type QualityConfig } from "../render/quality";
import { createBulletHoleTexture, createFlashTexture, createGridTexture } from "../render/textures";
import { Viewmodel } from "../render/viewmodel";
import { CharacterView } from "../character/CharacterView";
import { loadHumanoidLibrary } from "../character/humanoid/assets";
import { ALLY_RIM, ENEMY_RIM, teamColor } from "../character/teams";
import { disposeSharedCharacterGeometry } from "../character/rig";
import { disposeWorldWeapons } from "../character/worldWeapon";
import { CameraRig, TP_ADS_ZOOM } from "../player/cameraRig";
import { RecoilController } from "../weapons/recoil";
import { gameBus } from "./events";
import { hudDom } from "./hudDom";

const MAX_FRAME_DT = 0.25;
const STEP_DISTANCE = 2.2;
const FOV_ASPECT_REF = 16 / 9;

export interface GameInit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  net: NetSession | null;
  /** Sets the renderer pixel ratio through the host (R3F) so its resize logic stays in sync. */
  setPixelRatio: (dpr: number) => void;
}

/**
 * The game client. Owns the fixed-step simulation loop, local prediction, effects,
 * audio and both render passes. Lives entirely outside React: React mounts it once and
 * calls {@link frame} from a single useFrame; the HUD reads stores updated on change.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly input: InputManager;
  readonly audio = new AudioEngine();
  readonly player = new LocalPlayer();

  private readonly net: NetSession | null;
  private readonly setPixelRatio: (dpr: number) => void;
  private map: MapDef = FOUNDRY;
  private world!: CollisionWorld;
  private env: MoveEnv = DEFAULT_ENV;
  private quality: QualityConfig;
  private envRig!: EnvironmentRig;
  private viewmodel!: Viewmodel;
  private additive!: ParticlePool;
  private alphaFx!: ParticlePool;
  private decals!: DecalPool;
  private tracers!: TracerPool;
  private muzzleLight!: THREE.PointLight;
  private flashMaterial!: THREE.MeshBasicMaterial;
  private localChar!: CharacterView;
  private readonly cameraRig = new CameraRig();
  /** World point under the crosshair (third person convergence target). */
  private readonly aimPoint = new THREE.Vector3();
  private aimedId: string | null = null;
  private combatT = 0;
  private readonly tagPool: HTMLDivElement[] = [];
  private readonly tagLayout: { el: HTMLDivElement; x: number; y: number; w: number; dist: number }[] = [];
  private dummies: PracticeDummies | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly dynRes = new DynamicResolution();

  // Aim (render-rate) and per-tick input.
  private yaw = 0;
  private pitch = 0;
  private seq = 0;
  private accumulator = 0;
  private readonly cmd: InputCmd = createInputCmd();
  private readonly look = { yaw: 0, pitch: 0 };
  private readonly kick = { yaw: 0, pitch: 0 };
  private readonly axes = { x: 0, y: 0 };
  private readonly viewTick = { tick: 0, alpha: 0 };
  private readonly recoil = new RecoilController();
  private frameLookYaw = 0;
  private frameLookPitch = 0;

  // Camera feel.
  private readonly renderPos = { x: 0, y: 0, z: 0, eye: 0 };
  private smoothEyeY = 0;
  private landDip = 0;
  private landVel = 0;
  private shake = 0;
  private fovKick = 0;
  private stepDistance = 0;
  private lastSprint = false;
  private lastReloadProgress = -1;
  private hitmarkerT = 0;
  private hitmarkerKill = false;
  private damageFlash = 0;
  private killPunch = 0;
  private deadTimer = 0;

  // Debug overlay.
  private debugVisible = false;
  private debugTimer = 0;
  private frameCount = 0;
  private frameTimeAcc = 0;
  private lastFrameStart = 0;

  // Scratch.
  private readonly rays = new Float64Array(MAX_PELLETS * 6);
  private readonly worldHit = createRayHit();
  private readonly groundHit = createRayHit();
  private readonly aimHit = createRayHit();
  private readonly blockHit = createRayHit();
  private readonly aimDir = new THREE.Vector3();
  private readonly dummyHit: DummyHit = { index: 0, distance: 0, head: false };
  private readonly remoteHit: RemoteRayHit = { id: "", distance: 0, head: false };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly shotFrom = { x: 0, y: 0, z: 0 };
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly listenerPos = { x: 0, y: 0, z: 0 };
  private readonly remoteEnds: number[] = [];
  private readonly remoteKinds: number[] = [];
  private disposed = false;
  private unsubSettings: (() => void) | null = null;

  constructor(init: GameInit) {
    this.renderer = init.renderer;
    this.scene = init.scene;
    this.camera = init.camera;
    this.net = init.net;
    this.setPixelRatio = init.setPixelRatio;
    this.input = new InputManager(init.canvas);
    this.quality = QUALITY[getSettings().quality];
  }

  async init(): Promise<void> {
    patchUi({ loading: true, loadingText: "Loading physics" });
    // Character models and animations load alongside physics; without them the game
    // falls back to the procedural characters.
    const characters = loadHumanoidLibrary();
    await initPhysics();
    if (this.disposed) return;
    patchUi({ loadingText: "Loading characters" });
    await characters;
    if (this.disposed) return;
    if (this.net) this.map = this.net.map;
    this.world = new CollisionWorld(this.map);

    patchUi({ loadingText: "Building arena" });
    const r = this.renderer;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.quality.shadowMapSize > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Two render passes per frame: reset stats manually so F3 shows the whole frame.
    r.info.autoReset = false;
    r.autoClear = false;

    this.camera.near = 0.05;
    this.camera.far = 600;
    this.camera.rotation.order = "YXZ";

    const grid = createGridTexture(r.capabilities.getMaxAnisotropy());
    const hole = createBulletHoleTexture();
    const flash = createFlashTexture();
    this.disposables.push(grid, hole, flash);

    const arena = buildArena(this.map, grid);
    this.scene.add(arena);
    this.envRig = createEnvironment(r, this.scene, this.map.halfExtent, this.quality.shadowMapSize);
    this.disposables.push(this.envRig);

    this.viewmodel = new Viewmodel(flash, this.envRig.envMap);
    this.disposables.push(this.viewmodel);

    const pScale = this.quality.particleScale;
    this.additive = new ParticlePool(Math.round(1536 * pScale), true);
    this.alphaFx = new ParticlePool(Math.round(1536 * pScale), false);
    this.decals = new DecalPool(this.quality.maxDecals, hole);
    this.tracers = new TracerPool(48);
    this.scene.add(this.additive.points, this.alphaFx.points, this.decals.mesh, this.tracers.mesh);
    this.disposables.push(this.additive, this.alphaFx, this.decals, this.tracers);

    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.scene.add(this.muzzleLight);

    this.flashMaterial = new THREE.MeshBasicMaterial({ map: flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.disposables.push(this.flashMaterial, { dispose: disposeWorldWeapons }, { dispose: disposeSharedCharacterGeometry });
    this.localChar = this.createCharacter();
    this.localChar.setTeam(teamColor(0));
    this.scene.add(this.localChar.group);
    this.cameraRig.mode = getSettings().cameraMode;
    if (!this.net) {
      this.dummies = new PracticeDummies(() => {
        const v = this.createCharacter();
        v.setTeam(teamColor(1));
        v.setRim(ENEMY_RIM, 0.9);
        return v;
      });
      this.scene.add(this.dummies.group);
      this.disposables.push(this.dummies);
      const spawn = this.map.spawns.find((s) => s.team === 0) ?? this.map.spawns[0];
      if (spawn) this.respawnAt(spawn.p[0], spawn.p[1], spawn.p[2], spawn.yaw);
    } else {
      this.net.attach({
        local: this.player,
        world: this.world,
        env: this.env,
        scene: this.scene,
        audio: this.audio,
        camera: this.camera,
        createCharacter: () => this.createCharacter(),
        remoteShot: (ox, oy, oz, ends, kinds, weapon) => this.handleRemoteShot(ox, oy, oz, ends, kinds, weapon),
        onLocalSpawn: (x, y, z, yaw) => this.respawnAt(x, y, z, yaw),
        onLocalDeath: () => this.handleLocalDeath(),
        onHitConfirmed: (dmg, head, kill) => this.confirmHit(dmg, head, kill),
        onDamaged: (fx, fz, dmg) => this.handleDamaged(fx, fz, dmg),
      });
    }

    this.input.attach();
    this.input.onLockChange = (locked) => {
      patchUi({ pointerLocked: locked, paused: !locked });
      if (locked) this.audio.unlock();
    };
    this.input.onKeyPress = (code) => {
      const b = getSettings().bindings;
      if (b.view.includes(code)) {
        this.cameraRig.toggleMode();
        useSettings.getState().set({ cameraMode: this.cameraRig.mode });
      } else if (b.shoulder.includes(code)) this.cameraRig.swapShoulder();
      if (code === "F3") {
        this.debugVisible = !this.debugVisible;
        if (hudDom.debug) hudDom.debug.style.display = this.debugVisible ? "block" : "none";
      }
    };
    this.unsubSettings = useSettings.subscribe((s, prev) => {
      if (s.cameraMode !== prev.cameraMode) this.cameraRig.mode = s.cameraMode;
      if (s.masterVolume !== prev.masterVolume || s.sfxVolume !== prev.sfxVolume) this.audio.setVolumes(s.masterVolume, s.sfxVolume);
    });
    const s = getSettings();
    this.audio.setVolumes(s.masterVolume, s.sfxVolume);

    this.applyPixelRatio();
    this.viewmodel.setWeapon(activeDef(this.player.sim.weapon).id);
    // Compile all shaders up front to avoid hitches on the first shot.
    r.compile(this.scene, this.camera);
    r.compile(this.viewmodel.scene, this.viewmodel.camera);
    patchUi({ loading: false, mode: this.net ? "online" : "practice" });
  }

  /** A character with shared materials; dissolving deaths emit time particles. */
  private createCharacter(): CharacterView {
    const v = new CharacterView(this.flashMaterial);
    v.onDissolve = (x, y, z) => spawnDissolve(this.additive, x, y, z);
    return v;
  }

  /** User gesture entry point (click to play / resume). */
  requestPlay(): void {
    this.audio.unlock();
    void this.input.requestLock();
  }

  releasePointer(): void {
    this.input.releaseLock();
  }

  resize(width: number, height: number): void {
    this.viewmodel?.resize(width / Math.max(1, height));
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  frame(rawDt: number): void {
    if (this.disposed || !this.world) return;
    const now = performance.now();
    const frameMs = this.lastFrameStart ? now - this.lastFrameStart : 16.7;
    this.lastFrameStart = now;
    const dt = Math.min(rawDt, MAX_FRAME_DT);

    this.input.pollGamepad();
    this.input.activeSlot = this.player.sim.weapon.active;

    // --- Look at render rate for minimum latency ---
    const w = this.player.sim.weapon;
    const def = activeDef(w);
    this.input.consumeLook(dt, w.ads, def.adsZoom, this.look);
    this.recoil.onLook(this.look.pitch);
    this.recoil.update(dt, this.kick);
    this.frameLookYaw = this.look.yaw;
    this.frameLookPitch = this.look.pitch;
    this.yaw += this.look.yaw + this.kick.yaw;
    this.pitch = clamp(this.pitch + this.look.pitch + this.kick.pitch, -1.53, 1.53);

    // --- Networking in (snapshots, reconciliation) ---
    this.net?.update(dt);

    // --- Fixed-step simulation ---
    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks < 8) {
      this.tick();
      this.accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === 8) this.accumulator = 0; // spiral-of-death guard after a stall
    const alpha = this.accumulator / TICK_DT;

    this.updateCamera(dt, alpha);
    this.updateAim();
    this.updateCharacters(dt);
    this.updateViewmodel(dt);
    this.updateFx(dt);
    this.updateHudFrame(dt);
    this.render();

    if (this.dynRes.sample(frameMs, dt, getSettings().dynamicResolution)) this.applyPixelRatio();
    this.updateDebug(dt, frameMs);
  }

  private tick(): void {
    const c = this.cmd;
    this.input.moveAxes(this.axes);
    c.seq = this.seq++;
    c.buttons = this.input.buttons();
    c.moveX = this.axes.x;
    c.moveY = this.axes.y;
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    if (this.net) {
      this.net.viewTick(this.viewTick);
      c.viewTick = this.viewTick.tick;
      c.viewAlpha = this.viewTick.alpha;
    }
    if (!this.player.alive) c.buttons = 0;
    if (this.cameraRig.thirdPerson) {
      c.buttons |= Btn.ThirdPerson;
      if (this.cameraRig.shoulder < 0) c.buttons |= Btn.ShoulderLeft;
    }

    const p = this.player;
    const wasActive = p.sim.weapon.active;
    p.tick(c, this.world, this.env);
    // Shot direction: from the (post-move) weapon origin toward the crosshair target, exactly
    // as the server will compute it from this input.
    if (this.cameraRig.thirdPerson) {
      const o = shotOrigin(p.sim.move, c.yaw, c.buttons, this.shotFrom);
      const dx = this.aimPoint.x - o.x;
      const dy = this.aimPoint.y - o.y;
      const dz = this.aimPoint.z - o.z;
      c.aimYaw = Math.atan2(-dx, -dz);
      c.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else {
      c.aimYaw = c.yaw;
      c.aimPitch = c.pitch;
    }
    this.net?.sendInput(c);

    const mev = p.events.move;
    const wev = p.events.weapon;
    const m = p.sim.move;

    if (mev.landed > 2) {
      this.landVel -= Math.min(4, mev.landed * 0.35);
      this.viewmodel.landed(mev.landed);
      this.audio.land(mev.landed);
    }
    if (mev.jumped) this.audio.footstep(this.surfaceBelow(), null, 0.8);
    if (mev.slideStarted) {
      this.audio.slide();
      this.fovKick += 0.06;
    }

    if (wev.switched || wasActive !== p.sim.weapon.active) {
      this.viewmodel.setWeapon(activeDef(p.sim.weapon).id);
      this.recoil.reset();
    }
    if (wev.dryFire) this.audio.dryFire();
    if (wev.shots > 0) this.fireShots(c);

    // Practice: falling out of the world respawns you.
    if (!this.net && m.y < this.map.killY) {
      const sp = this.map.spawns[0]!;
      this.respawnAt(sp.p[0], sp.p[1], sp.p[2], sp.yaw);
    }

    this.updateHudTick();
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------

  private fireShots(cmd: InputCmd): void {
    const p = this.player;
    const w = p.sim.weapon;
    const def = activeDef(w);
    const n = computeShotRays(p.sim, cmd, p.seed, p.events.weapon, this.rays);

    if (this.cameraRig.thirdPerson) this.localChar.fire();
    else this.viewmodel.fire(w.ads);
    this.combatT = 1.2;
    this.recoil.onShot(def, w.sprayIndex, w.ads);
    this.audio.gunshot(def.sound, null);
    this.shake = Math.min(1, this.shake + 0.12 * def.recoil.visualKick);
    this.muzzleLight.intensity = 6;

    // Tracer origin: viewmodel muzzle mapped into world space.
    const muzzle = this.muzzleWorld(this.v1);
    let hitAny = false;
    let headAny = false;
    let killAny = false;
    let totalDamage = 0;

    for (let i = 0; i < n; i++) {
      const o = i * 6;
      const ox = this.rays[o]!;
      const oy = this.rays[o + 1]!;
      const oz = this.rays[o + 2]!;
      const dx = this.rays[o + 3]!;
      const dy = this.rays[o + 4]!;
      const dz = this.rays[o + 5]!;
      const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, def.range, this.worldHit);
      const maxD = wh ? wh.distance : def.range;

      let charDist = Infinity;
      let head = false;
      if (this.dummies) {
        const dh = this.dummies.raycast(ox, oy, oz, dx, dy, dz, maxD, this.dummyHit);
        if (dh) {
          charDist = dh.distance;
          head = dh.head;
          const dmg = damageAt(def, dh.distance, dh.head);
          totalDamage += dmg;
          const killed = this.dummies.damage(dh.index, dmg, Math.random() < 0.5);
          hitAny = true;
          headAny ||= dh.head;
          if (killed) {
            killAny = true;
            gameBus.emit("killfeed", { killer: "You", victim: this.dummies.name(dh.index), weapon: def.name, head: dh.head, local: "killer" });
          }
          if (getSettings().damageNumbers) this.emitDamageNumber(ox + dx * dh.distance, oy + dy * dh.distance, oz + dz * dh.distance, dmg, dh.head);
        }
      } else if (this.net) {
        // Online: predict the visual only; damage and hit markers come from the server.
        const rh = this.net.raycastRemotes(ox, oy, oz, dx, dy, dz, maxD, this.remoteHit);
        if (rh) {
          charDist = rh.distance;
          head = rh.head;
        }
      }

      if (charDist < Infinity) {
        spawnBodyHit(this.additive, this.alphaFx, ox + dx * charDist, oy + dy * charDist, oz + dz * charDist, dx, dy, dz, head, getSettings().reducedViolence);
        this.tracers.fire(muzzle.x, muzzle.y, muzzle.z, ox + dx * charDist, oy + dy * charDist, oz + dz * charDist);
      } else if (wh) {
        this.impact(wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz, wh.material, def.pellets > 1 ? 0.06 : 0.1, def.pellets > 1 ? 0.4 : 1);
        this.tracers.fire(muzzle.x, muzzle.y, muzzle.z, wh.x, wh.y, wh.z);
      } else {
        this.tracers.fire(muzzle.x, muzzle.y, muzzle.z, ox + dx * def.range, oy + dy * def.range, oz + dz * def.range);
      }
    }

    if (hitAny) this.confirmHit(totalDamage, headAny, killAny);
  }

  private emitDamageNumber(x: number, y: number, z: number, damage: number, head: boolean): void {
    const v = this.v2.set(x, y, z).project(this.camera);
    if (v.z > 1) return;
    gameBus.emit("damageNumber", { sx: (v.x + 1) / 2, sy: (1 - v.y) / 2, damage, head });
  }

  private impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, mat: SurfaceMaterial, decalSize: number, fxScale: number): void {
    this.decals.add(x, y, z, nx, ny, nz, decalSize * (0.85 + Math.random() * 0.3));
    spawnImpact(this.additive, this.alphaFx, x, y, z, nx, ny, nz, mat, fxScale * this.quality.particleScale);
  }

  private confirmHit(damage: number, head: boolean, kill: boolean): void {
    this.hitmarkerT = kill ? 0.35 : 0.2;
    this.hitmarkerKill = kill;
    this.audio.hitmarker(head, kill);
    if (kill) this.killPunch = 1;
    gameBus.emit("hitmarker", { head, kill, damage });
  }

  private handleRemoteShot(ox: number, oy: number, oz: number, ends: number[], kinds: number[], weapon: string): void {
    this.audio.gunshot(WEAPONS[weapon as keyof typeof WEAPONS]?.sound ?? "rifle", { x: ox, y: oy, z: oz });
    for (let i = 0; i < kinds.length; i++) {
      const ex = ends[i * 3]!;
      const ey = ends[i * 3 + 1]!;
      const ez = ends[i * 3 + 2]!;
      this.tracers.fire(ox, oy, oz, ex, ey, ez);
      if (kinds[i] === 1) {
        // Re-derive the surface normal locally rather than sending it.
        const dx = ex - ox;
        const dy = ey - oy;
        const dz = ez - oz;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const hit = this.world.raycast(ox, oy, oz, dx / len, dy / len, dz / len, len + 0.1, this.worldHit);
        if (hit) this.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.material, 0.09, 0.6);
      } else if (kinds[i] === 2) {
        spawnBodyHit(this.additive, this.alphaFx, ex, ey, ez, ex - ox, ey - oy, ez - oz, false, getSettings().reducedViolence);
      }
    }
  }

  private handleDamaged(fromX: number, fromZ: number, damage: number): void {
    this.damageFlash = Math.min(1, this.damageFlash + damage / 60);
    this.shake = Math.min(1, this.shake + 0.25);
    const m = this.player.sim.move;
    // World bearing to attacker, then relative to where we are looking (yaw 0 looks down -Z).
    const bearing = Math.atan2(-(fromX - m.x), -(fromZ - m.z));
    let angle = this.yaw - bearing;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    gameBus.emit("damaged", { angle, damage });
  }

  private handleLocalDeath(): void {
    const m = this.player.sim.move;
    this.player.alive = false;
    this.deadTimer = 0;
    // In third person the character plays its death animation and dissolves itself.
    if (!this.cameraRig.thirdPerson) spawnDissolve(this.additive, m.x, m.y, m.z);
    patchUi({ alive: false });
  }

  private respawnAt(x: number, y: number, z: number, yaw: number): void {
    this.player.spawn(x, y, z);
    resetWeaponState(this.player.sim.weapon);
    this.viewmodel?.setWeapon(activeDef(this.player.sim.weapon).id);
    this.yaw = yaw;
    this.pitch = 0;
    this.recoil.reset();
    this.smoothEyeY = y + PLAYER.eyeStand;
    patchUi({ alive: true, health: PLAYER.maxHealth });
  }

  private muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.cameraRig.thirdPerson) return this.localChar.muzzleWorld(out);
    this.viewmodel.muzzleViewPosition(out);
    // View-space (viewmodel camera at origin) → world via the main camera.
    this.camera.updateMatrixWorld();
    return out.applyMatrix4(this.camera.matrixWorld);
  }

  // ---------------------------------------------------------------------------
  // Camera / viewmodel / FX / HUD
  // ---------------------------------------------------------------------------

  private updateCamera(dt: number, alpha: number): void {
    const p = this.player;
    const m = p.sim.move;
    const rp = this.renderPos;
    p.renderPosition(alpha, dt, rp);

    // Smooth only upward eye motion on the ground (stairs, step-ups); falls stay crisp.
    const targetEye = rp.y + rp.eye;
    if (m.grounded && targetEye > this.smoothEyeY && targetEye - this.smoothEyeY < 0.6) {
      this.smoothEyeY += (targetEye - this.smoothEyeY) * damp(18, dt);
    } else {
      this.smoothEyeY = targetEye;
    }

    // Landing dip spring.
    this.landVel += (-this.landDip * 140 - this.landVel * 16) * dt;
    this.landDip += this.landVel * dt * 0.1;

    const settings = getSettings();
    const speed = horizontalSpeed(m);
    let bobY = 0;
    let bobRoll = 0;
    if (settings.cameraBob && m.grounded && m.slideTime <= 0) {
      const amt = Math.min(1, speed / MOVE.runSpeed) * (1 - p.sim.weapon.ads * 0.8);
      bobY = Math.sin(this.stepDistance / STEP_DISTANCE * Math.PI * 2) * 0.012 * amt;
      bobRoll = Math.sin(this.stepDistance / STEP_DISTANCE * Math.PI) * 0.0025 * amt;
    }

    const tp = this.cameraRig.thirdPerson;
    this.shake = Math.max(0, this.shake - dt * 4);
    const sk = this.shake * this.shake * 0.006;
    const slideRoll = m.slideTime > 0 && !tp ? 0.035 : 0;
    this.v1.set(rp.x, this.smoothEyeY + this.landDip + (tp ? 0 : bobY), rp.z);
    this.cameraRig.update(
      this.camera,
      this.world,
      this.v1,
      this.yaw + (Math.random() - 0.5) * sk,
      this.pitch + (Math.random() - 0.5) * sk,
      (tp ? 0 : bobRoll) + slideRoll * 0.5,
      p.sim.weapon.ads,
      dt,
    );
    this.camera.updateMatrixWorld();

    // FOV: settings hFOV → vertical, ADS zoom, sprint/slide widen, kill punch.
    // Hor+ scaling: the setting is horizontal FOV at 16:9, so wider screens see more.
    const hfov = settings.fov * (Math.PI / 180);
    const baseV = 2 * Math.atan(Math.tan(hfov / 2) / FOV_ASPECT_REF) * RAD2DEG;
    const w = p.sim.weapon;
    const ads = w.ads * w.ads * (3 - 2 * w.ads);
    const adsZoom = tp ? Math.min(activeDef(w).adsZoom, TP_ADS_ZOOM) : activeDef(w).adsZoom;
    const zoom = 1 + (adsZoom - 1) * ads;
    const sprinting = (this.cmd.buttons & Btn.Sprint) !== 0 && this.cmd.moveY > 0.5 && speed > MOVE.runSpeed + 0.3;
    this.fovKick = Math.max(0, this.fovKick - dt * 0.15);
    this.killPunch = Math.max(0, this.killPunch - dt * 5);
    const widen = (sprinting ? 0.05 : 0) + (m.slideTime > 0 ? 0.04 : 0);
    this.lastSprint = sprinting;
    const targetFov = baseV * zoom * (1 + widen + this.fovKick) * (1 - this.killPunch * 0.015);
    const fov = this.camera.fov + (targetFov - this.camera.fov) * damp(14, dt);
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Footsteps by distance travelled.
    if (m.grounded && speed > 1.5 && m.slideTime <= 0 && p.alive) {
      const before = this.stepDistance;
      this.stepDistance += speed * dt;
      if (Math.floor(before / STEP_DISTANCE) !== Math.floor(this.stepDistance / STEP_DISTANCE)) {
        this.audio.footstep(this.surfaceBelow(), null, m.crouched ? 0.35 : sprinting ? 1.1 : 0.8);
      }
    }

    this.camera.getWorldDirection(this.v2);
    this.listenerPos.x = this.camera.position.x;
    this.listenerPos.y = this.camera.position.y;
    this.listenerPos.z = this.camera.position.z;
    this.audio.setListener(this.listenerPos, this.v2.x, this.v2.y, this.v2.z);
  }

  private updateViewmodel(dt: number): void {
    const p = this.player;
    const m = p.sim.move;
    const w = p.sim.weapon;
    const def = activeDef(w);
    const reload = w.reloadTimer > 0 ? 1 - w.reloadTimer / w.reloadTotal : -1;
    // Reload foley at fixed points of the animation.
    if (reload >= 0) {
      const prev = this.lastReloadProgress;
      if (prev < 0.15 && reload >= 0.15) this.audio.reload("out");
      if (prev < 0.55 && reload >= 0.55) this.audio.reload("in");
      if (prev < 0.83 && reload >= 0.83 && w.reloadTotal === def.reloadEmptyTime) this.audio.reload("rack");
    }
    this.lastReloadProgress = reload;
    this.viewmodel.update({
      dt,
      lookYaw: this.frameLookYaw,
      lookPitch: this.frameLookPitch,
      speed: horizontalSpeed(m),
      grounded: m.grounded,
      sprinting: this.lastSprint,
      sliding: m.slideTime > 0,
      ads: w.ads,
      reload,
      reloadEmpty: w.reloadTotal === def.reloadEmptyTime,
      equip: def.equipTime > 0 ? 1 - w.equipTimer / def.equipTime : 1,
      hidden: !p.alive || m.mantleT > 0.0001 || this.cameraRig.thirdPerson,
    });
  }

  /**
   * Crosshair ray: the world point under the crosshair and who (if anyone) is under it.
   * The ray starts level with the player so geometry between camera and player is ignored.
   */
  private updateAim(): void {
    const cam = this.camera;
    const f = this.aimDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const m = this.player.sim.move;
    const hx = m.x - cam.position.x;
    const hy = m.y + eyeHeight(m) - cam.position.y;
    const hz = m.z - cam.position.z;
    const along = Math.max(0, hx * f.x + hy * f.y + hz * f.z);
    const sx = cam.position.x + f.x * along;
    const sy = cam.position.y + f.y * along;
    const sz = cam.position.z + f.z * along;
    const range = 300;
    const wh = this.world.raycast(sx, sy, sz, f.x, f.y, f.z, range, this.aimHit);
    let dist = wh ? wh.distance : range;
    this.aimedId = null;
    if (this.dummies) {
      const dh = this.dummies.raycast(sx, sy, sz, f.x, f.y, f.z, dist, this.dummyHit);
      if (dh) {
        dist = dh.distance;
        this.aimedId = `dummy:${dh.index}`;
      }
    } else if (this.net) {
      const rh = this.net.raycastRemotes(sx, sy, sz, f.x, f.y, f.z, dist, this.remoteHit);
      if (rh) {
        dist = rh.distance;
        this.aimedId = rh.id;
      }
    }
    this.aimPoint.set(sx + f.x * dist, sy + f.y * dist, sz + f.z * dist);
  }

  private updateCharacters(dt: number): void {
    const p = this.player;
    const m = p.sim.move;
    const w = p.sim.weapon;
    const tp = this.cameraRig.thirdPerson;
    const localTeam = this.net ? useUi.getState().localTeam : 0;
    this.combatT = Math.max(0, this.combatT - dt);

    // Our own body: third person only, and hidden if the camera is squeezed into it.
    this.localChar.setVisible(tp && this.cameraRig.currentArm > 0.55);
    if (tp) {
      const rp = this.renderPos;
      this.localChar.setTeam(teamColor(localTeam));
      this.localChar.update(
        {
          dt,
          x: rp.x,
          y: rp.y,
          z: rp.z,
          vx: m.vx,
          vy: m.vy,
          vz: m.vz,
          grounded: m.grounded,
          crouch: m.crouchBlend,
          sliding: m.slideTime > 0,
          sprinting: this.lastSprint,
          ads: w.ads,
          lookYaw: this.yaw,
          lookPitch: this.pitch,
          aimTarget: this.aimPoint,
          reload: w.reloadTimer > 0 ? 1 - w.reloadTimer / w.reloadTotal : -1,
          weapon: activeDef(w).id,
          combat: this.combatT > 0 || (this.cmd.buttons & Btn.Fire) !== 0,
          alive: p.alive,
        },
        this.camera,
      );
    }

    this.dummies?.update(dt, this.camera);
    const remotes = this.net?.remotes;
    if (remotes) {
      for (const rp of remotes.players.values()) {
        const ally = rp.info.team === localTeam;
        rp.view.setTeam(teamColor(rp.info.team));
        rp.view.setRim(ally ? ALLY_RIM : ENEMY_RIM, ally ? 1.1 : 0.8);
      }
    }
    this.updateNameTags(localTeam);
    this.updateBlockedMarker();
  }

  /**
   * Teammates always show a name; enemies only while under the crosshair.
   * Tags are anchored above the head, fade with distance, and are pushed apart so two
   * players standing together never print on top of each other.
   */
  private updateNameTags(localTeam: number): void {
    const root = hudDom.tags;
    if (!root) return;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const placed = this.tagLayout;
    placed.length = 0;
    let n = 0;
    const show = (name: string, view: CharacterView, ally: boolean) => {
      const p = view.headTop(this.v3);
      const dist = p.distanceTo(this.camera.position);
      if (ally && dist > 80) return;
      p.project(this.camera);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return;
      let el = this.tagPool[n];
      if (!el) {
        el = document.createElement("div");
        // Inline styles: these nodes are created by the game loop, outside React and the CSS pipeline.
        el.style.cssText =
          "position:absolute;left:0;top:0;display:none;padding:1px 6px;border-radius:3px;white-space:nowrap;color:#fff;" +
          "font:600 12px/1.4 var(--font-geist-mono),monospace;letter-spacing:0.04em;text-shadow:0 1px 2px rgba(0,0,0,0.9);will-change:transform";
        root.appendChild(el);
        this.tagPool.push(el);
      }
      if (el.textContent !== name) {
        el.textContent = name;
        el.dataset.w = "";
      }
      const bg = ally ? "rgba(30,110,220,0.55)" : "rgba(210,40,30,0.6)";
      if (el.style.background !== bg) el.style.background = bg;
      const opacity = ally ? String(Math.max(0.35, Math.min(1, 1 - (dist - 35) / 45)).toFixed(2)) : "1";
      if (el.style.opacity !== opacity) el.style.opacity = opacity;
      el.style.display = "block";
      // Width measured once per name (layout reads are expensive every frame).
      if (!el.dataset.w) el.dataset.w = String(el.offsetWidth || name.length * 8 + 12);
      placed.push({ el, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, w: Number(el.dataset.w), dist });
      n++;
    };
    const remotes = this.net?.remotes;
    if (remotes) {
      for (const rp of remotes.players.values()) {
        if (!rp.alive) continue;
        const ally = rp.info.team === localTeam;
        if (ally || this.aimedId === rp.id) show(rp.info.name, rp.view, ally);
      }
    }
    this.dummies?.forEach((name, view, _pose, i) => {
      if (this.aimedId === `dummy:${i}`) show(name, view, false);
    });

    // Nearest player keeps its spot; farther tags move up until they no longer overlap.
    placed.sort((a, b) => a.dist - b.dist);
    const TAG_H = 19;
    for (let i = 0; i < placed.length; i++) {
      const t = placed[i]!;
      for (let guard = 0; guard < 8; guard++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          const o = placed[j]!;
          if (Math.abs(t.x - o.x) < (t.w + o.w) / 2 + 4 && Math.abs(t.y - o.y) < TAG_H) {
            t.y = o.y - TAG_H;
            moved = true;
          }
        }
        if (!moved) break;
      }
      t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = n; i < this.tagPool.length; i++) {
      const el = this.tagPool[i]!;
      if (el.style.display !== "none") el.style.display = "none";
    }
  }

  /**
   * Third person: if cover between the weapon and the crosshair target would stop the shot,
   * mark where (the shot really hits there; the server uses the same origin).
   */
  private updateBlockedMarker(): void {
    const el = hudDom.blocked;
    if (!el) return;
    let visible = false;
    if (this.cameraRig.thirdPerson && this.player.alive) {
      const o = shotOrigin(this.player.sim.move, this.yaw, this.cmd.buttons | Btn.ThirdPerson, this.shotFrom);
      const dx = this.aimPoint.x - o.x;
      const dy = this.aimPoint.y - o.y;
      const dz = this.aimPoint.z - o.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > 0.6) {
        const hit = this.world.raycast(o.x, o.y, o.z, dx / len, dy / len, dz / len, len - 0.3, this.blockHit);
        if (hit) {
          const p = this.v3.set(hit.x, hit.y, hit.z).project(this.camera);
          if (p.z < 1) {
            const w = this.renderer.domElement.clientWidth;
            const h = this.renderer.domElement.clientHeight;
            el.style.transform = `translate(${(((p.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - p.y) / 2) * h).toFixed(1)}px) translate(-50%, -50%)`;
            visible = true;
          }
        }
      }
    }
    const want = visible ? "1" : "0";
    if (el.style.opacity !== want) el.style.opacity = want;
  }

  private updateFx(dt: number): void {
    this.additive.update(dt);
    this.alphaFx.update(dt);
    this.tracers.update(dt);
    if (this.muzzleLight.intensity > 0) {
      this.muzzleLight.position.copy(this.camera.position);
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 120);
    }
  }

  private updateHudTick(): void {
    const w = this.player.sim.weapon;
    const def = activeDef(w);
    const slot = w.slots[w.active];
    patchUi({ ammo: slot.ammo, reserve: slot.reserve, magSize: def.magSize, weaponName: def.name, reloading: w.reloadTimer > 0 });
  }

  private updateHudFrame(dt: number): void {
    const p = this.player;
    const w = p.sim.weapon;
    // Crosshair gap follows the real spread cone.
    const ch = hudDom.crosshair;
    if (ch) {
      const spread = currentSpread(w, p.sim.move) * (Math.PI / 180);
      const h = this.renderer.domElement.clientHeight;
      const gapPx = (Math.tan(spread) / Math.tan((this.camera.fov * Math.PI) / 360)) * (h / 2);
      ch.style.setProperty("--spread", `${gapPx.toFixed(1)}px`);
      const hide = (w.ads > 0.6 && !this.cameraRig.thirdPerson) || this.lastSprint || !p.alive;
      ch.style.opacity = hide ? "0" : "1";
    }
    const hm = hudDom.hitmarker;
    if (hm) {
      if (this.hitmarkerT > 0) {
        this.hitmarkerT = Math.max(0, this.hitmarkerT - dt);
        hm.style.opacity = String(Math.min(1, this.hitmarkerT * 6));
        hm.dataset.kill = this.hitmarkerKill ? "1" : "0";
      } else if (hm.style.opacity !== "0") hm.style.opacity = "0";
    }
    const vg = hudDom.vignette;
    if (vg) {
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
      vg.style.opacity = this.damageFlash.toFixed(3);
    }
    if (!p.alive && this.net) {
      this.deadTimer += dt;
    }
  }

  private render(): void {
    const r = this.renderer;
    // Hosts (R3F) may reconfigure the renderer on re-render; assert our settings.
    if (r.toneMapping !== THREE.AgXToneMapping) r.toneMapping = THREE.AgXToneMapping;
    r.autoClear = false;
    r.info.reset();
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    if (this.player.alive && !this.cameraRig.thirdPerson) {
      r.clearDepth();
      r.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }

  private applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    const ratio = dpr * this.dynRes.scale;
    this.setPixelRatio(ratio);
    const h = this.renderer.domElement.clientHeight * ratio;
    this.additive?.setViewport(h, this.camera.fov);
    this.alphaFx?.setViewport(h, this.camera.fov);
  }

  private surfaceBelow(): SurfaceMaterial {
    const m = this.player.sim.move;
    const hit = this.world.raycast(m.x, m.y + 0.2, m.z, 0, -1, 0, 0.6, this.groundHit);
    return hit ? hit.material : "concrete";
  }

  private updateDebug(dt: number, frameMs: number): void {
    this.frameCount++;
    this.frameTimeAcc += frameMs;
    this.debugTimer += dt;
    if (this.debugTimer < 0.25) return;
    const el = hudDom.debug;
    if (el && this.debugVisible) {
      const info = this.renderer.info;
      const m = this.player.sim.move;
      const fps = this.frameCount / this.debugTimer;
      const ms = this.frameTimeAcc / this.frameCount;
      const st = this.net?.stats;
      el.textContent =
        `FPS ${fps.toFixed(0)}  frame ${ms.toFixed(2)}ms  res ${(this.dynRes.scale * 100).toFixed(0)}% @${this.renderer.getPixelRatio().toFixed(2)}x\n` +
        `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k  geo ${info.memory.geometries}  tex ${info.memory.textures}\n` +
        (st
          ? `ping ${st.ping.toFixed(0)}ms  jitter ${st.jitter.toFixed(1)}ms  loss ${(st.loss * 100).toFixed(1)}%  in ${st.inKbps.toFixed(1)} KB/s  out ${st.outKbps.toFixed(1)} KB/s\n`
          : "offline (practice)\n") +
        `camera ${this.cameraRig.mode}${this.cameraRig.thirdPerson ? ` arm ${this.cameraRig.currentArm.toFixed(2)}m shoulder ${this.cameraRig.shoulder > 0 ? "R" : "L"}` : ""}\n` +
        `corrections ${this.player.correctionCount}  last ${(this.player.lastCorrection * 100).toFixed(1)}cm\n` +
        `pos ${m.x.toFixed(2)} ${m.y.toFixed(2)} ${m.z.toFixed(2)}  speed ${horizontalSpeed(m).toFixed(2)}  ${m.grounded ? "ground" : "air"}${m.crouched ? " crouch" : ""}${m.slideTime > 0 ? " slide" : ""}${m.mantleT > 0 ? " mantle" : ""}`;
    }
    this.debugTimer = 0;
    this.frameCount = 0;
    this.frameTimeAcc = 0;
  }

  /** Current preset (changes that need a renderer rebuild remount the canvas instead). */
  get qualityConfig(): QualityConfig {
    return this.quality;
  }

  get isDead(): boolean {
    return !this.player.alive;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubSettings?.();
    this.input.detach();
    this.net?.dispose();
    this.audio.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) mat.dispose();
      }
    });
    this.scene.clear();
    this.world?.dispose();
    this.renderer.renderLists.dispose();
    patchUi({ loading: true, pointerLocked: false, paused: true });
  }
}
