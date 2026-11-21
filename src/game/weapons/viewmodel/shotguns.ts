import * as THREE from "three";
import { type P2, type V3, rrect, place } from "./geo";
import { buildArm } from "./hands";
import {
  type Kit, apertureRear, barrel, buttonX, frontPost, pinX, pistolGrip, rail, stock, triggerGroup, 
} from "./parts";
import { type GunSpec, newSpec, part, strongOnGrip, supportOnHandguard, v3 } from "./common";

// =============================================================================
// Remington 870 — pump shotgun: steel receiver, walnut stock and ribbed
// forend, bead/ghost-ring sights, side saddle, magazine tube under the barrel.
// =============================================================================
export function buildR870(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("r870");
  const yb = -0.034;
  b.into(g.root);

  b.profile(m.steel, [[0.078, -0.016], [-0.146, -0.016], [-0.15, -0.021], [-0.15, -0.074], [0.0, -0.076], [0.058, -0.076], [0.078, -0.062]], 0.034, 0, { bev: 0.0022, bevSeg: 2 });
  b.box(m.polymer, 0.0006, 0.018, 0.064, 0.0172, -0.037, -0.052, { bev: 0 });
  b.box(m.polymer, 0.022, 0.0008, 0.08, 0, -0.0764, -0.07, { bev: 0 });
  rail(k, m.steel, 0.012, -0.13, -0.0085, 0.019);
  apertureRear(k, m.steel, 0.045, -0.016, 0.0045);
  pinX(k, m.steel, 0.0024, 0.035, 0, -0.068, 0.06);
  pinX(k, m.steel, 0.0024, 0.035, 0, -0.068, 0.02);
  triggerGroup(k, m.steel, m.steel, 0.058, 0.008, -0.075, 0.022, 0.012);
  buttonX(k, m.bright, 0.004, 0.004, 0.009, -0.078, 0.052);
  const grip = pistolGrip(k, m.wood, 0.074, -0.074, 0.098, 0.36, 0.035, 0.031);
  stock(k, m.wood, m.rubber, 0.078, -0.022, 0.26, 0.112, 0.04);
  // Side saddle with four shells.
  b.box(m.polymer, 0.004, 0.046, 0.09, -0.0195, -0.045, -0.06, { bev: 0.0012 });
  for (let i = 0; i < 4; i++) {
    const z = -0.025 - i * 0.022;
    const up = i % 2 === 0;
    b.lathe(m.shellHull, [[0, 0.03], [0.0102, 0.03], [0.0102, -0.03], [0.0094, -0.033], [0, -0.033]], -0.0318, -0.046, { rx: up ? -Math.PI / 2 : Math.PI / 2, z, seg: 10 });
    b.lathe(m.brass, [[0, 0.0], [0.0108, 0.0], [0.0108, -0.012], [0.0104, -0.013], [0, -0.013]], -0.0318, up ? -0.0175 : -0.0745, { rx: up ? Math.PI / 2 : -Math.PI / 2, z, seg: 10 });
  }
  // Barrel + vent rib, magazine tube, clamp.
  barrel(k, m.blued, -0.146, -0.56, yb, 0.0125, 0.0118);
  b.box(m.steel, 0.0065, 0.0028, 0.4, 0, yb + 0.0138, -0.355, { bev: 0.0005 });
  frontPost(k, m.steel, -0.538, yb + 0.0145, m.tritiumOrange);
  b.cyl(m.blued, 0.0106, -0.15, -0.495, 0, -0.064, 16);
  b.lathe(m.steel, [[0, -0.493], [0.0118, -0.493], [0.0122, -0.497], [0.0122, -0.515], [0.0105, -0.52], [0, -0.52]], 0, -0.064, { seg: 14 });
  const clamp: P2[] = [];
  for (let i = 0; i <= 10; i++) clamp.push([Math.cos(Math.PI * (i / 10)) * 0.0142, yb + Math.sin(Math.PI * (i / 10)) * 0.0142]);
  for (let i = 0; i <= 10; i++) clamp.push([Math.cos(Math.PI + Math.PI * (i / 10)) * 0.0135, -0.064 + Math.sin(Math.PI + Math.PI * (i / 10)) * 0.0135]);
  b.section(m.steel, clamp, -0.462, -0.478, { bev: 0.0012 });
  g.muzzle.position.set(0, yb, -0.565);

  // Pump forend.
  g.pump = new THREE.Group();
  g.pump.position.set(0, 0, -0.3);
  g.root.add(g.pump);
  b.into(g.pump);
  b.section(m.wood, rrect(0.05, 0.046, 0.017, 0, -0.06, 4), 0.07, -0.07, { bev: 0.003, bevSeg: 2, seg: 4 });
  for (let i = 0; i < 7; i++) {
    for (const sx of [-1, 1]) b.box(m.polymer, 0.0016, 0.026, 0.004, sx * 0.025, -0.063, -0.05 + i * 0.016, { bev: 0.0004 });
    b.box(m.polymer, 0.026, 0.0016, 0.004, 0, -0.083, -0.05 + i * 0.016, { bev: 0.0004 });
  }
  for (const sx of [-1, 1]) b.box(m.steel, 0.003, 0.005, 0.15, sx * 0.0125, -0.05, 0.13, { bev: 0.0006 });
  g.pumpTravel = 0.08;

  b.into(g.bolt);
  b.box(m.bright, 0.0006, 0.012, 0.044, 0.0175, -0.036, -0.05, { bev: 0.0002 });
  g.boltTravel = 0;

  // "Mag": the shell carried to the loading port.
  b.into(g.mag);
  b.lathe(m.shellHull, [[0, 0.03], [0.0102, 0.03], [0.0102, -0.03], [0.0094, -0.033], [0, -0.033]], 0, 0, { seg: 12 });
  b.lathe(m.brass, [[0, 0.043], [0.0108, 0.043], [0.0108, 0.031], [0.0104, 0.03], [0, 0.03]], 0, 0, { seg: 12 });
  g.mag.position.set(0, -0.09, -0.05);
  g.magHidden = true;

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.37]));
  const leftAt: V3 = [0, -0.06, -0.318];
  b.into(g.leftArm);
  const [sp, sh] = supportOnHandguard([0, -0.06, -0.018], 0.0255, [-0.21, -0.33, 0.38]);
  buildArm(b, m, sp, sh);
  g.pump.remove(g.leftArm);
  g.pump.add(g.leftArm);
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.0115, -0.026];
  buildArm(b, m, { at: grabAt, axis: [0, 0, 1], palm: [-0.3, -1, 0], elbow: [-0.15, -0.3, 0.3], left: true, watch: true }, { r: 0.011, thumb: "up", fingers: ["wrap", [0.3, 1.0, 0.8], [0.6, 1.2, 0.9], [0.8, 1.3, 1.0]], tight: 1.1 });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.copy(g.leftRest);
  g.eject.position.set(0.018, -0.036, -0.05);
  g.ejectDir.set(1, 0.55, 0.15).normalize();
  g.shell = "shotgun";
  g.hip.set(0.14, -0.095, -0.33);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.17 - 0.045);
  g.flash = "shotgun";
  g.flashScale = 1.5;
  g.cycle = 0.6;
  g.reload = "shell";
  g.butt = new THREE.Vector3(0, -0.1, 0.34);
  return g;
}


