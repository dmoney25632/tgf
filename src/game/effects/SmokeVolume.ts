import * as THREE from "three";
import type { QualityName } from "../config";
import { FX_LIGHT_PARS, fxLightingFor, type FxLighting } from "./FxLighting";

/** Puffs per smoke-grenade cloud by quality (the cloud keeps its size; fewer, bigger puffs on low). */
export const SMOKE_VOLUME_PUFFS: Record<QualityName, number> = { low: 14, medium: 22, high: 30 };
/** Canister jet puffs per cloud (cycle out of the can while it hisses). */
const JET = 6;
const MAX_CLOUDS = 4;
const MAX_PUFFS = SMOKE_VOLUME_PUFFS.high + JET;

type Cloud = {
  active: boolean;
  pos: THREE.Vector3;
  age: number;
  life: number;
  radius: number;
  /** Per puff: offset x/y/z, size jitter, seed. */
  puff: Float32Array;
};

const STRIDE = 5;

/**
 * Smoke-grenade clouds: every puff of every cloud in one instanced,
 * camera-facing draw call with a procedural (shader-noise) billow, sun /
 * sky lighting from the scene, self-shadowing toward the cloud's core and
 * base, a camera-distance fade, and a hissing jet out of the canister.
 * Puffs are depth-sorted back to front per frame (≤ 144 instances).
 */
export class SmokeVolume {
  readonly mesh: THREE.InstancedMesh;
  private readonly clouds: Cloud[] = [];
  private readonly params: Float32Array;
  private readonly shade: Float32Array;
  private readonly paramsAttr: THREE.InstancedBufferAttribute;
  private readonly shadeAttr: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly light: FxLighting;
  private puffs = SMOKE_VOLUME_PUFFS.high;
  // Per-frame instance staging (unsorted) + sort scratch.
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly cz: Float32Array;
  private readonly ps: Float32Array;
  private readonly pa: Float32Array;
  private readonly pseed: Float32Array;
  private readonly pshade: Float32Array;
  private readonly order: number[] = [];
  private readonly key: Float32Array;
  private live = 0;
  private readonly m = new THREE.Matrix4();
  private readonly cam = new THREE.Vector3();

