import * as THREE from "three";
import type { P2, V3 } from "./geo";
import { buildArm } from "./hands";
import type { Surf } from "./materials";
import {
  type Kit, barrel, boxMag, buttonX, circle, flashHider, foldedIrons, holoSight, pinX, pistolGrip, prismSight, rail, redDot, rrect,
  screwY, selectorMarks, sideRail, slottedFloor, slottedPlate, stock, triggerGroup,
} from "./parts";
import { type GunSpec, boltFace, grabMag, newSpec, part, receiverWithPort, strongOnGrip, supportOnHandguard, v3 } from "./common";

type ArVariant = "m4a1" | "m16a4" | "hk416";

/** Four-sided rail handguard (RIS / quad rail) around the bore. */
export function quadRail(k: Kit, mat: Surf, z0: number, z1: number, yc: number, w: number, h: number, railTop: number) {
  const { b } = k;
  b.section(mat, rrect(w, h, 0.006, 0, yc, 3), z0, z1, { bev: 0.0012, holes: [circle(Math.min(w, h) * 0.32, 0, yc, 14)] });
  rail(k, mat, z0, z1, railTop, 0.021);
  for (const sx of [-1, 1]) sideRail(k, mat, z0 - 0.01, z1 + 0.01, sx * (w / 2 + 0.006), yc, 0.019);
  // Bottom rail: teeth hanging under the body.
  const n = Math.floor(Math.abs(z1 - z0) / 0.01) - 2;
  b.box(mat, 0.017, 0.006, Math.abs(z1 - z0) - 0.02, 0, yc - h / 2 - 0.003, (z0 + z1) / 2, { bev: 0.0006 });
  for (let i = 0; i < n; i++) b.box(mat, 0.015, 0.004, 0.0052, 0, yc - h / 2 - 0.0075, Math.max(z0, z1) - 0.015 - i * 0.01, { bev: 0 });
  // Rail-cover strips on the lower sides (ribbed polymer ladder covers).
  for (const sx of [-1, 1]) {
    for (let i = 0; i < n; i += 2) b.box(k.m.polymer, 0.004, 0.012, 0.007, sx * (w / 2 + 0.003), yc - h * 0.32, Math.max(z0, z1) - 0.02 - i * 0.01, { bev: 0.0008 });
  }
}

/** A2-style triangular front sight tower on the gas block; post tip at `tipY`. */
function frontTower(k: Kit, mat: Surf, z: number, yb: number, tipY: number) {
  const { b } = k;
  b.profile(mat, [[z + 0.022, yb - 0.012], [z - 0.022, yb - 0.012], [z - 0.008, tipY - 0.014], [z + 0.008, tipY - 0.014]], 0.012, 0, { bev: 0.0015 });
  b.lathe(mat, [[0.0125, z + 0.016], [0.0135, z + 0.012], [0.0135, z - 0.012], [0.0125, z - 0.016]], 0, yb, { seg: 16 });
  for (const sx of [-1, 1]) b.box(mat, 0.003, 0.016, 0.008, sx * 0.0095, tipY - 0.014, z, { bev: 0.0006, rz: -sx * 0.12 });
  b.box(mat, 0.0024, 0.012, 0.0028, 0, tipY - 0.006, z, { bev: 0.0004 });
  // Bayonet lug + sling swivel underneath.
  b.box(mat, 0.008, 0.008, 0.022, 0, yb - 0.018, z - 0.004, { bev: 0.0012 });
  b.add(mat, new THREE.TorusGeometry(0.007, 0.0015, 5, 12), new THREE.Matrix4().makeTranslation(0, yb - 0.028, z + 0.004));
}

/** Fixed A2 rifle stock with trapdoor and butt plate. */
function a2Stock(k: Kit, mat: Surf, z0: number, yTop: number) {
  const { b, m } = k;
  const z1 = z0 + 0.255;
  b.profile(mat, [[z0, yTop], [z1, yTop - 0.004], [z1, yTop - 0.118], [z1 - 0.06, yTop - 0.104], [z0 + 0.04, yTop - 0.052], [z0, yTop - 0.046]], 0.036, 0, { bev: 0.004, bevSeg: 2, seg: 2 });
  // Trapdoor outline + butt plate.
  b.box(m.polymer, 0.037, 0.0006, 0.06, 0, yTop - 0.03, z1 - 0.05, { bev: 0 });
  b.profile(m.steel, [[z1, yTop - 0.002], [z1 + 0.008, yTop - 0.003], [z1 + 0.008, yTop - 0.118], [z1, yTop - 0.12]], 0.038, 0, { bev: 0.002, bevSeg: 2 });
  for (let i = 0; i < 5; i++) b.box(m.polymer, 0.039, 0.002, 0.003, 0, yTop - 0.02 - i * 0.02, z1 + 0.008, { bev: 0 });
  b.add(m.steel, new THREE.TorusGeometry(0.008, 0.0018, 5, 12), new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, yTop - 0.122, z1 - 0.03));
}

