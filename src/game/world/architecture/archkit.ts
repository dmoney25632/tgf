import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { QualityName } from "../../config";
import { assetUrl } from "../../assets/manifest";
import { dequantize, loadScene } from "../../assets/AssetLoader";
import type { MeshBuilder } from "../MeshBuilder";
import type { WorldExtra } from "../dressing/common";
import type { Frame, Tint } from "./kit";

/**
 * Modular architecture kit (art/blender/archkit, Blender-built, CC0-style
 * original work): window and door units, shutters, mouldings, rainwater
 * goods, roof edges, chimneys, balconies, steps and the gameplay-height
 * cover set, all at real size with bevels, weighted normals and baked AO.
 *
 * Visual only. Builders keep drawing their simple boxes, but into the
 * kit's *fallback* group (`layer.fallback(group)`), and also record the kit
 * piece that replaces them (`layer.at(...)`). Collision, raycast proxies
 * and the light-bake occluders never change. At run time:
 *   - every piece of every building draws through three BatchedMeshes (one
 *     atlas material, glass, lamp bulbs): ~3 draw calls for the whole kit,
 *     per-instance frustum culling, LOD0/LOD1 swapped per instance by
 *     distance, tiny detail culled at range;
 *   - the fallback boxes are hidden while the kit is up, and shown again
 *     if the kit file is missing or the preset drops to Low (dressings do
 *     not attach the kit on Low at all, so Low builds exactly as before).
 *
 * Piece frame (glTF): X along the wall, Y up, -Z out of the wall, origin
 * on the outer wall face (bottom centre of an opening / of a 1 m module):
 * exactly `Frame.matrix(u, y, d)`'s local frame. Door leaves have their
 * origin on the hinge axis and run along +X: rotate them about Y to swing.
 */

export const ARCHKIT_FILES = { full: "archkit/archkit.gltf", small: "archkit/archkit_1k.gltf" } as const;

/** Gameplay heights the cover pieces are built to (shared with movement: vault / mantle). */
export const COVER = {
  /** Standard low cover / vaultable top. */
  low: 1.0,
  lowMin: 0.9,
  lowMax: 1.1,
  /** Standard mantle ledge; anything above `mantleMax` is not climbable. */
  mantle: 1.8,
  mantleMax: 1.9,
} as const;

export type CoverClass = "step" | "low" | "mantle" | "wall";
/** How a top at height `h` reads (and plays): step over, vault, mantle, or not climbable. */
export function coverClass(h: number): CoverClass {
  if (h < COVER.lowMin - 0.25) return "step";
  if (h <= COVER.lowMax + 0.05) return "low";
  if (h <= COVER.mantleMax) return "mantle";
  return "wall";
}

/** Canonical sizes the pieces were modelled at (the builders scale to the real opening). */
export const KIT_SIZE = {
  window: { w: 1.0, h: 1.4 },
  door: { w: 1.1, h: 2.2 },
  leaf: { w: 1.0, h: 2.15, t: 0.045 },
  shop: { w: 2.4, h: 2.5 },
  /** Door leaf hinge axis inside the frame: inset from the jamb and depth (m, - = into the wall). */
  hingeInset: 0.06,
  leafDepth: -0.1675,
  quoinLong: 0.56,
  quoinShort: 0.3,
  module: 1.0,
  slats: 0.5,
} as const;

export const KIT_PIECES = [
  "win_casement", "win_casement_broken", "win_sill", "win_lintel", "win_lintel_key", "win_surround",
  "shutters_open", "louvres_open", "shutters_closed", "louvres_closed", "shutter_hanging", "win_boarded", "win_bricked", "win_bars",
  "door_frame", "door_surround", "door_leaf_panel", "door_leaf_plank", "door_leaf_metal", "door_step", "door_lamp",
  "shopfront", "roller_box", "roller_slats", "roller_bottom",
  "cornice", "string_course", "plinth_course", "quoin_long", "quoin_short", "corbel",
  "gutter", "downpipe", "downpipe_shoe", "downpipe_head", "fascia", "ridge_clay", "roof_slate", "roof_clay",
  "chimney_stack", "chimney_stack_stone", "chimney_cap", "balcony_slab", "balcony_rail", "balcony_post",
  "steps_3", "step_block", "coping_low", "coping_mantle", "lowwall", "wall_mantle", "sandbag_row", "crate_cover", "rubble_low", "fence_timber",
] as const;
export type KitPiece = (typeof KIT_PIECES)[number];

