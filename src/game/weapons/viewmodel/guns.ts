import * as THREE from "three";
import type { ViewModelKind } from "../weapons";
import { type P2, type V3, circle, extrude, latheZ, place, rrect, shape, slot } from "./geo";
import { type ArmPlacement, type HandPose, buildArm } from "./hands";
import type { Surf } from "./materials";
import {
  type Kit, apertureRear, barrel, boxMag, buttonX, flashHider, foldedIrons, frontPost, holoSight, muzzleBrake, pinX,
  pistolGrip, prismSight, rail, redDot, rifleScope, slottedFloor, slottedPlate, stock, triggerGroup,
} from "./parts";

import type { ShellKind } from "../../effects/Shells";

export type { ShellKind };
export type FlashStyle = "brake" | "hider" | "shotgun" | "pistol" | "revolver";
export type ReloadStyle = "mag" | "shell" | "revolver" | "box" | "pistol";

/**
 * One first-person weapon: static parts merged per material in `root`,
 * moving parts in their own groups, plus the anchor points the viewmodel
 * animator needs.
 */
export type GunSpec = {
  kind: ViewModelKind;
  root: THREE.Group;
  /** Magazine / speedloader / held shell — moves during reload. */
  mag: THREE.Group;
  /** Reciprocating bolt carrier or pistol slide (+Z = back). */
  bolt: THREE.Group;
  boltTravel: number;
  /** Charging handle (rifles) — pulled on empty reloads. */
  charge?: THREE.Group;
  chargeTravel?: number;
  pump?: THREE.Group;
  pumpTravel?: number;
  /** Revolver: crane (swings out) → cylinder (spins) → loaded rounds. */
  crane?: THREE.Group;
  cylinder?: THREE.Group;
  rounds?: THREE.Group;
  /** LMG feed cover (hinged at the rear, rotates about X). */
  cover?: THREE.Group;
  hammer?: THREE.Group;
  /** Support arm (on the handguard / pump / wrapped over the strong hand). */
  leftArm: THREE.Group;
  /** Support arm holding the magazine (child of `mag`). */
  leftGrab: THREE.Group;
  /** Translation that brings the support hand to the magazine grab point. */
  leftReach: THREE.Vector3;
  /** Gun-space point of the support hand at rest (for charging / slide racking). */
  leftRest: THREE.Vector3;
  /** Gun-space point the support hand goes to on empty reloads. */
  boltHand: THREE.Vector3;
  muzzle: THREE.Object3D;
  /** Ejection port; brass leaves along `ejectDir` (gun space). */
  eject: THREE.Object3D;
  ejectDir: THREE.Vector3;
  shell: ShellKind | null;
  hip: THREE.Vector3;
  /** Hip-fire orientation (rad): slight inward yaw + cant so the side of the gun reads. */
  hipRot: THREE.Vector3;
  ads: THREE.Vector3;
  handgun: boolean;
  scope: boolean;
  /** Pump / bolt cycle duration after a shot. */
  cycle: number;
  flash: FlashStyle;
  /** Flash size multiplier. */
  flashScale: number;
  reload: ReloadStyle;
  /** Mag is only shown while reloading (held shell, speedloader). */
  magHidden?: boolean;
};

const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

function newSpec(kind: ViewModelKind): GunSpec {
  const root = new THREE.Group();
  root.name = kind;
  const mag = new THREE.Group();
  const bolt = new THREE.Group();
  const leftArm = new THREE.Group();
  const leftGrab = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const eject = new THREE.Object3D();
  root.add(mag, bolt, leftArm, muzzle, eject);
  mag.add(leftGrab);
  leftGrab.visible = false;
  return {
    kind, root, mag, bolt, boltTravel: 0.03, leftArm, leftGrab, leftReach: new THREE.Vector3(), leftRest: new THREE.Vector3(), boltHand: new THREE.Vector3(),
    muzzle, eject, ejectDir: new THREE.Vector3(1, 0.4, 0.2).normalize(), shell: "rifle",
    hip: new THREE.Vector3(), hipRot: new THREE.Vector3(0.01, 0.05, 0.035), ads: new THREE.Vector3(), handgun: false, scope: false, cycle: 0.2, flash: "brake", flashScale: 1, reload: "mag",
  };
}

