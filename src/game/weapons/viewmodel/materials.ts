import * as THREE from "three";
import { LAYER, type LayerName, detailArray, disposeDetailArray } from "./textures";

/**
 * Viewmodel surfaces.
 *
 * Every gun, hand and sleeve renders with just THREE shared materials:
 *   uber  — opaque PBR; albedo / metalness / roughness / wear / detail layer
 *           come from vertex attributes, detail normals from a texture array
 *   glass — optic glass with tint, fresnel reflection and coated lenses
 *   glow  — additive, un-tonemapped emitters (reticles, tritium, lume)
 *
 * A `Surf` is a lightweight descriptor the geometry builder bakes into the
 * vertex attributes, so any number of "materials" cost one draw call per
 * moving part.
 */
export type RenderKind = "uber" | "glass" | "glow";

export type Surf = {
  readonly render: RenderKind;
  /** Linear albedo (or tint / emissive colour). */
  readonly color: THREE.Color;
  readonly metal: number;
  readonly rough: number;
  /**
   * Edge wear on chamfers. > 0: paint / anodising wears through to bright
   * metal. < 0: polymer scuffing (lighter, rougher). Also scales scratches.
   */
  readonly wear: number;
  /** Detail-normal strength. */
  readonly nScale: number;
  readonly layer: number;
  /** Operator tint slot (-1 none, 0 glove, 1 sleeve): colour multiplies the slot colour. */
  readonly tint: number;
  /** Glass opacity at normal incidence. */
  readonly alpha: number;
};

type SurfOpts = { metal?: number; rough?: number; wear?: number; n?: number; layer?: LayerName; tint?: number; alpha?: number };

function surf(render: RenderKind, color: THREE.ColorRepresentation | THREE.Color, o: SurfOpts = {}): Surf {
  return {
    render,
    color: color instanceof THREE.Color ? color : new THREE.Color(color),
    metal: o.metal ?? 0,
    rough: o.rough ?? 0.6,
    wear: o.wear ?? 0,
    nScale: o.n ?? 0.5,
    layer: LAYER[o.layer ?? "metal"],
    tint: o.tint ?? -1,
    alpha: o.alpha ?? 1,
  };
}

const hdr = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export type ViewmodelMaterials = ReturnType<typeof createViewmodelMaterials>;

