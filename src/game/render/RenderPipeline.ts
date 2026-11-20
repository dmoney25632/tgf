import * as THREE from "three";
import { GpuWarmup } from "./GpuWarmup";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { QualityPreset } from "../config";
import { analyzeHdri, getAtmosphere } from "./Atmosphere";
import { loadHdri } from "../assets/AssetLoader";
import { dynamicResolutionBudget, snapRefreshMs } from "./dynamicResolution";

// -----------------------------------------------------------------------------
// Look
// -----------------------------------------------------------------------------

/**
 * Filmic grade (display-referred, applied after AgX): cinematic war-film
 * look. Deep, slightly cool teal-grey shadows, warm sunlit highlights,
 * a firm S-curve, true blacks, and saturation pulled back a touch (AgX
 * already desaturates brights). Baked into the shaders as constants.
 */
const GRADE = {
  saturation: 0.94,
  /** 0..1 strength of the smoothstep S-curve. */
  contrast: 0.62,
  shadowTint: [0.93, 0.995, 1.05],
  highlightTint: [1.055, 1.0, 0.915],
  lift: 0.0,
};

/** AgX maps mid-grey darker than three's ACES; this keeps map exposures valid. */
const AGX_EXPOSURE_GAIN = 1.45;

const BLOOM_LEVELS = 5;

/** Post intensities. */
const POST = {
  /** Energy-conserving bloom mix (every pixel blooms a little, like a lens). */
  bloom: 0.045,
  aoRadius: 1.3,
  aoIntensity: 5.5,
  aoBias: 0.06,
  vignette: 0.38,
  /** Film grain amplitude; re-seeded at GRAIN_HZ (per-frame noise reads as TV static at 120+ Hz). */
  grain: 0.014,
  chromaticAberration: 0.0035,
  /** Contrast-adaptive sharpening (0..~0.25; CAS's "sharpness" mapped to its weight). */
  sharpen: 0.1,
  /** Extra sharpening per unit of resolution lost to dynamic resolution (upscale blur). */
  sharpenUpscale: 0.3,
  shafts: 0.3,
  /** Eye adaptation: 0 = fixed exposure, 1 = everything ends up mid-grey. */
  adaptStrength: 0.5,
  adaptMin: 0.5,
  adaptMax: 1.9,
  /**
   * Scene luminance (pre-exposure) the maps were tuned at: an open, sunlit
   * view. Brighter scenes pull exposure down, darker ones push it up.
   */
  adaptRef: 0.3,
};

const GRAIN_HZ = 24;

const f = (n: number) => n.toFixed(5);
const v3 = (a: number[]) => `vec3(${a.map(f).join(", ")})`;

/** Shared grade function (sRGB in, sRGB out). */
const GRADE_GLSL = /* glsl */ `
vec3 ihGrade( vec3 c ) {
	c = clamp( c, 0.0, 1.0 );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, ${f(GRADE.saturation)} );
	c *= mix( ${v3(GRADE.shadowTint)}, ${v3(GRADE.highlightTint)}, smoothstep( 0.05, 0.8, l ) );
	c = clamp( c, 0.0, 1.0 );
	c = mix( c, c * c * ( 3.0 - 2.0 * c ), ${f(GRADE.contrast)} );
	return c * ${f(1 - GRADE.lift)} + ${f(GRADE.lift)};
}`;

let gradeInstalled = false;
/**
 * Low preset renders straight to the canvas: three's CustomToneMapping is
 * patched to AgX + the same grade, so it gets the look with zero extra passes.
 */
function installGradeToneMapping() {
  if (gradeInstalled) return;
  gradeInstalled = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(
    "vec3 CustomToneMapping( vec3 color ) { return color; }",
    `${GRADE_GLSL}
vec3 CustomToneMapping( vec3 color ) {
	color = AgXToneMapping( color );
	return pow( ihGrade( pow( color, vec3( 1.0 / 2.2 ) ) ), vec3( 2.2 ) );
}`,
  );
}

let specularAaInstalled = false;
/**
 * Specular anti-aliasing (Kaplanyan & Hoffman-style): widen roughness by the
 * screen-space variance of the shading normal, so normal-mapped metal, wet
 * concrete and corrugated sheeting don't sparkle and crawl as the view moves.
 * Only kicks in where the normal changes faster than a pixel can resolve.
 */
export function installSpecularAa() {
  if (specularAaInstalled) return;
  specularAaInstalled = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  const anchor = "material.roughness += geometryRoughness;";
  if (!C.lights_physical_fragment.includes(anchor)) return;
  C.lights_physical_fragment = C.lights_physical_fragment.replace(
    anchor,
    `${anchor}
vec3 ihDn = fwidth( normal );
material.roughness = sqrt( material.roughness * material.roughness + min( dot( ihDn, ihDn ) * 0.5, 0.18 ) );`,
  );
}

// -----------------------------------------------------------------------------
// Shaders
// -----------------------------------------------------------------------------

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/**
 * Half-resolution scalable ambient obscurance. View positions come from the
 * depth buffer, normals from the flattest neighbour pair (no normal pass, so
 * no second scene render). Output: r = AO, g = linear depth (for the blur).
 */