/** Support-hand placement on a handguard of radius r around the bore. */
function supportOnHandguard(at: V3, r: number, elbow: V3): [ArmPlacement, HandPose] {
  return [
    { at, axis: [0, 0, 1], palm: [-0.4, -0.92, 0], elbow, left: true, watch: true },
    { r, thumb: "forward", phi0: -62, fingers: ["wrap", "wrap", "wrap", "wrap"], tight: 0.8 },
  ];
}

/** Strong hand on a pistol grip; index finger on the trigger. */
function strongOnGrip(top: V3, axis: V3, elbow: V3, r = 0.0175, thumb: HandPose["thumb"] = "wrap"): [ArmPlacement, HandPose] {
  return [
    { at: [top[0], top[1] - 0.004, top[2]], axis, palm: [0.42, 0, 1], elbow },
    { r, fingers: [[0.15, 1.05, 0.75], "wrap", "wrap", "wrap"], thumb, thumbDir: thumb === "forward" ? [-0.06, -0.08, -1] : undefined, phi0: -62 },
  ];
}

/** Split receiver: solid left body + right skin with an ejection-port window. */
function receiverWithPort(k: Kit, mat: Surf, pts: P2[], xl: number, xr: number, port: P2[]) {
  const skin = 0.006;
  const inner = xr - skin;
  k.b.profile(mat, pts, inner - xl, (xl + inner) / 2, { bev: 0.0015 });
  k.b.profile(mat, pts, skin, inner + skin / 2, { bev: 0.0009, holes: [port] });
  return inner;
}

