import * as THREE from "three";

/**
 * Shading side of the per-vertex light bake (world/lighting/MapLighting).
 *
 * Baked world meshes carry two attributes:
 *   ihGi     (vec4, normalized u8): rgb = sqrt(sun bounce), a = sky visibility
 *   ihSunOcc (float, normalized u8): baked sun occlusion
 * and their materials are patched to
 *   - multiply ambient / IBL light (irradiance, IBL irradiance, reflections)
 *     by the sky visibility,
 *   - add the bounce, scaled by the live sun colour (directionalLights[0]),
 *     as indirect diffuse light,
 *   - multiply direct sun light by the baked sun visibility where the
 *     real-time shadow cascades don't reach (and everywhere on presets
 *     without shadow maps).
 * Direct sun inside the cascades, point lights and emissive stay real-time.
 *
 * Both attributes are encoded so that WebGL's default value for a missing
 * attribute, (0, 0, 0, 1), is neutral (no bounce, full sky, sun visible):
 * a mesh sharing a patched material but lacking the bake renders unchanged.
 * MapLighting still gives every such mesh explicit neutral attributes.
 */

/** Process-wide uniforms shared by every patched material (one map at a time). */
export const BAKED_UNIFORMS = {
  /** x = bake strength (fades 0 → 1 when a bake lands), y = bounce gain, z = baked-sun strength. */
  ihGiParams: { value: new THREE.Vector3(0, 1, 1) },
  /** View distance (m) over which baked sun replaces the shadow cascades (start, end). */
  ihSunFade: { value: new THREE.Vector2(-2, -1) },
};

