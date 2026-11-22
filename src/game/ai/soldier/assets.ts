import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { versionedUrl } from "../../assets/AssetLoader";
import type { QualityName } from "../../config";
import type { ClipInfo, LocoClip } from "./locomotion";

/**
 * Motion-captured soldier assets (see public/assets/characters/soldiers/):
 * three Rocketbox military avatars (MIT) re-rigged to metres with an atlased
 * texture set each, and the Quaternius Universal Animation Library (CC0)
 * clips retargeted offline onto their Biped skeleton. Loaded once, lazily,
 * in the background; every soldier clones a template (shared geometry,
 * shared clips, per-palette shared materials).
 */

const BASE = "/assets/characters/soldiers/";
export const AVATAR_IDS = ["a", "b", "c"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export type ClipName = LocoClip | "hitChest" | "hitHead" | "death" | "grip";

type Meta = {
  avatars: Record<AvatarId, { tris: [number, number]; gains: [number, number, number, number] }>;
  clips: Record<LocoClip | "hitChest" | "hitHead" | "death", ClipInfo>;
};

export type SoldierTemplate = {
  id: AvatarId;
  scene: THREE.Group;
  gains: THREE.Vector4;
  maps: { color: THREE.Texture; normal: THREE.Texture | null; orm: THREE.Texture };
};

export type SoldierLibrary = {
  templates: SoldierTemplate[];
  clips: Map<ClipName, THREE.AnimationClip>;
  info: Record<LocoClip | "hitChest" | "hitHead" | "death", ClipInfo>;
};

// ---------------------------------------------------------------------------
// Quality switch. Low keeps the procedural soldier; medium / high use the
// mocap one near the camera (LOD distances below) and the procedural far LOD
// beyond. Set by the engine (setSoldierQuality); also overridable for tests
// or as a kill switch with localStorage "tgf.soldiers" = "procedural".
// ---------------------------------------------------------------------------
let quality: QualityName = "medium";
export function setSoldierQuality(q: QualityName) {
  quality = q;
  // Start fetching while the map builds, so the first soldiers already get the mocap body.
  if (mocapWanted()) void loadSoldiers();
}
export function soldierQuality() {
  return quality;
}

/** LOD switch distances (m) for the mocap soldier: [mid, far(procedural)]. */
export function soldierLodDistances(): [number, number] {
  return quality === "high" ? [16, 42] : [10, 30];
}

function killSwitch() {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem("tgf.soldiers") === "procedural";
  } catch {
    return false;
  }
}

/** Whether new soldiers should try the mocap body. */
export function mocapWanted() {
  return typeof window !== "undefined" && quality !== "low" && !failed && !killSwitch();
}

let failed = false;
let lib: SoldierLibrary | null = null;
let loading: Promise<SoldierLibrary | null> | null = null;
const waiters: ((l: SoldierLibrary) => void)[] = [];

/** The loaded library, or null while loading / after a failure. */
export function soldierLibrary() {
  return lib;
}

/** Calls back once the library is ready (synchronously if it already is). Starts loading on first use. */
export function onSoldiersReady(cb: (l: SoldierLibrary) => void) {
  if (lib) {
    cb(lib);
    return;
  }
  waiters.push(cb);
  void loadSoldiers();
}

