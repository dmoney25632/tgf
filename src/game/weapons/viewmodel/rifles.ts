import * as THREE from "three";
import type { P2, V3 } from "./geo";
import { buildArm } from "./hands";
import {
  type Kit, barrel, boxMag, buttonX, circle, flashHider, foldedIrons, holoSight, pinX, pistolGrip, rail, redDot, rrect, screwX,
  selectorMarks, sideRail, slot, slottedPlate, triggerGroup,
} from "./parts";
import { type GunSpec, boltFace, grabMag, newSpec, part, receiverWithPort, strongOnGrip, supportOnHandguard, v3 } from "./common";

// =============================================================================
// AKM — stamped receiver, ribbed dust cover, laminated wood furniture, steel
// banana mag, right-side reciprocating charging handle, tangent rear sight,
// hooded front post and slant brake. Iron sights.
// =============================================================================
export function buildAkm(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("akm");
  const yb = -0.044;
  const recTop = yb + 0.006;
  const recBot = yb - 0.05;
  b.into(g.root);

  // Receiver: stamped box with an ejection window on the right, rivets, mag well.
  const rec: P2[] = [[0.122, recTop], [-0.128, recTop], [-0.128, recBot + 0.004], [-0.122, recBot], [0.11, recBot], [0.122, recBot + 0.01]];
  const portC: [number, number] = [-0.055, yb - 0.004];
  const inner = receiverWithPort(k, m.blued, rec, -0.015, 0.015, rrect(0.07, 0.014, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.014, 0.07, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  for (const sx of [-1, 1]) {
    // Stamped dimples (mag guide) + rivet rows.
    b.box(m.blued, 0.002, 0.012, 0.03, sx * 0.0156, recBot + 0.014, -0.095, { bev: 0.0008 });
    for (const z of [-0.12, -0.11, 0.1, 0.11]) buttonX(k, m.steel, 0.0019, 0.0012, sx * 0.0155, recBot + 0.008, z);
    buttonX(k, m.steel, 0.0024, 0.0014, sx * 0.0155, yb - 0.02, 0.02);
    buttonX(k, m.steel, 0.0024, 0.0014, sx * 0.0155, yb - 0.02, 0.045);
  }
  // Dust cover: rounded top with three stiffening ribs, rear release button.
  const cover: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    cover.push([Math.cos(a) * 0.0152, recTop + Math.sin(a) * 0.009]);
  }
  b.section(m.blued, cover, 0.118, -0.118, { bev: 0.0006 });
  for (const z of [0.07, 0.03, -0.01]) b.box(m.blued, 0.012, 0.003, 0.03, 0, recTop + 0.009, z, { bev: 0.0012 });
  b.box(m.steel, 0.008, 0.006, 0.01, 0, recTop + 0.003, 0.124, { bev: 0.0012 });
  // Trunnion / rear sight block (on top of the chamber) with tangent leaf + notch on the sight line.
  b.profile(m.blued, [[-0.128, recTop], [-0.2, yb + 0.012], [-0.2, yb - 0.012], [-0.128, recBot + 0.02]], 0.026, 0, { bev: 0.0016 });
  b.profile(m.blued, [[-0.128, recTop + 0.008], [-0.19, -0.012], [-0.19, yb + 0.012], [-0.128, recTop]], 0.022, 0, { bev: 0.0012 });
  b.box(m.steel, 0.02, 0.003, 0.07, 0, -0.008, -0.16, { rx: -0.11, bev: 0.0006 });
  for (const sx of [-1, 1]) b.box(m.steel, 0.007, 0.007, 0.003, sx * 0.0058, -0.0005, -0.129, { bev: 0.0005 });
  b.box(m.steel, 0.006, 0.005, 0.008, 0.012, -0.006, -0.15, { bev: 0.0012 });
  // Safety lever (right side, long stamped paddle) + selector detents.
  b.profile(m.steel, [[0.098, yb - 0.004], [-0.06, yb - 0.004], [-0.066, yb - 0.01], [-0.05, yb - 0.014], [0.098, yb - 0.012]], 0.0016, 0.0163, { bev: 0.0005 });
  b.box(m.steel, 0.003, 0.016, 0.014, 0.0168, yb - 0.008, -0.06, { bev: 0.0008, rx: 0.2 });
  // Trigger guard + grip (bakelite).
  triggerGroup(k, m.blued, m.steel, 0.07, 0.012, recBot, 0.024, 0.011);
  const grip = pistolGrip(k, m.polymer, 0.1, recBot + 0.004, 0.1, 0.38, 0.033, 0.03);
  // Mag release paddle behind the well.
  b.profile(m.steel, [[-0.07, recBot], [-0.058, recBot - 0.014], [-0.052, recBot - 0.016], [-0.06, recBot]], 0.012, 0, { bev: 0.0006 });
  // Fixed wood stock: drops behind the receiver, steel butt plate.
  const st: P2[] = [[0.12, recTop - 0.004], [0.36, recTop - 0.035], [0.36, recTop - 0.16], [0.3, recTop - 0.148], [0.17, recTop - 0.09], [0.12, recBot + 0.006]];
  b.profile(m.wood, st, 0.036, 0, { bev: 0.004, bevSeg: 2, seg: 2 });
  b.profile(m.steel, [[0.36, recTop - 0.033], [0.367, recTop - 0.034], [0.367, recTop - 0.162], [0.36, recTop - 0.161]], 0.038, 0, { bev: 0.0015 });
  b.box(m.steel, 0.02, 0.012, 0.01, 0, recTop - 0.013, 0.126, { bev: 0.0012 });

  // Barrel, lower + upper handguards, gas tube / block, cleaning rod.
  barrel(k, m.blued, -0.13, -0.56, yb, 0.0098, 0.0085);
  const lower: P2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    lower.push([Math.cos(a) * 0.021, yb + 0.002 + Math.sin(a) * 0.024]);
  }
  b.section(m.wood, lower, -0.2, -0.372, { bev: 0.002, bevSeg: 2 });
  // Palm swells on the lower handguard.
  for (const sx of [-1, 1]) b.box(m.wood, 0.006, 0.02, 0.1, sx * 0.019, yb - 0.008, -0.285, { bev: 0.003, bevSeg: 2 });
  b.section(m.steel, rrect(0.044, 0.046, 0.01, 0, yb - 0.002, 3), -0.372, -0.38, { bev: 0.001, holes: [circle(0.011, 0, yb, 12)] });
  // Gas tube + upper handguard.
  b.section(m.wood, rrect(0.026, 0.02, 0.009, 0, yb + 0.028, 3), -0.205, -0.36, { bev: 0.002, bevSeg: 2 });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) b.box(m.polymer, 0.002, 0.008, 0.004, sx * 0.0131, yb + 0.028, -0.24 - i * 0.03, { bev: 0 });
  b.cyl(m.blued, 0.0082, -0.36, -0.39, 0, yb + 0.028, 12);
  b.profile(m.blued, [[-0.38, yb + 0.036], [-0.405, yb + 0.036], [-0.41, yb - 0.012], [-0.38, yb - 0.012]], 0.022, 0, { bev: 0.0015 });
  b.cyl(m.steel, 0.0026, -0.395, -0.56, 0, yb - 0.016, 8);
  // Front sight base with hooded post (tip on the sight line).
  const fz = -0.53;
  b.profile(m.blued, [[fz + 0.018, yb - 0.02], [fz - 0.012, yb - 0.02], [fz - 0.012, yb + 0.014], [fz + 0.006, yb + 0.022], [fz + 0.018, yb + 0.014]], 0.022, 0, { bev: 0.0015 });
  b.box(m.blued, 0.009, -(yb + 0.02) - 0.006, 0.012, 0, (yb + 0.02 - 0.006) / 2, fz, { bev: 0.0008 });
  b.box(m.steel, 0.0022, 0.009, 0.0024, 0, -0.0045, fz, { bev: 0.0003 });
  const hood: P2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -0.35 + (i / 12) * (Math.PI + 0.7);
    hood.push([Math.cos(a) * 0.0118, -0.007 + Math.sin(a) * 0.0118]);
  }
  for (let i = 12; i >= 0; i--) {
    const a = -0.35 + (i / 12) * (Math.PI + 0.7);
    hood.push([Math.cos(a) * 0.0094, -0.007 + Math.sin(a) * 0.0094]);
  }
  b.section(m.blued, hood, fz + 0.006, fz - 0.006, { bev: 0.0004 });
  for (const sx of [-1, 1]) b.box(m.blued, 0.003, 0.012, 0.012, sx * 0.0106, -0.018, fz, { bev: 0.0006 });
  // Slant muzzle brake (cut face, left vent).
  b.lathe(m.blued, [[0, -0.556], [0.0108, -0.556], [0.0108, -0.592], [0.005, -0.592], [0, -0.592]], 0, yb, { seg: 14 });
  b.box(m.blued, 0.022, 0.012, 0.016, 0.006, yb + 0.005, -0.598, { rx: 0.5, bev: 0.0015 });
  b.box(m.polymer, 0.002, 0.008, 0.012, -0.0105, yb + 0.002, -0.578, { bev: 0.0004 });
  g.muzzle.position.set(0, yb, -0.6);

  // Bolt carrier (visible in the port) + its handle on the right: both ride every shot.
  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.006, 0.012, 0.05);
  g.boltTravel = 0.04;
  g.charge = part(g);
  b.into(g.charge);
  b.profile(m.blued, [[0.004, yb + 0.006], [-0.02, yb + 0.006], [-0.02, yb - 0.006], [0.004, yb - 0.006]], 0.006, 0.018, { bev: 0.0008 });
  b.lathe(m.blued, [[0, 0], [0.0065, 0], [0.0065, -0.01], [0.005, -0.014], [0, -0.014]], 0.021, yb, { ry: -Math.PI / 2, z: -0.004, seg: 10 });
  g.chargeTravel = 0.04;
  g.chargeRides = true;

  // Steel 30-round mag: steep curve, ribbed sides, lugged front.
  b.into(g.mag);
  boxMag(k, m.blued, 0.058, 0.21, 0.075, 0.025, { ribs: true, rounds: m.brass, plate: m.blued });
  b.box(m.blued, 0.012, 0.012, 0.01, 0, -0.004, -0.032, { bev: 0.0015 });
  g.mag.position.set(0, recBot + 0.004, -0.095);
  g.magPath = { pull: [0, -0.016, -0.012], away: [-0.07, -0.34, 0.02], rot: [0.55, 0, 0.35] };

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, yb, -0.29];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.026, [-0.25, -0.3, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.07, -0.02];
  buildArm(b, m, ...grabMag(grabAt, 0.024, [0, -1, 0.3]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  // Empty: the support hand reaches over to the right-side handle.
  g.boltHand.set(0.03, yb + 0.012, -0.004);
  g.eject.position.set(0.016, portC[1], portC[0]);
  g.ejectDir.set(1, 0.55, 0.05).normalize();
  g.hip.set(0.14, -0.085, -0.27);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.2 + 0.129);
  g.flash = "brake";
  g.flashScale = 1.05;
  g.cycle = 0.1;
  g.butt = new THREE.Vector3(0, recTop - 0.1, 0.37);
  return g;
}