// =============================================================================
// VK-7 Carbine — flat-top carbine, M-LOK-style rail, tube red dot.
// =============================================================================
function buildRifle(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("rifle");
  const yb = -0.06;
  const railTop = -0.034;
  b.into(g.root);

  // Upper receiver with ejection port, forward assist, open dust cover.
  const upper: P2[] = [[0.072, -0.0415], [-0.118, -0.0415], [-0.118, -0.081], [-0.02, -0.081], [0.0, -0.083], [0.062, -0.083], [0.072, -0.074]];
  const portC: [number, number] = [-0.032, -0.06];
  const inner = receiverWithPort(k, m.anodized, upper, -0.0155, 0.0155, rrect(0.05, 0.016, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.016, 0.05, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  b.box(m.anodized, 0.0012, 0.016, 0.05, 0.0215, -0.0745, portC[0], { rz: -2.3, bev: 0.0003 });
  b.cyl(m.steel, 0.0055, -0.014, 0.014, 0.0175, -0.06, 12, { ry: -0.45, z: 0.046 });
  b.cyl(m.steel, 0.0068, -0.003, 0.003, 0.0228, -0.06, 12, { ry: -0.45, z: 0.034 });
  rail(k, m.anodized, 0.072, -0.4, railTop);
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
  const grip = pistolGrip(k, m.gripTan, 0.066, -0.104, 0.096, 0.33, 0.034, 0.03);
  // Buffer tube, castle nut, stock.
  b.cyl(m.anodized, 0.0145, 0.065, 0.27, 0, yb, 16);
  b.lathe(m.steel, [[0.0145, 0.07], [0.018, 0.07], [0.018, 0.08], [0.0145, 0.08]], 0, yb, { seg: 12 });
  b.box(m.steel, 0.03, 0.03, 0.004, 0, yb - 0.004, 0.068, { bev: 0.001 });
  stock(k, m.polymerTan, m.rubber, 0.17, -0.043, 0.175, 0.095, 0.036);
  // Handguard: slotted side plates, slotted floor, top deck, chamfer strips, end cap.
  for (const sx of [-1, 1]) {
    slottedPlate(k, m.anodized, -0.12, -0.4, -0.08, -0.044, sx * 0.0175, 0.004, 4);
    b.box(m.anodized, 0.0055, 0.0055, 0.28, sx * 0.0158, -0.0812, -0.26, { rz: Math.PI / 4, bev: 0.0008 });
    b.box(m.anodized, 0.0045, 0.0045, 0.28, sx * 0.0172, -0.0436, -0.26, { rz: Math.PI / 4, bev: 0.0008 });
  }
  slottedFloor(k, m.anodized, -0.12, -0.4, 0.031, -0.084, 0.004, 4);
  b.section(m.anodized, rrect(0.037, 0.004, 0, 0, -0.0428), -0.12, -0.4, { bev: 0.0008 });
  b.section(m.anodized, rrect(0.04, 0.044, 0.008, 0, -0.062, 3), -0.396, -0.403, { bev: 0.0012, holes: [circle(0.0106, 0, yb, 14)] });
  b.lathe(m.steel, [[0.0098, -0.112], [0.019, -0.112], [0.019, -0.122], [0.0098, -0.122]], 0, yb, { seg: 16 });
  b.profile(m.polymer, [[-0.33, -0.086], [-0.358, -0.086], [-0.362, -0.098], [-0.352, -0.1]], 0.014, 0, { bev: 0.002 });
  // Barrel, gas block + tube, brake.
  barrel(k, m.blued, -0.115, -0.505, yb, 0.0098, 0.0083);
  b.box(m.steel, 0.022, 0.024, 0.02, 0, yb + 0.002, -0.3, { bev: 0.0015 });
  b.cyl(m.steel, 0.0026, -0.29, -0.12, 0, yb + 0.013, 8);
  muzzleBrake(k, m.steel, -0.505, yb, 0.0112, 0.058);
  g.muzzle.position.set(0, yb, -0.566);
  // Optic + folded backups.
  foldedIrons(k, 0.05, -0.385, railTop);
  const dot = redDot(k, -0.025, railTop);

  // Moving parts.
  b.into(g.bolt);
  b.box(m.bright, 0.0008, 0.012, 0.034, inner + 0.0006, portC[1], portC[0] + 0.004, { bev: 0.0002 });
  b.box(m.steel, 0.0009, 0.004, 0.012, inner + 0.0009, portC[1] + 0.002, portC[0] - 0.006, { bev: 0.0002 });
  g.boltTravel = 0.03;
  g.charge = new THREE.Group();
  g.root.add(g.charge);
  b.into(g.charge);
  b.box(m.anodized, 0.012, 0.007, 0.024, 0, -0.0455, 0.07, { bev: 0.0012 });
  b.box(m.anodized, 0.036, 0.008, 0.009, 0, -0.0455, 0.08, { bev: 0.0018, seg: 2 });
  b.box(m.steel, 0.006, 0.004, 0.012, -0.012, -0.041, 0.077, { bev: 0.0008 });
  g.chargeTravel = 0.055;

  b.into(g.mag);
  boxMag(k, m.polymerTan, 0.062, 0.172, 0.04, 0.0215, { ribs: true, rounds: m.brass, plate: m.polymerTan });
  g.mag.position.set(0, -0.088, -0.051);

  // Arms.
  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, yb, -0.285];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.024, [-0.25, -0.3, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.06, -0.006];
  buildArm(b, m, { at: grabAt, axis: [0, -1, 0.15], palm: [-1, 0, 0], elbow: [-0.16, -0.36, 0.15], left: true, watch: true }, { r: 0.024, thumb: "wrap" });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.02, -0.092, -0.004);
  g.eject.position.set(0.017, portC[1], portC[0]);
  g.ejectDir.set(1, 0.38, 0.3).normalize();
  g.hip.set(0.14, -0.075, -0.32);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.165 - dot.eye);
  g.cycle = 0.08;
  return g;
}