  constructor(scene: THREE.Scene, quality: QualityName = "high") {
    this.light = fxLightingFor(scene);
    const cap = MAX_CLOUDS * MAX_PUFFS;
    this.params = new Float32Array(cap * 4);
    this.shade = new Float32Array(cap);
    this.cx = new Float32Array(cap);
    this.cy = new Float32Array(cap);
    this.cz = new Float32Array(cap);
    this.ps = new Float32Array(cap);
    this.pa = new Float32Array(cap);
    this.pseed = new Float32Array(cap);
    this.pshade = new Float32Array(cap);
    this.key = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.order.push(i);
    for (let i = 0; i < MAX_CLOUDS; i++) {
      this.clouds.push({ active: false, pos: new THREE.Vector3(), age: 0, life: 0, radius: 5, puff: new Float32Array(MAX_PUFFS * STRIDE) });
    }

    const geo = new THREE.PlaneGeometry(1, 1);
    this.paramsAttr = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage);
    this.shadeAttr = new THREE.InstancedBufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPuff", this.paramsAttr); // size, alpha, seed, (unused)
    geo.setAttribute("aShade", this.shadeAttr); // 0 = lit rim … 1 = deep inside
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: /* glsl */ `
        attribute vec4 aPuff;
        attribute float aShade;
        ${FX_LIGHT_PARS}
        varying vec2 vQ;
        varying float vAlpha;
        varying float vSeed;
        varying float vShade;
        varying vec3 vSun;
        #include <fog_pars_vertex>
        void main() {
          vec3 centre = vec3(instanceMatrix[3]);
          vec4 mvPosition = viewMatrix * vec4(centre, 1.0);
          float ang = aPuff.z * 6.2831 + fxTime * 0.04 * (aPuff.z - 0.5);
          vec2 corner = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy;
          mvPosition.xy += corner * aPuff.x;
          gl_Position = projectionMatrix * mvPosition;
          vQ = position.xy * 2.0;
          // Fade puffs that reach the camera instead of letting them slice the near plane.
          float depth = -mvPosition.z;
          vAlpha = aPuff.y * smoothstep(0.15, 0.4 + aPuff.x * 0.35, depth);
          vSeed = aPuff.z;
          vShade = aShade;
          vSun = normalize((viewMatrix * vec4(fxSunDir, 0.0)).xyz);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        ${FX_LIGHT_PARS}
        varying vec2 vQ;
        varying float vAlpha;
        varying float vSeed;
        varying float vShade;
        varying vec3 vSun;
        #include <fog_pars_fragment>
        float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float r2 = dot(vQ, vQ);
          if (r2 > 1.0) discard;
          vec2 drift = vec2(fxTime * 0.05, -fxTime * 0.08);
          float n = vnoise(vQ * 2.2 + vSeed * 31.0 + drift) * 0.55 + vnoise(vQ * 5.0 + vSeed * 57.0 - drift * 1.7) * 0.3 + vnoise(vQ * 11.0 + vSeed * 13.0) * 0.15;
          float a = smoothstep(1.0, 0.25, sqrt(r2) + (n - 0.5) * 0.7);
          if (a * vAlpha < 0.004) discard;
          vec3 nrm = normalize(vec3(vQ + (n - 0.5) * 0.8, sqrt(max(0.05, 1.0 - r2))));
          float wrap = clamp((dot(nrm, vSun) + 0.5) / 1.5, 0.0, 1.0);
          float occl = 1.0 - vShade * 0.45;
          vec3 base = vec3(0.8, 0.81, 0.79);
          vec3 light = fxAmbColor * (0.8 + 0.3 * nrm.y) * occl + fxSunColor * wrap * 0.7 * (1.0 - vShade * 0.6);
          gl_FragColor = vec4(base * light, a * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    Object.assign(this.material.uniforms, this.light.uniforms);
    this.mesh = new THREE.InstancedMesh(geo, this.material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = "smoke-volume";
    // Remember where the rendering camera is; update() sorts against it.
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.cam.setFromMatrixPosition(camera.matrixWorld);
    };
    scene.add(this.mesh);
    this.setQuality(quality);
  }

  setQuality(q: QualityName) {
    this.puffs = SMOKE_VOLUME_PUFFS[q];
  }

  /** Pop a cloud at `at` (the oldest is recycled past MAX_CLOUDS). */
  spawn(at: THREE.Vector3, radius: number, duration: number) {
    let c = this.clouds.find((x) => !x.active);
    if (!c) c = this.clouds.reduce((a, b) => (a.age > b.age ? a : b));
    c.active = true;
    c.pos.copy(at);
    c.age = 0;
    c.life = duration;
    c.radius = radius;
    for (let i = 0; i < MAX_PUFFS; i++) {
      // Dome-shaped spread: denser low, wider than tall.
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.85;
      const o = i * STRIDE;
      c.puff[o] = Math.cos(a) * rr;
      c.puff[o + 1] = 0.3 + Math.pow(Math.random(), 1.4) * radius * 0.8;
      c.puff[o + 2] = Math.sin(a) * rr;
      c.puff[o + 3] = 0.8 + Math.random() * 0.45;
      c.puff[o + 4] = Math.random();
    }
  }

  reset() {
    for (const c of this.clouds) c.active = false;
    this.live = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  update(dt: number) {
    this.light.syncLights();
    let n = 0;
    const per = this.puffs;
    // Fewer puffs on low: each one a bit bigger so the screen stays opaque.
    const sizeK = Math.sqrt(SMOKE_VOLUME_PUFFS.high / per);
    for (const c of this.clouds) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.active = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, c.age / 4), 2);
      const fade = Math.min(1, (c.life - c.age) / 5);
      const fadeIn = Math.min(1, c.age * 3);
      for (let i = 0; i < per; i++) {
        const o = i * STRIDE;
        const ox = c.puff[o], oy = c.puff[o + 1], oz = c.puff[o + 2];
        const seed = c.puff[o + 4];
        // Slow churn so the wall of smoke never looks frozen.
        const wob = Math.sin(c.age * 0.35 + seed * 6.28) * 0.25;
        this.cx[n] = c.pos.x + ox * grow + wob;
        this.cy[n] = c.pos.y + oy * grow + c.age * 0.03;
        this.cz[n] = c.pos.z + oz * grow - wob;
        this.ps[n] = (1.9 + seed * 0.9) * c.puff[o + 3] * sizeK * (0.3 + 0.7 * grow) * (1 + c.age * 0.012);
        this.pa[n] = 0.8 * fade * fadeIn;
        this.pseed[n] = seed;
        // Deep puffs (near the core and the ground) are in the cloud's own shadow.
        const rad = Math.hypot(ox, oz) / c.radius;
        const h = oy / (c.radius * 0.8);
        this.pshade[n] = Math.min(1, Math.max(0, 1 - rad) * 0.7 + Math.max(0, 1 - h) * 0.35);
        n++;
      }
      // Canister jet: small puffs streaming up out of the can while it hisses.
      const hiss = Math.max(0, 1 - c.age / (c.life * 0.75));
      for (let j = 0; j < JET; j++) {
        const o = (per + j) * STRIDE;
        const seed = c.puff[o + 4];
        const ph = (c.age * 0.45 + j / JET) % 1;
        this.cx[n] = c.pos.x + (seed - 0.5) * 0.6 * ph;
        this.cy[n] = c.pos.y + 0.15 + ph * 2.4;
        this.cz[n] = c.pos.z + (c.puff[o + 3] - 1) * 1.2 * ph;
        this.ps[n] = 0.35 + ph * 1.8;
        this.pa[n] = 0.75 * hiss * fadeIn * Math.min(1, ph * 6) * (1 - ph);
        this.pseed[n] = seed;
        this.pshade[n] = 0.15;
        n++;
      }
    }
    this.live = n;
    this.mesh.visible = n > 0;
    this.write();
  }

  /** Set the sort viewpoint explicitly (otherwise the last rendering camera is used). */
  setViewer(p: THREE.Vector3) {
    this.cam.copy(p);
  }

  /** Back-to-front sort for the rendering camera, then upload. */
  private write() {
    const n = this.live;
    this.mesh.count = n;
    if (n === 0) return;
    const order = this.order;
    for (let i = 0; i < n; i++) {
      order[i] = i;
      const dx = this.cx[i] - this.cam.x, dy = this.cy[i] - this.cam.y, dz = this.cz[i] - this.cam.z;
      this.key[i] = dx * dx + dy * dy + dz * dz;
    }
    // Insertion sort (n ≤ 144 and nearly sorted frame to frame).
    for (let i = 1; i < n; i++) {
      const v = order[i];
      const k = this.key[v];
      let j = i - 1;
      while (j >= 0 && this.key[order[j]] < k) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = v;
    }
    for (let s = 0; s < n; s++) {
      const i = order[s];
      this.m.makeTranslation(this.cx[i], this.cy[i], this.cz[i]);
      this.mesh.setMatrixAt(s, this.m);
      const p = s * 4;
      this.params[p] = this.ps[i];
      this.params[p + 1] = this.pa[i];
      this.params[p + 2] = this.pseed[i];
      this.shade[s] = this.pshade[i];
    }
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.paramsAttr.clearUpdateRanges();
    this.paramsAttr.addUpdateRange(0, n * 4);
    this.paramsAttr.needsUpdate = true;
    this.shadeAttr.clearUpdateRanges();
    this.shadeAttr.addUpdateRange(0, n);
    this.shadeAttr.needsUpdate = true;
  }

  /** Puffs drawn this frame (tests / stats). */
  get liveCount() {
    return this.live;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
