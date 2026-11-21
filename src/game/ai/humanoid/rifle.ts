import * as THREE from "three";
import { cyl, ellipsoid, GeoBuilder, paint, profile, rbox, shade, T, type Paint } from "./geo";
import { SURF } from "./materials";
import type { Kit } from "./kit";
import type { ThirdPersonKind } from "../../weapons/weapons";

/**
 * Third-person weapons. Frame: origin at the butt plate centre, +Z toward
 * the muzzle, +Y up. Grip points are where the right fist / left hand
 * sockets go; the Humanoid's IK puts the hands there.
 */
export type GunSpec = {
  geo: THREE.BufferGeometry;
  gripR: THREE.Vector3;
  gripL: THREE.Vector3;
  muzzle: THREE.Vector3;
  /** Recoil kick scale. */
  kick: number;
  /** Shouldered pivot (butt position) in spine space. */
  pivot: THREE.Vector3;
  /** Left hand palm-up under the handguard (true) or on a vertical grip / pump. */
  leftUnder: boolean;
};

const AX_Z = (x: number, y: number, z: number) => T(x, y, z, Math.PI / 2, 0, 0); // cylinder along Z

type Pal = { poly: Paint; metal: Paint; worn: Paint; glass: Paint; accent: Paint; fde: Paint };

function palette(accent: number, tint: number): Pal {
  return {
    poly: paint(0x1c1d1f, SURF.hard, 0.66),
    metal: paint(0x26272a, SURF.hard, 0.42, 0.7),
    worn: paint(0x4a4b4e, SURF.hard, 0.35, 0.85),
    glass: paint(0x10161c, SURF.hard, 0.06, 0.3, 0.05),
    accent: paint(accent, SURF.hard, 0.4, 0, 1.4),
    fde: paint(tint, SURF.hard, 0.7),
  };
}

function carbine(b: GeoBuilder, p: Pal): Omit<GunSpec, "geo" | "pivot" | "kick"> {
  // Stock (collapsible, angular) + buffer tube.
  b.add(rbox(0.038, 0.115, 0.02, 6, 4, 0.3), shade(p.poly, 0.6), T(0, -0.003, 0.01)); // butt pad
  b.add(profile([[0.0, 0.05], [0.16, 0.05], [0.16, 0.022], [0.05, 0.0], [0.03, -0.04], [0.012, -0.055]], 0.034), p.poly);
  b.add(cyl(0.014, 0.014, 0.12, 8), p.metal, AX_Z(0, 0.035, 0.19));
  // Lower + upper receiver.
  b.add(rbox(0.03, 0.048, 0.15, 8, 5, 0.2), p.metal, T(0, 0.008, 0.31));
  b.add(rbox(0.033, 0.036, 0.22, 8, 5, 0.2), p.metal, T(0, 0.048, 0.33));
  b.add(rbox(0.012, 0.012, 0.03), p.worn, T(-0.018, 0.05, 0.29)); // charging / ejection detail
  // Pistol grip + trigger guard.
  b.add(rbox(0.026, 0.08, 0.034, 8, 4, 0.3), p.poly, T(0, -0.04, 0.262, 0.32));
  b.add(rbox(0.006, 0.006, 0.05), p.metal, T(0, -0.022, 0.305));
  // Curved magazine.
  b.add(profile([[0.345, -0.012], [0.385, -0.012], [0.4, -0.14], [0.358, -0.148]], 0.026, 0.003), p.fde);
  // Handguard with top rail, vertical foregrip, barrel and muzzle device.
  b.add(rbox(0.044, 0.046, 0.27, 8, 3.2, 0.15), p.poly, T(0, 0.04, 0.575));
  b.add(rbox(0.02, 0.009, 0.5, 4, 8, 0), p.metal, T(0, 0.07, 0.45));
  b.add(cyl(0.012, 0.014, 0.075, 7), p.poly, T(0, -0.012, 0.64, 0.12));
  b.add(cyl(0.0085, 0.0085, 0.13, 7), p.metal, AX_Z(0, 0.04, 0.765));
  b.add(cyl(0.014, 0.014, 0.055, 7), p.worn, AX_Z(0, 0.04, 0.85));
  // Holographic-style sight: body, hood, glass.
  b.add(rbox(0.036, 0.022, 0.08, 8, 4, 0.25), p.poly, T(0, 0.086, 0.4));
  b.add(rbox(0.04, 0.045, 0.012, 6, 4, 0.2), p.poly, T(0, 0.105, 0.36));
  b.add(rbox(0.04, 0.045, 0.012, 6, 4, 0.2), p.poly, T(0, 0.105, 0.435));
  b.add(rbox(0.03, 0.03, 0.004, 6, 4, 0), p.glass, T(0, 0.108, 0.435));
  b.add(rbox(0.008, 0.012, 0.02), p.accent, T(-0.024, 0.06, 0.5)); // IR laser module LED
  return { gripR: new THREE.Vector3(0, -0.035, 0.258), gripL: new THREE.Vector3(0, 0.035, 0.5), muzzle: new THREE.Vector3(0, 0.04, 0.88), leftUnder: true };
}