// =============================================================================
// Hornet K9 — compact SMG, holographic sight, vertical foregrip, telescoping stock.
// =============================================================================
function buildSmg(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("smg");
  const yb = -0.052;
  const railTop = -0.03;
  b.into(g.root);

  const upper: P2[] = [[0.068, -0.0376], [-0.135, -0.0376], [-0.135, -0.072], [0.068, -0.072]];
  const portC: [number, number] = [-0.02, -0.055];
  const inner = receiverWithPort(k, m.anodized, upper, -0.014, 0.014, rrect(0.036, 0.014, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.014, 0.036, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  rail(k, m.anodized, 0.066, -0.232, railTop);
  // Cocking tube along the left with a slot.
  b.cyl(m.anodized, 0.0058, -0.24, -0.02, -0.0155, -0.045, 14);
  b.box(m.polymer, 0.002, 0.003, 0.11, -0.021, -0.045, -0.15, { bev: 0 });
  // Polymer lower with integrated guard + grip.
  b.profile(m.polymer, [
    [0.066, -0.0712], [0.066, -0.086], [0.05, -0.094], [0.004, -0.094], [0.0, -0.104], [-0.004, -0.112], [-0.062, -0.112],
    [-0.066, -0.098], [-0.08, -0.09], [-0.13, -0.084], [-0.135, -0.0712],
  ], 0.027, 0, { bev: 0.0018 });
  b.box(m.polymer, 0.03, 0.006, 0.062, 0, -0.11, -0.033, { bev: 0.002 });
  triggerGroup(k, m.polymer, m.steel, 0.044, 0.004, -0.093, 0.022, 0.011);
  const grip = pistolGrip(k, m.grip, 0.062, -0.092, 0.092, 0.24, 0.032, 0.029);
  buttonX(k, m.steel, 0.006, 0.002, -0.0136, -0.082, 0.05);
  b.box(m.steel, 0.0025, 0.004, 0.018, -0.0145, -0.082, 0.042, { rx: 0.4, bev: 0.0006 });
  pinX(k, m.steel, 0.0024, 0.028, 0, -0.078, 0.058);
  // Shroud / handguard.
  for (const sx of [-1, 1]) {
    slottedPlate(k, m.anodized, -0.135, -0.235, -0.072, -0.04, sx * 0.0145, 0.004, 3, 0.022);
    b.box(m.anodized, 0.004, 0.004, 0.1, sx * 0.0156, -0.0395, -0.185, { rz: Math.PI / 4, bev: 0.0006 });
  }
  b.section(m.anodized, rrect(0.033, 0.004, 0, 0, -0.0392), -0.135, -0.235, { bev: 0.0008 });
  b.section(m.anodized, rrect(0.031, 0.006, 0.002, 0, -0.0735), -0.135, -0.235, { bev: 0.0008 });
  for (let i = 0; i < 9; i++) b.box(m.anodized, 0.0156, 0.0034, 0.0052, 0, -0.0782, -0.145 - i * 0.01, { bev: 0.0006 });
  b.section(m.anodized, rrect(0.034, 0.04, 0.006, 0, -0.056, 3), -0.232, -0.238, { bev: 0.001, holes: [circle(0.0098, 0, yb, 14)] });
  barrel(k, m.blued, -0.13, -0.262, yb, 0.0092, 0.0085);
  flashHider(k, m.steel, -0.262, yb, 0.0105, 0.04);
  g.muzzle.position.set(0, yb, -0.305);
  // Vertical foregrip.
  const vgZ = -0.19;
  const vg: P2[] = [[0.0115, 0], [0.0128, -0.004], [0.0135, -0.016]];
  for (let i = 0; i < 4; i++) vg.push([0.0128, -0.02 - i * 0.013], [0.0136, -0.026 - i * 0.013]);
  vg.push([0.0136, -0.074], [0.0115, -0.08], [0, -0.081]);
  b.lathe(m.polymer, [[0, 0], ...vg], 0, -0.0795, { rx: -Math.PI / 2, z: vgZ, seg: 12 });
  b.box(m.polymer, 0.026, 0.006, 0.03, 0, -0.0815, vgZ, { bev: 0.0015 });
  // Telescoping stock: twin rods + butt plate with cheek rest.
  for (const sx of [-1, 1]) b.cyl(m.steel, 0.0052, 0.06, 0.275, sx * 0.0105, -0.052, 10);
  b.box(m.polymer, 0.032, 0.03, 0.012, 0, -0.052, 0.07, { bev: 0.002 });
  b.profile(m.polymer, [[0.268, -0.03], [0.29, -0.032], [0.292, -0.135], [0.282, -0.138], [0.268, -0.075]], 0.036, 0, { bev: 0.003, bevSeg: 2 });
  b.profile(m.rubber, [[0.29, -0.032], [0.298, -0.034], [0.299, -0.133], [0.29, -0.135]], 0.038, 0, { bev: 0.002 });
  b.box(m.polymer, 0.03, 0.01, 0.06, 0, -0.033, 0.25, { bev: 0.003, seg: 2 });
  const holo = holoSight(k, -0.04, railTop);

  b.into(g.bolt);
  b.box(m.bright, 0.0008, 0.0105, 0.026, inner + 0.0006, portC[1], portC[0] + 0.002, { bev: 0.0002 });
  g.boltTravel = 0.024;
  g.charge = new THREE.Group();
  g.root.add(g.charge);
  b.into(g.charge);
  b.cyl(m.steel, 0.003, -0.012, 0.012, -0.03, -0.045, 8, { ry: Math.PI / 2, z: -0.215 });
  b.lathe(m.polymer, [[0, 0], [0.006, 0], [0.007, -0.004], [0.007, -0.012], [0, -0.013]], -0.03, -0.045, { ry: Math.PI / 2, z: -0.215, seg: 10 });
  g.chargeTravel = 0.07;

  b.into(g.mag);
  boxMag(k, m.polymerGray, 0.036, 0.2, 0.014, 0.024, { rounds: m.brass, plate: m.polymer });
  for (let i = 0; i < 3; i++) b.box(m.polymer, 0.0254, 0.003, 0.02, 0, -0.06 - i * 0.04, -0.002 * i, { bev: 0.0006 });
  g.mag.position.set(0, -0.084, -0.031);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.36]));
  const leftAt: V3 = [0, -0.088, vgZ];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, -1, 0.12], palm: [-0.8, 0, 0.6], elbow: [-0.28, -0.3, 0.22], left: true, watch: true }, { r: 0.0138, thumb: "wrap", fingers: ["wrap", "wrap", "wrap", "wrap"] });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.07, -0.004];
  buildArm(b, m, { at: grabAt, axis: [0, -1, 0.1], palm: [-1, 0, 0], elbow: [-0.16, -0.36, 0.15], left: true, watch: true }, { r: 0.017, thumb: "wrap" });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.03, -0.045, -0.215);
  g.eject.position.set(0.016, portC[1], portC[0]);
  g.ejectDir.set(1, 0.45, 0.2).normalize();
  g.shell = "pistol";
  g.hip.set(0.13, -0.07, -0.3);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.152 - holo.eye);
  g.flash = "hider";
  g.flashScale = 0.75;
  g.cycle = 0.06;
  return g;
}

