import * as THREE from "three";
import { PartGeometry } from "../content/PartGeometry";

/**
 * "Kite" light attack helicopter — an original airframe: tandem two-seat
 * cockpit under a stepped canopy, slim armoured fuselage, stub wings with
 * rocket pods, a chin turret, a tapered tail boom with a swept fin and a
 * four-blade main rotor. +Z forward, origin at the mast base (≈ centre of
 * mass); the skids sit 1.6 m below the origin.
 *
 * Draws in 5 calls: hull, turret, main rotor, tail rotor, rotor disc.
 * Everything here is shared between helicopters (one build per session).
 */

export const SKID_DROP = 1.6;
export const ROTOR_RADIUS = 5.6;
/** Chin gun muzzle in turret space. */
export const MUZZLE_LOCAL = new THREE.Vector3(0, -0.12, 1.0);
/** Turret pivot in hull space. */
export const TURRET_POS = new THREE.Vector3(0, -0.78, 3.05);
export const MAIN_ROTOR_POS = new THREE.Vector3(0, 1.55, 0.1);
export const TAIL_ROTOR_POS = new THREE.Vector3(0.28, 1.25, -7.35);
/** Rope anchor points in hull space (fast-rope inserts). */
export const ROPE_POS = new THREE.Vector3(0, -0.9, -0.3);

const G = 0xd6d6d2; // base (material colour gives the livery)
const GD = 0x7c7d7a;
const GL = 0xf2f2ee;
const GLASS = 0x141a1e;
const BLACK = 0x1c1c1c;

export type HeliLivery = "hostile" | "friendly";

export type HeliAssets = {
  hull: THREE.BufferGeometry;
  turret: THREE.BufferGeometry;
  rotor: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  rope: THREE.BufferGeometry;
  mats: Record<HeliLivery, THREE.MeshStandardMaterial>;
  dark: THREE.MeshStandardMaterial;
  discMat: THREE.MeshBasicMaterial;
  ropeMat: THREE.MeshStandardMaterial;
};

let assets: HeliAssets | null = null;

function buildHull() {
  const P = new PartGeometry();
  // Fuselage: armoured tub + tapering nose.
  P.blob(0.78, 0.92, 3.1, G, 0, 0, 0.2, 18);
  P.blob(0.6, 0.62, 1.5, G, 0, -0.22, 2.55, 14);
  P.box(1.3, 0.5, 4.6, GD, 0, -0.62, 0.4); // belly armour
  // Stepped tandem canopy (gunner front-low, pilot rear-high).
  P.blob(0.5, 0.42, 1.0, GLASS, 0, 0.42, 2.25, 14);
  P.blob(0.54, 0.5, 1.15, GLASS, 0, 0.72, 0.95, 14);
  P.box(0.08, 0.5, 2.6, GD, 0, 0.82, 1.55); // canopy frame spine
  // Engine deck, intakes, exhausts.
  P.box(1.25, 0.62, 2.8, GD, 0, 1.0, -0.55);
  P.blob(0.62, 0.32, 1.5, G, 0, 1.28, -0.6, 12);
  for (const s of [-1, 1]) {
    P.cyl(0.24, 0.26, 0.5, 10, BLACK, s * 0.66, 1.05, 0.75, Math.PI / 2, 0, 0); // intakes
    P.cyl(0.2, 0.26, 0.7, 10, BLACK, s * 0.6, 1.1, -2.0, Math.PI / 2 - 0.25, 0, s * 0.3); // exhausts
  }
  // Mast + rotor head fairing.
  P.cyl(0.17, 0.22, 0.6, 10, GD, 0, 1.3, 0.1);
  // Tail boom, fin, stabilisers, tail skid.
  P.cyl(0.24, 0.5, 6.0, 12, G, 0, 0.42, -4.55, Math.PI / 2, 0, 0);
  P.box(0.14, 1.9, 1.15, G, 0, 1.15, -7.25, 0.42, 0, 0);
  P.box(2.3, 0.08, 0.62, G, 0, 0.45, -6.55);
  for (const s of [-1, 1]) P.box(0.06, 0.45, 0.5, GD, s * 1.15, 0.6, -6.6);
  P.box(0.06, 0.5, 0.06, BLACK, 0, -0.05, -7.4, -0.5, 0, 0);
  // Stub wings with pylons and rocket pods.
  P.box(3.9, 0.13, 0.95, GD, 0, -0.08, 0.15, 0, 0, 0);
  for (const s of [-1, 1]) {
    P.box(0.12, 0.35, 0.4, BLACK, s * 1.55, -0.3, 0.15);
    P.cyl(0.24, 0.24, 1.5, 10, GD, s * 1.55, -0.55, 0.25, Math.PI / 2, 0, 0);
    P.cyl(0.25, 0.25, 0.08, 10, BLACK, s * 1.55, -0.55, 1.0, Math.PI / 2, 0, 0);
    P.box(0.1, 0.25, 0.3, BLACK, s * 1.95, -0.3, 0.1);
    P.cyl(0.08, 0.08, 1.2, 6, BLACK, s * 1.95, -0.45, 0.25, Math.PI / 2, 0, 0); // missile rail
  }
  // Skids.
  for (const s of [-1, 1]) {
    P.box(0.09, 0.09, 4.4, BLACK, s * 1.05, -SKID_DROP + 0.05, 0.35);
    P.box(0.09, 0.09, 0.5, BLACK, s * 1.05, -SKID_DROP + 0.2, 2.65, -0.6, 0, 0);
    for (const z of [-0.9, 1.4]) P.box(0.08, 0.9, 0.1, BLACK, s * 0.85, -1.15, z, 0, 0, s * 0.45);
  }
  // Sensor ball under the nose, antennae, nav lights.
  P.blob(0.22, 0.22, 0.22, GD, 0, -0.38, 3.75, 10);
  P.blob(0.16, 0.14, 0.05, GLASS, 0, -0.38, 3.95, 8);
  P.box(0.04, 0.5, 0.04, BLACK, 0, 1.0, -2.6, -0.3, 0, 0);
  P.box(0.3, 0.06, 0.06, GL, 0, -0.95, -1.6);
  return P.build();
}

