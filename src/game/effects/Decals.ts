import * as THREE from "three";
import { FX_LIGHT_PARS, type FxLightUniforms } from "./FxLighting";
import { fbm, hash, noise, sat, sstep } from "./ProceduralFx";

/** Atlas tiles (4 × 4). */
export const DECAL = {
  concreteA: 0,
  concreteB: 1,
  metal: 2,
  metalPaint: 3,
  wood: 4,
  woodB: 5,
  dirt: 6,
  dirtB: 7,
  blood: 8,
  bloodB: 9,
  scorch: 10,
  glass: 11,
  plaster: 12,
  brick: 13,
  scorchSmall: 14,
  sand: 15,
} as const;
export type DecalTile = (typeof DECAL)[keyof typeof DECAL];

const T = 128;
const COLS = 4;
const ROWS = 4;

/** Straight-alpha RGBA (linear) + height (0.5 = wall surface, lower = deeper). */
type Px = [number, number, number, number, number];

const set = (o: Px, r: number, g: number, b: number, a: number, h: number) => {
  o[0] = r; o[1] = g; o[2] = b; o[3] = a; o[4] = h;
};

/** Per-tile painter: (u, v in -1..1) → colour, alpha, height. */
const PAINTERS: ((u: number, v: number, out: Px) => void)[] = [
  (u, v, o) => concrete(u, v, o, 3, [1, 0.98, 0.94], 1),
  (u, v, o) => concrete(u, v, o, 11, [1, 0.98, 0.94], 1),
  // metal: punched hole, petalled bright lip, dished dent with soot.
  (u, v, o) => {
    const r = Math.hypot(u, v) + (fbm(u * 5, v * 5, 21) - 0.5) * 0.08;
    const ang = Math.atan2(v, u);
    const core = sstep(0.15, 0.1, r);
    const petals = 0.6 + 0.4 * Math.abs(Math.sin(ang * 3 + 0.7));
    const lip = sstep(0.1, 0.15, r) * sstep(0.26 * petals + 0.06, 0.16, r);
    const halo = sstep(0.7, 0.2, r);
    const c = 0.04 * core + 0.78 * lip * (1 - core) + 0.13 * (1 - lip) * (1 - core);
    const a = Math.max(core, lip * 0.95, halo * (0.35 + fbm(u * 8, v * 8, 22) * 0.35));
    set(o, c, c * 0.97, c * 0.93, a, 0.5 - halo * 0.16 + lip * 0.28 - core * 0.5);
  },
  // painted metal: hole, bright bare-metal ring where the paint flaked off, dent.
  (u, v, o) => {
    const r = Math.hypot(u, v);
    const chip = r + (fbm(u * 6, v * 6, 25) - 0.5) * 0.28;
    const core = sstep(0.14, 0.09, r);
    const bare = sstep(0.42, 0.36, chip);
    const dent = sstep(0.75, 0.15, r);
    let c = 0.6 + noise(u * 30, v * 30, 26) * 0.12;
    c = c * (1 - core) + 0.03 * core;
    const edge = sstep(0.34, 0.4, chip) * sstep(0.46, 0.4, chip);
    set(o, c, c * 0.98, c * 0.95, Math.max(core, bare * 0.92, edge * 0.6, dent * 0.12), 0.5 - dent * 0.14 - bare * 0.06 - core * 0.4 + edge * 0.12);
  },
  (u, v, o) => wood(u, v, o, 31),
  (u, v, o) => wood(u, v, o, 37),
  (u, v, o) => dirt(u, v, o, 41, 0.85),
  (u, v, o) => dirt(u, v, o, 47, 1.1),
  (u, v, o) => blood(u, v, o, 51),
  (u, v, o) => blood(u, v, o, 71),
  // scorch: soot with radial streaks.
  (u, v, o) => scorch(u, v, o, 61),
  // glass: small hole, spider-web cracks catching the light.
  (u, v, o) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    let line = 0;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + (hash(k, 3, 81) - 0.5) * 0.5;
      const d = Math.abs(Math.sin(ang - a)) * r;
      if (Math.cos(ang - a) > 0) line = Math.max(line, sstep(0.018, 0, d) * sstep(0.6 + hash(k, 4, 81) * 0.35, 0.15, r));
    }
    for (let k = 0; k < 3; k++) {
      const rr = 0.2 + k * 0.17 + (noise(ang * 3, k, 82) - 0.5) * 0.06;
      const ringOn = noise(ang * 4 + k * 7, k, 83) > 0.45 ? 1 : 0;
      line = Math.max(line, ringOn * sstep(0.014, 0, Math.abs(r - rr)) * 0.8);
    }
    const core = sstep(0.09, 0.05, r);
    const frost = sstep(0.2, 0.06, r) * 0.7;
    const c = core ? 0.06 : 0.85;
    set(o, c, c * 1.01, c * 1.03, Math.max(core, line * 0.85, frost), 0.5 + line * 0.25 - core * 0.4);
  },
  // plaster: wide shallow crater with flaked paint, bright powdery inside.
  (u, v, o) => {
    const ang = Math.atan2(v, u);
    const r = Math.hypot(u, v) + (noise(ang * 3, 0, 91) - 0.5) * 0.16 + (fbm(u * 5, v * 5, 92) - 0.5) * 0.1;
    const core = sstep(0.14, 0.08, r);
    const crater = sstep(0.55, 0.42, r);
    const flake = sstep(0.62, 0.55, r) * (1 - crater);
    const inner = 0.72 + fbm(u * 8, v * 8, 93) * 0.12;
    let c = inner;
    c = c * (1 - core) + 0.05 * core;
    const a = Math.max(core, crater * 0.9, flake * 0.55);
    set(o, c, c * 0.97, c * 0.92, a, 0.5 - crater * (0.2 + fbm(u * 10, v * 10, 94) * 0.1) - core * 0.3 + flake * 0.08);
  },
  (u, v, o) => concrete(u, v, o, 17, [1.25, 0.66, 0.5], 0.85),
  (u, v, o) => scorch(u, v, o, 97),
  // sand: soft dimple with a dark core.
  (u, v, o) => {
    const r = Math.hypot(u, v) + (fbm(u * 3, v * 3, 101) - 0.5) * 0.25;
    const a = sstep(0.7, 0.1, r);
    const c = 0.11 + sstep(0.1, 0.5, r) * 0.1;
    set(o, c * 1.15, c, c * 0.72, a * 0.6, 0.5 - sstep(0.6, 0.05, r) * 0.25 + sstep(0.5, 0.65, r) * sstep(0.8, 0.65, r) * 0.08);
  },
];

