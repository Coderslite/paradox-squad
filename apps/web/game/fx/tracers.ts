import * as THREE from "three";

const SPEED = 380;
const STREAK = 4.5;

/** Pooled bullet tracers: short bright streaks travelling from muzzle to impact. */
export class TracerPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly start: Float32Array;
  private readonly dir: Float32Array;
  private readonly length: Float32Array;
  private readonly travelled: Float32Array;
  private next = 0;
  private live = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  private static readonly HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private readonly capacity: number) {
    this.start = new Float32Array(capacity * 3);
    this.dir = new Float32Array(capacity * 3);
    this.length = new Float32Array(capacity);
    this.travelled = new Float32Array(capacity).fill(1e9);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.4, 1.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, TracerPool.HIDDEN);
  }

  fire(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const dz = ez - sz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.start[i * 3] = sx;
    this.start[i * 3 + 1] = sy;
    this.start[i * 3 + 2] = sz;
    this.dir[i * 3] = dx / len;
    this.dir[i * 3 + 1] = dy / len;
    this.dir[i * 3 + 2] = dz / len;
    this.length[i] = len;
    // Start slightly ahead so the streak is visible on the very first frame.
    this.travelled[i] = 0.5;
    this.live = this.capacity;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      const len = this.length[i]!;
      const t = this.travelled[i]!;
      if (t >= len + STREAK) continue;
      const head = Math.min(len, t);
      const tail = Math.max(0, t - STREAK);
      const nt = t + SPEED * dt;
      this.travelled[i] = nt;
      if (head <= tail || nt >= len + STREAK) {
        this.mesh.setMatrixAt(i, TracerPool.HIDDEN);
        continue;
      }
      live++;
      this.d.set(this.dir[i * 3]!, this.dir[i * 3 + 1]!, this.dir[i * 3 + 2]!);
      this.p.set(this.start[i * 3]! + this.d.x * tail, this.start[i * 3 + 1]! + this.d.y * tail, this.start[i * 3 + 2]! + this.d.z * tail);
      this.q.setFromUnitVectors(TracerPool.Z, this.d);
      this.s.set(0.014, 0.014, head - tail);
      this.m4.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
