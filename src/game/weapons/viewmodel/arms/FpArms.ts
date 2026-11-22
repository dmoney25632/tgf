import * as THREE from "three";
import { loadScene } from "../../../assets/AssetLoader";
import { anchorData, type HandAnchorData } from "./anchor";
import { ArmsRig, makeTemplate, type ArmsTemplate } from "./rig";

export const FPARMS_PATH = "/assets/characters/fparms/fparms.gltf";

/** Rigs kept for simultaneously visible hand pairs (gun + quick knife / grenade). */
const MAX_RIGS = 3;
/** Shoulder points (view space): behind the camera plane, so the cut-off top of the upper arm never shows. */
const SHOULDER_R = new THREE.Vector3(0.2, -0.28, 0.12);
const SHOULDER_L = new THREE.Vector3(-0.24, -0.32, 0.1);

/**
 * Support hands cupping a handguard from below roll about the held axis
 * (anchor X) so the palm sits on the near-left side with the fingers over the
 * top: the forearm then enters from the lower left instead of hiding the hand
 * from the camera.
 */
const SUPPORT_ROLL = -0.9;
const ROLL_L = new THREE.Matrix4().makeRotationX(SUPPORT_ROLL);

/**
 * Skinned first-person arms over every hand anchor in the viewmodel (see
 * anchor.ts). Until the asset is loaded (or if it fails, or with the
 * localStorage kill switch "tgf.fparms" = "procedural") the procedural arms
 * built by hands.ts stay visible; `ready` flips once they can be hidden.
 *
 * Shading: the viewmodel's lights and environment (MeshStandardMaterial,
 * like the uber material) with the albedo re-tinted per region from the
 * operator colours the procedural arms use (glove = tints[0], sleeve =
 * tints[1]): the baked albedo is normalised so its mean is the tint.
 */
export class FpArms {
  ready = false;
  private template: ArmsTemplate | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private readonly rigs: ArmsRig[] = [];
  private readonly right: THREE.Object3D[] = [];
  private readonly left: THREE.Object3D[] = [];
  private disposed = false;
  private readonly visit = (o: THREE.Object3D) => {
    const d = anchorData(o);
    if (!d) return;
    const list = d.side === "R" ? this.right : this.left;
    if (list.length < MAX_RIGS) list.push(o);
  };
  private readonly elbow = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly rolled = new THREE.Matrix4();

  constructor(
    private readonly scene: THREE.Object3D,
    /** [glove, sleeve] operator colours (shared with the procedural materials). */
    private readonly tints: THREE.Color[],
  ) {}

  /** Fetches the arms; resolves true once they replace the procedural ones. */
  async load(): Promise<boolean> {
    if (killSwitch()) return false;
    const scene = await loadScene(FPARMS_PATH);
    if (!scene || this.disposed) return false;
    try {
      this.setTemplate(scene);
    } catch (err) {
      console.warn("fparms:", err);
      return false;
    }
    return true;
  }

  /** Installs a loaded fparms scene (also used by offline tooling / tests). */
  setTemplate(scene: THREE.Object3D) {
    const t = makeTemplate(scene);
    const src = t.mesh.material as THREE.MeshStandardMaterial;
    this.material = createArmsMaterial(src, this.tints);
    this.template = t;
    this.ready = true;
  }

  get triangles() {
    return this.template?.tris ?? 0;
  }

  private rig(i: number) {
    let r = this.rigs[i];
    if (!r) {
      r = new ArmsRig(this.template!, this.material!);
      this.rigs[i] = r;
      this.scene.add(r.object);
    }
    return r;
  }

  /**
   * Poses the arms onto the visible anchors under `root`. Call after the
   * viewmodel's matrices are final (root.updateMatrixWorld).
   */
  update(root: THREE.Object3D) {
    if (!this.ready) return;
    this.right.length = 0;
    this.left.length = 0;
    root.traverseVisible(this.visit);
    const n = Math.max(this.right.length, this.left.length);
    for (let i = 0; i < Math.max(n, this.rigs.length); i++) {
      if (i >= n) {
        if (this.rigs[i]) this.rigs[i].object.visible = false;
        continue;
      }
      const rig = this.rig(i);
      rig.object.visible = true;
      this.place(rig, this.right[i], SHOULDER_R, "R");
      this.place(rig, this.left[i], SHOULDER_L, "L");
      rig.object.updateMatrixWorld(true);
    }
  }

  private place(rig: ArmsRig, anchor: THREE.Object3D | undefined, shoulder: THREE.Vector3, side: "L" | "R") {
    if (!anchor) {
      rig.hide(side);
      return;
    }
    const d = anchorData(anchor) as HandAnchorData;
    this.elbow.copy(d.elbow).applyMatrix4(anchor.parent!.matrixWorld);
    this.shoulder.copy(shoulder);
    let m = anchor.matrixWorld;
    if (side === "L" && isHandguardGrip(d)) m = this.rolled.multiplyMatrices(m, ROLL_L);
    rig.pose(d, m, this.elbow, this.shoulder);
  }

  dispose() {
    this.disposed = true;
    for (const r of this.rigs) {
      r.object.removeFromParent();
      r.mesh.skeleton.dispose();
    }
    this.rigs.length = 0;
    this.material?.dispose();
  }
}

/** A left hand under a fore-end: held axis along the barrel, palm up into it, not a small part. */
function isHandguardGrip(d: HandAnchorData) {
  const p = d.placement;
  return Math.abs(p.axis[2]) > 0.9 && p.palm[1] < -0.8 && d.pose.r >= 0.018;
}

function killSwitch() {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem("tgf.fparms") === "procedural";
  } catch {
    return false;
  }
}

/** The glTF material with the operator tint applied per region (ORM red = glove mask). */
export function createArmsMaterial(src: THREE.MeshStandardMaterial, tints: THREE.Color[]) {
  const mat = new THREE.MeshStandardMaterial({
    name: "fp-arms",
    map: src.map,
    normalMap: src.normalMap,
    roughnessMap: src.roughnessMap,
    metalnessMap: src.metalnessMap,
    roughness: 1,
    metalness: 0,
  });
  // Baked albedo mean is 0.25 (linear) per region: x4 gives the tint.
  const uniforms = { fpTints: { value: tints }, fpGain: { value: 4 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 fpTints[2];\nuniform float fpGain;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef USE_ROUGHNESSMAP
float fpGlove = step(0.5, texture2D(roughnessMap, vRoughnessMapUv).r);
#else
float fpGlove = 0.0;
#endif
diffuseColor.rgb *= mix(fpTints[1], fpTints[0], fpGlove) * fpGain;`,
      );
  };
  mat.customProgramCacheKey = () => "fp-arms-v1";
  return mat;
}
