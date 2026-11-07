import * as THREE from "three";

/** Ring-buffered bullet holes on one InstancedMesh; oldest is reused once the cap is hit. */
export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly roll = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private static readonly FORWARD = new THREE.Vector3(0, 0, 1);
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(
    private readonly capacity: number,
    texture: THREE.Texture,
  ) {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.9,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number): void {
    this.normal.set(nx, ny, nz);
    this.q.setFromUnitVectors(DecalPool.FORWARD, this.normal);
    this.roll.setFromAxisAngle(DecalPool.Z, Math.random() * Math.PI * 2);
    this.q.multiply(this.roll);
    this.pos.set(x + nx * 0.004, y + ny * 0.004, z + nz * 0.004);
    this.scale.set(size, size, size);
    this.m4.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(this.next, this.m4);
    this.next = (this.next + 1) % this.capacity;
    this.mesh.count = Math.min(this.capacity, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
    this.next = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
