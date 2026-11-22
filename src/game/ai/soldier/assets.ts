import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { loadScene, versionedUrl } from "../../assets/AssetLoader";
import { sssLightsChunk } from "../humanoid/materials";
import { camoTexture, fabricNormalTexture } from "../humanoid/textures";
import type { QualityName } from "../../config";
import { AVATAR_IDS, type AvatarId, type Part } from "./identity";
import type { ClipInfo, LocoClip } from "./locomotion";

/**
 * Motion-captured soldier assets (see public/assets/characters/soldiers/):
 * eight Rocketbox military avatars (MIT), each split into swappable parts
 * (plus seven civilian Rocketbox heads, MIT, as extra faces: `headOnly`)
 * (body, head, helmet, equipment, plus simplified *_lod1 twins) over one
 * canonical Biped joint order, so a soldier can wear one avatar's uniform,
 * another's face and a third's helmet; and the Quaternius Universal
 * Animation Library (CC0) clips retargeted onto that skeleton.
 *
 * The clips load once, lazily, in the background; avatars load on demand
 * (only the ones the soldiers on the field use) through the shared glTF
 * pipeline (meshopt geometry, KTX2 textures with JPEG fallback). Geometry
 * per (avatar, part subset, LOD) and materials per look are shared.
 */

const BASE = "/assets/characters/soldiers/";
export { AVATAR_IDS, type AvatarId };
export type ClipName = LocoClip | "hitChest" | "hitHead" | "death" | "grip";
type HitClips = LocoClip | "hitChest" | "hitHead" | "death";

export type AvatarMeta = {
  sex: "m" | "f";
  cap: boolean;
  /** Head donor: ships the head part alone, on a one-part atlas (the shader maps it to the head quadrant). */
  headOnly?: boolean;
  parts: Part[];
  tris: Partial<Record<Part, [number, number]>>;
  gains: [number, number, number, number];
  skin: { head: number; body: number };
  eyes: number;
  top: number;
};
type Meta = { avatars: Record<AvatarId, AvatarMeta>; clips: Record<HitClips, ClipInfo> };

export type SoldierAvatar = {
  id: AvatarId;
  meta: AvatarMeta;
  /** Template rig: root bone (Bip01) of the loaded scene and the joints in canonical order. */
  rootBone: THREE.Bone;
  joints: string[];
  boneInverses: THREE.Matrix4[];
  parts: Partial<Record<Part, [THREE.BufferGeometry, THREE.BufferGeometry]>>;
  maps: { color: THREE.Texture; normal: THREE.Texture | null; orm: THREE.Texture };
};

export type SoldierLibrary = {
  clips: Map<ClipName, THREE.AnimationClip>;
  info: Record<HitClips, ClipInfo>;
  meta: Meta;
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

/**
 * LOD switch distances (m) for the mocap soldier: [mid, far(procedural)].
 * The full-detail body (and its 2048 px atlas on High) pays off out to
 * where a face still covers a few dozen pixels.
 */
export function soldierLodDistances(): [number, number] {
  return quality === "high" ? [22, 48] : [14, 34];
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
      const metaRes = await fetch(versionedUrl(BASE + "soldiers.json"));
      if (!metaRes.ok) throw new Error(`soldiers.json ${metaRes.status}`);
      const meta = (await metaRes.json()) as Meta;
      const anims = (await new GLTFLoader().loadAsync(versionedUrl(BASE + "anims.glb"))) as GLTF;
      const clips = new Map<ClipName, THREE.AnimationClip>();
      for (const c of anims.animations) clips.set(c.name as ClipName, c);
      for (const n of ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "death", "grip"] as const) {
        if (!clips.has(n)) throw new Error(`missing clip ${n}`);
      }
      lib = { clips, info: meta.clips, meta };
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
// Avatars: loaded on demand, shared by every soldier that uses them.
// ---------------------------------------------------------------------------
const avatars = new Map<AvatarId, Promise<SoldierAvatar | null>>();

/** Standard attribute set (merging parts needs identical layouts; head masks ride in uv1). */
function normalise(g: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  const f32 = (name: string, size: number) => {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    const arr = new Float32Array(g.getAttribute("position").count * size);
    if (a) for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[i * size + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  f32("position", 3);
  f32("normal", 3);
  f32("uv", 2);
  f32("uv1", 2);
  f32("skinWeight", 4);
  const j = g.getAttribute("skinIndex") as THREE.BufferAttribute;
  const ji = new Uint16Array(j.count * 4);
  for (let i = 0; i < j.count; i++) for (let c = 0; c < 4; c++) ji[i * 4 + c] = j.getComponent(i, c);
  out.setAttribute("skinIndex", new THREE.BufferAttribute(ji, 4));
  const idx = g.index!;
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: idx.count }, (_, i) => idx.getX(i)), 1));
  out.boundingSphere = CULL;
  return out;
}