function concrete(u: number, v: number, o: Px, s: number, tint: [number, number, number], dustK: number) {
  const ang = Math.atan2(v, u);
  const jag = (noise(ang * 3 + s, 0, s) - 0.5) * 0.18;
  const rr = Math.hypot(u, v);
  const r = rr + jag + (fbm(u * 6, v * 6, s) - 0.5) * 0.1;
  const core = sstep(0.16, 0.09, r);
  const crater = sstep(0.42, 0.28, r);
  const dust = sstep(0.95, 0.45, r) * (0.35 + fbm(u * 4, v * 4, s + 5) * 0.5);
  let crack = 0;
  for (let k = 0; k < 4; k++) {
    const a = hash(k, s, 7) * Math.PI * 2;
    const d = Math.abs(Math.sin(ang - a)) * rr;
    if (Math.cos(ang - a) > 0) crack = Math.max(crack, sstep(0.025, 0.0, d) * sstep(0.85, 0.3, rr));
  }
  const base = 0.5 + fbm(u * 5, v * 5, s + 9) * 0.12; // pulverised dust (lighter)
  const rough = fbm(u * 9, v * 9, s + 3);
  const dark = 0.13 + rough * 0.08;
  let c = base;
  let a = dust * 0.5 * dustK;
  let h = 0.5;
  if (crater > 0) {
    c = base * (1 - crater) + dark * crater;
    a = Math.max(a, crater * 0.92);
    h -= crater * (0.25 + rough * 0.2);
  }
  // Raised broken lip around the crater.
  h += sstep(0.3, 0.42, r) * sstep(0.55, 0.42, r) * 0.1;
  if (crack > 0 && crater < 0.5) {
    c = c * (1 - crack) + 0.12 * crack;
    a = Math.max(a, crack * 0.7);
    h -= crack * 0.08;
  }
  c = c * (1 - core) + 0.03 * core;
  a = Math.max(a, core);
  h -= core * 0.3;
  set(o, sat(c * tint[0]), sat(c * tint[1]), sat(c * tint[2]), a, h);
}