function shotgun(b: GeoBuilder, p: Pal): Omit<GunSpec, "geo" | "pivot" | "kick"> {
  b.add(profile([[0, -0.06], [0.0, 0.045], [0.17, 0.05], [0.17, 0.02], [0.04, -0.015], [0.015, -0.062]], 0.036), p.poly);
  b.add(rbox(0.04, 0.062, 0.2, 8, 5, 0.2), p.metal, T(0, 0.032, 0.27));
  b.add(rbox(0.008, 0.02, 0.055), p.worn, T(0.022, 0.03, 0.27)); // side shell carrier
  for (let i = 0; i < 4; i++) b.add(cyl(0.0095, 0.0095, 0.03, 5), paint(0x7a2a1c, SURF.hard, 0.5), T(0.03, 0.012 + i * 0.0, 0.235 + i * 0.022, 0, 0, Math.PI / 2));
  b.add(rbox(0.026, 0.075, 0.034, 8, 4, 0.3), p.poly, T(0, -0.032, 0.19, 0.3));
  b.add(cyl(0.011, 0.011, 0.5, 8), p.metal, AX_Z(0, 0.048, 0.6));
  b.add(cyl(0.012, 0.012, 0.42, 8), p.metal, AX_Z(0, 0.017, 0.56));
  b.add(cyl(0.022, 0.022, 0.13, 8), p.poly, AX_Z(0, 0.02, 0.5)); // pump
  for (let i = 0; i < 4; i++) b.add(cyl(0.0235, 0.0235, 0.008, 8), shade(p.poly, 0.7), AX_Z(0, 0.02, 0.45 + i * 0.033));
  b.add(rbox(0.006, 0.012, 0.012), p.worn, T(0, 0.058, 0.83)); // bead sight
  b.add(rbox(0.024, 0.016, 0.04), p.metal, T(0, 0.07, 0.26)); // ghost-ring rear
  return { gripR: new THREE.Vector3(0, -0.03, 0.188), gripL: new THREE.Vector3(0, 0.02, 0.5), muzzle: new THREE.Vector3(0, 0.048, 0.86), leftUnder: true };
}