// =============================================================================
// FN SCAR-L (Mk 16) — monolithic upper with full-length rail, side-folding
// stock, left-side reciprocating charging handle, FDE polymer lower.
// =============================================================================
export function buildScar(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("scarl");
  const yb = -0.062;
  const railTop = -0.032;
  b.into(g.root);

  // Upper: tall monolithic aluminium extrusion, rail on top + sides at the front.
  const up: P2[] = [[0.09, railTop - 0.0076], [-0.29, railTop - 0.0076], [-0.29, yb - 0.022], [-0.11, yb - 0.022], [-0.1, yb - 0.025], [0.06, yb - 0.025], [0.09, yb - 0.016]];
  const portC: [number, number] = [-0.03, yb - 0.006];
  const inner = receiverWithPort(k, m.cerakoteTan, up, -0.018, 0.018, rrect(0.052, 0.015, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.015, 0.052, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  rail(k, m.cerakoteTan, 0.09, -0.29, railTop, 0.021);
  for (const sx of [-1, 1]) sideRail(k, m.cerakoteTan, -0.17, -0.285, sx * 0.024, yb - 0.006, 0.018);
  // Charging-handle slot along the left.
  b.box(m.polymer, 0.002, 0.005, 0.15, -0.0181, yb + 0.006, -0.06, { bev: 0 });
  // Lower: polymer FDE with integrated guard + mag well.
  b.profile(m.polymerTan, [
    [0.072, yb - 0.025], [0.072, yb - 0.04], [0.06, yb - 0.048], [-0.008, yb - 0.048], [-0.012, yb - 0.064], [-0.016, yb - 0.068],
    [-0.092, yb - 0.068], [-0.096, yb - 0.062], [-0.094, yb - 0.046], [-0.11, yb - 0.036], [-0.11, yb - 0.025],
  ], 0.032, 0, { bev: 0.0018 });
  triggerGroup(k, m.polymerTan, m.steel, 0.05, -0.006, yb - 0.047, 0.022, 0.012);
  selectorMarks(k, -0.0162, yb - 0.032, 0.046);
  b.box(m.steel, 0.003, 0.005, 0.022, -0.0168, yb - 0.032, 0.046, { rx: -0.5, bev: 0.0008 });
  pinX(k, m.steel, 0.0026, 0.0335, 0, yb - 0.03, 0.062);
  const grip = pistolGrip(k, m.gripTan, 0.068, yb - 0.047, 0.096, 0.3, 0.034, 0.03);
  // Folding stock: hinge block, skeletal body with cheek piece, adjustable butt.
  b.box(m.polymer, 0.034, 0.04, 0.02, 0, yb + 0.002, 0.1, { bev: 0.004 });
  b.profile(m.polymerTan, [[0.11, railTop - 0.006], [0.3, railTop - 0.004], [0.32, railTop - 0.016], [0.32, yb - 0.064], [0.29, yb - 0.064], [0.25, yb - 0.03], [0.11, yb - 0.024]], 0.032, 0, { bev: 0.004, bevSeg: 2, holes: [slot(0.09, 0.016, 0.2, yb - 0.005, 3)] });
  b.box(m.polymer, 0.028, 0.016, 0.12, 0, railTop - 0.004, 0.24, { bev: 0.004, bevSeg: 2, seg: 2 });
  b.profile(m.rubber, [[0.32, railTop - 0.014], [0.332, railTop - 0.016], [0.332, yb - 0.066], [0.32, yb - 0.066]], 0.034, 0, { bev: 0.003 });
  b.box(m.steel, 0.006, 0.01, 0.024, 0.017, yb + 0.002, 0.1, { bev: 0.0015 });
  // Barrel + gas block + flash hider (A2-style SCAR comp).
  barrel(k, m.blued, -0.29, -0.49, yb, 0.0098, 0.0086);
  b.box(m.cerakoteTan, 0.03, 0.028, 0.03, 0, yb + 0.002, -0.305, { bev: 0.002 });
  b.cyl(m.steel, 0.0032, -0.3, -0.322, 0.016, yb + 0.006, 8, { ry: Math.PI / 2 });
  flashHider(k, m.steel, -0.49, yb, 0.011, 0.055);
  g.muzzle.position.set(0, yb, -0.55);
  // Folding front + rear irons, low-profile red dot.
  foldedIrons(k, 0.075, -0.275, railTop);
  const dot = redDot(k, -0.02, railTop);

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.012, 0.036);
  g.boltTravel = 0.034;
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.006, 0.004, 0.01, -0.021, yb + 0.006, -0.12, { bev: 0.0008 });
  b.lathe(m.polymer, [[0, 0], [0.0055, 0], [0.006, -0.004], [0.006, -0.016], [0, -0.017]], -0.022, yb + 0.006, { ry: Math.PI / 2, z: -0.12, seg: 10 });
  g.chargeTravel = 0.06;
  g.chargeRides = true;

  b.into(g.mag);
  boxMag(k, m.steel, 0.062, 0.172, 0.04, 0.0215, { rounds: m.brass, plate: m.polymer });
  g.mag.position.set(0, yb - 0.03, -0.051);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, yb - 0.002, -0.235];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.027, [-0.25, -0.3, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.06, -0.006];
  buildArm(b, m, ...grabMag(grabAt, 0.024));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.03, yb + 0.006, -0.12);
  g.eject.position.set(0.018, portC[1], portC[0]);
  g.ejectDir.set(1, 0.42, 0.25).normalize();
  g.hip.set(0.14, -0.078, -0.32);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.165 - dot.eye);
  g.flash = "hider";
  g.flashScale = 1;
  g.cycle = 0.1;
  g.locksBack = true;
  g.butt = new THREE.Vector3(0, -0.07, 0.34);
  return g;
}