/** HK-style slanted collapsible stock (E1 profile) with QD sling cups. */
function hkStock(k: Kit, mat: Surf, pad: Surf, z0: number, yTop: number) {
  const { b, m } = k;
  const len = 0.2;
  const z1 = z0 + len;
  b.profile(mat, [[z0, yTop - 0.004], [z0 + 0.06, yTop + 0.004], [z1 - 0.006, yTop + 0.006], [z1, yTop], [z1 + 0.004, yTop - 0.11], [z1 - 0.015, yTop - 0.114], [z1 - 0.07, yTop - 0.07], [z0 + 0.05, yTop - 0.05], [z0, yTop - 0.044]], 0.04, 0, { bev: 0.0045, bevSeg: 2, seg: 2, holes: [rrect(0.05, 0.022, 0.008, z1 - 0.06, yTop - 0.06, 3)] });
  b.profile(pad, [[z1, yTop + 0.002], [z1 + 0.012, yTop + 0.002], [z1 + 0.016, yTop - 0.112], [z1 + 0.004, yTop - 0.114]], 0.042, 0, { bev: 0.003, bevSeg: 2 });
  for (const sx of [-1, 1]) b.lathe(m.steel, [[0, 0], [0.0055, 0], [0.0055, -0.003], [0.003, -0.004], [0, -0.004]], sx * 0.021, yTop - 0.03, { ry: sx * Math.PI / 2, z: z1 - 0.02, seg: 12 });
}

