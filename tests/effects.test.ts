// Combat effects: surface classification, impact recipes, tracer cadence,
// procedural textures, pooled systems (no growth, everything drains).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { QUALITY, type QualityName } from "../src/game/config";
import {
  EffectsPool, FX_QUALITY, IMPACT, TracerCadence, impactKind, qualityFromLimits, type ImpactKind, type Surface,
} from "../src/game/effects/EffectsPool";
import { DECAL, buildDecalAtlas } from "../src/game/effects/Decals";
import { FLIPBOOK, fireballAtlasData } from "../src/game/effects/ProceduralFx";
import { ParticleSystem, SHAPE } from "../src/game/effects/Particles";
import { SMOKE_VOLUME_PUFFS, SmokeVolume } from "../src/game/effects/SmokeVolume";
import { fxLightingFor } from "../src/game/effects/FxLighting";

const SURFACES: Surface[] = ["concrete", "metal", "wood", "sand", "target", "steel", "flesh", "armor", "dirt", "glass"];

test("world materials refine the impact class", () => {
  assert.equal(impactKind("concrete", "brick"), "brick");
  assert.equal(impactKind("concrete", "plaster_damaged"), "plaster");
  assert.equal(impactKind("concrete", "worn_plaster_wall"), "plaster");
  assert.equal(impactKind("concrete", "concrete_dirty"), "concrete");
  assert.equal(impactKind("sand", "ground"), "dirt");
  assert.equal(impactKind("sand", "gravel"), "gravel");
  assert.equal(impactKind("sand", "sandbag"), "sand");
  assert.equal(impactKind("metal", "metal_rust"), "metal");
  for (const s of SURFACES) assert.equal(impactKind(s), s);
});

test("every impact class has a sensible recipe", () => {
  const tiles = new Set<number>(Object.values(DECAL));
  for (const [k, p] of Object.entries(IMPACT) as [ImpactKind, (typeof IMPACT)[ImpactKind]][]) {
    for (const t of p.decals) assert.ok(tiles.has(t), `${k} decal tile ${t}`);
    assert.ok(p.chips >= 0 && p.dust >= 0 && p.sparks >= 0, k);
    assert.ok(p.decalSize > 0.02 && p.decalSize < 0.3, k);
  }
  // Metal sparks and flashes, masonry doesn't flash, wood splinters, dirt sprays.
  assert.ok(IMPACT.metal.sparks > 5 && IMPACT.metal.flash > 0);
  assert.ok(IMPACT.steel.sparks >= IMPACT.metal.sparks);
  assert.equal(IMPACT.concrete.flash, 0);
  assert.equal(IMPACT.wood.chipShape, SHAPE.splinter);
  assert.ok(IMPACT.dirt.plume && IMPACT.sand.plume);
  assert.ok(IMPACT.glass.glints > 0);
  assert.equal(IMPACT.flesh.decals.length, 0);
  for (const k of ["concrete", "brick", "plaster", "metal", "wood", "sand", "dirt", "glass"] as const) assert.ok(IMPACT[k].decals.length > 0, k);
});

test("tracer cadence: every Nth round, first round after a pause always", () => {
  const c = new TracerCadence(3, 0.35);
  const seq: boolean[] = [];
  for (let i = 0; i < 7; i++) seq.push(c.next(i * 0.08));
  assert.deepEqual(seq, [true, false, true, false, false, true, false]);
  // Single shots (bolt action, pistol taps) are all tracers.
  assert.equal(c.next(5), true);
  assert.equal(c.next(6), true);
});

test("effect quality follows the render presets", () => {
  for (const q of Object.keys(QUALITY) as QualityName[]) {
    assert.equal(qualityFromLimits(QUALITY[q].maxDecals, QUALITY[q].maxParticles), q);
  }
  assert.ok(FX_QUALITY.low.impactScale < FX_QUALITY.high.impactScale);
  assert.ok(FX_QUALITY.low.shells <= FX_QUALITY.medium.shells && FX_QUALITY.medium.shells <= FX_QUALITY.high.shells);
  assert.ok(FX_QUALITY.high.shells <= 40);
});

test("fireball flipbook burns out from a hot core into smoke", () => {
  const px = 32;
  const { data, size } = fireballAtlasData(px);
  assert.equal(size, FLIPBOOK.cols * px);
  assert.equal(data.length, size * size * 4);
  const frameStats = (f: number) => {
    let heat = 0, cov = 0;
    const ox = (f % FLIPBOOK.cols) * px, oy = Math.floor(f / FLIPBOOK.cols) * px;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = ((oy + y) * size + ox + x) * 4;
      heat += data[i];
      cov += data[i + 1];
    }
    return { heat: heat / (px * px), cov: cov / (px * px) };
  };
  const first = frameStats(0);
  const last = frameStats(FLIPBOOK.frames - 1);
  assert.ok(first.heat > last.heat * 2, `heat ${first.heat} → ${last.heat}`);
  assert.ok(first.cov > 10 && last.cov > 10);
  // Corners stay empty (no square edges on the sprite).
  assert.equal(data[1], 0);
});