function lmg(b: GeoBuilder, p: Pal, big: boolean): Omit<GunSpec, "geo" | "pivot" | "kick"> {
  const s = big ? 1.15 : 1;
  b.add(profile([[0, -0.07], [0, 0.05], [0.2, 0.055], [0.2, 0.0], [0.05, -0.03], [0.02, -0.075]], 0.045), p.poly);
  b.add(rbox(0.055 * s, 0.085 * s, 0.32, 8, 6, 0.15), p.metal, T(0, 0.025, 0.36));
  b.add(rbox(0.05 * s, 0.02, 0.2, 8, 6, 0.3), p.worn, T(0, 0.077 * s, 0.33)); // feed cover
  b.add(rbox(0.012, 0.03, 0.05), p.metal, T(0, 0.1 * s, 0.4)); // rear sight
  b.add(rbox(0.028, 0.08, 0.034, 8, 4, 0.3), p.poly, T(0, -0.045, 0.26, 0.32));
  if (big) {
    // Drum magazine on the left, belt chute to the feed tray.
    b.add(cyl(0.1, 0.1, 0.075, 12), p.fde, T(0.02, -0.08, 0.4, 0, 0, Math.PI / 2));
    b.add(cyl(0.035, 0.035, 0.078, 8), p.metal, T(0.02, -0.08, 0.4, 0, 0, Math.PI / 2));
    b.add(rbox(0.07, 0.03, 0.06), p.poly, T(0.03, 0.0, 0.4, 0, 0, 0.6));
    // Heavy perforated shroud + muzzle brake + carry handle.
    b.add(cyl(0.032, 0.032, 0.44, 10), p.metal, AX_Z(0, 0.035, 0.74));
    for (let i = 0; i < 5; i++) b.add(cyl(0.034, 0.034, 0.012, 10), shade(p.metal, 0.6), AX_Z(0, 0.035, 0.58 + i * 0.075));
    b.add(rbox(0.05, 0.05, 0.1, 8, 4, 0.2), p.worn, T(0, 0.035, 1.0));
    b.add(rbox(0.015, 0.06, 0.12), p.poly, T(0, 0.12, 0.46));
    b.add(rbox(0.06, 0.012, 0.1), p.poly, T(0, 0.15, 0.46));
    b.add(rbox(0.026, 0.09, 0.04, 8, 4, 0.3), p.poly, T(0, -0.04, 0.52, 0.15)); // front grip
    b.add(rbox(0.01, 0.024, 0.04), p.accent, T(0.04, 0.035, 0.62)); // status light
    return { gripR: new THREE.Vector3(0, -0.04, 0.258), gripL: new THREE.Vector3(0, -0.06, 0.52), muzzle: new THREE.Vector3(0, 0.035, 1.06), leftUnder: false };
  }
  // Box magazine (soft pouch), heavy barrel, folded bipod, carry handle.
  b.add(rbox(0.07, 0.11, 0.1, 8, 4, 0.25), p.fde, T(0.012, -0.07, 0.38));
  b.add(rbox(0.05, 0.05, 0.24, 8, 4, 0.15), p.poly, T(0, 0.03, 0.62));
  b.add(cyl(0.014, 0.014, 0.34, 8), p.metal, AX_Z(0, 0.035, 0.85));
  b.add(cyl(0.02, 0.018, 0.06, 8), p.worn, AX_Z(0, 0.035, 1.03));
  b.add(cyl(0.006, 0.006, 0.26, 4), p.metal, T(0.018, 0.0, 0.84, Math.PI / 2 - 0.05));
  b.add(cyl(0.006, 0.006, 0.26, 4), p.metal, T(-0.018, 0.0, 0.84, Math.PI / 2 - 0.05));
  b.add(rbox(0.012, 0.04, 0.09), p.poly, T(0, 0.085, 0.6));
  b.add(rbox(0.012, 0.02, 0.012), p.metal, T(0, 0.075, 0.96)); // front post
  return { gripR: new THREE.Vector3(0, -0.04, 0.258), gripL: new THREE.Vector3(0, 0.03, 0.5), muzzle: new THREE.Vector3(0, 0.035, 1.065), leftUnder: true };
}

