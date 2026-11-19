import * as THREE from "three";
import type { QualityPreset } from "../config";

/**
 * Sky, fog, sun/ambient lighting and the per-frame atmosphere update
 * (camera-fitted shadows, wind clock, cloud drift, dust motes).
 *
 * Height fog: three's FogExp2 is patched globally (once) into an
 * exponential *height* fog — density falls off with altitude, integrated
 * along the view ray — so valleys and distance haze up while the sky above
 * stays clear. Linear `THREE.Fog` keeps its stock behaviour.
 */

const FOG_FALLOFF = "0.045";
const FOG_START = "6.0";

let fogInstalled = false;
export function installHeightFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldPos = transpose( mat3( viewMatrix ) ) * mvPosition.xyz + cameraPosition;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		vec3 fogRay = vFogWorldPos - cameraPosition;
		float fogDist = length( fogRay );
		float fogK = ${FOG_FALLOFF} * fogRay.y;
		float fogLine = abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0;
		float fogAmt = fogDensity * max( fogDist - ${FOG_START}, 0.0 ) * exp( - ${FOG_FALLOFF} * max( cameraPosition.y, 0.0 ) ) * fogLine;
		float fogFactor = 1.0 - exp( - fogAmt );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	#ifdef IH_SUN_INSCATTER
		// Aerial perspective: haze glows warmer/brighter looking toward the sun.
		vec3 ihSunW = normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz );
		float ihMu = max( dot( normalize( vFogWorldPos - cameraPosition ), ihSunW ), 0.0 );
		vec3 ihSun = directionalLights[ 0 ].color;
		ihSun /= max( max( ihSun.r, ihSun.g ), max( ihSun.b, 1e-3 ) );
		float ihPhase = ihMu * ihMu;
		ihPhase *= ihPhase * ihPhase;
		vec3 ihFogColor = fogColor * mix( vec3( 1.0 ), ihSun * 1.4, ihPhase * 0.55 );
	#else
		vec3 ihFogColor = fogColor;
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, ihFogColor, fogFactor );
#endif`;
  // Flags lit materials so the fog can read the sun (directionalLights[0]).
  if (!C.lights_pars_begin.includes("IH_SUN_INSCATTER")) {
    C.lights_pars_begin += `
#if NUM_DIR_LIGHTS > 0
	#define IH_SUN_INSCATTER
#endif`;
  }
}

export type AtmosphereDef = {
  skyTop: number;
  skyHorizon: number;
  skyGround: number;
  /** Exponential height-fog density at ground level (1/m). */
  fogDensity: number;
  fogColor: number;
  sunDirection: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** 0..1 cloud coverage of the procedural sky. */
  cloudCover: number;
  /** Image-based light strength (procedural or HDRI environment). */
  envIntensity: number;
  exposure: number;
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float time;
uniform float cover;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.6));
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.15);
    vec2 wind = vec2(time * 0.006, time * 0.0025);
    float n = fbm(uv * 0.9 + wind);
    float n2 = fbm(uv * 2.4 - wind * 1.7 + 4.0);
    float c = smoothstep(1.0 - cover - 0.2, 1.0 - cover + 0.3, n * 0.75 + n2 * 0.25);
    vec3 cloudDark = horizon * 0.66;
    vec3 cloudLit = mix(horizon, vec3(1.0), 0.18);
    vec3 cc = mix(cloudDark, cloudLit, smoothstep(0.3, 0.75, n2));
    col = mix(col, cc, c * smoothstep(0.0, 0.2, h));
  } else {
    col = mix(horizon, ground, smoothstep(0.0, -0.2, h));
  }
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 6.0) * 0.08 + pow(s, 48.0) * 0.14);
  col = mix(col, horizon, (1.0 - smoothstep(0.0, 0.1, abs(h))) * 0.65);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
