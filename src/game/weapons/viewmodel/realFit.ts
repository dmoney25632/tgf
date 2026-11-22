import * as THREE from "three";
import type { ArmPlacement, HandPose } from "./hands";

/**
 * The pure (loader-free) half of the real gun models: orient a loaded glTF
 * scene, fit it onto the procedural gun, split its moving parts (magazine,
 * pump, slide) off so they follow the animated groups, and measure its
 * cross-section so the support hand can close onto the real handguard.
 * Kept free of the asset loader so node tests can drive it.
 */

/** Procedural moving groups a piece of the real model can follow. */
export type RealPart = "mag" | "pump" | "bolt";

export type RealGun = {
  path: string;
  /** Euler (deg, XYZ) that turns the file's model barrel-forward (-Z), top up (+Y). */
  rot: [number, number, number];
  /** Extra scale on top of the length fit. */
  scale?: number;
  /** Gun-space nudge (m) after fitting, e.g. to put the sights on the sight line. */
  offset?: [number, number, number];
  /** Drop loose extras (spare mags, rounds) lying beyond a cut-off in the mesh's own space. */
  drop?: { axis: "x" | "y" | "z"; below?: number; above?: number }[];
  /** Drop whole meshes whose node (or an ancestor) name matches (props, alternate variants). */
  hide?: RegExp;
  /**
   * Pieces that follow a procedural moving group. `true`: every connected
   * piece of the mesh lying (almost) wholly inside that group's built bounds
   * moves with it; a RegExp: meshes whose node / ancestor name matches.
   */
  parts?: Partial<Record<RealPart, true | RegExp>>;
  /** Parts that are loose props in the file: moved into the built part's place when fitted. */
  seat?: RealPart[];
  /** Multiply every material colour (re-finish a shared model, e.g. HK416 from the M4). */
  tint?: number;
  /** Leave the support hand as built (no closing onto the real handguard). */
  keepHand?: boolean;
  /** Glowing reticle on the optic axis, centred on the `lens` mesh's front glass (red dot / holo: red; prism: amber). */
  reticle?: "red" | "amber";
};

/** `muzzle`: centre of the front-most vertices (the bore line), in template space. */
export type RealTemplate = {
  object: THREE.Group;
  box: THREE.Box3;
  muzzle: THREE.Vector3;
  /** Pieces split off per moving group (template space), filled on first fit. */
  parts: Map<RealPart, THREE.Group>;
  split: boolean;
  /** Template-space triangles of the gun at rest (magazine left out), filled on demand. */
  points: Float32Array | null;
};

/** Where the fitted copy sits in gun space: gun = position + scale · template. */
export type RealFit = { object: THREE.Group; scale: number; position: THREE.Vector3; parts: Map<RealPart, THREE.Group> };

const nodeMatches = (o: THREE.Object3D, re: RegExp) => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (re.test(p.name)) return true;
  return false;
};

