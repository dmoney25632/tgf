import * as THREE from "three";
import type { ViewModelKind } from "../weapons";
import { loadScene } from "../../assets/AssetLoader";

/**
 * Photo-textured gun models that replace the built geometry in first person.
 * The built gun still supplies the hands, anchors (muzzle, ejection port,
 * sights, grips) and animation; the real model is fitted onto its bounds.
 * Sources and licences: public/assets/CREDITS.md.
 */
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
};

export const REAL_GUNS: Partial<Record<ViewModelKind, RealGun>> = {
  m4a1: { path: "/assets/weapons/m4a1/model.gltf", rot: [0, -90, 0] },
  // Rigged export (baked to its posed shape); a spare mag sits off to the side.
  akm: { path: "/assets/weapons/akm/model.gltf", rot: [0, 0, 0], offset: [0, -0.008, 0], drop: [{ axis: "x", below: -1.5 }] },
  mp5: { path: "/assets/weapons/mp5/model.gltf", rot: [0, 0, 0] },
  m1911: { path: "/assets/weapons/m1911/model.gltf", rot: [0, 90, 0] },
};

/** `muzzle`: centre of the front-most vertices (the bore line), in template space. */
export type RealTemplate = { object: THREE.Group; box: THREE.Box3; muzzle: THREE.Vector3 };

const templates = new Map<ViewModelKind, Promise<RealTemplate | null>>();

/** Loads and orients a real gun (cached); null if missing or failed. */
export function loadRealGun(kind: ViewModelKind): Promise<RealTemplate | null> {
  const cfg = REAL_GUNS[kind];
  if (!cfg) return Promise.resolve(null);
  let p = templates.get(kind);
  if (!p) {
    p = loadScene(cfg.path).then((scene) => {
      if (!scene) return null;
      const object = new THREE.Group();
      const inner = scene.clone(true);
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
      inner.rotation.set(...(cfg.rot.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
      object.add(inner);
      object.updateMatrixWorld(true);
      inner.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Right next to the camera: never culled, and no shadow passes.
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = false;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) continue;
          for (const t of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) if (t) t.anisotropy = 8;
          std.side = THREE.FrontSide;
        }
      });
      const box = meshBounds(object);
      return { object, box, muzzle: muzzleCentre(object, box) };
    });
    templates.set(kind, p);
  }
  return p;
}

/**
 * A copy of the real gun scaled and placed onto the built gun (gun space):
 * same overall length along the bore (Z, from `gun` bounds), its muzzle on
 * the built gun's muzzle, so the bore and sight line match what the
 * animation and ADS pose expect.
 */
export function fitRealGun(kind: ViewModelKind, t: RealTemplate, gun: THREE.Box3, muzzle: THREE.Vector3): THREE.Group {
  const cfg = REAL_GUNS[kind]!;
  const src = t.box.getSize(new THREE.Vector3());
  const dst = gun.getSize(new THREE.Vector3());
  const s = (dst.z / Math.max(1e-6, src.z)) * (cfg.scale ?? 1);
  const o = t.object.clone(true);
  o.scale.setScalar(s);
  o.position.set(muzzle.x - t.muzzle.x * s, muzzle.y - t.muzzle.y * s, gun.min.z - t.box.min.z * s);
  if (cfg.offset) o.position.add(new THREE.Vector3(...cfg.offset));
  o.name = `${kind}-real`;
  return o;
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