// =============================================================================
// Breacher 12 — pump shotgun, ghost-ring sights, side saddle, olive furniture.
// =============================================================================
function buildShotgun(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("shotgun");
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
  const grip = pistolGrip(k, m.polymerOlive, 0.074, -0.074, 0.098, 0.36, 0.035, 0.031);
  stock(k, m.polymerOlive, m.rubber, 0.078, -0.022, 0.26, 0.112, 0.04);
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
  b.section(m.polymerOlive, rrect(0.05, 0.046, 0.017, 0, -0.06, 4), 0.07, -0.07, { bev: 0.003, bevSeg: 2, seg: 4 });
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
  return g;
}

// =============================================================================
// Longreach DMR — tan cerakote marksman rifle with a variable scope.
// =============================================================================
function buildDmr(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("dmr");
  const yb = -0.07;
  const railTop = -0.044;
  b.into(g.root);

  const upper: P2[] = [[0.078, -0.0516], [-0.135, -0.0516], [-0.135, -0.092], [-0.03, -0.092], [-0.01, -0.094], [0.068, -0.094], [0.078, -0.086]];
  const portC: [number, number] = [-0.036, -0.072];
  const inner = receiverWithPort(k, m.cerakoteTan, upper, -0.0165, 0.0165, rrect(0.058, 0.017, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.017, 0.058, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  b.box(m.cerakoteTan, 0.0012, 0.017, 0.058, 0.0225, -0.0875, portC[0], { rz: -2.3, bev: 0.0003 });
  rail(k, m.anodized, 0.078, -0.47, railTop, 0.021);
  b.profile(m.cerakoteTan, [
    [0.074, -0.0925], [0.074, -0.108], [0.064, -0.116], [0.05, -0.118], [-0.012, -0.118], [-0.016, -0.134], [-0.02, -0.138],
    [-0.1, -0.138], [-0.104, -0.133], [-0.103, -0.116], [-0.116, -0.104], [-0.135, -0.1], [-0.135, -0.0925],
  ], 0.031, 0, { bev: 0.0016 });
  b.box(m.cerakoteTan, 0.035, 0.006, 0.09, 0, -0.135, -0.06, { bev: 0.002 });
  buttonX(k, m.steel, 0.0048, 0.003, 0.0168, -0.108, -0.008);
  b.box(m.steel, 0.003, 0.012, 0.022, -0.0168, -0.103, -0.006, { rx: 0.3, bev: 0.0008 });
  b.box(m.steel, 0.003, 0.005, 0.022, -0.0172, -0.1, 0.054, { rx: -0.5, bev: 0.0008 });
  pinX(k, m.steel, 0.0026, 0.0325, 0, -0.096, 0.066);
  triggerGroup(k, m.cerakoteTan, m.steel, 0.052, -0.012, -0.117, 0.022, 0.012);
  const grip = pistolGrip(k, m.gripTan, 0.07, -0.115, 0.098, 0.24, 0.035, 0.031);
  b.cyl(m.anodized, 0.0152, 0.075, 0.26, 0, yb, 16);
  b.lathe(m.steel, [[0.0152, 0.078], [0.0185, 0.078], [0.0185, 0.088], [0.0152, 0.088]], 0, yb, { seg: 12 });
  stock(k, m.polymerTan, m.rubber, 0.165, -0.054, 0.2, 0.108, 0.038);
  b.box(m.polymerTan, 0.03, 0.012, 0.085, 0, -0.04, 0.27, { bev: 0.003, seg: 2 });
  for (const z of [0.245, 0.295]) b.cyl(m.steel, 0.0028, -0.006, 0.006, 0, -0.049, 8, { rx: Math.PI / 2, z });
  // Long free-float handguard.
  for (const sx of [-1, 1]) {
    slottedPlate(k, m.cerakoteTan, -0.135, -0.47, -0.095, -0.052, sx * 0.0192, 0.0042, 5, 0.04);
    b.box(m.cerakoteTan, 0.006, 0.006, 0.335, sx * 0.0172, -0.0955, -0.3025, { rz: Math.PI / 4, bev: 0.0008 });
    b.box(m.cerakoteTan, 0.0048, 0.0048, 0.335, sx * 0.0188, -0.0524, -0.3025, { rz: Math.PI / 4, bev: 0.0008 });
  }
  slottedFloor(k, m.cerakoteTan, -0.135, -0.47, 0.034, -0.099, 0.0042, 6);
  b.section(m.cerakoteTan, rrect(0.04, 0.004, 0, 0, -0.0533), -0.135, -0.47, { bev: 0.0008 });
  b.section(m.cerakoteTan, rrect(0.043, 0.05, 0.009, 0, -0.075, 3), -0.466, -0.473, { bev: 0.0012, holes: [circle(0.0115, 0, yb, 14)] });
  barrel(k, m.blued, -0.13, -0.63, yb, 0.0108, 0.0096);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(m.polymer, 0.0024, 0.0012, 0.12, Math.cos(a) * 0.0097, yb + Math.sin(a) * 0.0097, -0.55, { rz: a + Math.PI / 2, bev: 0 });
  }
  b.box(m.steel, 0.024, 0.026, 0.022, 0, yb + 0.002, -0.36, { bev: 0.0015 });
  muzzleBrake(k, m.steel, -0.63, yb, 0.0135, 0.07);
  g.muzzle.position.set(0, yb, -0.705);
  const sc = rifleScope(k, -0.03, railTop);

  b.into(g.bolt);
  b.box(m.bright, 0.0008, 0.012, 0.04, inner + 0.0006, portC[1], portC[0] + 0.004, { bev: 0.0002 });
  g.boltTravel = 0.036;
  g.charge = new THREE.Group();
  g.root.add(g.charge);
  b.into(g.charge);
  b.box(m.anodized, 0.012, 0.007, 0.024, 0, -0.0555, 0.076, { bev: 0.0012 });
  b.box(m.anodized, 0.04, 0.008, 0.01, 0, -0.0555, 0.086, { bev: 0.0018, seg: 2 });
  g.chargeTravel = 0.06;

  b.into(g.mag);
  boxMag(k, m.polymer, 0.078, 0.108, 0.006, 0.026, { ribs: true, rounds: m.brass, plate: m.polymer });
  g.mag.position.set(0, -0.098, -0.058);

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.34, 0.37]));
  const leftAt: V3 = [0, yb, -0.32];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.0265, [-0.25, -0.31, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.05, -0.004];
  buildArm(b, m, { at: grabAt, axis: [0, -1, 0.1], palm: [-1, 0, 0], elbow: [-0.16, -0.36, 0.15], left: true, watch: true }, { r: 0.027, thumb: "wrap" });

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(-0.021, -0.103, -0.006);
  g.eject.position.set(0.018, portC[1], portC[0]);
  g.ejectDir.set(1, 0.35, 0.3).normalize();
  g.shell = "heavy";
  g.hip.set(0.14, -0.085, -0.33);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.105 - sc.eye);
  g.scope = true;
  g.cycle = 0.25;
  return g;
}