/** Small pieces stop drawing beyond this many metres (x preset scale); others draw to the fog. */
const CULL: Partial<Record<KitPiece, number>> = {
  door_lamp: 45, downpipe_head: 50, downpipe_shoe: 40, corbel: 55, quoin_short: 70, quoin_long: 70, roller_bottom: 45,
  win_bars: 55, balcony_post: 60, step_block: 60, door_step: 60, string_course: 90, plinth_course: 80, gutter: 90, downpipe: 80,
  roof_slate: 26, roof_clay: 26,
};
const LOD = { low: { lod0: 0, cull: 0 }, medium: { lod0: 8, cull: 0.6 }, high: { lod0: 16, cull: 1 } } as const;

/** MeshBuilder group prefix of the box stand-ins (hidden while the kit draws). */
export const FALLBACK = "kitfb:";

type Kind = "atlas" | "glass" | "lamp";
const KINDS: Kind[] = ["atlas", "glass", "lamp"];

type Placement = { piece: KitPiece; m: THREE.Matrix4; tint: THREE.Color; c: THREE.Vector3; cull: number; ids: Partial<Record<Kind, number>>; lod: number; vis: boolean };

/** A swinging door leaf (kit instance) the gameplay code can animate. */
export type KitDoor = {
  piece: KitPiece;
  /** World position of the hinge axis at the leaf's foot. */
  hinge: THREE.Vector3;
  /** World yaw of the closed leaf (its local +X runs from the hinge across the opening). */
  yaw: number;
  /** Sign of yaw change that swings the leaf into the building. */
  inward: 1 | -1;
  width: number;
  height: number;
  /** Current opening angle (rad, + = into the building). */
  angle: number;
  /** Placement index (internal). */
  index: number;
};

const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _b = new THREE.Box3();

/** Vertex-colour handling for the atlas: RGB = baked AO, A = how much the instance tint applies. */
const TINT_VERTEX = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
	vColor = vec4( color.rgb, 1.0 );
	#ifdef USE_BATCHING_COLOR
		vColor.rgb *= mix( vec3( 1.0 ), getBatchingColor( getIndirectIndex( gl_DrawID ) ).rgb, color.a );
	#endif