function boltRifle(b: GeoBuilder, p: Pal): Omit<GunSpec, "geo" | "pivot" | "kick"> {
  // Chassis stock with cheek riser and grip.
  b.add(profile([[0, -0.07], [0, 0.04], [0.06, 0.05], [0.2, 0.045], [0.24, 0.03], [0.24, -0.005], [0.12, -0.02], [0.06, -0.045], [0.02, -0.075]], 0.04), p.fde);
  b.add(rbox(0.03, 0.02, 0.1), p.poly, T(0, 0.062, 0.12)); // cheek riser
  b.add(rbox(0.028, 0.08, 0.034, 8, 4, 0.3), p.poly, T(0, -0.04, 0.27, 0.3));
  b.add(rbox(0.045, 0.045, 0.24, 8, 4, 0.2), p.metal, T(0, 0.03, 0.36));
  b.add(rbox(0.03, 0.05, 0.06), p.poly, T(0, -0.02, 0.38)); // magazine
  b.add(cyl(0.007, 0.007, 0.05, 5), p.worn, T(-0.035, 0.035, 0.3, 0, 0, Math.PI / 2 - 0.4)); // bolt handle
  b.add(ellipsoid(0.01, 0.01, 0.01, 6, 4), p.worn, T(-0.058, 0.025, 0.3));
  b.add(rbox(0.05, 0.05, 0.32, 8, 3, 0.15), p.fde, T(0, 0.025, 0.63)); // forend
  b.add(cyl(0.011, 0.012, 0.36, 8), p.metal, AX_Z(0, 0.035, 0.95));
  b.add(cyl(0.021, 0.021, 0.2, 10), p.poly, AX_Z(0, 0.035, 1.2)); // suppressor
  // Scope: tube, bells, turrets, rings.
  b.add(cyl(0.016, 0.016, 0.24, 10), p.poly, AX_Z(0, 0.1, 0.4));
  b.add(cyl(0.028, 0.017, 0.09, 10), p.poly, AX_Z(0, 0.1, 0.56));
  b.add(cyl(0.021, 0.016, 0.06, 10), p.poly, AX_Z(0, 0.1, 0.27));
  b.add(cyl(0.026, 0.026, 0.004, 10), p.glass, AX_Z(0, 0.1, 0.607));
  b.add(cyl(0.012, 0.012, 0.03, 6), p.metal, T(0, 0.125, 0.41));
  b.add(cyl(0.012, 0.012, 0.03, 6), p.metal, T(-0.025, 0.1, 0.41, 0, 0, Math.PI / 2));
  b.add(rbox(0.03, 0.04, 0.02), p.metal, T(0, 0.07, 0.33));
  b.add(rbox(0.03, 0.04, 0.02), p.metal, T(0, 0.07, 0.48));
  // Folded bipod.
  b.add(cyl(0.006, 0.006, 0.22, 4), p.metal, T(0.016, -0.008, 0.66, Math.PI / 2 - 0.04));
  b.add(cyl(0.006, 0.006, 0.22, 4), p.metal, T(-0.016, -0.008, 0.66, Math.PI / 2 - 0.04));
  return { gripR: new THREE.Vector3(0, -0.035, 0.268), gripL: new THREE.Vector3(0, 0.012, 0.52), muzzle: new THREE.Vector3(0, 0.035, 1.3), leftUnder: true };
}

type Part = Omit<GunSpec, "geo" | "pivot" | "kick">;

function wood(): Paint {
  return paint(0x6a3a1e, SURF.hard, 0.6);
}

