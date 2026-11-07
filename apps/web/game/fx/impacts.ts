import * as THREE from "three";
import type { SurfaceMaterial } from "@paradox/shared";
import type { ParticlePool, ParticleSpawn } from "./particles";

const spawn: ParticleSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 0, r: 0, g: 0, b: 0, gravity: 0, drag: 0, grow: 1 };
const c = new THREE.Color();

interface SurfaceFx {
  dust: number;
  dustColor: number;
  sparks: number;
  chips: number;
  chipColor: number;
}

const SURFACES: Record<SurfaceMaterial, SurfaceFx> = {
  concrete: { dust: 5, dustColor: 0x9a968f, sparks: 2, chips: 4, chipColor: 0x7c7973 },
  metal: { dust: 1, dustColor: 0x6a6a6a, sparks: 10, chips: 0, chipColor: 0 },
  wood: { dust: 3, dustColor: 0x8a6a45, sparks: 0, chips: 6, chipColor: 0x6b4a2a },
  dirt: { dust: 7, dustColor: 0x6e5a42, sparks: 0, chips: 3, chipColor: 0x4e3e2c },
  glass: { dust: 1, dustColor: 0xcfe6ff, sparks: 3, chips: 7, chipColor: 0xdff0ff },
};

/** Surface-dependent impact burst: dust puff, sparks and debris chips along the normal. */
export function spawnImpact(additive: ParticlePool, alpha: ParticlePool, x: number, y: number, z: number, nx: number, ny: number, nz: number, mat: SurfaceMaterial, scale = 1): void {
  const fx = SURFACES[mat];
  c.setHex(fx.dustColor).convertSRGBToLinear();
  for (let i = 0; i < fx.dust * scale; i++) {
    set(x, y, z, nx, ny, nz, 0.6 + Math.random() * 1.2, 0.5);
    spawn.life = 0.45 + Math.random() * 0.5;
    spawn.size = 0.035 + Math.random() * 0.03;
    spawn.grow = 2.6;
    spawn.gravity = -0.3;
    spawn.drag = 3.5;
    spawn.r = c.r;
    spawn.g = c.g;
    spawn.b = c.b;
    alpha.spawn(spawn);
  }
  c.setHex(fx.chipColor).convertSRGBToLinear();
  for (let i = 0; i < fx.chips * scale; i++) {
    set(x, y, z, nx, ny, nz, 2 + Math.random() * 3, 0.9);
    spawn.life = 0.4 + Math.random() * 0.4;
    spawn.size = 0.012 + Math.random() * 0.01;
    spawn.grow = 1;
    spawn.gravity = 9.8;
    spawn.drag = 0.5;
    spawn.r = c.r;
    spawn.g = c.g;
    spawn.b = c.b;
    alpha.spawn(spawn);
  }
  for (let i = 0; i < fx.sparks * scale; i++) {
    set(x, y, z, nx, ny, nz, 3 + Math.random() * 6, 1.1);
    spawn.life = 0.12 + Math.random() * 0.25;
    spawn.size = 0.012 + Math.random() * 0.01;
    spawn.grow = 0.3;
    spawn.gravity = 9.8;
    spawn.drag = 1;
    spawn.r = 4;
    spawn.g = 2.4;
    spawn.b = 0.8;
    additive.spawn(spawn);
  }
}

/**
 * Hit on a character. Reduced Violence (and the default teen presentation) uses
 * cyan "time shards" instead of blood.
 */
export function spawnBodyHit(additive: ParticlePool, alpha: ParticlePool, x: number, y: number, z: number, dx: number, dy: number, dz: number, head: boolean, reducedViolence: boolean): void {
  const n = head ? 14 : 8;
  for (let i = 0; i < n; i++) {
    set(x, y, z, -dx, -dy, -dz, 1.5 + Math.random() * 3, 1.3);
    spawn.life = 0.25 + Math.random() * 0.3;
    spawn.size = 0.02 + Math.random() * 0.02;
    spawn.grow = 0.4;
    spawn.gravity = reducedViolence ? 0 : 6;
    spawn.drag = 2;
    if (reducedViolence) {
      spawn.r = 0.4;
      spawn.g = 2.6;
      spawn.b = 3.2;
      additive.spawn(spawn);
    } else {
      spawn.r = 0.35;
      spawn.g = 0.02;
      spawn.b = 0.02;
      spawn.size *= 1.6;
      spawn.grow = 2;
      alpha.spawn(spawn);
    }
  }
}

/** Defeated character dissolving into time particles. */
export function spawnDissolve(additive: ParticlePool, x: number, y: number, z: number): void {
  for (let i = 0; i < 70; i++) {
    const h = Math.random() * 1.8;
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 * Math.random();
    spawn.x = x + Math.cos(a) * r;
    spawn.y = y + h;
    spawn.z = z + Math.sin(a) * r;
    spawn.vx = Math.cos(a) * 0.6;
    spawn.vy = 0.6 + Math.random() * 1.6;
    spawn.vz = Math.sin(a) * 0.6;
    spawn.life = 0.7 + Math.random() * 0.8;
    spawn.size = 0.025 + Math.random() * 0.03;
    spawn.grow = 0.2;
    spawn.gravity = -0.5;
    spawn.drag = 1.2;
    spawn.r = 0.5;
    spawn.g = 2.2;
    spawn.b = 3;
    additive.spawn(spawn);
  }
}

function set(x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number, spread: number): void {
  spawn.x = x + nx * 0.02;
  spawn.y = y + ny * 0.02;
  spawn.z = z + nz * 0.02;
  spawn.vx = (nx + (Math.random() - 0.5) * spread) * speed;
  spawn.vy = (ny + (Math.random() - 0.5) * spread) * speed;
  spawn.vz = (nz + (Math.random() - 0.5) * spread) * speed;
}