function buildTurret() {
  const P = new PartGeometry();
  P.blob(0.3, 0.26, 0.3, GD, 0, 0, 0, 12);
  P.box(0.26, 0.2, 0.5, BLACK, 0, -0.12, 0.35);
  P.cyl(0.05, 0.06, 0.95, 8, BLACK, 0, -0.12, 0.6, Math.PI / 2, 0, 0);
  P.cyl(0.075, 0.075, 0.18, 8, BLACK, 0, -0.12, 0.95, Math.PI / 2, 0, 0);
  return P.build();
}

function buildRotor() {
  const P = new PartGeometry();
  P.cyl(0.32, 0.36, 0.22, 12, GD, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const r = ROTOR_RADIUS / 2 + 0.2;
    P.box(0.34, 0.05, ROTOR_RADIUS - 0.35, BLACK, Math.sin(a) * r, 0.04, Math.cos(a) * r, 0, a, 0.05);
  }
  return P.build();
}

function buildTailRotor() {
  const P = new PartGeometry();
  P.cyl(0.1, 0.1, 0.18, 8, GD, 0, 0, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 2; i++) P.box(0.04, 1.5, 0.16, BLACK, 0.08, 0, 0, i * (Math.PI / 2), 0, 0);
  return P.build();
}

export function heliAssets(): HeliAssets {
  if (assets) return assets;
  const mk = (color: number) => new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.62, metalness: 0.32, envMapIntensity: 0.7 });
  const disc = new THREE.CircleGeometry(ROTOR_RADIUS, 28).rotateX(-Math.PI / 2);
  const rope = new THREE.BoxGeometry(0.05, 1, 0.05).translate(0, -0.5, 0);
  const rope2 = rope.clone().translate(0.75, 0, 0);
  rope.translate(-0.75, 0, 0);
  const ropes = new PartGeometry().add(rope, 0x3a3428).add(rope2, 0x3a3428).build();
  assets = {
    hull: buildHull(),
    turret: buildTurret(),
    rotor: buildRotor(),
    tail: buildTailRotor(),
    disc,
    rope: ropes,
    mats: { hostile: mk(0xb7a27e), friendly: mk(0x6f7a62) },
    dark: mk(0x5a5a58),
    discMat: new THREE.MeshBasicMaterial({ color: 0x202020, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    ropeMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  };
  return assets;
}

export function disposeHeliAssets() {
  if (!assets) return;
  const a = assets;
  for (const g of [a.hull, a.turret, a.rotor, a.tail, a.disc, a.rope]) g.dispose();
  a.mats.hostile.dispose();
  a.mats.friendly.dispose();
  a.dark.dispose();
  a.discMat.dispose();
  a.ropeMat.dispose();
  assets = null;
}
