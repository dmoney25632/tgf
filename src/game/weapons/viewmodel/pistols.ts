import * as THREE from "three";
import { type P2, type V3, circle, extrude, rrect, shape, slot, place } from "./geo";
import { buildArm } from "./hands";
import {
  type Kit, buttonX, pinX, pistolGrip, screwX, triggerGroup, 
} from "./parts";
import { type GunSpec, newSpec, part, strongOnGrip } from "./common";

// =============================================================================
// Service pistols, one parametric builder:
//   g17   — Glock 17: polymer frame with accessory rail, squared slide, striker.
//   m9    — Beretta M9: alloy frame, open-top slide with exposed barrel,
//           slide-mounted decocker, exposed hammer.
//   m1911 — Colt M1911A1: all-steel single stack, walnut grips, grip safety,
//           thumb safety, spur hammer, rear serrations only.
// =============================================================================
export type PistolVariant = "g17" | "m9" | "m1911";

export function buildPistol(k: Kit, v: PistolVariant): GunSpec {
  const { b, m } = k;
  const g = newSpec(v);
  const yb = -0.018;
  const frameMat = v === "g17" ? m.polymer : v === "m9" ? m.anodized : m.blued;
  const gripMat = v === "g17" ? m.grip : v === "m9" ? m.polymer : m.wood;
  const slideMat = v === "g17" ? m.cerakoteDark : m.blued;
  const thick = v === "m1911" ? 0.0215 : 0.023;
  const rake = v === "g17" ? 0.36 : v === "m9" ? 0.3 : 0.3;
  b.into(g.root);

  // Frame: dust cover, trigger guard, grip.
  b.profile(frameMat, [[0.035, -0.029], [-0.14, -0.029], [-0.14, -0.044], [-0.13, -0.047], [-0.046, -0.047], [-0.03, -0.045], [0.026, -0.045], [0.043, -0.034], [0.043, -0.029]], thick, 0, { bev: 0.0022, bevSeg: 2 });
  if (v === "g17") for (let i = 0; i < 3; i++) b.box(frameMat, 0.016, 0.003, 0.0055, 0, -0.0485, -0.085 - i * 0.012, { bev: 0.0006 });
  triggerGroup(k, frameMat, v === "g17" ? m.polymer : m.steel, 0.004, -0.044, -0.045, 0.024, 0.0115);
  const grip = pistolGrip(k, gripMat, 0.022, -0.045, v === "m1911" ? 0.09 : 0.094, rake, 0.036, v === "m1911" ? 0.027 : 0.0285);
  if (v !== "g17") {
    // Grip panels: checkered walnut / ribbed polymer over a steel/alloy frame strap.
    b.profile(frameMat, [[0.03, -0.047], [0.03 + Math.sin(rake) * 0.09, -0.047 - Math.cos(rake) * 0.09], [0.012 + Math.sin(rake) * 0.09, -0.047 - Math.cos(rake) * 0.09], [0.012, -0.047]], thick - 0.006, 0, { bev: 0.001 });
    for (const sx of [-1, 1]) screwX(k, sx * ((v === "m1911" ? 0.027 : 0.0285) / 2 + 0.0004), -0.07, 0.03, 0.0022);
  }
  // Beavertail / grip safety.
  b.box(v === "m1911" ? m.blued : frameMat, 0.02, 0.006, 0.014, 0, -0.04, 0.046, { bev: 0.0025, rx: -0.3 });
  if (v === "m1911") {
    b.box(m.blued, 0.016, 0.03, 0.008, 0, -0.058, 0.044, { rx: -rake, bev: 0.002 });
    b.box(m.blued, 0.003, 0.005, 0.016, -0.0122, -0.031, 0.026, { bev: 0.0006 });
  }
  b.box(m.steel, 0.002, 0.004, 0.02, -0.0125, -0.0315, -0.018, { bev: 0.0005 });
  b.box(m.steel, 0.002, 0.003, 0.012, -0.0122, -0.035, -0.045, { bev: 0.0005 });
  buttonX(k, v === "g17" ? m.polymer : m.steel, 0.004, 0.003, -0.0118, -0.051, 0.006);
  // Hammer (exposed on M9 / 1911).
  if (v !== "g17") {
    g.hammer = part(g, [0, -0.03, 0.038]);
    b.into(g.hammer);
    b.profile(m.blued, [[-0.003, -0.004], [0.002, 0.008], [0.009, 0.016], [0.015, 0.016], [0.014, 0.011], [0.006, 0.004], [0.004, -0.006]], 0.0065, 0, { bev: 0.0007 });
    b.into(g.root);
  }
  // Barrel crown + recoil spring guide tip at the muzzle.
  b.lathe(m.blued, [[0.0044, -0.143], [0.0068, -0.143], [0.0068, -0.149], [0.0044, -0.149]], 0, yb, { seg: 14 });
  b.add(m.polymer, new THREE.CircleGeometry(0.0045, 12), place(0, yb, -0.1485, { ry: Math.PI }));
  b.cyl(m.steel, 0.0032, -0.144, -0.12, 0, -0.037, 10);
  if (v === "m9") b.cyl(m.bright, 0.0068, -0.03, -0.143, 0, yb, 16);
  g.muzzle.position.set(0, yb, -0.152);

  // Slide (moves): serrations, port, sights.
  b.into(g.bolt);
  if (v === "m9") {
    // Open top: full slide at the rear, low twin rails along the barrel at the front.
    b.profile(slideMat, [[0.036, -0.004], [-0.03, -0.004], [-0.04, -0.016], [-0.143, -0.016], [-0.143, -0.03], [0.036, -0.03], [0.04, -0.026], [0.04, -0.009]], 0.024, 0, { bev: 0.0022, bevSeg: 2 });
    b.profile(slideMat, [[-0.06, -0.013], [-0.143, -0.013], [-0.143, -0.006], [-0.135, -0.006]], 0.006, 0, { bev: 0.001 });
    for (const sx of [-1, 1]) b.box(m.steel, 0.006, 0.006, 0.01, sx * 0.0125, -0.008, 0.026, { rx: 0.2, bev: 0.0012 });
  } else {
    b.profile(slideMat, [[0.036, -0.004], [-0.138, -0.004], [-0.143, -0.008], [-0.143, -0.03], [0.036, -0.03], [0.04, -0.026], [0.04, -0.009]], v === "m1911" ? 0.022 : 0.024, 0, { bev: v === "m1911" ? 0.003 : 0.0022, bevSeg: 2 });
  }
  const sx0 = v === "m1911" ? 0.0111 : 0.0121;
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) b.box(m.polymer, 0.0005, 0.02, 0.0014, sx * sx0, -0.018, 0.031 - i * 0.003, { bev: 0 });
  if (v === "g17") for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) b.box(m.polymer, 0.0005, 0.016, 0.0014, sx * sx0, -0.019, -0.112 - i * 0.003, { bev: 0 });
  if (v !== "m9") {
    b.box(m.polymer, 0.011, 0.0008, 0.04, 0.0045, -0.0038, -0.037, { bev: 0 });
    b.box(m.blued, 0.0095, 0.0006, 0.034, 0.0045, -0.0033, -0.038, { bev: 0 });
  }
  const dots = v === "m1911" ? m.paint : m.tritium;
  for (const sx of [-1, 1]) {
    b.box(m.steel, 0.0078, 0.006, 0.008, sx * 0.0058, -0.003, 0.031, { bev: 0.0006 });
    if (v !== "m1911") b.add(dots, new THREE.CircleGeometry(0.0011, 8), place(sx * 0.0058, -0.0032, 0.0352));
  }
  b.box(m.steel, 0.0034, 0.0058, 0.006, 0, -0.0029, -0.13, { bev: 0.0005 });
  b.add(dots, new THREE.CircleGeometry(0.0011, 8), place(0, -0.0022, -0.1268));
  g.boltTravel = v === "m1911" ? 0.024 : 0.022;

  // Magazine (origin at the bottom of the grip, body up the grip axis).
  b.into(g.mag);
  b.box(m.steel, v === "m1911" ? 0.018 : 0.022, 0.09, 0.03, 0, 0.047, 0.001, { bev: 0.0015 });
  b.box(v === "m1911" ? m.steel : m.polymer, 0.026, 0.008, 0.037, 0, 0.001, 0.002, { bev: 0.002, seg: 2 });
  b.lathe(m.brass, [[0, 0.01], [v === "m1911" ? 0.0058 : 0.0048, 0.01], [v === "m1911" ? 0.0058 : 0.0048, -0.006], [0.0035, -0.01], [0, -0.012]], 0, 0.094, { seg: 8 });
  const gl = v === "m1911" ? 0.09 : 0.094;
  g.mag.position.set(0, -0.045 - Math.cos(rake) * gl, 0.022 + Math.sin(rake) * gl);
  g.mag.rotation.x = -rake;

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.09, -0.25, 0.38], 0.0175, "forward"));
  b.into(g.leftArm);
  buildArm(b, m, { at: [-0.002, -0.06, 0.02], axis: grip.axis, palm: [-1, 0, 0.25], elbow: [-0.1, -0.27, 0.34], left: true, watch: true }, { r: 0.031, thumb: "forward", thumbDir: [0.12, -0.12, -1], tight: 0.92 });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, 0.03, 0.0];
  buildArm(b, m, { at: grabAt, axis: [0, -1, 0], palm: [-1, 0, 0.3], elbow: [-0.15, -0.3, 0.2], left: true, watch: true }, { r: 0.016, thumb: "wrap" });

  g.leftRest.set(-0.002, -0.06, 0.02);
  g.leftReach.set(0, -0.085, 0.07);
  g.boltHand.set(-0.004, -0.02, 0.03);
  g.eject.position.set(0.01, -0.006, -0.037);
  g.ejectDir.set(0.85, 0.85, 0.25).normalize();
  g.shell = v === "m1911" ? "acp" : "pistol";
  g.hip.set(0.07, -0.062, -0.27);
  g.hipRot.set(0.0, 0.04, 0.02);
  g.ads.set(0, 0, -0.27);
  g.handgun = true;
  g.flash = "pistol";
  g.flashScale = v === "m1911" ? 0.85 : 0.7;
  g.reload = "pistol";
  g.locksBack = true;
  return g;
}

