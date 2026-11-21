import * as THREE from "three";
import type { ViewModelKind } from "../weapons";
import type { P2, V3 } from "./geo";
import type { ArmPlacement, HandPose } from "./hands";
import type { Surf } from "./materials";
import type { Kit } from "./parts";
import type { ShellKind } from "../../effects/Shells";

export type { ShellKind, Kit };
export type FlashStyle = "brake" | "hider" | "shotgun" | "pistol" | "revolver";
/**
 * mag: detachable box mag · box: belt box + feed cover · pistol: grip mag ·
 * shell: round-by-round through a loading port (shotguns, bolt guns) ·
 * revolver: swing-out cylinder + speedloader · none: knife.
 */
export type ReloadStyle = "mag" | "shell" | "revolver" | "box" | "pistol" | "none";

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
  /** Charging handle — pulled on empty reloads. */
  charge?: THREE.Group;
  chargeTravel?: number;
  /** Charging handle reciprocates with the bolt (AK, SCAR, M1014): moves on every shot. */
  chargeRides?: boolean;
  pump?: THREE.Group;
  pumpTravel?: number;
  /** Bolt-action: handle lifts (rotates about Z, +lift) then the bolt draws back `bolt.position.z + boltTravel`. */
  boltLift?: THREE.Group;
  boltLiftAngle?: number;
  /** Strong-hand arm as its own group (bolt guns run the bolt with it). */
  rightArm?: THREE.Group;
  /** Gun-space offset that brings the strong hand onto the bolt knob. */
  rightToBolt?: THREE.Vector3;
  /** Revolver: crane (swings out) → cylinder (spins) → loaded rounds. */
  crane?: THREE.Group;
  cylinder?: THREE.Group;
  rounds?: THREE.Group;
  /** Feed cover / top cover (hinged at the rear, rotates about X). */
  cover?: THREE.Group;
  /** Cover opens upward around +X (default) or flips the other way (-1). */
  coverSign?: number;
  /** Gun-space point of the feed-cover latch (box reloads). */
  coverLatch?: THREE.Vector3;
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
  /**
   * Magazine path when it comes out (gun-space offsets from rest):
   * `pull` clears the well, `away` is off-screen; `rot` is its tumble (x, y, z rad).
   */
  magPath?: { pull: V3; away: V3; rot: V3; rockIn?: number };
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
  /** Slide / bolt locks back on empty. */
  locksBack?: boolean;
  /** Stock end (gun space) for the rifle-butt stroke. */
  butt?: THREE.Vector3;
};

export const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

export function newSpec(kind: ViewModelKind): GunSpec {
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

/** Moving group attached to the root. */
export function part(g: GunSpec, at?: V3) {
  const o = new THREE.Group();
  if (at) o.position.set(at[0], at[1], at[2]);
  g.root.add(o);
  return o;
}

/** Support-hand placement on a handguard of radius r around the bore. */
export function supportOnHandguard(at: V3, r: number, elbow: V3): [ArmPlacement, HandPose] {
  return [
    { at, axis: [0, 0, 1], palm: [-0.4, -0.92, 0], elbow, left: true, watch: true },
    { r, thumb: "forward", phi0: -62, fingers: ["wrap", "wrap", "wrap", "wrap"], tight: 0.8 },
  ];
}

/** Strong hand on a pistol grip; index finger on the trigger. */
export function strongOnGrip(top: V3, axis: V3, elbow: V3, r = 0.0175, thumb: HandPose["thumb"] = "wrap"): [ArmPlacement, HandPose] {
  return [
    { at: [top[0], top[1] - 0.004, top[2]], axis, palm: [0.42, 0, 1], elbow },
    { r, fingers: [[0.15, 1.05, 0.75], "wrap", "wrap", "wrap"], thumb, thumbDir: thumb === "forward" ? [-0.06, -0.08, -1] : undefined, phi0: -62 },
  ];
}

/** Support hand gripping a magazine (child of the mag group), palm on its left face. */
export function grabMag(at: V3, r: number, axis: V3 = [0, -1, 0.15]): [ArmPlacement, HandPose] {
  return [
    { at, axis, palm: [-1, 0, 0], elbow: [-0.16, -0.36, 0.15], left: true, watch: true },
    { r, thumb: "wrap" },
  ];
}

/** Split receiver: solid left body + right skin with an ejection-port window. */
export function receiverWithPort(k: Kit, mat: Surf, pts: P2[], xl: number, xr: number, port: P2[]) {
  const skin = 0.006;
  const inner = xr - skin;
  k.b.profile(mat, pts, inner - xl, (xl + inner) / 2, { bev: 0.0015 });
  k.b.profile(mat, pts, skin, inner + skin / 2, { bev: 0.0009, holes: [port] });
  return inner;
}

/** Bright bolt face visible in the ejection port (moves with the bolt group). */
export function boltFace(k: Kit, x: number, y: number, z: number, h: number, len: number) {
  k.b.box(k.m.bright, 0.0008, h, len, x + 0.0006, y, z, { bev: 0.0002 });
}
