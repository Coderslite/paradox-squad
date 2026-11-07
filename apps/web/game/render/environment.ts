import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface EnvironmentRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  envMap: THREE.Texture;
  dispose(): void;
}

const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

/** Sun + sky dome + fog + PBR environment for the greybox. Replaced per era in milestone 5. */
export function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, halfExtent: number, shadowMapSize: number): EnvironmentRig {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;

  const horizon = new THREE.Color(0xc9d6e3);
  scene.fog = new THREE.Fog(horizon, 60, 220);
  scene.background = horizon;

  const hemi = new THREE.HemisphereLight(0xdce8ff, 0x5a5048, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = shadowMapSize > 0;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const r = halfExtent + 6;
    const cam = sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 10;
    cam.far = 180;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun);
  scene.add(sun.target);

  const sky = createSkyDome(horizon);
  scene.add(sky);

  return {
    sun,
    hemi,
    sky,
    envMap,
    dispose() {
      envMap.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      sun.shadow.map?.dispose();
    },
  };
}

function createSkyDome(horizon: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: horizon.clone() },
      uZenith: { value: new THREE.Color(0x4f7fb8) },
      uSunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), uSunDir), 0.0);
        col += vec3(1.0, 0.92, 0.78) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
