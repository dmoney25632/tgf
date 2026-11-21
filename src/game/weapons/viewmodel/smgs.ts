import * as THREE from "three";
import type { P2, V3 } from "./geo";
import { buildArm } from "./hands";
import { type Kit, barrel, boxMag, circle, pinX, pistolGrip, place, rrect, selectorMarks, triggerGroup } from "./parts";
import { type GunSpec, boltFace, grabMag, newSpec, part, receiverWithPort, strongOnGrip, v3 } from "./common";

// =============================================================================
// HK MP5A3 — stamped receiver with the cocking tube on top, diopter drum rear
// sight, ring-hooded front post, slimline handguard, tri-lug barrel, curved
// steel mag, retractable stock, "Navy" trigger group.
// =============================================================================
export function buildMp5(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("mp5");
  const yb = -0.04;
  b.into(g.root);

  // Receiver: rounded-top stamped body.
  const rec: P2[] = [[0.072, yb + 0.012], [-0.15, yb + 0.012], [-0.15, yb - 0.026], [-0.11, yb - 0.03], [0.06, yb - 0.03], [0.072, yb - 0.022]];
  const portC: [number, number] = [-0.018, yb - 0.002];
  const inner = receiverWithPort(k, m.steel, rec, -0.0145, 0.0145, rrect(0.038, 0.012, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.012, 0.038, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  const top: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    top.push([Math.cos(a) * 0.0145, yb + 0.012 + Math.sin(a) * 0.012]);
  }
  b.section(m.steel, top, 0.072, -0.15, { bev: 0.0006 });
  // Stamped side flutes + weld bead.
  for (const sx of [-1, 1]) b.box(m.steel, 0.0018, 0.004, 0.17, sx * 0.0148, yb - 0.018, -0.04, { bev: 0.0006 });
  // Cocking tube (over the barrel, ahead of the receiver) + front sight hood.
  b.cyl(m.steel, 0.0105, -0.15, -0.28, 0, yb + 0.018, 16);
  b.box(m.polymer, 0.002, 0.004, 0.09, -0.0105, yb + 0.018, -0.2, { bev: 0 });
  const fz = -0.27;
  b.box(m.steel, 0.008, 0.014, 0.016, 0, -0.012, fz, { bev: 0.001 });
  b.add(m.steel, new THREE.TorusGeometry(0.0112, 0.0024, 6, 22), place(0, 0, fz));
  b.box(m.steel, 0.0022, 0.012, 0.0024, 0, -0.006, fz, { bev: 0.0003 });
  // Diopter drum sits under the sight line; the aperture plate rides on top of it.
  b.box(m.steel, 0.022, 0.006, 0.03, 0, -0.0175, 0.05, { bev: 0.0012 });
  b.lathe(m.steel, [[0, -0.012], [0.0098, -0.012], [0.0102, -0.01], [0.0102, 0.01], [0.0098, 0.012], [0, 0.012]], 0, -0.0125, { ry: Math.PI / 2, z: 0.05, seg: 16 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.box(m.polymer, 0.0245, 0.0012, 0.0016, 0, -0.0125 + Math.sin(a) * 0.0103, 0.05 + Math.cos(a) * 0.0103, { rx: -a, bev: 0 });
  }
  b.section(m.steel, rrect(0.012, 0.012, 0.003, 0, 0, 3), 0.052, 0.048, { holes: [circle(0.0016, 0, 0, 10)], bev: 0.0004 });
  // Slimline handguard (ribbed polymer).
  const hg: P2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    hg.push([Math.cos(a) * 0.02, yb - 0.004 + Math.sin(a) * 0.024]);
  }
  hg.push([0.02, yb + 0.01], [-0.02, yb + 0.01]);
  b.section(m.polymer, hg, -0.15, -0.265, { bev: 0.002, bevSeg: 2 });
  for (let i = 0; i < 6; i++) b.lathe(m.polymer, [[0.0, 0], [0.0215, 0], [0.0215, -0.004], [0, -0.004]], 0, yb - 0.006, { z: -0.165 - i * 0.017, seg: 14, s: [1, 1.15, 1] });
  // Barrel stub with tri-lugs.
  barrel(k, m.blued, -0.265, -0.32, yb, 0.0085, 0.008);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
    b.box(m.blued, 0.006, 0.004, 0.012, Math.cos(a) * 0.0095, yb + Math.sin(a) * 0.0095, -0.312, { rz: a + Math.PI / 2, bev: 0.0006 });
  }
  g.muzzle.position.set(0, yb, -0.325);
  // Navy trigger group: polymer housing, ambidextrous selector, integral grip.
  b.profile(m.polymer, [[0.07, yb - 0.03], [0.07, yb - 0.046], [0.055, yb - 0.054], [0.0, yb - 0.054], [-0.004, yb - 0.064], [-0.04, yb - 0.064], [-0.044, yb - 0.03]], 0.03, 0, { bev: 0.002 });
  triggerGroup(k, m.polymer, m.steel, 0.048, -0.006, yb - 0.053, 0.022, 0.012);
  for (const sx of [-1, 1]) {
    b.box(m.steel, 0.003, 0.005, 0.024, sx * 0.0162, yb - 0.04, 0.05, { rx: -0.6, bev: 0.0008 });
    pinX(k, m.steel, 0.0024, 0.034, 0, yb - 0.036, 0.062);
  }
  selectorMarks(k, -0.0152, yb - 0.04, 0.05);
  const grip = pistolGrip(k, m.grip, 0.066, yb - 0.053, 0.092, 0.24, 0.033, 0.03);
  // Mag well + paddle release.
  b.section(m.steel, rrect(0.028, 0.03, 0.002, 0, yb - 0.045), -0.055, -0.105, { bev: 0.001, holes: [rrect(0.022, 0.024, 0.002, 0, yb - 0.045)] });
  b.profile(m.steel, [[-0.05, yb - 0.06], [-0.04, yb - 0.072], [-0.034, yb - 0.072], [-0.042, yb - 0.06]], 0.016, 0, { bev: 0.0006 });
  // A3 retractable stock: twin struts riding in grooves + butt plate.
  for (const sx of [-1, 1]) b.box(m.steel, 0.004, 0.012, 0.24, sx * 0.0158, yb - 0.008, 0.19, { bev: 0.0012 });
  b.profile(m.steel, [[0.3, yb + 0.012], [0.312, yb + 0.012], [0.314, yb - 0.09], [0.302, yb - 0.092], [0.3, yb - 0.02]], 0.04, 0, { bev: 0.003, bevSeg: 2 });
  b.profile(m.rubber, [[0.312, yb + 0.01], [0.32, yb + 0.008], [0.32, yb - 0.088], [0.313, yb - 0.09]], 0.042, 0, { bev: 0.002 });
  b.box(m.steel, 0.034, 0.008, 0.012, 0, yb - 0.008, 0.08, { bev: 0.0015 });

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.002, 0.009, 0.026);
  g.boltTravel = 0.022;
  // Cocking handle: forward-left, angled.
  g.charge = part(g);
  b.into(g.charge);
  b.cyl(m.steel, 0.0028, 0, 0.018, 0, 0, 8, { rz: 0, ry: -Math.PI / 2 - 0.5, z: 0 });
  b.lathe(m.polymer, [[0, 0], [0.006, 0], [0.0068, -0.004], [0.0068, -0.012], [0, -0.013]], 0, 0, { ry: -Math.PI / 2 - 0.5, seg: 10 });
  g.charge.position.set(-0.012, yb + 0.018, -0.235);
  g.chargeTravel = 0.085;

  b.into(g.mag);
  boxMag(k, m.steel, 0.034, 0.2, 0.045, 0.02, { rounds: m.brass, plate: m.polymer });
  for (const sx of [-1, 1]) b.box(m.steel, 0.0008, 0.15, 0.003, sx * 0.0104, -0.1, -0.01, { rx: 0.18, bev: 0 });
  g.mag.position.set(0, yb - 0.03, -0.08);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, yb - 0.004, -0.215];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, 0, 1], palm: [-0.4, -0.92, 0], elbow: [-0.25, -0.3, 0.22], left: true, watch: true }, { r: 0.023, thumb: "forward", phi0: -62, tight: 0.8 });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.07, -0.01];
  buildArm(b, m, ...grabMag(grabAt, 0.017, [0, -1, 0.2]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.02, yb + 0.018, -0.235);
  g.eject.position.set(0.015, portC[1], portC[0]);
  g.ejectDir.set(1, 0.5, 0.2).normalize();
  g.shell = "pistol";
  g.hip.set(0.13, -0.075, -0.29);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.16 - 0.046);
  g.flash = "hider";
  g.flashScale = 0.7;
  g.cycle = 0.06;
  g.butt = new THREE.Vector3(0, yb - 0.04, 0.32);
  return g;
}