/** Orient a loaded scene and measure it. The scene is cloned; its geometry is never mutated. */
export function prepareRealGun(scene: THREE.Object3D, cfg: RealGun): RealTemplate {
  const object = new THREE.Group();
  const inner = scene.clone(true);
  inner.updateMatrixWorld(true);
  // Some exports are rigged (animated parts): a clone would still follow the
  // source bones, so bake skinned meshes to static ones in their posed shape.
  const skinned: THREE.SkinnedMesh[] = [];
  inner.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh));
  for (const sm of skinned) {
    let geo = bakePose(sm);
    if (cfg.drop) geo = dropParts(geo, cfg.drop);
    const mesh = new THREE.Mesh(geo, sm.material);
    mesh.name = sm.name;
    mesh.position.copy(sm.position);
    mesh.quaternion.copy(sm.quaternion);
    mesh.scale.copy(sm.scale);
    sm.parent?.add(mesh);
    sm.removeFromParent();
  }
  if (cfg.hide) {
    const gone: THREE.Object3D[] = [];
    inner.traverse((o) => (o as THREE.Mesh).isMesh && nodeMatches(o, cfg.hide!) && gone.push(o));
    for (const o of gone) o.removeFromParent();
  }
  // Non-mesh helpers from DCC exports (cameras, lights) have no place here.
  const extras: THREE.Object3D[] = [];
  inner.traverse((o) => ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) && extras.push(o));
  for (const o of extras) o.removeFromParent();
  inner.rotation.set(...(cfg.rot.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
  object.add(inner);
  object.updateMatrixWorld(true);
  const tinted = new Map<THREE.Material, THREE.Material>();
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Right next to the camera: never culled, and no shadow passes.
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = list.map((m) => {
      let mat = m;
      if (cfg.tint !== undefined) {
        // Materials are shared with the cached scene (other guns may use it): tint a copy.
        mat = tinted.get(m) ?? m.clone();
        if (!tinted.has(m)) {
          tinted.set(m, mat);
          (mat as THREE.MeshStandardMaterial).color?.multiply(new THREE.Color(cfg.tint));
        }
      }
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        for (const t of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) if (t) t.anisotropy = 8;
        std.side = THREE.FrontSide;
      }
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });
  const t: RealTemplate = { object, box: new THREE.Box3(), muzzle: new THREE.Vector3(), parts: new Map(), split: false, points: null };
  // Named parts come off first, so a prop lying beside the gun doesn't stretch its bounds.
  splitNamedParts(t, cfg);
  t.box = meshBounds(object);
  t.muzzle = muzzleCentre(object, t.box);
  return t;
}

/**
 * Scale and place the real gun onto the built one (gun space): same overall
 * length along the bore (Z, from the built gun's bounds), its muzzle on the
 * built gun's muzzle, so the bore and sight line match what the animation and
 * ADS pose expect.
 */
export function fitTransform(cfg: RealGun, t: RealTemplate, gun: THREE.Box3, muzzle: THREE.Vector3) {
  const src = t.box.getSize(new THREE.Vector3());
  const dst = gun.getSize(new THREE.Vector3());
  const scale = (dst.z / Math.max(1e-6, src.z)) * (cfg.scale ?? 1);
  const position = new THREE.Vector3(muzzle.x - t.muzzle.x * scale, muzzle.y - t.muzzle.y * scale, gun.min.z - t.box.min.z * scale);
  if (cfg.offset) position.add(new THREE.Vector3(...cfg.offset));
  return { scale, position };
}

/**
 * A fitted copy of the real gun. `partBoxes` are the built moving groups'
 * bounds in gun space (at rest); pieces inside them are split off (once per
 * template) and returned per group, positioned in gun space, for the caller
 * to re-parent onto the animated groups (Object3D.attach keeps them in place).
 */
export function fitRealGun(cfg: RealGun, t: RealTemplate, gun: THREE.Box3, muzzle: THREE.Vector3, partBoxes: Partial<Record<RealPart, THREE.Box3>> = {}, name = "real"): RealFit {
  const { scale, position } = fitTransform(cfg, t, gun, muzzle);
  if (!t.split) splitParts(t, cfg, partBoxes, scale, position);
  const place = (src: THREE.Object3D) => {
    const o = src.clone(true) as THREE.Group;
    o.scale.setScalar(scale);
    o.position.copy(position);
    return o;
  };
  const object = place(t.object);
  object.name = `${name}-real`;
  const parts = new Map<RealPart, THREE.Group>();
  for (const [k, g] of t.parts) {
    const o = place(g);
    const target = partBoxes[k];
    if (cfg.seat?.includes(k) && target && !target.isEmpty()) {
      // A loose prop part (a magazine lying beside the gun): move it into the
      // built part's place, centred on it and level with its top.
      const have = meshBounds(g).applyMatrix4(new THREE.Matrix4().compose(position, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale)));
      const c = have.getCenter(new THREE.Vector3());
      const want = target.getCenter(new THREE.Vector3());
      o.position.add(new THREE.Vector3(want.x - c.x, target.max.y - have.max.y, want.z - c.z));
    }
    parts.set(k, o);
  }
  return { object, scale, position, parts };
}

