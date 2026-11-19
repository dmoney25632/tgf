import * as THREE from "three";

/**
 * Visual style of a particle pool:
 *   glow  — additive soft dot (sparks, embers)
 *   chunk — opaque-ish hard dot with top lighting (chips, dirt, droplets)
 *   smoke — alpha-blended noisy puff that fades in then out (dust, smoke, mist)
 *   fire  — additive noisy puff with an age colour ramp (fireballs, muzzle puffs)
 */
export type ParticleStyle = "glow" | "chunk" | "smoke" | "fire";

const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const FRAG: Record<ParticleStyle, string> = {
  glow: /* glsl */ `
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - d);
    a *= a;
    gl_FragColor = vec4(vColor * (0.6 + 0.8 * a), vAlpha * a);`,
  chunk: /* glsl */ `
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float shade = 0.72 + 0.45 * (-c.y) + 0.12 * vnoise(c * 6.0 + vSeed * 13.0);
    gl_FragColor = vec4(vColor * shade, vAlpha * smoothstep(1.0, 0.55, d));`,
  smoke: /* glsl */ `
    vec2 c0 = gl_PointCoord - 0.5;
    float cs = cos(vRot), sn = sin(vRot);
    vec2 c = vec2(c0.x * cs - c0.y * sn, c0.x * sn + c0.y * cs);
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float n = vnoise(c * 3.5 + vSeed * 17.0) * 0.6 + vnoise(c * 8.0 + vSeed * 29.0 + vAge * 1.5) * 0.4;
    float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.75);
    float light = 0.78 + 0.42 * (0.5 - gl_PointCoord.y) + (n - 0.5) * 0.25;
    gl_FragColor = vec4(vColor * light, vAlpha * a);`,
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
    gl_FragColor = vec4(ramp * vColor * core, vAlpha * a);`,
};

/**
 * A fixed-size pool of point particles in one draw call. Each particle has
 * its own size and alpha (custom shader), velocity, drag, gravity and life.
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
  private next = 0;
  private live = 0;
  readonly style: ParticleStyle;
  /** Particles beyond this index are never spawned (quality setting). */
  cap: number;

  constructor(readonly capacity: number, additive: boolean, style?: ParticleStyle) {
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

    const dyn = (a: Float32Array, s: number) => new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", dyn(this.pos, 3));
    this.geometry.setAttribute("color", dyn(this.col, 3));
    this.geometry.setAttribute("alpha", dyn(this.alpha, 1));
    this.geometry.setAttribute("size", dyn(this.size, 1));
    this.geometry.setAttribute("seed", dyn(this.seed, 1));
    this.geometry.setAttribute("age", dyn(this.age, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
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
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vSeed = seed;
          vAge = age;
          vRot = seed * 6.2831 + age * (seed - 0.5) * 3.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vAge;
        varying float vRot;
        ${NOISE_GLSL}
        void main() {
          ${FRAG[this.style]}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  /** Scale point sizes with viewport height so they look the same at any resolution. */
  setViewportHeight(h: number) {
    this.material.uniforms.scale.value = h * 0.5;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size0: number, size1: number, alpha: number, gravity: number, drag: number,
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
    this.seed[i] = Math.random();
    this.live = Math.max(this.live, i + 1);
  }

  update(dt: number) {
    const n = Math.min(this.live, this.capacity);
    const smoke = this.style === "smoke" || this.style === "fire";
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
      // Smoke grows fast then slows (ease-out); others lerp linearly.
      const st = smoke ? 1 - (1 - t) * (1 - t) : t;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * st;
      this.age[i] = t;
      this.alpha[i] = smoke ? this.alpha0[i] * Math.min(1, t * 9) * Math.pow(1 - t, 1.6) : this.alpha0[i] * (1 - t) * (1 - t);
    }
    // Keep the live window tight so idle pools cost nothing.
    if (maxAlive === 0 && this.next === 0) this.live = 0;
    this.geometry.setDrawRange(0, Math.max(maxAlive, 1));
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.color.needsUpdate = true;
    a.alpha.needsUpdate = true;
    a.size.needsUpdate = true;
    a.seed.needsUpdate = true;
    a.age.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