test("decal atlas: soft round tiles with a matching normal map", () => {
  const T = 32;
  const { data, nrm, width, height } = buildDecalAtlas(T);
  assert.equal(width, T * 4);
  assert.equal(height, T * 4);
  assert.equal(data.length, nrm.length);
  for (let tile = 0; tile < 16; tile++) {
    const ox = (tile % 4) * T, oy = Math.floor(tile / 4) * T;
    const at = (x: number, y: number) => ((oy + y) * width + ox + x) * 4;
    assert.equal(data[at(0, 0) + 3], 0, `tile ${tile} corner alpha`);
    if (tile !== DECAL.scorch && tile !== DECAL.scorchSmall && tile !== DECAL.blood && tile !== DECAL.bloodB) {
      assert.ok(data[at(T / 2, T / 2) + 3] > 100, `tile ${tile} centre alpha`);
    }
  }
  // Crater walls tilt the normals; a flat area points straight out.
  let tilted = 0;
  for (let i = 0; i < nrm.length; i += 4) if (Math.abs(nrm[i] - 128) > 20) tilted++;
  assert.ok(tilted > 100);
  assert.ok(nrm[2] > 240);
});

test("particles land on a floor height given at spawn", () => {
  const ps = new ParticleSystem(8, false, "chunk");
  ps.spawnFloor = 0;
  ps.spawn(0, 1, 0, 1, 0, 0, 0.5, 0.5, 0.5, 3, 0.02, 0.02, 1, 9.8, 0, SHAPE.flake);
  for (let i = 0; i < 60; i++) ps.update(1 / 60);
  const pos = ps.points.geometry.getAttribute("position").array;
  assert.ok(Math.abs(pos[1]) < 0.01, `y ${pos[1]}`);
  // Still visible while resting (doesn't fade like a falling chip).
  const alpha = ps.points.geometry.getAttribute("alpha").array;
  assert.ok(alpha[0] > 0.9);
  ps.dispose();
});

test("effects pool handles every surface and drains back to idle", () => {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffeedd, 4);
  sun.position.set(30, 80, 20);
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xbcd0ff, 0x554433, 0.75));
  const fx = new EffectsPool(scene, QUALITY.high.maxDecals, QUALITY.high.maxParticles);
  assert.equal(fx.qualityName, "high");
  let lights = 0;
  fx.setImpactLightHook(() => lights++);
  const p = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(0, 0, 1);
  for (const s of SURFACES) for (let i = 0; i < 10; i++) fx.impact(p, n, s);
  fx.impact(p, n, "concrete", true, "brick");
  fx.impact(p, n, "sand", true, "ground");
  fx.explosion(new THREE.Vector3(3, 0, 3));
  assert.ok(lights > 0, "impact light hook fires for metal / explosions");
  fx.muzzleFlash(p, n, 1);
  fx.tracer(p, new THREE.Vector3(0, 1, 60));
  fx.tracer(new THREE.Vector3(0, 1, 60), p, true);
  fx.ejectShell(p, new THREE.Vector3(1, 1, 0), new THREE.Quaternion(), "rifle", 0);
  fx.ejectShell(p, new THREE.Vector3(1, 1, 0), new THREE.Quaternion(), "x39", 0);
  fx.update(1 / 60);
  assert.ok(fx.smoke.activeWindow > 0 && fx.debris.activeWindow > 0 && fx.fireball.activeWindow > 0);
  // Lighting was picked up from the scene.
  const lu = fxLightingFor(scene).uniforms;
  assert.ok(lu.fxSunDir.value.y > 0.5);
  for (let i = 0; i < 60 * 12; i++) fx.update(1 / 60);
  assert.equal(fx.smoke.activeWindow, 0);
  assert.equal(fx.debris.activeWindow, 0);
  assert.equal(fx.fire.activeWindow, 0);
  assert.equal(fx.fireball.activeWindow, 0);
  assert.equal(fx.shells.activeCount, 0);
  fx.dispose();
});

test("shell casings are capped per quality", () => {
  const fx = new EffectsPool(new THREE.Scene(), QUALITY.low.maxDecals, QUALITY.low.maxParticles);
  assert.equal(fx.qualityName, "low");
  for (let i = 0; i < 80; i++) fx.ejectShell(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(1, 1, 0), new THREE.Quaternion(), "pistol", 0);
  assert.ok(fx.shells.activeCount <= FX_QUALITY.low.shells);
  fx.dispose();
});

test("hostile rounds passing the camera trigger a whizz", () => {
  const fx = new EffectsPool(new THREE.Scene(), QUALITY.medium.maxDecals, QUALITY.medium.maxParticles);
  fx.setViewer(new THREE.Vector3(0, 1.6, 0));
  const hits: number[] = [];
  fx.setWhizzHook((_at, d) => hits.push(d));
  // Passes 0.8 m to the side of the eye.
  fx.tracer(new THREE.Vector3(0.8, 1.6, -60), new THREE.Vector3(0.8, 1.6, 40), true);
  // Far miss: no whizz.
  fx.tracer(new THREE.Vector3(20, 1.6, -60), new THREE.Vector3(20, 1.6, 40), true);
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(hits[0] - 0.8) < 0.01);
  fx.dispose();
});

test("smoke grenade volume: one cloud of lit puffs that clears", () => {
  const vol = new SmokeVolume(new THREE.Scene(), "medium");
  vol.spawn(new THREE.Vector3(0, 0, 0), 5, 3);
  vol.update(0.5);
  assert.equal(vol.liveCount, SMOKE_VOLUME_PUFFS.medium + 6);
  assert.equal(vol.mesh.count, vol.liveCount);
  vol.update(3);
  assert.equal(vol.liveCount, 0);
  assert.equal(vol.mesh.visible, false);
  vol.dispose();
});
