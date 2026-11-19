import * as THREE from "three";
import { sssLightsChunk } from "./materials";

/**
 * Scanned head ("Infinite, 3D Head Scan" of Lee Perry-Smith by
 * Infinite-Realities, CC BY 3.0; see /credits and public/assets/CREDITS.md).
 *
 * The GLB is fetched once and its geometry shared by every soldier. The bust
 * is trimmed to head + neck and baked into head-bone space (origin at the
 * neck base, +Z forward). Per-soldier looks come from a small cache of
 * materials keyed by skin tone / facial hair / face covering, all sharing
 * one shader program: albedo re-tint, beard or clean-shave blend, buzz-cut
 * hair, painted open eyes (the scan's eyes are closed), balaclava and face
 * paint masks, plus wrapped-diffuse subsurface lighting.
 */

const BASE = "/assets/characters/head/";
/** Scan units -> metres, and the offset that puts the eyes at y = 0.134, nose tip at z ~ 0.11. */
const SCALE = 0.0436;
const OFFSET = new THREE.Vector3(0, 0.0645, -0.004);
/** Everything below this (scan units) is shoulders / chest: dropped. */
const CUT_Y = -1.5;

export type FaceCover = "none" | "balaclava" | "paint";
export type FaceLook = { tone: number; beard: number; hair: number; cover: FaceCover; iris: number; brim: number };

let geometry: THREE.BufferGeometry | null = null;
let loading = false;
const waiters: ((g: THREE.BufferGeometry) => void)[] = [];
let maps: { col: THREE.Texture; nrm: THREE.Texture; spec: THREE.Texture } | null = null;
const materials = new Map<string, THREE.MeshStandardMaterial>();

/** The trimmed, head-space scan geometry, or null while it is loading. */
export function headGeometry() {
  return geometry;
}

/** Calls back (synchronously if ready) once the scan geometry is available. Starts loading on first use. */
export function onHeadReady(cb: (g: THREE.BufferGeometry) => void) {
  if (geometry) {
    cb(geometry);
    return;
  }
  waiters.push(cb);
  if (loading || typeof window === "undefined") return;
  loading = true;
  void import("three/addons/loaders/GLTFLoader.js")
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(BASE + "LeePerrySmith.glb"))
    .then((gltf) => {
      let src: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => {
        if (!src && (o as THREE.Mesh).isMesh) src = (o as THREE.Mesh).geometry;
      });
      if (!src) throw new Error("head scan: no mesh");
      geometry = trim(src);
      (src as THREE.BufferGeometry).dispose();
      const list = waiters.splice(0);
      for (const w of list) w(geometry);
    })
    .catch((e) => {
      loading = false;
      console.warn("[humanoid] head scan failed to load; using sculpted heads", e);
    });
}

