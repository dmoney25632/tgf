import * as THREE from "three";
import type { QualityPreset } from "../../config";
import { BAKED_UNIFORMS, bakeableMaterial, isBakePatched, neutralBakeAttributes, patchBakedMaterial, setBakeStrength } from "../../render/BakedLighting";
import type { BakeDetail } from "../quality";
import type { CapturedBox } from "../MeshBuilder";
import { BoxTracer, type OccluderBox } from "./BoxTracer";
import { LightBaker, type BakeReceiver, type BakeResult } from "./LightBaker";

/**
 * Baked lighting for one loaded map: picks the static world meshes, gives
 * them bake attributes + the material patch (render/BakedLighting), then
 * bakes sky visibility, one sun bounce and sun occlusion per vertex in
 * time-sliced chunks after the map is built (the game keeps loading and
 * rendering meanwhile; the result fades in). Re-bakes when the sun is
 * re-aimed (the HDRI picks its azimuth after load). Results are cached per
 * map + preset + sun, so a rematch on the same map applies them instantly.
 */

type Receiver = { mesh: THREE.Mesh; geo: THREE.BufferGeometry };

const CACHE_SIZE = 3;
const cache = new Map<string, BakeResult[]>();
/** Bake fade-in time (s). */
const FADE = 0.8;

/** Token of the map whose bake drives the shared uniforms. */
let active: object | null = null;

export type MapLightingOptions = {
  /** Cache key prefix (map id). */
  id: string;
  root: THREE.Object3D;
  /** Occluders captured while the map was built. */
  boxes: readonly CapturedBox[];
  /** Visual ground height. */
  ground: (x: number, z: number) => number;
  /** Ground tint (sRGB hex). */
  groundColor: number;
  /** Ambient model: sky / ground hemisphere colours (their ratio weights the bake's lower hemisphere). */
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /** Live sun direction (unit, toward the sun). */
  sun: THREE.Vector3;
  detail: BakeDetail;
  /** Bounce strength on top of the physically based estimate (art knob). */
  bounceGain?: number;
};

export class MapLighting {
  private readonly receivers: Receiver[] = [];
  private readonly tracer: BoxTracer;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private job = 0;
  private strength = 0;
  private target = 0;
  private lastTick = 0;
  private disposed = false;
  /** Wall-clock ms the last bake took (debug). */
  lastBakeMs = 0;
  /** Rays traced by the last bake (debug). */
  lastBakeRays = 0;

  private readonly token = {};

  constructor(private readonly o: MapLightingOptions) {
    active = this.token;
    setBakeStrength(0);
    BAKED_UNIFORMS.ihGiParams.value.y = o.bounceGain ?? 1;
    const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    this.groundWeight = THREE.MathUtils.clamp(lum(o.hemiGround) / Math.max(1e-4, lum(o.hemiSky)), 0.12, 0.85);
    const g = new THREE.Color(o.groundColor);
    // The ground tint is close to the texture's average already (unlike box tints).
    this.tracer = new BoxTracer(o.boxes.map(toOccluder), o.ground, [Math.min(0.5, g.r), Math.min(0.5, g.g), Math.min(0.5, g.b)]);
    this.collect();
  }

  private readonly groundWeight: number;