/** Cull sphere in the Humanoid root's space (the meshes sit in its LOD levels). */
export const CULL = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.6);

/** Loads one avatar (resolves null if it fails: the soldier keeps the procedural body). */
export function loadAvatar(id: AvatarId): Promise<SoldierAvatar | null> {
  let p = avatars.get(id);
  if (p) return p;
  p = (async () => {
    const l = lib ?? (await loadSoldiers());
    if (!l) return null;
    const scene = await loadScene(`${BASE}soldier_${id}${quality === "high" ? "" : "_1k"}.gltf`);
    if (!scene) return null;
    return avatarFromScene(id, scene, l.meta.avatars[id]);
  })().catch((e) => {
    console.warn(`[soldiers] avatar ${id} unavailable`, e);
    return null;
  });
  avatars.set(id, p);
  return p;
}

/**
 * An avatar from its loaded glTF scene (meshes named body / head / helmet /
 * equipment and *_lod1). requireMaps = false accepts a texture-less scene
 * (offline tools and tests).
 */
export function avatarFromScene(id: AvatarId, scene: THREE.Object3D, meta: AvatarMeta, requireMaps = true): SoldierAvatar {
  const meshes = new Map<string, THREE.SkinnedMesh>();
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.set(o.name, o as THREE.SkinnedMesh);
  });
  const body = meshes.get(meta.headOnly ? "head" : "body");
  if (!body) throw new Error(`soldier_${id}: no ${meta.headOnly ? "head" : "body"}`);
  const sk = body.skeleton;
  const parts: SoldierAvatar["parts"] = {};
  for (const part of ["body", "head", "helmet", "equipment"] as const) {
    const m0 = meshes.get(part), m1 = meshes.get(`${part}_lod1`);
    if (m0 && m1) parts[part] = [normalise(m0.geometry), normalise(m1.geometry)];
  }
  const mat = body.material as THREE.MeshStandardMaterial;
  if (requireMaps && (!mat.map || !mat.roughnessMap)) throw new Error(`soldier_${id}: textures missing`);
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = 4;
  let rootBone = sk.bones[0];
  while (rootBone.parent && (rootBone.parent as THREE.Bone).isBone) rootBone = rootBone.parent as THREE.Bone;
  return {
    id,
    meta,
    rootBone,
    joints: sk.bones.map((b) => b.name),
    boneInverses: sk.boneInverses,
    parts,
    maps: { color: mat.map!, normal: mat.normalMap, orm: mat.roughnessMap! },
  };
}

/** Calls back with every requested avatar once all have loaded (or null if any failed). */
export function withAvatars(ids: AvatarId[], cb: (list: Map<AvatarId, SoldierAvatar> | null) => void) {
  const uniq = [...new Set(ids)];
  void Promise.all(uniq.map(loadAvatar)).then((list) => {
    if (list.some((a) => !a)) return cb(null);
    cb(new Map(list.map((a) => [a!.id, a!])));
  });
}

const merged = new Map<string, THREE.BufferGeometry>();

