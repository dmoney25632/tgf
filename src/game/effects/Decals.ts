import * as THREE from "three";

/** Atlas tiles (4 × 2). */
export const DECAL = {
  concreteA: 0,
  concreteB: 1,
  metal: 2,
  wood: 3,
  dirt: 4,
  blood: 5,
  scorch: 6,
  bloodB: 7,
} as const;

const T = 128;
const COLS = 4;
const ROWS = 2;

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number) {
  return noise(x, y, s) * 0.5 + noise(x * 2, y * 2, s + 1) * 0.3 + noise(x * 4, y * 4, s + 2) * 0.2;
}
const sat = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type Px = [number, number, number, number];

/** Per-tile painter: (u, v in -1..1) → straight-alpha RGBA (linear). */
const PAINTERS: ((u: number, v: number, out: Px) => void)[] = [
  // concrete A: pulverised light ring, rough dark crater, black core, faint cracks.
  (u, v, o) => concrete(u, v, o, 3),
  (u, v, o) => concrete(u, v, o, 11),
  // metal: black hole, bright bare-metal lip, scorched halo.
  (u, v, o) => {
    const r = Math.hypot(u, v) + (fbm(u * 5, v * 5, 21) - 0.5) * 0.08;
    const core = sstep(0.17, 0.12, r);
    const lip = sstep(0.12, 0.17, r) * sstep(0.3, 0.2, r);
    const halo = sstep(0.75, 0.25, r) * 0.55;
    const c = 0.05 * core + 0.75 * lip * (1 - core) + 0.12 * (1 - lip) * (1 - core);
    o[0] = c; o[1] = c * 0.97; o[2] = c * 0.93;
    o[3] = Math.max(core, lip * 0.95, halo * (0.6 + fbm(u * 8, v * 8, 22) * 0.4));
  },
  // wood: dark hole with splintered fibres along u.
  (u, v, o) => {
    const r = Math.hypot(u, v * 1.3);
    const core = sstep(0.2, 0.12, r);
    const fib = Math.pow(noise(u * 2.5, v * 22, 31), 2.5) * sstep(0.9, 0.2, Math.hypot(u * 0.55, v * 1.6));
    const tear = sstep(0.6, 0.18, Math.hypot(u * 0.7, v * 1.8)) * 0.7;
    o[0] = core ? 0.05 : 0.62; o[1] = core ? 0.035 : 0.46; o[2] = core ? 0.02 : 0.28;
    if (core < 0.5) { o[0] = 0.08 + fib * 0.6; o[1] = 0.05 + fib * 0.45; o[2] = 0.03 + fib * 0.26; }
    o[3] = Math.max(core, tear * (0.4 + fib * 0.6));
  },
  // dirt / sand: soft dark crater, no hard edge.
  (u, v, o) => {
    const r = Math.hypot(u, v) + (fbm(u * 3, v * 3, 41) - 0.5) * 0.35;
    const a = sstep(0.85, 0.2, r);
    const c = 0.07 + sstep(0.15, 0.6, r) * 0.08;
    o[0] = c * 1.1; o[1] = c; o[2] = c * 0.75;
    o[3] = a * 0.85;
  },
  // blood A: central splat + satellite droplets.
  (u, v, o) => blood(u, v, o, 51),
  // scorch: soot with radial streaks.
  (u, v, o) => {
    const r = Math.hypot(u, v);
    const a0 = Math.atan2(v, u);
    const streak = 0.75 + noise(a0 * 4, 0, 61) * 0.5;
    const n = fbm(u * 3, v * 3, 62);
    const a = sstep(0.95 * streak, 0.15, r + (n - 0.5) * 0.25);
    o[0] = 0.03 + n * 0.03; o[1] = 0.025 + n * 0.025; o[2] = 0.02 + n * 0.02;
    o[3] = a * (0.75 + n * 0.25);
  },
  (u, v, o) => blood(u, v, o, 71),
];

