import * as THREE from "three";
import type { GunSpec } from "./common";
import { GeoBuilder } from "./geo";
import { buildArm, type ArmPlacement, type HandPose } from "./hands";
import type { ViewmodelMaterials } from "./materials";
import { removeHandAnchors } from "./arms/anchor";
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
  mountGlass(fit.object, root, toGun, cfg, mats, owned);
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
  removeHandAnchors(target);
  const b = new GeoBuilder(mats.render);
  b.isArm = src.isArm;
  b.armsOnly = src.armsOnly;
  b.armGeometry = src.armGeometry;
  b.into(target);
  buildArm(b, mats, p, pose);
  b.finish(owned);
}

/**
 * Art-pipeline guns ship optic glass as a mesh named `lens` (baked, it would be an
 * opaque disc): swap it for the viewmodel's see-through glass and add the reticle.
 */
function mountGlass(real: THREE.Object3D, root: THREE.Object3D, toGun: (o: THREE.Object3D) => THREE.Matrix4, cfg: RealGun, mats: ViewmodelMaterials, owned: { dispose(): void }[]) {
  const lenses: THREE.Mesh[] = [];
  real.updateMatrixWorld(true);
  const reticles: THREE.Mesh[] = [];
  real.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const name = o.name || o.parent?.name || "";
    if (/^lens/.test(name)) lenses.push(o as THREE.Mesh);
    else if (/^reticle/.test(name)) reticles.push(o as THREE.Mesh);
  });
  if (!lenses.length && !reticles.length) return;
  const b = new GeoBuilder(mats.render);
  b.into(root);
  const box = new THREE.Box3();
  for (const mesh of [...lenses, ...reticles]) {
    const glow = reticles.includes(mesh);
    // Plain float copy (the source may be quantized / indexed) placed in gun space.
    const src = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : src.count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = idx ? idx.getX(i) : i;
      pos.set([src.getX(v), src.getY(v), src.getZ(v)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.applyMatrix4(toGun(mesh));
    g.computeVertexNormals();
    g.computeBoundingBox();
    if (glow) {
      // Modelled reticle (the P90 ring): self-lit, in the optic's colour, never baked dark.
      b.add(cfg.reticle === "amber" ? mats.reticleAmber : mats.reticleRed, g);
      mesh.removeFromParent();
      continue;
    }
    box.union(g.boundingBox!);
    b.add(mats.lens, g);
    mesh.removeFromParent();
  }
  if (cfg.reticle && !reticles.length && lenses.length) {
    const c = box.getCenter(new THREE.Vector3());
    const r = cfg.reticle === "red" ? 0.0007 : 0.0009;
    b.add(cfg.reticle === "red" ? mats.reticleRed : mats.reticleAmber, new THREE.CircleGeometry(r, 12), new THREE.Matrix4().makeTranslation(c.x, c.y, box.min.z + 0.0015));
  }
  b.finish(owned);
}