/** One geometry for several parts of the same avatar (one draw call), cached. */
export function partsGeometry(a: SoldierAvatar, parts: Part[], lod: 0 | 1) {
  const list = parts.filter((p) => a.parts[p]).sort();
  const key = `${a.id}|${list.join("+")}|${lod}`;
  let g = merged.get(key);
  if (!g) {
    const src = list.map((p) => a.parts[p]![lod]);
    g = src.length === 1 ? src[0] : mergeGeometries(src, false)!;
    g.boundingSphere = CULL;
    merged.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Materials: one per (avatar, palette, skin, face look), shared.
// The colour atlas is re-tinted: the ORM map's red channel masks the
// camouflage and each atlas quadrant takes its own tint (body = uniform,
// head = the patrol cap, helmet = helmet, equipment = vest); its blue
// channel masks bare skin, re-tinted from the photographed tone to the
// soldier's. The head part's uv1 carries a beard mask (x) and the eye band
// a balaclava leaves open (y). Head donors' one-part atlas is mapped onto the
// head quadrant (uHeadOnly), so every rule below applies unchanged.
//
// High quality only (a define, so Medium / Low compile none of it): skin
// (the ORM blue mask) gets a skin specular (F0 0.028, roughness 0.4..0.62),
// wrapped, red-shifted diffuse at the terminator (the procedural soldiers'
// subsurface approximation, humanoid/materials sssLightsChunk: no extra
// pass) and pores; cloth gets a fibre weave and a grazing sheen. The detail
// normals tile the shared procedural noise / weave textures the gear already
// uses, so they cost no download and no extra texture memory. Eyeballs are
// wet on every tier: the build gives them a low roughness in the ORM map.
// ---------------------------------------------------------------------------
const mats = new Map<string, THREE.MeshStandardMaterial>();
const ELITE = new THREE.Color(0x6a1010);

export type FaceLook = { tone: number; beard: number; balaclava: boolean; knit: number };

const lin = (hex: number) => new THREE.Color(hex); // THREE.Color(hex) converts sRGB hex to the linear working space
/** Photographed mean -> wanted albedo-ish tone: the scale between them (see identity.PHOTO_TO_TONE). */
const ratio = (from: number, to: number) => {
  const a = lin(from), b = lin(to).multiplyScalar(Math.pow(0.72, 2.2));
  const la = 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b, lb = 0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b;
  const s = lb / Math.max(la, 1e-4);
  // Half luminance-only (keeps the photographed undertone), half per channel (moves toward the wanted hue).
  const ch = (x: number, y: number) => THREE.MathUtils.clamp(0.5 * s + (0.5 * y) / Math.max(x, 1e-4), 0.3, 3.2);
  return new THREE.Vector3(ch(a.r, b.r), ch(a.g, b.g), ch(a.b, b.b));
};

export function soldierMaterial(a: SoldierAvatar, look: { uniform: number; vest: number; helmet: number }, face: FaceLook, elite: boolean) {
  const hq = quality === "high";
  const key = `${a.id}|${look.uniform}|${look.vest}|${look.helmet}|${elite ? 1 : 0}|${face.tone}|${face.beard}|${face.balaclava ? face.knit : -1}|${hq ? 1 : 0}`;
  let m = mats.get(key);
  if (m) return m;
  const tint = (c: number, e: number) => {
    const col = new THREE.Color(c);
    if (elite) col.lerp(ELITE, e);
    return col;
  };
  m = new THREE.MeshStandardMaterial({
    map: a.maps.color,
    normalMap: a.maps.normal,
    normalScale: new THREE.Vector2(1, -1), // derivative tangents with glTF (v-down) UVs
    roughnessMap: a.maps.orm,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  m.name = `soldier_${key}`;
  if (hq) m.defines = { IH_HQ: "" };
  const g = a.meta.gains;
  const u = {
    uTintBody: { value: tint(look.uniform, 0.15) },
    uTintVest: { value: tint(look.vest, 0.55) },
    uTintHelmet: { value: tint(look.helmet, 0.7) },
    uGain: { value: new THREE.Vector4(g[0], g[1], g[2], g[3]) },
    uSkinHead: { value: ratio(a.meta.skin.head, face.tone) },
    uSkinBody: { value: ratio(a.meta.skin.body, face.tone) },
    uBeard: { value: face.beard },
    uKnit: { value: new THREE.Color(face.knit) },
    uBalaclava: { value: face.balaclava ? 1 : 0 },
    uHeadOnly: { value: a.meta.headOnly ? 1 : 0 },
  };
  // Detail normals need the normal map's tangent frame (High loads the 2k glTF, which has one).
  const detail = hq && !!a.maps.normal;
  const hqU = detail ? { uPores: { value: camoTexture() }, uWeave: { value: fabricNormalTexture() } } : {};
  m.userData.soldier = u; // read by scripts/soldiers/assemble.ts (offline preview)
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, hqU);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vFaceMask;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFaceMask = uv1;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTintBody;\nuniform vec3 uTintVest;\nuniform vec3 uTintHelmet;\nuniform vec4 uGain;\nuniform vec3 uSkinHead;\nuniform vec3 uSkinBody;\nuniform float uBeard;\nuniform vec3 uKnit;\nuniform float uBalaclava;\nuniform float uHeadOnly;\nvarying vec2 vFaceMask;\nfloat ihKnit = 0.0;\nfloat ihSkin = 0.0;\nfloat ihCloth = 0.0;\nvec2 ihUv = vec2( 0.0 );\n// Read by sssLightsChunk (High).\nfloat hmSssAmt = 0.0;\nfloat hmSheen = 0.0;\n#ifdef IH_HQ\nuniform sampler2D uPores;\nuniform sampler2D uWeave;\n#endif\nfloat ihHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#if defined( USE_MAP ) && defined( USE_ROUGHNESSMAP )
{
  vec3 orm = texture2D( roughnessMap, vRoughnessMapUv ).rgb;
  // Atlas-space UV: head donors' one-part atlas sits in the head quadrant.
  ihUv = uHeadOnly > 0.5 ? vec2( 0.5, 0.0 ) + vMapUv * 0.5 : vMapUv;
  bool top = ihUv.y < 0.5; // glTF UVs: v grows down the atlas
  bool right = ihUv.x > 0.5;
  bool head = top && right;
  vec3 tint = top ? ( right ? uTintHelmet : uTintBody ) : ( right ? uTintVest : uTintHelmet );
  float gain = top ? ( right ? uGain.y : uGain.x ) : ( right ? uGain.w : uGain.z );
  float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, tint * min( lum * gain, 2.5 ), orm.r * ( gain > 0.0 ? 1.0 : 0.0 ) );
  // Skin re-tint (face and bare hands / forearms).
  diffuseColor.rgb *= mix( vec3( 1.0 ), head ? uSkinHead : uSkinBody, orm.b );
  if ( head ) {
    // Facial hair: stubble dots growing into a beard.
    float n = ihHash( floor( ihUv * 1400.0 ) );
    float b = vFaceMask.x * uBeard;
    float hair = b * smoothstep( 0.25, 0.75, n + b * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.16, 0.13, 0.11 ), clamp( hair * 1.4, 0.0, 0.92 ) * orm.b );
    // Balaclava: knit everywhere but the eye band.
    ihKnit = uBalaclava * ( 1.0 - smoothstep( 0.35, 0.75, vFaceMask.y ) );
    float rib = 0.82 + 0.18 * sin( ihUv.x * 2600.0 ) * ( 0.7 + 0.3 * ihHash( floor( ihUv * 700.0 ) ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, uKnit * rib, ihKnit );
  }
  ihSkin = orm.b * ( 1.0 - ihKnit );
  // Fabric: the uniform, vest and helmet cover; on the head only the cap / balaclava.
  ihCloth = ( 1.0 - orm.b ) * ( head ? max( orm.r, ihKnit ) : 1.0 );
  hmSssAmt = ihSkin;
  hmSheen = ihCloth * 0.8;
}
#endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.98, ihKnit );
#ifdef IH_HQ
// Skin: a satin, oily sheen (not plastic, not chalk), slightly glossier where the scan says so.
roughnessFactor = mix( roughnessFactor, clamp( roughnessFactor * 0.8, 0.4, 0.62 ), ihSkin );
#endif`,
      );
    if (hq) {
      s.fragmentShader = s.fragmentShader
        .replace("#include <lights_physical_pars_fragment>", sssLightsChunk())
        .replace(
          "#include <lights_physical_fragment>",
          // Skin's dielectric F0 is ~0.028 (IOR 1.4), not the generic 0.04.
          "#include <lights_physical_fragment>\nmaterial.specularColor = mix( material.specularColor, vec3( 0.028 ), ihSkin );\nmaterial.specularColorBlended = mix( material.specularColorBlended, vec3( 0.028 ), ihSkin );",
        );
      if (detail)
        s.fragmentShader = s.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          THREE.ShaderChunk.normal_fragment_maps.replace(
            "mapN.xy *= normalScale;",
            `mapN.xy *= normalScale;
	// Detail normals in atlas space (~1 tile per 2 cm of skin, a ~1.5 mm weave): pores and
	// fine creases from two taps of the noise atlas on skin, a ripstop weave on fabric.
	vec2 ihPore = ( texture2D( uPores, ihUv * 24.0 ).ag - 0.5 ) * 0.5 + ( texture2D( uPores, ihUv * 9.0 + 0.5 ).ga - 0.5 ) * 0.3;
	vec2 ihWeave = texture2D( uWeave, ihUv * 64.0 ).xy * 2.0 - 1.0;
	mapN.xy += ihPore * ihSkin * 0.6 + ihWeave * ihCloth * 0.45;`,
          ),
        );
    }
  };
  m.customProgramCacheKey = () => (hq ? (detail ? "iron-horizon-soldier-v3-hq" : "iron-horizon-soldier-v3-hq-flat") : "iron-horizon-soldier-v3");
  mats.set(key, m);
  return m;
}

export function disposeSoldierMaterials() {
  mats.forEach((m) => m.dispose());
  mats.clear();
}