// =============================================================================
// Smith & Wesson 629 — stainless .44 Magnum double-action revolver, full-lug
// barrel, swing-out crane, speedloader reloads.
// =============================================================================
export function buildSw629(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("sw629");
  const yb = -0.028;
  const cylY = -0.0445;
  const cylZ = -0.022;
  b.into(g.root);

  // Frame with the cylinder window.
  b.profile(m.stainless, [
    [0.042, -0.004], [-0.052, -0.004], [-0.056, -0.01], [-0.056, -0.078], [-0.02, -0.08], [0.012, -0.08], [0.03, -0.07], [0.046, -0.05], [0.048, -0.02],
  ], 0.026, 0, { bev: 0.0022, bevSeg: 2, holes: [rrect(0.055, 0.057, 0.006, cylZ + 0.0005, cylY, 3)] });
  for (const sx of [-1, 1]) b.box(m.steel, 0.0068, 0.0045, 0.009, sx * 0.0055, -0.00225, 0.034, { bev: 0.0005 });
  b.box(m.steel, 0.009, 0.004, 0.012, -0.0138, -0.03, 0.014, { bev: 0.0012 });
  pinX(k, m.steel, 0.0022, 0.027, 0, -0.03, 0.03);
  triggerGroup(k, m.stainless, m.steel, 0.012, -0.03, -0.079, 0.022, 0.0105);
  const grip = pistolGrip(k, m.wood, 0.034, -0.072, 0.098, 0.42, 0.038, 0.034);
  // Full-lug barrel, vent rib, ramp front sight, crown.
  b.profile(m.stainless, [[-0.052, -0.006], [-0.214, -0.006], [-0.217, -0.009], [-0.217, -0.05], [-0.21, -0.054], [-0.075, -0.054], [-0.06, -0.047], [-0.054, -0.047]], 0.024, 0, { bev: 0.0025, bevSeg: 2 });
  const vents: P2[][] = [];
  for (let i = 0; i < 5; i++) vents.push(slot(0.018, 0.0028, -0.078 - i * 0.026, -0.0035, 2));
  b.profile(m.stainless, [[-0.052, -0.0008], [-0.205, -0.0008], [-0.205, -0.0065], [-0.052, -0.0065]], 0.009, 0, { bev: 0.0006, holes: vents });
  b.profile(m.steel, [[-0.186, -0.001], [-0.206, -0.001], [-0.206, 0.0], [-0.197, 0.0]], 0.0034, 0, { bev: 0.0003 });
  b.add(m.reticleRed, new THREE.PlaneGeometry(0.003, 0.0009), place(0, -0.0004, -0.1965, { rx: -0.1 }));
  b.lathe(m.stainless, [[0.0068, -0.2165], [0.0106, -0.2165], [0.0106, -0.219], [0.0068, -0.219]], 0, yb, { seg: 16 });
  b.add(m.polymer, new THREE.CircleGeometry(0.0068, 14), place(0, yb, -0.2175, { ry: Math.PI }));
  g.muzzle.position.set(0, yb, -0.222);

  // Hammer.
  g.hammer = new THREE.Group();
  g.hammer.position.set(0, -0.02, 0.036);
  g.root.add(g.hammer);
  b.into(g.hammer);
  b.profile(m.steel, [[-0.004, -0.006], [0.004, 0.006], [0.012, 0.018], [0.022, 0.022], [0.024, 0.017], [0.012, 0.006], [0.006, -0.008]], 0.0075, 0, { bev: 0.0008 });

  // Crane + cylinder (swings out to the left about the crane pin).
  g.crane = new THREE.Group();
  g.crane.position.set(-0.009, -0.074, 0);
  g.root.add(g.crane);
  g.cylinder = new THREE.Group();
  g.cylinder.position.set(0.009, cylY + 0.074, cylZ);
  g.crane.add(g.cylinder);
  b.into(g.crane);
  b.box(m.stainless, 0.012, 0.03, 0.008, 0.004, 0.014, -0.051, { bev: 0.0015 });
  b.cyl(m.steel, 0.003, -0.05, -0.105, 0.009, 0.0295, 10);
  b.lathe(m.steel, [[0, -0.103], [0.0045, -0.103], [0.0045, -0.112], [0, -0.112]], 0.009, 0.0295, { seg: 10 });
  b.into(g.cylinder);
  const R = 0.0255;
  const outline: P2[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const f = Math.pow(Math.max(0, Math.cos(6 * (a - Math.PI / 2 - Math.PI / 6))), 10);
    const rr = R - 0.0034 * f;
    outline.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const chambers: P2[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    chambers.push(circle(0.0067, Math.cos(a) * 0.0165, Math.sin(a) * 0.0165, 12));
  }
  b.add(m.stainless, extrude(shape(outline, chambers), 0.05, { bev: 0.0016 }));
  b.cyl(m.bright, 0.0055, 0.024, 0.0262, 0, 0, 12);
  g.rounds = new THREE.Group();
  g.cylinder.add(g.rounds);
  b.into(g.rounds);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.cos(a) * 0.0165;
    const y = Math.sin(a) * 0.0165;
    b.lathe(m.brass, [[0, 0.0262], [0.0074, 0.0262], [0.0074, 0.0238], [0.0066, 0.0236], [0.0066, 0.02], [0, 0.02]], x, y, { seg: 10 });
    b.lathe(m.copper, [[0, -0.018], [0.0062, -0.018], [0.0062, -0.022], [0.004, -0.0235], [0, -0.0238]], x, y, { seg: 10 });
  }

  // Speedloader (the "mag"): knob + six rounds in the chamber pattern.
  b.into(g.mag);
  b.lathe(m.polymer, [[0, 0.03], [0.012, 0.03], [0.013, 0.024], [0.008, 0.02], [0.008, 0.012], [0.024, 0.01], [0.024, 0.0], [0, 0.0]], 0, 0, { seg: 14 });
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    b.lathe(m.brass, [[0, 0.002], [0.0074, 0.002], [0.0066, -0.001], [0.0066, -0.034], [0.0058, -0.037], [0.0058, -0.042], [0.003, -0.048], [0, -0.049]], Math.cos(a) * 0.0165, Math.sin(a) * 0.0165, { seg: 8 });
  }
  // Docked behind the swung-out cylinder (crane at 1.2 rad).
  g.mag.position.set(-0.0332, -0.0549, 0.003);
  g.magHidden = true;

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.09, -0.25, 0.38], 0.019, "forward"));
  b.into(g.leftArm);
  buildArm(b, m, { at: [-0.002, -0.084, 0.034], axis: grip.axis, palm: [-1, 0, 0.25], elbow: [-0.1, -0.27, 0.34], left: true, watch: true }, { r: 0.033, thumb: "forward", thumbDir: [0.12, -0.12, -1], tight: 0.92 });
  b.into(g.leftGrab);
  buildArm(b, m, { at: [0, 0.0, 0.032], axis: [0, -0.2, 1], palm: [0, -1, 0], elbow: [-0.15, -0.3, 0.25], left: true, watch: true }, { r: 0.014, thumb: "up", tight: 1.1 });

  g.leftRest.set(-0.002, -0.084, 0.034);
  g.leftReach.set(-0.045, 0.02, 0.03);
  g.boltHand.set(-0.03, -0.05, -0.02);
  g.eject.position.set(0, cylY, cylZ + 0.025);
  g.ejectDir.set(-0.3, 0.2, 1).normalize();
  g.shell = null;
  g.hip.set(0.07, -0.062, -0.29);
  g.hipRot.set(0.0, 0.04, 0.02);
  g.ads.set(0, 0, -0.29);
  g.handgun = true;
  g.flash = "revolver";
  g.flashScale = 1.1;
  g.reload = "revolver";
  return g;
}