/** AKM: wood stock and handguard, stamped receiver, curved steel mag, slant brake. */
function ak(b: GeoBuilder, p: Pal): Part {
  const w = wood();
  b.add(profile([[0, -0.07], [0, 0.03], [0.22, 0.045], [0.22, 0.012], [0.04, -0.035], [0.015, -0.072]], 0.036), w);
  b.add(rbox(0.04, 0.058, 0.25, 8, 5, 0.15), p.metal, T(0, 0.02, 0.34));
  b.add(rbox(0.042, 0.02, 0.22, 8, 5, 0.3), shade(p.metal, 1.2), T(0, 0.058, 0.33)); // dust cover
  b.add(rbox(0.01, 0.01, 0.06), p.worn, T(-0.024, 0.042, 0.36)); // charging handle
  b.add(rbox(0.006, 0.01, 0.09), p.worn, T(-0.022, 0.012, 0.31)); // selector lever
  b.add(rbox(0.026, 0.075, 0.034, 8, 4, 0.3), shade(w, 0.6), T(0, -0.035, 0.248, 0.32));
  b.add(profile([[0.37, -0.01], [0.42, -0.01], [0.455, -0.18], [0.41, -0.19]], 0.026, 0.003), shade(p.metal, 1.3));
  b.add(rbox(0.05, 0.05, 0.2, 8, 4, 0.25), w, T(0, 0.026, 0.56));
  b.add(rbox(0.036, 0.02, 0.14, 8, 4, 0.3), w, T(0, 0.06, 0.53)); // upper handguard
  b.add(cyl(0.009, 0.009, 0.25, 7), p.metal, AX_Z(0, 0.035, 0.75));
  b.add(cyl(0.006, 0.006, 0.2, 5), p.metal, AX_Z(0, 0.065, 0.66)); // gas tube
  b.add(rbox(0.012, 0.04, 0.02), p.metal, T(0, 0.06, 0.82)); // front sight block
  b.add(rbox(0.024, 0.024, 0.04, 6, 4, 0.2), p.worn, T(0, 0.035, 0.89)); // slant brake
  b.add(rbox(0.02, 0.016, 0.05), p.metal, T(0, 0.075, 0.45)); // rear sight
  return { gripR: new THREE.Vector3(0, -0.03, 0.245), gripL: new THREE.Vector3(0, 0.02, 0.56), muzzle: new THREE.Vector3(0, 0.035, 0.91), leftUnder: true };
}

/** AUG-style bullpup: one-piece stock with the mag behind the grip, integral optic. */
function bullpup(b: GeoBuilder, p: Pal): Part {
  b.add(rbox(0.05, 0.12, 0.32, 8, 5, 0.25), p.fde, T(0, 0.02, 0.17));
  b.add(rbox(0.04, 0.03, 0.08, 6, 4, 0.3), shade(p.fde, 0.8), T(0, 0.075, 0.08)); // cheek
  b.add(profile([[0.12, -0.04], [0.16, -0.04], [0.17, -0.17], [0.13, -0.17]], 0.026, 0.003), p.glass); // translucent mag
  b.add(rbox(0.028, 0.085, 0.034, 8, 4, 0.3), p.fde, T(0, -0.05, 0.36, 0.2));
  b.add(rbox(0.04, 0.012, 0.16, 6, 4, 0.3), p.fde, T(0, -0.07, 0.34)); // full-hand trigger guard
  b.add(rbox(0.04, 0.04, 0.18, 8, 4, 0.2), p.metal, T(0, 0.05, 0.42));
  b.add(cyl(0.025, 0.025, 0.14, 10), p.poly, AX_Z(0, 0.115, 0.38)); // optic tube
  b.add(cyl(0.02, 0.02, 0.003, 10), p.glass, AX_Z(0, 0.115, 0.452));
  b.add(rbox(0.026, 0.075, 0.034, 8, 4, 0.3), p.fde, T(0, -0.03, 0.55, -0.15)); // folding foregrip
  b.add(cyl(0.011, 0.011, 0.28, 8), p.metal, AX_Z(0, 0.045, 0.64));
  b.add(cyl(0.015, 0.015, 0.05, 8), p.worn, AX_Z(0, 0.045, 0.8));
  return { gripR: new THREE.Vector3(0, -0.04, 0.355), gripL: new THREE.Vector3(0, -0.05, 0.55), muzzle: new THREE.Vector3(0, 0.045, 0.83), leftUnder: false };
}