  /** Static, uniquely owned, lit meshes under the map root get the bake. */
  private collect() {
    const refs = new Map<THREE.BufferGeometry, number>();
    const candidates: THREE.Mesh[] = [];
    this.o.root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      refs.set(m.geometry, (refs.get(m.geometry) ?? 0) + 1);
      if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      // Invisible raycast proxies and the far backdrop (never seen up close).
      if (m.name.startsWith("proxy:") || m.name.startsWith("far")) return;
      if (!m.visible && !m.name.startsWith("clutter@")) return;
      // Moving extras (helicopters, swinging lamps) would carry stale light.
      if (m.matrixAutoUpdate) return;
      if (!bakeableMaterial(m.material) || !m.geometry.attributes.normal) return;
      candidates.push(m);
    });
    for (const mesh of candidates) {
      if (refs.get(mesh.geometry) !== 1) continue;
      neutralBakeAttributes(mesh.geometry);
      patchBakedMaterial(mesh.material as THREE.MeshStandardMaterial);
      this.receivers.push({ mesh, geo: mesh.geometry });
    }
    this.fillNeutral();
  }

  /** Every mesh drawn with a patched material must carry the attributes (neutral if not baked). */
  private fillNeutral() {
    this.o.root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
      if (isBakePatched(m.material)) neutralBakeAttributes(m.geometry);
    });
  }

  get vertexCount() {
    return this.receivers.reduce((n, r) => n + r.geo.attributes.position.count, 0);
  }

  private key() {
    const s = this.o.sun;
    const d = this.o.detail;
    return `${this.o.id}|${d.maxEdge}|${d.skyRays}|${d.bounce}|${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}|${this.vertexCount}|${this.receivers.length}`;
  }

  /** Starts (or restarts, e.g. after the sun moved) the bake. */
  start() {
    if (this.disposed || !this.receivers.length) return;
    const job = ++this.job;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const key = this.key();
    const hit = cache.get(key);
    if (hit) {
      this.apply(hit);
      return;
    }
    const baker = this.makeBaker();
    const gen = baker.run(48);
    const t0 = performance.now();
    const slice = Math.max(2, this.o.detail.sliceMs);
    const tick = () => {
      this.timer = null;
      if (this.disposed || job !== this.job) return;
      const end = performance.now() + slice;
      for (;;) {
        const r = gen.next();
        if (r.done) {
          this.lastBakeMs = performance.now() - t0;
          this.lastBakeRays = baker.rays;
          cache.set(key, r.value);
          while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
          this.apply(r.value);
          return;
        }
        if (performance.now() >= end) break;
      }
      // Yield to the frame loop / loading screen between slices: at most
      // ~half the main thread, so a bake that outlives the loading screen
      // costs frame rate, not hitches.
      this.timer = setTimeout(tick, slice);
    };
    this.timer = setTimeout(tick, 0);
  }

  /** Builds the baker for the current sun (exposed for tests / tools). */
  makeBaker() {
    const s = this.o.sun;
    const d = this.o.detail;
    const receivers: BakeReceiver[] = this.receivers.map(({ mesh, geo }) => {
      mesh.updateMatrixWorld();
      const P = geo.attributes.position as THREE.BufferAttribute;
      const N = geo.attributes.normal as THREE.BufferAttribute;
      let positions: ArrayLike<number> = P.array as Float32Array;
      let normals: ArrayLike<number> = N.array as Float32Array;
      const identity = mesh.matrixWorld.equals(IDENTITY);
      if (!identity || P.itemSize !== 3 || N.itemSize !== 3 || (P as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        const pw = new Float32Array(P.count * 3), nw = new Float32Array(P.count * 3);
        const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        for (let i = 0; i < P.count; i++) {
          _v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).toArray(pw, i * 3);
          _v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nw, i * 3);
        }
        positions = pw;
        normals = nw;
      }
      return { positions, normals, dedupe: !geo.index };
    });
    return new LightBaker(
      this.tracer,
      receivers,
      { skyRays: d.skyRays, minRays: d.minRays, sunRays: d.sunRays, bounce: d.bounce, rayLength: d.rayLength, budget: d.budget },
      { sun: [s.x, s.y, s.z], groundWeight: this.groundWeight, groundBounce: 0.6, sunSpread: 0.035 },
    );
  }

  private apply(results: BakeResult[]) {
    results.forEach((res, i) => {
      const geo = this.receivers[i]?.geo;
      if (!geo) return;
      const gi = geo.attributes.ihGi as THREE.BufferAttribute;
      const sun = geo.attributes.ihSunOcc as THREE.BufferAttribute;
      if (!gi || !sun || gi.count * 4 !== res.gi.length) return;
      (gi.array as Uint8Array).set(res.gi);
      (sun.array as Uint8Array).set(res.sun);
      gi.needsUpdate = sun.needsUpdate = true;
    });
    // Late arrivals (streamed props reusing world materials) get neutral attributes.
    this.fillNeutral();
    this.target = 1;
    this.lastTick = performance.now();
  }

  /** Per frame: fades the bake in once it lands. */
  update() {
    if (this.strength === this.target || active !== this.token) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.strength = this.target > this.strength ? Math.min(this.target, this.strength + dt / FADE) : Math.max(this.target, this.strength - dt / FADE);
    setBakeStrength(this.strength);
  }

  /**
   * Where the baked sun takes over from shadow maps: past the outermost
   * cascade, or everywhere when the preset has no shadow maps.
   */
  setQuality(q: QualityPreset, farCascade: number) {
    const reach = !q.shadows ? 0 : Math.max(q.shadowExtent, farCascade);
    BAKED_UNIFORMS.ihSunFade.value.set(reach ? reach * 0.8 : -2, reach ? reach : -1);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (active === this.token) {
      active = null;
      setBakeStrength(0);
    }
  }
}

const IDENTITY = new THREE.Matrix4();
const _v = new THREE.Vector3();

function toOccluder(b: CapturedBox): OccluderBox {
  // Invisible proxies stand in for non-box visuals (sandbags, rocks, models): neutral albedo.
  const proxy = b.group.startsWith("proxy");
  return { cx: b.cx, cy: b.cy, cz: b.cz, hx: b.hx, hy: b.hy, hz: b.hz, axes: b.axes, r: proxy ? 0.3 : b.r, g: proxy ? 0.28 : b.g, b: proxy ? 0.25 : b.b };
}
