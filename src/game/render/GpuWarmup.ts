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

/** Texture/material policy the warmup enforces on everything it sees (set per quality preset). */
export type WarmupPolicy = {
  /** Anisotropic filtering applied to every mipmapped texture (clamped to the GPU max). */
  anisotropy: number;
  /** Alpha-tested (cut-out) materials use alpha-to-coverage: only when the target is multisampled. */
  alphaToCoverage: boolean;
};

export class GpuWarmup {
  /** Upload budget per frame (ms) during play. At least one texture is always uploaded. */
  budgetMs = 3;
  /** Materials compiled per scan tick during play. */
  compilePerTick = 8;
  /**
   * Until this time (ms) the match is still behind the loading screen / deploy
   * card: compile every new material at once (the driver links them in
   * parallel) and upload with a generous budget, so play starts warm.
   */
  private eagerUntil = 0;
  private policy: WarmupPolicy = { anisotropy: 4, alphaToCoverage: false };
  private maxAnisotropy = 1;
  /**
   * Render target the scene is drawn into (post path) or null (canvas). three
   * keeps a program variant per output colour space / tone mapping, so the
   * warm compile must happen with the same target bound or it compiles a
   * variant that's never used and the real one stalls on first draw.
   */
  target: THREE.WebGLRenderTarget | null = null;

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

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  /** Compile/upload eagerly for `ms` (load, quality change: nothing to interrupt yet). */
  eager(ms: number) {
    this.eagerUntil = Math.max(this.eagerUntil, performance.now() + ms);
    this.wake(ms + 2000);
  }

  /** New texture/material policy (quality change): re-applied to everything on the next scan. */
  setPolicy(p: WarmupPolicy) {
    if (p.anisotropy === this.policy.anisotropy && p.alphaToCoverage === this.policy.alphaToCoverage) return;
    this.policy = { ...p };
    this.policyVersion++;
    this.invalidatePrograms();
  }

  private policyVersion = 1;
  private readonly policyApplied = new WeakMap<object, number>();

  /** Anisotropy + alpha-to-coverage, applied once per material/texture per policy. */
  private applyPolicy(m: THREE.Material) {
    if (this.policyApplied.get(m) === this.policyVersion) return;
    this.policyApplied.set(m, this.policyVersion);
    const cutout = m.alphaTest > 0 && !m.transparent;
    const a2c = cutout && this.policy.alphaToCoverage;
    if (cutout && m.alphaToCoverage !== a2c) {
      m.alphaToCoverage = a2c;
      m.needsUpdate = true;
    }
    const holder = m as unknown as MapHolder;
    const aniso = Math.max(1, Math.min(this.policy.anisotropy, this.maxAnisotropy));
    for (let k = 0; k < MAP_KEYS.length; k++) {
      const t = holder[MAP_KEYS[k]];
      if (!t || !t.isTexture || this.policyApplied.get(t) === this.policyVersion) continue;
      this.policyApplied.set(t, this.policyVersion);
      const mipmapped = t.minFilter === THREE.LinearMipmapLinearFilter || t.minFilter === THREE.NearestMipmapLinearFilter || t.minFilter === THREE.LinearMipmapNearestFilter;
      if (!mipmapped || t.anisotropy === aniso || (t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) continue;
      t.anisotropy = aniso;
      // Already on the GPU: three only re-applies sampler state on an upload.
      const uploaded = (this.renderer.properties.get(t) as { __version?: number }).__version;
      if (uploaded !== undefined && uploaded === t.version && t.version > 0) t.needsUpdate = true;
    }
  }

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

  private readonly compiling = new Set<THREE.Material>();
  private holdUntil = 0;

  /**
   * Hold back drawing (behind the loading screen) for up to `ms` while warm
   * compiles are still linking, so no program is first used half-built
   * (that blocks the main thread for the rest of its compile).
   */
  holdForPrograms(ms: number) {
    this.holdUntil = performance.now() + ms;
  }

  /** True while the frame should be skipped: initial load, programs still linking. */
  get holding() {
    if (this.holdUntil === 0) return false;
    if (performance.now() > this.holdUntil) {
      this.holdUntil = 0;
      return false;
    }
    // The first scan hasn't run yet: hold so it compiles before anything draws.
    if (this.frame < 1) return true;
    return this.pendingPrograms() > 0;
  }

  /** Materials whose programs are still compiling (non-blocking KHR_parallel_shader_compile check). */
  pendingPrograms() {
    const props = this.renderer.properties;
    for (const m of this.compiling) {
      const p = (props.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
      if (!p || p.isReady()) this.compiling.delete(m);
    }
    if (this.compiling.size === 0) this.holdUntil = 0;
    return this.compiling.size;
  }

  get stats() {
    return { uploaded: this.uploaded, programs: this.programs, pending: this.pending.length + textureUploads.jobs.length };
  }

  /** Call once per frame before rendering. */
  update(scenes: readonly THREE.Scene[], cameras: readonly THREE.Camera[]) {
    const now = performance.now();
    textureUploads.lastDrain = now;
    this.frame++;
    const eager = now < this.eagerUntil;
    if (now < this.warmUntil && (this.frame % (eager ? 4 : 10) === 0 || this.frame === 1)) {
      const r = this.renderer;
      const prev = r.getRenderTarget();
      // Compile the variant the scene is actually drawn with (see `target`).
      r.setRenderTarget(this.target);
      for (let i = 0; i < scenes.length; i++) this.scan(scenes[i], cameras[i], eager ? 1e9 : this.compilePerTick);
      r.setRenderTarget(prev);
    }
    this.drainUploads(now, eager ? 8 : this.budgetMs, eager ? 4 << 20 : 3 << 19);
  }

  private scan(scene: THREE.Scene, camera: THREE.Camera, cap: number) {
    scene.traverse(this.visit);
    // Compile new materials against this scene's lights (KHR_parallel_shader_compile
    // links them off-thread); past the cap they're un-marked for the next tick.
    const list = this.toCompile;
    let n = 0;
    while (list.length) {
      const obj = list.pop()!;
      if (n < cap) {
        this.renderer.compile(obj, camera, scene);
        this.programs++;
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) for (let i = 0; i < m.length; i++) this.compiling.add(m[i]);
        else if (m) this.compiling.add(m);
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
    this.applyPolicy(m);
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

  private drainUploads(now: number, budgetMs: number, texelBudget: number) {
    const r = this.renderer;
    const deadline = now + budgetMs;
    // The CPU side of an upload returns quickly; the copy + mip build lands in
    // the GPU process, so a texel budget bounds the real per-frame cost too.
    let texels = 0;
    let first = true;
    const more = () => first || (performance.now() < deadline && texels < texelBudget);
    const upload = (t: THREE.Texture) => {
      r.initTexture(t);
      this.uploaded++;
      first = false;
      const img = t.image as { width?: number; height?: number } | null;
      texels += (img?.width ?? 256) * (img?.height ?? 256);
    };
    // Explicit swap jobs first: they replace visible placeholders.
    const jobs = textureUploads.jobs;
    while (jobs.length && more()) {
      const job = jobs[0];
      if (job.cancelled) {
        jobs.shift();
        continue;
      }
      if (job.next < job.textures.length) {
        const t = job.textures[job.next++];
        if (this.needsUpload(t)) upload(t);
        continue;
      }
      jobs.shift();
      job.done();
    }
    while (this.pending.length && more()) {
      const t = this.pending.pop()!;
      if (this.needsUpload(t)) upload(t);
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
