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
 * hair, eyelids opened in the geometry over two eyeballs, balaclava and face
 * paint masks, plus wrapped-diffuse subsurface lighting.
 */

const BASE = "/assets/characters/head/";
/** Scan units -> metres, and the offset that puts the eyes at y = 0.134, nose tip at z ~ 0.11. */
const SCALE = 0.0436;
const OFFSET = new THREE.Vector3(0, 0.0645, -0.004);
/** Everything below this (scan units) is shoulders / chest: dropped. */
const CUT_Y = -1.5;
/** Neck axis (head-space x, z) the cut band is tapered towards. */
const NECK = new THREE.Vector2(-0.004, -0.02);

export type FaceCover = "none" | "balaclava" | "paint";
export type FaceLook = { tone: number; beard: number; hair: number; cover: FaceCover; iris: number; brim: number; id: number };

/** Distinct faces in rotation: soldiers cycle through these identities. */
export const FACE_IDS = 32;

/**
 * One soldier's face: bone structure (applied to the shared scan in the
 * vertex shader), hair colour, beard style, age, a cut or scar, grime and
 * sweat. Deterministic per id.
 */
export type FaceIdentity = {
  /** jaw width, chin projection, nose length, nose width (each -1..1) */
  shapeA: [number, number, number, number];
  /** brow ridge, cheekbones, face length, cheek fullness (each -1..1) */
  shapeB: [number, number, number, number];
  hairCol: number;
  /** Share of grey hairs. */
  grey: number;
  /** 0 clean, 1 stubble, 2 short beard, 3 full beard. */
  beard: number;
  /** 0 full face, 1 moustache + chin only. */
  beardStyle: number;
  age: number;
  /** image-space centre (u, v), angle, kind (0 none, 1 fresh cut, 2 old scar) */
  scar: [number, number, number, number];
  grime: number;
  sweat: number;
  brow: number;
};

const HAIR_COLS = [0x1c140e, 0x261a10, 0x332216, 0x45301c, 0x5f4228, 0x7a5432, 0x5a2e18];
const SCAR_SPOTS: [number, number, number][] = [
  [0.4, 0.252, 0.5], // over the right brow
  [0.615, 0.355, -0.6], // left cheekbone
  [0.385, 0.36, 0.7], // right cheekbone
  [0.5, 0.215, 0.1], // forehead
  [0.6, 0.255, -0.4], // left brow
  [0.53, 0.6, 0.3], // chin
];

