import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { type ClipId, type CharacterEntry, loadManifest } from "./manifest";

/** Standing height every character is scaled to (metres). */
export const CHARACTER_HEIGHT = 1.8;

/**
 * Mixamo bones are named "mixamorig:Hips". FBXLoader strips the colon ("mixamorigHips"),
 * some exporters add a number ("mixamorig1Hips"). Every bone and track is normalised to "Hips".
 */
export function normalizeBoneName(name: string): string {
  return name.replace(/^mixamorig\d*[:_]?/i, "");
}

let gltfLoader: GLTFLoader | null = null;
let fbxLoader: FBXLoader | null = null;

interface RawAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

const rawCache = new Map<string, Promise<RawAsset>>();

function loadRaw(url: string): Promise<RawAsset> {
  let p = rawCache.get(url);
  if (!p) {
    const encoded = encodeURI(url);
    if (/\.fbx$/i.test(url)) {
      fbxLoader ??= new FBXLoader();
      p = fbxLoader.loadAsync(encoded).then((g) => ({ scene: g, clips: g.animations }));
    } else {
      gltfLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      p = gltfLoader.loadAsync(encoded).then((g) => ({ scene: g.scene, clips: g.animations }));
    }
    rawCache.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface CharacterTemplate {
  id: string;
  name: string;
  /** Normalised template (faces +Z, feet at y = 0, 1.8 m tall). Clone it; never add it to a scene. */
  root: THREE.Object3D;
}

/** Convert whatever the exporter produced (FBX gives Phong) into one consistent PBR material. */
function toStandard(m: THREE.Material): THREE.MeshStandardMaterial {
  const src = m as THREE.MeshPhongMaterial & THREE.MeshStandardMaterial;
  const out = new THREE.MeshStandardMaterial({
    name: src.name,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    roughnessMap: src.roughnessMap ?? null,
    metalnessMap: src.metalnessMap ?? null,
    aoMap: src.aoMap ?? null,
    emissiveMap: src.emissiveMap ?? null,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0),
    alphaTest: src.alphaMap || src.transparent ? 0.5 : 0,
    roughness: src.roughnessMap ? 1 : 0.72,
    metalness: src.metalnessMap ? 1 : 0.06,
  });
  if (out.map) out.map.colorSpace = THREE.SRGBColorSpace;
  if (out.emissiveMap) out.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (m !== out) m.dispose();
  return out;
}

function prepareTemplate(entry: CharacterEntry, model: THREE.Object3D): CharacterTemplate {
  const root = new THREE.Group();
  root.name = `character:${entry.id}`;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) o.name = normalizeBoneName(o.name);
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    // Props baked into some characters (Arissa's sword, etc.): players hold the game's own weapons.
    if (/weapon|sword|blade|gun|rifle|bow\b/i.test(mesh.name)) mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned meshes move outside their bind-pose bounds.
    mesh.frustumCulled = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toStandard) : toStandard(mesh.material);
  });
  // Scale to a fixed height (Mixamo FBX is in centimetres), feet on y = 0.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(CHARACTER_HEIGHT / Math.max(box.max.y - box.min.y, 1e-3));
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.y -= box.min.y;
  root.add(model);
  return { id: entry.id, name: entry.name, root };
}

/** Clone a template (geometry and textures stay shared between clones). */
export function cloneCharacter(t: CharacterTemplate): THREE.Object3D {
  return SkeletonUtils.clone(t.root);
}

// ---------------------------------------------------------------------------
// Animation clips
// ---------------------------------------------------------------------------

export type ClipLibrary = Partial<Record<ClipId, THREE.AnimationClip[]>>;

/** Hips height (in the animation file's own skeleton units) per clip, for retargeting. */
const clipRefHipsY = new WeakMap<THREE.AnimationClip, number>();

function findHipsY(root: THREE.Object3D): number | null {
  let y: number | null = null;
  root.traverse((o) => {
    if (y === null && (o as THREE.Bone).isBone && normalizeBoneName(o.name) === "Hips") y = o.position.y;
  });
  return y;
}

/**
 * Make a Mixamo clip playable on any Mixamo character:
 * bare bone names; only Hips keeps a position track (other bones' translations would force one
 * character's proportions onto another); no root motion on X/Z (physics moves characters); no scale.
 */
function cleanClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf(".");
    const bone = normalizeBoneName(t.name.slice(0, dot));
    const prop = t.name.slice(dot + 1);
    if (prop === "scale") continue;
    if (prop === "position" && bone !== "Hips") continue;
    const copy = t.clone();
    copy.name = `${bone}.${prop}`;
    if (prop === "position") {
      const v = copy.values;
      const x0 = v[0] ?? 0;
      const z0 = v[2] ?? 0;
      for (let i = 0; i + 2 < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
      }
    }
    tracks.push(copy);
  }
  const out = new THREE.AnimationClip(name, clip.duration, tracks);
  out.optimize();
  return out;
}

const retargetCache = new WeakMap<THREE.AnimationClip, Map<string, THREE.AnimationClip>>();

/** Rescale the Hips height track to this character so taller/shorter people don't float or sink. */
export function retargetClip(clip: THREE.AnimationClip, template: CharacterTemplate): THREE.AnimationClip {
  let perChar = retargetCache.get(clip);
  if (!perChar) retargetCache.set(clip, (perChar = new Map()));
  const hit = perChar.get(template.id);
  if (hit) return hit;
  const refY = clipRefHipsY.get(clip);
  const bindY = findHipsY(template.root);
  let out = clip;
  if (refY && bindY && Math.abs(refY - bindY) / refY > 0.01) {
    out = clip.clone();
    const k = bindY / refY;
    for (const t of out.tracks) {
      if (t.name !== "Hips.position") continue;
      const v = t.values;
      for (let i = 1; i < v.length; i += 3) v[i] = (v[i] ?? 0) * k;
    }
  }
  perChar.set(template.id, out);
  return out;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface HumanoidLibrary {
  templates: CharacterTemplate[];
  clips: ClipLibrary;
}

let libraryPromise: Promise<HumanoidLibrary | null> | null = null;
let library: HumanoidLibrary | null = null;

/**
 * Loads every character and clip listed in the manifest once. Resolves to null when the
 * manifest or required assets are missing, so callers can keep the procedural character.
 */
export function loadHumanoidLibrary(): Promise<HumanoidLibrary | null> {
  libraryPromise ??= (async () => {
    try {
      const m = await loadManifest();
      const templates = (
        await Promise.all(
          m.characters.map((c) =>
            loadRaw(c.url)
              .then((raw) => prepareTemplate(c, raw.scene))
              .catch((err: unknown) => {
                console.warn(`[humanoid] failed to load character ${c.url}`, err);
                return null;
              }),
          ),
        )
      ).filter((t): t is CharacterTemplate => t !== null);

      const clips: ClipLibrary = {};
      await Promise.all(
        (Object.entries(m.clips) as [ClipId, string[]][]).flatMap(([id, urls]) =>
          urls.map((url, i) =>
            loadRaw(url.split("#")[0]!)
              .then((raw) => {
                // "pack.glb#run" picks a named clip from a multi-animation file.
                const want = url.includes("#") ? decodeURIComponent(url.slice(url.indexOf("#") + 1)) : null;
                const src = want ? raw.clips.find((c) => c.name === want) : raw.clips[0];
                if (!src) return;
                const clip = cleanClip(src, i === 0 ? id : `${id}_${i + 1}`);
                const refY = findHipsY(raw.scene);
                if (refY) clipRefHipsY.set(clip, refY);
                (clips[id] ??= [])[i] = clip;
              })
              .catch((err: unknown) => console.warn(`[humanoid] failed to load animation ${url}`, err)),
          ),
        ),
      );
      for (const k of Object.keys(clips) as ClipId[]) clips[k] = (clips[k] ?? []).filter(Boolean);

      if (!templates.length || !clips.idle?.length) {
        console.warn("[humanoid] need at least one character and an idle animation; using the procedural character");
        return null;
      }
      library = { templates, clips };
      return library;
    } catch (err) {
      console.info("[humanoid] no character assets yet; using the procedural character.", err);
      return null;
    }
  })();
  return libraryPromise;
}

/** The library if it has finished loading, else null. */
export function humanoidLibrary(): HumanoidLibrary | null {
  return library;
}

let nextPick = 0;

/** Deal characters round-robin so a squad looks varied. */
export function pickTemplate(lib: HumanoidLibrary, key?: string): CharacterTemplate {
  let index: number;
  if (key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    index = Math.abs(h) % lib.templates.length;
  } else index = nextPick++ % lib.templates.length;
  return lib.templates[index]!;
}