const AO_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform vec2 depthTexel;
uniform vec2 projXY;
uniform float cameraNear;
uniform float cameraFar;
uniform float radius;
uniform float intensity;
uniform float bias;
varying vec2 vUv;
float viewZ( vec2 uv ) { return perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, cameraNear, cameraFar ); }
vec3 viewPos( vec2 uv, float z ) { return vec3( ( uv * 2.0 - 1.0 ) / projXY * -z, z ); }
void main() {
	// Snap to a full-res texel centre so centre + neighbours are exact depth samples.
	vec2 uv = ( floor( vUv / depthTexel ) + 0.5 ) * depthTexel;
	float d = texture2D( tDepth, uv ).x;
	if ( d >= 1.0 ) { gl_FragColor = vec4( 1.0, 1e4, 0.0, 1.0 ); return; }
	float z = perspectiveDepthToViewZ( d, cameraNear, cameraFar );
	vec3 P = viewPos( uv, z );
	vec2 tx = vec2( depthTexel.x, 0.0 ), ty = vec2( 0.0, depthTexel.y );
	vec3 pr = viewPos( uv + tx, viewZ( uv + tx ) ), pl = viewPos( uv - tx, viewZ( uv - tx ) );
	vec3 pu = viewPos( uv + ty, viewZ( uv + ty ) ), pd = viewPos( uv - ty, viewZ( uv - ty ) );
	vec3 dx = abs( pr.z - z ) < abs( z - pl.z ) ? pr - P : P - pl;
	vec3 dy = abs( pu.z - z ) < abs( z - pd.z ) ? pu - P : P - pd;
	vec3 N = normalize( cross( dx, dy ) );
	if ( dot( N, P ) > 0.0 ) N = -N;
	vec2 uvR = radius * 0.5 * projXY / -z;
	uvR *= min( 1.0, 0.12 / max( uvR.y, 1e-5 ) );
	float noise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
	float sum = 0.0;
	float r2 = radius * radius;
	for ( int i = 0; i < AO_SAMPLES; i ++ ) {
		float a = ( float( i ) + 0.5 ) / float( AO_SAMPLES );
		float ang = float( i ) * 2.39996323 + noise;
		vec2 suv = uv + vec2( cos( ang ), sin( ang ) ) * uvR * a;
		vec3 S = viewPos( suv, viewZ( suv ) );
		vec3 v = S - P;
		float vv = dot( v, v );
		float falloff = max( 1.0 - vv / r2, 0.0 );
		// Depth-scaled epsilon keeps flat, distant surfaces from self-occluding.
		float vn = dot( v, N ) + 0.003 * z;
		sum += falloff * max( vn * inversesqrt( vv + 1e-4 ) - bias, 0.0 );
	}
	float ao = max( 0.0, 1.0 - sum * intensity / float( AO_SAMPLES ) );
	ao = mix( ao, 1.0, smoothstep( 45.0, 90.0, -z ) );
	gl_FragColor = vec4( ao, -z, 0.0, 1.0 );
}`;

/** Depth-aware 5x5 blur of the AO buffer (removes the spiral noise). */
const AO_BLUR_FRAG = /* glsl */ `
uniform sampler2D tAO;
varying vec2 vUv;
void main() {
	ivec2 c = ivec2( gl_FragCoord.xy );
	ivec2 size = textureSize( tAO, 0 ) - 1;
	vec2 center = texelFetch( tAO, c, 0 ).rg;
	float tol = 0.04 * center.g + 0.04;
	float sum = 0.0, wsum = 0.0;
	for ( int y = -2; y <= 2; y ++ ) {
		for ( int x = -2; x <= 2; x ++ ) {
			vec2 s = texelFetch( tAO, clamp( c + ivec2( x, y ), ivec2( 0 ), size ), 0 ).rg;
			float w = max( 0.0, 1.0 - abs( s.g - center.g ) / tol );
			sum += s.r * w;
			wsum += w;
		}
	}
	gl_FragColor = vec4( sum / max( wsum, 1e-4 ), center.g, 0.0, 1.0 );
}`;

/** Bright sky pixels around the sun (occluders = anything with depth). */
const SHAFT_MASK_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 sunUv;
uniform float aspect;
uniform float threshold;
varying vec2 vUv;
void main() {
	float sky = step( 1.0, texture2D( tDepth, vUv ).x );
	vec3 c = texture2D( tScene, vUv ).rgb;
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	float around = smoothstep( 0.55, 0.0, length( ( vUv - sunUv ) * vec2( aspect, 1.0 ) ) );
	// Only sky brighter than the horizon haze casts rays (overcast stays subtle).
	gl_FragColor = vec4( vec3( sky * around * around * min( max( l - threshold, 0.0 ), 4.0 ) ), 1.0 );
}`;

/** Radial blur toward the sun (run twice with shrinking steps). */
const SHAFT_BLUR_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 sunUv;
uniform float stepScale;
varying vec2 vUv;
void main() {
	vec2 delta = ( sunUv - vUv ) * stepScale / 24.0;
	vec2 uv = vUv;
	float sum = 0.0, w = 1.0, wsum = 0.0;
	for ( int i = 0; i < 24; i ++ ) {
		sum += texture2D( tIn, uv ).r * w;
		wsum += w;
		w *= 0.95;
		uv += delta;
	}
	gl_FragColor = vec4( vec3( sum / wsum ), 1.0 );
}`;

/** 13-tap downsample (Karis-style firefly suppression on the first level). */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 texel;
uniform float karis;
varying vec2 vUv;
vec3 s( float x, float y ) {
	vec3 c = texture2D( tIn, vUv + vec2( x, y ) * texel ).rgb;
	return mix( c, c / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), karis );
}
void main() {
	vec3 c = s( 0.0, 0.0 ) * 0.125
		+ ( s( -2.0, 2.0 ) + s( 2.0, 2.0 ) + s( -2.0, -2.0 ) + s( 2.0, -2.0 ) ) * 0.03125
		+ ( s( 0.0, 2.0 ) + s( -2.0, 0.0 ) + s( 2.0, 0.0 ) + s( 0.0, -2.0 ) ) * 0.0625
		+ ( s( -1.0, 1.0 ) + s( 1.0, 1.0 ) + s( -1.0, -1.0 ) + s( 1.0, -1.0 ) ) * 0.125;
	c = mix( c, c / max( 1.0 - dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), karis );
	gl_FragColor = vec4( max( c, 0.0 ), 1.0 );
}`;

