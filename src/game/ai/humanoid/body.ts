import * as THREE from "three";
import { cyl, dome, ellipsoid, GeoBuilder, loft, MIRROR_X, paint, rbox, seeded, shade, T, type ColorFn, type Paint } from "./geo";
import type { CamoStyle, Kit } from "./kit";
import { SURF } from "./materials";
import { BONES, RIG, type BoneName } from "./rig";

export type LookDef = {
  uniform: number;
  vest: number;
  helmet: number;
  skin: number;
  accent: number;
  kit: Kit;
  scale: number;
  /** Optional camo pattern; derived from the uniform colour when omitted. */
  camo?: CamoStyle;
  /** Optional headgear / pack variant (0..2); cycles per instance when omitted. */
  variant?: number;
};

export type HitDims = { size: [number, number, number]; at: [number, number, number] };
export type BodyBuild = {
  bones: Partial<Record<BoneName, THREE.BufferGeometry>>;
  ghillie: Partial<Record<BoneName, THREE.BufferGeometry>>;
  elite: { armR: THREE.BufferGeometry; armL: THREE.BufferGeometry; head: THREE.BufferGeometry };
  hit: Record<"head" | "spine" | "pelvis" | "uArm" | "fArm" | "hand" | "thigh" | "shin" | "foot", HitDims>;
  /** Width factor (heavier kits are bulkier). */
  w: number;
  /** Ground-contact sample points for death settling: [bone, x, y, z]. */
};

function camoFor(hex: number): CamoStyle {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  if (hsl.s < 0.09 || hsl.l < 0.16) return "digital";
  const deg = hsl.h * 360;
  if (deg >= 22 && deg < 52 && hsl.l > 0.2) return "arid";
  if (deg >= 52 && deg < 170) return "woodland";
  return "digital";
}
const CAMO_SURF: Record<CamoStyle, number> = { woodland: SURF.woodland, digital: SURF.digital, arid: SURF.arid };

const gauss = (x: number, w: number) => Math.exp(-(x * x) / (w * w));
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** Right-side transform, mirrored for the left (side = -1). */
function sided(side: number, m: THREE.Matrix4) {
  return side > 0 ? m : MIRROR_X.clone().multiply(m);
}

/** Sculpted head: a deformed sphere with jaw, brow, cheekbones and chin. */
const HEAD = { rx: 0.077, ry: 0.108, rz: 0.098, y: 0.12, z: 0.012 };
function headGeo() {
  const g = new THREE.SphereGeometry(1, 14, 10);
  const P = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), z = P.getZ(i);
    const y = P.getY(i);
    if (y < -0.15) {
      const t = (-0.15 - y) / 0.85;
      x *= 1 - 0.3 * t;
      z = z > 0 ? z * (1 - 0.04 * t) : z * (1 - 0.45 * t);
    }
    if (z < 0 && y > -0.35) z *= 1.07;
    if (z > 0.55) z = 0.55 + (z - 0.55) * 0.55;
    const front = Math.max(0, z);
    z += 0.07 * gauss(y - 0.3, 0.12) * front * (Math.abs(x) < 0.75 ? 1 : 0.3);
    x += Math.sign(x) * 0.05 * gauss(y + 0.05, 0.16) * front;
    z += 0.09 * gauss(y + 0.8, 0.14) * Math.max(0, z - 0.15);
    z -= 0.06 * gauss(Math.abs(x) - 0.36, 0.14) * gauss(y - 0.13, 0.11) * (z > 0.45 ? 1 : 0);
    P.setXYZ(i, x * HEAD.rx, y * HEAD.ry, z * HEAD.rz);
  }
  g.computeVertexNormals();
  return g;
}

/** Converts a bone-space vertex back to the unit head frame. */
function headLocal(p: THREE.Vector3) {
  return { x: p.x / HEAD.rx, y: (p.y - HEAD.y) / HEAD.ry, z: (p.z - HEAD.z) / HEAD.rz };
}

