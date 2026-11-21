import * as THREE from "three";
import type { GrenadeType } from "../weapons";
import { type P2, extrude, latheZ, place, shape } from "./geo";
import { buildArm } from "./hands";
import type { Kit } from "./parts";
import { type GunSpec, newSpec } from "./common";

/**
 * KA-BAR fighting knife: black-coated clip-point blade with a bright edge
 * bevel and fuller, oval steel guard, stacked-leather handle with rings,
 * steel pommel. Drawn along -Z (edge down) from the guard.
 */
function knifeBody(k: Kit) {
  const { b, m } = k;
  const blade: P2[] = [[0.0, 0.0125], [-0.12, 0.0125], [-0.145, 0.0105], [-0.17, 0.002], [-0.182, -0.004], [-0.168, -0.01], [-0.12, -0.0135], [-0.03, -0.0145], [0.0, -0.0135]];
  const g = extrude(shape(blade.map(([z, y]) => [-z, y])), 0.0046, { bev: 0.0016 });
  g.rotateY(Math.PI / 2);
  b.add(m.bladeCoat, g, place(0, 0, -0.02));
  // Ground edge (bright), clip bevel, fuller groove.
  b.box(m.blade, 0.0048, 0.0032, 0.135, 0, -0.0125, -0.1, { bev: 0.0012 });
  b.box(m.blade, 0.0046, 0.003, 0.04, 0, 0.007, -0.168, { rx: 0.35, bev: 0.001 });
  b.box(m.polymer, 0.005, 0.003, 0.09, 0, 0.004, -0.08, { bev: 0.0008 });
  // Guard, stacked leather handle with grip rings, pommel.
  b.box(m.steel, 0.012, 0.042, 0.006, 0, -0.001, -0.017, { bev: 0.002, seg: 2 });
  const handle: P2[] = [[0.0105, -0.014]];
  for (let i = 0; i <= 12; i++) {
    const z = -0.012 + i * 0.0072;
    handle.push([0.0118 - (i % 2) * 0.0009 + Math.sin((i / 12) * Math.PI) * 0.001, z]);
  }
  handle.push([0.0105, 0.08]);
  b.lathe(m.wood, handle, 0, -0.002, { s: [0.85, 1.25, 1], seg: 12 });
  b.lathe(m.steel, [[0, 0.08], [0.0112, 0.08], [0.0124, 0.086], [0.009, 0.094], [0, 0.096]], 0, -0.002, { s: [0.85, 1.2, 1], seg: 12 });
}

/** Knife in a right fist (quick melee). Group origin ≈ the fist. */
export function buildKnife(k: Kit, group: THREE.Group) {
  k.b.into(group);
  knifeBody(k);
  buildArm(k.b, k.m, { at: [0, 0.0, 0.016], axis: [0, 0, 1], palm: [0.15, -1, 0], elbow: [0.12, -0.15, 0.45] }, { r: 0.0125, thumb: "wrap", tight: 1.05 });
}

/**
 * Equipped knife as a "weapon": right fist low and forward, blade out,
 * support hand held up as a guard. No ammo, no mag; the viewmodel animates
 * slashes and stabs from `melee` progress.
 */
export function buildKnifeSpec(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("knife");
  const hold = new THREE.Group();
  hold.rotation.set(0.25, 0.15, -0.35);
  g.root.add(hold);
  b.into(hold);
  knifeBody(k);
  buildArm(b, m, { at: [0, 0.0, 0.016], axis: [0, 0, 1], palm: [0.15, -1, 0], elbow: [0.14, -0.2, 0.42] }, { r: 0.0125, thumb: "wrap", tight: 1.05 });
  b.into(g.leftArm);
  buildArm(b, m, { at: [-0.16, -0.02, 0.02], axis: [0.2, -1, 0.3], palm: [0.6, 0, -0.6], elbow: [-0.24, -0.3, 0.26], left: true, watch: true }, { r: 0.012, thumb: "wrap", tight: 1.1 });
  g.muzzle.position.set(0, 0, -0.2);
  g.shell = null;
  g.hip.set(0.12, -0.1, -0.3);
  g.hipRot.set(0, 0, 0);
  g.ads.copy(g.hip);
  g.handgun = true;
  g.flash = "pistol";
  g.flashScale = 0.01;
  g.reload = "none";
  g.boltTravel = 0;
  return g;
}