// =============================================================================
// IMI Uzi — boxy stamped receiver with a ribbed top cover and top cocking
// knob, mag through the pistol grip, grip safety, folding metal stock.
// =============================================================================
export function buildUzi(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("uzi");
  const yb = -0.036;
  const top = -0.014;
  b.into(g.root);

  const rec: P2[] = [[0.1, top - 0.003], [-0.17, top - 0.003], [-0.17, yb - 0.032], [0.1, yb - 0.032]];
  const portC: [number, number] = [-0.03, yb - 0.006];
  const inner = receiverWithPort(k, m.blued, rec, -0.018, 0.018, rrect(0.05, 0.013, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.013, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  // Stamped side ribs (the Uzi's long pressed flutes).
  for (const sx of [-1, 1]) for (const y of [yb + 0.006, yb - 0.02]) b.box(m.blued, 0.002, 0.005, 0.24, sx * 0.0186, y, -0.035, { bev: 0.0008 });
  // Top cover with a centre slot for the cocking knob, latch at the front.
  b.section(m.blued, rrect(0.04, 0.006, 0.002, 0, top - 0.001, 2), 0.1, -0.17, { bev: 0.0008, holes: [] });
  for (const sx of [-1, 1]) b.box(m.blued, 0.014, 0.003, 0.2, sx * 0.012, top + 0.002, -0.04, { bev: 0.0008 });
  b.box(m.steel, 0.02, 0.006, 0.012, 0, top + 0.001, -0.165, { bev: 0.0015 });
  // Sights: rear L-flip aperture, front post with protective ears.
  b.box(m.blued, 0.02, 0.006, 0.016, 0, top + 0.004, 0.08, { bev: 0.0012 });
  b.section(m.blued, rrect(0.016, 0.014, 0.002, 0, 0), 0.082, 0.078, { holes: [circle(0.0016, 0, 0, 10)], bev: 0.0004 });
  b.box(m.blued, 0.012, -top - 0.002, 0.012, 0, top / 2, -0.15, { bev: 0.001 });
  b.box(m.steel, 0.0022, 0.008, 0.0024, 0, -0.004, -0.15, { bev: 0.0003 });
  for (const sx of [-1, 1]) b.box(m.blued, 0.003, 0.016, 0.014, sx * 0.008, -0.006, -0.15, { bev: 0.0006 });
  // Barrel nut (knurled) + short barrel.
  b.lathe(m.knurled, [[0.008, -0.168], [0.0165, -0.168], [0.0165, -0.184], [0.008, -0.184]], 0, yb, { seg: 16 });
  barrel(k, m.blued, -0.18, -0.236, yb, 0.0085, 0.008);
  g.muzzle.position.set(0, yb, -0.24);
  // Front polymer handguard under the receiver.
  b.box(m.polymer, 0.04, 0.018, 0.07, 0, yb - 0.04, -0.12, { bev: 0.004, bevSeg: 2 });
  for (let i = 0; i < 4; i++) b.box(m.polymer, 0.042, 0.003, 0.004, 0, yb - 0.04, -0.095 - i * 0.016, { bev: 0.0008 });
  // Grip (mag runs through it) + big guard + grip safety + selector.
  const rake = 0.12;
  const grip = pistolGrip(k, m.polymer, -0.02, yb - 0.032, 0.11, rake, 0.042, 0.034);
  triggerGroup(k, m.blued, m.steel, -0.045, -0.1, yb - 0.032, 0.03, 0.012);
  b.profile(m.steel, [[0.006, yb - 0.04], [0.012, yb - 0.04], [0.016, yb - 0.1], [0.01, yb - 0.1]], 0.016, 0, { bev: 0.0008 });
  b.box(m.steel, 0.004, 0.006, 0.02, -0.0185, yb - 0.022, -0.01, { rx: 0.4, bev: 0.0008 });
  selectorMarks(k, -0.0182, yb - 0.022, -0.01);
  // Folding metal stock (extended): hinge, two flat struts, butt plate.
  b.box(m.blued, 0.036, 0.02, 0.016, 0, yb - 0.01, 0.106, { bev: 0.002 });
  for (const sx of [-1, 1]) b.rod(m.blued, [sx * 0.012, yb - 0.006, 0.11], [sx * 0.014, yb - 0.022, 0.33], 0.0035, 8);
  b.rod(m.blued, [0, yb - 0.03, 0.11], [0, yb - 0.08, 0.32], 0.004, 8);
  b.profile(m.blued, [[0.32, yb + 0.004], [0.334, yb + 0.004], [0.334, yb - 0.094], [0.32, yb - 0.094]], 0.04, 0, { bev: 0.003, bevSeg: 2 });

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.009, 0.03);
  g.boltTravel = 0.03;
  // Top cocking knob rides in the cover slot (pulled on empty reloads).
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.006, 0.006, 0.012, 0, top + 0.004, -0.11, { bev: 0.0012 });
  b.lathe(m.knurled, [[0, 0], [0.0068, 0], [0.0072, -0.004], [0.0072, -0.01], [0, -0.011]], 0, top + 0.006, { rx: -Math.PI / 2, z: -0.11, seg: 12 });
  g.chargeTravel = 0.09;

  // Stick mag through the grip (follows the grip rake).
  b.into(g.mag);
  boxMag(k, m.blued, 0.03, 0.2, 0, 0.022, { rounds: m.brass, plate: m.blued });
  g.mag.position.set(0, yb - 0.03, -0.02);
  g.mag.rotation.x = -rake;
  g.magPath = { pull: [0, -0.08, 0.01], away: [-0.06, -0.36, 0.08], rot: [-0.2, 0, 0.35] };

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.1, -0.32, 0.33], 0.02));
  const leftAt: V3 = [0, yb - 0.035, -0.12];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, 0, 1], palm: [-0.4, -0.92, 0], elbow: [-0.25, -0.3, 0.2], left: true, watch: true }, { r: 0.022, thumb: "forward", phi0: -62, tight: 0.8 });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.17, -0.002];
  buildArm(b, m, ...grabMag(grabAt, 0.017, [0, -1, 0.05]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).applyEuler(g.mag.rotation).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.004, top + 0.012, -0.11);
  g.eject.position.set(0.019, portC[1], portC[0]);
  g.ejectDir.set(1, 0.6, 0.1).normalize();
  g.shell = "pistol";
  g.hip.set(0.12, -0.075, -0.3);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.2 - 0.082);
  g.flash = "pistol";
  g.flashScale = 0.9;
  g.cycle = 0.07;
  g.butt = new THREE.Vector3(0, yb - 0.04, 0.33);
  return g;
}