function wood(u: number, v: number, o: Px, s: number) {
  const r = Math.hypot(u, v * 1.3);
  const core = sstep(0.2, 0.12, r);
  const fib = Math.pow(noise(u * 2.5, v * 22, s), 2.5) * sstep(0.9, 0.2, Math.hypot(u * 0.55, v * 1.6));
  const tear = sstep(0.6, 0.18, Math.hypot(u * 0.7, v * 1.8)) * 0.7;
  // Exposed pale inner wood around the hole, dark fibres.
  const pale = sstep(0.45, 0.2, Math.hypot(u * 0.8, v * 1.5)) * (1 - core);
  let r0 = 0.08 + fib * 0.6 + pale * 0.35, g0 = 0.05 + fib * 0.45 + pale * 0.27, b0 = 0.03 + fib * 0.26 + pale * 0.16;
  if (core > 0.5) { r0 = 0.05; g0 = 0.035; b0 = 0.02; }
  set(o, r0, g0, b0, Math.max(core, tear * (0.4 + fib * 0.6)), 0.5 + fib * 0.22 - core * 0.45 - pale * 0.05);
}

function dirt(u: number, v: number, o: Px, s: number, scale: number) {
  const r = (Math.hypot(u, v) + (fbm(u * 3, v * 3, s) - 0.5) * 0.35) * scale;
  const a = sstep(0.85, 0.2, r);
  const c = 0.07 + sstep(0.15, 0.6, r) * 0.08;
  const rim = sstep(0.45, 0.65, r) * sstep(0.85, 0.65, r);
  set(o, c * 1.1, c, c * 0.75, a * 0.85, 0.5 - sstep(0.6, 0.05, r) * 0.3 + rim * 0.12);
}

function scorch(u: number, v: number, o: Px, s: number) {
  const r = Math.hypot(u, v);
  const a0 = Math.atan2(v, u);
  const streak = 0.75 + noise(a0 * 4, 0, s) * 0.5;
  const n = fbm(u * 3, v * 3, s + 1);
  const a = sstep(0.95 * streak, 0.15, r + (n - 0.5) * 0.25);
  set(o, 0.03 + n * 0.03, 0.025 + n * 0.025, 0.02 + n * 0.02, a * (0.75 + n * 0.25), 0.5 - sstep(0.4, 0, r) * 0.08);
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
  set(o, 0.16 + n * 0.08, 0.008, 0.008, a * (0.82 + n * 0.18), 0.5 + a * 0.04);
}

/** Builds the colour atlas and a matching tangent-space normal atlas (from the painted heights). */
export function buildDecalAtlas(tileSize = T) {
  const W = tileSize * COLS;
  const H = tileSize * ROWS;
  const data = new Uint8Array(W * H * 4);
  const nrm = new Uint8Array(W * H * 4);
  const height = new Float32Array(tileSize * tileSize);
  const px: Px = [0, 0, 0, 0, 0.5];
  for (let tile = 0; tile < COLS * ROWS; tile++) {
    const ox = (tile % COLS) * tileSize;
    const oy = Math.floor(tile / COLS) * tileSize;
    const paint = PAINTERS[tile];
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const u = ((x + 0.5) / tileSize) * 2 - 1;
        const v = ((y + 0.5) / tileSize) * 2 - 1;
        px[4] = 0.5;
        paint(u, v, px);
        // Soft-clip outside the unit circle so tiles never show square edges.
        const edge = sstep(1, 0.86, Math.hypot(u, v));
        const i = ((oy + y) * W + ox + x) * 4;
        data[i] = sat(px[0]) * 255;
        data[i + 1] = sat(px[1]) * 255;
        data[i + 2] = sat(px[2]) * 255;
        data[i + 3] = sat(px[3] * edge) * 255;
        height[y * tileSize + x] = 0.5 + (px[4] - 0.5) * edge;
      }
    }
    // Height → normal (central differences, clamped at the tile border).
    const k = tileSize / 24;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const hx = height[y * tileSize + Math.min(tileSize - 1, x + 1)] - height[y * tileSize + Math.max(0, x - 1)];
        const hy = height[Math.min(tileSize - 1, y + 1) * tileSize + x] - height[Math.max(0, y - 1) * tileSize + x];
        let nx = -hx * k, ny = -hy * k;
        const nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l;
        const i = ((oy + y) * W + ox + x) * 4;
        nrm[i] = (nx * 0.5 + 0.5) * 255;
        nrm[i + 1] = (ny * 0.5 + 0.5) * 255;
        nrm[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        nrm[i + 3] = 255;
      }
    }
  }
  return { data, nrm, width: W, height: H };
}

