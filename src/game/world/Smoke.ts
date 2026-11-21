import * as THREE from "three";
import type { QualityName } from "../config";
import type { WorldExtra } from "./dressing/common";
import { worldDetail } from "./quality";
import { fxLightingFor } from "../effects/FxLighting";

/** Soft, lumpy smoke puff (alpha in A, slight shading in RGB). */
function puffTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let a = 99;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const x = S / 2 + (r() - 0.5) * S * 0.45, y = S / 2 + (r() - 0.5) * S * 0.45, rad = S * (0.12 + r() * 0.2);
    const gg = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    const v = 150 + r() * 60;
    gg.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
    gg.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gg;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type SmokeSource = { x: number; y: number; z: number; scale: number; dark?: boolean };

/**
 * Distant smoke columns: one InstancedMesh of camera-facing puffs (a single
 * draw call for every column). Each puff loops up its column in the vertex
 * shader — growing, drifting downwind and fading — so the CPU only updates a
 * time uniform. Shaded by the scene sun / sky (shared effect lighting) with a
 * fake per-puff sphere normal, so columns have a lit and a shadowed side.
 */
export function smokeColumns(sources: SmokeSource[], quality: QualityName): WorldExtra {
  const maxPuffs = 26;
  const geo = new THREE.PlaneGeometry(1, 1);
  const tex = puffTexture();
  const time = { value: 0 };
  const sunDir = { value: new THREE.Vector3(0.35, 0.85, 0.4).normalize() };
  const sunColor = { value: new THREE.Color(1, 0.96, 0.9) };
  const ambColor = { value: new THREE.Color(0.62, 0.66, 0.72) };
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = time;
    shader.uniforms.fxSunDir = sunDir;
    shader.uniforms.fxSunColor = sunColor;
    shader.uniforms.fxAmbColor = ambColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float time;
        attribute vec4 puff; // phase, seed, scale, darkness
        varying float vFade;
        varying float vDark;`,
      )
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        float life = fract(time * 0.035 + puff.x);
        vec3 base = vec3(instanceMatrix[3]);
        float h = life * 60.0 * puff.z;
        vec3 drift = vec3(0.9, 0.0, 0.35) * h * 0.55 + vec3(sin(puff.y * 6.28 + time * 0.2), 0.0, cos(puff.y * 4.0 + time * 0.17)) * (1.5 + h * 0.08);
        vec3 centre = base + vec3(0.0, h, 0.0) + drift;
        float size = (5.0 + h * 0.45) * puff.z * (0.8 + puff.y * 0.4);
        vec4 mvCentre = modelViewMatrix * vec4(centre, 1.0);
        float ang = puff.y * 6.28 + time * 0.05 * (puff.y - 0.5);
        vec2 corner = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy;
        vec4 mvPosition = mvCentre + vec4(corner * size, 0.0, 0.0);
        gl_Position = projectionMatrix * mvPosition;
        vFade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life));
        vDark = puff.w * (1.0 - life * 0.7);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;\nvarying float vDark;\nuniform vec3 fxSunDir;\nuniform vec3 fxSunColor;\nuniform vec3 fxAmbColor;")
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        diffuseColor.rgb *= mix(vec3(0.82, 0.8, 0.76), vec3(0.16, 0.15, 0.14), vDark);
        {
          // Puff as a lumpy sphere lit by the sun (wrap lighting) + sky.
          vec2 q = vMapUv * 2.0 - 1.0;
          float lump = texture2D(map, vMapUv.yx).a - 0.5;
          vec3 nrm = normalize(vec3(q + lump * 0.8, sqrt(max(0.05, 1.0 - dot(q, q)))));
          vec3 sv = normalize((viewMatrix * vec4(fxSunDir, 0.0)).xyz);
          float wrap = clamp((dot(nrm, sv) + 0.5) / 1.5, 0.0, 1.0);
          diffuseColor.rgb *= fxAmbColor * (0.9 + 0.25 * nrm.y) + fxSunColor * wrap * 0.75;
        }
        diffuseColor.a *= vFade * 0.9;`,
      );
  };
  mat.customProgramCacheKey = () => "ih-smoke";

  const count = sources.length * maxPuffs;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "smoke";
  const puff = new Float32Array(count * 4);
  let a = 7;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  sources.forEach((s, i) => {
    for (let k = 0; k < maxPuffs; k++) {
      const n = i * maxPuffs + k;
      m.makeTranslation(s.x + (r() - 0.5) * 3, s.y, s.z + (r() - 0.5) * 3);
      mesh.setMatrixAt(n, m);
      puff.set([k / maxPuffs + r() * 0.02, r(), s.scale, s.dark ? 0.85 : 0.35], n * 4);
    }
  });
  geo.setAttribute("puff", new THREE.InstancedBufferAttribute(puff, 4));
  mesh.frustumCulled = false; // puffs move far from their instance origin in the shader
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 2;

  const setQuality = (q: QualityName) => {
    const d = worldDetail(q);
    // Instances are column-major: draw the first N columns' puffs only.
    const cols = Math.min(sources.length, d.smokeColumns);
    mesh.count = cols * maxPuffs;
    // Fewer puffs per column on low: shrink via the phase spread (cheap: skip none, columns cut instead).
    mesh.visible = cols > 0;
  };
  setQuality(quality);
  mesh.onBeforeRender = (_r, scene) => {
    const l = fxLightingFor(scene as THREE.Scene);
    l.syncLights();
    sunDir.value.copy(l.uniforms.fxSunDir.value);
    sunColor.value.copy(l.uniforms.fxSunColor.value);
    ambColor.value.copy(l.uniforms.fxAmbColor.value);
  };
  const start = performance.now();
  return {
    object: mesh,
    update() {
      time.value = (performance.now() - start) / 1000;
    },
    setQuality,
    triangles: 0,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