/** MP5 / Uzi class: short receiver, slim curved mag, retractable stock. */
function smg(b: GeoBuilder, p: Pal): Part {
  b.add(rbox(0.036, 0.09, 0.02, 6, 4, 0.3), p.poly, T(0, 0.0, 0.01));
  b.add(cyl(0.006, 0.006, 0.16, 4), p.metal, AX_Z(0.016, 0.03, 0.09));
  b.add(cyl(0.006, 0.006, 0.16, 4), p.metal, AX_Z(-0.016, 0.03, 0.09));
  b.add(cyl(0.025, 0.025, 0.26, 10), p.metal, AX_Z(0, 0.045, 0.3)); // round receiver
  b.add(rbox(0.026, 0.075, 0.034, 8, 4, 0.3), p.poly, T(0, -0.02, 0.22, 0.3));
  b.add(profile([[0.29, 0.02], [0.315, 0.02], [0.33, -0.13], [0.3, -0.135]], 0.02, 0.003), p.metal);
  b.add(rbox(0.044, 0.05, 0.13, 8, 4, 0.3), p.poly, T(0, 0.03, 0.44)); // tropical handguard
  b.add(cyl(0.009, 0.009, 0.08, 7), p.metal, AX_Z(0, 0.045, 0.53));
  b.add(cyl(0.012, 0.012, 0.025, 8), p.worn, AX_Z(0, 0.045, 0.57));
  b.add(cyl(0.012, 0.012, 0.03, 8), p.metal, T(0, 0.08, 0.2, 0, 0, Math.PI / 2)); // diopter
  b.add(rbox(0.012, 0.03, 0.02), p.metal, T(0, 0.075, 0.5)); // front hood
  return { gripR: new THREE.Vector3(0, -0.02, 0.218), gripL: new THREE.Vector3(0, 0.02, 0.44), muzzle: new THREE.Vector3(0, 0.045, 0.585), leftUnder: true };
}

/** P90: smooth bullpup shell, thumbhole grip, top translucent mag. */
function p90(b: GeoBuilder, p: Pal): Part {
  b.add(rbox(0.055, 0.1, 0.4, 10, 6, 0.4), p.poly, T(0, 0.01, 0.2));
  b.add(rbox(0.05, 0.03, 0.3, 8, 4, 0.4), p.glass, T(0, 0.072, 0.24)); // top mag
  b.add(rbox(0.04, 0.03, 0.08, 6, 4, 0.3), p.poly, T(0, 0.11, 0.3)); // optic
  b.add(rbox(0.04, 0.03, 0.004), p.glass, T(0, 0.115, 0.341));
  b.add(rbox(0.05, 0.04, 0.06, 8, 4, 0.3), shade(p.poly, 0.8), T(0, -0.06, 0.31)); // grip loop
  b.add(cyl(0.01, 0.01, 0.06, 7), p.metal, AX_Z(0, 0.02, 0.43));
  return { gripR: new THREE.Vector3(0, -0.045, 0.3), gripL: new THREE.Vector3(0, -0.04, 0.38), muzzle: new THREE.Vector3(0, 0.02, 0.46), leftUnder: false };
}

/** PKM: skeleton wood stock, belt box on the right, fluted barrel, bipod. */
function pkm(b: GeoBuilder, p: Pal): Part {
  const w = wood();
  b.add(profile([[0, -0.07], [0, 0.04], [0.04, 0.045], [0.2, 0.04], [0.2, 0.005], [0.04, -0.035], [0.015, -0.072]], 0.03), w);
  b.add(rbox(0.05, 0.075, 0.3, 8, 5, 0.12), p.metal, T(0, 0.03, 0.36));
  b.add(rbox(0.05, 0.02, 0.2, 8, 5, 0.3), p.worn, T(0, 0.075, 0.38)); // feed cover
  b.add(rbox(0.026, 0.08, 0.034, 8, 4, 0.3), w, T(0, -0.04, 0.25, 0.3));
  b.add(rbox(0.07, 0.11, 0.13, 8, 4, 0.15), shade(p.metal, 1.3), T(0.06, -0.05, 0.38)); // ammo box
  b.add(cyl(0.013, 0.013, 0.5, 8), p.metal, AX_Z(0, 0.04, 0.75));
  for (let i = 0; i < 4; i++) b.add(cyl(0.0145, 0.0145, 0.01, 8), shade(p.metal, 0.7), AX_Z(0, 0.04, 0.58 + i * 0.05));
  b.add(cyl(0.008, 0.008, 0.25, 5), p.metal, AX_Z(0, 0.01, 0.65)); // gas tube
  b.add(cyl(0.018, 0.018, 0.05, 8), p.worn, AX_Z(0, 0.04, 1.02));
  b.add(rbox(0.012, 0.05, 0.02), p.metal, T(0, 0.075, 0.97)); // front post
  b.add(rbox(0.03, 0.012, 0.07), p.metal, T(0, 0.045, 0.6)); // carry handle
  b.add(cyl(0.006, 0.006, 0.28, 4), p.metal, T(0.016, -0.005, 0.83, Math.PI / 2 - 0.05));
  b.add(cyl(0.006, 0.006, 0.28, 4), p.metal, T(-0.016, -0.005, 0.83, Math.PI / 2 - 0.05));
  return { gripR: new THREE.Vector3(0, -0.04, 0.248), gripL: new THREE.Vector3(0, 0.02, 0.55), muzzle: new THREE.Vector3(0, 0.04, 1.05), leftUnder: true };
}

