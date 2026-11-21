import * as THREE from "three";
import { type P2, type V3, circle, rrect } from "./geo";
import { buildArm } from "./hands";
import {
  type Kit, barrel, buttonX, flashHider, pistolGrip, prismSight, rail, slottedFloor, slottedPlate, stock, triggerGroup, 
} from "./parts";
import { type GunSpec, boltFace, newSpec, part, receiverWithPort, strongOnGrip, supportOnHandguard, v3 } from "./common";

// =============================================================================
// FN M249 SAW — belt-fed 5.56, hinged feed cover with an optic rail, 200-round
// soft-pack box hanging left, folding bipod, carry handle and heat shield.
// =============================================================================
export function buildM249(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("m249");
  const yb = -0.068;
  b.into(g.root);

  const recv: P2[] = [[0.09, -0.04], [-0.2, -0.04], [-0.2, -0.098], [-0.03, -0.1], [0.06, -0.1], [0.09, -0.088]];
  const portC: [number, number] = [-0.045, -0.074];
  const inner = receiverWithPort(k, m.steel, recv, -0.023, 0.023, rrect(0.05, 0.016, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  for (let i = 0; i < 5; i++) b.box(m.steel, 0.048, 0.003, 0.004, 0, -0.098, -0.17 + i * 0.025, { bev: 0.0006 });
  b.box(m.steel, 0.008, 0.02, 0.055, -0.0262, -0.056, -0.05, { bev: 0.0012 });
  b.box(m.bright, 0.004, 0.012, 0.045, -0.029, -0.055, -0.05, { bev: 0.0006 });
  triggerGroup(k, m.steel, m.steel, 0.052, -0.012, -0.099, 0.023, 0.012);
  const grip = pistolGrip(k, m.grip, 0.068, -0.098, 0.098, 0.3, 0.036, 0.031);
  buttonX(k, m.steel, 0.0065, 0.0025, -0.024, -0.086, 0.052);
  stock(k, m.polymer, m.rubber, 0.09, -0.042, 0.24, 0.118, 0.042);
  b.cyl(m.steel, 0.006, -0.026, 0.026, 0, -0.04, 10, { ry: Math.PI / 2, z: 0.078 });
  // Ribbed handguard.
  for (const sx of [-1, 1]) slottedPlate(k, m.polymer, -0.2, -0.42, -0.094, -0.046, sx * 0.0235, 0.005, 4, 0.03);
  slottedFloor(k, m.polymer, -0.2, -0.42, 0.042, -0.097, 0.005, 4);
  b.section(m.polymer, rrect(0.047, 0.005, 0.002, 0, -0.0455), -0.2, -0.42, { bev: 0.001 });
  for (const sx of [-1, 1]) b.box(m.polymer, 0.007, 0.007, 0.22, sx * 0.0212, -0.0965, -0.31, { rz: Math.PI / 4, bev: 0.001 });
  b.section(m.steel, rrect(0.05, 0.056, 0.01, 0, -0.07, 3), -0.418, -0.426, { bev: 0.0012, holes: [circle(0.0152, 0, yb, 16)] });
  // Heavy barrel, gas block, carry handle, flash hider.
  barrel(k, m.blued, -0.2, -0.68, yb, 0.0148, 0.0132);
  b.profile(m.steel, [[-0.432, -0.05], [-0.468, -0.05], [-0.468, -0.094], [-0.432, -0.094]], 0.028, 0, { bev: 0.0018 });
  b.profile(m.steel, [[-0.47, -0.055], [-0.5, -0.032], [-0.6, -0.032], [-0.62, -0.055], [-0.61, -0.056], [-0.594, -0.039], [-0.506, -0.039], [-0.48, -0.056]], 0.012, 0, { bev: 0.0015 });
  b.box(m.steel, 0.02, 0.012, 0.025, 0, -0.053, -0.475, { bev: 0.002 });
  b.box(m.steel, 0.02, 0.012, 0.025, 0, -0.053, -0.615, { bev: 0.002 });
  flashHider(k, m.steel, -0.68, yb, 0.0145, 0.052);
  g.muzzle.position.set(0, yb, -0.735);
  // Folded bipod under the gas block.
  b.box(m.steel, 0.03, 0.012, 0.03, 0, -0.1, -0.45, { bev: 0.002 });
  for (const sx of [-1, 1]) {
    b.rod(m.steel, [sx * 0.011, -0.104, -0.445], [sx * 0.015, -0.106, -0.255], 0.0052, 8);
    b.rod(m.steel, [sx * 0.015, -0.106, -0.33], [sx * 0.016, -0.106, -0.23], 0.0042, 8);
    b.box(m.rubber, 0.012, 0.01, 0.018, sx * 0.016, -0.107, -0.228, { bev: 0.003, seg: 2 });
  }

  // Feed cover (hinge at the rear) carrying its own rail + prism optic.
  g.cover = new THREE.Group();
  g.cover.position.set(0, -0.04, 0.078);
  g.root.add(g.cover);
  const coverBody = new THREE.Group();
  coverBody.position.set(0, 0.04, -0.078);
  g.cover.add(coverBody);
  b.into(coverBody);
  b.profile(m.steel, [[0.085, -0.04], [-0.12, -0.04], [-0.12, -0.034], [-0.1, -0.0315], [0.07, -0.0315], [0.085, -0.035]], 0.046, 0, { bev: 0.0016 });
  b.box(m.steel, 0.012, 0.006, 0.014, 0, -0.035, -0.118, { bev: 0.0012 });
  rail(k, m.steel, 0.06, -0.12, -0.0239, 0.021);
  const pr = prismSight(k, -0.02, -0.0239);

  b.into(g.bolt);
  b.box(m.bright, 0.0008, 0.012, 0.036, inner + 0.0006, portC[1], portC[0] + 0.004, { bev: 0.0002 });
  g.boltTravel = 0.034;
  g.charge = new THREE.Group();
  g.root.add(g.charge);
  b.into(g.charge);
  b.lathe(m.steel, [[0, 0], [0.004, 0], [0.004, -0.016], [0.007, -0.018], [0.007, -0.028], [0, -0.03]], 0.023, -0.064, { ry: -Math.PI / 2, z: -0.13, seg: 10 });
  g.chargeTravel = 0.09;

  // Box magazine + a short belt rising into the feed tray.
  b.into(g.mag);
  b.box(m.polymerOlive, 0.062, 0.11, 0.118, 0, -0.055, 0, { bev: 0.004, seg: 2 });
  b.box(m.polymerOlive, 0.066, 0.008, 0.122, 0, 0.0, 0, { bev: 0.0025 });
  b.box(m.canvas, 0.064, 0.022, 0.04, 0, -0.07, 0, { bev: 0.002 });
  b.box(m.steel, 0.02, 0.014, 0.006, -0.031, -0.02, -0.03, { bev: 0.002 });
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = 0.008 + t * 0.012;
    const y = 0.006 + t * 0.042;
    b.lathe(m.brass, [[0, 0.025], [0.0062, 0.025], [0.0062, -0.012], [0.0042, -0.018], [0.0034, -0.022], [0.0022, -0.03], [0, -0.032]], x, y, { seg: 8 });
    b.box(m.steel, 0.012, 0.0028, 0.012, x - 0.004 + (i % 2) * 0.003, y - 0.004, 0.006, { bev: 0.0006 });
  }
  g.mag.position.set(-0.045, -0.104, -0.05);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.12, -0.34, 0.38]));
  const leftAt: V3 = [0, yb, -0.3];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.0295, [-0.26, -0.32, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [-0.006, -0.11, -0.03];
  buildArm(b, m, { at: grabAt, axis: [0, 0, 1], palm: [0, -1, 0], elbow: [-0.18, -0.36, 0.2], left: true, watch: true }, { r: 0.03, thumb: "forward", tight: 0.85 });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.03, -0.064, -0.145);
  g.eject.position.set(0.025, portC[1], portC[0]);
  g.ejectDir.set(1, 0.25, 0.25).normalize();
  g.shell = "rifle";
  g.hip.set(0.15, -0.085, -0.34);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.165 - pr.eye);
  g.flash = "hider";
  g.flashScale = 1.15;
  g.cycle = 0.1;
  g.reload = "box";
  g.butt = new THREE.Vector3(0, -0.1, 0.34);
  return g;
}