// =============================================================================
// HK G36 — one-piece black polymer shell, carry handle with integrated 3×
// optic (red-dot on top), translucent mag, skeletonised folding stock,
// charging handle under the carry handle.
// =============================================================================
export function buildG36(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("g36");
  const yb = -0.075;
  b.into(g.root);

  // Polymer receiver shell: long, flat-sided, with the handguard moulded on.
  const body: P2[] = [[0.09, yb + 0.02], [-0.33, yb + 0.02], [-0.34, yb + 0.01], [-0.34, yb - 0.026], [-0.12, yb - 0.028], [-0.1, yb - 0.035], [0.05, yb - 0.035], [0.09, yb - 0.026]];
  const portC: [number, number] = [-0.03, yb - 0.004];
  const inner = receiverWithPort(k, m.polymer, body, -0.02, 0.02, rrect(0.05, 0.016, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  // Handguard vents + seam.
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) b.box(m.tubeInterior, 0.002, 0.012, 0.016, sx * 0.0195, yb - 0.006, -0.17 - i * 0.026, { bev: 0.0005 });
  b.box(m.polymerGray, 0.041, 0.002, 0.25, 0, yb - 0.027, -0.22, { bev: 0.0004 });
  // Lower + grip + guard (big gloved-hand guard).
  b.profile(m.polymer, [[0.06, yb - 0.035], [0.06, yb - 0.052], [0.045, yb - 0.06], [-0.012, yb - 0.06], [-0.014, yb - 0.072], [-0.09, yb - 0.072], [-0.094, yb - 0.064], [-0.1, yb - 0.035]], 0.034, 0, { bev: 0.002 });
  triggerGroup(k, m.polymer, m.steel, 0.062, -0.01, yb - 0.059, 0.028, 0.013);
  selectorMarks(k, -0.0172, yb - 0.046, 0.05);
  b.box(m.polymerGray, 0.003, 0.006, 0.024, -0.018, yb - 0.046, 0.05, { rx: -0.4, bev: 0.0008 });
  const grip = pistolGrip(k, m.grip, 0.074, yb - 0.059, 0.1, 0.3, 0.035, 0.031);
  for (const sx of [-1, 1]) {
    pinX(k, m.steel, 0.0028, 0.042, 0, yb - 0.015, 0.075 + sx * 0);
    pinX(k, m.steel, 0.0028, 0.042, 0, yb - 0.02, -0.11);
  }
  // Carry handle: arch over the receiver with the optic tube inside.
  const ch: P2[] = [[0.06, -0.026], [-0.09, -0.026], [-0.1, yb + 0.02], [-0.12, yb + 0.02], [-0.11, 0.022], [0.075, 0.022], [0.085, yb + 0.02], [0.07, yb + 0.02]];
  b.profile(m.polymer, ch, 0.03, 0, { bev: 0.003, bevSeg: 2, holes: [rrect(0.13, 0.01, 0.004, -0.015, yb + 0.03, 3)] });
  // Optic tube (3×) on the sight line, red-dot box on top (ignored at ADS here).
  b.lathe(m.polymer, [[0.0175, 0.075], [0.0188, 0.072], [0.0188, -0.105], [0.0205, -0.11], [0.0205, -0.125], [0.0175, -0.125]], 0, 0, { seg: 22 });
  b.add(m.lensCoated, new THREE.CircleGeometry(0.0172, 22), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, -0.12));
  b.add(m.lensReflex, new THREE.CircleGeometry(0.016, 22), new THREE.Matrix4().makeTranslation(0, 0, 0.068));
  b.lathe(m.rubber, [[0.0165, 0.09], [0.021, 0.088], [0.021, 0.072], [0.0185, 0.07]], 0, 0, { seg: 22 });
  b.box(m.polymer, 0.024, 0.02, 0.04, 0, 0.032, -0.02, { bev: 0.003 });
  // Reticle: thin ring + post (black, illuminated red centre).
  b.add(m.reticleRed, new THREE.RingGeometry(0.0042, 0.0047, 28), new THREE.Matrix4().makeTranslation(0, 0, -0.06));
  b.add(m.reticleRed, new THREE.CircleGeometry(0.0005, 8), new THREE.Matrix4().makeTranslation(0, 0, -0.06));
  // Folding skeleton stock with butt pad.
  b.box(m.polymer, 0.034, 0.05, 0.02, 0, yb - 0.005, 0.1, { bev: 0.004 });
  b.profile(m.polymer, [[0.11, yb + 0.02], [0.33, yb + 0.018], [0.33, yb - 0.1], [0.3, yb - 0.1], [0.2, yb - 0.05], [0.11, yb - 0.036]], 0.028, 0, { bev: 0.004, bevSeg: 2, holes: [[[0.3, yb + 0.006], [0.15, yb + 0.006], [0.15, yb - 0.022], [0.21, yb - 0.04], [0.3, yb - 0.084]]] });
  b.profile(m.rubber, [[0.33, yb + 0.02], [0.342, yb + 0.018], [0.342, yb - 0.102], [0.33, yb - 0.102]], 0.032, 0, { bev: 0.003 });
  // Barrel, flash hider, bayonet lug, folded bipod stub.
  barrel(k, m.blued, -0.34, -0.5, yb, 0.0098, 0.0086);
  b.cyl(m.polymer, 0.013, -0.34, -0.36, 0, yb, 14);
  flashHider(k, m.steel, -0.5, yb, 0.011, 0.052);
  g.muzzle.position.set(0, yb, -0.555);

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.012, 0.034);
  g.boltTravel = 0.032;
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.polymer, 0.036, 0.006, 0.012, 0, yb + 0.028, 0.03, { bev: 0.0018, seg: 2 });
  g.chargeTravel = 0.06;
  g.chargeRides = true;

  // Translucent smoke mag with the clip lugs on its side.
  b.into(g.mag);
  boxMag(k, m.lensCoatedAmber, 0.062, 0.18, 0.04, 0.0215, { rounds: m.brass, plate: m.polymer });
  b.box(m.polymer, 0.0245, 0.03, 0.064, 0, -0.012, 0.0, { bev: 0.002 });
  for (const sx of [-1, 1]) b.box(m.polymer, 0.004, 0.012, 0.012, sx * 0.0128, -0.05, 0.0, { bev: 0.001 });
  for (let i = 0; i < 7; i++) b.lathe(m.brass, [[0, 0.025], [0.0048, 0.025], [0.0048, -0.012], [0.0032, -0.022], [0, -0.024]], (i % 2 ? 1 : -1) * 0.0032, -0.02 - i * 0.02, { seg: 8, z: -0.003 * i * i * 0.04 });
  g.mag.position.set(0, yb - 0.035, -0.055);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, yb, -0.27];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.03, [-0.25, -0.3, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.06, -0.006];
  buildArm(b, m, ...grabMag(grabAt, 0.024));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.0, yb + 0.03, 0.04);
  g.eject.position.set(0.02, portC[1], portC[0]);
  g.ejectDir.set(1, 0.3, 0.3).normalize();
  g.hip.set(0.14, -0.06, -0.32);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.07 - 0.09);
  g.flash = "hider";
  g.flashScale = 0.95;
  g.cycle = 0.09;
  g.locksBack = false;
  g.butt = new THREE.Vector3(0, -0.12, 0.35);
  return g;
}