/** 9-tap tent upsample, added onto the next larger level. */
const UP_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 texel;
varying vec2 vUv;
vec3 s( float x, float y ) { return texture2D( tIn, vUv + vec2( x, y ) * texel ).rgb; }
void main() {
	vec3 c = s( 0.0, 0.0 ) * 4.0
		+ ( s( -1.0, 0.0 ) + s( 1.0, 0.0 ) + s( 0.0, -1.0 ) + s( 0.0, 1.0 ) ) * 2.0
		+ s( -1.0, -1.0 ) + s( 1.0, -1.0 ) + s( -1.0, 1.0 ) + s( 1.0, 1.0 );
	gl_FragColor = vec4( c / 16.0, 1.0 );
}`;

/**
 * Eye adaptation, step 1: average log luminance of the smallest bloom level
 * (a ~1/32-res copy of the HDR scene). Centre-weighted and biased up the
 * frame so the viewmodel in the lower right doesn't steer exposure.
 */
const LUM_FRAG = /* glsl */ `
uniform sampler2D tIn;
varying vec2 vUv;
void main() {
	float sum = 0.0, wsum = 0.0;
	for ( int y = 0; y < 8; y ++ ) for ( int x = 0; x < 8; x ++ ) {
		vec2 uv = vec2( 0.1 + 0.8 * ( float( x ) + 0.5 ) / 8.0, 0.22 + 0.7 * ( float( y ) + 0.5 ) / 8.0 );
		vec3 c = texture2D( tIn, uv ).rgb;
		float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec2 d = uv - vec2( 0.5, 0.55 );
		float w = 1.0 - 0.9 * smoothstep( 0.0, 0.5, length( d ) );
		sum += log( max( l, 1e-4 ) ) * w;
		wsum += w;
	}
	gl_FragColor = vec4( sum / wsum, 0.0, 0.0, 1.0 );
}`;

/**
 * Eye adaptation, step 2: ease the stored log luminance toward this frame's.
 * Brightening (walking out into the sun) adapts faster than darkening, like
 * an eye. rate < 0 snaps (first frame / after a reset).
 */
const ADAPT_FRAG = /* glsl */ `
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float dt;
uniform float snap;
varying vec2 vUv;
void main() {
	float cur = texture2D( tLum, vec2( 0.5 ) ).r;
	float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
	float speed = cur > prev ? 2.2 : 1.1;
	float k = snap > 0.5 ? 1.0 : 1.0 - exp( -dt * speed );
	gl_FragColor = vec4( mix( prev, cur, k ), 0.0, 0.0, 1.0 );
}`;

/**
 * The one full-resolution composite: chromatic aberration, AO, bloom, sun
 * shafts, eye adaptation, AgX tone map, grade and vignette.
 */
const FINAL_FRAG = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform sampler2D tShafts;
uniform float bloomStrength;
uniform vec3 shaftColor;
uniform float vignette;
uniform float grain;
uniform float ca;
uniform float time;
uniform sampler2D tAdapt;
uniform float adaptRef;
varying vec2 vUv;
// ihGrade() comes with the patched tonemapping_pars_fragment above.
void main() {
	vec2 d = vUv - 0.5;
	float r2 = dot( d, d );
	vec3 col;
	#ifdef USE_CA
		vec2 o = d * ca * r2 * 4.0;
		col = vec3( texture2D( tScene, vUv - o ).r, texture2D( tScene, vUv ).g, texture2D( tScene, vUv + o ).b );
	#else
		col = texture2D( tScene, vUv ).rgb;
	#endif
	#ifdef USE_AO
		float ao = texture2D( tAO, vUv ).r;
		// Viewmodel pixels (depth was cleared for them) keep no world AO;
		// brightly sun-lit surfaces show less of it (AO is mostly ambient).
		float vm = step( texture2D( tDepth, vUv ).x, 0.99999 );
		float lit = smoothstep( 0.6, 3.5, dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		col *= mix( ao, 1.0, max( vm, lit * 0.6 ) );
	#endif
	#ifdef USE_BLOOM
		// The chain sums every level; normalise so strength stays a mix factor.
		col = mix( col, texture2D( tBloom, vUv ).rgb * ${f(1 / BLOOM_LEVELS)}, bloomStrength );
	#endif
	#ifdef USE_SHAFTS
		col += texture2D( tShafts, vUv ).r * shaftColor;
	#endif
	#ifdef USE_ADAPT
		// Partial adaptation: dark rooms open up, but stay darker than the yard.
		float avgLum = exp( texture2D( tAdapt, vec2( 0.5 ) ).r );
		col *= clamp( pow( adaptRef / avgLum, ${f(POST.adaptStrength)} ), ${f(POST.adaptMin)}, ${f(POST.adaptMax)} );
	#endif
	col = AgXToneMapping( col );
	col = sRGBTransferOETF( vec4( col, 1.0 ) ).rgb;
	col = ihGrade( col );
	col *= mix( 1.0, smoothstep( 0.9, 0.15, sqrt( r2 ) ), vignette );
	gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}`;

