import * as THREE from "three";

/**
 * Spreads GPU work that would otherwise land on the first frame an object or
 * effect is seen:
 *
 * - Texture uploads: explicit jobs (photo texture sets swapping in for
 *   placeholders, via `textureUploads`) plus any not-yet-uploaded texture found
 *   on scene materials (glTF props), pushed with renderer.initTexture under a
 *   per-frame time budget.
 * - Shader programs: materials not seen before are compiled a few at a time
 *   with renderer.compile (which also covers invisible pooled effects), so
 *   KHR_parallel_shader_compile can link them in the background before they
 *   are first drawn.
 *
 * Scans only run while "warm" (after load, a quality change or new content);
 * steady-state frames do nothing but check a counter. No per-frame allocation.
 */

type UploadJob = { textures: THREE.Texture[]; next: number; done: () => void; cancelled: boolean };

/** Process-wide queue of texture swaps waiting for their GPU upload. */
class TextureUploadQueue {
  readonly jobs: UploadJob[] = [];
  lastDrain = -1e9;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Uploads `textures` over the next frames, then calls `done` (bind them
   * there). Returns a cancel function. If no renderer drains the queue
   * (e.g. none running), `done` still runs after a short delay.
   */
  enqueue(textures: (THREE.Texture | null | undefined)[], done: () => void): () => void {
    const job: UploadJob = { textures: textures.filter((t): t is THREE.Texture => !!t), next: 0, done, cancelled: false };
    this.jobs.push(job);
    this.armFallback();
    return () => {
      job.cancelled = true;
    };
  }

  private armFallback() {
    if (this.timer || typeof setTimeout === "undefined") return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now - this.lastDrain < 1000) {
        if (this.jobs.length) this.armFallback();
        return;
      }
      while (this.jobs.length) {
        const j = this.jobs.shift()!;
        if (!j.cancelled) j.done();
      }
    }, 1200);
  }
}

export const textureUploads = new TextureUploadQueue();

const MAP_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "emissiveMap",
  "bumpMap",
  "displacementMap",
  "lightMap",
  "specularMap",
] as const;

type MapHolder = Partial<Record<(typeof MAP_KEYS)[number], THREE.Texture | null>>;

export class GpuWarmup {
  /** Upload budget per frame (ms). At least one texture is always uploaded. */
  budgetMs = 3;
  /** Materials compiled per scan tick. */
  compilePerTick = 6;

  private readonly scanned = new Set<THREE.Texture>();
  private readonly pending: THREE.Texture[] = [];
  private readonly toCompile: THREE.Object3D[] = [];
  private compiled = new WeakSet<THREE.Material>();
  private compiledInstanced = new WeakSet<THREE.Material>();
  private warmUntil = 0;
  private frame = 0;
  private readonly onChildAdded = () => this.wake(4000);
  private readonly watched: THREE.Object3D[] = [];
  private uploaded = 0;
  private programs = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** Re-scan when direct children are added to these roots. */
  watch(root: THREE.Object3D) {
    root.addEventListener("childadded", this.onChildAdded);
    this.watched.push(root);
  }

  /** Keep scanning for `ms` more (after load, quality change, new content). */
  wake(ms = 6000) {
    const until = performance.now() + ms;
    if (until > this.warmUntil) this.warmUntil = until;
  }

  /** Programs must be rebuilt (e.g. shadows toggled): recompile everything. */
  invalidatePrograms() {
    this.compiled = new WeakSet();
    this.compiledInstanced = new WeakSet();
    this.wake();
  }

  get stats() {
    return { uploaded: this.uploaded, programs: this.programs, pending: this.pending.length + textureUploads.jobs.length };
  }

  /** Call once per frame before rendering. */
  update(scenes: readonly THREE.Scene[], cameras: readonly THREE.Camera[]) {
    const now = performance.now();
    textureUploads.lastDrain = now;
    this.frame++;
    if (now < this.warmUntil && this.frame % 10 === 0) {
      for (let i = 0; i < scenes.length; i++) this.scan(scenes[i], cameras[i]);
    }
    this.drainUploads(now);
  }

  private scan(scene: THREE.Scene, camera: THREE.Camera) {
    scene.traverse(this.visit);
    // Compile a few new materials against this scene's lights; the rest are
    // un-marked so the next tick picks them up again.
    const list = this.toCompile;
    let n = 0;
    while (list.length) {
      const obj = list.pop()!;
      if (n < this.compilePerTick) {
        this.renderer.compile(obj, camera, scene);
        this.programs++;
        n++;
        continue;
      }
      const m = (obj as THREE.Mesh).material;
      const set = (obj as THREE.InstancedMesh).isInstancedMesh ? this.compiledInstanced : this.compiled;
      if (Array.isArray(m)) for (let i = 0; i < m.length; i++) set.delete(m[i]);
      else if (m) set.delete(m);
      this.wake(1000);
    }
  }

  private readonly visit = (o: THREE.Object3D) => {
    const r = o as THREE.Mesh;
    if (!(r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) return;
    const m = r.material;
    if (!m) return;
    if (Array.isArray(m)) for (let i = 0; i < m.length; i++) this.visitMaterial(m[i], o);
    else this.visitMaterial(m, o);
  };

  private visitMaterial(m: THREE.Material, o: THREE.Object3D) {
    const set = (o as THREE.InstancedMesh).isInstancedMesh ? this.compiledInstanced : this.compiled;
    if (!set.has(m)) {
      set.add(m);
      this.toCompile.push(o);
    }
    const holder = m as unknown as MapHolder;
    for (let k = 0; k < MAP_KEYS.length; k++) {
      const t = holder[MAP_KEYS[k]];
      if (t && t.isTexture && !this.scanned.has(t) && this.needsUpload(t)) {
        this.scanned.add(t);
        this.pending.push(t);
      }
    }
  }

  private needsUpload(t: THREE.Texture) {
    if ((t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return false;
    if (t.version === 0) return false;
    const img = t.image as { complete?: boolean } | null;
    if (!img || img.complete === false) return false;
    const props = this.renderer.properties.get(t) as { __version?: number };
    return props.__version !== t.version;
  }

  private drainUploads(now: number) {
    const r = this.renderer;
    const deadline = now + this.budgetMs;
    let first = true;
    // Explicit swap jobs first: they replace visible placeholders.
    const jobs = textureUploads.jobs;
    while (jobs.length && (first || performance.now() < deadline)) {
      const job = jobs[0];
      if (job.cancelled) {
        jobs.shift();
        continue;
      }
      if (job.next < job.textures.length) {
        const t = job.textures[job.next++];
        if (this.needsUpload(t)) {
          r.initTexture(t);
          this.uploaded++;
          first = false;
        }
        continue;
      }
      jobs.shift();
      job.done();
    }
    while (this.pending.length && (first || performance.now() < deadline)) {
      const t = this.pending.pop()!;
      if (this.needsUpload(t)) {
        r.initTexture(t);
        this.uploaded++;
        first = false;
      }
    }
    if (!this.pending.length && this.scanned.size > 512) this.scanned.clear();
  }

  dispose() {
    for (const root of this.watched) root.removeEventListener("childadded", this.onChildAdded);
    this.watched.length = 0;
    this.pending.length = 0;
    this.scanned.clear();
  }
}