/** Split the pieces named by RegExp part rules off into `t.parts` (template space). */
function splitNamedParts(t: RealTemplate, cfg: RealGun) {
  t.object.updateMatrixWorld(true);
  for (const [key, rule] of Object.entries(cfg.parts ?? {}) as [RealPart, true | RegExp][]) {
    if (!(rule instanceof RegExp)) continue;
    const meshes: THREE.Mesh[] = [];
    t.object.traverse((o) => (o as THREE.Mesh).isMesh && nodeMatches(o, rule) && meshes.push(o as THREE.Mesh));
    if (!meshes.length) continue;
    const group = new THREE.Group();
    group.name = `real-${key}`;
    for (const mesh of meshes) {
      group.add(detached(mesh, mesh.geometry));
      mesh.removeFromParent();
    }
    t.parts.set(key, group);
  }
}

/** Split the template's moving pieces off into `t.parts` (template space), by the built parts' bounds. */
function splitParts(t: RealTemplate, cfg: RealGun, boxes: Partial<Record<RealPart, THREE.Box3>>, scale: number, position: THREE.Vector3) {
  t.split = true;
  if (!cfg.parts) return;
  t.object.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  t.object.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  for (const key of ["mag", "pump", "bolt"] as RealPart[]) {
    const rule = cfg.parts[key];
    if (!rule) continue;
    const group = new THREE.Group();
    group.name = `real-${key}`;
    if (rule instanceof RegExp) continue;
    {
      const gb = boxes[key];
      if (!gb || gb.isEmpty()) continue;
      // Gun-space box → template space, padded: real parts are rarely the
      // built part's exact size. A magazine may hang lower than the built one.
      const pad = 0.008;
      const min = gb.min.clone().subScalar(pad);
      const max = gb.max.clone().addScalar(pad);
      if (key === "mag") min.y -= 1;
      if (key === "pump") {
        min.z -= 0.06;
        max.z += 0.06;
      }
      const box = new THREE.Box3(min.sub(position).divideScalar(scale), max.sub(position).divideScalar(scale));
      const pieces = meshes.filter((m) => m.parent).flatMap((m) => piecesOf(m, box));
      // The part itself: a big piece mostly inside the box (a real magazine is
      // often longer or more curved than the built one, so 60 % will do)...
      let seed: Piece | null = null;
      let best = 0;
      const size = new THREE.Vector3();
      for (const p of pieces) {
        const f = p.inside / p.count;
        p.box.getSize(size);
        const score = size.x * size.y * size.z * f ** 6;
        if (p.count >= 40 && f >= 0.6 && score > best) {
          seed = p;
          best = score;
        }
      }
      if (!seed) continue;
      // ...plus the small pieces wholly inside it (follower, base plate, rounds).
      const hull = seed.box.clone().expandByScalar(0.003 / scale);
      const take = pieces.filter((p) => p === seed || (p.inside >= p.count * 0.85 && hull.containsBox(p.box)));
      // A bad match (most of the gun inside the box) is worse than a still magazine.
      if (take.reduce((n, p) => n + p.count, 0) > total * 0.4) continue;
      for (const mesh of new Set(take.map((p) => p.mesh))) {
        const mine = new Set(take.filter((p) => p.mesh === mesh).map((p) => p.id));
        const all = pieces.find((p) => p.mesh === mesh)!;
        const keepIdx: number[] = [];
        const takeIdx: number[] = [];
        for (let i = 0; i < all.tris.length; i++) (mine.has(all.tris[i]) ? takeIdx : keepIdx).push(all.idx[i * 3], all.idx[i * 3 + 1], all.idx[i * 3 + 2]);
        group.add(detached(mesh, withIndex(mesh.geometry, takeIdx)));
        if (keepIdx.length) mesh.geometry = withIndex(mesh.geometry, keepIdx);
        else mesh.removeFromParent();
      }
    }
    if (group.children.length) t.parts.set(key, group);
  }
}

/** A copy of `mesh` with `geo`, carrying its template-space transform (for a part group at the origin). */
function detached(mesh: THREE.Mesh, geo: THREE.BufferGeometry) {
  const m = new THREE.Mesh(geo, mesh.material);
  m.name = mesh.name;
  m.frustumCulled = false;
  mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
  return m;
}