// =============================================================================
// Anvil LMG — belt-fed, hinged feed cover with prism optic, box mag, bipod.
// =============================================================================
function buildLmg(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("lmg");
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
  return g;
}

// =============================================================================
// Marrow P9 — polymer-frame striker pistol, serrated slide, three-dot sights.
// =============================================================================
function buildPistol(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("pistol");
  const yb = -0.018;
  b.into(g.root);

  // Frame: dust cover with accessory rail, trigger guard, grip.
  b.profile(m.polymer, [[0.035, -0.029], [-0.14, -0.029], [-0.14, -0.044], [-0.13, -0.047], [-0.046, -0.047], [-0.03, -0.045], [0.026, -0.045], [0.043, -0.034], [0.043, -0.029]], 0.023, 0, { bev: 0.0022, bevSeg: 2 });
  for (let i = 0; i < 3; i++) b.box(m.polymer, 0.016, 0.003, 0.0055, 0, -0.0485, -0.085 - i * 0.012, { bev: 0.0006 });
  triggerGroup(k, m.polymer, m.polymer, 0.004, -0.044, -0.045, 0.024, 0.0115);
  const grip = pistolGrip(k, m.grip, 0.022, -0.045, 0.094, 0.3, 0.036, 0.0285);
  b.box(m.polymer, 0.02, 0.006, 0.014, 0, -0.04, 0.046, { bev: 0.0025, rx: -0.3 });
  b.box(m.steel, 0.002, 0.004, 0.02, -0.0125, -0.0315, -0.018, { bev: 0.0005 });
  b.box(m.steel, 0.002, 0.003, 0.012, -0.0122, -0.035, -0.045, { bev: 0.0005 });
  buttonX(k, m.polymer, 0.004, 0.003, -0.0118, -0.051, 0.006);
  // Barrel crown + recoil spring guide tip at the muzzle.
  b.lathe(m.blued, [[0.0044, -0.143], [0.0068, -0.143], [0.0068, -0.149], [0.0044, -0.149]], 0, yb, { seg: 14 });
  b.add(m.polymer, new THREE.CircleGeometry(0.0045, 12), place(0, yb, -0.1485, { ry: Math.PI }));
  b.cyl(m.steel, 0.0032, -0.144, -0.12, 0, -0.037, 10);
  g.muzzle.position.set(0, yb, -0.152);

  // Slide (moves): serrations, port, sights.
  b.into(g.bolt);
  b.profile(m.steel, [[0.036, -0.004], [-0.138, -0.004], [-0.143, -0.008], [-0.143, -0.03], [0.036, -0.03], [0.04, -0.026], [0.04, -0.009]], 0.024, 0, { bev: 0.0022, bevSeg: 2 });
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) b.box(m.polymer, 0.0005, 0.02, 0.0014, sx * 0.0121, -0.018, 0.031 - i * 0.003, { bev: 0 });
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) b.box(m.polymer, 0.0005, 0.016, 0.0014, sx * 0.0121, -0.019, -0.112 - i * 0.003, { bev: 0 });
  b.box(m.polymer, 0.011, 0.0008, 0.04, 0.0045, -0.0038, -0.037, { bev: 0 });
  b.box(m.blued, 0.0095, 0.0006, 0.034, 0.0045, -0.0033, -0.038, { bev: 0 });
  for (const sx of [-1, 1]) {
    b.box(m.steel, 0.0078, 0.006, 0.008, sx * 0.0058, -0.003, 0.031, { bev: 0.0006 });
    b.add(m.tritium, new THREE.CircleGeometry(0.0011, 8), place(sx * 0.0058, -0.0032, 0.0352));
  }
  b.box(m.steel, 0.0034, 0.0058, 0.006, 0, -0.0029, -0.13, { bev: 0.0005 });
  b.add(m.tritium, new THREE.CircleGeometry(0.0011, 8), place(0, -0.0022, -0.1268));
  g.boltTravel = 0.022;

  // Magazine (origin at the bottom of the grip, body up the grip axis).
  b.into(g.mag);
  b.box(m.steel, 0.022, 0.09, 0.03, 0, 0.047, 0.001, { bev: 0.0015 });
  b.box(m.polymer, 0.026, 0.008, 0.037, 0, 0.001, 0.002, { bev: 0.002, seg: 2 });
  b.lathe(m.brass, [[0, 0.01], [0.0048, 0.01], [0.0048, -0.006], [0.0035, -0.01], [0, -0.012]], 0, 0.094, { seg: 8 });
  const rake = 0.3;
  g.mag.position.set(0, -0.045 - Math.cos(rake) * 0.094, 0.022 + Math.sin(rake) * 0.094);
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
  g.shell = "pistol";
  g.hip.set(0.07, -0.062, -0.27);
  g.hipRot.set(0.0, 0.04, 0.02);
  g.ads.set(0, 0, -0.27);
  g.handgun = true;
  g.flash = "pistol";
  g.flashScale = 0.7;
  g.reload = "pistol";
  return g;
}

