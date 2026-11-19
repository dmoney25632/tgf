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

/** Subtle filmic grade applied after tone mapping (sRGB space). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    lift: { value: new THREE.Vector3(0.01, 0.012, 0.02) },
    gain: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform vec3 lift;
    uniform vec3 gain;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col = col * gain + lift * (1.0 - col);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * Owns the WebGL renderer and draws the world + first-person viewmodel.
 * Quality presets toggle resolution, shadows, and the post stack:
 *   world → [AO] → viewmodel (cleared depth) → [bloom] → tone map → grade → [FXAA]
 * Low skips post-processing entirely and renders straight to the canvas.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly envMap: THREE.Texture;
  private composer: EffectComposer | null = null;
  private quality!: QualityPreset;
  private width = 1;
  private height = 1;

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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    // Count draw calls across all passes of a frame (reset in render()).
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    // Image-based lighting so metals/polymers read well.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.3;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  get info() {
    return this.renderer.info;
  }

  setQuality(q: QualityPreset) {
    const shadowsChanged = !this.quality || this.quality.shadows !== q.shadows || this.quality.shadowMapSize !== q.shadowMapSize;
    this.quality = q;

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
      ao.blendIntensity = 0.75;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
      composer.addPass(ao);
    }
    const view = new RenderPass(this.viewScene, this.viewCamera);
    view.clear = false;
    view.clearDepth = true;
    composer.addPass(view);
    if (q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.4, 0.45, 0.92));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
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
    this.disposeComposer();
    this.envMap.dispose();
    this.renderer.dispose();
    // Release the GL context now instead of waiting for GC; otherwise repeated
    // remounts hit the browser's active-context cap.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
