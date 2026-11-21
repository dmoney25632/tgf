import * as THREE from "three";
import { FX_LIGHT_PARS, type FxLightUniforms } from "./FxLighting";
import { FLIPBOOK } from "./ProceduralFx";

const UPLOAD = ["position", "color", "alpha", "size", "seed", "age"] as const;

/**
 * Visual style of a particle pool:
 *   glow     — additive soft dot (sparks, embers)
 *   chunk    — opaque-ish lit chip; seed's integer part picks the shape
 *              (0 round chip, 1 splinter, 2 angular flake)
 *   smoke    — alpha-blended noisy puff, sun-lit, fades in then out (dust, smoke, mist)
 *   fire     — additive noisy puff with an age colour ramp (muzzle puffs, flames)
 *   fireball — premultiplied flipbook (procedural atlas): white-hot core
 *              rolling over into lit dark smoke
 */
export type ParticleStyle = "glow" | "chunk" | "smoke" | "fire" | "fireball";

/** Chunk shapes (pass to spawn's `shape`). */
export const SHAPE = { chip: 0, splinter: 1, flake: 2 } as const;

const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

/** Rotation speed of the sprite's pattern (rad per unit age). */
const ROT: Record<ParticleStyle, number> = { glow: 0, chunk: 22, smoke: 3, fire: 3, fireball: 1.2 };

const FRAG: Record<ParticleStyle, string> = {
  glow: /* glsl */ `
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - d);
    a *= a;
    gl_FragColor = vec4(vColor * (0.6 + 0.8 * a), vAlpha * a);`,
  chunk: /* glsl */ `
    vec2 c0 = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 c = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs) * 2.0;
    float shape = floor(vSeed);
    float d;
    vec3 nrm;
    if (shape > 1.5) {
      // Angular flake: a rotated, slightly irregular quad.
      d = max(abs(c.x + c.y * 0.3), abs(c.y)) * 1.15;
      nrm = normalize(vec3(c.x * 0.4, c.y * 0.4 + 0.2, 1.0));
    } else if (shape > 0.5) {
      // Splinter: a thin tapered sliver.
      float taper = 1.0 - 0.6 * smoothstep(-1.0, 1.0, c.x);
      d = length(vec2(c.x, c.y * 4.5 / taper));
      nrm = normalize(vec3(0.0, c.y * 3.0, 1.0));
    } else {
      d = length(c);
      nrm = vec3(c, sqrt(max(0.0, 1.0 - d * d)));
    }
    if (d > 1.0) discard;
    float ndl = max(dot(nrm, vSun), 0.0);
    vec3 light = fxAmbColor * (0.8 + 0.3 * nrm.y) + fxSunColor * ndl * 0.85;
    float grain = 0.88 + 0.24 * vnoise(c * 3.0 + fract(vSeed) * 13.0);
    gl_FragColor = vec4(vColor * light * grain, vAlpha * smoothstep(1.0, 0.7, d));`,
  smoke: /* glsl */ `
    vec2 c0 = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 c = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs);
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float n = vnoise(c * 3.5 + vSeed * 17.0) * 0.6 + vnoise(c * 8.0 + vSeed * 29.0 + vAge * 1.5) * 0.4;
    float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.75);
    // Fake sphere normal (screen-aligned: y up), roughened by the noise, lit by the sun.
    vec2 q = vec2(c0.x, -c0.y) * 2.0;
    vec3 nrm = normalize(vec3(q + (n - 0.5) * 0.6, sqrt(max(0.05, 1.0 - dot(q, q)))));
    float wrap = clamp((dot(nrm, vSun) + 0.45) / 1.45, 0.0, 1.0);
    // Thicker centres self-shadow a little; thin rims catch the light.
    float thick = mix(0.82, 1.0, d);
    vec3 light = (fxAmbColor * (0.85 + 0.25 * nrm.y) + fxSunColor * wrap * 0.62) * thick;
    gl_FragColor = vec4(vColor * light, vAlpha * a * vNear);`,
  fire: /* glsl */ `
    vec2 c0 = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 c = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs);
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float n = vnoise(c * 4.0 + vSeed * 11.0 + vAge * 2.0) * 0.65 + vnoise(c * 9.0 + vSeed * 23.0) * 0.35;
    float a = smoothstep(1.0, 0.1, d + (n - 0.5) * 0.9);
    vec3 hot = vec3(1.0, 0.92, 0.7);
    vec3 mid = vec3(1.0, 0.48, 0.12);
    vec3 cool = vec3(0.45, 0.09, 0.02);
    vec3 ramp = mix(hot, mid, smoothstep(0.0, 0.3, vAge + (1.0 - n) * 0.15));
    ramp = mix(ramp, cool, smoothstep(0.3, 0.85, vAge));
    float core = 1.0 + (1.0 - d) * (1.0 - vAge) * 1.5;
    gl_FragColor = vec4(ramp * vColor * core, vAlpha * a * vNear);`,
  fireball: /* glsl */ `
    vec2 c0 = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 c = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs);
    if (dot(c, c) > 0.25) discard;
    vec2 uv = vec2(c.x, -c.y) + 0.5;
    float f = clamp(vAge, 0.0, 1.0) * ${(FLIPBOOK.frames - 1).toFixed(1)};
    float f0 = floor(f);
    float f1 = min(f0 + 1.0, ${(FLIPBOOK.frames - 1).toFixed(1)});
    const float COLS = ${FLIPBOOK.cols.toFixed(1)};
    vec2 cell0 = vec2(mod(f0, COLS), floor(f0 / COLS));
    vec2 cell1 = vec2(mod(f1, COLS), floor(f1 / COLS));
    vec2 inset = uv * (1.0 - 2.0 / ${FLIPBOOK.px.toFixed(1)}) + 1.0 / ${FLIPBOOK.px.toFixed(1)};
    vec4 t = mix(texture2D(map, (inset + cell0) / COLS), texture2D(map, (inset + cell1) / COLS), f - f0);
    float heat = t.r;
    float cov = t.g * vAlpha * vNear;
    vec3 ramp = mix(vec3(0.55, 0.1, 0.02), vec3(1.0, 0.46, 0.1), smoothstep(0.08, 0.45, heat));
    ramp = mix(ramp, vec3(1.0, 0.9, 0.66), smoothstep(0.55, 0.95, heat));
    vec3 emissive = ramp * vColor * heat * (1.4 + heat * 2.6);
    vec3 smoke = vec3(0.1, 0.092, 0.085) * (fxAmbColor * 0.9 + fxSunColor * t.b * 0.8);
    // Premultiplied: fire adds light, smoke occludes.
    gl_FragColor = vec4((emissive + smoke * (1.0 - heat)) * cov, cov * (1.0 - heat * 0.55));`,
};