// =============================================================================
// Ruin .50 — stainless double-action revolver, full-lug barrel, swing-out crane.
// =============================================================================
function buildRevolver(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("revolver");
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
  const grip = pistolGrip(k, m.rubber, 0.034, -0.072, 0.098, 0.42, 0.038, 0.034);
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

export const GUN_BUILDERS: Record<ViewModelKind, (k: Kit) => GunSpec> = {
  rifle: buildRifle,
  smg: buildSmg,
  shotgun: buildShotgun,
  dmr: buildDmr,
  lmg: buildLmg,
  pistol: buildPistol,
  revolver: buildRevolver,
};

// =============================================================================
// Knife + grenade (with their hands).
// =============================================================================

/** Fixed-blade knife in a right fist. Group origin ≈ the fist. */
export function buildKnife(k: Kit, group: THREE.Group) {
  const { b, m } = k;
  b.into(group);
  // Blade (drawn along -Z, edge down), with a darker spine bevel and fuller.
  const bladePts: P2[] = [[0.0, 0.012], [-0.13, 0.012], [-0.165, 0.004], [-0.178, -0.006], [-0.16, -0.012], [-0.03, -0.014], [0.0, -0.012]];
  const g = extrude(shape(bladePts.map(([z, y]) => [-z, y])), 0.0042, { bev: 0.0016 });
  g.rotateY(Math.PI / 2);
  b.add(m.blade, g, place(0, 0, -0.02));
  b.box(m.bladeCoat, 0.0046, 0.004, 0.1, 0, 0.008, -0.08, { bev: 0.0008 });
  // Guard, cord-wrapped handle, pommel.
  b.box(m.steel, 0.012, 0.036, 0.007, 0, -0.001, -0.017, { bev: 0.0018 });
  b.lathe(m.cord, [[0.0105, -0.013], [0.0118, -0.006], [0.0122, 0.05], [0.011, 0.075], [0.0105, 0.08]], 0, -0.002, { s: [0.85, 1.25, 1], seg: 10 });
  b.lathe(m.steel, [[0, 0.08], [0.011, 0.08], [0.012, 0.086], [0.008, 0.094], [0, 0.095]], 0, -0.002, { s: [0.85, 1.2, 1], seg: 10 });
  buildArm(b, m, { at: [0, 0.0, 0.016], axis: [0, 0, 1], palm: [0.15, -1, 0], elbow: [0.12, -0.15, 0.45] }, { r: 0.0125, thumb: "wrap", tight: 1.05 });
}

/** Frag grenade in a left hand. */
export function buildGrenade(k: Kit, group: THREE.Group) {
  const { b, m } = k;
  b.into(group);
  const body: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    body.push([Math.cos(a) * 0.029, Math.sin(a) * 0.036]);
  }
  b.add(m.polymerOlive, latheZ(body, 14), place(0, 0, 0, { rx: -Math.PI / 2 }));
  for (let i = 0; i < 3; i++) b.lathe(m.polymer, [[0.0292, -0.0012], [0.0298, 0], [0.0292, 0.0012]], 0, -0.012 + i * 0.012, { rx: -Math.PI / 2, seg: 14 });
  b.lathe(m.steel, [[0, 0], [0.011, 0], [0.011, -0.014], [0.008, -0.018], [0, -0.018]], 0, 0.032, { rx: Math.PI / 2, seg: 10 });
  b.box(m.steel, 0.012, 0.003, 0.06, 0, 0.04, 0.02, { rx: -0.35, bev: 0.0008 });
  b.add(m.steel, new THREE.TorusGeometry(0.009, 0.0012, 5, 14), place(0.014, 0.046, 0.0, { ry: Math.PI / 2 }));
  buildArm(b, m, { at: [-0.0, 0.028, 0.0], axis: [0, -1, 0.2], palm: [0, 0, 1], elbow: [-0.15, -0.22, 0.42], left: true, watch: true }, { r: 0.03, thumb: "wrap", tight: 0.9 });
}