function rng(seed: number) {
  let a = (seed * 0x9e3779b1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function faceIdentity(id: number): FaceIdentity {
  const r = rng(id + 1);
  const s = () => (r() * 2 - 1) * (0.55 + 0.45 * r());
  const age = r();
  const bRoll = r();
  const scarRoll = r();
  const spot = SCAR_SPOTS[Math.floor(r() * SCAR_SPOTS.length)];
  return {
    shapeA: [s(), s(), s(), s()],
    shapeB: [s(), s(), s(), s()],
    hairCol: HAIR_COLS[Math.floor(r() * HAIR_COLS.length)],
    grey: age > 0.6 ? (age - 0.6) * 1.6 : 0,
    beard: bRoll < 0.18 ? 0 : bRoll < 0.45 ? 1 : bRoll < 0.68 ? 2 : 3,
    beardStyle: r() < 0.2 ? 1 : 0,
    age,
    scar: scarRoll < 0.3 ? [spot[0], spot[1], spot[2] + (r() - 0.5) * 0.6, 1] : scarRoll < 0.5 ? [spot[0], spot[1], spot[2], 2] : [0, 0, 0, 0],
    grime: 0.25 + r() * 0.75,
    sweat: 0.35 + r() * 0.65,
    brow: 0.4 + r() * 0.6,
  };
}

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
    // Keep every triangle reaching above the cut; the stragglers below are flattened onto it (a clean edge, not a sawtooth).
    if (Math.max(P.getY(a), P.getY(b), P.getY(c)) < CUT_Y) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = n++;
      out.push(remap[v]);
    }
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let v = 0; v < P.count; v++) {
    const j = remap[v];
    if (j < 0) continue;
    // The bust flares into the shoulders at the cut: taper that last band
    // back into the neck so the ragged edge tucks inside the collar.
    const tuck = 0.8 + 0.2 * smooth(0, 1, (P.getY(v) - CUT_Y) / 0.65);
    pos[j * 3] = (P.getX(v) * SCALE + OFFSET.x - NECK.x) * tuck + NECK.x;
    pos[j * 3 + 1] = Math.max(P.getY(v), CUT_Y) * SCALE + OFFSET.y;
    pos[j * 3 + 2] = (P.getZ(v) * SCALE + OFFSET.z - NECK.y) * tuck + NECK.y;
    nor[j * 3] = N.getX(v);
    nor[j * 3 + 1] = N.getY(v);
    nor[j * 3 + 2] = N.getZ(v);
    uv[j * 2] = U.getX(v);
    uv[j * 2 + 1] = U.getY(v);
  }
  const moved = openEyes(pos, uv, n);
  // Re-derive normals where the lids moved (the rest keeps the scan's own normals).
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tmp.setIndex(out);
  tmp.computeVertexNormals();
  const tn = tmp.getAttribute("normal") as THREE.BufferAttribute;
  for (let j = 0; j < n; j++) {
    const w = moved[j];
    if (w <= 0) continue;
    const v = new THREE.Vector3(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]).lerp(new THREE.Vector3(tn.getX(j), tn.getY(j), tn.getZ(j)), Math.min(1, w * 2)).normalize();
    nor[j * 3] = v.x;
    nor[j * 3 + 1] = v.y;
    nor[j * 3 + 2] = v.z;
  }
  tmp.dispose();
  // Append the two eyeballs to the same buffers: still one draw call.
  const eye = new THREE.SphereGeometry(EYE_R, 20, 14).rotateX(Math.PI / 2); // pole -> +Z (gaze)
  const ep = eye.getAttribute("position"), en = eye.getAttribute("normal"), ei = eye.index!.array;
  const total = n + ep.count * 2;
  const pos2 = new Float32Array(total * 3), nor2 = new Float32Array(total * 3), uv2 = new Float32Array(total * 2);
  pos2.set(pos);
  nor2.set(nor);
  uv2.set(uv);
  EYES.forEach((e, k) => {
    const base = n + k * ep.count;
    for (let i = 0; i < ep.count; i++) {
      const j = base + i;
      pos2[j * 3] = e.x + ep.getX(i);
      pos2[j * 3 + 1] = e.y + ep.getY(i);
      pos2[j * 3 + 2] = EYE_Z + ep.getZ(i);
      nor2[j * 3] = en.getX(i);
      nor2[j * 3 + 1] = en.getY(i);
      nor2[j * 3 + 2] = en.getZ(i);
      // Off-atlas UVs flag the eyeball to the face shader: u in [2,3] (right eye) or [4,5] (left), v in [0,1], from the gaze-plane position.
      uv2[j * 2] = 2.5 + k * 2 + (ep.getX(i) / EYE_R) * 0.5;
      uv2[j * 2 + 1] = 0.5 + (ep.getY(i) / EYE_R) * 0.5;
    }
    for (let i = 0; i < ei.length; i++) out.push(base + ei[i]);
  });
  eye.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos2, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor2, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv2, 2));
  g.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(out, 1) : new THREE.Uint16BufferAttribute(out, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Eye centres in head space (measured on the scan: centre of each closed lid slit), and their image-space UV centre. */
const EYES = [
  { x: -0.0315, y: 0.1362, u: 0.4284 },
  { x: 0.024, y: 0.1362, u: 0.5716 },
];
const EYE_R = 0.012;
/** Eyeball centre depth: puts the cornea ~1 mm behind the closed lids' front surface. */
const EYE_Z = 0.0655;
/** Image-space v of the closed lid line. */
const SLIT_V = 0.2965;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The scan was captured with the eyes closed. Open them: the upper lid (image
 * v above the lid line) slides up ~6 mm and the lower lid down ~1.5 mm, both
 * tapering to nothing at the eye corners and towards the brow / cheek; every
 * moved vertex is then kept just outside the eyeball, and the deep slit
 * surface is tucked behind it. Returns the per-vertex move weight.
 */
function openEyes(pos: Float32Array, uv: Float32Array, n: number) {
  const moved = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const u = uv[j * 2];
    const v = 1 - uv[j * 2 + 1]; // image space
    if (u < 0.3 || u > 0.7 || pos[j * 3 + 2] < 0.045) continue;
    const e = u < 0.5 ? EYES[0] : EYES[1];
    const du = (u - e.u) / 0.037;
    const h = 1 - du * du;
    const dv = v - SLIT_V;
    if (h <= 0 || dv < -0.034 || dv > 0.042) continue;
    const ht = Math.sqrt(h);
    const up = dv < 0 ? Math.pow(h, 0.75) * (1 - smooth(0.006, 0.032, -dv)) : 0;
    const lo = dv >= 0 ? ht * (1 - smooth(0.004, 0.04, dv)) : 0;
    const w = Math.max(up, lo);
    if (w <= 0) continue;
    const y = pos[j * 3 + 1] + up * 0.0058 - lo * 0.0014;
    let z = pos[j * 3 + 2];
    const dx = pos[j * 3] - e.x, dy = y - e.y;
    const r2 = EYE_R * EYE_R - dx * dx - dy * dy;
    if (r2 > 0) {
      const sz = EYE_Z + Math.sqrt(r2);
      // Inner lid / slit surface goes behind the ball; outer skin rests on it.
      z = Math.abs(dv) < 0.0035 ? Math.min(z, sz - 0.0025) : Math.max(z, sz + 0.0007);
    }
    pos[j * 3 + 1] = y;
    pos[j * 3 + 2] = z;
    moved[j] = w;
  }
  return moved;
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

/** Bone-structure deformation of the shared scan (head space, metres) and beard volume. */
const VERT_HEAD = /* glsl */ `
uniform vec4 uShapeA;
uniform vec4 uShapeB;
uniform float uBeardVol;
uniform float uBeardStyle;
float hmG( float d, float s ) { return exp( - d * d / ( 2.0 * s * s ) ); }
vec3 hmDeform( vec3 p ) {
	vec3 q = p;
	float dx = p.x + 0.0035;
	// jaw width
	float wJ = hmG( p.y - 0.062, 0.026 ) * smoothstep( -0.035, 0.035, p.z );
	q.x += dx * 0.14 * uShapeA.x * wJ;
	// chin projection
	float wCh = hmG( length( vec3( dx * 1.2, p.y - 0.05, p.z - 0.085 ) ), 0.022 );
	q.z += 0.007 * uShapeA.y * wCh;
	q.y -= 0.004 * uShapeA.y * wCh;
	// nose: length / projection and width
	float wN = hmG( length( vec3( dx * 1.3, p.y - 0.112, p.z - 0.1 ) ), 0.016 ) * smoothstep( 0.07, 0.09, p.z );
	q.y += ( p.y - 0.128 ) * 0.14 * uShapeA.z * wN;
	q.z += ( p.z - 0.085 ) * 0.3 * uShapeA.z * wN;
	q.x += dx * 0.28 * uShapeA.w * wN;
	// brow ridge
	float wB = hmG( p.y - 0.157, 0.011 ) * smoothstep( 0.06, 0.085, p.z ) * hmG( dx, 0.038 );
	q.z += 0.0045 * uShapeB.x * wB;
	// cheekbones
	float wC = hmG( p.y - 0.124, 0.018 ) * smoothstep( 0.0, 0.05, p.z ) * smoothstep( 0.025, 0.055, abs( dx ) );
	q.x += dx * 0.08 * uShapeB.y * wC;
	q.z += 0.0025 * uShapeB.y * wC;
	// lower face length (below the eyes, fading out into the neck)
	float wL = smoothstep( 0.01, 0.06, p.y ) * ( 1.0 - smoothstep( 0.122, 0.134, p.y ) ) * smoothstep( -0.03, 0.04, p.z );
	q.y += ( p.y - 0.13 ) * 0.075 * uShapeB.z * wL;
	// cheek fullness
	float wF = hmG( p.y - 0.09, 0.02 ) * smoothstep( 0.01, 0.06, p.z ) * smoothstep( 0.015, 0.045, abs( dx ) );
	q.x += sign( dx ) * 0.0035 * uShapeB.w * wF;
	q.z += 0.0015 * uShapeB.w * wF;
	return q;
}
float hmBeardVol( vec2 uv ) {
	if ( uv.x > 1.5 ) return 0.0;
	vec2 f = vec2( uv.x, 1.0 - uv.y );
	vec2 d = ( f - vec2( 0.5, 0.585 ) ) / vec2( 0.17, 0.2 );
	float r = 1.0 - smoothstep( 0.5, 1.0, dot( d, d ) );
	r *= smoothstep( 0.42, 0.5, f.y + ( 0.17 - min( abs( f.x - 0.5 ), 0.17 ) ) * 0.22 );
	r *= 1.0 - smoothstep( 0.72, 0.8, f.y );
	r *= 1.0 - uBeardStyle * smoothstep( 0.05, 0.075, abs( f.x - 0.5 ) );
	return r;
}
`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uTone;
uniform float uBeard;
uniform float uHair;
uniform float uBrim;
uniform float uCover;
uniform vec3 uIris;
uniform sampler2D uSpec;
uniform vec3 uHairCol;
uniform float uGrey;
uniform float uBeardStyle;
uniform float uAge;
uniform vec4 uScar;
uniform float uGrime;
uniform float uSweat;
uniform float uBrow;
float hmSssAmt = 1.0;
float hmSheen = 0.0;
float hmH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float hmEll( vec2 p, vec2 c, vec2 r ) { vec2 d = ( p - c ) / r; return dot( d, d ); }
float hmN( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hmH( i ), hmH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hmH( i + vec2( 0.0, 1.0 ) ), hmH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float hmFbm( vec2 p ) { return 0.5 * hmN( p ) + 0.3 * hmN( p * 2.3 + 1.7 ) + 0.2 * hmN( p * 5.1 + 3.1 ); }
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
float hmFull = clamp( uBeard - 2.0, 0.0, 1.0 );
bReg *= 1.0 - mix( smoothstep( 0.64, 0.72, fuv.y ) * 0.9, smoothstep( 0.66, 0.75, fuv.y ), hmFull );
bReg *= 1.0 - uBeardStyle * smoothstep( 0.05, 0.075, dxm );
float lips = 1.0 - smoothstep( 0.6, 1.0, hmEll( fuv, vec2( 0.4985, 0.467 ), vec2( 0.065, 0.024 ) ) );
bReg *= 1.0 - lips;
// clean shave (uBeard 0) -> scan's own stubble (1) -> short beard (2)
alb = mix( alb, bare * mix( vec3( 1.0 ), vec3( 0.88, 0.88, 0.93 ), 0.3 ), bReg * clamp( 1.0 - uBeard, 0.0, 1.0 ) * 0.85 );
// Strands: elongated cells running down the face, some grey.
float strand = hmH( floor( fuv * vec2( 1400.0, 240.0 ) ) );
vec3 hairC = max( uHairCol, vec3( 0.012, 0.008, 0.006 ) ) * ( 0.55 + 0.9 * hairN2 ) * ( 0.6 + 0.9 * strand );
hairC = mix( hairC, vec3( 0.36, 0.34, 0.32 ) * ( 0.7 + 0.5 * strand ), step( 1.0 - uGrey, hmH( floor( fuv * vec2( 1400.0, 240.0 ) ) + 11.0 ) ) );
float dens = bReg * clamp( uBeard - 1.0, 0.0, 1.0 );
float hmBeardCov = clamp( dens * 0.6 + step( hairN, dens * 1.1 - 0.15 ) * 0.3, 0.0, 0.9 );
// Full beard: ragged, thinning edge on the cheeks and neck instead of a painted outline.
float hmRag = clamp( ( bReg - 0.55 + ( hmFbm( fuv * vec2( 90.0, 36.0 ) ) - 0.5 ) * 0.7 ) * 2.6 + 0.5, 0.0, 1.0 );
hmBeardCov = mix( hmBeardCov, max( hmRag * ( 0.72 + 0.22 * strand ), step( hairN, hmRag * 1.6 ) * bReg * 0.8 ), hmFull );
// Skin under a full beard is shadowed by it; lips lose some colour against the moustache.
alb *= 1.0 - 0.45 * hmRag * hmFull;
alb = mix( alb, vec3( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vec3( 1.05, 0.95, 0.92 ), lips * 0.35 * clamp( uBeard - 1.0, 0.0, 1.0 ) );
alb *= 1.0 - lips * 0.15 * clamp( uBeard - 1.0, 0.0, 1.0 );
// Clumps and long downward streaks, visible at close range.
float hmStreak = hmFbm( vec2( fuv.x * 420.0, fuv.y * 38.0 ) );
float hmClump = hmFbm( fuv * vec2( 70.0, 24.0 ) );
alb = mix( alb, hairC * mix( 1.0, ( 0.35 + 1.3 * hmStreak * hmStreak ) * ( 0.7 + 0.6 * hmClump ), hmFull ), hmBeardCov );
// The scan is washed-out grey round the back of the head and neck: pull it towards the cheek tone.
float backN = smoothstep( 0.3, 0.44, length( ( fuv - vec2( 0.5, 0.42 ) ) * vec2( 1.0, 0.85 ) ) );
alb = mix( alb, bare * vec3( 0.93, 0.9, 0.9 ), backN * 0.75 );
// Scalp: hairline over the forehead, temples, above the ears, nape.
float hl = 0.115 + smoothstep( 0.11, 0.22, dxm ) * 0.19 + smoothstep( 0.32, 0.46, dxm ) * 0.26;
float scalp = 1.0 - smoothstep( hl - 0.012, hl + 0.012, fuv.y );
alb = mix( alb, mix( alb * 0.8, hairC, 0.35 + 0.5 * hairN ), scalp * uHair );
// Re-tint to the soldier's skin tone.
alb *= uTone;
alb = mix( vec3( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), alb, 0.86 );
// Redness on nose, cheeks and ears; faint blue-grey under the eyes.
float hmRed = ( 1.0 - smoothstep( 0.4, 1.0, hmEll( fuv, vec2( 0.5, 0.39 ), vec2( 0.045, 0.06 ) ) ) )
	+ ( 1.0 - smoothstep( 0.3, 1.0, hmEll( vec2( dxm, fuv.y ), vec2( 0.1, 0.38 ), vec2( 0.06, 0.05 ) ) ) ) * 0.7;
alb *= mix( vec3( 1.0 ), vec3( 1.07, 0.93, 0.92 ), clamp( hmRed, 0.0, 1.0 ) * ( 1.0 - uCover * 0.5 ) );
float hmUnder = ( 1.0 - smoothstep( 0.3, 1.0, hmEll( vec2( dxm, fuv.y ), vec2( 0.072, 0.322 ), vec2( 0.035, 0.014 ) ) ) );
alb *= mix( vec3( 1.0 ), vec3( 0.9, 0.88, 0.93 ), hmUnder );
// Eyebrows in the soldier's hair colour.
float hmBrowM = ( 1.0 - smoothstep( 0.4, 1.0, hmEll( vec2( dxm, fuv.y + ( dxm - 0.072 ) * 0.18 ), vec2( 0.074, 0.262 ), vec2( 0.042, 0.0095 ) ) ) );
alb = mix( alb, hairC * 0.8, hmBrowM * uBrow * ( 0.35 + 0.5 * step( 0.45, strand ) ) * ( 1.0 - uCover * 0.5 ) );
// Age: deeper smile lines and shadowed creases, a little less saturated.
float hmFold = ( 1.0 - smoothstep( 0.0, 0.006, abs( dxm - mix( 0.038, 0.062, smoothstep( 0.39, 0.47, fuv.y ) ) ) ) ) * smoothstep( 0.37, 0.4, fuv.y ) * ( 1.0 - smoothstep( 0.47, 0.5, fuv.y ) );
alb *= 1.0 - hmFold * ( 0.15 + 0.25 * uAge );
alb = mix( alb, vec3( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uAge * 0.12 );
// Grime: dirt and dust in patches, heavier towards the edges of the face and hairline.
float hmDirt = smoothstep( 0.42, 0.78, hmFbm( fuv * 13.0 + uScar.xy * 7.0 ) + smoothstep( 0.12, 0.22, dxm ) * 0.18 + ( 1.0 - smoothstep( 0.12, 0.2, fuv.y ) ) * 0.2 ) * uGrime;
alb *= mix( vec3( 1.0 ), vec3( 0.6, 0.55, 0.48 ), hmDirt * 0.8 );
// A cut (fresh: dark red with a bruised, swollen halo) or an old pale scar.
vec2 hmSd = fuv - uScar.xy;
vec2 hmSa = vec2( cos( uScar.z ), sin( uScar.z ) );
float hmAlong = dot( hmSd, hmSa );
float hmAcross = dot( hmSd, vec2( - hmSa.y, hmSa.x ) );
float hmLen = 0.012;
float hmCutW = 0.0011 * ( 1.0 - smoothstep( hmLen * 0.4, hmLen, abs( hmAlong ) ) );
float hmCut = ( 1.0 - smoothstep( hmCutW * 0.4, hmCutW + 0.0004, abs( hmAcross + sin( hmAlong * 700.0 ) * 0.0003 ) ) ) * step( 0.5, uScar.w );
float hmHalo = ( 1.0 - smoothstep( 0.0, 1.0, length( vec2( hmAlong / ( hmLen * 1.4 ), hmAcross / 0.008 ) ) ) ) * step( 0.5, uScar.w );
float hmFresh = step( 0.5, uScar.w ) * step( uScar.w, 1.5 );
alb = mix( alb, alb * vec3( 1.12, 0.82, 0.8 ) * mix( 1.0, 0.82, hmFresh ), hmHalo * mix( 0.25, 0.85, hmFresh ) );
alb = mix( alb, mix( alb * vec3( 1.25, 1.15, 1.12 ) + 0.02, vec3( 0.16, 0.018, 0.014 ), hmFresh ), hmCut );
// Occlusion under a helmet / cap brim: brow, eye sockets, temples.
float under = ( 1.0 - smoothstep( 0.2, 0.36, fuv.y ) ) * ( 1.0 - smoothstep( 0.2, 0.34, dxm ) );
alb *= 1.0 - uBrim * under * 0.4;
// Lid margins (the lids were opened in the geometry): wet pink rim inside, lash lines on the edges.
float lidU = ( fuv.x - ( fuv.x < 0.5 ? 0.4284 : 0.5716 ) ) / 0.037;
float lidH = clamp( 1.0 - lidU * lidU, 0.0, 1.0 );
float rim = lidH * ( 1.0 - smoothstep( 0.0025, 0.0045, abs( fuv.y - 0.2965 ) ) );
alb = mix( alb, vec3( 0.32, 0.1, 0.085 ), rim * 0.7 );
float lashUp = lidH * smoothstep( 0.282, 0.2875, fuv.y ) * ( 1.0 - smoothstep( 0.2925, 0.295, fuv.y ) );
float lashLo = lidH * smoothstep( 0.2985, 0.3, fuv.y ) * ( 1.0 - smoothstep( 0.302, 0.305, fuv.y ) );
alb = mix( alb, vec3( 0.018, 0.013, 0.01 ), clamp( lashUp * 0.9 + lashLo * 0.45, 0.0, 1.0 ) );
// Eyeballs (off-atlas UVs): sclera, fibrous iris with a dark limbal ring, pupil.
float eye = step( 1.5, vMapUv.x );
float eSide = step( 3.5, vMapUv.x );
vec2 ep = vec2( ( vMapUv.x - 2.5 - 2.0 * eSide ) * 2.0, ( vMapUv.y - 0.5 ) * 2.0 );
float medial = mix( ep.x, -ep.x, eSide );
float er = length( ep );
float ang = atan( ep.y, ep.x );
vec3 scl = vec3( 0.27, 0.225, 0.2 ) * ( 1.0 - 0.65 * smoothstep( 0.35, 0.9, er ) );
scl = mix( scl, vec3( 0.42, 0.2, 0.17 ), smoothstep( 0.6, 0.92, medial ) * 0.8 ); // caruncle at the inner corner
scl = mix( scl, vec3( 0.55, 0.22, 0.18 ), 0.25 * smoothstep( 0.6, 0.95, er ) * hmH( floor( vec2( ang * 9.0, er * 6.0 ) ) ) );
float fib = 0.65 + 0.5 * hmH( vec2( floor( ang * 38.0 ), 3.0 ) ) * ( 0.6 + 0.4 * hmH( floor( vec2( ang * 76.0, er * 22.0 ) ) ) );
vec3 iris = uIris * fib * ( 0.75 + 0.6 * smoothstep( 0.3, 0.17, er ) ); // brighter collarette round the pupil
iris *= 1.0 - 0.75 * smoothstep( 0.36, 0.47, er ); // limbal ring
vec3 eyeC = mix( scl, iris, 1.0 - smoothstep( 0.46, 0.5, er ) );
eyeC = mix( eyeC, vec3( 0.004 ), 1.0 - smoothstep( 0.15, 0.18, er ) );
eyeC *= 1.0 - 0.72 * smoothstep( -0.15, 0.5, ep.y ); // upper-lid shadow (lashes + brow)
eyeC *= 1.0 - uBrim * 0.35;
alb = mix( alb, eyeC, eye );
// Face covering: knit balaclava with an eye slot, or camo face paint.
float slot = 1.0 - smoothstep( 0.8, 1.0, hmEll( fuv, vec2( 0.5, 0.297 ), vec2( 0.115, 0.036 ) ) );
float knit = 0.75 + 0.35 * hmH( floor( fuv * vec2( 300.0, 600.0 ) ) ) + 0.15 * sin( fuv.y * 1600.0 );
float bala = step( 0.5, uCover ) * step( uCover, 1.5 ) * ( 1.0 - slot ) * ( 1.0 - eye );
alb = mix( alb, vec3( 0.022, 0.021, 0.02 ) * knit, bala );
float face = ( 1.0 - smoothstep( 0.2, 0.28, dxm ) ) * smoothstep( 0.12, 0.16, fuv.y ) * ( 1.0 - smoothstep( 0.6, 0.66, fuv.y ) ) * ( 1.0 - eye );
float stripe = step( 0.5, fract( ( fuv.x * 0.8 + fuv.y ) * 7.0 + ( hairN2 - 0.5 ) * 0.25 ) );
vec3 paintC = mix( vec3( 0.045, 0.06, 0.03 ), vec3( 0.09, 0.07, 0.04 ), stripe );
alb = mix( alb, paintC, step( 1.5, uCover ) * face * 0.85 );
diffuseColor.rgb = alb;
hmSssAmt = ( 1.0 - bala ) * ( 1.0 - step( 1.5, uCover ) * face * 0.6 ) * ( 1.0 - eye );
float hmEye = eye;
float hmCornea = eye * ( 1.0 - smoothstep( 0.48, 0.52, er ) );
float hmCloth = bala;
`;

const FRAG_ROUGH = /* glsl */ `
float specI = texture2D( uSpec, vMapUv ).g;
roughnessFactor = mix( 0.7, 0.42, specI );
// Sweat sheen on the forehead, nose and upper cheeks, with beads.
float hmSheen = ( 1.0 - smoothstep( 0.1, 0.2, dxm ) ) * smoothstep( 0.1, 0.16, fuv.y ) * ( 1.0 - smoothstep( 0.42, 0.5, fuv.y ) );
hmSheen = max( hmSheen, ( 1.0 - smoothstep( 0.0, 0.05, dxm ) ) * ( 1.0 - smoothstep( 0.42, 0.46, fuv.y ) ) );
vec2 hmBc = fuv * 150.0;
vec2 hmBo = fract( hmBc ) - 0.5 + ( vec2( hmH( floor( hmBc ) + 1.3 ), hmH( floor( hmBc ) + 5.1 ) ) - 0.5 ) * 0.5;
float hmBead = step( 0.9, hmH( floor( hmBc ) + 2.9 ) ) * ( 1.0 - smoothstep( 0.12, 0.2, length( hmBo ) ) ) * hmSheen * uSweat * ( 1.0 - hmEye ) * ( 1.0 - hmCloth );
roughnessFactor = mix( roughnessFactor, 0.3, hmSheen * uSweat * ( 0.55 + 0.45 * hmFbm( fuv * 20.0 ) ) * ( 1.0 - hmBeardCov ) );
roughnessFactor = mix( roughnessFactor, 0.12, hmBead );
roughnessFactor = mix( roughnessFactor, 0.8, max( hmBeardCov * 0.8 * ( 1.0 - hmFull ), hmDirt * 0.6 ) );
roughnessFactor = mix( roughnessFactor, 0.5 + 0.25 * ( 1.0 - hmStreak ), hmBeardCov * hmFull );
roughnessFactor = mix( roughnessFactor, 0.25, hmCut * hmFresh );
roughnessFactor = mix( roughnessFactor, mix( 0.45, 0.05, hmCornea ), hmEye );
roughnessFactor = mix( roughnessFactor, 1.0, hmCloth );
`;

// Runs inside normal_fragment_maps (mapN: tangent-space normal, +y = up the image... v flipped, so image-up is -y).
const FRAG_NORMAL = /* glsl */ `
float hmSkinN = ( 1.0 - hmEye ) * ( 1.0 - hmCloth );
float hmFine = 1.0 - smoothstep( 0.5, 1.5, length( fwidth( vMapUv * 1900.0 ) ) );
mapN.xy += ( vec2( hmH( floor( vMapUv * 1900.0 ) ), hmH( floor( vMapUv * 1900.0 ) + 3.7 ) ) - 0.5 ) * 0.22 * hmSkinN * hmFine;
// Forehead lines and crow's feet, deeper with age.
float hmFh = ( 1.0 - smoothstep( 0.1, 0.14, dxm ) ) * smoothstep( 0.13, 0.16, fuv.y ) * ( 1.0 - smoothstep( 0.215, 0.24, fuv.y ) );
float hmWave = fuv.y * 190.0 + hmN( vec2( fuv.x * 18.0, 2.0 ) ) * 3.0;
mapN.y += cos( hmWave ) * 0.32 * hmFh * ( 0.25 + uAge ) * hmSkinN;
vec2 hmCf = vec2( dxm - 0.118, fuv.y - 0.298 );
float hmCrow = ( 1.0 - smoothstep( 0.008, 0.026, length( hmCf ) ) ) * smoothstep( 0.0, 0.006, hmCf.x + 0.004 );
mapN.xy += vec2( 0.0, sin( atan( hmCf.y, abs( hmCf.x ) ) * 14.0 ) ) * 0.28 * hmCrow * uAge * hmSkinN;
mapN.x += ( fuv.x < 0.5 ? 1.0 : -1.0 ) * hmFold * 0.35 * hmSkinN;
// Beard strands.
mapN.x += ( ( strand - 0.5 ) * 0.6 + ( hmStreak - 0.5 ) * 1.6 ) * hmBeardCov * hmFull;
mapN.y += ( hmClump - 0.5 ) * 0.8 * hmBeardCov * hmFull;
// Sweat beads (domes) and the raised edge of a cut / scar.
mapN.xy += hmBo * vec2( 1.0, -1.0 ) * 3.0 * hmBead;
mapN.xy += vec2( - hmSa.y, hmSa.x ) * vec2( 1.0, -1.0 ) * sign( hmAcross ) * 0.6 * ( hmHalo * 0.4 + hmCut ) * step( 0.5, uScar.w ) * hmSkinN;
`;

/** Material for one face look. Cached; every face material shares one program. */
export function faceMaterial(look: FaceLook) {
  const key = `${look.id}|${look.tone}|${look.beard}|${look.hair}|${look.cover}|${look.iris}|${look.brim}`;
  let m = materials.get(key);
  if (m) return m;
  const mp = loadMaps();
  m = new THREE.MeshStandardMaterial({ map: mp.col, normalMap: mp.nrm, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, metalness: 0 });
  const ratio = new THREE.Color(look.tone);
  ratio.r /= REF.r;
  ratio.g /= REF.g;
  ratio.b /= REF.b;
  const cover = look.cover === "balaclava" ? 1 : look.cover === "paint" ? 2 : 0;
  const id = faceIdentity(look.id);
  // Dark skin tones get dark hair.
  const hair = new THREE.Color(id.hairCol);
  const toneL = new THREE.Color(look.tone).getHSL({ h: 0, s: 0, l: 0 }).l;
  if (toneL < 0.5) hair.lerp(new THREE.Color(0x2a1c12), 0.6);
  const beardVol = look.cover === "balaclava" ? 0 : look.beard >= 3 ? 0.0045 : look.beard >= 2 ? 0.0018 : 0;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShapeA = { value: new THREE.Vector4(...id.shapeA) };
    shader.uniforms.uShapeB = { value: new THREE.Vector4(...id.shapeB) };
    shader.uniforms.uBeardVol = { value: beardVol };
    shader.uniforms.uBeardStyle = { value: id.beardStyle };
    shader.uniforms.uHairCol = { value: hair };
    shader.uniforms.uGrey = { value: id.grey };
    shader.uniforms.uAge = { value: id.age };
    shader.uniforms.uScar = { value: new THREE.Vector4(...id.scar) };
    shader.uniforms.uGrime = { value: id.grime };
    shader.uniforms.uSweat = { value: id.sweat };
    shader.uniforms.uBrow = { value: id.brow };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
{
	const float e = 0.0015;
	vec3 p0 = hmDeform( position );
	mat3 J = mat3( ( hmDeform( position + vec3( e, 0.0, 0.0 ) ) - p0 ) / e, ( hmDeform( position + vec3( 0.0, e, 0.0 ) ) - p0 ) / e, ( hmDeform( position + vec3( 0.0, 0.0, e ) ) - p0 ) / e );
	objectNormal = normalize( transpose( inverse( J ) ) * objectNormal );
}`,
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = hmDeform( position ) + normal * uBeardVol * hmBeardVol( uv );");
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
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * ( 1.0 - hmEye ) * ( 1.0 - hmCloth * 0.6 );\n" + FRAG_NORMAL));
  };
  m.customProgramCacheKey = () => "iron-horizon-face-v6";
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
