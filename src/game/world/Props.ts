import * as THREE from "three";
import { MODELS, type ModelId } from "../assets/manifest";
import { loadModel, releaseModel, type PreparedModel } from "../assets/AssetLoader";
import type { MeshBuilder } from "./MeshBuilder";

export type PropPlacement = {
  x: number;
  /** Feet height (the model's lowest point lands here, minus `sink`). */
  y: number;
  z: number;
  rotY?: number;
  /** Uniform scale or per-axis scale (model space). */
  scale?: number | [number, number, number];
  /** Fit the model's bounds to this size (w, h, d) in world metres (rotY respected for 90° turns). */
  fit?: [number, number, number];
  /** Which variant for multi-node files (rock sets, plants). */
  variant?: number;
  /** Push down into the ground (m), for rocks. */
  sink?: number;
};

type Fallback = (b: MeshBuilder, group: string) => void;

/**
 * Places glTF props (instanced per model variant and material). Each
 * placement may register a procedural fallback, drawn until the model has
 * loaded — and kept if the file is missing — so the map never depends on
 * assets being present. Colliders are owned by the map's boxes, not here.
 */
export class ModelPlacer {
  private readonly placements = new Map<ModelId, PropPlacement[]>();
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly loaded: PreparedModel[] = [];
  private disposed = false;
  triangles = 0;

  constructor(private readonly builder: MeshBuilder) {}

  place(id: ModelId, p: PropPlacement, fallback?: Fallback) {
    const list = this.placements.get(id) ?? [];
    list.push(p);
    this.placements.set(id, list);
    fallback?.(this.builder, `model:${id}`);
  }

  get count() {
    let n = 0;
    for (const l of this.placements.values()) n += l.length;
    return n;
  }

  /** Starts loading; swaps fallbacks for instanced models as each arrives. */
  start(parent: THREE.Object3D, groups: Map<string, THREE.Mesh[]>) {
    for (const [id, list] of this.placements) {
      void loadModel(id).then((model) => {
        if (this.disposed || !model) return;
        this.loaded.push(model);
        this.instantiate(parent, id, model, list);
        for (const m of groups.get(`model:${id}`) ?? []) m.visible = false;
      });
    }
  }

  private instantiate(parent: THREE.Object3D, id: ModelId, model: PreparedModel, list: PropPlacement[]) {
    const byVariant = new Map<number, PropPlacement[]>();
    for (const p of list) {
      const v = (p.variant ?? 0) % model.variants.length;
      const arr = byVariant.get(v) ?? [];
      arr.push(p);
      byVariant.set(v, arr);
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [v, places] of byVariant) {
      const variant = model.variants[v];
      variant.bounds.getSize(size);
      variant.bounds.getCenter(center);
      const matrices = places.map((p) => {
        const rot = p.rotY ?? 0;
        if (p.fit) {
          const turned = Math.abs(Math.sin(rot)) > 0.7;
          const [w, h, d] = p.fit;
          s.set((turned ? d : w) / Math.max(size.x, 1e-3), h / Math.max(size.y, 1e-3), (turned ? w : d) / Math.max(size.z, 1e-3));
        } else if (Array.isArray(p.scale)) s.set(...p.scale);
        else s.setScalar(p.scale ?? 1);
        q.setFromAxisAngle(up, rot);
        // world = T(pos) · R · S · T(-anchor), anchor = bottom-centre of the bounds.
        m.compose(new THREE.Vector3(p.x, p.y - (p.sink ?? 0), p.z), q, s);
        t.makeTranslation(-center.x, -variant.bounds.min.y, -center.z);
        return m.clone().multiply(t);
      });
      for (const part of variant.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
        matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
        mesh.castShadow = MODELS[id].castShadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.name = `prop:${id}`;
        parent.add(mesh);
        this.instanced.push(mesh);
        this.triangles += ((part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3) * matrices.length;
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const m of this.instanced) {
      m.removeFromParent();
      m.dispose();
    }
    // GPU copies only; the parsed models stay cached for the next map.
    for (const model of this.loaded) releaseModel(model);
    this.instanced.length = 0;
  }
}
