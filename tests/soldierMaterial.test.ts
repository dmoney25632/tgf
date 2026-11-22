// Shader-text checks for the mocap soldier material (no GL in node): every
// hook applies to three's current chunks on each tier, the High-only skin /
// detail-normal code stays out of Medium, and head donors map their one-part
// atlas onto the head quadrant.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { setSoldierQuality, soldierMaterial, disposeSoldierMaterials, type SoldierAvatar } from "../src/game/ai/soldier/assets";

const C = THREE.ShaderChunk as Record<string, string>;
const resolve = (src: string): string => src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => resolve(C[name]));

function avatar(headOnly: boolean, normal: boolean): SoldierAvatar {
  const t = () => new THREE.Texture();
  return {
    id: headOnly ? "i" : "a",
    meta: { sex: "m", cap: false, headOnly, parts: headOnly ? ["head"] : ["body", "head"], tris: {}, gains: [6, 0, 16, 17], skin: { head: 0x42281d, body: 0x42281d }, eyes: 1.62, top: 1.73 },
    rootBone: new THREE.Bone(),
    joints: [],
    boneInverses: [],
    parts: {},
    maps: { color: t(), normal: normal ? t() : null, orm: t() },
  };
}

function compile(q: "high" | "medium", headOnly = false) {
  setSoldierQuality(q);
  const m = soldierMaterial(avatar(headOnly, q === "high"), { uniform: 0x5b6148, vest: 0x4b4a38, helmet: 0x55553f }, { tone: 0x96633f, beard: 0.45, balaclava: false, knit: 0 }, false);
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, defines: {} };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { m, shader, frag: resolve(shader.fragmentShader) };
}

const braces = (src: string) => (src.match(/{/g) ?? []).length - (src.match(/}/g) ?? []).length;
/** three's own chunks are off by one (a brace in a comment): the patches must not change that. */
const BASE = braces(resolve(THREE.ShaderLib.standard.fragmentShader));

function balanced(src: string) {
  assert.equal(braces(src), BASE, "braces");
  assert.equal((src.match(/^\s*#if/gm) ?? []).length, (src.match(/^\s*#endif/gm) ?? []).length, "#if / #endif");
}

test("High: skin specular, wrap lighting, pores and weave all hook in", () => {
  const { m, shader, frag } = compile("high");
  assert.ok("IH_HQ" in (m.defines ?? {}));
  for (const s of ["ihUv = uHeadOnly", "hmSssIrr", "hmSheen * directLight.color", "vec3( 0.028 )", "clamp( roughnessFactor * 0.8, 0.4, 0.62 )", "texture2D( uPores", "texture2D( uWeave", "mapN.xy += ihPore"]) {
    assert.ok(frag.includes(s), `missing ${s}`);
  }
  // Globals the light chunk reads are declared before it.
  assert.ok(frag.indexOf("float hmSssAmt") < frag.indexOf("hmSssIrr"));
  assert.ok(frag.indexOf("vec2 ihUv") < frag.indexOf("mapN.xy += ihPore"));
  assert.ok(shader.uniforms.uPores?.value && shader.uniforms.uWeave?.value && shader.uniforms.uHeadOnly);
  balanced(frag);
  assert.match(m.customProgramCacheKey(), /hq/);
  disposeSoldierMaterials();
});

test("Medium stays cheap: no skin lighting, no detail taps", () => {
  const { m, shader, frag } = compile("medium");
  assert.ok(!("IH_HQ" in (m.defines ?? {})));
  for (const s of ["hmSssIrr", "texture2D( uPores", "texture2D( uWeave", "mapN.xy += ihPore"]) assert.ok(!frag.includes(s), `unexpected ${s}`);
  assert.ok(!shader.uniforms.uPores);
  // The re-tint (and the wet eyes, from the ORM map) is the same on every tier.
  assert.ok(frag.includes("ihUv = uHeadOnly"));
  balanced(frag);
  assert.notEqual(m.customProgramCacheKey(), compile("high").m.customProgramCacheKey());
  disposeSoldierMaterials();
});

test("head donors flag their one-part atlas", () => {
  const { shader } = compile("high", true);
  assert.equal(shader.uniforms.uHeadOnly.value, 1);
  assert.equal(compile("medium", false).shader.uniforms.uHeadOnly.value, 0);
  disposeSoldierMaterials();
  setSoldierQuality("medium");
});
