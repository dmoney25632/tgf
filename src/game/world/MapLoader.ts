import * as THREE from "three";
import { CollisionWorld } from "./Collision";
import type { Surface } from "../effects/EffectsPool";
import { QUALITY, type QualityPreset } from "../config";
import type { ModelId } from "../assets/manifest";
import { Atmosphere, type AtmosphereDef } from "../render/Atmosphere";
import { SkyOcclusion } from "../render/SkyOcclusion";
import { MaterialLibrary, setWorldWeather, type WeatherDef } from "../render/Materials";
import { MeshBuilder } from "./MeshBuilder";
import { WorldMaterials, type WorldMat } from "./WorldMaterials";
import { qualityName, worldDetail } from "./quality";
import { ModelPlacer } from "./Props";
import { disposeProxy, shadowProxies, solidCaster, type ShadowSource } from "./ShadowProxy";
import { createStyleKit, drawBox, surfaceOf } from "./BoxStyles";
import { buildTerrain } from "./Terrain";
import { Foliage } from "./Foliage";
import { DRESSINGS, defaultDressing } from "./dressing/index";

/**
 * How a box is drawn (its collider is always the plain AABB):
 * - plain: textured box (default)
 * - crate: plank box with edge battens
 * - container: corrugated shipping container with frame + door bars
 * - sandbags: stacked sandbag shapes
 * - barrier: chamfered concrete jersey barrier sections
 * - rock: photoscan rock fitted to the box (procedural rock fallback)
 * - model: glTF prop fitted to the box (`model` id; box fallback)
 * - tank: horizontal fuel tank on saddles
 * - bale: wrapped round bale
 * - pole: wooden telephone pole (collider = the base)
 * - perch: timber-revetted earth platform with a ladder
 * - berm: timber revetment face + earth embankment behind it
 * - hidden: collider only (the dressing draws the visual, e.g. tree trunks)
 */
export type BoxStyle = "plain" | "crate" | "container" | "sandbags" | "barrier" | "rock" | "model" | "tank" | "bale" | "pole" | "perch" | "berm" | "hidden";

export type MapBox = {
  x: number; z: number; w: number; h: number; d: number; y?: number;
  /** Tint (sRGB hex) multiplied over the material's texture. */
  color: number;
  surface?: Surface;
  /** Glowing panels (buy-station screens, lamps). */
  emissive?: number;
  /** Visual only (no collision, bullets pass). */
  decor?: boolean;
  /** Render material (defaults from `surface`). */
  mat?: WorldMat;
  style?: BoxStyle;
  /** Free-form label used by map dressings (e.g. "wall", "tree"). */
  tag?: string;
  /** glTF prop for style "model". */
  model?: ModelId;
  /** Visual yaw for models/poles (the collider stays axis-aligned). */
  rotY?: number;
  /** Rotate the texture 90° (horizontal planks, etc.). */
  rot90?: boolean;
};

/** Points of interest for survival. */
export type SurvivalLayout = {
  /** Where enemies appear (outside the play area). */
  enemySpawns: { x: number; z: number }[];
  /** Elevated sniper positions (feet height y). */
  perches: { x: number; y: number; z: number }[];
  buyStations: { x: number; z: number; name: string }[];
  ammoCrates: { x: number; z: number }[];
  /** Compound bounds (inside = defended area). */
  inner: number;
};
export type MapSpawn = { x: number; z: number; y?: number; yaw: number };
export type MapTarget = { x: number; z: number; y?: number; move?: { axis: "x" | "z"; range: number; speed: number } };
export type MapSteelPlate = { name: string; x: number; y: number; z: number; size: number };
export type MapSign = { x: number; y: number; z: number; text: string; rotY?: number };

export type MapDef = {
  id: string;
  name: string;
  size: number;
  groundColor: number;
  skyTop: number;
  skyHorizon: number;
  /** Legacy linear-fog range; used to derive a density when `atmosphere.fogDensity` is absent. */
  fogNear: number;
  fogFar: number;
  sunDirection: [number, number, number];
  spawns: MapSpawn[];
  boxes: MapBox[];
  targets: MapTarget[];
  plates: MapSteelPlate[];
  signs: MapSign[];
  sunColor?: number;
  sunIntensity?: number;
  hemiSky?: number;
  hemiGround?: number;
  survival?: SurvivalLayout;
  /** Overrides for sky/fog/lighting/exposure. */
  atmosphere?: Partial<AtmosphereDef>;
  /** Set-dressing id (terrain, foliage, props) — see world/dressing. */
  dressing?: string;
  /** Moss / dust weathering on upward faces and wall feet (default: light dust). */
  weather?: Partial<WeatherDef>;
};

export type MapStats = { drawables: number; triangles: number; grassTriangles: number; treeTriangles: number; terrainTriangles: number };