export function buildAR(k: Kit, variant: ArVariant): GunSpec {
  const { b, m } = k;
  const g = newSpec(variant);
  const yb = -0.06;
  const railTop = -0.034;
  const furn = variant === "m4a1" ? m.polymerTan : m.polymer;
  const gripMat = variant === "m4a1" ? m.gripTan : m.grip;
  // M16A4: 20" barrel; muzzle ~0.55 m ahead of the magazine as on the real rifle.
  const barrelEnd = variant === "m16a4" ? -0.54 : variant === "hk416" ? -0.43 : -0.505;
  const hgEnd = variant === "m16a4" ? -0.39 : variant === "hk416" ? -0.37 : -0.4;
  b.into(g.root);

  // Upper receiver with ejection port, forward assist, open dust cover.
  const upper: P2[] = [[0.072, -0.0415], [-0.118, -0.0415], [-0.118, -0.081], [-0.02, -0.081], [0.0, -0.083], [0.062, -0.083], [0.072, -0.074]];
  const portC: [number, number] = [-0.032, -0.06];
  const inner = receiverWithPort(k, m.anodized, upper, -0.0155, 0.0155, rrect(0.05, 0.016, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  b.box(m.anodized, 0.0012, 0.016, 0.05, 0.0215, -0.0745, portC[0], { rz: -2.3, bev: 0.0003 });
  if (variant !== "hk416") {
    // Forward assist plunger + brass deflector.
    b.cyl(m.steel, 0.0055, -0.014, 0.014, 0.0175, -0.06, 12, { ry: -0.45, z: 0.046 });
    b.cyl(m.steel, 0.0068, -0.003, 0.003, 0.0228, -0.06, 12, { ry: -0.45, z: 0.034 });
  } else {
    // HK upper: flat forward assist-less side, piston housing bulge at the front.
    b.box(m.anodized, 0.004, 0.022, 0.06, 0.0175, -0.062, 0.035, { bev: 0.0012 });
  }
  b.box(m.anodized, 0.007, 0.012, 0.012, 0.0185, -0.052, 0.006, { bev: 0.0015 });
  rail(k, m.anodized, 0.072, -0.118, railTop);
  // Lower receiver: mag well with flare, fire controls.
  b.profile(m.anodized, [
    [0.068, -0.0812], [0.068, -0.096], [0.058, -0.104], [0.046, -0.106], [-0.009, -0.106], [-0.012, -0.122], [-0.016, -0.126],
    [-0.088, -0.126], [-0.092, -0.121], [-0.09, -0.104], [-0.1, -0.094], [-0.115, -0.09], [-0.115, -0.0812],
  ], 0.029, 0, { bev: 0.0016 });
  b.box(m.anodized, 0.033, 0.006, 0.08, 0, -0.123, -0.052, { bev: 0.002 });
  for (const sx of [-1, 1]) b.box(m.anodized, 0.002, 0.03, 0.06, sx * 0.0148, -0.104, -0.052, { bev: 0.0006 });
  buttonX(k, m.steel, 0.0045, 0.003, 0.0158, -0.097, -0.006);
  b.box(m.steel, 0.003, 0.012, 0.02, -0.0158, -0.091, -0.004, { rx: 0.3, bev: 0.0008 });
  b.box(m.steel, 0.003, 0.005, 0.022, -0.0162, -0.089, 0.05, { rx: -0.5, bev: 0.0008 });
  buttonX(k, m.steel, 0.006, 0.002, -0.0147, -0.089, 0.05);
  pinX(k, m.steel, 0.0026, 0.0305, 0, -0.085, 0.062);
  pinX(k, m.steel, 0.0026, 0.0305, 0, -0.085, -0.108);
  triggerGroup(k, m.anodized, m.steel, 0.048, -0.008, -0.105, 0.022, 0.011);
  selectorMarks(k, -0.0146, -0.089, 0.05);
  for (const z of [-0.06, -0.2]) screwY(k, 0, -0.0864, z, 0.0016, true);
  const grip = pistolGrip(k, gripMat, 0.066, -0.104, 0.096, 0.33, 0.034, 0.03);
  // Buffer tube + stock.
  if (variant === "m16a4") {
    a2Stock(k, furn, 0.068, -0.04);
  } else {
    b.cyl(m.anodized, 0.0145, 0.065, 0.27, 0, yb, 16);
    b.lathe(m.steel, [[0.0145, 0.07], [0.018, 0.07], [0.018, 0.08], [0.0145, 0.08]], 0, yb, { seg: 12 });
    b.box(m.steel, 0.03, 0.03, 0.004, 0, yb - 0.004, 0.068, { bev: 0.001 });
    if (variant === "hk416") hkStock(k, furn, m.rubber, 0.16, -0.043);
    else stock(k, furn, m.rubber, 0.17, -0.043, 0.175, 0.095, 0.036);
  }

  // Handguard.
  if (variant === "m4a1") {
    for (const sx of [-1, 1]) {
      slottedPlate(k, m.anodized, -0.12, hgEnd, -0.08, -0.044, sx * 0.0175, 0.004, 4);
      b.box(m.anodized, 0.0055, 0.0055, 0.28, sx * 0.0158, -0.0812, -0.26, { rz: Math.PI / 4, bev: 0.0008 });
      b.box(m.anodized, 0.0045, 0.0045, 0.28, sx * 0.0172, -0.0436, -0.26, { rz: Math.PI / 4, bev: 0.0008 });
    }
    slottedFloor(k, m.anodized, -0.12, hgEnd, 0.031, -0.084, 0.004, 4);
    b.section(m.anodized, rrect(0.037, 0.004, 0, 0, -0.0428), -0.12, hgEnd, { bev: 0.0008 });
    rail(k, m.anodized, -0.118, hgEnd, railTop);
    b.section(m.anodized, rrect(0.04, 0.044, 0.008, 0, -0.062, 3), hgEnd + 0.004, hgEnd - 0.003, { bev: 0.0012, holes: [circle(0.0106, 0, yb, 14)] });
  } else {
    quadRail(k, m.anodized, -0.118, hgEnd, yb, 0.036, 0.04, railTop);
  }
  b.lathe(m.steel, [[0.0098, -0.112], [0.019, -0.112], [0.019, -0.122], [0.0098, -0.122]], 0, yb, { seg: 16 });
  // Barrel, gas block / front sight, muzzle device.
  barrel(k, m.blued, -0.115, barrelEnd, yb, 0.0098, 0.0083);
  if (variant === "m16a4") {
    frontTower(k, m.steel, -0.41, yb, -0.014);
    b.cyl(m.steel, 0.0026, -0.4, -0.12, 0, yb + 0.013, 8);
    flashHider(k, m.steel, barrelEnd, yb, 0.0108, 0.056);
    g.muzzle.position.set(0, yb, barrelEnd - 0.06);
  } else if (variant === "hk416") {
    // Piston: no gas tube; fixed front sight folds flat on the rail end.
    b.box(m.steel, 0.022, 0.028, 0.024, 0, yb + 0.002, hgEnd - 0.016, { bev: 0.0015 });
    flashHider(k, m.steel, barrelEnd, yb, 0.0112, 0.05);
    g.muzzle.position.set(0, yb, barrelEnd - 0.055);
  } else {
    b.box(m.steel, 0.022, 0.024, 0.02, 0, yb + 0.002, -0.3, { bev: 0.0015 });
    b.cyl(m.steel, 0.0026, -0.29, -0.12, 0, yb + 0.013, 8);
    flashHider(k, m.steel, barrelEnd, yb, 0.0108, 0.052);
    g.muzzle.position.set(0, yb, barrelEnd - 0.056);
  }
  // Vertical grip on the HK, angled one on the A4.
  if (variant === "hk416") {
    const vgZ = -0.27;
    b.lathe(m.polymer, [[0, 0], [0.0125, 0], [0.0135, -0.006], [0.0128, -0.075], [0.0115, -0.082], [0, -0.083]], 0, yb - 0.028, { rx: -Math.PI / 2, z: vgZ, seg: 12 });
  }

  // Optic.
  let eye = 0;
  let relief = 0.165;
  if (variant === "m4a1") {
    foldedIrons(k, 0.05, hgEnd + 0.015, railTop);
    eye = redDot(k, -0.025, railTop).eye;
  } else if (variant === "m16a4") {
    eye = prismSight(k, 0.0, railTop).eye;
    relief = 0.11;
  } else {
    foldedIrons(k, 0.055, hgEnd + 0.012, railTop);
    eye = holoSight(k, -0.03, railTop).eye;
    relief = 0.155;
  }

  // Moving parts.
  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.012, 0.034);
  b.box(m.steel, 0.0009, 0.004, 0.012, inner + 0.0009, portC[1] + 0.002, portC[0] - 0.006, { bev: 0.0002 });
  g.boltTravel = 0.03;
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.anodized, 0.012, 0.007, 0.024, 0, -0.0455, 0.07, { bev: 0.0012 });
  b.box(m.anodized, 0.036, 0.008, 0.009, 0, -0.0455, 0.08, { bev: 0.0018, seg: 2 });
  b.box(m.steel, 0.006, 0.004, 0.012, -0.012, -0.041, 0.077, { bev: 0.0008 });
  g.chargeTravel = 0.055;

  b.into(g.mag);
  // STANAG: aluminium (A4) or polymer (M4 tan / HK steel-grey).
  const magMat = variant === "m16a4" ? m.anodized : variant === "hk416" ? m.steel : m.polymerTan;
  boxMag(k, magMat, 0.062, 0.172, 0.04, 0.0215, { ribs: variant !== "hk416", rounds: m.brass, plate: magMat });
  g.mag.position.set(0, -0.088, -0.051);

  // Arms.
  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftZ = variant === "m16a4" ? -0.33 : variant === "hk416" ? -0.27 : -0.285;
  const leftAt: V3 = variant === "hk416" ? [0, yb - 0.04, leftZ] : [0, yb, leftZ];
  b.into(g.leftArm);
  if (variant === "hk416") {
    buildArm(b, m, { at: leftAt, axis: [0, -1, 0.1], palm: [-0.8, 0, 0.6], elbow: [-0.28, -0.3, 0.22], left: true, watch: true }, { r: 0.0135, thumb: "wrap", fingers: ["wrap", "wrap", "wrap", "wrap"] });
  } else buildArm(b, m, ...supportOnHandguard(leftAt, variant === "m16a4" ? 0.027 : 0.024, [-0.25, -0.3, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.06, -0.006];
  buildArm(b, m, ...grabMag(grabAt, 0.024));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.02, -0.092, -0.004);
  g.eject.position.set(0.017, portC[1], portC[0]);
  g.ejectDir.set(1, 0.38, 0.3).normalize();
  g.hip.set(0.14, -0.075, variant === "m16a4" ? -0.34 : -0.32);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -relief - eye);
  g.flash = "hider";
  g.flashScale = variant === "hk416" ? 1.05 : 0.95;
  g.cycle = 0.08;
  g.locksBack = true;
  g.butt = new THREE.Vector3(0, -0.09, 0.36);
  return g;
}