/** Keep head + neck triangles, compact the vertex buffers and bake into head-bone space. */
function trim(src: THREE.BufferGeometry) {
  const P = src.getAttribute("position") as THREE.BufferAttribute;
  const N = src.getAttribute("normal") as THREE.BufferAttribute;
  const U = src.getAttribute("uv") as THREE.BufferAttribute;
  const idx = src.index!.array;
  const remap = new Int32Array(P.count).fill(-1);
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (P.getY(a) < CUT_Y || P.getY(b) < CUT_Y || P.getY(c) < CUT_Y) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = n++;
      out.push(remap[v]);
    }
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let v = 0; v < P.count; v++) {
    const j = remap[v];
    if (j < 0) continue;
    pos[j * 3] = P.getX(v) * SCALE + OFFSET.x;
    pos[j * 3 + 1] = P.getY(v) * SCALE + OFFSET.y;
    pos[j * 3 + 2] = P.getZ(v) * SCALE + OFFSET.z;
    nor[j * 3] = N.getX(v);
    nor[j * 3 + 1] = N.getY(v);
    nor[j * 3 + 2] = N.getZ(v);
    uv[j * 2] = U.getX(v);
    uv[j * 2 + 1] = U.getY(v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(out, 1) : new THREE.Uint16BufferAttribute(out, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function loadMaps() {
  if (maps) return maps;
  const tl = new THREE.TextureLoader();
  const load = (f: string, srgb: boolean) => {
    const t = tl.load(BASE + f);
    // flipY stays on (the default): this asset's UVs follow the three.js example, not raw glTF.
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  maps = { col: load("Map-COL.jpg", true), nrm: load("Infinite-Level_02_Tangent_SmoothUV.jpg", false), spec: load("Map-SPEC.jpg", false) };
  return maps;
}

/** Average forehead albedo of the scan (sRGB 219,172,157): the tint reference. */
const REF = new THREE.Color(0xdbac9d);

const FRAG_HEAD = /* glsl */ `
uniform vec3 uTone;
uniform float uBeard;
uniform float uHair;
uniform float uBrim;
uniform float uCover;
uniform vec3 uIris;
uniform sampler2D uSpec;
float hmSssAmt = 1.0;
float hmH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float hmEll( vec2 p, vec2 c, vec2 r ) { vec2 d = ( p - c ) / r; return dot( d, d ); }
`;

// Runs after <map_fragment> (diffuseColor = linear scan albedo).
const FRAG_COLOR = /* glsl */ `
vec2 fuv = vec2( vMapUv.x, 1.0 - vMapUv.y ); // image space: (0,0) top-left
vec3 alb = diffuseColor.rgb;
float dxm = abs( fuv.x - 0.5 );
// Even skin (no stubble) sampled from a blurred mip of the cheek.
vec3 bare = texture2D( map, vec2( 0.5 + sign( fuv.x - 0.5 ) * 0.14, 0.57 ), 5.0 ).rgb * vec3( 0.97, 0.95, 0.96 );
float hairN = hmH( floor( fuv * 820.0 ) );
float hairN2 = hmH( floor( fuv * 410.0 ) + 7.0 );
// Beard region: jaw, chin, cheeks below the cheekbone, moustache; lips excluded.
float bReg = 1.0 - smoothstep( 0.55, 1.0, hmEll( fuv, vec2( 0.5, 0.575 ), vec2( 0.175, 0.19 ) ) );
bReg *= smoothstep( 0.4, 0.45, fuv.y + ( 0.17 - min( dxm, 0.17 ) ) * 0.22 );
bReg *= 1.0 - smoothstep( 0.64, 0.72, fuv.y ) * 0.9;
float lips = 1.0 - smoothstep( 0.6, 1.0, hmEll( fuv, vec2( 0.4985, 0.467 ), vec2( 0.065, 0.024 ) ) );
bReg *= 1.0 - lips;
// clean shave (uBeard 0) -> scan's own stubble (1) -> short beard (2)
alb = mix( alb, bare * mix( vec3( 1.0 ), vec3( 0.88, 0.88, 0.93 ), 0.3 ), bReg * clamp( 1.0 - uBeard, 0.0, 1.0 ) * 0.85 );
vec3 hairC = vec3( 0.05, 0.034, 0.024 ) * ( 0.55 + 0.9 * hairN2 );
float dens = bReg * clamp( uBeard - 1.0, 0.0, 1.0 );
alb = mix( alb, hairC, clamp( dens * 0.6 + step( hairN, dens * 1.1 - 0.15 ) * 0.3, 0.0, 0.9 ) );
// Scalp: hairline over the forehead, temples, above the ears, nape.
float hl = 0.115 + smoothstep( 0.11, 0.22, dxm ) * 0.19 + smoothstep( 0.32, 0.46, dxm ) * 0.26;
float scalp = 1.0 - smoothstep( hl - 0.012, hl + 0.012, fuv.y );
alb = mix( alb, mix( alb * 0.8, hairC, 0.35 + 0.5 * hairN ), scalp * uHair );
// Re-tint to the soldier's skin tone.
alb *= uTone;
// Occlusion under a helmet / cap brim: brow, eye sockets, temples.
float under = ( 1.0 - smoothstep( 0.2, 0.36, fuv.y ) ) * ( 1.0 - smoothstep( 0.2, 0.34, dxm ) );
alb *= 1.0 - uBrim * under * 0.4;
// Painted open eyes (the scan's lids are closed): sclera, iris, pupil, lash line.
float eyeL = hmEll( fuv, vec2( 0.4284, 0.2965 ), vec2( 0.03, 0.0135 ) );
float eyeR = hmEll( fuv, vec2( 0.5716, 0.2965 ), vec2( 0.03, 0.0135 ) );
float eyeD = min( eyeL, eyeR );
vec2 ec = eyeL < eyeR ? vec2( 0.4284, 0.2965 ) : vec2( 0.5716, 0.2965 );
float eye = 1.0 - smoothstep( 0.75, 1.0, eyeD );
float ir = length( ( fuv - ec ) / vec2( 1.0, 0.98 ) );
vec3 eyeC = mix( vec3( 0.46, 0.43, 0.40 ), uIris * ( 0.7 + 0.5 * hairN ), 1.0 - smoothstep( 0.0105, 0.0125, ir ) );
eyeC = mix( eyeC, vec3( 0.006 ), 1.0 - smoothstep( 0.0042, 0.0055, ir ) );
eyeC = mix( eyeC, vec3( 2.0 ), 1.0 - smoothstep( 0.0, 0.0022, length( fuv - ec - vec2( 0.004, -0.004 ) ) ) ); // catch-light
eyeC *= 0.7 + 0.3 * smoothstep( -0.012, 0.004, fuv.y - ec.y ); // upper-lid shadow
float lash = smoothstep( 0.6, 1.0, eyeD ) * ( 1.0 - smoothstep( 1.0, 1.6, eyeD ) ) * step( fuv.y, ec.y + 0.002 );
alb = mix( alb, eyeC, eye );
alb = mix( alb, vec3( 0.02, 0.015, 0.012 ), lash * 0.8 );
// Face covering: knit balaclava with an eye slot, or camo face paint.
float slot = 1.0 - smoothstep( 0.8, 1.0, hmEll( fuv, vec2( 0.5, 0.297 ), vec2( 0.115, 0.036 ) ) );
float knit = 0.75 + 0.35 * hmH( floor( fuv * vec2( 300.0, 600.0 ) ) ) + 0.15 * sin( fuv.y * 1600.0 );
float bala = step( 0.5, uCover ) * step( uCover, 1.5 ) * ( 1.0 - slot );
alb = mix( alb, vec3( 0.022, 0.021, 0.02 ) * knit, bala );
float face = ( 1.0 - smoothstep( 0.2, 0.28, dxm ) ) * smoothstep( 0.12, 0.16, fuv.y ) * ( 1.0 - smoothstep( 0.6, 0.66, fuv.y ) ) * ( 1.0 - eye );
float stripe = step( 0.5, fract( ( fuv.x * 0.8 + fuv.y ) * 7.0 + ( hairN2 - 0.5 ) * 0.25 ) );
vec3 paintC = mix( vec3( 0.045, 0.06, 0.03 ), vec3( 0.09, 0.07, 0.04 ), stripe );
alb = mix( alb, paintC, step( 1.5, uCover ) * face * 0.85 );
diffuseColor.rgb = alb;
hmSssAmt = ( 1.0 - bala ) * ( 1.0 - step( 1.5, uCover ) * face * 0.6 );
float hmEye = eye;
float hmCloth = bala;
`;

const FRAG_ROUGH = /* glsl */ `
float specI = texture2D( uSpec, vMapUv ).g;
roughnessFactor = mix( 0.66, 0.36, specI );
roughnessFactor = mix( roughnessFactor, 0.16, hmEye );
roughnessFactor = mix( roughnessFactor, 1.0, hmCloth );
`;

/** Material for one face look. Cached; every face material shares one program. */
export function faceMaterial(look: FaceLook) {
  const key = `${look.tone}|${look.beard}|${look.hair}|${look.cover}|${look.iris}|${look.brim}`;
  let m = materials.get(key);
  if (m) return m;
  const mp = loadMaps();
  m = new THREE.MeshStandardMaterial({ map: mp.col, normalMap: mp.nrm, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, metalness: 0 });
  const ratio = new THREE.Color(look.tone);
  ratio.r /= REF.r;
  ratio.g /= REF.g;
  ratio.b /= REF.b;
  const cover = look.cover === "balaclava" ? 1 : look.cover === "paint" ? 2 : 0;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTone = { value: ratio };
    shader.uniforms.uBeard = { value: look.beard };
    shader.uniforms.uHair = { value: look.hair };
    shader.uniforms.uBrim = { value: look.brim };
    shader.uniforms.uCover = { value: cover };
    shader.uniforms.uIris = { value: new THREE.Color(look.iris) };
    shader.uniforms.uSpec = { value: mp.spec };
    shader.fragmentShader =
      FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <lights_physical_pars_fragment>", sssLightsChunk())
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + FRAG_COLOR)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + FRAG_ROUGH)
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * ( 1.0 - hmEye ) * ( 1.0 - hmCloth * 0.6 );"));
  };
  m.customProgramCacheKey = () => "iron-horizon-face-v2";
  materials.set(key, m);
  return m;
}

export function disposeHeads() {
  materials.forEach((m) => m.dispose());
  materials.clear();
  if (maps) {
    maps.col.dispose();
    maps.nrm.dispose();
    maps.spec.dispose();
    maps = null;
  }
  // The scan geometry is kept: it is small, immutable and reloading costs a fetch.
}