export function buildBody(look: LookDef, variant: number): BodyBuild {
  const kit = look.kit;
  const heavy = kit === "heavy";
  const warden = kit === "warden";
  const armoured = heavy || warden;
  const w = warden ? 1.2 : heavy ? 1.14 : kit === "rusher" ? 0.97 : 1;
  const camo = CAMO_SURF[look.camo ?? camoFor(look.uniform)];
  const vestCamo = CAMO_SURF[look.camo ?? camoFor(look.vest)];

  // ---- Palette (all driven by the look colours) ---------------------------
  const uni = paint(look.uniform, camo, 0.92);
  const shirt = paint(mix(look.uniform, 0x8c887c, 0.3), SURF.nylon, 0.93);
  const vest = paint(look.vest, kit === "standard" || kit === "sniper" ? vestCamo : SURF.nylon, 0.86);
  const vestD = shade(vest, 0.72);
  const strap = paint(mix(look.vest, 0x1a1a18, 0.35), SURF.nylon, 0.88);
  const helm = paint(look.helmet, camo, 0.82);
  const shell = paint(look.helmet, SURF.hard, 0.5, 0.05);
  const skin = paint(look.skin, SURF.skin, 0.6);
  const glove = paint(mix(look.vest, 0x1c1b19, 0.6), SURF.nylon, 0.82);
  const boot = paint(mix(look.vest, 0x3b3226, 0.55), SURF.hard, 0.72);
  const sole = paint(0x151413, SURF.hard, 0.9);
  const poly = paint(0x1d1e20, SURF.hard, 0.62);
  const metal = paint(0x2a2b2e, SURF.hard, 0.4, 0.7);
  const rubber = paint(0x19191a, SURF.hard, 0.85);
  const lens = paint(0x0d1318, SURF.hard, 0.05, 0.4);
  const glow = paint(look.accent, SURF.hard, 0.4, 0, 1.8);
  const plate = paint(look.vest, SURF.hard, 0.55, 0.1); // hard armour shells
  const plateD = shade(plate, 0.65);

  const B = {} as Record<BoneName, GeoBuilder>;
  for (const b of BONES) B[b] = new GeoBuilder();
  // Decorrelate camo between bones (and left/right).
  BONES.forEach((b, i) => B[b].uvOffset.set(i * 0.37, i * 0.61));
  const add = (bone: BoneName, g: THREE.BufferGeometry, p: Paint, m?: THREE.Matrix4, fn?: ColorFn) => B[bone].add(g, p, m, fn);

  // =========================================================================
  // Pelvis (origin at the pelvis pivot, hip joints at y = -0.035)
  // =========================================================================
  add(
    "pelvis",
    loft(
      [
        { y: -0.13, rx: 0.115 * w, rz: 0.08 * w, p: 2.3 },
        { y: -0.085, rx: 0.152 * w, rz: 0.104 * w, p: 2.4 },
        { y: 0.0, rx: 0.156 * w, rz: 0.106 * w, cz: -0.004, p: 2.4 },
        { y: 0.08, rx: 0.146 * w, rz: 0.1 * w, p: 2.4 },
        { y: 0.14, rx: 0.14 * w, rz: 0.096 * w, p: 2.4 },
      ],
      12,
      true,
      false,
    ),
    uni,
  );
  // Belt with buckle, dump pouch, pistol mag pouches.
  add("pelvis", loft([{ y: 0.03, rx: 0.162 * w, rz: 0.112 * w, p: 2.5 }, { y: 0.078, rx: 0.158 * w, rz: 0.108 * w, p: 2.5 }], 12, false, false), strap);
  add("pelvis", rbox(0.05, 0.034, 0.012), metal, T(0, 0.054, 0.112 * w));
  if (!armoured) {
    add("pelvis", rbox(0.085, 0.11, 0.05, 8, 3, 0.35), vestD, T(-0.13, -0.02, -0.075, 0, -0.75));
    add("pelvis", rbox(0.035, 0.06, 0.022), vest, T(0.07, 0.035, 0.118));
    add("pelvis", rbox(0.035, 0.06, 0.022), vest, T(0.11, 0.035, 0.104, 0, 0.35));
  } else {
    // Groin / waist armour.
    add("pelvis", rbox(0.2 * w, 0.19, 0.05, 8, 3, 0.3), heavy ? vest : plate, T(0, -0.1, 0.105 * w, 0.12));
    add("pelvis", loft([{ y: -0.02, rx: 0.172 * w, rz: 0.122 * w, p: 2.6 }, { y: 0.1, rx: 0.168 * w, rz: 0.118 * w, p: 2.6 }], 12, false, false), heavy ? vestD : plateD);
  }

  // =========================================================================
  // Spine / torso (origin at the waist)
  // =========================================================================
  const tw = w;
  add(
    "spine",
    loft(
      [
        { y: -0.11, rx: 0.144 * tw, rz: 0.097 * tw, p: 2.4 },
        { y: 0.0, rx: 0.139 * tw, rz: 0.094 * tw, p: 2.4 },
        { y: 0.12, rx: 0.151 * tw, rz: 0.104 * tw, cz: 0.008, p: 2.4 },
        { y: 0.24, rx: 0.166 * tw, rz: 0.11 * tw, cz: 0.016, p: 2.5 },
        { y: 0.32, rx: 0.176 * tw, rz: 0.104 * tw, cz: 0.012, p: 2.6 },
        { y: 0.372, rx: 0.158 * tw, rz: 0.086 * tw, p: 2.4 },
        { y: 0.41, rx: 0.088, rz: 0.066, cz: -0.004, p: 2.2 },
        { y: 0.44, rx: 0.056, rz: 0.052, p: 2 },
      ],
      12,
      false,
      true,
    ),
    shirt,
  );
  // Collar.
  add("spine", loft([{ y: 0.385, rx: 0.08, rz: 0.07, cz: -0.004 }, { y: 0.425, rx: 0.068, rz: 0.062, cz: -0.006 }], 10, false, false), uni);

  if (kit === "standard") {
    // Plate carrier: front/back plates, cummerbund, shoulder straps.
    add("spine", rbox(0.265, 0.3, 0.042, 10, 5, 0.3), vest, T(0, 0.215, 0.132, -0.06));
    add("spine", rbox(0.265, 0.31, 0.042, 10, 5, 0.3), vest, T(0, 0.225, -0.122, 0.05));
    add("spine", loft([{ y: 0.02, rx: 0.164, rz: 0.116, cz: 0.004, p: 2.7 }, { y: 0.175, rx: 0.174, rz: 0.122, cz: 0.01, p: 2.7 }], 14, false, false), vest);
    for (const s of [1, -1]) {
      add("spine", rbox(0.058, 0.11, 0.022, 6, 4, 0.3), vest, sided(s, T(-0.092, 0.375, 0.095, -0.55)));
      add("spine", rbox(0.058, 0.024, 0.13, 6, 4, 0.3), vest, sided(s, T(-0.092, 0.418, -0.005)));
      add("spine", rbox(0.058, 0.11, 0.022, 6, 4, 0.3), vest, sided(s, T(-0.092, 0.375, -0.095, 0.55)));
    }
    // Triple mag pouches with mags, admin pouch, radio + antenna.
    for (const x of [-0.074, 0, 0.074]) {
      add("spine", rbox(0.066, 0.092, 0.046, 8, 4, 0.3), vestD, T(x, 0.12, 0.172, -0.04));
      add("spine", rbox(0.052, 0.034, 0.024, 6, 4, 0.2), poly, T(x, 0.178, 0.172, -0.04));
    }
    add("spine", rbox(0.19, 0.07, 0.026, 8, 4, 0.3), vest, T(0, 0.29, 0.162, -0.08));
    add("spine", rbox(0.05, 0.13, 0.068, 8, 4, 0.3), vestD, T(0.176, 0.13, -0.03));
    add("spine", cyl(0.004, 0.006, 0.3, 4), poly, T(0.178, 0.33, -0.065, 0, 0, -0.12));
    // IR marker on the shoulder strap (team-coloured glow).
    add("spine", rbox(0.014, 0.034, 0.014), glow, T(0.092, 0.355, 0.112, -0.55));
    // Back: hydration carrier, or an assault pack on variant 2.
    if (variant === 2) {
      add("spine", rbox(0.27, 0.36, 0.13, 10, 4, 0.3), vestD, T(0, 0.2, -0.205, 0.04));
      add("spine", rbox(0.26, 0.06, 0.135, 8, 4, 0.35), vest, T(0, 0.37, -0.205, 0.08));
      add("spine", rbox(0.05, 0.16, 0.08, 6, 4, 0.3), vest, T(0.15, 0.14, -0.2));
      add("spine", rbox(0.05, 0.16, 0.08, 6, 4, 0.3), vest, T(-0.15, 0.14, -0.2));
    } else {
      add("spine", rbox(0.19, 0.29, 0.055, 8, 4, 0.35), vestD, T(0, 0.22, -0.168, 0.05));
      add("spine", cyl(0.006, 0.006, 0.18, 4), rubber, T(-0.09, 0.39, 0.0, -0.3, 0, 0.1)); // drink tube
    }
  } else if (kit === "rusher") {
    // Light chest rig, shell bandolier, X-harness, breaching charge pack.
    add("spine", rbox(0.28, 0.16, 0.05, 10, 4, 0.3), vest, T(0, 0.14, 0.13, -0.05));
    for (const x of [-0.085, 0, 0.085]) add("spine", rbox(0.07, 0.08, 0.045, 8, 4, 0.3), vestD, T(x, 0.15, 0.165, -0.05));
    for (let i = 0; i < 8; i++) add("spine", cyl(0.0095, 0.0095, 0.045, 5), paint(0x7a2a1c, SURF.hard, 0.5), T(-0.105 + i * 0.03, 0.24, 0.142));
    add("spine", rbox(0.27, 0.02, 0.012), strap, T(0, 0.24, 0.13));
    for (const s of [1, -1]) {
      add("spine", rbox(0.05, 0.3, 0.014, 4, 4, 0), strap, T(0.0, 0.27, -0.105, 0.05, 0, s * 0.55));
      add("spine", rbox(0.045, 0.12, 0.02, 4, 4, 0), strap, sided(s, T(-0.09, 0.36, 0.1, -0.5)));
    }
    add("spine", rbox(0.24, 0.32, 0.05, 8, 4, 0.2), poly, T(0, 0.22, -0.15, 0.05));
    for (const x of [-0.07, 0, 0.07]) add("spine", cyl(0.026, 0.026, 0.3, 7), paint(mix(look.vest, 0x4a4a3a, 0.5), SURF.nylon, 0.8), T(x, 0.22, -0.195, 0.05));
    add("spine", rbox(0.09, 0.05, 0.04), poly, T(0.0, 0.4, -0.18));
    add("spine", rbox(0.016, 0.01, 0.006), glow, T(0.025, 0.42, -0.158));
    add("spine", new THREE.TorusGeometry(0.06, 0.008, 4, 10), paint(0xb88a2a, SURF.hard, 0.6), T(0.14, 0.18, -0.16, 0, Math.PI / 2));
  } else if (kit === "sniper") {
    // Light chest rig + rangefinder pouch; most is covered by the ghillie.
    add("spine", rbox(0.26, 0.14, 0.04, 10, 4, 0.3), vest, T(0, 0.13, 0.122, -0.05));
    for (const x of [-0.07, 0.07]) add("spine", rbox(0.075, 0.075, 0.04, 8, 4, 0.3), vestD, T(x, 0.13, 0.152, -0.05));
    add("spine", rbox(0.06, 0.09, 0.04, 8, 4, 0.3), vestD, T(0.17, 0.12, 0.02));
    for (const s of [1, -1]) add("spine", rbox(0.045, 0.12, 0.02, 4, 4, 0), strap, sided(s, T(-0.09, 0.36, 0.1, -0.5)));
    add("spine", rbox(0.2, 0.26, 0.06, 8, 4, 0.35), vestD, T(0, 0.22, -0.16, 0.05));
  } else if (heavy) {
    // Bomb-suit-style: padded bulk, big frontal plate, high collar.
    add("spine", loft([{ y: -0.05, rx: 0.172 * w, rz: 0.118 * w, p: 2.8 }, { y: 0.22, rx: 0.188 * w, rz: 0.128 * w, cz: 0.012, p: 2.8 }, { y: 0.35, rx: 0.18 * w, rz: 0.11 * w, p: 2.6 }], 14, false, false), vest);
    add("spine", rbox(0.36, 0.38, 0.075, 10, 5, 0.3), plate, T(0, 0.2, 0.15 * w, -0.05));
    add("spine", rbox(0.3, 0.12, 0.06, 10, 5, 0.35), plateD, T(0, -0.02, 0.15 * w, 0.1));
    add("spine", rbox(0.36, 0.4, 0.07, 10, 5, 0.3), plateD, T(0, 0.21, -0.14 * w, 0.05));
    add("spine", loft([{ y: 0.33, rx: 0.15, rz: 0.13, p: 2.4 }, { y: 0.43, rx: 0.13, rz: 0.115, p: 2.3 }, { y: 0.5, rx: 0.115, rz: 0.11, cz: 0.01, p: 2.2 }], 12, false, true), vestD);
    for (const x of [-0.09, 0.09]) add("spine", rbox(0.08, 0.04, 0.02), metal, T(x, 0.3, 0.195 * w));
    add("spine", rbox(0.1, 0.02, 0.01), glow, T(0, 0.37, 0.182 * w, -0.05));
  } else if (warden) {
    // Segmented lamellar chest, carapace back, gorget and a cooling pack.
    for (let i = 0; i < 4; i++) {
      const y = 0.34 - i * 0.09;
      add("spine", rbox(0.4 - i * 0.025, 0.1, 0.075, 8, 5, 0.3), i % 2 ? plateD : plate, T(0, y, 0.15 * w - i * 0.004, -0.18));
    }
    add("spine", rbox(0.42, 0.44, 0.1, 10, 5, 0.3), plateD, T(0, 0.2, -0.15 * w, 0.06));
    add("spine", loft([{ y: 0.34, rx: 0.16, rz: 0.14, p: 3 }, { y: 0.46, rx: 0.13, rz: 0.12, p: 3 }, { y: 0.5, rx: 0.12, rz: 0.115, p: 3 }], 12, false, true), plate);
    add("spine", rbox(0.3, 0.32, 0.13, 10, 4, 0.25), metal, T(0, 0.22, -0.27));
    for (const x of [-0.12, 0.12]) {
      add("spine", cyl(0.035, 0.035, 0.32, 8), plateD, T(x, 0.24, -0.33));
      add("spine", cyl(0.028, 0.028, 0.02, 8), glow, T(x, 0.41, -0.33));
    }
    add("spine", rbox(0.18, 0.016, 0.012), glow, T(0, 0.13, -0.338));
    add("spine", rbox(0.06, 0.02, 0.01), glow, T(0, 0.12, 0.2 * w, -0.18));
  }

  // =========================================================================
  // Head (origin at the neck base)
  // =========================================================================
  const face = kit === "standard" || kit === "sniper";
  const balaclava = kit === "standard" && variant === 1;
  const shemagh = (kit === "standard" && variant === 2) || kit === "sniper";
  add("head", loft([{ y: -0.04, rx: 0.056, rz: 0.056 }, { y: 0.05, rx: 0.05, rz: 0.052, cz: -0.004 }, { y: 0.1, rx: 0.054, rz: 0.058, cz: 0.004 }], 10, false, false), balaclava ? strap : skin);
  const lip = new THREE.Color(look.skin).lerp(new THREE.Color(0x8a3a32), 0.35);
  const stubble = new THREE.Color(look.skin).multiplyScalar(0.72);
  const socket = new THREE.Color(look.skin).multiplyScalar(0.6);
  const balaC = strap.color;
  const skinFn: ColorFn = (p, _n, c) => {
    const h = headLocal(p);
    if (balaclava && !(h.y > -0.02 && h.y < 0.33 && h.z > 0.2)) {
      c.copy(balaC);
      return SURF.nylon;
    }
    if (h.z > 0.3) {
      c.lerp(socket, 0.55 * gauss(Math.abs(h.x) - 0.36, 0.17) * gauss(h.y - 0.13, 0.12));
      c.lerp(lip, 0.7 * gauss(h.y + 0.47, 0.08) * gauss(h.x, 0.3));
    }
    if (h.y < -0.3) c.lerp(stubble, 0.4 * Math.min(1, (-0.3 - h.y) * 3));
    if (h.y > 0.55 && h.z < 0.6) c.lerp(stubble.clone().multiplyScalar(0.5), 0.6); // cropped hair
  };
  add("head", headGeo(), skin, T(0, HEAD.y, HEAD.z), skinFn);
  if (face) {
    for (const s of [1, -1]) {
      add("head", ellipsoid(0.013, 0.028, 0.02, 6, 4), balaclava ? strap : skin, sided(s, T(-0.078, 0.118, -0.002)));
      add("head", ellipsoid(0.012, 0.008, 0.006, 5, 3), paint(0x14110f, SURF.hard, 0.2), sided(s, T(-0.031, 0.134, 0.087)));
    }
    add("head", rbox(0.021, 0.042, 0.026, 6, 3, 0.3), balaclava ? strap : skin, T(0, 0.112, 0.103, -0.28), balaclava ? undefined : (_p, _n, c) => void c.multiplyScalar(0.95));
  }
  // Helmets / headgear per kit.
  let headTop = 0.255;
  if (kit === "standard") {
    const edge = (az: number) => 1.28 + 0.44 * (1 - Math.cos(az)) * 0.5 - 0.3 * gauss(Math.abs(az) - 1.5, 0.3);
    add("head", dome(0.111, 0.118, 0.127, edge, 16, 6), helm, T(0, 0.137, 0.006));
    add("head", rbox(0.046, 0.034, 0.024, 6, 4, 0.3), metal, T(0, 0.207, 0.128, -0.4)); // NVG shroud
    for (const s of [1, -1]) {
      add("head", rbox(0.007, 0.02, 0.1, 4, 4, 0), poly, sided(s, T(-0.112, 0.168, 0.002, 0, 0, 0.16))); // rails
      add("head", rbox(0.009, 0.075, 0.012, 4, 4, 0), strap, sided(s, T(-0.072, 0.075, 0.035, 0.3, 0, -0.1))); // chin strap
    }
    add("head", rbox(0.07, 0.05, 0.034, 6, 4, 0.3), vestD, T(0, 0.182, -0.128, 0.5)); // counterweight
    add("head", rbox(0.022, 0.012, 0.03), glow, T(0, 0.25, -0.05, 0.3)); // IR strobe
    add("head", rbox(0.05, 0.004, 0.035), vest, T(0, 0.255, 0.02)); // blank velcro
    headTop = 0.258;
    if (variant === 0) {
      add("head", loft([{ y: 0.152, rx: 0.115, rz: 0.13, cz: 0.006 }, { y: 0.172, rx: 0.114, rz: 0.129, cz: 0.006 }], 14, false, false), strap);
      add("head", rbox(0.12, 0.042, 0.03, 8, 3, 0.35), lens, T(0, 0.205, 0.118, -0.55));
    }
  } else if (kit === "rusher") {
    // Bump helmet (bare shell) + full-face respirator.
    const edge = (az: number) => 1.2 + 0.5 * (1 - Math.cos(az)) * 0.5 - 0.35 * gauss(Math.abs(az) - 1.5, 0.35);
    add("head", dome(0.108, 0.112, 0.122, edge, 14, 5), shell, T(0, 0.14, 0.004));
    add("head", ellipsoid(0.07, 0.078, 0.052, 10, 7), rubber, T(0, 0.104, 0.074));
    for (const s of [1, -1]) {
      add("head", ellipsoid(0.023, 0.021, 0.008, 8, 4), paint(0x1a2228, SURF.hard, 0.05, 0.3, 0.15), sided(s, T(-0.031, 0.136, 0.118, -0.15)));
      add("head", ellipsoid(0.012, 0.028, 0.02, 6, 4), skin, sided(s, T(-0.078, 0.118, -0.002)));
    }
    add("head", cyl(0.033, 0.033, 0.045, 9), paint(mix(look.accent, 0x2a2a2a, 0.6), SURF.hard, 0.6), T(0.035, 0.07, 0.125, 1.25, 0, -0.5));
    add("head", cyl(0.016, 0.02, 0.025, 7), rubber, T(0, 0.075, 0.125, 1.4));
    add("head", loft([{ y: 0.12, rx: 0.088, rz: 0.104, cz: 0.0 }, { y: 0.14, rx: 0.088, rz: 0.104 }], 12, false, false), rubber);
    add("head", rbox(0.02, 0.01, 0.02), glow, T(0, 0.255, -0.03));
    headTop = 0.255;
  } else if (kit === "sniper") {
    // Boonie hat; the ghillie hood hangs from the brim.
    add("head", cyl(0.094, 0.104, 0.075, 12), helm, T(0, 0.212, -0.002));
    add("head", cyl(0.1, 0.098, 0.02, 12), strap, T(0, 0.183, -0.002));
    add("head", cyl(0.17, 0.175, 0.01, 14), helm, T(0, 0.17, 0.0, -0.06));
    add("head", rbox(0.11, 0.022, 0.02, 6, 3, 0.4), lens, T(0, 0.135, 0.098));
    headTop = 0.25;
  } else if (heavy) {
    // Full EOD-style helmet with a wide visor.
    add("head", ellipsoid(0.148, 0.152, 0.158, 14, 10), shell, T(0, 0.13, 0.0));
    add("head", rbox(0.2, 0.095, 0.05, 10, 3, 0.3), lens, T(0, 0.135, 0.132, -0.08));
    add("head", rbox(0.17, 0.016, 0.01), glow, T(0, 0.138, 0.158, -0.08));
    add("head", rbox(0.06, 0.03, 0.08), metal, T(0, 0.28, -0.03));
    for (const s of [1, -1]) add("head", cyl(0.03, 0.03, 0.02, 8), metal, sided(s, T(-0.15, 0.13, 0.0, 0, 0, Math.PI / 2)));
    headTop = 0.285;
  } else if (warden) {
    // Angular faceplate helm with three vertical sensor slits and a crest.
    add("head", rbox(0.25, 0.25, 0.27, 10, 3.2, 0.35), shell, T(0, 0.135, -0.005));
    add("head", rbox(0.21, 0.18, 0.05, 10, 4, 0.3), plateD, T(0, 0.115, 0.13, -0.1));
    for (const x of [-0.045, 0, 0.045]) add("head", rbox(0.013, x === 0 ? 0.075 : 0.055, 0.01, 4, 4, 0), glow, T(x, 0.145, 0.158, -0.1));
    add("head", rbox(0.03, 0.045, 0.25, 6, 4, 0.3), metal, T(0, 0.265, -0.01));
    for (const s of [1, -1]) add("head", rbox(0.03, 0.12, 0.14, 6, 4, 0.3), plate, sided(s, T(-0.13, 0.11, -0.01, 0, 0, -0.08)));
    headTop = 0.29;
  }
  if (shemagh) {
    const cloth = paint(mix(look.uniform, 0xa89a78, 0.6), SURF.nylon, 0.95);
    add("head", loft([{ y: -0.035, rx: 0.095, rz: 0.09, cz: 0.004 }, { y: 0.02, rx: 0.084, rz: 0.088, cz: 0.012 }, { y: 0.07, rx: 0.077, rz: 0.094, cz: 0.02 }, { y: 0.098, rx: 0.07, rz: 0.088, cz: 0.022 }], 12, false, false), cloth);
    if (kit === "standard") add("head", rbox(0.1, 0.02, 0.018, 6, 3, 0.4), lens, T(0, 0.135, 0.099));
  }

  // =========================================================================
  // Arms (right built canonical with outward = -X; left mirrored)
  // =========================================================================
  for (const side of [1, -1]) {
    const ua: BoneName = side > 0 ? "uArmR" : "uArmL";
    const fa: BoneName = side > 0 ? "fArmR" : "fArmL";
    const hd: BoneName = side > 0 ? "handR" : "handL";
    const S = (m: THREE.Matrix4) => sided(side, m);
    const aw = armoured ? w * 1.04 : 1;
    add(ua, ellipsoid(0.062 * aw, 0.072, 0.066 * aw, 10, 7), uni, S(T(-0.008, -0.03, 0)));
    add(ua, loft([{ y: -0.31, rx: 0.043 * aw, rz: 0.045 * aw }, { y: -0.2, rx: 0.047 * aw, rz: 0.049 * aw }, { y: -0.1, rx: 0.053 * aw, rz: 0.056 * aw, cz: 0.003 }, { y: -0.02, rx: 0.056 * aw, rz: 0.058 * aw }], 10, false, false), uni, S(T()));
    if (!armoured) add(ua, rbox(0.006, 0.07, 0.06, 4, 4, 0), shade(uni, 0.9), S(T(-0.052, -0.1, 0.004))); // blank sleeve panel
    if (heavy) {
      add(ua, ellipsoid(0.088, 0.064, 0.088, 10, 6), plate, S(T(-0.02, 0.0, 0)));
      add(ua, rbox(0.03, 0.16, 0.08, 6, 4, 0.3), vest, S(T(-0.05, -0.15, 0)));
    } else if (warden) {
      add(ua, rbox(0.14, 0.04, 0.16, 8, 3, 0.35), plate, S(T(-0.04, 0.03, 0, 0, 0, 0.35)));
      add(ua, rbox(0.12, 0.035, 0.14, 8, 3, 0.35), plateD, S(T(-0.06, -0.035, 0, 0, 0, 0.5)));
      add(ua, rbox(0.035, 0.15, 0.085, 6, 4, 0.3), plate, S(T(-0.05, -0.17, 0)));
    }
    // Forearm: elbow cap, sleeve, glove cuff.
    add(fa, ellipsoid(0.046 * aw, 0.05, 0.048 * aw, 8, 6), uni, S(T(0, -0.005, 0)));
    add(fa, loft([{ y: -0.215, rx: 0.035 * aw, rz: 0.033 * aw }, { y: -0.15, rx: 0.04 * aw, rz: 0.041 * aw }, { y: -0.06, rx: 0.046 * aw, rz: 0.048 * aw }, { y: 0.01, rx: 0.044 * aw, rz: 0.046 * aw }], 10, false, false), uni, S(T()));
    add(fa, loft([{ y: -0.272, rx: 0.033 * aw, rz: 0.03 * aw }, { y: -0.205, rx: 0.038 * aw, rz: 0.036 * aw }], 8, false, false), glove, S(T()));
    if (armoured) add(fa, rbox(0.03, 0.17, 0.07, 6, 4, 0.3), warden ? plate : vest, S(T(-0.036, -0.13, 0)));
    // Gloved hand gripping around HAND_SOCKET.
    const gw = armoured ? 1.15 : 1;
    add(hd, rbox(0.032 * gw, 0.09, 0.084 * gw, 8, 3, 0.35), glove, S(T(0, -0.05, 0)));
    add(hd, rbox(0.01, 0.034, 0.074 * gw, 4, 4, 0), armoured ? plate : poly, S(T(-0.019, -0.083, 0)));
    for (let f = 0; f < 4; f++) {
      const z = (0.03 - f * 0.02) * gw;
      const len = f === 3 ? 0.038 : 0.046;
      add(hd, new THREE.BoxGeometry(len, 0.019, 0.018), glove, S(T(len / 2 - 0.004, -0.1, z)));
      add(hd, new THREE.BoxGeometry(0.018, 0.034, 0.017), glove, S(T(len - 0.004, -0.085, z)));
    }
    add(hd, new THREE.BoxGeometry(0.02, 0.045, 0.021), glove, S(T(0.016, -0.04, 0.045, 0, 0, 0.5)));
    add(hd, new THREE.BoxGeometry(0.035, 0.019, 0.019), glove, S(T(0.04, -0.06, 0.04, 0, -0.35, 0)));
  }

  // =========================================================================
  // Legs (origin at hip joint / knee / ankle)
  // =========================================================================
  for (const side of [1, -1]) {
    const th: BoneName = side > 0 ? "thighR" : "thighL";
    const sh: BoneName = side > 0 ? "shinR" : "shinL";
    const ft: BoneName = side > 0 ? "footR" : "footL";
    const S = (m: THREE.Matrix4) => sided(side, m);
    const lw = armoured ? w : 1;
    add(th, loft([{ y: -0.43, rx: 0.055 * lw, rz: 0.057 * lw }, { y: -0.3, rx: 0.066 * lw, rz: 0.07 * lw }, { y: -0.15, rx: 0.08 * lw, rz: 0.086 * lw, cz: 0.006 }, { y: -0.02, rx: 0.088 * lw, rz: 0.094 * lw }, { y: 0.06, rx: 0.084 * lw, rz: 0.09 * lw, cx: 0.008 }], 12, false, false), uni, S(T()));
    add(th, rbox(0.03, 0.12, 0.1, 6, 4, 0.3), shade(uni, 0.92), S(T(-0.082 * lw, -0.2, 0.0)));
    if (side > 0 && !armoured && kit !== "sniper") {
      // Drop-leg holster with pistol.
      add(th, rbox(0.032, 0.17, 0.085, 6, 4, 0.3), vestD, S(T(-0.1, -0.13, -0.005)));
      add(th, rbox(0.026, 0.07, 0.03, 6, 4, 0.3), poly, S(T(-0.104, -0.025, -0.03, 0.25)));
      for (const y of [-0.1, -0.2]) add(th, loft([{ y: y - 0.012, rx: 0.08, rz: 0.083 }, { y: y + 0.012, rx: 0.08, rz: 0.083 }], 10, false, false), strap, S(T()));
    }
    if (heavy) add(th, rbox(0.14, 0.24, 0.045, 8, 4, 0.3), plate, S(T(0, -0.18, 0.085 * w)));
    if (warden) {
      add(th, rbox(0.16, 0.18, 0.04, 8, 4, 0.3), plate, S(T(-0.02, -0.04, 0.08 * w, -0.12, 0, 0.1)));
      add(th, rbox(0.06, 0.2, 0.12, 6, 4, 0.3), plateD, S(T(-0.09 * w, -0.08, 0, 0, 0, 0.12)));
    }
    // Shin: knee cap, trouser, boot shaft, knee pad.
    add(sh, ellipsoid(0.056 * lw, 0.052, 0.06 * lw, 8, 6), uni, S(T(0, 0, 0.002)));
    add(sh, loft([{ y: -0.33, rx: 0.044 * lw, rz: 0.046 * lw }, { y: -0.26, rx: 0.046 * lw, rz: 0.048 * lw }, { y: -0.13, rx: 0.055 * lw, rz: 0.06 * lw, cz: -0.01 }, { y: -0.05, rx: 0.054 * lw, rz: 0.057 * lw, cz: -0.004 }, { y: 0.03, rx: 0.056 * lw, rz: 0.058 * lw }], 10, false, false), uni, S(T()));
    add(sh, loft([{ y: -0.43, rx: 0.052, rz: 0.062, cz: 0.006, p: 2.4 }, { y: -0.36, rx: 0.051, rz: 0.058, cz: 0.002 }, { y: -0.28, rx: 0.05, rz: 0.055 }], 10, false, false), boot, S(T()));
    if (armoured) {
      add(sh, rbox(0.11 * w, 0.27, 0.045, 8, 4, 0.3), plate, S(T(0, -0.17, 0.06 * w)));
      add(sh, ellipsoid(0.065, 0.06, 0.04, 8, 6), plateD, S(T(0, -0.01, 0.06 * w)));
    } else {
      add(sh, rbox(0.088, 0.105, 0.034, 8, 3, 0.4), poly, S(T(0, -0.02, 0.058, 0.1)));
      add(sh, loft([{ y: -0.065, rx: 0.059, rz: 0.062 }, { y: -0.045, rx: 0.059, rz: 0.062 }], 10, false, false), strap, S(T()));
    }
    // Boot: upper, toe, sole (sole bottom at ground: y = -RIG.ankle).
    const bw = armoured ? 1.12 : 1;
    add(ft, rbox(0.098 * bw, 0.078, 0.255, 10, 3, 0.35), boot, S(T(0, -0.035, 0.052)));
    add(ft, ellipsoid(0.048 * bw, 0.034, 0.06, 8, 5), boot, S(T(0, -0.045, 0.15)));
    add(ft, rbox(0.106 * bw, 0.022, 0.275, 8, 4, 0.2), sole, S(T(0, -RIG.ankle + 0.011, 0.055)));
    if (warden) add(ft, rbox(0.1, 0.05, 0.13, 6, 4, 0.3), plate, S(T(0, -0.01, 0.12, 0.3)));
  }

  // =========================================================================
  // Ghillie fringe (alpha cards) for the marksman
  // =========================================================================
  const ghillie: Partial<Record<BoneName, THREE.BufferGeometry>> = {};
  if (kit === "sniper") {
    const r = seeded(77 + variant);
    const tones = [look.uniform, look.vest, mix(look.uniform, 0x5c5a2e, 0.5), mix(look.vest, 0x6a5232, 0.45), mix(look.uniform, 0x8a8058, 0.4)];
    const card = (b: GeoBuilder, x: number, y: number, z: number, yaw: number, tilt: number, wd: number, ht: number) => {
      const g = new THREE.PlaneGeometry(wd, ht).translate(0, -ht / 2, 0);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      const tone = paint(tones[Math.floor(r() * tones.length)], SURF.hard, 1);
      tone.color.multiplyScalar(0.8 + r() * 0.4);
      b.add(g, tone, T(x, y, z, tilt, yaw, (r() - 0.5) * 0.5), undefined, true);
    };
    const gs = new GeoBuilder();
    for (let i = 0; i < 46; i++) {
      // Shoulders and upper back, sparse at the front so the rig reads.
      let a = (r() - 0.5) * Math.PI * 2;
      if (Math.abs(a) < 0.9 && r() < 0.7) a = Math.sign(a || 1) * (0.9 + r() * 2.2);
      const y = 0.3 + r() * 0.14;
      const rx = 0.19, rz = 0.13;
      card(gs, Math.sin(a) * rx, y, Math.cos(a) * rz, a, -0.25 - r() * 0.2, 0.09 + r() * 0.06, 0.18 + r() * 0.12);
    }
    ghillie.spine = gs.merge()!;
    const gh = new GeoBuilder();
    for (let i = 0; i < 18; i++) {
      let a = (r() - 0.5) * Math.PI * 2;
      if (Math.abs(a) < 0.7) a = Math.sign(a || 1) * (0.7 + r() * 2.4);
      card(gh, Math.sin(a) * 0.165, 0.18, Math.cos(a) * 0.17, a, -0.15 - r() * 0.15, 0.08 + r() * 0.05, 0.1 + r() * 0.09);
    }
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2;
      card(gh, Math.sin(a) * 0.07, 0.26, Math.cos(a) * 0.07, a, -1.1, 0.07, 0.12);
    }
    ghillie.head = gh.merge()!;
  }

  // =========================================================================
  // Elite markings
  // =========================================================================
  const eb = (side: number) => {
    const b = new GeoBuilder();
    const aw = armoured ? w * 1.04 : 1;
    b.add(loft([{ y: -0.16, rx: 0.051 * aw, rz: 0.053 * aw }, { y: -0.11, rx: 0.055 * aw, rz: 0.057 * aw }], 10, false, false), paint(0xffffff), sided(side, T(armoured ? -0.004 : 0)));
    return b.merge()!;
  };
  const stripe = new GeoBuilder();
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.32;
    const rad = headTop - 0.135;
    stripe.add(rbox(0.026, 0.008, 0.045, 4, 4, 0), paint(0xffffff), T(0, 0.135 + Math.cos(a) * rad + 0.003, Math.sin(a) * rad, a));
  }

  const bones: Partial<Record<BoneName, THREE.BufferGeometry>> = {};
  for (const b of BONES) {
    const g = B[b].merge();
    if (g) bones[b] = g;
  }

  const hw = armoured ? w : 1;
  const big = heavy ? 0.33 : warden ? 0.31 : 0.245;
  return {
    bones,
    ghillie,
    elite: { armR: eb(1), armL: eb(-1), head: stripe.merge()! },
    w,
    hit: {
      head: { size: [big, headTop - 0.025, big + 0.02], at: [0, (headTop + 0.015 + 0.04) / 2, 0.008] },
      spine: { size: [0.37 * hw, 0.48, 0.3 * hw], at: [0, 0.17, 0.012] },
      pelvis: { size: [0.32 * hw, 0.24, 0.23 * hw], at: [0, -0.02, 0] },
      uArm: { size: [0.12 * hw, 0.33, 0.12 * hw], at: [0, -0.14, 0] },
      fArm: { size: [0.095 * hw, 0.29, 0.1 * hw], at: [0, -0.125, 0] },
      hand: { size: [0.07, 0.13, 0.095], at: [0.012, -0.065, 0] },
      thigh: { size: [0.18 * hw, 0.5, 0.19 * hw], at: [0, -0.19, 0.004] },
      shin: { size: [0.125 * hw, 0.45, 0.135 * hw], at: [0, -0.2, 0] },
      foot: { size: [0.11, 0.085, 0.28], at: [0, -0.037, 0.055] },
    },
  };
}
