import * as THREE from "three";

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Linear RGB. */
  r: number;
  g: number;
  b: number;
  gravity: number;
  drag: number;
  /** Size multiplier at end of life (smoke grows, sparks shrink). */
  grow: number;
}

/**
 * Fixed-size pooled particle system on THREE.Points: one draw call, CPU-simulated,
 * no allocations after construction. Use one instance for additive (sparks, embers)
 * and one for alpha-blended (dust, smoke) effects.
 */
export class ParticlePool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly sizeAttr: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly grow: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private next = 0;
  private active = 0;

  constructor(
    private readonly capacity: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.sizeAttr = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1e9);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geometry = g;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.05, -mv.z);
          vAlpha = alpha;
          vColor = color;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = dot(p, p);
          if (d > 1.0 || vAlpha <= 0.0) discard;
          float soft = 1.0 - d;
          gl_FragColor = vec4(vColor, vAlpha * soft);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Point size scale depends on viewport height and FOV. */
  setViewport(heightPx: number, fovDeg: number): void {
    const m = this.points.material as THREE.ShaderMaterial;
    m.uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(p: ParticleSpawn): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx;
    this.vel[i3 + 1] = p.vy;
    this.vel[i3 + 2] = p.vz;
    this.col[i3] = p.r;
    this.col[i3 + 1] = p.g;
    this.col[i3 + 2] = p.b;
    this.life[i] = p.life;
    this.age[i] = 0;
    this.baseSize[i] = p.size;
    this.gravity[i] = p.gravity;
    this.drag[i] = p.drag;
    this.grow[i] = p.grow;
    this.active = this.capacity;
  }

  update(dt: number): void {
    if (this.active === 0) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i]!;
      let age = this.age[i]!;
      if (age >= life) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.sizeAttr[i] = 0;
        }
        continue;
      }
      alive++;
      age += dt;
      this.age[i] = age;
      const i3 = i * 3;
      const drag = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i3]! *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * drag - this.gravity[i]! * dt;
      this.vel[i3 + 2]! *= drag;
      this.pos[i3]! += this.vel[i3]! * dt;
      this.pos[i3 + 1]! += this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2]! += this.vel[i3 + 2]! * dt;
      const t = Math.min(1, age / life);
      this.alpha[i] = (1 - t) * (1 - t);
      this.sizeAttr[i] = this.baseSize[i]! * (1 + (this.grow[i]! - 1) * t);
    }
    this.active = alive;
    const a = this.geometry.attributes;
    a.position!.needsUpdate = true;
    a.color!.needsUpdate = true;
    a.size!.needsUpdate = true;
    a.alpha!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