/**
 * A fixed-size pool of point particles in one draw call. Each particle has
 * its own size and alpha (custom shader), velocity, drag, gravity and life,
 * and can optionally bounce off a floor height given at spawn.
 * spawn() reuses the oldest slot, so nothing is allocated at runtime.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly seed: Float32Array;
  private readonly age: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly floor: Float32Array;
  private next = 0;
  private live = 0;
  readonly style: ParticleStyle;
  /** Particles beyond this index are never spawned (quality setting). */
  cap: number;
  /** Floor height applied to subsequent spawns (-Infinity = fall forever). */
  spawnFloor = -Infinity;

  constructor(readonly capacity: number, additive: boolean, style?: ParticleStyle, light?: FxLightUniforms, map?: THREE.Texture) {
    this.cap = capacity;
    this.style = style ?? (additive ? "glow" : "chunk");
    const n = capacity;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.age = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.floor = new Float32Array(n).fill(-Infinity);

    const dyn = (a: Float32Array, s: number) => new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", dyn(this.pos, 3));
    this.geometry.setAttribute("color", dyn(this.col, 3));
    this.geometry.setAttribute("alpha", dyn(this.alpha, 1));
    this.geometry.setAttribute("size", dyn(this.size, 1));
    this.geometry.setAttribute("seed", dyn(this.seed, 1));
    this.geometry.setAttribute("age", dyn(this.age, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const lit = light ?? {
      fxSunDir: { value: new THREE.Vector3(0.35, 0.85, 0.4).normalize() },
      fxSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
      fxAmbColor: { value: new THREE.Color(0.62, 0.66, 0.72) },
      fxTime: { value: 0 },
    };
    const premul = this.style === "fireball";
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, map: { value: map ?? null }, ...lit },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        attribute float seed;
        attribute float age;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vAge;
        varying float vRot;
        varying float vNear;
        varying vec3 vSun;
        uniform float scale;
        ${FX_LIGHT_PARS}
        void main() {
          vColor = color;
          vAlpha = alpha;
          vSeed = seed;
          vAge = age;
          float s = fract(seed);
          vRot = s * 6.2831 + age * (s - 0.5) * ${ROT[this.style].toFixed(1)};
          vSun = normalize((viewMatrix * vec4(fxSunDir, 0.0)).xyz);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Camera-distance soft fade: big puffs dissolve instead of slicing the near plane.
          vNear = smoothstep(0.12, 0.3 + size * 0.9, -mv.z);
          gl_PointSize = size * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vAge;
        varying float vRot;
        varying float vNear;
        varying vec3 vSun;
        uniform sampler2D map;
        ${FX_LIGHT_PARS}
        ${NOISE_GLSL}
        void main() {
          ${FRAG[this.style]}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: premul ? THREE.CustomBlending : additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      ...(premul ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation } : {}),
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  /** Scale point sizes with viewport height so they look the same at any resolution. */
  setViewportHeight(h: number) {
    this.material.uniforms.scale.value = h * 0.5;
  }

  /** Live particle count upper bound (for tests / stats). */
  get activeWindow() {
    return this.live;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size0: number, size1: number, alpha: number, gravity: number, drag: number,
    shape = 0,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.floor[i] = this.spawnFloor;
    this.seed[i] = shape + Math.random() * 0.999;
    this.live = Math.max(this.live, i + 1);
  }

  update(dt: number) {
    const n = Math.min(this.live, this.capacity);
    const smoke = this.style === "smoke" || this.style === "fire" || this.style === "fireball";
    let maxAlive = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.pos[i * 3 + 1] = -9999;
        }
        continue;
      }
      maxAlive = i + 1;
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const i3 = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.gravity[i] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const fl = this.floor[i];
      if (this.pos[i3 + 1] < fl) {
        // Bounce once or twice, then skid to rest on the floor.
        this.pos[i3 + 1] = fl;
        const vy = -this.vel[i3 + 1];
        this.vel[i3 + 1] = vy > 1 ? vy * 0.3 : 0;
        this.vel[i3] *= 0.45;
        this.vel[i3 + 2] *= 0.45;
      }
      // Smoke grows fast then slows (ease-out); others lerp linearly.
      const st = smoke ? 1 - (1 - t) * (1 - t) : t;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * st;
      this.age[i] = t;
      // Fireballs punch in at full strength (the flipbook does its own burn-out).
      if (this.style === "fireball") this.alpha[i] = this.alpha0[i] * Math.min(1, t * 30) * Math.pow(1 - t, 0.7);
      else if (smoke) this.alpha[i] = this.alpha0[i] * Math.min(1, t * 9) * Math.pow(1 - t, 1.6);
      // Chips stay solid most of their life (they lie on the floor), then fade.
      else if (this.style === "chunk" && fl > -1e9) this.alpha[i] = this.alpha0[i] * Math.min(1, (1 - t) * 4);
      else this.alpha[i] = this.alpha0[i] * (1 - t) * (1 - t);
    }
    // Keep the live window tight so idle pools cost nothing (every slot is dead,
    // so the ring position doesn't matter: the next spawn reopens the window).
    if (maxAlive === 0) this.live = 0;
    this.geometry.setDrawRange(0, maxAlive);
    this.points.visible = maxAlive > 0;
    // Upload only what's drawn (slots past maxAlive are outside the draw range),
    // and nothing at all once idle.
    if (maxAlive === 0) return;
    const a = this.geometry.attributes;
    for (const k of UPLOAD) {
      const attr = a[k] as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, maxAlive * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