function concrete(u: number, v: number, o: Px, s: number) {
  const ang = Math.atan2(v, u);
  const jag = (noise(ang * 3 + s, 0, s) - 0.5) * 0.18;
  const r = Math.hypot(u, v) + jag + (fbm(u * 6, v * 6, s) - 0.5) * 0.1;
  const core = sstep(0.16, 0.09, r);
  const crater = sstep(0.42, 0.28, r);
  const dust = sstep(0.95, 0.45, r) * (0.35 + fbm(u * 4, v * 4, s + 5) * 0.5);
  let crack = 0;
  for (let k = 0; k < 4; k++) {
    const a = hash(k, s, 7) * Math.PI * 2;
    const d = Math.abs(Math.sin(ang - a)) * Math.hypot(u, v);
    if (Math.cos(ang - a) > 0) crack = Math.max(crack, sstep(0.025, 0.0, d) * sstep(0.85, 0.3, Math.hypot(u, v)));
  }
  const base = 0.5 + fbm(u * 5, v * 5, s + 9) * 0.12; // pulverised dust (lighter)
  const dark = 0.13 + fbm(u * 9, v * 9, s + 3) * 0.08;
  let c = base;
  let a = dust * 0.5;
  if (crater > 0) {
    c = base * (1 - crater) + dark * crater;
    a = Math.max(a, crater * 0.92);
  }
  if (crack > 0 && crater < 0.5) {
    c = c * (1 - crack) + 0.12 * crack;
    a = Math.max(a, crack * 0.7);
  }
  c = c * (1 - core) + 0.03 * core;
  a = Math.max(a, core);
  o[0] = c; o[1] = c * 0.98; o[2] = c * 0.94; o[3] = a;
}

function blood(u: number, v: number, o: Px, s: number) {
  const r = Math.hypot(u, v) + (fbm(u * 2.5, v * 2.5, s) - 0.5) * 0.45;
  let a = sstep(0.55, 0.35, r);
  for (let k = 0; k < 9; k++) {
    const ang = hash(k, s, 1) * Math.PI * 2;
    const dist = 0.45 + hash(k, s, 2) * 0.45;
    const rad = 0.03 + hash(k, s, 3) * 0.06;
    const d = Math.hypot(u - Math.cos(ang) * dist, v - Math.sin(ang) * dist);
    a = Math.max(a, sstep(rad, rad * 0.5, d));
  }
  const n = fbm(u * 6, v * 6, s + 4);
  o[0] = 0.16 + n * 0.08; o[1] = 0.008; o[2] = 0.008;
  o[3] = a * (0.82 + n * 0.18);
}

function buildAtlas() {
  const W = T * COLS;
  const H = T * ROWS;
  const data = new Uint8Array(W * H * 4);
  const px: Px = [0, 0, 0, 0];
  for (let tile = 0; tile < COLS * ROWS; tile++) {
    const ox = (tile % COLS) * T;
    const oy = Math.floor(tile / COLS) * T;
    const paint = PAINTERS[tile];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = ((x + 0.5) / T) * 2 - 1;
        const v = ((y + 0.5) / T) * 2 - 1;
        paint(u, v, px);
        // Hard-clip outside the unit circle so tiles never show square edges.
        const edge = sstep(1, 0.92, Math.hypot(u, v));
        const i = ((oy + y) * W + ox + x) * 4;
        data[i] = sat(px[0]) * 255;
        data[i + 1] = sat(px[1]) * 255;
        data[i + 2] = sat(px[2]) * 255;
        data[i + 3] = sat(px[3] * edge) * 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bullet holes, blood and scorch marks: one instanced draw call with a
 * procedural atlas and per-instance tile + tint, ring-buffered.
 */
export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly tex: THREE.DataTexture;
  private readonly tile: Float32Array;
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private next = 0;
  cap: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly look = new THREE.Matrix4();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly alt = new THREE.Vector3(1, 0, 0);
  private readonly target = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, readonly capacity: number, cap: number) {
    this.cap = Math.min(cap, capacity);
    this.tex = buildAtlas();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.tile = new Float32Array(capacity);
    this.tileAttr = new THREE.InstancedBufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aTile", this.tileAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute float aTile;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vec2 cell = vec2(mod(aTile, ${COLS}.0), floor(aTile / ${COLS}.0));
          vUv = (uv + cell) / vec2(${COLS}.0, ${ROWS}.0);
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.01) discard;
          gl_FragColor = t;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    mat.uniforms.map.value = this.tex;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
  }

  setCap(cap: number) {
    this.cap = Math.max(1, Math.min(cap, this.capacity));
    for (let i = this.cap; i < this.capacity; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next %= this.cap;
  }

  /** Place a decal of `size` metres facing along `normal`. */
  add(point: THREE.Vector3, normal: THREE.Vector3, tile: number, size: number, stretch = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.p.copy(point).addScaledVector(normal, 0.003);
    // Orient +Z along the normal with a random twist.
    const ref = Math.abs(normal.y) > 0.95 ? this.alt : this.up;
    this.target.copy(this.p).add(normal);
    this.look.lookAt(this.target, this.p, ref);
    this.q.setFromRotationMatrix(this.look);
    this.q.multiply(this.qTwist(Math.random() * Math.PI * 2));
    this.s.set(size * stretch, size, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.tile[i] = tile;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tileAttr.needsUpdate = true;
  }

  private readonly twist = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private qTwist(a: number) {
    return this.twist.setFromAxisAngle(this.zAxis, a);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
    this.mesh.dispose();
  }
}