// =============================================================================
// FN P90 — bullpup PDW: sculpted polymer body with thumbhole grip and front
// hand stop, 50-round translucent mag lying on top, ring reflex sight,
// ambidextrous charging handles, downward ejection.
// =============================================================================
export function buildP90(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("p90");
  const yb = -0.062;
  b.into(g.root);

  // Body: one sculpted profile with the thumbhole and the front hand-stop opening.
  const body: P2[] = [
    [0.27, yb + 0.016], [-0.06, yb + 0.016], [-0.17, yb + 0.012], [-0.2, yb], [-0.205, yb - 0.02], [-0.19, yb - 0.04],
    [-0.15, yb - 0.05], [-0.13, yb - 0.1], [-0.1, yb - 0.112], [-0.02, yb - 0.108], [0.03, yb - 0.115], [0.11, yb - 0.112],
    [0.2, yb - 0.098], [0.262, yb - 0.08], [0.275, yb - 0.05],
  ];
  const thumb = rrect(0.07, 0.042, 0.018, 0.075, yb - 0.072, 4);
  const front = rrect(0.05, 0.036, 0.016, -0.075, yb - 0.075, 4);
  b.profile(m.polymer, body, 0.044, 0, { bev: 0.005, bevSeg: 2, seg: 3, holes: [thumb, front] });
  // Grey grip panels + trigger in the front opening.
  for (const sx of [-1, 1]) b.box(m.polymerGray, 0.002, 0.03, 0.08, sx * 0.0222, yb - 0.02, 0.15, { bev: 0.0008 });
  b.profile(m.polymerGray, [[-0.056, yb - 0.054], [-0.05, yb - 0.054], [-0.048, yb - 0.076], [-0.054, yb - 0.078]], 0.006, 0, { bev: 0.0012 });
  // Rotary selector under the trigger + ambidextrous mag latch at the rear.
  b.lathe(m.steel, [[0, 0], [0.008, 0], [0.008, -0.004], [0, -0.004]], 0, yb - 0.112, { rx: Math.PI / 2, z: -0.06, seg: 12 });
  b.box(m.polymerGray, 0.03, 0.008, 0.012, 0, yb + 0.03, 0.262, { bev: 0.002 });
  // Barrel + flash hider.
  barrel(k, m.blued, -0.19, -0.255, yb, 0.0085, 0.008);
  b.lathe(m.polymer, [[0.008, -0.2], [0.0125, -0.2], [0.0125, -0.255], [0.0105, -0.262], [0.008, -0.262]], 0, yb, { seg: 14 });
  g.muzzle.position.set(0, yb, -0.268);
  // Optic housing (front of the mag rails) with the ring reflex reticle.
  b.section(m.polymer, rrect(0.036, 0.05, 0.01, 0, -0.012, 3), -0.035, -0.165, { bev: 0.003, bevSeg: 2, holes: [circle(0.0095, 0, 0, 18)] });
  b.section(m.polymer, rrect(0.03, 0.006, 0.002, 0, 0.0155), -0.02, -0.06, { bev: 0.001 });
  b.add(m.lensReflex, new THREE.PlaneGeometry(0.03, 0.016), place(0, 0, -0.13));
  b.add(m.reticleRed, new THREE.RingGeometry(0.0038, 0.0045, 28), place(0, 0, -0.131));
  b.add(m.reticleRed, new THREE.CircleGeometry(0.0006, 8), place(0, 0, -0.131));
  // Mag rails along the top.
  for (const sx of [-1, 1]) b.box(m.polymer, 0.004, 0.012, 0.3, sx * 0.019, yb + 0.022, 0.12, { bev: 0.0012 });

  b.into(g.bolt);
  boltFace(k, -0.002, yb - 0.11, 0.12, 0.01, 0.02);
  g.boltTravel = 0.02;
  // Ambidextrous charging handles just behind the hand stop.
  g.charge = part(g);
  b.into(g.charge);
  for (const sx of [-1, 1]) b.lathe(m.polymerGray, [[0, 0], [0.005, 0], [0.0055, -0.003], [0.0055, -0.01], [0, -0.011]], sx * 0.022, yb - 0.004, { ry: -sx * Math.PI / 2, z: -0.14, seg: 10 });
  g.chargeTravel = 0.06;

  // Translucent 50-round mag on top, rounds lying across it in a double stack.
  b.into(g.mag);
  b.section(m.lensCoatedAmber, rrect(0.034, 0.02, 0.004, 0, 0.0, 3), 0.15, -0.2, { bev: 0.002 });
  b.section(m.polymer, rrect(0.036, 0.022, 0.004, 0, 0.0, 3), 0.17, 0.15, { bev: 0.002 });
  for (let i = 0; i < 22; i++) {
    const z = 0.14 - i * 0.015;
    b.lathe(m.brass, [[0, 0.012], [0.0036, 0.012], [0.0036, -0.008], [0.0024, -0.012], [0, -0.013]], 0, (i % 2 ? 0.004 : -0.004), { ry: Math.PI / 2 + (i % 2 ? 0.08 : -0.08), z, seg: 6 });
  }
  g.mag.position.set(0, yb + 0.034, 0.0);
  g.magPath = { pull: [0, 0.02, 0.04], away: [-0.08, -0.2, 0.22], rot: [-0.4, 0, 0.4] };

  b.into(g.root);
  buildArm(b, m, { at: [0, yb - 0.05, 0.0], axis: [0, -1, 0.15], palm: [0.42, 0, 1], elbow: [0.1, -0.33, 0.33] }, { r: 0.017, fingers: [[0.15, 1.05, 0.75], "wrap", "wrap", "wrap"], thumb: "wrap", phi0: -62 });
  const leftAt: V3 = [0, yb - 0.035, -0.172];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, -1, 0.1], palm: [-0.8, 0, 0.6], elbow: [-0.28, -0.3, 0.22], left: true, watch: true }, { r: 0.016, thumb: "wrap", fingers: ["wrap", "wrap", "wrap", "wrap"] });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, 0.014, 0.12];
  buildArm(b, m, { at: grabAt, axis: [0, 0, 1], palm: [0, 1, 0], elbow: [-0.2, -0.3, 0.3], left: true, watch: true }, { r: 0.02, thumb: "wrap", tight: 0.8 });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.03, yb - 0.004, -0.14);
  g.eject.position.set(0, yb - 0.11, 0.12);
  g.ejectDir.set(0.15, -1, 0.15).normalize();
  g.shell = "pdw";
  g.hip.set(0.12, -0.06, -0.3);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.065);
  g.flash = "hider";
  g.flashScale = 0.75;
  g.cycle = 0.06;
  g.butt = new THREE.Vector3(0, yb - 0.03, 0.28);
  return g;
}

