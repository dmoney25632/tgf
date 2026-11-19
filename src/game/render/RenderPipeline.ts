import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { QualityPreset } from "../config";
import { analyzeHdri, getAtmosphere } from "./Atmosphere";
import { loadHdri } from "../assets/AssetLoader";

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
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private env: THREE.Texture;
  private hdriEnv: THREE.Texture | null = null;
  private hdriRequested = false;
  private disposed = false;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private quality!: QualityPreset;
  private width = 1;
  private height = 1;
  private readonly envIntensity: number;

  constructor(
    container: HTMLElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly viewScene: THREE.Scene,
    private readonly viewCamera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", stencil: false });
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

  setQuality(q: QualityPreset) {
    const shadowsChanged = !this.quality || this.quality.shadows !== q.shadows || this.quality.shadowMapSize !== q.shadowMapSize;
    this.quality = q;
    if (q.hdri) this.requestHdri();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio) * q.resolutionScale);

    if (shadowsChanged) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.sun.castShadow = q.shadows;
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      // Materials must recompile when shadow support toggles.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }

    this.buildComposer();
    this.setSize(this.width, this.height);
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

  render() {
    this.renderer.info.reset();
    if (this.composer) {
      if (this.grade) this.grade.uniforms.time.value = (performance.now() / 1000) % 1000;
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