export function createViewmodelMaterials() {
  const tex = detailArray();
  const tints = [new THREE.Color(0x2b2a26), new THREE.Color(0x4d5240)];
  const uber = createUber(tex, tints);
  const glass = createGlass();
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const render: Record<RenderKind, THREE.Material> = { uber, glass, glow };

  const u = (c: THREE.ColorRepresentation, o: SurfOpts) => surf("uber", c, o);

  const surfs = {
    // Metals ------------------------------------------------------------
    /** Hard-anodised aluminium receivers: dark satin, edges wear to bright alloy. */
    anodized: u(0x1f2023, { metal: 0.55, rough: 0.42, wear: 1, n: 0.35 }),
    /** Parkerised / phosphate steel: grey, very matte, light edge polish. */
    steel: u(0x2e2f30, { metal: 0.7, rough: 0.55, wear: 0.7, n: 0.45 }),
    /** Nitrided barrel steel, a little glossier. */
    blued: u(0x1e2024, { metal: 0.85, rough: 0.34, wear: 0.55, n: 0.3 }),
    /** Bright machined steel (bolt carrier, extractor, cylinder face). */
    bright: u(0x9a9c9e, { metal: 1, rough: 0.24, wear: 0.15, n: 0.25 }),
    stainless: u(0x7a7d80, { metal: 1, rough: 0.3, wear: 0.2, n: 0.35 }),
    /** Tan cerakote over metal (marksman rifle). */
    cerakoteTan: u(0x8a7656, { metal: 0.1, rough: 0.62, wear: 0.9, n: 0.35 }),
    /** Flat dark-earth / OD cerakote (suppressor, scope). */
    cerakoteDark: u(0x34302a, { metal: 0.15, rough: 0.68, wear: 0.8, n: 0.35 }),
    brass: u(0xc79c4e, { metal: 1, rough: 0.26, wear: 0.2, n: 0.2 }),
    copper: u(0xb46a3c, { metal: 1, rough: 0.3, n: 0.2 }),
    /** Knurled control surfaces (turrets, knobs, caps). */
    knurled: u(0x1f2023, { metal: 0.6, rough: 0.45, wear: 0.7, n: 0.9, layer: "knurl" }),

    // Polymers / rubber --------------------------------------------------
    polymer: u(0x1d1e1e, { rough: 0.7, wear: -0.7, n: 0.55, layer: "polymer" }),
    polymerTan: u(0x7f6b4d, { rough: 0.74, wear: -0.5, n: 0.55, layer: "polymer" }),
    polymerOlive: u(0x434832, { rough: 0.76, wear: -0.5, n: 0.55, layer: "polymer" }),
    polymerGray: u(0x323436, { rough: 0.7, wear: -0.6, n: 0.55, layer: "polymer" }),
    /** Stippled grip panels. */
    grip: u(0x19191a, { rough: 0.84, wear: -0.5, n: 1, layer: "stipple" }),
    gripTan: u(0x7a6748, { rough: 0.84, wear: -0.4, n: 1, layer: "stipple" }),
    rubber: u(0x121212, { rough: 0.9, wear: -0.3, n: 0.6, layer: "rubber" }),
    /** Olive webbing / canvas (LMG pouch, slings, suppressor cover). */
    canvas: u(0x474a33, { rough: 0.95, n: 1, layer: "fabric" }),
    shellHull: u(0x86201a, { metal: 0.05, rough: 0.45, n: 0.2, layer: "polymer" }),
    cord: u(0x2a2924, { rough: 0.9, n: 1, layer: "knurl" }),
    /** White / tan paint fills for (text-free) selector markings. */
    paint: u(0xb8b2a0, { rough: 0.6, n: 0.2, layer: "polymer" }),
    paintRed: u(0x8a1c14, { rough: 0.55, n: 0.2, layer: "polymer" }),

    // Optics -------------------------------------------------------------
    /** Clear sight glass with a faint blue-green coating. */
    lens: surf("glass", 0x9fd0d8, { metal: 1, rough: 0.03, alpha: 0.08 }),
    /** Reflex window: faint amber-pink coating seen from the shooter's side. */
    lensReflex: surf("glass", 0xd8a8a0, { metal: 1, rough: 0.03, alpha: 0.06 }),
    /** Coated objective / ocular: deep, dark, strongly coloured reflections. */
    lensCoated: surf("glass", 0x6b4fb0, { metal: 1, rough: 0.05, alpha: 0.78 }),
    lensCoatedAmber: surf("glass", 0xb0702c, { metal: 1, rough: 0.05, alpha: 0.75 }),
    /** Dark interior of a scope tube (seen through the lens). */
    tubeInterior: u(0x050505, { rough: 0.9, n: 0, layer: "rubber" }),
    reticleRed: surf("glow", hdr(6, 0.28, 0.16)),
    reticleAmber: surf("glow", hdr(5, 1.8, 0.2)),
    tritium: surf("glow", hdr(0.9, 3.4, 0.7)),
    tritiumOrange: surf("glow", hdr(3.4, 1.2, 0.2)),
    lume: surf("glow", hdr(0.5, 1.4, 0.45)),

    // Arms -----------------------------------------------------------------
    glove: u(0xffffff, { rough: 0.8, wear: -0.25, n: 0.75, layer: "glove", tint: 0 }),
    /** Moulded knuckle armour + synthetic suede palm (darker shade of the glove). */
    gloveAccent: u(new THREE.Color(0xffffff).multiplyScalar(0.55), { rough: 0.62, wear: -0.4, n: 0.6, layer: "polymer", tint: 0 }),
    /** Glove stitching / seam tape. */
    gloveSeam: u(new THREE.Color(0xffffff).multiplyScalar(0.4), { rough: 0.85, n: 1, layer: "fabric", tint: 0 }),
    sleeve: u(0xffffff, { rough: 0.95, n: 1, layer: "fabric", tint: 1 }),
    sleeveDark: u(new THREE.Color(0xffffff).multiplyScalar(0.62), { rough: 0.95, n: 1, layer: "fabric", tint: 1 }),
    watchCase: u(0x1a1b1c, { rough: 0.5, wear: -0.6, n: 0.4, layer: "polymer" }),
    watchFace: u(0x070809, { metal: 0.3, rough: 0.08, n: 0 }),

    // Knife ---------------------------------------------------------------
    blade: u(0x9da2a6, { metal: 1, rough: 0.2, wear: 0.1, n: 0.15 }),
    bladeCoat: u(0x202122, { metal: 0.5, rough: 0.55, wear: 1, n: 0.3 }),
  };

  return {
    ...surfs,
    render,
    /** Operator glove / sleeve colours. */
    tints,
    dispose() {
      uber.dispose();
      glass.dispose();
      glow.dispose();
      disposeDetailArray();
    },
  };
}

