// Shader-text checks for the lighting patches (no GL in node): the light-loop
// patch must apply to three's current chunk, survive loop unrolling, and the
// baked material patch must hook every anchor it needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { installLightingChunks, patchBakedMaterial, neutralBakeAttributes } from "../src/game/render/BakedLighting";
import { SkyOcclusion } from "../src/game/render/SkyOcclusion";

const C = THREE.ShaderChunk as Record<string, string>;

function resolve(src: string): string {
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => resolve(C[name]));
}

/** three's loop unrolling (WebGLProgram.unrollLoops). */
function unroll(src: string) {
  return src.replace(/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g, (_m, s: string, e: string, body: string) => {
    let out = "";
    for (let i = parseInt(s); i < parseInt(e); i++) out += body.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, String(i));
    return out;
  });
}

test("light-loop patch applies and unrolls per cascade", () => {
  installLightingChunks();
  const chunk = C.lights_fragment_begin;
  assert.ok(chunk.includes("ihSunMul"), "baked sun hook installed");
  assert.ok(chunk.includes("Near/far cascade blend"), "cascade lookup installed");
  const src = unroll(resolve(chunk).replace(/NUM_DIR_LIGHTS/g, "2").replace(/NUM_DIR_LIGHT_SHADOWS/g, "2"));
  // Loop 0 carries the cascade blend and both maps; loop 1 is zeroed.
  assert.ok(src.includes("( 0 == 0 )"), "index-0 branch survives unrolling");
  assert.ok(src.includes("directionalShadowMap[ 1 ]"));
  assert.ok(src.includes("( 1 == 1 )"));
  // Balanced braces / preprocessor blocks.
  const opens = (src.match(/{/g) ?? []).length, closes = (src.match(/}/g) ?? []).length;
  assert.equal(opens, closes);
  const ifs = (src.match(/^\s*#if/gm) ?? []).length, ends = (src.match(/^\s*#endif/gm) ?? []).length;
  assert.equal(ifs, ends);
});

test("baked material patch hooks vertex + fragment anchors and chains", () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true });
  let prevCalled = false;
  m.onBeforeCompile = () => {
    prevCalled = true;
  };
  patchBakedMaterial(m);
  new SkyOcclusion([{ min: new THREE.Vector3(-1, 0, -1), max: new THREE.Vector3(1, 3, 1) }]).patch(m);
  const sh = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
  assert.ok(prevCalled);
  assert.ok(sh.vertexShader.includes("attribute vec4 ihGi;") && sh.vertexShader.includes("vIhGi = ihGi;"));
  assert.ok(sh.fragmentShader.includes("#define IH_GI"));
  assert.ok(sh.fragmentShader.indexOf("float ihSunMul") < sh.fragmentShader.indexOf("#include <lights_fragment_begin>"));
  assert.ok(sh.fragmentShader.includes("irradiance *= ihSky;"));
  assert.ok(sh.fragmentShader.includes("skyVisibility("), "sky occlusion still chained");
  assert.ok("ihGiParams" in sh.uniforms && "ihSunFade" in sh.uniforms);
  assert.match(m.customProgramCacheKey(), /ihgi1/);
  // Neutral attributes: open sky, no bounce, sun visible.
  const g = new THREE.BoxGeometry();
  neutralBakeAttributes(g);
  const gi = g.attributes.ihGi as THREE.BufferAttribute;
  assert.equal(gi.normalized, true);
  assert.deepEqual([gi.getX(0), gi.getY(0), gi.getZ(0), gi.getW(0)], [0, 0, 0, 1]);
  assert.equal((g.attributes.ihSunOcc as THREE.BufferAttribute).getX(3), 0);
});
