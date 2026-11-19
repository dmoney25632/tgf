import * as THREE from "three";
import { camoTexture, disposeTextures, fabricNormalTexture, foldNormalTexture, strandTexture } from "./textures";

/**
 * Surface kinds, stored per vertex in aMat.x. The shared "uber" material
 * reads them, so a whole soldier (fabric, skin, nylon, metal and the rifle)
 * is one draw call.
 */
export const SURF = {
  hard: 0, // plastic, metal, rubber, glass: no weave
  nylon: 1, // plain woven gear
  woodland: 2, // camo styles (blob layers mixed from the base colour)
  digital: 3,
  arid: 4,
  skin: 5, // vertex colour is a multiplier on the material's skin tone
  tattoo: 6, // skin with line-work ink
  molle: 7, // nylon with PALS webbing rows
} as const;

const ubers = new Map<number, THREE.MeshStandardMaterial>();
let ghillie: THREE.MeshStandardMaterial | null = null;
let elite: THREE.MeshStandardMaterial | null = null;
let hitbox: THREE.MeshBasicMaterial | null = null;

/**
 * Subsurface approximation for skin, spliced into the physical direct-light
 * term: per-channel wrapped diffuse (red scatters furthest), so the
 * terminator softens and warms instead of cutting to black like plastic.
 * `hmSssAmt` is a fragment-global the material sets (0 = plain Lambert).
 */