export function loadSoldiers(): Promise<SoldierLibrary | null> {
  if (lib) return Promise.resolve(lib);
  if (loading) return loading;
  if (typeof window === "undefined") return Promise.resolve(null);
  loading = (async () => {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      const metaRes = await fetch(versionedUrl(BASE + "soldiers.json"));
      if (!metaRes.ok) throw new Error(`soldiers.json ${metaRes.status}`);
      const meta = (await metaRes.json()) as Meta;
      const glb = (f: string) => loader.loadAsync(versionedUrl(BASE + f)) as Promise<GLTF>;
      const hi = quality === "high";
      const [anims, ...avatars] = await Promise.all([glb("anims.glb"), ...AVATAR_IDS.map((id) => glb(`soldier_${id}.glb`))]);
      const tl = new THREE.TextureLoader();
      const tex = (f: string, srgb: boolean) =>
        new Promise<THREE.Texture>((res, rej) =>
          tl.load(
            versionedUrl(BASE + f),
            (t) => {
              t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
              t.anisotropy = 4;
              res(t);
            },
            undefined,
            rej,
          ),
        );
      const templates = await Promise.all(
        AVATAR_IDS.map(async (id, i): Promise<SoldierTemplate> => {
          const [color, normal, orm] = await Promise.all([
            tex(`soldier_${id}_color${hi ? "" : "_1k"}.jpg`, true),
            tex(`soldier_${id}_normal.jpg`, false),
            tex(`soldier_${id}_orm.jpg`, false),
          ]);
          const scene = avatars[i].scene;
          const g = meta.avatars[id].gains;
          return { id, scene, gains: new THREE.Vector4(g[0], g[1], g[2], g[3]), maps: { color, normal, orm } };
        }),
      );
      const clips = new Map<ClipName, THREE.AnimationClip>();
      for (const c of anims.animations) clips.set(c.name as ClipName, c);
      for (const n of ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "death", "grip"] as const) {
        if (!clips.has(n)) throw new Error(`missing clip ${n}`);
      }
      lib = { templates, clips, info: meta.clips };
      for (const w of waiters.splice(0)) w(lib);
      return lib;
    } catch (e) {
      failed = true;
      waiters.length = 0;
      console.warn("[soldiers] mocap soldiers unavailable; using procedural soldiers", e);
      return null;
    }
  })();
  return loading;
}

// ---------------------------------------------------------------------------
// Materials: one per (avatar, uniform, vest, helmet, elite), shared.
// The colour atlas is re-tinted per team: the ORM map's red channel masks
// the camouflage (skin, the face quadrant and boots stay as photographed),
// and each atlas quadrant takes its own tint: body = uniform, helmet =
// helmet, equipment = vest. The camo keeps its pattern contrast; its mean
// luminance maps to the tint colour (gains baked per quadrant).
// ---------------------------------------------------------------------------
const mats = new Map<string, THREE.MeshStandardMaterial>();
const ELITE = new THREE.Color(0x6a1010);

export function soldierMaterial(t: SoldierTemplate, uniform: number, vest: number, helmet: number, elite: boolean) {
  const key = `${t.id}|${uniform}|${vest}|${helmet}|${elite ? 1 : 0}`;
  let m = mats.get(key);
  if (m) return m;
  const tint = (c: number, e: number) => {
    const col = new THREE.Color(c); // linear working space
    if (elite) col.lerp(ELITE, e);
    return col;
  };
  m = new THREE.MeshStandardMaterial({
    map: t.maps.color,
    normalMap: t.maps.normal,
    roughnessMap: t.maps.orm,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  m.name = `soldier_${key}`;
  const u = {
    uTintBody: { value: tint(uniform, 0.15) },
    uTintVest: { value: tint(vest, 0.55) },
    uTintHelmet: { value: tint(helmet, 0.7) },
    uGain: { value: t.gains },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uTintBody;\nuniform vec3 uTintVest;\nuniform vec3 uTintHelmet;\nuniform vec4 uGain;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#if defined( USE_MAP ) && defined( USE_ROUGHNESSMAP )
{
  float tMask = texture2D( roughnessMap, vRoughnessMapUv ).r;
  bool top = vMapUv.y > 0.5;
  bool right = vMapUv.x > 0.5;
  vec3 tint = top ? uTintBody : ( right ? uTintVest : uTintHelmet );
  float gain = top ? ( right ? 0.0 : uGain.x ) : ( right ? uGain.w : uGain.z );
  float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, tint * min( lum * gain, 2.5 ), tMask * ( gain > 0.0 ? 1.0 : 0.0 ) );
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => "iron-horizon-soldier";
  mats.set(key, m);
  return m;
}

export function disposeSoldierMaterials() {
  mats.forEach((m) => m.dispose());
  mats.clear();
}