// =============================================================================
// PKM — 7.62×54R GPMG: stamped receiver with a front-hinged feed cover, fluted
// barrel over an exposed gas tube, skeletonised wooden stock, tall hooded front
// post, leaf rear sight, 100-round steel box hanging on the right.
// =============================================================================
export function buildPkm(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("pkm");
  const yb = -0.064;
  const top = -0.04;
  b.into(g.root);

  const recv: P2[] = [[0.085, top], [-0.17, top], [-0.17, -0.1], [-0.02, -0.104], [0.06, -0.104], [0.085, -0.09]];
  const portC: [number, number] = [-0.05, -0.08];
  const inner = receiverWithPort(k, m.blued, recv, -0.022, 0.022, rrect(0.05, 0.016, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  // Rivets + stamped side rails.
  for (const sx of [-1, 1]) {
    b.box(m.blued, 0.002, 0.004, 0.24, sx * 0.0228, -0.094, -0.045, { bev: 0.0006 });
    for (let i = 0; i < 4; i++) b.cyl(m.steel, 0.0022, -0.001, 0.001, sx * 0.0228, -0.058, 6, { ry: Math.PI / 2, z: -0.15 + i * 0.07 });
  }
  // Leaf rear sight ahead of the feed cover.
  const rz = -0.13;
  b.box(m.blued, 0.024, 0.008, 0.03, 0, top + 0.004, rz, { bev: 0.0015 });
  b.profile(m.blued, [[rz + 0.012, top + 0.008], [rz - 0.012, top + 0.008], [rz - 0.006, -0.006], [rz + 0.002, -0.006]], 0.02, 0, { bev: 0.0008 });
  for (const sx of [-1, 1]) b.box(m.blued, 0.007, 0.008, 0.003, sx * 0.0052, -0.002, rz - 0.002, { bev: 0.0004 });
  b.box(m.steel, 0.012, 0.004, 0.006, 0.014, top + 0.006, rz + 0.006, { bev: 0.001 });
  // Trigger + wooden pistol grip (bakelite brown), safety lever.
  triggerGroup(k, m.blued, m.steel, 0.05, -0.012, -0.103, 0.024, 0.012);
  const grip = pistolGrip(k, m.wood, 0.066, -0.102, 0.1, 0.32, 0.036, 0.031);
  b.box(m.steel, 0.003, 0.006, 0.026, -0.0235, -0.096, 0.02, { rx: -0.3, bev: 0.0008 });
  // Skeleton stock: wooden frame with a big lightening cut, steel butt plate.
  const sz0 = 0.085;
  const sz1 = 0.37;
  b.profile(m.wood, [
    [sz0, top - 0.004], [sz0 + 0.1, top - 0.004], [sz1, -0.044], [sz1, -0.17], [sz1 - 0.03, -0.172], [sz0 + 0.12, -0.115], [sz0 + 0.03, -0.104], [sz0, -0.098],
  ], 0.036, 0, { bev: 0.004, bevSeg: 2, holes: [[[sz0 + 0.06, -0.06], [sz1 - 0.04, -0.064], [sz1 - 0.04, -0.142], [sz0 + 0.14, -0.105], [sz0 + 0.06, -0.088]]] });
  b.profile(m.blued, [[sz1, -0.042], [sz1 + 0.01, -0.042], [sz1 + 0.01, -0.173], [sz1, -0.173]], 0.038, 0, { bev: 0.002 });
  b.box(m.wood, 0.03, 0.01, 0.12, 0, -0.035, sz0 + 0.17, { bev: 0.004, seg: 2 });
  // Fluted barrel, gas tube + regulator, front sight block, slotted flash hider.
  barrel(k, m.blued, -0.17, -0.62, yb, 0.0125, 0.0115);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(m.polymer, 0.0028, 0.0014, 0.2, Math.cos(a) * 0.0124, yb + Math.sin(a) * 0.0124, -0.29, { rz: a + Math.PI / 2, bev: 0 });
  }
  b.cyl(m.blued, 0.009, -0.17, -0.43, 0, -0.094, 14);
  b.box(m.blued, 0.024, 0.05, 0.03, 0, -0.08, -0.44, { bev: 0.002 });
  b.cyl(m.steel, 0.006, -0.425, -0.455, 0.014, -0.094, 10, { ry: 0 });
  const fz = -0.595;
  b.profile(m.blued, [[fz + 0.02, yb - 0.012], [fz - 0.02, yb - 0.012], [fz - 0.012, -0.012], [fz + 0.008, -0.012]], 0.012, 0, { bev: 0.0012 });
  for (const sx of [-1, 1]) b.box(m.blued, 0.003, 0.024, 0.016, sx * 0.0085, -0.01, fz, { bev: 0.0006 });
  b.box(m.steel, 0.0024, 0.012, 0.0024, 0, -0.006, fz, { bev: 0.0003 });
  flashHider(k, m.blued, -0.62, yb, 0.0135, 0.055);
  g.muzzle.position.set(0, yb, -0.68);
  // Folding carry handle over the barrel, folded bipod under the gas block.
  b.box(m.blued, 0.026, 0.012, 0.02, 0, yb + 0.012, -0.24, { bev: 0.002 });
  b.rod(m.blued, [0.004, yb + 0.018, -0.24], [0.026, yb + 0.02, -0.18], 0.004, 8);
  b.rod(m.wood, [0.026, yb + 0.02, -0.18], [0.03, yb + 0.02, -0.11], 0.008, 10);
  b.box(m.blued, 0.03, 0.012, 0.03, 0, -0.106, -0.44, { bev: 0.002 });
  for (const sx of [-1, 1]) {
    b.rod(m.steel, [sx * 0.011, -0.11, -0.43], [sx * 0.016, -0.112, -0.24], 0.005, 8);
    b.box(m.steel, 0.014, 0.008, 0.02, sx * 0.016, -0.113, -0.235, { bev: 0.002 });
  }

  // Feed cover: hinged at the front, the rear lifts.
  g.cover = new THREE.Group();
  g.cover.position.set(0, top, -0.112);
  g.root.add(g.cover);
  g.coverSign = -1;
  const coverBody = new THREE.Group();
  coverBody.position.set(0, -top, 0.112);
  g.cover.add(coverBody);
  b.into(coverBody);
  b.profile(m.blued, [[0.08, top], [-0.112, top], [-0.112, top + 0.006], [-0.1, top + 0.009], [0.065, top + 0.009], [0.08, top + 0.004]], 0.044, 0, { bev: 0.0016 });
  for (let i = 0; i < 3; i++) b.box(m.blued, 0.046, 0.0025, 0.006, 0, top + 0.01, -0.06 + i * 0.05, { bev: 0.0006 });
  b.box(m.steel, 0.014, 0.008, 0.014, 0, top + 0.004, 0.084, { bev: 0.0015 });
  g.coverLatch = new THREE.Vector3(-0.004, top + 0.012, 0.084);

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.012, 0.036);
  g.boltTravel = 0.04;
  // Charging handle (right side, under the receiver) — pulled on empty.
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.006, 0.006, 0.03, 0.025, -0.092, -0.12, { bev: 0.0012 });
  b.lathe(m.steel, [[0, 0], [0.004, 0], [0.004, -0.018], [0.0075, -0.021], [0.0075, -0.032], [0, -0.034]], 0.025, -0.092, { ry: -Math.PI / 2, z: -0.13, seg: 10 });
  g.chargeTravel = 0.11;

  // 100-round steel box on the right, belt climbing into the feed tray.
  b.into(g.mag);
  b.box(m.polymerOlive, 0.058, 0.118, 0.12, 0, -0.06, 0, { bev: 0.003, seg: 2 });
  b.box(m.polymerOlive, 0.062, 0.008, 0.124, 0, -0.002, 0, { bev: 0.002 });
  b.box(m.steel, 0.024, 0.012, 0.004, 0.031, -0.03, 0, { bev: 0.001 });
  b.box(m.steel, 0.004, 0.06, 0.02, 0.031, -0.06, -0.04, { bev: 0.001 });
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = -0.008 - t * 0.012;
    const y = 0.006 + t * 0.044;
    b.lathe(m.brass, [[0, 0.03], [0.0072, 0.03], [0.0072, -0.014], [0.0048, -0.022], [0.004, -0.028], [0.0025, -0.036], [0, -0.038]], x, y, { seg: 8 });
    b.box(m.steel, 0.013, 0.003, 0.014, x + 0.003 - (i % 2) * 0.003, y - 0.005, 0.008, { bev: 0.0006 });
  }
  g.mag.position.set(0.048, -0.108, -0.05);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.12, -0.34, 0.38]));
  const leftAt: V3 = [0, -0.078, -0.28];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.024, [-0.26, -0.32, 0.22]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0.004, -0.115, -0.03];
  buildArm(b, m, { at: grabAt, axis: [0, 0, 1], palm: [0, -1, 0], elbow: [-0.16, -0.36, 0.2], left: true, watch: true }, { r: 0.03, thumb: "forward", tight: 0.85 });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.03, -0.092, -0.15);
  g.eject.position.set(0.024, portC[1], portC[0]);
  g.ejectDir.set(1, 0.3, 0.25).normalize();
  g.shell = "heavy";
  g.hip.set(0.15, -0.085, -0.34);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.21 - rz);
  g.flash = "hider";
  g.flashScale = 1.3;
  g.cycle = 0.1;
  g.reload = "box";
  g.butt = new THREE.Vector3(0, -0.1, 0.37);
  return g;
}