// =============================================================================
// Steyr AUG A1 — bullpup: olive polymer stock housing the action, mag behind
// the grip, folding vertical foregrip, integral 1.5× optic in a cast handle.
// =============================================================================
export function buildAug(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("aug");
  const yb = -0.068;
  b.into(g.root);

  // Stock shell: long rounded body from the butt forward past the grip.
  const shell: P2[] = [
    [0.27, yb + 0.022], [0.06, yb + 0.026], [-0.1, yb + 0.022], [-0.12, yb + 0.01], [-0.12, yb - 0.02], [-0.03, yb - 0.03],
    [0.02, yb - 0.06], [0.16, yb - 0.064], [0.25, yb - 0.075], [0.275, yb - 0.07], [0.28, yb - 0.02],
  ];
  const portC: [number, number] = [0.14, yb + 0.002];
  const inner = receiverWithPort(k, m.polymerOlive, shell, -0.024, 0.024, rrect(0.045, 0.016, 0.003, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.045, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  b.profile(m.rubber, [[0.28, yb + 0.022], [0.29, yb + 0.02], [0.29, yb - 0.072], [0.276, yb - 0.072]], 0.05, 0, { bev: 0.003 });
  // Integral grip with full-hand trigger guard loop.
  const grip = pistolGrip(k, m.polymerOlive, -0.02, yb - 0.028, 0.098, 0.18, 0.034, 0.03);
  b.profile(m.polymerOlive, [[0.0, yb - 0.026], [-0.11, yb - 0.022], [-0.115, yb - 0.04], [-0.1, yb - 0.11], [-0.07, yb - 0.124], [0.01, yb - 0.128], [0.02, yb - 0.118], [-0.008, yb - 0.112], [-0.075, yb - 0.108], [-0.09, yb - 0.1], [-0.1, yb - 0.045], [0.0, yb - 0.044]], 0.024, 0, { bev: 0.002 });
  b.box(m.steel, 0.006, 0.02, 0.006, 0, yb - 0.05, -0.05, { bev: 0.001 });
  // Crossbolt safety + mag catch.
  buttonX(k, m.steel, 0.005, 0.004, 0.024, yb - 0.02, -0.06);
  buttonX(k, m.paintRed, 0.005, 0.004, -0.024, yb - 0.02, -0.06);
  b.box(m.steel, 0.02, 0.006, 0.012, 0, yb - 0.064, 0.16, { bev: 0.0015 });
  // Cast receiver housing + barrel collar + barrel + foregrip.
  b.section(m.anodized, rrect(0.034, 0.03, 0.006, 0, yb + 0.012, 3), -0.1, -0.14, { bev: 0.002 });
  b.lathe(m.anodized, [[0.016, -0.12], [0.018, -0.13], [0.018, -0.165], [0.014, -0.17]], 0, yb, { seg: 16 });
  b.box(m.anodized, 0.03, 0.026, 0.05, 0, yb - 0.004, -0.15, { bev: 0.003 });
  barrel(k, m.blued, -0.13, -0.48, yb, 0.0105, 0.0088);
  // Barrel flutes near the chamber + gas cylinder.
  b.cyl(m.anodized, 0.007, -0.17, -0.25, 0.0, yb + 0.018, 10);
  flashHider(k, m.steel, -0.48, yb, 0.0115, 0.048);
  g.muzzle.position.set(0, yb, -0.53);
  const vgZ = -0.205;
  b.box(m.anodized, 0.02, 0.02, 0.03, 0, yb - 0.02, vgZ, { bev: 0.003 });
  b.lathe(m.polymerOlive, [[0, 0], [0.012, 0], [0.0135, -0.006], [0.0125, -0.07], [0.011, -0.078], [0, -0.079]], 0, yb - 0.03, { rx: -Math.PI / 2, z: vgZ, seg: 12 });
  // Carry handle with integral 1.5× optic.
  const hz0 = 0.06;
  const hz1 = -0.13;
  b.profile(m.anodized, [[hz0, yb + 0.024], [hz0 - 0.02, -0.022], [hz1 + 0.02, -0.022], [hz1, yb + 0.022], [hz1 + 0.012, yb + 0.022], [hz1 + 0.03, -0.03], [hz0 - 0.03, -0.03], [hz0 - 0.012, yb + 0.024]], 0.018, 0, { bev: 0.002 });
  b.lathe(m.anodized, [[0.0158, 0.045], [0.0172, 0.04], [0.0172, -0.07], [0.0215, -0.09], [0.0215, -0.115], [0.0185, -0.115]], 0, 0, { seg: 24 });
  b.lathe(m.rubber, [[0.0158, 0.06], [0.02, 0.058], [0.02, 0.044], [0.0165, 0.042]], 0, 0, { seg: 22 });
  b.add(m.lensCoated, new THREE.CircleGeometry(0.0185, 24), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, -0.11));
  b.add(m.lensReflex, new THREE.CircleGeometry(0.0155, 22), new THREE.Matrix4().makeTranslation(0, 0, 0.04));
  // Circle reticle (the AUG's famous ring).
  b.add(m.reticleAmber, new THREE.RingGeometry(0.0058, 0.0066, 32), new THREE.Matrix4().makeTranslation(0, 0, -0.05));
  b.add(m.reticleAmber, new THREE.CircleGeometry(0.0005, 8), new THREE.Matrix4().makeTranslation(0, 0, -0.05));
  for (const sx of [-1, 1]) screwX(k, sx * 0.0095, -0.03, -0.02, 0.002);

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.012, 0.03);
  g.boltTravel = 0.03;
  // Charging handle rides on the left of the barrel group.
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.012, 0.006, 0.01, -0.024, yb + 0.012, -0.11, { bev: 0.0012 });
  b.lathe(m.polymer, [[0, 0], [0.0045, 0], [0.005, -0.012], [0, -0.013]], -0.03, yb + 0.012, { ry: Math.PI / 2, z: -0.11, seg: 10 });
  g.chargeTravel = 0.07;
  g.chargeRides = true;

  // Translucent mag behind the grip.
  b.into(g.mag);
  boxMag(k, m.lensCoatedAmber, 0.058, 0.17, 0.035, 0.022, { rounds: m.brass, plate: m.polymer });
  b.box(m.polymer, 0.024, 0.022, 0.06, 0, -0.008, 0, { bev: 0.002 });
  for (let i = 0; i < 6; i++) b.lathe(m.brass, [[0, 0.024], [0.0048, 0.024], [0.0048, -0.012], [0.0032, -0.022], [0, -0.024]], (i % 2 ? 1 : -1) * 0.003, -0.02 - i * 0.022, { seg: 8, z: -0.03 * (i / 6) * (i / 6) });
  g.mag.position.set(0, yb - 0.06, 0.07);
  g.magPath = { pull: [0, -0.06, 0.004], away: [-0.04, -0.34, 0.12], rot: [-0.3, 0, 0.3] };

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.1, -0.33, 0.3]));
  const leftAt: V3 = [0, yb - 0.04, vgZ];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, -1, 0.08], palm: [-0.8, 0, 0.6], elbow: [-0.28, -0.3, 0.22], left: true, watch: true }, { r: 0.0135, thumb: "wrap", fingers: ["wrap", "wrap", "wrap", "wrap"] });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.06, -0.004];
  buildArm(b, m, ...grabMag(grabAt, 0.023, [0, -1, 0.1]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.035, yb + 0.012, -0.11);
  g.eject.position.set(0.024, portC[1], portC[0]);
  g.ejectDir.set(1, 0.3, 0.2).normalize();
  g.hip.set(0.13, -0.07, -0.36);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.085 - 0.06);
  g.flash = "hider";
  g.flashScale = 0.95;
  g.cycle = 0.09;
  g.butt = new THREE.Vector3(0, yb - 0.02, 0.29);
  return g;
}

export { holoSight, flashHider, slottedPlate };