/** SVD: thumbhole wood stock with cheek rest, long slim barrel, PSO-1 offset left. */
function svd(b: GeoBuilder, p: Pal): Part {
  const w = wood();
  b.add(profile([[0, -0.08], [0, 0.04], [0.06, 0.05], [0.22, 0.04], [0.22, -0.01], [0.17, -0.015], [0.15, -0.06], [0.1, -0.03], [0.03, -0.08]], 0.036), w);
  b.add(rbox(0.03, 0.03, 0.09, 6, 4, 0.3), shade(w, 0.8), T(0, 0.07, 0.11)); // cheek rest
  b.add(rbox(0.04, 0.055, 0.24, 8, 5, 0.15), p.metal, T(0, 0.02, 0.33));
  b.add(rbox(0.026, 0.07, 0.13, 6, 4, 0.2), p.metal, T(0, -0.04, 0.38, 0.12)); // mag
  b.add(rbox(0.05, 0.05, 0.22, 8, 4, 0.25), w, T(0, 0.028, 0.56));
  b.add(cyl(0.009, 0.009, 0.45, 7), p.metal, AX_Z(0, 0.035, 0.89));
  b.add(cyl(0.013, 0.013, 0.07, 8), p.worn, AX_Z(0, 0.035, 1.14)); // flash hider
  b.add(cyl(0.015, 0.015, 0.24, 10), p.poly, AX_Z(-0.03, 0.1, 0.34)); // PSO-1
  b.add(cyl(0.022, 0.015, 0.06, 10), p.poly, AX_Z(-0.03, 0.1, 0.48));
  b.add(rbox(0.06, 0.06, 0.02), p.poly, T(-0.03, 0.105, 0.2)); // eyecup
  b.add(rbox(0.02, 0.05, 0.08), p.metal, T(-0.02, 0.06, 0.34)); // side mount
  return { gripR: new THREE.Vector3(0, -0.035, 0.24), gripL: new THREE.Vector3(0, 0.015, 0.56), muzzle: new THREE.Vector3(0, 0.035, 1.18), leftUnder: true };
}