// -----------------------------------------------------------------------------
// GPU timer (EXT_disjoint_timer_query_webgl2, when the browser exposes it)
// -----------------------------------------------------------------------------

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

class GpuTimer {
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Smoothed GPU frame time (ms), or -1 when unavailable. */
  ms = -1;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
  }

  get supported() {
    return this.ext !== null;
  }

  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    const gl = this.gl;
    if (!this.ext) return;
    if (this.active) {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
    const q = this.pending[0];
    if (!q || !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    this.pending.shift();
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (!disjoint) {
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      this.ms = this.ms < 0 ? ms : this.ms * 0.9 + ms * 0.1;
    }
    gl.deleteQuery(q);
  }

  dispose() {
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending.length = 0;
  }
}

// -----------------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------------


const rt = (type: THREE.TextureDataType = THREE.HalfFloatType, opts: THREE.RenderTargetOptions = {}) =>
  new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts });

const shader = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) =>
  new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });

/**
 * Owns the WebGL renderer and draws the world + first-person viewmodel.
 *
 * Post path (medium/high), all hand-driven full-screen passes:
 *   world → [half-res AO + blur] → [quarter-res sun shafts] → viewmodel
 *   → bloom (downsample/upsample chain) → eye adaptation → final composite
 *   → [FXAA] + sharpen + grain
 * Low renders straight to the canvas; the AgX + grade look rides on a
 * patched CustomToneMapping, so it costs no extra pass.
 *
 * Dynamic resolution: the pixel ratio follows frame time between the
 * preset's minResolutionScale and resolutionScale (GPU timer when the
 * browser has one, otherwise the frame interval).
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private env: THREE.Texture;
  private hdriEnv: THREE.Texture | null = null;
  private hdriRequested = false;
  private disposed = false;
  private quality!: QualityPreset;
  private width = 1;
  private height = 1;
  private readonly envIntensity: number;
  private readonly exposure: number;
  private readonly timer: GpuTimer;

  // Post resources (null on low).
  private post: {
    scene: THREE.WebGLRenderTarget;
    ao: THREE.WebGLRenderTarget | null;
    aoBlur: THREE.WebGLRenderTarget | null;
    shaftA: THREE.WebGLRenderTarget | null;
    shaftB: THREE.WebGLRenderTarget | null;
    bloom: THREE.WebGLRenderTarget[];
    ldr: THREE.WebGLRenderTarget | null;
  } | null = null;
  private readonly quad = new FullScreenQuad();
  private aoMat: THREE.ShaderMaterial | null = null;
  private readonly aoBlurMat = shader(AO_BLUR_FRAG, { tAO: { value: null } });
  private readonly maskMat = shader(SHAFT_MASK_FRAG, { tScene: { value: null }, tDepth: { value: null }, sunUv: { value: new THREE.Vector2() }, aspect: { value: 1 }, threshold: { value: 0.5 } });
  private readonly radialMat = shader(SHAFT_BLUR_FRAG, { tIn: { value: null }, sunUv: { value: new THREE.Vector2() }, stepScale: { value: 1 } });
  private readonly downMat = shader(DOWN_FRAG, { tIn: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 } });
  private readonly upMat = (() => {
    const m = shader(UP_FRAG, { tIn: { value: null }, texel: { value: new THREE.Vector2() } });
    m.blending = THREE.AdditiveBlending;
    m.transparent = true;
    return m;
  })();
  private finalMat: THREE.ShaderMaterial | null = null;
  private readonly lumMat = shader(LUM_FRAG, { tIn: { value: null } });
  private readonly adaptMat = shader(ADAPT_FRAG, { tLum: { value: null }, tPrev: { value: null }, dt: { value: 0 }, snap: { value: 1 } });
  /** 1x1 log-luminance targets: this frame's, and the adapted pair (ping-pong). */
  private adapt: { lum: THREE.WebGLRenderTarget; a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null = null;
  private adaptSnap = true;
  private fxaaMat: THREE.ShaderMaterial | null = null;

  // Sun shafts.
  private readonly sunWorld = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private shaftVisibility = 0;

  // Dynamic resolution.
  private basePixelRatio = 1;
  private scale = 1;
  private windowTime = 0;
  private windowSum = 0;
  private windowFrames = 0;
  private settle = 3;
  private upHold = 0;
  private upFails = 0;
  private lastUpAt = -1;
  private clock = 0;
  /** Display refresh interval (ms), learned from the fastest sustained frame pacing. */
  private refreshMs = 1000 / 60;
  /** Bumps whenever the drawing-buffer size changes (dynamic resolution). */
  resolutionVersion = 0;
  private readonly warmup: GpuWarmup;
  private readonly warmScenes: THREE.Scene[];
  private readonly warmCameras: THREE.Camera[];

  constructor(
    container: HTMLElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly viewScene: THREE.Scene,
    private readonly viewCamera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
  ) {
    installGradeToneMapping();
    installSpecularAa();
    // Canvas MSAA only matters on low (post draws one full-screen triangle into it).
    this.renderer = new THREE.WebGLRenderer({ antialias: true,powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.CustomToneMapping;
    const atmo = getAtmosphere(scene);
    this.exposure = (atmo?.def.exposure ?? 1.05) * AGX_EXPOSURE_GAIN;
    this.renderer.toneMappingExposure = this.exposure;
    this.envIntensity = atmo?.def.envIntensity ?? 0.3;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    // The info-log queries block on the driver; only worth it while developing.
    this.renderer.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
    // Count draw calls across all passes of a frame (reset in render()).
    this.renderer.info.autoReset = false;
    this.timer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    canvas.tabIndex = 0;
    // Lets UI-only effects (the menu particle backdrop) idle while a match renders.
    canvas.dataset.engine = "1";
    container.appendChild(canvas);
    // Spread texture uploads and shader compiles over the first frames.
    this.warmup = new GpuWarmup(this.renderer);
    this.warmup.watch(scene);
    this.warmup.watch(viewScene);
    // Behind the loading screen / deploy card: compile and upload everything up front.
    this.warmup.eager(8000);
    this.warmup.holdForPrograms(4000);
    this.warmScenes = [scene, viewScene];
    this.warmCameras = [camera, viewCamera];

    // Image-based lighting from the map's own sky (or a neutral room).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    if (atmo) {
      const envScene = new THREE.Scene();
      const sky = new THREE.Mesh(atmo.sky.geometry, atmo.sky.material);
      envScene.add(sky);
      this.env = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
    } else {
      const room = new RoomEnvironment();
      this.env = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
    }
    pmrem.dispose();
    scene.environment = this.env;
    scene.environmentIntensity = atmo ? this.envIntensity : 0.3;
  }

  /** Current environment map (procedural sky or HDRI). */
  get envMap() {
    return this.hdriEnv ?? this.env;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  get info() {
    return this.renderer.info;
  }

  /** Smoothed GPU ms per frame (-1 if the timer extension is missing). */
  get gpuMs() {
    return this.timer.ms;
  }

  /** Current dynamic-resolution scale (1 = preset resolution). */
  get resolutionScale() {
    return this.scale;
  }

  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  /** Whether the post stack draws the vignette (the HUD's CSS one is for low). */
  get postVignette() {
    return this.post !== null;
  }

  private requestHdri() {
    if (this.hdriRequested) return;
    this.hdriRequested = true;
    void loadHdri().then((tex) => {
      if (!tex || this.disposed) return;
      const atmo = getAtmosphere(this.scene);
      const info = analyzeHdri(tex);
      const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      // Match the HDRI's horizon brightness to the map's fog so the seam vanishes.
      const target = atmo ? lum(atmo.fog.color) : 0.45;
      const scale = THREE.MathUtils.clamp(target / Math.max(1e-4, lum(info.horizon)), 0.02, 50);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.hdriEnv = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      const old = this.env;
      this.scene.background = tex;
      this.scene.backgroundIntensity = scale;
      this.scene.environment = this.hdriEnv;
      this.scene.environmentIntensity = this.envIntensity * scale;
      if (this.viewScene.environment === old) {
        this.viewScene.environment = this.hdriEnv;
        this.viewScene.environmentIntensity *= scale;
      }
      if (atmo) {
        atmo.applyHdri(info.horizon.clone().multiplyScalar(scale), info.sky.clone().multiplyScalar(scale));
        if (info.hasSun) atmo.setSunAzimuth(info.sunAzimuth);
      }
    });
  }

  setQuality(q: QualityPreset) {
    const shadowsChanged = !this.quality || this.quality.shadows !== q.shadows || this.quality.shadowMapSize !== q.shadowMapSize;
    this.quality = q;
    if (q.hdri) this.requestHdri();

    this.scale = q.resolutionScale;
    this.settle = 3;
    this.upFails = 0;
    this.upHold = 0;
    this.basePixelRatio = Math.min(window.devicePixelRatio, q.maxPixelRatio);
    this.renderer.setPixelRatio(this.basePixelRatio * this.scale);

    if (shadowsChanged) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.renderer.shadowMap.needsUpdate = true;
      this.sun.castShadow = q.shadows;
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      // Materials must recompile when shadow support toggles.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
      this.warmup.invalidatePrograms();
    }

    this.buildPost();
    this.setSize(this.width, this.height);
    // Cut-out foliage gets alpha-to-coverage wherever the world pass is
    // multisampled (MSAA target, or the antialiased canvas on low): smooth,
    // non-crawling leaf edges instead of a 1-bit alpha test.
    const msaa = q.postProcessing ? q.msaaSamples > 0 : this.renderer.getContext().getContextAttributes()?.antialias === true;
    this.warmup.setPolicy({ anisotropy: q.anisotropy, alphaToCoverage: msaa });
    this.warmup.target = this.post?.scene ?? null;
    this.warmup.eager(3000);
  }

  private disposePost() {
    const p = this.post;
    if (!p) return;
    for (const t of [p.scene, p.ao, p.aoBlur, p.shaftA, p.shaftB, p.ldr, ...p.bloom]) {
      if (!t) continue;
      t.depthTexture?.dispose();
      t.dispose();
    }
    this.post = null;
    if (this.adapt) for (const t of Object.values(this.adapt)) t.dispose();
    this.adapt = null;
    this.aoMat?.dispose();
    this.aoMat = null;
    this.finalMat?.dispose();
    this.finalMat = null;
    this.fxaaMat?.dispose();
    this.fxaaMat = null;
  }

  private buildPost() {
    this.disposePost();
    const q = this.quality;
    if (!q.postProcessing) return;
    const ao = q.ambientOcclusion && q.aoSamples > 0;
    const needDepth = ao || q.godRays;
    const scene = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: q.msaaSamples,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    if (needDepth) scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const fxaa = q.msaaSamples === 0;
    this.post = {
      scene,
      ao: ao ? rt() : null,
      aoBlur: ao ? rt() : null,
      shaftA: q.godRays ? rt() : null,
      shaftB: q.godRays ? rt() : null,
      bloom: q.bloom ? Array.from({ length: BLOOM_LEVELS }, () => rt()) : [],
      // Always: the last pass (FXAA on medium) sharpens and adds grain.
      ldr: rt(THREE.UnsignedByteType),
    };
    for (const t of this.post.bloom) t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
    // Eye adaptation rides on the bloom chain's smallest level.
    if (q.bloom) {
      const one = () => {
        const t = rt(THREE.HalfFloatType, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        t.setSize(1, 1);
        return t;
      };
      this.adapt = { lum: one(), a: one(), b: one() };
      this.adaptSnap = true;
    }

    if (ao) {
      this.aoMat = shader(
        AO_FRAG,
        {
          tDepth: { value: scene.depthTexture },
          depthTexel: { value: new THREE.Vector2() },
          projXY: { value: new THREE.Vector2(1, 1) },
          cameraNear: { value: this.camera.near },
          cameraFar: { value: this.camera.far },
          radius: { value: POST.aoRadius },
          intensity: { value: POST.aoIntensity },
          bias: { value: POST.aoBias },
        },
        { AO_SAMPLES: q.aoSamples },
      );
      this.aoBlurMat.uniforms.tAO.value = this.post.ao!.texture;
    }

    const defines: Record<string, string> = {};
    if (ao) defines.USE_AO = "";
    if (q.bloom) defines.USE_BLOOM = "";
    if (q.godRays) defines.USE_SHAFTS = "";
    if (this.adapt) defines.USE_ADAPT = "";
    defines.USE_CA = "";
    this.finalMat = shader(
      FINAL_FRAG,
      {
        tScene: { value: scene.texture },
        tBloom: { value: this.post.bloom[0]?.texture ?? null },
        tAO: { value: this.post.aoBlur?.texture ?? null },
        tDepth: { value: scene.depthTexture ?? null },
        tShafts: { value: this.post.shaftA?.texture ?? null },
        toneMappingExposure: { value: this.exposure },
        bloomStrength: { value: POST.bloom },
        shaftColor: { value: new THREE.Color() },
        vignette: { value: POST.vignette },
        grain: { value: POST.grain },
        ca: { value: POST.chromaticAberration },
        time: { value: 0 },
        tAdapt: { value: null },
        adaptRef: { value: POST.adaptRef },
      },
      defines,
    );
    {
      // Last pass: [FXAA] → contrast-adaptive sharpen (restores the crispness
      // AA and the render-scale upsample take away) → grain on top, so
      // neither the AA nor the sharpen touches it.
      const frag = `uniform float time;\nuniform float grain;\nuniform float sharpen;\n${FXAAShader.fragmentShader}`.replace(
        "gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );",
        `${fxaa ? "gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );" : "gl_FragColor = texture2D( tDiffuse, vUv );"}
			{
				vec3 c = gl_FragColor.rgb;
				vec3 a = texture2D( tDiffuse, vUv + vec2( 0.0, resolution.y ) ).rgb;
				vec3 b = texture2D( tDiffuse, vUv - vec2( 0.0, resolution.y ) ).rgb;
				vec3 l = texture2D( tDiffuse, vUv - vec2( resolution.x, 0.0 ) ).rgb;
				vec3 r = texture2D( tDiffuse, vUv + vec2( resolution.x, 0.0 ) ).rgb;
				vec3 mn = min( c, min( min( a, b ), min( l, r ) ) );
				vec3 mx = max( c, max( max( a, b ), max( l, r ) ) );
				// AMD CAS-style: sharpen less where local contrast is already high.
				vec3 amp = sqrt( clamp( min( mn, 1.0 - mx ) / max( mx, 1e-4 ), 0.0, 1.0 ) );
				vec3 w = -amp * sharpen;
				gl_FragColor.rgb = clamp( ( c + ( a + b + l + r ) * w ) / ( 1.0 + 4.0 * w ), 0.0, 1.0 );
			}
			float n = fract( sin( dot( gl_FragCoord.xy + fract( time * 7.13 ) * 113.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
			gl_FragColor.rgb += n * grain * ( 1.0 - gl_FragColor.rgb * 0.6 );`,
      );
      this.fxaaMat = new THREE.ShaderMaterial({
        vertexShader: FXAAShader.vertexShader,
        fragmentShader: frag,
        uniforms: {
          tDiffuse: { value: this.post.ldr!.texture },
          resolution: { value: new THREE.Vector2() },
          time: { value: 0 },
          grain: { value: POST.grain },
          sharpen: { value: POST.sharpen },
        },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    }
  }

  setSize(w: number, h: number) {
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.resizePost();
    this.resolutionVersion++;
  }

  private resizePost() {
    const p = this.post;
    if (!p) return;
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(1, Math.round(this.width * pr));
    const H = Math.max(1, Math.round(this.height * pr));
    p.scene.setSize(W, H);
    p.ldr?.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    p.ao?.setSize(hw, hh);
    p.aoBlur?.setSize(hw, hh);
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    p.shaftA?.setSize(qw, qh);
    p.shaftB?.setSize(qw, qh);
    p.bloom.forEach((t, i) => t.setSize(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));
    if (this.aoMat) this.aoMat.uniforms.depthTexel.value.set(1 / W, 1 / H);
    if (this.fxaaMat) {
      this.fxaaMat.uniforms.resolution.value.set(1 / W, 1 / H);
      // Native resolution only needs a light touch (sharpening amplifies
      // shimmer); upscaled frames get more to win back the lost crispness.
      this.fxaaMat.uniforms.sharpen.value = Math.min(0.22, POST.sharpen + POST.sharpenUpscale * Math.max(0, 1 - this.scale));
    }
  }

  private pass(mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.renderer.setRenderTarget(target);
    this.quad.material = mat;
    this.quad.render(this.renderer);
  }

  /** Sun position on screen + how visible it is (0 = behind / far off-screen). */
  private updateSun() {
    const atmo = getAtmosphere(this.scene);
    if (!atmo) return (this.shaftVisibility = 0);
    const cam = this.camera;
    cam.getWorldDirection(this.camDir);
    const facing = this.camDir.dot(atmo.sunDirection);
    if (facing <= 0.05) return (this.shaftVisibility = 0);
    this.sunWorld.copy(cam.position).addScaledVector(atmo.sunDirection, 500).project(cam);
    const sx = this.sunWorld.x * 0.5 + 0.5;
    const sy = this.sunWorld.y * 0.5 + 0.5;
    const off = Math.max(Math.abs(this.sunWorld.x), Math.abs(this.sunWorld.y));
    this.shaftVisibility = THREE.MathUtils.smoothstep(facing, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.8));
    this.maskMat.uniforms.sunUv.value.set(sx, sy);
    this.radialMat.uniforms.sunUv.value.set(sx, sy);
    this.maskMat.uniforms.aspect.value = cam.aspect;
    const fc = atmo.fog.color;
    this.maskMat.uniforms.threshold.value = (fc.r * 0.2126 + fc.g * 0.7152 + fc.b * 0.0722) * 1.8;
    const sc = this.finalMat!.uniforms.shaftColor.value as THREE.Color;
    sc.copy(this.sun.color).multiplyScalar(POST.shafts * this.shaftVisibility);
    return this.shaftVisibility;
  }

  /**
   * Eye adaptation. Reads the smallest bloom level before the upsample pass
   * adds into it... except the up chain never writes the last level, so it
   * still holds the plain downsampled scene.
   */
  private adaptExposure(smallest: THREE.WebGLRenderTarget, dt: number) {
    const a = this.adapt!;
    this.lumMat.uniforms.tIn.value = smallest.texture;
    this.pass(this.lumMat, a.lum);
    const u = this.adaptMat.uniforms;
    u.tLum.value = a.lum.texture;
    u.tPrev.value = a.a.texture;
    u.dt.value = Math.min(dt, 0.1);
    u.snap.value = this.adaptSnap ? 1 : 0;
    this.adaptSnap = false;
    this.pass(this.adaptMat, a.b);
    [a.a, a.b] = [a.b, a.a];
    this.finalMat!.uniforms.tAdapt.value = a.a.texture;
  }

  /** Snap exposure on the next frame (spawn, teleport, map change). */
  resetAdaptation() {
    this.adaptSnap = true;
  }

  /** Debug: current adapted scene luminance (pre-exposure), or -1 without adaptation. */
  debugAdaptedLuminance() {
    if (!this.adapt) return -1;
    const buf = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.adapt.a, 0, 0, 1, 1, buf);
    return Math.exp(THREE.DataUtils.fromHalfFloat(buf[0]));
  }

  /** @param dt wall-clock seconds since the previous frame (drives dynamic resolution). */
  render(dt = 1 / 60) {
    this.warmup.update(this.warmScenes, this.warmCameras);
    const r = this.renderer;
    if (this.warmup.holding) {
      // Still behind the loading screen and shaders are linking in parallel:
      // skip this frame rather than block on a half-compiled program.
      r.setRenderTarget(null);
      r.clear();
      return;
    }
    r.info.reset();
    this.timer.begin();
    const p = this.post;
    if (!p) {
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, this.camera);
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);
    } else {
      // Grain/time re-seeds at film rate, not per frame (static-free at high refresh).
      const time = (Math.floor((performance.now() / 1000) * GRAIN_HZ) / GRAIN_HZ) % 1000;
      r.setRenderTarget(p.scene);
      r.clear();
      r.render(this.scene, this.camera);

      if (this.aoMat && p.ao && p.aoBlur) {
        const u = this.aoMat.uniforms;
        const pm = this.camera.projectionMatrix.elements;
        u.projXY.value.set(pm[0], pm[5]);
        u.cameraNear.value = this.camera.near;
        u.cameraFar.value = this.camera.far;
        this.pass(this.aoMat, p.ao);
        this.pass(this.aoBlurMat, p.aoBlur);
      }

      const fm = this.finalMat!;
      if (p.shaftA && p.shaftB) {
        if (this.updateSun() > 0.001) {
          this.maskMat.uniforms.tScene.value = p.scene.texture;
          this.maskMat.uniforms.tDepth.value = p.scene.depthTexture;
          this.pass(this.maskMat, p.shaftA);
          this.radialMat.uniforms.tIn.value = p.shaftA.texture;
          this.radialMat.uniforms.stepScale.value = 1;
          this.pass(this.radialMat, p.shaftB);
          this.radialMat.uniforms.tIn.value = p.shaftB.texture;
          this.radialMat.uniforms.stepScale.value = 0.3;
          this.pass(this.radialMat, p.shaftA);
        } else (fm.uniforms.shaftColor.value as THREE.Color).setRGB(0, 0, 0);
      }

      r.setRenderTarget(p.scene);
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);

      if (p.bloom.length) {
        let src = p.scene.texture;
        let sw = p.scene.width, sh = p.scene.height;
        for (let i = 0; i < p.bloom.length; i++) {
          const u = this.downMat.uniforms;
          u.tIn.value = src;
          u.texel.value.set(1 / sw, 1 / sh);
          u.karis.value = i === 0 ? 1 : 0;
          this.pass(this.downMat, p.bloom[i]);
          src = p.bloom[i].texture;
          sw = p.bloom[i].width;
          sh = p.bloom[i].height;
        }
        for (let i = p.bloom.length - 1; i > 0; i--) {
          const u = this.upMat.uniforms;
          u.tIn.value = p.bloom[i].texture;
          u.texel.value.set(1 / p.bloom[i].width, 1 / p.bloom[i].height);
          this.pass(this.upMat, p.bloom[i - 1]);
        }
        if (this.adapt) this.adaptExposure(p.bloom[p.bloom.length - 1], dt);
      }

      fm.uniforms.time.value = time;
      fm.uniforms.toneMappingExposure.value = this.exposure;
      if (this.fxaaMat && p.ldr) {
        this.pass(fm, p.ldr);
        this.fxaaMat.uniforms.time.value = time;
        this.pass(this.fxaaMat, null);
      } else this.pass(fm, null);
    }
    this.timer.end();
    this.updateDynamicResolution(dt);
  }

  /**
   * Steps the render scale down when real frames run over budget and back up
   * cautiously. The frame interval is the ground truth (a GPU timer can read
   * high when other GL work shares the GPU, so it never forces a drop); the
   * timer only vetoes drops when the GPU clearly isn't the bottleneck and
   * shortens the wait before probing upward. Failed probes back off longer.
   */
  private updateDynamicResolution(dt: number) {
    const q = this.quality;
    if (!q || q.minResolutionScale >= q.resolutionScale) return;
    this.clock += dt;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    const ms = dt * 1000;
    if (ms > 100) return; // hitch (compile, tab switch): ignore
    this.windowSum += ms;
    this.windowFrames++;
    this.windowTime += dt;
    if (this.upHold > 0) this.upHold -= dt;
    if (this.windowTime < 0.5) return;
    const avg = this.windowSum / this.windowFrames;
    this.windowSum = this.windowFrames = this.windowTime = 0;
    this.learnRefresh(avg);
    const gpu = this.timer.ms;
    const { target, floor } = dynamicResolutionBudget(q, this.refreshMs, avg);
    let next = this.scale;
    if (avg > target * 1.1 && this.scale > floor + 0.01) {
      if (gpu > 0 && gpu < target * 0.55) return; // CPU-bound: fewer pixels won't help
      // Pixel cost ~ scale²: aim straight for the budget, at most one big step.
      next = Math.max(floor, this.scale * Math.max(0.85, Math.sqrt(target / avg)));
      if (this.clock - this.lastUpAt < 2.5) {
        this.upFails++;
        this.upHold = Math.min(60, 4 * 2 ** this.upFails);
      }
    } else if (this.upHold <= 0 && this.scale < q.resolutionScale && avg < (this.scale < floor - 0.01 ? q.targetFrameMs * 0.85 : target * 1.03)) {
      // Below the high-refresh floor only the 60 fps budget matters: climb back to it.
      next = Math.min(q.resolutionScale, this.scale + 0.05);
      this.lastUpAt = this.clock;
      this.upHold = gpu > 0 && gpu < target * 0.7 ? 1 : 3;
    }
    next = Math.round(next * 20) / 20;
    if (Math.abs(next - this.scale) < 0.01) return;
    this.scale = next;
    this.renderer.setPixelRatio(this.basePixelRatio * this.scale);
    this.setSize(this.width, this.height);
    this.settle = 0.3;
  }

  /**
   * Learns the display's refresh rate from frame pacing: the fastest 0.5 s
   * average seen (frames can't come faster than vsync), snapped to a common
   * rate. Starts at 60 Hz, so a 120/144 Hz screen is found the first time the
   * game runs at full speed.
   */
  private learnRefresh(avgMs: number) {
    if (avgMs <= 0 || avgMs > this.refreshMs * 0.94) return;
    this.refreshMs = snapRefreshMs(avgMs);
  }

  /** Learned display refresh interval (ms). */
  get displayRefreshMs() {
    return this.refreshMs;
  }

  dispose() {
    this.warmup.dispose();
    this.disposed = true;
    this.disposePost();
    this.quad.dispose();
    for (const m of [this.aoBlurMat, this.maskMat, this.radialMat, this.downMat, this.upMat]) m.dispose();
    this.timer.dispose();
    this.env.dispose();
    this.hdriEnv?.dispose();
    // The HDR source stays cached (AssetLoader); free only its GPU copy.
    const bg = this.scene.background as THREE.Texture | null;
    if (bg && (bg as THREE.Texture).isTexture) bg.dispose();
    this.renderer.dispose();
    // Release the GL context now instead of waiting for GC; otherwise repeated
    // remounts hit the browser's active-context cap.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