function dataTex(d: Uint8Array, w: number, h: number) {
  const tex = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bullet holes, blood and scorch marks: one instanced draw call with a
 * procedural colour + normal atlas, per-instance tile and birth time,
 * ring-buffered. Holes are shaded from their normal map by the scene sun
 * (relative to the flat wall, so they read as craters without fighting
 * the wall's own lighting) and fade out after `life` seconds.
 */
export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly tex: THREE.DataTexture;
  private readonly ntex: THREE.DataTexture;
  private readonly tile: Float32Array;
  private readonly born: Float32Array;
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private readonly bornAttr: THREE.InstancedBufferAttribute;
  private readonly lifeU = { value: 60 };
  private readonly light: FxLightUniforms;
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

  constructor(scene: THREE.Scene, readonly capacity: number, cap: number, light?: FxLightUniforms) {
    this.cap = Math.min(cap, capacity);
    this.light = light ?? { fxSunDir: { value: new THREE.Vector3(0, 1, 0) }, fxSunColor: { value: new THREE.Color(1, 1, 1) }, fxAmbColor: { value: new THREE.Color(0.6, 0.6, 0.6) }, fxTime: { value: 0 } };
    const atlas = buildDecalAtlas();
    this.tex = dataTex(atlas.data, atlas.width, atlas.height);
    this.ntex = dataTex(atlas.nrm, atlas.width, atlas.height);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.tile = new Float32Array(capacity);
    this.born = new Float32Array(capacity).fill(-1e6);
    this.tileAttr = new THREE.InstancedBufferAttribute(this.tile, 1).setUsage(THREE.DynamicDrawUsage);
    this.bornAttr = new THREE.InstancedBufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aTile", this.tileAttr);
    geo.setAttribute("aBorn", this.bornAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, nmap: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute float aTile;
        attribute float aBorn;
        uniform float life;
        ${FX_LIGHT_PARS}
        varying vec2 vUv;
        varying float vFade;
        varying vec3 vT;
        varying vec3 vB;
        varying vec3 vN;
        #include <fog_pars_vertex>
        void main() {
          vec2 cell = vec2(mod(aTile, ${COLS}.0), floor(aTile / ${COLS}.0));
          vUv = (uv + cell) / vec2(${COLS}.0, ${ROWS}.0);
          mat3 basis = mat3(instanceMatrix);
          vT = normalize(basis[0]);
          vB = normalize(basis[1]);
          vN = normalize(basis[2]);
          float age = fxTime - aBorn;
          vFade = 1.0 - smoothstep(life * 0.7, life, age);
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform sampler2D nmap;
        ${FX_LIGHT_PARS}
        varying vec2 vUv;
        varying float vFade;
        varying vec3 vT;
        varying vec3 vB;
        varying vec3 vN;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          float a = t.a * vFade;
          if (a < 0.01) discard;
          vec3 tn = texture2D(nmap, vUv).xyz * 2.0 - 1.0;
          vec3 n = normalize(vT * tn.x + vB * tn.y + vN * tn.z);
          float amb = dot(fxAmbColor, vec3(0.333));
          float sun = dot(fxSunColor, vec3(0.333));
          // Relative to the flat wall: craters darken on the shadowed side, lips catch the sun.
          float lit = amb + sun * max(dot(n, fxSunDir), 0.0);
          float flat0 = amb + sun * max(dot(vN, fxSunDir), 0.0);
          float rel = clamp(lit / max(flat0, 0.05), 0.45, 1.6);
          // Overall scene brightness so holes don't glow on night maps.
          float level = clamp(amb * 1.1 + sun * 0.45, 0.12, 1.15);
          gl_FragColor = vec4(t.rgb * rel * level, a);
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
    mat.uniforms.nmap.value = this.ntex;
    mat.uniforms.life = this.lifeU;
    Object.assign(mat.uniforms, this.light);
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

  /** Seconds a decal stays before it fades away (fade over the last 30%). */
  setLife(seconds: number) {
    this.lifeU.value = seconds;
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
    this.born[i] = this.light.fxTime.value;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tileAttr.needsUpdate = true;
    this.bornAttr.needsUpdate = true;
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
    this.ntex.dispose();
    this.mesh.dispose();
  }
}
