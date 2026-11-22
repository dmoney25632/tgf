import * as THREE from "three";
import type { GunSpec } from "./common";
import { GeoBuilder } from "./geo";
import { buildArm, type ArmPlacement, type HandPose } from "./hands";
import type { ViewmodelMaterials } from "./materials";
import { closeSupportHand, fitRealGun, type RealFit, type RealGun, type RealPart, type RealTemplate } from "./realFit";

/**
 * Puts a real model onto a gun built with `b.armsOnly` (after `b.finish`):
 * fits it to the built gun's bounds, hands its moving pieces (magazine, pump,
 * slide) to the animated groups, and closes the support hand onto the real
 * handguard. New geometry goes into `owned`.
 */
export function mountRealGun(spec: GunSpec, b: GeoBuilder, t: RealTemplate, cfg: RealGun, mats: ViewmodelMaterials, owned: { dispose(): void }[]): RealFit & { hand?: [ArmPlacement, HandPose] } {
  const root = spec.root;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const toGun = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
  const gun = new THREE.Box3();
  for (const [obj, box] of b.gunBounds) gun.union(box.clone().applyMatrix4(toGun(obj)));
  const groups: Partial<Record<RealPart, THREE.Object3D>> = { mag: spec.mag, pump: spec.pump, bolt: spec.bolt };
  const boxes: Partial<Record<RealPart, THREE.Box3>> = {};
  for (const [k, obj] of Object.entries(groups) as [RealPart, THREE.Object3D | undefined][]) {
    const box = obj && b.gunBounds.get(obj);
    if (box) boxes[k] = box.clone().applyMatrix4(toGun(obj));
  }
  const fit = fitRealGun(cfg, t, gun, spec.boreMuzzle ?? spec.muzzle.position, boxes, spec.kind);
  root.add(fit.object);
  // Nudged onto the sight line: flash and brass leave from the real muzzle and port.
  if (cfg.offset && !spec.boreMuzzle) {
    const off = new THREE.Vector3(...cfg.offset);
    spec.muzzle.position.add(off);
    spec.eject.position.add(off);
  }
  for (const [k, part] of fit.parts) {
    const target = groups[k];
    if (!target) continue;
    root.add(part);
    root.updateMatrixWorld(true);
    target.attach(part);
  }
  let hand: [ArmPlacement, HandPose] | undefined;
  if (!cfg.keepHand && !spec.handgun) {
    const arms = b.arms.filter((a) => a.target === spec.leftArm);
    if (arms.length === 1) {
      hand = closeSupportHand(t, fit, arms[0].p, arms[0].pose, toGun(spec.leftArm)) ?? undefined;
      if (hand) rebuildArm(spec.leftArm, b, mats, owned, ...hand);
    }
  }
  return { ...fit, hand };
}

/** Replace the arm built into `target` with one at a new placement. */
function rebuildArm(target: THREE.Object3D, src: GeoBuilder, mats: ViewmodelMaterials, owned: { dispose(): void }[], p: ArmPlacement, pose: HandPose) {
  for (const c of [...target.children]) {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) continue;
    mesh.removeFromParent();
    const i = owned.indexOf(mesh.geometry);
    if (i >= 0) owned.splice(i, 1);
    mesh.geometry.dispose();
  }
  const b = new GeoBuilder(mats.render);
  b.isArm = src.isArm;
  b.armsOnly = src.armsOnly;
  b.into(target);
  buildArm(b, mats, p, pose);
  b.finish(owned);
}