export type LoadedMap = {
  def: MapDef;
  collision: CollisionWorld;
  /** Solid meshes bullets can hit. */
  meshes: THREE.Mesh[];
  sun: THREE.DirectionalLight;
  atmosphere: Atmosphere;
  /** Interior volumes under roofs, where sky light is blocked. */
  sky: SkyOcclusion;
  /** Rescales foliage density, shadow fit and dust for a preset. */
  setQuality(q: QualityPreset): void;
  /** Approximate static geometry counts (for perf budgeting/debug). */
  stats(): MapStats;
  dispose(): void;
};

function resolveAtmosphere(def: MapDef): AtmosphereDef {
  const a = def.atmosphere ?? {};
  return {
    skyTop: def.skyTop,
    skyHorizon: def.skyHorizon,
    skyGround: a.skyGround ?? 0x4a4a40,
    // exp(-d·r) ≈ 50 % at the midpoint of the old linear range.
    fogDensity: a.fogDensity ?? 0.7 / ((def.fogNear + def.fogFar) / 2),
    fogColor: a.fogColor ?? def.skyHorizon,
    sunDirection: def.sunDirection,
    sunColor: def.sunColor ?? 0xffe9cc,
    sunIntensity: def.sunIntensity ?? 2.2,
    hemiSky: def.hemiSky ?? 0xcfdcec,
    hemiGround: def.hemiGround ?? 0x6e604a,
    hemiIntensity: a.hemiIntensity ?? 1.0,
    cloudCover: a.cloudCover ?? 0.6,
    envIntensity: a.envIntensity ?? 0.5,
    exposure: a.exposure ?? 1.05,
    ...a,
  };
}

/**
 * Builds a map from data: atmosphere (sky, height fog, sun, ambient),
 * terrain, styled + textured box geometry merged per material, set dressing
 * (props, poles, wires, buildings detail), foliage, and a matching AABB
 * collision world. Optional photo textures / glTF props / HDRI stream in
 * afterwards and replace their procedural stand-ins.
 */