export type GrenadeModel = { group: THREE.Group; pin: THREE.Group; spoon: THREE.Group };

/** Throwable in a left hand: M67 frag, M84 stun or M18 smoke. */
export function buildGrenade(k: Kit, group: THREE.Group, type: GrenadeType): GrenadeModel {
  const { b, m } = k;
  const pin = new THREE.Group();
  const spoon = new THREE.Group();
  group.add(pin, spoon);
  b.into(group);
  let topY = 0.032;
  if (type === "frag") {
    // M67: 64 mm steel sphere, olive drab, yellow band under the fuze.
    const body: P2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      body.push([Math.cos(a) * 0.032, Math.sin(a) * 0.032]);
    }
    b.add(m.polymerOlive, latheZ(body, 18), place(0, 0, 0, { rx: -Math.PI / 2 }));
    b.lathe(m.paint, [[0.0175, -0.0012], [0.018, 0], [0.0175, 0.0012]], 0, 0.027, { rx: -Math.PI / 2, seg: 16 });
    topY = 0.03;
  } else if (type === "flash") {
    // M84: perforated steel tube with end caps.
    b.cyl(m.steel, 0.022, -0.052, 0.052, 0, 0, 18, { rx: -Math.PI / 2 });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (r % 2) * 0.5;
      b.add(m.polymer, new THREE.CircleGeometry(0.0045, 10), place(Math.cos(a) * 0.0222, -0.03 + r * 0.02, Math.sin(a) * 0.0222, { ry: Math.PI / 2 - a }));
    }
    for (const y of [-0.052, 0.046]) b.cyl(m.polymerGray, 0.0235, 0, 0.006, 0, y, 18, { rx: -Math.PI / 2 });
    topY = 0.054;
  } else {
    // M18: tall olive can with a coloured top band and painted markings.
    b.cyl(m.polymerOlive, 0.031, -0.07, 0.058, 0, 0, 22, { rx: -Math.PI / 2 });
    b.cyl(m.paintRed, 0.0315, 0.045, 0.058, 0, 0, 22, { rx: -Math.PI / 2 });
    b.box(m.paint, 0.02, 0.012, 0.0008, 0, -0.01, 0.0312, { bev: 0 });
    topY = 0.06;
  }
  // Fuze body, striker lever (spoon) down the side, safety pin + ring.
  b.lathe(m.steel, [[0, 0], [0.011, 0], [0.011, -0.014], [0.008, -0.018], [0, -0.018]], 0, topY + 0.002, { rx: Math.PI / 2, seg: 12 });
  b.into(spoon);
  b.box(m.steel, 0.012, 0.003, 0.06, 0, topY + 0.008, 0.02, { rx: -0.35, bev: 0.0008 });
  b.box(m.steel, 0.012, 0.05, 0.003, 0, topY - 0.02, 0.036, { rx: 0.08, bev: 0.0008 });
  b.into(pin);
  b.add(m.steel, new THREE.TorusGeometry(0.011, 0.0013, 6, 18), place(0.016, topY + 0.012, 0.0, { ry: Math.PI / 2 }));
  b.rod(m.steel, [0.016, topY + 0.012, 0.0], [-0.012, topY + 0.012, 0.0], 0.0009, 6);
  b.into(group);
  buildArm(b, m, { at: [0, 0.0, 0.0], axis: [0, -1, 0.2], palm: [0, 0, 1], elbow: [-0.15, -0.22, 0.42], left: true, watch: true }, { r: type === "frag" ? 0.033 : 0.026, thumb: "wrap", tight: 0.9 });
  return { group, pin, spoon };
}