// =============================================================================
// Benelli M4 (M1014) — gas semi-auto 12 ga: alloy receiver with a top rail and
// ghost-ring sights, collapsible stock + pistol grip, polymer forend, large
// reciprocating charging handle, shells loaded through the bottom port.
// =============================================================================
export function buildM1014(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("m1014");
  const yb = -0.036;
  b.into(g.root);

  b.profile(m.anodized, [[0.08, -0.014], [-0.15, -0.014], [-0.155, -0.02], [-0.155, -0.076], [0.0, -0.078], [0.06, -0.078], [0.08, -0.064]], 0.036, 0, { bev: 0.0022, bevSeg: 2 });
  const portC: [number, number] = [-0.055, -0.04];
  b.box(m.polymer, 0.0006, 0.02, 0.07, 0.0182, portC[1], portC[0], { bev: 0 });
  b.box(m.polymer, 0.022, 0.0008, 0.08, 0, -0.0784, -0.07, { bev: 0 });
  rail(k, m.anodized, 0.07, -0.15, -0.0062, 0.021);
  // Ghost-ring rear (protected aperture on the rail).
  const rz = 0.05;
  b.box(m.anodized, 0.03, 0.01, 0.022, 0, -0.008, rz, { bev: 0.002 });
  for (const sx of [-1, 1]) b.box(m.anodized, 0.004, 0.016, 0.018, sx * 0.012, -0.0, rz, { bev: 0.001 });
  b.add(m.steel, new THREE.TorusGeometry(0.0055, 0.0014, 6, 18), place(0, 0, rz));
  b.box(m.steel, 0.003, 0.004, 0.004, 0, -0.0072, rz, { bev: 0.0004 });
  pinX(k, m.steel, 0.0024, 0.037, 0, -0.07, 0.06);
  pinX(k, m.steel, 0.0024, 0.037, 0, -0.07, 0.02);
  triggerGroup(k, m.polymer, m.steel, 0.058, 0.008, -0.077, 0.022, 0.012);
  buttonX(k, m.bright, 0.004, 0.004, 0.0095, -0.08, 0.052);
  const grip = pistolGrip(k, m.grip, 0.074, -0.076, 0.098, 0.3, 0.035, 0.031);
  // Collapsible stock on a buffer tube.
  b.cyl(m.anodized, 0.014, 0.08, 0.26, 0, -0.038, 16);
  stock(k, m.polymer, m.rubber, 0.15, -0.022, 0.2, 0.105, 0.038);
  // Barrel (with gas cylinders), magazine tube + end cap, front sight blade.
  barrel(k, m.blued, -0.15, -0.53, yb, 0.0122, 0.0116);
  b.cyl(m.anodized, 0.0108, -0.15, -0.45, 0, -0.064, 16);
  b.lathe(m.anodized, [[0, -0.448], [0.0122, -0.448], [0.0126, -0.452], [0.0126, -0.48], [0.0105, -0.486], [0, -0.486]], 0, -0.064, { seg: 14 });
  for (const sx of [-1, 1]) b.cyl(m.steel, 0.0045, -0.2, -0.3, sx * 0.012, -0.05, 10);
  const fz = -0.505;
  b.box(m.anodized, 0.01, 0.022, 0.02, 0, yb + 0.018, fz, { bev: 0.0012 });
  for (const sx of [-1, 1]) b.box(m.anodized, 0.003, 0.014, 0.016, sx * 0.008, -0.004, fz, { bev: 0.0006 });
  b.box(m.steel, 0.0024, 0.01, 0.0024, 0, -0.005, fz, { bev: 0.0003 });
  b.add(m.tritiumOrange, new THREE.CircleGeometry(0.0009, 8), place(0, -0.0012, fz + 0.0013));
  g.muzzle.position.set(0, yb, -0.535);
  // Polymer forend (fixed, ribbed underside).
  b.section(m.polymer, rrect(0.05, 0.048, 0.016, 0, -0.056, 4), -0.16, -0.38, { bev: 0.003, bevSeg: 2, seg: 4 });
  for (let i = 0; i < 8; i++) b.box(m.polymer, 0.03, 0.002, 0.006, 0, -0.081, -0.18 - i * 0.022, { bev: 0.0005 });

  b.into(g.bolt);
  b.box(m.bright, 0.0006, 0.014, 0.05, 0.018, portC[1], portC[0], { bev: 0.0002 });
  g.boltTravel = 0.05;
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.006, 0.006, 0.014, 0.02, portC[1], portC[0] + 0.02, { bev: 0.0012 });
  b.lathe(m.steel, [[0, 0], [0.0055, 0], [0.0065, -0.004], [0.0065, -0.018], [0, -0.02]], 0.022, portC[1], { ry: -Math.PI / 2, z: portC[0] + 0.02, seg: 12 });
  g.chargeTravel = 0.05;
  g.chargeRides = true;

  b.into(g.mag);
  b.lathe(m.shellHull, [[0, 0.03], [0.0102, 0.03], [0.0102, -0.03], [0.0094, -0.033], [0, -0.033]], 0, 0, { seg: 12 });
  b.lathe(m.brass, [[0, 0.043], [0.0108, 0.043], [0.0108, 0.031], [0.0104, 0.03], [0, 0.03]], 0, 0, { seg: 12 });
  g.mag.position.set(0, -0.092, -0.05);
  g.magHidden = true;

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.37]));
  const leftAt: V3 = [0, -0.06, -0.3];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.0255, [-0.21, -0.33, 0.3]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.0115, -0.026];
  buildArm(b, m, { at: grabAt, axis: [0, 0, 1], palm: [-0.3, -1, 0], elbow: [-0.15, -0.3, 0.3], left: true, watch: true }, { r: 0.011, thumb: "up", fingers: ["wrap", [0.3, 1.0, 0.8], [0.6, 1.2, 0.9], [0.8, 1.3, 1.0]], tight: 1.1 });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.026, portC[1], portC[0] + 0.01);
  g.eject.position.set(0.019, portC[1], portC[0]);
  g.ejectDir.set(1, 0.55, 0.15).normalize();
  g.shell = "shotgun";
  g.hip.set(0.14, -0.09, -0.33);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.17 - rz);
  g.flash = "shotgun";
  g.flashScale = 1.4;
  g.cycle = 0.12;
  g.reload = "shell";
  g.butt = new THREE.Vector3(0, -0.1, 0.36);
  return g;
}