export function loadMap(scene: THREE.Scene, def: MapDef, quality: QualityPreset = QUALITY.medium): LoadedMap {
  const collision = new CollisionWorld();
  const disposables: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  const half = def.size / 2 + 2;
  const root = new THREE.Group();
  root.name = "world";
  scene.add(root);

  // ---- Atmosphere -----------------------------------------------------------
  const atmosphere = new Atmosphere(scene, resolveAtmosphere(def), half);
  disposables.push(atmosphere);
  setWorldWeather(def.weather);
  const lib = new MaterialLibrary(quality);
  disposables.push(lib);
  const wm = new WorldMaterials(lib, quality);
  disposables.push(wm);

  // ---- Ground collision (flat) + raycast proxy -------------------------------
  collision.add(new THREE.Box3(new THREE.Vector3(-half * 2, -1, -half * 2), new THREE.Vector3(half * 2, 0, half * 2)));
  const groundGeo = new THREE.PlaneGeometry(half * 4, half * 4).rotateX(-Math.PI / 2);
  const groundProxy = new THREE.Mesh(groundGeo, lib.get("plain"));
  groundProxy.visible = false;
  groundProxy.userData.surface = "sand";
  groundProxy.updateMatrixWorld();
  meshes.push(groundProxy);
  disposables.push(groundGeo);

  // ---- Boxes ----------------------------------------------------------------
  const builder = new MeshBuilder();
  const props = new ModelPlacer(builder);
  const kit = createStyleKit(builder, props);
  disposables.push(kit.sandbag);
  const emissiveMats = new Map<number, THREE.MeshStandardMaterial>();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(unit);
  for (const b of def.boxes) {
    const y = b.y ?? 0;
    if (b.emissive) {
      let mat = emissiveMats.get(b.emissive);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.4, emissive: b.emissive, emissiveIntensity: 2.2 });
        emissiveMats.set(b.emissive, mat);
        disposables.push(mat);
      }
      const mesh = new THREE.Mesh(unit, mat);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, y + b.h / 2, b.z);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.surface = b.surface ?? "metal";
      root.add(mesh);
      if (!b.decor) meshes.push(mesh);
    } else drawBox(kit, b);
    if (b.decor) continue;
    collision.add(new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2)));
  }

  // ---- Set dressing (terrain shape, foliage plan, extra decor) --------------
  const dressing = (def.dressing && DRESSINGS[def.dressing]) || defaultDressing;
  const plan = dressing({ def, builder, props, style: kit, quality, materials: wm, windTime: atmosphere.windTime, addLamp: (p, c, i, d) => { atmosphere.addLamp(p, c, i, d); } });
  builder.ground = plan.terrain.height;
  for (const x of plan.extras ?? []) {
    root.add(x.object);
    disposables.push(x);
    if (x.update) atmosphere.frameHooks.push((cam) => x.update!(cam));
  }

  const terrain = buildTerrain(plan.terrain, lib, quality);
  root.add(terrain.mesh);
  disposables.push(terrain);

  // Foliage avoids anything solid near the ground (inflated footprints).
  const footprints = collision.boxes.filter((b) => b.min.y < 1.5 && b.max.y > 0.01);
  const blocked = (x: number, z: number) => {
    for (const b of footprints) if (x > b.min.x - 0.35 && x < b.max.x + 0.35 && z > b.min.z - 0.35 && z < b.max.z + 0.35) return true;
    return false;
  };
  const foliage = new Foliage(plan.foliage, plan.terrain.height, blocked, lib, atmosphere.windTime, quality);
  root.add(foliage.group);
  disposables.push(foliage);
  atmosphere.frameHooks.push((cam) => foliage.update(cam));

  // ---- Signs ----------------------------------------------------------------
  for (const s of def.signs) {
    const tex = makeSignTexture(s.text);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
    const geo = new THREE.PlaneGeometry(1.2, 0.6);
    disposables.push(tex, mat, geo);
    const sign = new THREE.Mesh(geo, mat);
    sign.position.set(s.x, s.y, s.z);
    sign.rotation.y = s.rotY ?? 0;
    sign.userData.surface = "metal";
    sign.updateMatrixWorld();
    root.add(sign);
    meshes.push(sign);
  }

  // ---- Merge static geometry --------------------------------------------------
  const groups = builder.build((m) => wm.get(m));
  let staticTris = 0;
  const clutter: THREE.Mesh[] = [];
  for (const [group, list] of groups) {
    for (const mesh of list) {
      disposables.push(mesh.geometry);
      staticTris += mesh.geometry.attributes.position.count / 3;
      if (group.startsWith("proxy:")) {
        mesh.visible = false;
        mesh.castShadow = mesh.receiveShadow = false;
        mesh.userData.surface = group.slice(6) as Surface;
        mesh.updateMatrixWorld();
        meshes.push(mesh);
        staticTris -= mesh.geometry.attributes.position.count / 3;
        continue;
      }
      root.add(mesh);
      if (group.startsWith("clutter@")) {
        // Small detail: no shadow casting, culled by distance per cell.
        mesh.castShadow = false;
        clutter.push(mesh);
      }
      if (group.startsWith("far")) mesh.receiveShadow = false;
      if (group === "solid") {
        mesh.userData.surface = surfaceOf(mesh.userData.material as WorldMat);
        meshes.push(mesh);
      }
    }
  }
  // Static casters → one shadow-only mesh per face side (saves ~30 shadow draws).
  const casters: { side: THREE.Side; src: ShadowSource }[] = [];
  for (const [group, list] of groups) {
    if (group !== "solid" && group !== "decor") continue;
    for (const mesh of list) {
      if (!mesh.castShadow || !solidCaster(mesh.material)) continue;
      casters.push({ side: (mesh.material as THREE.Material).side, src: { geometry: mesh.geometry, matrix: mesh.matrixWorld } });
      mesh.castShadow = false;
    }
  }
  for (const proxy of shadowProxies(casters, "static")) {
    root.add(proxy);
    disposables.push({ dispose: () => disposeProxy(proxy) });
  }
  props.start(root, groups);
  disposables.push(props);

  let clutterDistance = worldDetail(qualityName(quality)).clutterDistance;
  const cellCentre = new THREE.Vector3();
  atmosphere.frameHooks.push((cam) => {
    for (const m of clutter) {
      const s = m.geometry.boundingSphere!;
      cellCentre.copy(s.center);
      m.visible = clutterDistance > 0 && cam.position.distanceTo(cellCentre) < clutterDistance + s.radius;
    }
  });
  const setQuality = (q: QualityPreset) => {
    atmosphere.setQuality(q);
    foliage.setQuality(q);
    const name = qualityName(q);
    clutterDistance = worldDetail(name).clutterDistance;
    props.setQuality(name);
    for (const x of plan.extras ?? []) x.setQuality?.(name);
  };
  setQuality(quality);

  const sky = SkyOcclusion.fromRoofs(def.boxes.filter((b) => b.tag === "roof")).activate();
  sky.patchScene(root);

  return {
    def,
    collision,
    meshes,
    sun: atmosphere.sun,
    atmosphere,
    sky,
    setQuality,
    stats() {
      let drawables = 0;
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) drawables++;
      });
      return {
        drawables,
        triangles: staticTris + terrain.triangles + props.triangles + (plan.extras ?? []).reduce((a, x) => a + (x.triangles ?? 0), 0),
        grassTriangles: foliage.triangles.grass + foliage.triangles.tallGrass,
        treeTriangles: foliage.triangles.trees + foliage.triangles.bushes,
        terrainTriangles: terrain.triangles,
      };
    },
    dispose() {
      sky.deactivate();
      root.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}

function makeSignTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d6d0bc";
  ctx.fillRect(0, 0, 256, 128);
  // Weathering: speckle + a rust run from the top bolts.
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(60,50,35,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  ctx.fillStyle = "#a8622a";
  ctx.fillRect(0, 0, 256, 16);
  ctx.fillStyle = "#1d1e1c";
  ctx.font = "bold 62px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 74);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(90,70,40,0)");
  g.addColorStop(1, "rgba(90,70,40,0.18)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