export function sssLightsChunk() {
  return THREE.ShaderChunk.lights_physical_pars_fragment
    .replace(
      "vec3 irradiance = dotNL * directLight.color;",
      `vec3 irradiance = dotNL * directLight.color;
	vec3 hmW = vec3( 0.62, 0.3, 0.2 ) * hmSssAmt;
	vec3 hmSssIrr = clamp( ( dot( geometryNormal, directLight.direction ) + hmW ) / ( 1.0 + hmW ), 0.0, 1.0 ) * directLight.color;`,
    )
    .replace("reflectedLight.directDiffuse += irradiance * diffuseBRDF", "reflectedLight.directDiffuse += hmSssIrr * diffuseBRDF");
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aMat;
varying vec4 vMat;
flat varying float vSurf;
varying vec2 vCamoUv;
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D camoMap;
uniform sampler2D foldMap;
uniform vec3 uSkinTone;
varying vec4 vMat;
flat varying float vSurf;
varying vec2 vCamoUv;
float hmSssAmt = 0.0;
`;

const FRAG_COLOR = /* glsl */ `
float hmFab = vSurf;
vec4 hmCm = texture2D( camoMap, vCamoUv * 1.7 );
float hmFibre = hmCm.a - 0.5;
float hmCamo = step( 1.5, hmFab ) * step( hmFab, 4.5 );
float hmSkin = step( 4.5, hmFab ) * step( hmFab, 6.5 );
float hmMolle = step( 6.5, hmFab );
vec3 hmBase = diffuseColor.rgb;
vec3 hmDark = hmBase * vec3( 0.58, 0.6, 0.55 );
vec3 hmMid = hmBase * vec3( 0.84, 0.9, 0.76 );
vec3 hmLight = min( hmBase * vec3( 1.2, 1.16, 1.04 ), vec3( 1.0 ) );
float hmWood = 1.0 - step( 2.5, hmFab );
float hmDig = step( 2.5, hmFab ) * ( 1.0 - step( 3.5, hmFab ) );
float hmArid = step( 3.5, hmFab );
// woodland-style: mid blobs, dark blobs over
vec3 hmW = mix( mix( hmBase, hmMid, hmCm.g ), hmDark, hmCm.r * 0.9 );
// blocky: pixel patches in dark + light over mid base
vec3 hmD = mix( mix( hmMid, hmLight, hmCm.r ), hmDark, hmCm.b * 0.85 );
// arid: soft light washes and small brown blocks
vec3 hmA = mix( mix( hmBase, hmLight, hmCm.r * 0.55 ), hmMid * vec3( 1.0, 0.9, 0.82 ), hmCm.g * 0.7 );
hmA = mix( hmA, hmDark * 1.15, hmCm.b * hmCm.g * 0.6 );
vec3 hmC = hmW * hmWood + hmD * hmDig + hmA * hmArid;
diffuseColor.rgb = mix( hmBase, hmC, hmCamo );
// PALS webbing: 1" straps on a 2" pitch, bar-tacked every 1.5"
float hmRow = fract( vCamoUv.y / 0.0508 );
float hmStrap = smoothstep( 0.04, 0.1, hmRow ) * ( 1.0 - smoothstep( 0.46, 0.52, hmRow ) );
float hmTack = step( 0.9, fract( vCamoUv.x / 0.0381 ) ) * hmStrap;
diffuseColor.rgb *= mix( 1.0, mix( 0.6, 1.04 - hmTack * 0.22, hmStrap ), hmMolle );
// skin: tone x baked multiplier, faint blotching, optional ink line-work
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uSkinTone, hmSkin );
diffuseColor.rgb *= 1.0 + ( ( hmCm.g - 0.5 ) * 0.06 + hmFibre * 0.05 ) * hmSkin;
vec4 hmInk = texture2D( camoMap, vCamoUv * 4.0 + 0.31 );
float hmInkA = ( 1.0 - smoothstep( 0.06, 0.24, abs( hmInk.r - 0.5 ) ) ) + hmInk.b * hmInk.g * 0.7;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.04, 0.05 ), clamp( hmInkA, 0.0, 0.8 ) * step( 5.5, hmFab ) * step( hmFab, 6.5 ) );
// fibre grain on all fabric
float vFabN = step( 0.5, hmFab ) * ( 1.0 - hmSkin );
diffuseColor.rgb *= 1.0 + hmFibre * 0.16 * vFabN;
hmSssAmt = hmSkin;
`;

const FRAG_NORMAL = /* glsl */ `mapN.xy *= normalScale * vFabN;
	// low-frequency creases on cloth, raised edges on webbing straps
	vec3 hmFold = texture2D( foldMap, vCamoUv * 2.4 ).xyz * 2.0 - 1.0;
	mapN.xy += hmFold.xy * 0.75 * vFabN * ( 1.0 - hmMolle );
	mapN.y += ( ( 1.0 - smoothstep( 0.0, 0.08, hmRow ) ) * 0.5 - smoothstep( 0.44, 0.52, hmRow ) * ( 1.0 - smoothstep( 0.52, 0.6, hmRow ) ) * 0.5 ) * hmMolle;`;

/**
 * The shared soldier material, one per skin tone (all share one program):
 * per-vertex colour, surface kind, roughness, metalness, emissive.
 */
export function uberMaterial(skinTone = 0xb08a6a) {
  let m = ubers.get(skinTone);
  if (m) return m;
  const nrm = fabricNormalTexture();
  nrm.repeat.set(9, 9);
  m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const camo = camoTexture();
  const folds = foldNormalTexture();
  const tone = new THREE.Color(skinTone);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.camoMap = { value: camo };
    shader.uniforms.foldMap = { value: folds };
    shader.uniforms.uSkinTone = { value: tone };
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMat = aMat;\n\tvSurf = aMat.x;\n\tvCamoUv = uv;");
    shader.fragmentShader =
      FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <lights_physical_pars_fragment>", sssLightsChunk())
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_COLOR)
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n\troughnessFactor = clamp( vMat.y * ( 1.0 + hmFibre * 0.25 * vFabN ) + hmMolle * ( 1.0 - hmStrap ) * 0.1, 0.05, 1.0 );",
        )
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n\tmetalnessFactor = vMat.z;")
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", FRAG_NORMAL))
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += hmBase * vMat.w;");
  };
  m.customProgramCacheKey = () => "iron-horizon-soldier-v3";
  ubers.set(skinTone, m);
  return m;
}

/** Alpha-cut burlap cards (ghillie fringe). Tinted by vertex colour. */
export function ghillieMaterial() {
  if (ghillie) return ghillie;
  ghillie = new THREE.MeshStandardMaterial({
    map: strandTexture(),
    vertexColors: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  return ghillie;
}

const lenses = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Eyewear glass: tinted and see-through face-on, turning into a mirror at
 * grazing angles (Schlick fresnel drives both opacity and reflection).
 * "clear" is a light smoke that shows the eyes; "dark" is mirrored shades.
 */
export function lensMaterial(kind: "clear" | "dark") {
  let m = lenses.get(kind);
  if (m) return m;
  const dark = kind === "dark";
  m = new THREE.MeshStandardMaterial({
    color: dark ? 0x101214 : 0x4a4d50,
    roughness: 0.04,
    metalness: dark ? 0.6 : 0.1,
    transparent: true,
    opacity: dark ? 0.86 : 0.3,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      /* glsl */ `
      float lensF = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 4.0 );
      diffuseColor.a = mix( diffuseColor.a, 0.96, lensF );
      #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => "iron-horizon-lens";
  lenses.set(kind, m);
  return m;
}

export function eliteMaterial() {
  if (elite) return elite;
  elite = new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.6, metalness: 0, emissive: 0xff2a1c, emissiveIntensity: 0.9 });
  return elite;
}

/** Hit proxies are never drawn (visible = false) but need a material to raycast. */
export function hitboxMaterial() {
  if (hitbox) return hitbox;
  hitbox = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  return hitbox;
}

export function disposeMaterials() {
  ubers.forEach((m) => m.dispose());
  ubers.clear();
  lenses.forEach((m) => m.dispose());
  lenses.clear();
  ghillie?.dispose();
  elite?.dispose();
  hitbox?.dispose();
  ghillie = elite = hitbox = null;
  disposeTextures();
}