#else
${THREE.ShaderChunk.color_vertex}
#endif
`;

export function patchKitMaterial(mat: THREE.MeshStandardMaterial) {
  mat.vertexColors = true;
  // Pieces are closed solids (Blender exports them double-sided): skip the back faces.
  mat.side = THREE.FrontSide;
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <color_vertex>", TINT_VERTEX);
  };
  mat.customProgramCacheKey = () => "archkit-tint";
  return mat;
}

/** Piece geometry per material kind, LOD0 and (when shipped) LOD1, from the kit glTF. */
export type KitGeometry = Map<string, Partial<Record<Kind, THREE.BufferGeometry>>>;

/** Bakes the kit scene's nodes into per-piece, per-material geometries (float attributes, indexed). */
export function kitGeometry(scene: THREE.Object3D): { geos: KitGeometry; atlas: THREE.MeshStandardMaterial | null } {
  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const geos: KitGeometry = new Map();
  let atlas: THREE.MeshStandardMaterial | null = null;
  for (const node of scene.children) {
    const parts = new Map<Kind, THREE.BufferGeometry[]>();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const name = (mesh.material as THREE.Material).name;
      const kind: Kind = name.includes("glass") ? "glass" : name.includes("lamp") ? "lamp" : "atlas";
      if (kind === "atlas" && !atlas) atlas = mesh.material as THREE.MeshStandardMaterial;
      const g = new THREE.BufferGeometry();
      const src = mesh.geometry;
      const pos = dequantize(src.getAttribute("position") as THREE.BufferAttribute);
      const n = pos.count;
      g.setAttribute("position", pos.clone());
      const nor = src.getAttribute("normal") as THREE.BufferAttribute | undefined;
      g.setAttribute("normal", nor ? dequantize(nor).clone() : new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const uv = src.getAttribute("uv") as THREE.BufferAttribute | undefined;
      g.setAttribute("uv", uv ? dequantize(uv).clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      const col = src.getAttribute("color") as THREE.BufferAttribute | undefined;
      const c4 = new Float32Array(n * 4).fill(1);
      if (col) for (let i = 0; i < n; i++) for (let k = 0; k < col.itemSize; k++) c4[i * 4 + k] = col.getComponent(i, k);
      if (kind !== "atlas" || !col) for (let i = 0; i < n; i++) c4[i * 4 + 3] = 0;
      g.setAttribute("color", new THREE.BufferAttribute(c4, 4));
      if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
      else g.setIndex(Array.from({ length: n }, (_, i) => i));
      if (!nor) g.computeVertexNormals();
      g.applyMatrix4(_m.multiplyMatrices(inv, mesh.matrixWorld));
      const list = parts.get(kind) ?? [];
      list.push(g);
      parts.set(kind, list);
    });
    const entry: Partial<Record<Kind, THREE.BufferGeometry>> = {};
    for (const [kind, list] of parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (merged) {
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        entry[kind] = merged;
      }
    }
    if (Object.keys(entry).length) geos.set(node.name, entry);
  }
  return { geos, atlas };
}

/**
 * The kit layer of one map: collects placements while the dressing runs,
 * then (as a WorldExtra) loads the kit and draws them.
 */
export class ArchKitLayer {
  readonly placements: Placement[] = [];
  readonly doors: KitDoor[] = [];
  private readonly fallbackMeshes: THREE.Mesh[] = [];
  private batches = new Map<Kind, THREE.BatchedMesh>();
  private geoIds = new Map<string, Partial<Record<Kind, number>>>();
  private loaded = false;
  private failed = false;
  private quality: QualityName;
  private readonly last = new THREE.Vector3(1e9, 0, 0);
  private dirty = true;
  /** Rendered triangles at the current LOD state (stats). */
  triangles = 0;
  private trisOf = new Map<string, number>();

  constructor(quality: QualityName) {
    this.quality = quality;
  }

  /** The MeshBuilder group a kit-replaced box goes into (its stand-in). */
  fallback(group = "decor") {
    return group.startsWith(FALLBACK) ? group : `${FALLBACK}${group}`;
  }

  /** Places a piece by a full world matrix (scale included). Returns the placement index. */
  place(piece: KitPiece, m: THREE.Matrix4, tint: Tint = 0xffffff, cull?: number) {
    const c = new THREE.Vector3().setFromMatrixPosition(m);
    this.placements.push({ piece, m: m.clone(), tint: new THREE.Color(tint), c, cull: cull ?? CULL[piece] ?? 400, ids: {}, lod: -1, vis: false });
    this.dirty = true;
    return this.placements.length - 1;
  }

  /** Piece in a facade frame at (u, y, d), scaled (sx along, sy up, sz depth), turned `yaw` about up. */
  at(piece: KitPiece, f: Frame, u: number, y: number, d: number, sx = 1, sy = 1, sz = 1, tint: Tint = 0xffffff, yaw = 0) {
    const m = f.matrix(u, y, d);
    if (yaw) m.multiply(_r.makeRotationY(yaw));
    m.multiply(_s.makeScale(sx, sy, sz));
    return this.place(piece, m, tint);
  }

  /** Repeats a 1 m module along a facade from u0 to u1 (stretched to fit whole modules). */
  run(piece: KitPiece, f: Frame, u0: number, u1: number, y: number, d: number, tint: Tint = 0xffffff, sy = 1, sz = 1) {
    const len = u1 - u0;
    if (len < 0.2) return;
    const n = Math.max(1, Math.round(len / KIT_SIZE.module));
    const w = len / n;
    for (let i = 0; i < n; i++) this.at(piece, f, u0 + w * (i + 0.5), y, d, w, sy, sz, tint);
  }

  /**
   * Repeats a 1 m module between two world points (gutters, ridges): X runs a→b,
   * `out` is the side the piece faces (its local -Z), Y completes the frame.
   */
  runBetween(piece: KitPiece, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, tint: Tint = 0xffffff, sy = 1, sz = 1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.2) return;
    dir.divideScalar(len);
    const z = out.clone().projectOnPlane(dir).normalize().negate();
    const y = new THREE.Vector3().crossVectors(z, dir).normalize();
    const n = Math.max(1, Math.round(len / KIT_SIZE.module));
    const w = len / n;
    for (let i = 0; i < n; i++) {
      const p = a.clone().addScaledVector(dir, w * (i + 0.5));
      const m = new THREE.Matrix4().makeBasis(dir, y, z).setPosition(p).multiply(_s.makeScale(w, sy, sz));
      this.place(piece, m, tint);
    }
  }

  /**
   * A door leaf hung on the hinge at `hingeU` (facade frame), `side` = which jamb carries
   * the hinge as seen from the street. `angle` opens it into the building (rad).
   */
  leaf(piece: KitPiece, f: Frame, hingeU: number, width: number, height: number, side: "left" | "right", angle: number, tint: Tint = 0xffffff, d: number = KIT_SIZE.leafDepth) {
    const hinge = f.at(hingeU, 0, d);
    // Left hinge: leaf runs +t; right hinge: turned half round, runs -t.
    const yaw = f.rotY + (side === "left" ? 0 : Math.PI);
    const inward: 1 | -1 = side === "left" ? -1 : 1;
    const door: KitDoor = { piece, hinge, yaw, inward, width, height, angle, index: -1 };
    door.index = this.place(piece, this.leafMatrix(door), tint);
    this.doors.push(door);
    return this.doors.length - 1;
  }

  private leafMatrix(d: KitDoor) {
    return new THREE.Matrix4()
      .makeRotationY(d.yaw + d.inward * d.angle)
      .setPosition(d.hinge)
      .multiply(_s.makeScale(d.width / KIT_SIZE.leaf.w, d.height / KIT_SIZE.leaf.h, 1));
  }

  /** Swings door `i` to `angle` (rad, + = into the building). Cheap: one matrix write per batch. */
  setDoorAngle(i: number, angle: number) {
    const d = this.doors[i];
    if (!d) return;
    d.angle = angle;
    const p = this.placements[d.index];
    p.m.copy(this.leafMatrix(d));
    for (const k of KINDS) {
      const id = p.ids[k];
      if (id !== undefined) this.batches.get(k)?.setMatrixAt(id, p.m);
    }
  }

  /** Box stand-ins built into `builder` under fallback groups start hidden (shown if the kit fails). */
  adopt(builder: MeshBuilder) {
    const build = builder.build.bind(builder);
    builder.build = (resolve) => {
      const out = build(resolve);
      for (const [group, list] of out) {
        if (!group.startsWith(FALLBACK)) continue;
        for (const m of list) {
          m.visible = this.failed || this.quality === "low";
          this.fallbackMeshes.push(m);
        }
      }
      return out;
    };
    return builder;
  }

  get count() {
    return this.placements.length;
  }

  /** Approximate triangles drawn if every placement were at LOD `lod` (needs the kit loaded). */
  trianglesAt(lod: 0 | 1) {
    let n = 0;
    for (const p of this.placements) n += this.trisOf.get(lod ? `${p.piece}__lod1` : p.piece) ?? this.trisOf.get(p.piece) ?? 0;
    return n;
  }

  private showFallback(on: boolean) {
    for (const m of this.fallbackMeshes) m.visible = on;
  }

  private instantiate(group: THREE.Object3D, geos: KitGeometry, atlas: THREE.MeshStandardMaterial | null) {
    const used = new Set(this.placements.map((p) => p.piece));
    const mats: Record<Kind, THREE.Material> = {
      atlas: patchKitMaterial((atlas ?? new THREE.MeshStandardMaterial({ color: 0xbbb4a8, roughness: 0.85 })).clone()),
      glass: new THREE.MeshStandardMaterial({ color: 0x10161a, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.3, name: "archkit-glass" }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb466, emissiveIntensity: 2.4, roughness: 0.4, name: "archkit-lamp" }),
    };
    (mats.atlas as THREE.MeshStandardMaterial).name = "archkit-atlas";
    for (const kind of KINDS) {
      let verts = 0, idx = 0, inst = 0;
      for (const piece of used) {
        for (const name of [piece, `${piece}__lod1`]) {
          const g = geos.get(name)?.[kind];
          if (!g) continue;
          verts += g.attributes.position.count;
          idx += g.index!.count;
        }
        if (geos.get(piece)?.[kind]) inst += this.placements.filter((p) => p.piece === piece).length;
      }
      if (!inst) continue;
      const bm = new THREE.BatchedMesh(inst, verts, idx, mats[kind]);
      bm.name = `archkit:${kind}`;
      bm.castShadow = kind === "atlas";
      bm.receiveShadow = kind !== "lamp";
      bm.sortObjects = kind === "glass";
      bm.frustumCulled = false;
      for (const piece of used) {
        for (const name of [piece, `${piece}__lod1`]) {
          const g = geos.get(name)?.[kind];
          if (!g) continue;
          const ids = this.geoIds.get(name) ?? {};
          ids[kind] = bm.addGeometry(g);
          this.geoIds.set(name, ids);
        }
      }
      this.batches.set(kind, bm);
      group.add(bm);
    }
    for (const [name, e] of geos) {
      let t = 0;
      for (const g of Object.values(e)) if (g) t += g.index!.count / 3;
      this.trisOf.set(name, t);
    }
    const white = new THREE.Color(1, 1, 1);
    for (const p of this.placements) {
      const ids = this.geoIds.get(p.piece);
      if (!ids) continue;
      for (const kind of KINDS) {
        const gid = ids[kind];
        const bm = this.batches.get(kind);
        if (gid === undefined || !bm) continue;
        const id = bm.addInstance(gid);
        bm.setMatrixAt(id, p.m);
        bm.setColorAt(id, kind === "atlas" ? p.tint : white);
        bm.setVisibleAt(id, false);
        p.ids[kind] = id;
      }
    }
    for (const bm of this.batches.values()) {
      bm.computeBoundingBox();
      bm.computeBoundingSphere();
    }
    this.dirty = true;
  }

  /**
   * Triangles the kit would submit seen from `cam` (range culling and LOD as at run time,
   * before frustum culling), from per-piece counts (archkit.json): budgets and tests.
   */
  estimate(cam: THREE.Vector3, tris: (piece: KitPiece, lod: 0 | 1) => number) {
    const q = LOD[this.quality];
    let n = 0, drawn = 0;
    for (const p of this.placements) {
      const d = cam.distanceTo(p.c);
      if (!(q.cull > 0 && d < p.cull * q.cull)) continue;
      n += tris(p.piece, d < q.lod0 ? 0 : 1);
      drawn++;
    }
    return { triangles: n, instances: drawn };
  }

  /** Per-instance LOD and range culling (runs when the camera has moved > 1.5 m). */
  private refresh(cam: THREE.Vector3) {
    const q = LOD[this.quality];
    let tris = 0;
    for (const p of this.placements) {
      const d = cam.distanceTo(p.c);
      const vis = q.cull > 0 && d < p.cull * q.cull;
      const has1 = this.geoIds.has(`${p.piece}__lod1`);
      const lod = d < q.lod0 || !has1 ? 0 : 1;
      if (vis) tris += this.trisOf.get(lod ? `${p.piece}__lod1` : p.piece) ?? 0;
      if (vis === p.vis && lod === p.lod) continue;
      const gids = this.geoIds.get(lod ? `${p.piece}__lod1` : p.piece);
      for (const kind of KINDS) {
        const id = p.ids[kind];
        const bm = this.batches.get(kind);
        if (id === undefined || !bm) continue;
        if (lod !== p.lod && gids?.[kind] !== undefined) bm.setGeometryIdAt(id, gids[kind]!);
        if (vis !== p.vis) bm.setVisibleAt(id, vis);
      }
      p.vis = vis;
      p.lod = lod;
    }
    this.triangles = tris;
  }

  /** Builds the batches from a loaded kit scene (one node per piece / LOD) into `group`. */
  attachScene(group: THREE.Object3D, scene: THREE.Object3D) {
    const { geos, atlas } = kitGeometry(scene);
    this.instantiate(group, geos, atlas);
    // The batches own copies; the parsed scene stays cached for the next map.
    for (const e of geos.values()) for (const g of Object.values(e)) g?.dispose();
    this.loaded = true;
    this.dirty = true;
    this.showFallback(this.quality === "low");
  }

  /** The kit file is missing or broken: the box stand-ins take over. */
  fail() {
    this.failed = true;
    this.showFallback(true);
  }

  /** Batched meshes per material kind (stats / tests). */
  get meshes() {
    return [...this.batches.values()];
  }

  /** The kit as a WorldExtra: loads, instantiates, LODs, follows the quality preset. */
  extra(): WorldExtra {
    const group = new THREE.Group();
    group.name = "archkit";
    group.matrixAutoUpdate = false;
    group.userData.archkit = this;
    let disposed = false;
    const file = this.quality === "high" ? ARCHKIT_FILES.full : ARCHKIT_FILES.small;
    if (this.placements.length && this.quality !== "low") {
      void loadScene(assetUrl(file)).then((scene) => {
        if (disposed) return;
        if (scene) this.attachScene(group, scene);
        else this.fail();
      });
    }
    const triangles = () => this.triangles;
    return {
      object: group,
      get triangles() {
        return triangles();
      },
      update: (camera) => {
        if (!this.loaded) return;
        camera.getWorldPosition(_v);
        if (!this.dirty && _v.distanceToSquared(this.last) < 2.25) return;
        this.last.copy(_v);
        this.dirty = false;
        this.refresh(_v);
      },
      setQuality: (q) => {
        this.quality = q;
        const on = q !== "low" && !this.failed;
        group.visible = on;
        if (this.loaded || this.failed || q === "low") this.showFallback(!on || !this.loaded);
        this.dirty = true;
      },
      dispose: () => {
        disposed = true;
        for (const bm of this.batches.values()) {
          bm.removeFromParent();
          bm.dispose();
          (bm.material as THREE.Material).dispose();
        }
        this.batches.clear();
      },
    };
  }
}

const layers = new WeakMap<MeshBuilder, ArchKitLayer>();

/** Global switch (tests measure the box-only path with it off; a kill switch if the kit misbehaves). */
export const archKitConfig = { enabled: true };

/**
 * Starts a kit layer for everything drawn into `B` (and the extra builders
 * passed in `adopt`). Returns null on Low: the box path is used untouched.
 */
export function attachArchKit(B: MeshBuilder, quality: QualityName, ...adopt: MeshBuilder[]) {
  if (quality === "low" || !archKitConfig.enabled) return null;
  // MapLoader attaches one for every map (box styles use it); dressings that attach again share it.
  const existing = layers.get(B);
  if (existing) {
    for (const b of adopt) {
      if (layers.has(b)) continue;
      layers.set(b, existing);
      existing.adopt(b);
    }
    return existing;
  }
  const l = new ArchKitLayer(quality);
  layers.set(B, l);
  l.adopt(B);
  for (const b of adopt) {
    layers.set(b, l);
    l.adopt(b);
  }
  return l;
}

/** The kit layer attached to `B`, if its dressing asked for one. */
export function archKitOf(B: MeshBuilder) {
  return layers.get(B);
}

/** Finishes the layer attached to `B` as an extra (and detaches it). */
export function finishArchKit(B: MeshBuilder): WorldExtra[] {
  const l = layers.get(B);
  layers.delete(B);
  return l ? [l.extra()] : [];
}

/** World-space bounds of the placements of one piece (tests / tools). */
export function placementBounds(l: ArchKitLayer, piece: KitPiece) {
  _b.makeEmpty();
  for (const p of l.placements) if (p.piece === piece) _b.expandByPoint(p.c);
  return _b.clone();
}
