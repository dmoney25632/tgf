import * as THREE from "three";
import type { QualityPreset } from "../config";
import type { MaterialLibrary } from "../render/Materials";

/** Splat weights (any scale; normalised per vertex). */
export type Splat = { gravel: number; ground: number; mud: number };

export type TerrainSpec = {
  /** Visual height (m). Keep 0 wherever gameplay happens: collision is a flat plane at y=0. */
  height(x: number, z: number): number;
  splat(x: number, z: number, out: Splat): void;
  /** Half-size of the dense, evenly spaced region. */
  inner: number;
  /** Half-size of the whole terrain (fogged out well before the edge). */
  outer: number;
};

/** Grid coordinates: even spacing to ±inner, then geometric growth to ±outer. */
function axis(inner: number, outer: number, step: number) {
  const pos: number[] = [];
  for (let x = 0; x <= inner + 1e-6; x += step) pos.push(x);
  let x = pos[pos.length - 1];
  let s = step;
  while (x < outer) {
    s *= 1.18;
    x = Math.min(outer, x + s);
    pos.push(x);
  }
  const neg = pos.slice(1).map((v) => -v).reverse();
  return [...neg, ...pos];
}

/**
 * Ground mesh: graded grid (dense near the play area, coarse in the
 * distance) with per-vertex splat weights blending gravel / grassy earth /
 * wet mud. The shader samples textures in world space, sharpens the blend
 * with noise and breaks up tiling with a second, rotated, larger-scale
 * sample. Visual only — bullets hit a flat proxy plane.
 */
export function buildTerrain(spec: TerrainSpec, lib: MaterialLibrary, quality: QualityPreset) {
  const step = quality.foliageDensity >= 1 ? 1 : quality.foliageDensity >= 0.6 ? 1.25 : 2;
  const xs = axis(spec.inner, spec.outer, step);
  const n = xs.length;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const splat = new Float32Array(n * n * 3);
  const sp: Splat = { gravel: 0, ground: 0, mud: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i], z = xs[j];
      const k = j * n + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = spec.height(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = x;
      uv[k * 2 + 1] = -z;
      spec.splat(x, z, sp);
      const sum = sp.gravel + sp.ground + sp.mud || 1;
      splat[k * 3] = sp.gravel / sum;
      splat[k * 3 + 1] = sp.ground / sum;
      splat[k * 3 + 2] = sp.mud / sum;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("splat", new THREE.BufferAttribute(splat, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const ground = lib.textures("ground");
  const gravel = lib.textures("gravel");
  const uniforms = {
    gravelMap: { value: gravel.albedo },
    gravelNormal: { value: gravel.normal },
    gravelRough: { value: gravel.rough },
    grimeMap: { value: lib.grimeTexture },
    groundScale: { value: 1 / lib.tile("ground") },
    gravelScale: { value: 1 / lib.tile("gravel") },
  };
  const mat = new THREE.MeshStandardMaterial({
    map: ground.albedo,
    normalMap: ground.normal,
    roughnessMap: ground.rough,
    roughness: 1,
    metalness: 0,
  });
  mat.name = "ih-terrain";
  const sync = () => {
    const g = lib.textures("ground"), v = lib.textures("gravel");
    mat.map = g.albedo;
    mat.normalMap = g.normal;
    mat.roughnessMap = g.rough;
    uniforms.gravelMap.value = v.albedo;
    uniforms.gravelNormal.value = v.normal;
    uniforms.gravelRough.value = v.rough;
  };
  const unsubscribe = lib.onChange(sync);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec2 vWorldXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplat = splat;\nvWorldXZ = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform sampler2D gravelMap;
        uniform sampler2D gravelNormal;
        uniform sampler2D gravelRough;
        uniform sampler2D grimeMap;
        uniform float groundScale;
        uniform float gravelScale;
        varying vec3 vSplat;
        varying vec2 vWorldXZ;`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        vec2 wuv = vec2(vWorldXZ.x, -vWorldXZ.y);
        vec4 tMacro = texture2D(grimeMap, wuv * 0.011);
        vec4 tMeso = texture2D(grimeMap, wuv * 0.047);
        // Noise-sharpened splat weights for crisp, natural transitions.
        vec3 w = vSplat + (vec3(tMeso.g, tMeso.r, tMeso.b) - 0.5) * 0.45;
        w = pow(max(w, vec3(0.0)), vec3(2.5));
        w /= max(w.x + w.y + w.z, 1e-4);
        vec2 uvA = wuv * groundScale;
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * wuv * groundScale * 0.37 + 0.31;
        vec3 cA = mix(texture2D(map, uvA).rgb, texture2D(map, uvB).rgb, smoothstep(0.35, 0.65, tMacro.g));
        vec3 cG = texture2D(gravelMap, wuv * gravelScale).rgb * vec3(0.78, 0.76, 0.72);
        vec3 cM = cA * vec3(0.42, 0.36, 0.3);
        vec3 alb = cG * w.x + cA * w.y + cM * w.z;
        alb *= mix(0.82, 1.12, tMacro.r);
        diffuseColor.rgb *= alb;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        float roughnessFactor = roughness;
        roughnessFactor *= texture2D(roughnessMap, uvA).g * w.y + texture2D(gravelRough, wuv * gravelScale).g * w.x + 0.42 * w.z;`,
      )
      .replace(
        "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
        "vec3 mapN = (texture2D( normalMap, uvA ).xyz * (w.y + w.z) + texture2D( gravelNormal, wuv * gravelScale ).xyz * w.x) * 2.0 - 1.0;",
      )
      .replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * (1.0 - w.z * 0.75);");
  };

  mat.customProgramCacheKey = () => "ih-terrain";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return {
    mesh,
    triangles: idx.length / 3,
    dispose() {
      unsubscribe();
      geo.dispose();
      mat.dispose();
    },
  };
}
