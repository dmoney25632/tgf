import * as THREE from "three";
import { camoTexture, disposeTextures, fabricNormalTexture, strandTexture } from "./textures";

/**
 * Surface kinds, stored per vertex in aMat.x. The single shared "uber"
 * material reads them, so one soldier limb with fabric, skin, nylon and
 * metal is still one draw call.
 */
export const SURF = {
  hard: 0, // plastic, metal, rubber, glass: no weave
  nylon: 1, // plain woven gear
  woodland: 2, // camo styles (blob layers mixed from the base colour)
  digital: 3,
  arid: 4,
  skin: 5,
} as const;

let uber: THREE.MeshStandardMaterial | null = null;
let ghillie: THREE.MeshStandardMaterial | null = null;
let elite: THREE.MeshStandardMaterial | null = null;
let hitbox: THREE.MeshBasicMaterial | null = null;

const VERT_HEAD = /* glsl */ `
attribute vec4 aMat;
varying vec4 vMat;
varying vec2 vCamoUv;
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D camoMap;
varying vec4 vMat;
varying vec2 vCamoUv;
`;

// Camo: mask channels -> colour layers derived from the vertex base colour.
const FRAG_COLOR = /* glsl */ `
float hmFab = vMat.x;
vec4 hmCm = texture2D( camoMap, vCamoUv * 1.7 );
float hmFibre = hmCm.a - 0.5;
float hmCamo = step( 1.5, hmFab ) * step( hmFab, 4.5 );
float hmSkin = step( 4.5, hmFab );
vec3 hmBase = diffuseColor.rgb;
vec3 hmDark = hmBase * vec3( 0.58, 0.6, 0.55 );
vec3 hmMid = hmBase * vec3( 0.84, 0.9, 0.76 );
vec3 hmLight = min( hmBase * vec3( 1.2, 1.16, 1.04 ), vec3( 1.0 ) );
vec3 hmC = hmBase;
float hmWood = 1.0 - step( 2.5, hmFab );
float hmDig = step( 2.5, hmFab ) * ( 1.0 - step( 3.5, hmFab ) );
float hmArid = step( 3.5, hmFab );
// woodland-style: mid blobs, dark blobs over, light hairline speckle
vec3 hmW = mix( mix( hmBase, hmMid, hmCm.g ), hmDark, hmCm.r * 0.9 );
// blocky: pixel patches in dark + light over mid base
vec3 hmD = mix( mix( hmMid, hmLight, hmCm.r ), hmDark, hmCm.b * 0.85 );
// arid: soft light washes and small brown blocks
vec3 hmA = mix( mix( hmBase, hmLight, hmCm.r * 0.55 ), hmMid * vec3( 1.0, 0.9, 0.82 ), hmCm.g * 0.7 );
hmA = mix( hmA, hmDark * 1.15, hmCm.b * hmCm.g * 0.6 );
hmC = hmW * hmWood + hmD * hmDig + hmA * hmArid;
diffuseColor.rgb = mix( hmBase, hmC, hmCamo );
// fibre grain on all fabric, subtle blotch on skin
diffuseColor.rgb *= 1.0 + hmFibre * 0.16 * step( 0.5, hmFab ) * ( 1.0 - hmSkin );
diffuseColor.rgb *= 1.0 + ( hmCm.g - 0.5 ) * 0.07 * hmSkin + hmFibre * 0.05 * hmSkin;
float vFabN = step( 0.5, hmFab ) * ( 1.0 - hmSkin );
`;

/** The single shared soldier material: per-vertex colour, surface kind, roughness, metalness, emissive. */
export function uberMaterial() {
  if (uber) return uber;
  const nrm = fabricNormalTexture();
  nrm.repeat.set(9, 9);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const camo = camoTexture();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.camoMap = { value: camo };
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvMat = aMat;\n\tvCamoUv = uv;");
    shader.fragmentShader =
      FRAG_HEAD +
      shader.fragmentShader
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_COLOR)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\troughnessFactor = clamp( vMat.y * ( 1.0 + hmFibre * 0.25 * vFabN ), 0.05, 1.0 );")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n\tmetalnessFactor = vMat.z;")
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * vFabN;"))
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += hmBase * vMat.w;");
  };
  m.customProgramCacheKey = () => "iron-horizon-soldier-v1";
  uber = m;
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
  uber?.dispose();
  ghillie?.dispose();
  elite?.dispose();
  hitbox?.dispose();
  uber = ghillie = elite = hitbox = null;
  disposeTextures();
}
