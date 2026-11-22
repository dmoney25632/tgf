import * as THREE from "three";

/**
 * Sky occlusion for roofed interiors.
 *
 * Image-based light and the hemisphere light reach every surface equally, so
 * without this a room under a concrete roof is lit by the whole sky and reads
 * flat and grey. Each roofed building gets an interior volume; inside it the
 * indirect sky light (diffuse irradiance and specular reflections) drops to a
 * small bounce floor. Sunlight through doors and windows (shadowed direct
 * light), lamps and muzzle flashes are untouched, so rooms end up lit the way
 * real ones are: bright spill at the openings, dim corners, contrast.
 *
 * Near the walls the occlusion eases off a little (light bouncing in from the
 * openings), and wall faces outside the volume stay fully sky-lit.
 */

/** Indirect light left in the middle of a room (bounce from the openings). */
const FLOOR = 0.24;
/** Interior faces sit at the volume boundary: how much of the occlusion they get. */
const EDGE = 0.55;
/** Distance (m) over which occlusion ramps from EDGE to full away from the walls. */
const RAMP = 2.2;
const MAX_VOLUMES = 8;

export type SkyVolume = { min: THREE.Vector3; max: THREE.Vector3 };

const GLSL = /* glsl */ `
uniform vec3 skyVolMin[${MAX_VOLUMES}];
uniform vec3 skyVolMax[${MAX_VOLUMES}];
uniform int skyVolCount;
varying vec3 vSkyWP;
float skyVisibility( vec3 p ) {
	float occl = 0.0;
	for ( int i = 0; i < ${MAX_VOLUMES}; i ++ ) {
		if ( i >= skyVolCount ) break;
		vec3 lo = skyVolMin[ i ], hi = skyVolMax[ i ];
		// Horizontal depth inside the volume (negative outside).
		float d = min( min( p.x - lo.x, hi.x - p.x ), min( p.z - lo.z, hi.z - p.z ) );
		float inside = smoothstep( -0.12, 0.04, d )
			* ( 1.0 - smoothstep( hi.y + 0.02, hi.y + 0.12, p.y ) )
			* smoothstep( lo.y - 0.3, lo.y, p.y );
		occl = max( occl, inside * mix( ${EDGE.toFixed(3)}, 1.0, smoothstep( 0.0, ${RAMP.toFixed(3)}, d ) ) );
	}
	return mix( 1.0, ${FLOOR.toFixed(3)}, occl );
}`;

/**
 * One uniform set shared by every patched material, process-wide: prop and
 * character materials are cached across matches, so they're patched once and
 * each map writes its own volumes here when it loads.
 */
const SHARED = {
  skyVolMin: { value: Array.from({ length: MAX_VOLUMES }, () => new THREE.Vector3()) },
  skyVolMax: { value: Array.from({ length: MAX_VOLUMES }, () => new THREE.Vector3()) },
  skyVolCount: { value: 0 },
};
const PATCHED = new WeakSet<THREE.Material>();
let activeVolumes: SkyVolume[] | null = null;

export class SkyOcclusion {
  readonly volumes: SkyVolume[];

  constructor(volumes: SkyVolume[]) {
    this.volumes = volumes.slice(0, MAX_VOLUMES);
  }

  /** Make this map's volumes the live ones (call when the map loads). */
  activate() {
    this.volumes.forEach((v, i) => {
      SHARED.skyVolMin.value[i].copy(v.min);
      SHARED.skyVolMax.value[i].copy(v.max);
    });
    SHARED.skyVolCount.value = this.volumes.length;
    activeVolumes = this.volumes;
    return this;
  }

  /** Turn occlusion off (map unloaded). */
  deactivate() {
    // A late dispose of the previous match must not clear the new map's volumes.
    if (activeVolumes !== this.volumes) return;
    activeVolumes = null;
    SHARED.skyVolCount.value = 0;
  }

  /**
   * Interior volumes from roof boxes: the roof footprint minus its overhang
   * and the wall thickness, from the floor up to the roof's underside.
   */
  static fromRoofs(roofs: { x: number; z: number; w: number; d: number; y?: number }[], overhang = 0.2, wall = 0.32) {
    const inset = overhang + wall / 2;
    return new SkyOcclusion(
      roofs.map((r) => ({
        min: new THREE.Vector3(r.x - r.w / 2 + inset, 0, r.z - r.d / 2 + inset),
        max: new THREE.Vector3(r.x + r.w / 2 - inset, r.y ?? 3, r.z + r.d / 2 - inset),
      })),
    );
  }

  /** CPU twin of the shader's skyVisibility() (viewmodel lighting). */
  visibilityAt(p: THREE.Vector3) {
    const ss = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    let occl = 0;
    for (const { min: lo, max: hi } of this.volumes) {
      const d = Math.min(p.x - lo.x, hi.x - p.x, p.z - lo.z, hi.z - p.z);
      const inside = ss(-0.12, 0.04, d) * (1 - ss(hi.y + 0.02, hi.y + 0.12, p.y)) * ss(lo.y - 0.3, lo.y, p.y);
      occl = Math.max(occl, inside * (EDGE + (1 - EDGE) * ss(0, RAMP, d)));
    }
    return 1 + (FLOOR - 1) * occl;
  }

  /** Inject into a lit built-in material (standard / physical / lambert / phong). */
  patch(m: THREE.Material) {
    if (!this.volumes.length || PATCHED.has(m)) return;
    const lit =
      (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
      (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ||
      (m as THREE.MeshPhongMaterial).isMeshPhongMaterial;
    if (!lit) return;
    PATCHED.add(m);
    const uniforms = SHARED;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, renderer) => {
      prev.call(m, sh, renderer);
      if (sh.fragmentShader.includes("skyVisibility(")) return;
      if (!sh.vertexShader.includes("#include <worldpos_vertex>") || !sh.fragmentShader.includes("#include <lights_fragment_end>")) return;
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSkyWP;")
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
{
	vec4 skyWP = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		skyWP = batchingMatrix * skyWP;
	#endif
	#ifdef USE_INSTANCING
		skyWP = instanceMatrix * skyWP;
	#endif
	vSkyWP = ( modelMatrix * skyWP ).xyz;
}`,
        );
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${GLSL}`).replace(
        "#include <lights_fragment_end>",
        `{
	float skyV = skyVisibility( vSkyWP );
	#ifdef IH_GI
		// Baked materials (render/BakedLighting) carry their own sky visibility
		// once the bake has landed (ihGiParams.x fades 0 -> 1).
		skyV = mix( skyV, 1.0, ihGiParams.x );
	#endif
	#if defined( RE_IndirectDiffuse )
		irradiance *= skyV;
		iblIrradiance *= skyV;
	#endif
	#if defined( RE_IndirectSpecular )
		radiance *= skyV;
	#endif
}
#include <lights_fragment_end>`,
      );
    };
    const prevKey = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => `${prevKey()}|sky${MAX_VOLUMES}`;
    m.needsUpdate = true;
  }

  /** Patch every lit material under `root` (cheap to repeat: patched ones are skipped). */
  patchScene(root: THREE.Object3D) {
    if (!this.volumes.length) return;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => this.patch(x));
      else this.patch(m);
    });
  }
}