// ---- Shaders ------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float vmHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vmHash(i), vmHash(i + vec3(1, 0, 0)), f.x), mix(vmHash(i + vec3(0, 1, 0)), vmHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vmHash(i + vec3(0, 0, 1)), vmHash(i + vec3(1, 0, 1)), f.x), mix(vmHash(i + vec3(0, 1, 1)), vmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/**
 * Opaque PBR material driven by vertex attributes:
 *   color — albedo (linear)        pbr  — metal, rough, signed edge wear, normal scale
 *   uv    — box-projected (m)      surf — detail layer, tint slot
 */
function createUber(tex: THREE.DataArrayTexture, tints: THREE.Color[]) {
  // A 1×1 normal map switches on three's tangent-frame code path; the actual
  // detail sample is swapped for the texture array below.
  const dummy = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  dummy.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: dummy, roughness: 1, metalness: 1 });
  mat.name = "viewmodel-uber";
  const uniforms = { vmDetail: { value: tex }, vmTints: { value: tints } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 pbr;
attribute vec2 surf;
varying vec4 vPbr;
varying vec2 vSurf;
varying vec3 vObjPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vPbr = pbr;
vSurf = surf;
vObjPos = position;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray vmDetail;
uniform vec3 vmTints[2];
varying vec4 vPbr;
varying vec2 vSurf;
varying vec3 vObjPos;
${NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec4 vmDet = texture(vmDetail, vec3(vNormalMapUv, vSurf.x));
if (vSurf.y > 0.5) diffuseColor.rgb *= vmTints[int(vSurf.y - 0.5)];
// Wear: chamfer flag x per-surface amount, broken up by noise; scratches add.
float vmSigned = vPbr.z;
float vmAmt = abs(vmSigned);
float vmN = vmNoise(vObjPos * 260.0) * 0.6 + vmNoise(vObjPos * 70.0) * 0.4;
float vmEdge = smoothstep(0.5, 0.78, vmAmt * vmN * 1.15) * smoothstep(0.0, 0.15, vmAmt);
float vmScratch = vmDet.b * smoothstep(0.3, 0.7, vmNoise(vObjPos * 18.0 + 3.1)) * 0.85;
float vmWear = clamp(max(vmEdge, vmScratch * step(0.01, vmAmt)), 0.0, 1.0);
bool vmMetalWear = vmSigned > 0.0 || (vmAmt < 0.01 && vPbr.x > 0.5);
// Grime: low-frequency dirt that collects away from edges.
float vmGrime = smoothstep(0.45, 0.85, vmNoise(vObjPos * 22.0 + 7.3)) * (1.0 - vmEdge);
vec3 vmBare = vec3(0.36, 0.36, 0.35);
if (vmSigned > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vmBare, vmWear);
else if (vmSigned < 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + 0.025, vmWear * 0.7);
diffuseColor.rgb *= 1.0 - vmGrime * 0.22;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = clamp(vPbr.y + (vmDet.a - 0.5) * 0.55 + vmGrime * 0.12, 0.05, 1.0);
if (vmSigned > 0.0) roughnessFactor = mix(roughnessFactor, 0.3, vmWear);
else if (vmSigned < 0.0) roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.15), vmWear);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `float metalnessFactor = vPbr.x;
if (vmSigned > 0.0 && vmMetalWear) metalnessFactor = mix(metalnessFactor, 1.0, vmWear);`,
      )
      .replace(
        "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
        `vec3 mapN;
mapN.xy = (vmDet.rg * 2.0 - 1.0) * vPbr.w;
mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));`,
      );
  };
  mat.customProgramCacheKey = () => "viewmodel-uber-v1";
  const dispose = mat.dispose.bind(mat);
  mat.dispose = () => {
    dummy.dispose();
    dispose();
  };
  return mat;
}

/**
 * Optic glass: tint + metal-like reflection from the env map, opacity rising
 * toward grazing angles (fresnel). pbr.z carries the per-surface opacity.
 */
function createGlass() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 0.04, metalness: 1, side: THREE.FrontSide,
  });
  mat.name = "viewmodel-glass";
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 pbr;\nvarying vec4 vPbr;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPbr = pbr;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vPbr;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a = vPbr.z;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vPbr.y;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vPbr.x;")
      .replace(
        "#include <opaque_fragment>",
        `float vmFr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0);
diffuseColor.a = clamp(mix(diffuseColor.a, 0.55, vmFr) + dot(outgoingLight, vec3(0.3)) * 0.12, 0.0, 1.0);
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "viewmodel-glass-v1";
  return mat;
}
