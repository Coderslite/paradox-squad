import * as THREE from "three";

const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _end = new THREE.Vector3();
const _u = new THREE.Vector3();
const _l = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qUpper = new THREE.Quaternion();
const _qLower = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();

/** World quaternion whose local -Y points along `dir` and local X along `bendAxis`. */
function limbQuat(dir: THREE.Vector3, bendAxis: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _y.copy(dir).negate();
  _x.copy(bendAxis).addScaledVector(_y, -bendAxis.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Analytic two-bone IK (shoulder → elbow → wrist) for limbs modelled along -Y.
 * Sets `upper` and `lower` local rotations so the end of `lower` reaches `target`,
 * bending toward `pole`. Bones' parents must have up-to-date world matrices.
 */
export function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, lenUpper: number, lenLower: number, target: THREE.Vector3, pole: THREE.Vector3): void {
  upper.getWorldPosition(_a);
  _d.subVectors(target, _a);
  const reach = lenUpper + lenLower - 1e-3;
  const dist = Math.min(Math.max(_d.length(), 1e-3), reach);
  _d.normalize();

  // Bend direction: pole projected onto the plane perpendicular to the reach direction.
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(_d, -_pole.dot(_d));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, -1, 0).addScaledVector(_d, -_d.y);
  _pole.normalize();

  const cosA = (lenUpper * lenUpper + dist * dist - lenLower * lenLower) / (2 * lenUpper * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _elbow.copy(_a).addScaledVector(_d, lenUpper * cosA).addScaledVector(_pole, lenUpper * sinA);
  _end.copy(_a).addScaledVector(_d, dist);

  _u.subVectors(_elbow, _a).normalize();
  _l.subVectors(_end, _elbow).normalize();
  // Elbow hinge axis: perpendicular to the bend plane.
  _axis.crossVectors(_d, _pole).normalize();

  limbQuat(_u, _axis, _qUpper);
  limbQuat(_l, _axis, _qLower);

  upper.parent!.getWorldQuaternion(_qParent);
  upper.quaternion.copy(_qParent.invert().multiply(_qUpper));
  lower.quaternion.copy(_qUpper.invert().multiply(_qLower));
  upper.updateMatrixWorld(true);
}