/** Same attributes, a different triangle list. */
function withIndex(src: THREE.BufferGeometry, idx: number[]) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A connected piece of a mesh: `inside` of its `count` vertices lie in the test box. */
type Piece = { mesh: THREE.Mesh; id: number; inside: number; count: number; box: THREE.Box3; tris: Int32Array; idx: ArrayLike<number> };

/**
 * Splits a mesh's triangles into connected pieces (vertices welded by
 * position, so UV seams don't cut a piece apart) and reports, per piece, how
 * many of its vertices lie inside `box` (template space). Pieces share the
 * per-triangle piece ids (`tris`) and the index list of their mesh.
 */
export function piecesOf(mesh: THREE.Mesh, box: THREE.Box3): Piece[] {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count;
  const idx: ArrayLike<number> = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const unite = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const q = 1e5 / Math.max(1e-9, geo.boundingSphere!.radius);
  const weld = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    const j = weld.get(key);
    if (j === undefined) weld.set(key, i);
    else unite(i, j);
  }
  for (let t = 0; t < idx.length; t += 3) {
    unite(idx[t], idx[t + 1]);
    unite(idx[t], idx[t + 2]);
  }
  const tris = new Int32Array(idx.length / 3);
  for (let t = 0; t < tris.length; t++) tris[t] = find(idx[t * 3]);
  const byId = new Map<number, Piece>();
  const used = new Uint8Array(n);
  for (let k = 0; k < idx.length; k++) used[idx[k]] = 1;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const id = find(i);
    let p = byId.get(id);
    if (!p) byId.set(id, (p = { mesh, id, inside: 0, count: 0, box: new THREE.Box3(), tris, idx }));
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    p.count++;
    p.box.expandByPoint(v);
    if (box.containsPoint(v)) p.inside++;
  }
  return [...byId.values()];
}

/** Template-space triangles (9 floats each) of the gun at rest, magazine left out (cached). */
function trianglesOf(t: RealTemplate) {
  if (t.points) return t.points;
  const out: number[] = [];
  const v = new THREE.Vector3();
  const roots = [t.object, ...[...t.parts].filter(([k]) => k !== "mag").map(([, g]) => g)];
  for (const root of roots) root.updateMatrixWorld(true);
  for (const root of roots) root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let k = 0; k < count; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return (t.points = new Float32Array(out));
}

export type Section = { x0: number; x1: number; y0: number; y1: number; count: number };

/**
 * Cross-section of the fitted real gun (static parts) between gun-space z0
 * and z1: 3rd–97th percentile extents in x and y of the surface outline
 * (stray details ignored).
 */
export function sectionAt(t: RealTemplate, fit: Pick<RealFit, "scale" | "position">, z0: number, z1: number): Section | null {
  const tri = trianglesOf(t);
  // Slab in template space; sample the surface outline on a few planes across it.
  const lo = (Math.min(z0, z1) - fit.position.z) / fit.scale;
  const hi = (Math.max(z0, z1) - fit.position.z) / fit.scale;
  const planes = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < tri.length; i += 9) {
    const za = tri[i + 2];
    const zb = tri[i + 5];
    const zc = tri[i + 8];
    if (Math.max(za, zb, zc) < lo || Math.min(za, zb, zc) > hi) continue;
    for (let e = 0; e < 3; e++) {
      const p = i + e * 3;
      const q = i + ((e + 1) % 3) * 3;
      const pz = tri[p + 2];
      const qz = tri[q + 2];
      if (pz >= lo && pz <= hi) {
        xs.push(tri[p]);
        ys.push(tri[p + 1]);
      }
      if (pz === qz) continue;
      for (const z of planes) {
        const f = (z - pz) / (qz - pz);
        if (f <= 0 || f >= 1) continue;
        xs.push(tri[p] + (tri[q] - tri[p]) * f);
        ys.push(tri[p + 1] + (tri[q + 1] - tri[p + 1]) * f);
      }
    }
  }
  if (xs.length < 24) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const at = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * f)))];
  const gx = (x: number) => fit.position.x + x * fit.scale;
  const gy = (y: number) => fit.position.y + y * fit.scale;
  return { x0: gx(at(xs, 0.03)), x1: gx(at(xs, 0.97)), y0: gy(at(ys, 0.03)), y1: gy(at(ys, 0.97)), count: xs.length };
}

