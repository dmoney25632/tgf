import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ADAPTIVE, ADAPTIVE_LEVELS, adaptivePreset, type QualityPreset } from "../config";
import { analyzeHdri, getAtmosphere } from "./Atmosphere";
import { loadHdri, setAssetRenderer } from "../assets/AssetLoader";
import { GpuWarmup } from "./GpuWarmup";

/**
 * Cinematic grade applied after tone mapping (sRGB space): desaturation,
 * split toning (cool green-grey shadows, faintly warm highlights), a gentle
 * S-curve with lifted blacks, vignette and fine animated film grain.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.8 },
    contrast: { value: 1.1 },
    shadowTint: { value: new THREE.Vector3(0.95, 1.0, 0.975) },
    highlightTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    lift: { value: 0.018 },
    vignette: { value: 0.55 },
    grain: { value: 0.022 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float lift;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col *= mix(shadowTint, highlightTint, smoothstep(0.05, 0.85, l));
      col = (col - 0.45) * contrast + 0.45;
      col = col * (1.0 - lift) + lift;
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * vignette;
      float n = fract(sin(dot(vUv * 1000.0 + fract(time * 7.13) * 100.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += n * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * Owns the WebGL renderer and draws the world + first-person viewmodel.
 * Quality presets toggle resolution, shadows, and the post stack:
 *   world → [AO] → viewmodel (cleared depth) → [bloom] → tone map → grade → [FXAA]
 * Low skips post-processing entirely and renders straight to the canvas.
 *
 * Image-based lighting comes from the map's sky (procedural sky dome baked
 * through PMREM), upgraded to the manifest HDRI when available and enabled
 * by the preset. Fog colour, ambient tint and sun azimuth follow the HDRI.
 *
 * Frame pacing: no frame cap (one render per rAF, so 120/144 Hz panels run
 * at their native rate). Adaptive quality (config ADAPTIVE) steps AO, shadow
 * redraw rate, MSAA and resolution down while frame time is over budget and
 * back up once it recovers. GpuWarmup precompiles shaders and spreads texture
 * uploads so first sight of an effect or prop doesn't hitch.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private env: THREE.Texture;
  private hdriEnv: THREE.Texture | null = null;
  private hdriRequested = false;
  private disposed = false;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  /** Preset chosen by the player. */
  private base!: QualityPreset;
  /** Preset in effect (base after adaptive step-downs). */
  private quality!: QualityPreset;
  private width = 1;
  private height = 1;
  private readonly envIntensity: number;
  private readonly warmup: GpuWarmup;
  private readonly scenes: THREE.Scene[];
  private readonly cameras: THREE.Camera[];
  private precompiled = false;

  // Frame timing / adaptive quality.
  private frame = 0;
  private lastFrameAt = 0;
  private frameEma = 0;
  private windowSum = 0;
  private windowFrames = 0;
  /** Best (shortest) recent average frame interval: our refresh-rate estimate. */
  private displayInterval = 1000 / 60;
  private overTime = 0;
  private goodTime = 0;
  private settleUntil = 0;
  private level = 0;
  private upgradeWait: number = ADAPTIVE.upgradeAfter;
  private lastUpgradeAt = -1e9;
  /** Adaptive quality on/off (e.g. a settings toggle). */
  adaptive: boolean = ADAPTIVE.enabled;
  /** Called after the pixel ratio changes (resolution steps), e.g. to resize effects. */
  onPixelRatioChange: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly viewScene: THREE.Scene,
    private readonly viewCamera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
    /**
     * Preset the session starts with. When it uses post-processing, the
     * canvas is created without MSAA (the composer has its own AA, and a
     * multisampled default framebuffer just adds a resolve every frame).
     */
    initial?: QualityPreset,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !initial?.postProcessing,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const atmo = getAtmosphere(scene);
    this.renderer.toneMappingExposure = atmo?.def.exposure ?? 1.05;
    this.envIntensity = atmo?.def.envIntensity ?? 0.3;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    // Count draw calls across all passes of a frame (reset in render()).
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    canvas.tabIndex = 0;
    container.appendChild(canvas);
    setAssetRenderer(this.renderer);

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

    this.scenes = [scene, viewScene];
    this.cameras = [camera, viewCamera];
    this.warmup = new GpuWarmup(this.renderer);
    this.warmup.watch(scene);
    this.warmup.watch(viewScene);
    this.warmup.wake(15000);
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

  /** Adaptive level in effect (0 = the chosen preset). */
  get adaptiveLevel() {
    return this.level;
  }

  /** One-line render summary for the F3 overlay. */
  get debugSummary() {
    const w = this.warmup.stats;
    const fps = this.frameEma > 0 ? 1000 / this.frameEma : 0;
    return (
      `${fps.toFixed(0)} fps (${this.frameEma.toFixed(2)} ms, budget ${this.budget.toFixed(1)} ms @ ~${(1000 / this.displayInterval).toFixed(0)} Hz)` +
      `  adaptive L${this.level}${this.adaptive ? "" : " off"}  res ×${this.renderer.getPixelRatio().toFixed(2)}` +
      `  programs ${this.renderer.info.programs?.length ?? 0}  tex ${this.renderer.info.memory.textures}  uploads ${w.uploaded}${w.pending ? ` (+${w.pending})` : ""}`
    );
  }

  /** Frame-time budget (ms) the adaptive controller aims for. */
  private get budget() {
    const lo = 1000 / ADAPTIVE.maxTargetFps;
    const hi = 1000 / ADAPTIVE.minTargetFps;
    return Math.min(hi, Math.max(lo, this.displayInterval)) * ADAPTIVE.overBudget;
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

  /** Applies the player's preset (resets adaptive step-downs). */
  setQuality(q: QualityPreset) {
    this.base = q;
    this.level = 0;
    this.upgradeWait = ADAPTIVE.upgradeAfter;
    this.apply(q);
    if (!this.precompiled) {
      this.precompiled = true;
      this.precompile();
    }
  }

  /**
   * Compiles every material currently in both scenes (including hidden pooled
   * effects) while the match is loading. KHR_parallel_shader_compile links
   * them off the main thread; GpuWarmup picks up anything added later.
   */
  private precompile() {
    const r = this.renderer;
    void r
      .compileAsync(this.scene, this.camera)
      .then(() => (this.disposed ? null : r.compileAsync(this.viewScene, this.viewCamera)))
      .catch(() => {
        // Context lost / disposed mid-compile: nothing to warm.
      });
  }

  private apply(q: QualityPreset) {
    const prev = this.quality;
    const shadowsChanged = !prev || prev.shadows !== q.shadows || prev.shadowMapSize !== q.shadowMapSize;
    const postChanged =
      !prev ||
      prev.postProcessing !== q.postProcessing ||
      prev.ambientOcclusion !== q.ambientOcclusion ||
      prev.bloom !== q.bloom ||
      prev.msaaSamples !== q.msaaSamples;
    this.quality = q;
    if (q.hdri) this.requestHdri();

    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio) * q.resolutionScale);

    if (shadowsChanged) {
      const toggled = !prev || prev.shadows !== q.shadows;
      this.renderer.shadowMap.enabled = q.shadows;
      this.sun.castShadow = q.shadows;
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      if (toggled && prev) {
        // Materials must recompile when shadow support toggles.
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
          else if (m) m.needsUpdate = true;
        });
        this.warmup.invalidatePrograms();
      }
    }
    const interval = Math.max(1, Math.round(q.shadowUpdateInterval ?? 1));
    this.renderer.shadowMap.autoUpdate = interval === 1;
    this.renderer.shadowMap.needsUpdate = true;

    if (postChanged) this.buildComposer();
    this.setSize(this.width, this.height);
    this.settleUntil = performance.now() + ADAPTIVE.settleTime * 1000;
    this.overTime = 0;
    this.goodTime = 0;
    if (prev && this.renderer.getPixelRatio() !== prevRatio) this.onPixelRatioChange?.();
  }

  /** EffectComposer.dispose() only frees its own targets, not the passes. */
  private disposeComposer() {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.composer = null;
    this.grade = null;
  }

  private buildComposer() {
    this.disposeComposer();
    const q = this.quality;
    if (!q.postProcessing) return;

    const pr = this.renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(this.width * pr, this.height * pr, {
      type: THREE.HalfFloatType,
      samples: q.msaaSamples,
    });
    const composer = new EffectComposer(this.renderer, target);

    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ambientOcclusion) {
      const ao = new GTAOPass(this.scene, this.camera, this.width, this.height);
      ao.blendIntensity = 0.8;
      ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1, scale: 1 });
      composer.addPass(ao);
    }
    const view = new RenderPass(this.viewScene, this.viewCamera);
    view.clear = false;
    view.clearDepth = true;
    composer.addPass(view);
    if (q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.22, 0.4, 0.95));
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    if (q.msaaSamples === 0) composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  setSize(w: number, h: number) {
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Frame timing → refresh-rate estimate → adaptive step up/down. */
  private trackFrame(now: number) {
    const dtMs = now - this.lastFrameAt;
    this.lastFrameAt = now;
    // Skip the first frame and long gaps (tab hidden, breakpoints, alt-tab).
    if (dtMs <= 0 || dtMs > 250) return;
    this.frameEma = this.frameEma ? this.frameEma + (dtMs - this.frameEma) * 0.05 : dtMs;

    // Refresh estimate: shortest 30-frame average seen, drifting up slowly so
    // moving the window to a slower monitor is noticed.
    this.windowSum += dtMs;
    if (++this.windowFrames === 30) {
      const avg = this.windowSum / 30;
      this.displayInterval = Math.min(this.displayInterval * 1.01, Math.max(avg, 1000 / 360));
      this.windowSum = 0;
      this.windowFrames = 0;
    }

    if (!this.adaptive || !this.base || now < this.settleUntil) return;
    const dt = dtMs / 1000;
    if (this.frameEma > this.budget) {
      this.overTime += dt;
      this.goodTime = 0;
    } else {
      this.overTime = Math.max(0, this.overTime - dt);
      this.goodTime += dt;
    }
    if (this.overTime > ADAPTIVE.degradeAfter && this.level < ADAPTIVE_LEVELS) {
      // An upgrade that fails quickly means we're at the device's limit: wait longer next time.
      if (now - this.lastUpgradeAt < 8000) this.upgradeWait = Math.min(this.upgradeWait * 2, 300);
      this.setLevel(this.level + 1);
    } else if (this.goodTime > this.upgradeWait && this.level > 0) {
      this.lastUpgradeAt = now;
      this.setLevel(this.level - 1);
    }
  }

  private setLevel(level: number) {
    // Skip levels that change nothing for this preset (e.g. AO already off).
    let next = level;
    const dir = Math.sign(level - this.level);
    let q = adaptivePreset(this.base, next);
    while (dir > 0 && next < ADAPTIVE_LEVELS && samePreset(q, this.quality)) q = adaptivePreset(this.base, ++next);
    while (dir < 0 && next > 0 && samePreset(q, this.quality)) q = adaptivePreset(this.base, --next);
    this.level = next;
    if (!samePreset(q, this.quality)) this.apply(q);
  }

  render() {
    const now = performance.now();
    this.trackFrame(now);
    this.frame++;
    const interval = this.quality?.shadowUpdateInterval ?? 1;
    if (interval > 1 && this.frame % interval === 0) this.renderer.shadowMap.needsUpdate = true;
    this.warmup.update(this.scenes, this.cameras);

    this.renderer.info.reset();
    if (this.composer) {
      if (this.grade) this.grade.uniforms.time.value = (now / 1000) % 1000;
      this.composer.render();
      return;
    }
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.viewScene, this.viewCamera);
  }

  dispose() {
    this.disposed = true;
    this.warmup.dispose();
    setAssetRenderer(null);
    this.disposeComposer();
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

function samePreset(a: QualityPreset, b: QualityPreset) {
  return (
    a.resolutionScale === b.resolutionScale &&
    a.ambientOcclusion === b.ambientOcclusion &&
    a.bloom === b.bloom &&
    a.msaaSamples === b.msaaSamples &&
    a.shadowMapSize === b.shadowMapSize &&
    a.shadows === b.shadows &&
    (a.shadowUpdateInterval ?? 1) === (b.shadowUpdateInterval ?? 1)
  );
}