/** M82: massive upper, cooling slots, arrowhead brake, big scope, bipod. */
function m82(b: GeoBuilder, p: Pal): Part {
  b.add(profile([[0, -0.08], [0, 0.04], [0.25, 0.045], [0.25, -0.01], [0.05, -0.04], [0.02, -0.08]], 0.05), p.poly);
  b.add(rbox(0.07, 0.1, 0.5, 8, 5, 0.12), p.metal, T(0, 0.03, 0.45));
  for (let i = 0; i < 6; i++) b.add(rbox(0.072, 0.012, 0.03), shade(p.metal, 0.5), T(0, 0.06, 0.55 + i * 0.05));
  b.add(rbox(0.03, 0.085, 0.04, 8, 4, 0.3), p.poly, T(0, -0.05, 0.3, 0.3));
  b.add(rbox(0.04, 0.09, 0.09, 6, 4, 0.15), p.metal, T(0, -0.06, 0.4)); // 10-rd mag
  b.add(cyl(0.016, 0.016, 0.45, 8), p.metal, AX_Z(0, 0.045, 0.92));
  b.add(rbox(0.07, 0.04, 0.09, 6, 4, 0.2), p.worn, T(0, 0.045, 1.18)); // brake
  b.add(cyl(0.02, 0.02, 0.3, 10), p.poly, AX_Z(0, 0.13, 0.4));
  b.add(cyl(0.032, 0.02, 0.1, 10), p.poly, AX_Z(0, 0.13, 0.6));
  b.add(cyl(0.03, 0.03, 0.004, 10), p.glass, AX_Z(0, 0.13, 0.652));
  b.add(rbox(0.035, 0.05, 0.02), p.metal, T(0, 0.095, 0.33));
  b.add(rbox(0.035, 0.05, 0.02), p.metal, T(0, 0.095, 0.5));
  b.add(rbox(0.015, 0.05, 0.1), p.poly, T(0, 0.11, 0.7)); // carry handle
  b.add(cyl(0.007, 0.007, 0.3, 4), p.metal, T(0.02, -0.015, 0.75, Math.PI / 2 - 0.05));
  b.add(cyl(0.007, 0.007, 0.3, 4), p.metal, T(-0.02, -0.015, 0.75, Math.PI / 2 - 0.05));
  return { gripR: new THREE.Vector3(0, -0.045, 0.298), gripL: new THREE.Vector3(0, 0.02, 0.62), muzzle: new THREE.Vector3(0, 0.045, 1.23), leftUnder: true };
}

/** Third-person family for each enemy kit. */
const KIT_GUN: Record<string, ThirdPersonKind> = { rusher: "shotgun", heavy: "lmg", warden: "lmg", sniper: "bolt" };

/**
 * Build (uncached) a weapon. `tp` picks the family (teammates show their
 * primary); without it the enemy kit decides. Cached by the caller.
 */
export function buildGun(kit: Kit, accent: number, vest: number, tp?: ThirdPersonKind): GunSpec {
  const b = new GeoBuilder();
  const tint = new THREE.Color(vest).lerp(new THREE.Color(0x8a7a5a), 0.55).getHex();
  const p = palette(accent, tint);
  let s: Part;
  let kick = 1;
  const pivot = new THREE.Vector3(-0.09, 0.385, 0.1);
  const fam = tp ?? KIT_GUN[kit] ?? "carbine";
  switch (fam) {
    case "shotgun":
      s = shotgun(b, p);
      kick = 2.2;
      break;
    case "lmg":
      s = lmg(b, p, kit === "warden");
      kick = kit === "warden" ? 0.7 : 0.8;
      // Warden braces at the hip: butt under the right arm.
      if (kit === "warden" && !tp) pivot.set(-0.11, 0.21, 0.1);
      else pivot.set(-0.1, 0.37, 0.1);
      break;
    case "pkm":
      s = pkm(b, p);
      kick = 0.85;
      pivot.set(-0.1, 0.37, 0.1);
      break;
    case "bolt":
      s = boltRifle(b, p);
      kick = 2.6;
      break;
    case "svd":
      s = svd(b, p);
      kick = 1.8;
      break;
    case "m82":
      s = m82(b, p);
      kick = 3;
      pivot.set(-0.1, 0.375, 0.1);
      break;
    case "ak":
      s = ak(b, p);
      kick = 1.15;
      break;
    case "bullpup":
      s = bullpup(b, p);
      break;
    case "smg":
      s = smg(b, p);
      kick = 0.7;
      break;
    case "p90":
      s = p90(b, p);
      kick = 0.6;
      break;
    default:
      s = carbine(b, p);
  }
  return { ...s, geo: b.merge()!, kick, pivot };
}