/**
 * Support hand on a handguard (held axis along the bore): re-centre the grip
 * circle on the real handguard's section and wrap it at the real radius, so
 * the palm and fingers sit on the surface instead of floating beside it.
 * `toGun` maps the arm's build space into gun space. Null = leave as built.
 */
export function closeSupportHand(t: RealTemplate, fit: Pick<RealFit, "scale" | "position">, p: ArmPlacement, pose: HandPose, toGun: THREE.Matrix4): [ArmPlacement, HandPose] | null {
  const axis = new THREE.Vector3(...p.axis).transformDirection(toGun);
  if (Math.abs(axis.z) < 0.8) return null;
  const at = new THREE.Vector3(...p.at).applyMatrix4(toGun);
  // The hand covers ~65 mm from the index finger toward the pinky.
  const sec = sectionAt(t, fit, at.z, at.z + Math.sign(axis.z) * 0.065);
  if (!sec) return null;
  const r = THREE.MathUtils.clamp((sec.x1 - sec.x0) / 2, 0.011, 0.04);
  const cx = (sec.x0 + sec.x1) / 2;
  // Circle of the real half-width resting on the underside (or centred, when flatter than round).
  const cy = sec.y1 - sec.y0 < 2 * r ? (sec.y0 + sec.y1) / 2 : sec.y0 + r;
  const next = new THREE.Vector3(cx, cy, at.z);
  // Way off: probably the wrong section (bipod, magazine...): keep the built hand.
  if (next.distanceTo(at) > 0.035) return null;
  const local = next.applyMatrix4(toGun.clone().invert());
  return [{ ...p, at: [local.x, local.y, local.z] }, { ...pose, r }];
}

/** Removes triangles whose vertices all lie beyond one of the cut-offs. */
function dropParts(geo: THREE.BufferGeometry, cuts: NonNullable<RealGun["drop"]>) {
  const pos = geo.attributes.position;
  const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const get = { x: (i: number) => pos.getX(i), y: (i: number) => pos.getY(i), z: (i: number) => pos.getZ(i) };
  const out = (i: number) => cuts.some((c) => (c.below !== undefined && get[c.axis](i) < c.below) || (c.above !== undefined && get[c.axis](i) > c.above));
  const kept: number[] = [];
  for (let t = 0; t < idx.length; t += 3) if (!(out(idx[t]) && out(idx[t + 1]) && out(idx[t + 2]))) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  geo.setIndex(kept);
  return geo;
}

/** World bounds of the vertices actually drawn (index-aware, so dropped parts don't count). */
function meshBounds(root: THREE.Object3D) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

/** Static copy of a skinned mesh's current pose, in the mesh's own space. */
function bakePose(sm: THREE.SkinnedMesh) {
  sm.skeleton.update();
  const src = sm.geometry;
  const geo = src.clone();
  geo.deleteAttribute("skinIndex");
  geo.deleteAttribute("skinWeight");
  geo.deleteAttribute("tangent");
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(src.attributes.position as THREE.BufferAttribute, i);
    if (nrm) q.fromBufferAttribute(src.attributes.normal as THREE.BufferAttribute, i).add(p);
    sm.applyBoneTransform(i, p);
    pos.setXYZ(i, p.x, p.y, p.z);
    if (nrm) {
      sm.applyBoneTransform(i, q);
      q.sub(p).normalize();
      nrm.setXYZ(i, q.x, q.y, q.z);
    }
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Centre of the vertices within 1.5 % of the length from the front (−Z) face. */
function muzzleCentre(root: THREE.Object3D, box: THREE.Box3) {
  const lim = box.min.z + (box.max.z - box.min.z) * 0.015;
  const sum = new THREE.Vector3();
  const v = new THREE.Vector3();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      if (v.z <= lim) {
        sum.add(v);
        n++;
      }
    }
  });
  return n ? sum.divideScalar(n) : box.getCenter(new THREE.Vector3());
}