/** Fades the bake in/out (0..1). */
export function setBakeStrength(v: number) {
  BAKED_UNIFORMS.ihGiParams.value.x = v;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 ihGi;
attribute float ihSunOcc;
varying vec4 vIhGi;
varying float vIhSunOcc;`;

const FRAG_HEAD = /* glsl */ `
#define IH_GI
uniform vec3 ihGiParams;
uniform vec2 ihSunFade;
varying vec4 vIhGi;
varying float vIhSunOcc;`;

/** Before the light loops: the baked factors (ihSunMul is read in lights_fragment_begin). */
const FRAG_PRE_LIGHTS = /* glsl */ `
// Floor: even a sealed room keeps a little fill (gameplay readability).
float ihSky = mix( 1.0, max( vIhGi.a, 0.08 ), ihGiParams.x );
float ihSunMul = 1.0 - vIhSunOcc * ihGiParams.z * ihGiParams.x * smoothstep( ihSunFade.x, ihSunFade.y, length( vViewPosition ) );
`;

/** After the light loops / IBL gather, before the indirect terms are resolved. */
const FRAG_INDIRECT = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance *= ihSky;
	iblIrradiance *= ihSky;
	#if NUM_DIR_LIGHTS > 0
		irradiance += vIhGi.rgb * vIhGi.rgb * ( ihGiParams.y * ihGiParams.x ) * directionalLights[ 0 ].color;
	#endif
#endif
#if defined( RE_IndirectSpecular )
	// Occluded points see walls, not sky, in their reflections too.
	radiance *= ihSky * ( 0.35 + 0.65 * ihSky );
#endif
`;

const PATCHED = new WeakSet<THREE.Material>();

/** True for the built-in lit materials the patch understands. */
export function bakeableMaterial(m: THREE.Material | THREE.Material[]): m is THREE.MeshStandardMaterial {
  if (Array.isArray(m)) return false;
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

export function isBakePatched(m: THREE.Material) {
  return PATCHED.has(m);
}

/** Adds the bake to a standard / physical material (idempotent). */
export function patchBakedMaterial(m: THREE.MeshStandardMaterial) {
  if (PATCHED.has(m)) return;
  PATCHED.add(m);
  installLightingChunks();
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, renderer) => {
    prev.call(m, sh, renderer);
    if (sh.fragmentShader.includes("vIhGi")) return;
    if (!sh.vertexShader.includes("#include <begin_vertex>") || !sh.fragmentShader.includes("#include <lights_fragment_begin>") || !sh.fragmentShader.includes("#include <lights_fragment_end>")) return;
    Object.assign(sh.uniforms, BAKED_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvIhGi = ihGi;\nvIhSunOcc = ihSunOcc;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `${FRAG_HEAD}\n#include <common>`)
      .replace("#include <lights_fragment_begin>", `${FRAG_PRE_LIGHTS}\n#include <lights_fragment_begin>`)
      .replace("#include <lights_fragment_end>", `${FRAG_INDIRECT}\n#include <lights_fragment_end>`);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${prevKey()}|ihgi1`;
  m.needsUpdate = true;
}

/** Neutral bake attributes (no bounce, open sky, sun visible) for `count` vertices. */
export function neutralBakeAttributes(geo: THREE.BufferGeometry) {
  if (geo.attributes.ihGi && geo.attributes.ihSunOcc) return;
  const n = geo.attributes.position.count;
  const gi = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) gi[i * 4 + 3] = 255;
  geo.setAttribute("ihGi", new THREE.BufferAttribute(gi, 4, true));
  geo.setAttribute("ihSunOcc", new THREE.BufferAttribute(new Uint8Array(n), 1, true));
}

// -----------------------------------------------------------------------------
// Global light-loop patch: shadow cascades + baked sun
// -----------------------------------------------------------------------------

/**
 * Replaces the directional shadow lookup in three's light loop:
 *
 * - Cascades: whenever a scene has two shadow-casting directional lights,
 *   light 0 is the sun (near cascade: small, crisp frustum around the
 *   player) and light 1 is a black "far cascade" light (wide frustum,
 *   refreshed rarely). The sun's shadow reads the near map inside its
 *   frustum, blends to the far map over the last 15 % of it and uses the far
 *   map beyond. The far light itself only exists to own the second map.
 * - Baked sun: materials with the bake multiply light 0 by ihSunMul.
 *
 * Every lit built-in material (and custom ones that include the chunk) gets
 * this automatically, so characters, props and foliage need no setup.
 */
const SHADOW_LINE =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";

const shadowArgs = (k: number) =>
  `directionalShadowMap[ ${k} ], directionalLightShadows[ ${k} ].shadowMapSize, directionalLightShadows[ ${k} ].shadowIntensity, directionalLightShadows[ ${k} ].shadowBias, directionalLightShadows[ ${k} ].shadowRadius, vDirectionalShadowCoord[ ${k} ]`;

const CASCADE_LOOKUP = /* glsl */ `
		#if ( NUM_DIR_LIGHT_SHADOWS >= 2 ) && ( UNROLLED_LOOP_INDEX == 0 )
		{
			// Near/far cascade blend (see render/BakedLighting.ts).
			vec3 ihC0 = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
			vec2 ihE = abs( ihC0.xy * 2.0 - 1.0 );
			float ihEdge = max( max( ihE.x, ihE.y ), step( 1.0, ihC0.z ) * 2.0 );
			float ihW = smoothstep( 0.85, 0.98, ihEdge );
			float ihS0 = 1.0, ihS1 = 1.0;
			if ( directLight.visible && receiveShadow ) {
				if ( ihW < 1.0 ) ihS0 = getShadow( ${shadowArgs(0)} );
				if ( ihW > 0.0 ) ihS1 = getShadow( ${shadowArgs(1)} );
			}
			directLight.color *= mix( ihS0, ihS1, ihW );
		}
		#elif ( NUM_DIR_LIGHT_SHADOWS >= 2 ) && ( UNROLLED_LOOP_INDEX == 1 )
			// Far-cascade light: carries no light of its own.
			directLight.color = vec3( 0.0 );
		#else
		${SHADOW_LINE}
		#endif`;

const SUN_INFO = "getDirectionalLightInfo( directionalLight, directLight );";
const BAKED_SUN = `${SUN_INFO}
		#if defined( IH_GI ) && ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ihSunMul;
		#endif`;

let chunksInstalled = false;
/** Patches three's light loop once per page (survives hot reload: checks a marker). */
export function installLightingChunks() {
  if (chunksInstalled) return;
  chunksInstalled = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  let src = C.lights_fragment_begin;
  if (src.includes("ihSunMul")) return;
  if (!src.includes(SHADOW_LINE) || !src.includes(SUN_INFO)) {
    console.warn("[lighting] three's light loop changed; cascades/baked sun disabled");
    return;
  }
  src = src.replace(SHADOW_LINE, CASCADE_LOOKUP).replace(SUN_INFO, BAKED_SUN);
  C.lights_fragment_begin = src;
}