uniform float time;
uniform float boxSize;
attribute float seed;
varying float vAlpha;
void main() {
  vec3 p = position * boxSize;
  p += vec3(time * 0.18, sin(time * 0.35 + seed * 30.0) * 0.4 + time * 0.03, time * 0.08 + cos(time * 0.27 + seed * 17.0) * 0.3);
  vec3 base = cameraPosition - vec3(boxSize * 0.5);
  p = base + mod(p - base, boxSize);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vAlpha = smoothstep(0.4, 2.0, dist) * (1.0 - smoothstep(boxSize * 0.3, boxSize * 0.5, length(p - cameraPosition)));
  gl_PointSize = (0.6 + seed) * 22.0 / max(dist, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 color;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * vAlpha * 0.35;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}`;

export const SKY_NAME = "ih-sky";

/** A registered light source (e.g. a hanging warehouse lamp). */
export type Lamp = {
  position: THREE.Vector3;
  color: THREE.Color;
  /** Candela-ish (PointLight, physical decay 2). ~3-8 for a work lamp. */
  intensity: number;
  /** Cut-off range (m). */
  distance: number;
};

/** Lives on scene.userData so the render pipeline can find it. */
export function getAtmosphere(scene: THREE.Scene): Atmosphere | null {
  const a = scene.userData.ihAtmosphere;
  return a instanceof Atmosphere ? a : null;
}

export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  /** Shared wind clock (seconds) for foliage shaders. */
  readonly windTime = { value: 0 };
  readonly def: AtmosphereDef;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly sunDir = new THREE.Vector3();
  private dust: THREE.Points | null = null;
  private dustMat: THREE.ShaderMaterial | null = null;
  private extent = 36;
  private readonly t0 = typeof performance !== "undefined" ? performance.now() : 0;
  private readonly fwd = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly prevOnBeforeRender: THREE.Scene["onBeforeRender"];
  private hasHdri = false;
  private hemiBase: number;
  private frame = 0;
  private shadowInterval = 1;
  private readonly lastFitFwd = new THREE.Vector3();
  private readonly lastFitPos = new THREE.Vector3(1e9, 0, 0);
  private readonly lamps: Lamp[] = [];
  private readonly lampLights: THREE.PointLight[] = [];
  private maxLampLights = 4;
  private readonly lampOrder: Lamp[] = [];

  constructor(private readonly scene: THREE.Scene, def: AtmosphereDef, mapHalf: number) {
    installHeightFog();
    this.def = def;
    const [sx, sy, sz] = def.sunDirection;
    this.sunDir.set(sx, sy, sz).normalize();

    // Sky dome: gradient + drifting overcast cloud deck + diffuse sun glow.
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(def.skyTop) },
        horizon: { value: new THREE.Color(def.skyHorizon) },
        ground: { value: new THREE.Color(def.skyGround) },
        sunColor: { value: new THREE.Color(def.sunColor) },
        sunDir: { value: this.sunDir },
        time: { value: 0 },
        cover: { value: def.cloudCover },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), this.skyMat);
    this.sky.name = SKY_NAME;
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.fog = new THREE.FogExp2(def.fogColor, def.fogDensity);
    scene.fog = this.fog;
    scene.background = new THREE.Color(def.skyHorizon);

    this.hemiBase = def.hemiIntensity;
    this.hemi = new THREE.HemisphereLight(def.hemiSky, def.hemiGround, def.hemiIntensity);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(def.sunColor, def.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 12;
    // Until the first fitted update, cover the whole map.
    Object.assign(this.sun.shadow.camera, { left: -mapHalf, right: mapHalf, top: mapHalf, bottom: -mapHalf, near: 1, far: 260 });
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    scene.add(this.sun, this.sun.target);

    scene.userData.ihAtmosphere = this;
    this.prevOnBeforeRender = scene.onBeforeRender;
    scene.onBeforeRender = (r, _s, camera) => this.update(camera, r);
  }

  /** Creates/removes dust and refits shadows for a quality preset. */
  setQuality(q: QualityPreset) {
    this.extent = q.shadowExtent;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -this.extent;
    cam.right = cam.top = this.extent;
    cam.updateProjectionMatrix();
    if (q.dustMotes && !this.dust) this.makeDust();
    if (!q.dustMotes && this.dust) this.removeDust();
    this.shadowInterval = Math.max(1, Math.round(q.shadowInterval));
    this.lastFitPos.set(1e9, 0, 0);
    this.maxLampLights = q.maxLocalLights;
    this.syncLampPool();
  }

  /** Unit vector toward the sun (world space). */
  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  /**
   * Registers a local light (hanging lamp, work light). Lamps share a small
   * pool of shadowless point lights (quality.maxLocalLights); the lamps
   * nearest the camera get them, so any number can be registered without
   * raising per-pixel cost. Register during map load to avoid a recompile.
   */
  addLamp(position: THREE.Vector3, color: THREE.ColorRepresentation = 0xffd6a0, intensity = 5, distance = 14): Lamp {
    const lamp: Lamp = { position: position.clone(), color: new THREE.Color(color), intensity, distance };
    this.lamps.push(lamp);
    this.syncLampPool();
    return lamp;
  }

  removeLamp(lamp: Lamp) {
    const i = this.lamps.indexOf(lamp);
    if (i >= 0) this.lamps.splice(i, 1);
    this.syncLampPool();
  }

  /** Pool size = min(lamps, budget); changing it recompiles lit materials. */
  private syncLampPool() {
    const want = Math.min(this.lamps.length, this.maxLampLights);
    while (this.lampLights.length > want) {
      const l = this.lampLights.pop()!;
      this.scene.remove(l);
      l.dispose();
    }
    while (this.lampLights.length < want) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.lampLights.push(l);
      this.scene.add(l);
    }
    this.frame = 0;
  }

  /** Hands the light pool to the lamps nearest the camera. */
  private assignLamps(camera: THREE.Camera) {
    const n = this.lampLights.length;
    if (!n) return;
    const order = this.lampOrder;
    const cp = camera.position;
    order.length = 0;
    for (const l of this.lamps) order.push(l);
    // Rank by distance beyond each lamp's own reach.
    const reach = (l: Lamp) => l.position.distanceTo(cp) - l.distance;
    if (order.length > n) order.sort((a, b) => reach(a) - reach(b));
    for (let i = 0; i < n; i++) {
      const light = this.lampLights[i];
      const lamp = order[i];
      light.position.copy(lamp.position);
      light.color.copy(lamp.color);
      light.distance = lamp.distance;
      // Lamps about to lose their slot are already faded out, so swaps don't pop.
      const fade = order.length > n ? THREE.MathUtils.clamp(1 - reach(lamp) / 20, 0, 1) : 1;
      light.intensity = lamp.intensity * fade;
      light.updateMatrixWorld();
    }
  }

  private makeDust() {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, boxSize: { value: 16 }, color: { value: new THREE.Color(0xd8d2c0) } },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.scene.add(this.dust);
  }

  private removeDust() {
    if (!this.dust) return;
    this.scene.remove(this.dust);
    this.dust.geometry.dispose();
    this.dustMat?.dispose();
    this.dust = null;
    this.dustMat = null;
  }

  /** Per render of the main scene (scene.onBeforeRender). */
  update(camera: THREE.Camera, renderer?: THREE.WebGLRenderer) {
    const t = ((typeof performance !== "undefined" ? performance.now() : 0) - this.t0) / 1000;
    this.windTime.value = t;
    this.skyMat.uniforms.time.value = t;
    if (this.dustMat) this.dustMat.uniforms.time.value = t;
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const frame = this.frame++;
    if (frame % 6 === 0) this.assignLamps(camera);
    this.updateShadow(camera, renderer, frame);
    for (const fn of this.frameHooks) fn(camera);
  }

  /**
   * Shadow caching: with shadowInterval > 1 the sun's map (and its fitted
   * frustum, so map and matrix always agree) is only re-rendered every Nth
   * frame, or at once when the view swings or moves far enough that the
   * cached box would no longer cover what's on screen.
   */
  private updateShadow(camera: THREE.Camera, renderer: THREE.WebGLRenderer | undefined, frame: number) {
    const sm = renderer?.shadowMap;
    if (!sm || this.shadowInterval <= 1) {
      if (sm) sm.autoUpdate = true;
      this.fitShadow(camera);
      return;
    }
    sm.autoUpdate = false;
    camera.getWorldDirection(this.fwd);
    const turned = this.fwd.dot(this.lastFitFwd) < 0.97;
    const moved = camera.position.distanceToSquared(this.lastFitPos) > (this.extent * 0.08) ** 2;
    if (frame % this.shadowInterval === 0 || turned || moved) {
      this.lastFitFwd.copy(this.fwd);
      this.lastFitPos.copy(camera.position);
      this.fitShadow(camera);
      sm.needsUpdate = true;
    }
  }

  /** Extra per-frame work (e.g. foliage tile culling), run with the main camera. */
  readonly frameHooks: ((camera: THREE.Camera) => void)[] = [];

  /**
   * Fits the sun's orthographic shadow box around the area in front of the
   * camera, snapped to whole shadow texels so edges don't shimmer as the
   * player moves.
   */
  private fitShadow(camera: THREE.Camera) {
    const sun = this.sun;
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.center.copy(camera.position).addScaledVector(this.fwd, this.extent * 0.4);
    this.center.y = 0;
    // Light-space basis.
    const L = this.sunDir;
    this.right.set(0, 1, 0).cross(L);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.crossVectors(L, this.right).normalize();
    const texel = (this.extent * 2) / Math.max(1, sun.shadow.mapSize.x);
    const r = Math.round(this.center.dot(this.right) / texel) * texel;
    const u = Math.round(this.center.dot(this.up) / texel) * texel;
    const l = this.center.dot(L);
    this.center.set(0, 0, 0).addScaledVector(this.right, r).addScaledVector(this.up, u).addScaledVector(L, l);
    sun.target.position.copy(this.center);
    sun.position.copy(this.center).addScaledVector(L, 110);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
  }

  /** Re-aims the sun to a new azimuth (keeps elevation). */
  setSunAzimuth(azimuth: number) {
    const horiz = Math.hypot(this.sunDir.x, this.sunDir.z);
    this.sunDir.set(Math.cos(azimuth) * horiz, this.sunDir.y, Math.sin(azimuth) * horiz).normalize();
  }

  /** Switches from the procedural sky to an HDRI background. */
  applyHdri(fogColor: THREE.Color, skyAvg: THREE.Color) {
    this.hasHdri = true;
    this.sky.visible = false;
    this.fog.color.copy(fogColor);
    // Ambient follows the HDRI's sky tint (keeps its luminance).
    const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const target = this.hemi.color.clone();
    const scaled = skyAvg.clone().multiplyScalar(lum(target) / Math.max(1e-4, lum(skyAvg)));
    this.hemi.color.lerp(scaled, 0.6);
    this.hemi.intensity = this.hemiBase * 0.85;
  }

  get usingHdri() {
    return this.hasHdri;
  }

  dispose() {
    this.removeDust();
    this.lamps.length = 0;
    this.syncLampPool();
    this.scene.remove(this.sky, this.hemi, this.sun, this.sun.target);
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.onBeforeRender = this.prevOnBeforeRender;
    if (this.scene.userData.ihAtmosphere === this) delete this.scene.userData.ihAtmosphere;
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

/**
 * Reads an equirectangular HDR (half or float RGBA) and returns the average
 * near-horizon colour, the upper-hemisphere average, and the azimuth of the
 * brightest region (where the sun hides behind the overcast).
 */
export function analyzeHdri(tex: THREE.DataTexture) {
  const img = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const { width: W, height: H, data } = img;
  const half = data instanceof Uint16Array;
  const get = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const horizon = new THREE.Color(0, 0, 0);
  const sky = new THREE.Color(0, 0, 0);
  let nh = 0, ns = 0;
  let sx = 0, sz = 0;
  const step = Math.max(1, Math.floor(W / 256));
  // flipY: row 0 is the top of the sky (elevation +90°).
  for (let r = 0; r < H / 2; r += step) {
    const elev = (0.5 - (r + 0.5) / H) * Math.PI;
    for (let c = 0; c < W; c += step) {
      const i = (r * W + c) * 4;
      const R = get(i), G = get(i + 1), B = get(i + 2);
      if (!Number.isFinite(R + G + B)) continue;
      if (elev < 0.12) {
        horizon.r += R; horizon.g += G; horizon.b += B;
        nh++;
      }
      sky.r += R; sky.g += G; sky.b += B;
      ns++;
      const l = R * 0.2126 + G * 0.7152 + B * 0.0722;
      const w = l * l * l * l * Math.cos(elev);
      const az = ((c + 0.5) / W - 0.5) * Math.PI * 2;
      sx += Math.cos(az) * w;
      sz += Math.sin(az) * w;
    }
  }
  if (nh) horizon.multiplyScalar(1 / nh);
  if (ns) sky.multiplyScalar(1 / ns);
  return { horizon, sky, sunAzimuth: Math.atan2(sz, sx), hasSun: sx * sx + sz * sz > 0 };
}
