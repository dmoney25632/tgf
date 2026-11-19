import * as THREE from "three";
import { type GeoBuilder, type P2, circle, extrude, latheZ, place, rrect, shape, slot } from "./geo";
import type { ViewmodelMaterials } from "./materials";

/** Builder + materials, passed to every part function. */
export type Kit = { b: GeoBuilder; m: ViewmodelMaterials };

/**
 * Reusable, original-design weapon components. Gun space: sight line on the
 * Z axis (x = y = 0), -Z forward, metres.
 */

/** Picatinny-style rail: dovetail base + cross-slotted teeth. Top surface at yTop. */
export function rail(k: Kit, mat: THREE.Material, z0: number, z1: number, yTop: number, w = 0.021, x = 0) {
  const yb = yTop - 0.0076;
  const hw = w / 2;
  k.b.section(mat, [[-hw + 0.002, yb], [hw - 0.002, yb], [hw, yb + 0.0022], [hw - 0.002, yb + 0.0043], [-hw + 0.002, yb + 0.0043], [-hw, yb + 0.0022]], z0, z1, { bev: 0.0005, x });
  const len = Math.abs(z1 - z0);
  const n = Math.max(1, Math.floor(len / 0.01));
  const start = Math.max(z0, z1) - (len - n * 0.01) / 2 - 0.005;
  for (let i = 0; i < n; i++) {
    k.b.box(mat, w * 0.74, 0.0034, 0.0052, x, yTop - 0.0017, start - i * 0.01, { bev: 0 });
  }
}

/** Rail along the side of a part (rotated 90° about Z). */
export function sideRail(k: Kit, mat: THREE.Material, z0: number, z1: number, xOut: number, y: number, w = 0.019) {
  const s = Math.sign(xOut);
  const len = Math.abs(z1 - z0);
  const n = Math.max(1, Math.floor(len / 0.01));
  const start = Math.max(z0, z1) - (len - n * 0.01) / 2 - 0.005;
  k.b.box(mat, 0.0042, w, len, xOut - s * 0.0021, y, (z0 + z1) / 2, { bev: 0.0006 });
  for (let i = 0; i < n; i++) k.b.box(mat, 0.0034, w * 0.74, 0.0052, xOut + s * 0.0017, y, start - i * 0.01, { bev: 0 });
}

/** Side plate with M-LOK-style slots. */
export function slottedPlate(k: Kit, mat: THREE.Material, z0: number, z1: number, y0: number, y1: number, x: number, thick: number, slots: number, slotLen = 0.03) {
  const holes: P2[][] = [];
  const zFront = Math.min(z0, z1);
  const zBack = Math.max(z0, z1);
  const span = zBack - zFront;
  const pitch = span / slots;
  for (let i = 0; i < slots; i++) {
    const zc = zBack - pitch * (i + 0.5);
    holes.push(slot(Math.min(slotLen, pitch * 0.72), 0.0074, zc, (y0 + y1) / 2, 2));
  }
  k.b.profile(mat, [[zBack, y1], [zFront, y1], [zFront, y0], [zBack, y0]], thick, x, { bev: 0.0007, holes });
}

/** Bottom plate with slots (shape drawn in (x, z), extruded along Y). */
export function slottedFloor(k: Kit, mat: THREE.Material, z0: number, z1: number, w: number, y: number, thick: number, slots: number) {
  const zFront = Math.min(z0, z1);
  const zBack = Math.max(z0, z1);
  const pitch = (zBack - zFront) / slots;
  const holes: P2[][] = [];
  for (let i = 0; i < slots; i++) {
    const zc = zBack - pitch * (i + 0.5);
    holes.push(rrect(0.0074, Math.min(0.03, pitch * 0.72), 0.0037, 0, zc, 3));
  }
  const sh = shape([[-w / 2, zFront], [w / 2, zFront], [w / 2, zBack], [-w / 2, zBack]], holes);
  const g = extrude(sh, thick, { bev: 0.0007 });
  g.rotateX(Math.PI / 2); // shape y → world -z… fix below
  // After rotateX(+90°): (x, s, e) → (x, -e, s). s = z ✓, extrusion → -y.
  k.b.add(mat, g, place(0, y, 0));
}

/** Hollow-ish tube (outer + inner wall) along Z. */
export function tube(k: Kit, mat: THREE.Material, ro: number, ri: number, z0: number, z1: number, x: number, y: number, seg = 18, bev = 0.0012) {
  const zf = Math.min(z0, z1);
  const zb = Math.max(z0, z1);
  k.b.lathe(mat, [[ri, zb], [ro - bev, zb], [ro, zb - bev], [ro, zf + bev], [ro - bev, zf], [ri, zf], [ri, zb]], x, y, { seg });
}

/** Barrel with a slight taper from r0 (rear) to r1 (front). */
export function barrel(k: Kit, mat: THREE.Material, zRear: number, zFront: number, y: number, r0: number, r1: number) {
  k.b.lathe(mat, [[0, zRear], [r0, zRear], [r0, zRear - 0.02], [r1, zFront + 0.002], [r1 - 0.0012, zFront], [r1 * 0.45, zFront], [r1 * 0.45, zFront + 0.006], [0, zFront + 0.006]], 0, y, { seg: 16 });
}

/** Three-port muzzle brake (lathe body + dark side ports). */
export function muzzleBrake(k: Kit, mat: THREE.Material, zRear: number, y: number, r: number, len: number) {
  const zf = zRear - len;
  k.b.lathe(mat, [
    [0, zRear], [r * 0.8, zRear], [r * 0.8, zRear - 0.004], [r, zRear - 0.006], [r, zf + 0.004], [r - 0.002, zf], [r * 0.45, zf], [r * 0.45, zf + 0.004], [0, zf + 0.004],
  ], 0, y, { seg: 14 });
  // Ports: dark recesses on both sides and a top vent pair.
  for (let i = 0; i < 3; i++) {
    const z = zRear - 0.012 - i * ((len - 0.018) / 3);
    for (const sx of [-1, 1]) k.b.box(k.m.polymer, 0.002, r * 1.1, (len - 0.02) / 4.2, sx * (r - 0.0006), y, z, { bev: 0.0003 });
    k.b.box(k.m.polymer, r * 0.5, 0.002, (len - 0.02) / 5, 0, y + r - 0.0006, z, { bev: 0.0003 });
  }
}

/** Birdcage-style flash hider (prongs). */
export function flashHider(k: Kit, mat: THREE.Material, zRear: number, y: number, r: number, len: number) {
  const zf = zRear - len;
  k.b.lathe(mat, [[0, zRear], [r * 0.85, zRear], [r, zRear - 0.004], [r, zRear - len * 0.35], [r * 0.9, zRear - len * 0.4], [0, zRear - len * 0.4]], 0, y, { seg: 14 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    k.b.box(mat, r * 0.55, 0.0028, len * 0.6, Math.cos(a) * (r - 0.0016), y + Math.sin(a) * (r - 0.0016), zf + len * 0.3, { rz: a + Math.PI / 2, bev: 0.0005 });
  }
}

/** Trigger guard loop + curved trigger blade. Guard top at yTop, trigger at zt. */
export function triggerGroup(k: Kit, mat: THREE.Material, trigMat: THREE.Material, zBack: number, zFront: number, yTop: number, depth = 0.022, thick = 0.011) {
  const yb = yTop - depth;
  const outer: P2[] = [[zBack, yTop], [zBack + 0.002, yb + 0.006], [zBack - 0.006, yb], [zFront + 0.004, yb], [zFront, yb + 0.004], [zFront, yTop]];
  const inner: P2[] = [[zBack - 0.004, yTop + 0.001], [zBack - 0.004, yb + 0.008], [zBack - 0.009, yb + 0.0035], [zFront + 0.006, yb + 0.0035], [zFront + 0.0035, yb + 0.006], [zFront + 0.0035, yTop + 0.001]];
  k.b.profile(mat, outer, thick, 0, { bev: 0.0012, holes: [inner] });
  // Trigger: a curved blade.
  const zt = zBack + (zFront - zBack) * 0.45;
  const t: P2[] = [];
  for (let i = 0; i <= 5; i++) {
    const s = i / 5;
    t.push([zt + Math.sin(s * 1.3) * 0.006 - 0.0015, yTop + 0.002 - s * (depth * 0.7)]);
  }
  for (let i = 5; i >= 0; i--) {
    const s = i / 5;
    t.push([zt + Math.sin(s * 1.3) * 0.006 + 0.0022 - s * 0.001, yTop + 0.002 - s * (depth * 0.7)]);
  }
  k.b.profile(trigMat, t, 0.0055, 0, { bev: 0.0008, seg: 2 });
}

/**
 * Pistol grip with finger ridges, drawn from the top attach point running
 * down/back at `rake` radians. Returns the grip axis (top → bottom) for the hand.
 */
export function pistolGrip(k: Kit, mat: THREE.Material, zTop: number, yTop: number, len: number, rake: number, depth = 0.034, thick = 0.03) {
  const dz = Math.sin(rake);
  const dy = -Math.cos(rake);
  const pts: P2[] = [];
  // Back edge (top → bottom) with a palm swell.
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    const swell = Math.sin(s * Math.PI) * 0.004;
    pts.push([zTop + depth / 2 + dz * len * s + swell * Math.cos(rake), yTop + dy * len * s + swell * dz]);
  }
  // Bottom flare.
  pts.push([zTop + depth / 2 + dz * len + 0.002, yTop + dy * len - 0.004]);
  pts.push([zTop - depth / 2 + dz * len - 0.002, yTop + dy * len - 0.004]);
  // Front edge (bottom → top) with finger ridges.
  for (let i = 8; i >= 0; i--) {
    const s = i / 8;
    const ridge = i > 0 && i < 8 ? (i % 2 ? 0.0028 : 0) : 0;
    pts.push([zTop - depth / 2 + dz * len * s - ridge * Math.cos(rake), yTop + dy * len * s - ridge * dz]);
  }
  pts.push([zTop - depth / 2 - 0.004, yTop + 0.004]);
  pts.push([zTop + depth / 2 + 0.006, yTop + 0.004]);
  k.b.profile(mat, pts, thick, 0, { bev: 0.0045, bevSeg: 2, seg: 2 });
  return { top: [0, yTop - 0.008, zTop + 0.002] as [number, number, number], axis: [0, dy, dz] as [number, number, number] };
}

/** Curved box magazine (local origin = top centre). Body below y = 0. */
export function boxMag(k: Kit, mat: THREE.Material, depth: number, len: number, curve: number, width: number, opts: { ribs?: boolean; rounds?: THREE.Material; plate?: THREE.Material; window?: boolean } = {}) {
  const n = 8;
  const back: P2[] = [];
  const front: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const zc = -curve * t * t;
    const y = -len * t;
    back.push([zc + depth / 2, y]);
    front.push([zc - depth / 2 + (t > 0.05 ? 0 : 0.002), y]);
  }
  const pts = back.concat(front.reverse());
  k.b.profile(mat, pts, width, 0, { bev: 0.0016, bevSeg: 1 });
  // Front/back spines + side ribs.
  if (opts.ribs) {
    for (let i = 1; i <= 3; i++) {
      const t = 0.25 + i * 0.17;
      const zc = -curve * t * t;
      k.b.box(mat, width + 0.002, 0.0035, depth * 0.72, 0, -len * t, zc, { bev: 0.0009, rx: Math.atan((2 * curve * t) / len) });
    }
  }
  // Floor plate.
  const tb = 1;
  const zcB = -curve * tb;
  k.b.box(opts.plate ?? mat, width + 0.0035, 0.008, depth + 0.006, 0, -len - 0.002, zcB, { bev: 0.0018, rx: Math.atan((2 * curve) / len) });
  // Top rounds.
  if (opts.rounds) {
    k.b.lathe(opts.rounds, [[0, depth / 2 - 0.004], [0.0048, depth / 2 - 0.004], [0.0048, -depth / 2 + 0.018], [0.0032, -depth / 2 + 0.008], [0.0016, -depth / 2 + 0.003], [0, -depth / 2 + 0.002]], 0.0025, 0.0045, { seg: 8 });
  }
}

/** Collapsible stock body (side profile) + rubber pad. */
export function stock(k: Kit, mat: THREE.Material, pad: THREE.Material, z0: number, yTop: number, len: number, h: number, thick = 0.036) {
  const z1 = z0 + len;
  const pts: P2[] = [
    [z0, yTop - 0.003], [z0 + len * 0.35, yTop + 0.004], [z1 - 0.004, yTop + 0.004], [z1, yTop], [z1, yTop - h], [z1 - 0.012, yTop - h - 0.003],
    [z1 - len * 0.32, yTop - h * 0.62], [z0 + len * 0.3, yTop - h * 0.42], [z0 + 0.008, yTop - h * 0.36], [z0, yTop - h * 0.3],
  ];
  const holes = [slot(0.024, 0.008, z1 - 0.03, yTop - h * 0.72, 3)];
  k.b.profile(mat, pts, thick, 0, { bev: 0.004, bevSeg: 2, seg: 2, holes });
  // Butt pad.
  k.b.profile(pad, [[z1, yTop + 0.002], [z1 + 0.011, yTop + 0.001], [z1 + 0.012, yTop - h - 0.002], [z1, yTop - h - 0.003]], thick + 0.002, 0, { bev: 0.003, bevSeg: 2 });
  // Cheek-weld texture strip + adjustment latch.
  k.b.box(pad, thick * 0.8, 0.004, len * 0.4, 0, yTop + 0.004, z0 + len * 0.6, { bev: 0.0015 });
  k.b.box(mat, 0.012, 0.01, 0.03, 0, yTop - h * 0.42 - 0.004, z0 + len * 0.22, { bev: 0.002 });
}

// ---- Optics -----------------------------------------------------------------

/** Tube red-dot on a cantilever mount. Lens / dot centred on the sight line. */
export function redDot(k: Kit, zc: number, railTop: number) {
  const { b, m } = k;
  const L = 0.06;
  const ro = 0.0172;
  tube(k, m.anodized, ro, ro - 0.0026, zc + L / 2, zc - L / 2, 0, 0, 22, 0.0015);
  // Front sunshade lip + rear rubber ring.
  tube(k, m.anodized, ro + 0.0012, ro - 0.0015, zc - L / 2 + 0.006, zc - L / 2, 0, 0, 22, 0.0006);
  tube(k, m.rubber, ro + 0.001, ro - 0.002, zc + L / 2, zc + L / 2 - 0.006, 0, 0, 22, 0.0008);
  // Turret housing (brightness right, windage top).
  b.box(m.anodized, 0.022, 0.012, 0.024, 0, ro - 0.001, zc + 0.003, { bev: 0.002, seg: 2 });
  b.lathe(m.anodized, [[0, 0], [0.0065, 0], [0.0065, -0.008], [0.0055, -0.009], [0, -0.009]], 0, ro + 0.004, { seg: 12, rx: Math.PI / 2, z: zc + 0.003 });
  b.lathe(m.anodized, [[0, 0], [0.0075, 0], [0.0075, -0.011], [0.006, -0.012], [0, -0.012]], ro + 0.002, 0, { seg: 14, ry: -Math.PI / 2, z: zc + 0.004 });
  // Mount: riser block + clamp bar onto the rail.
  const mh = -ro - railTop;
  b.profile(m.anodized, [[zc + 0.022, railTop], [zc - 0.016, railTop], [zc - 0.02, railTop + mh * 0.6], [zc - 0.01, -ro + 0.004], [zc + 0.018, -ro + 0.004], [zc + 0.026, railTop + mh * 0.5]], 0.02, 0, { bev: 0.0015 });
  b.box(m.steel, 0.026, 0.006, 0.012, 0, railTop + 0.002, zc + 0.008, { bev: 0.001 });
  b.cyl(m.steel, 0.003, zc + 0.002, zc + 0.014, 0.014, railTop + 0.002, 8, { ry: Math.PI / 2, s: [1, 1, 1] });
  // Glass + reticle.
  const lens = new THREE.CircleGeometry(ro - 0.0024, 20);
  b.add(m.lens, lens, place(0, 0, zc - L / 2 + 0.008));
  const dot = new THREE.CircleGeometry(0.00075, 10);
  b.add(m.reticleRed, dot, place(0, 0, zc - L / 2 + 0.0085));
  return { eye: zc + L / 2 };
}

/** Box holographic-style sight with a ring-and-dot reticle. */
export function holoSight(k: Kit, zc: number, railTop: number) {
  const { b, m } = k;
  const W = 0.036;
  const H = 0.03;
  const D = 0.05;
  const wall = 0.0032;
  // Window frame: a hood with a rectangular hole (drawn in the x/y plane).
  const outer = rrect(W, H, 0.006, 0, 0.002, 3);
  const inner = rrect(W - 2 * wall, H - 2 * wall - 0.002, 0.003, 0, 0.002, 3);
  b.section(m.anodized, outer, zc + D * 0.15, zc - D * 0.45, { bev: 0.0012, holes: [inner] });
  // Base housing (battery + electronics) down to the rail.
  b.section(m.anodized, rrect(W * 0.9, -railTop - H / 2 + 0.004, 0.003, 0, (railTop + (-H / 2 + 0.002 + 0.003)) / 2, 2), zc + D * 0.5, zc - D * 0.5, { bev: 0.0016 });
  // Buttons + battery cap on the right.
  for (let i = 0; i < 3; i++) b.box(m.rubber, 0.006, 0.006, 0.006, 0.006 * (i - 1), railTop + 0.012 + (-H / 2 + 0.002 - railTop) * 0, zc + D * 0.5 - 0.001, { bev: 0.0015 });
  b.lathe(m.anodized, [[0, 0], [0.0065, 0], [0.0065, -0.004], [0, -0.004]], W * 0.45, railTop + 0.009, { seg: 12, ry: -Math.PI / 2, z: zc + 0.01 });
  // Clamp knob (left).
  b.lathe(m.steel, [[0, 0], [0.005, 0], [0.005, -0.006], [0, -0.006]], -W * 0.45, railTop + 0.004, { seg: 10, ry: Math.PI / 2, z: zc - 0.01 });
  // Glass panes.
  const pane = new THREE.PlaneGeometry(W - 2 * wall, H - 2 * wall - 0.002);
  b.add(m.lens, pane.clone(), place(0, 0.002, zc - D * 0.45 + 0.002));
  b.add(m.lens, pane, place(0, 0.002, zc + D * 0.15 - 0.002));
  // Reticle: 1.6° ring with a centre dot, on the sight line.
  const ring = new THREE.RingGeometry(0.0046, 0.0053, 32);
  b.add(m.reticleRed, ring, place(0, 0, zc - D * 0.45 + 0.003));
  b.add(m.reticleRed, new THREE.CircleGeometry(0.0006, 10), place(0, 0, zc - D * 0.45 + 0.003));
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    b.add(m.reticleRed, new THREE.PlaneGeometry(0.0004, 0.0016), place(Math.cos(a) * 0.0062, Math.sin(a) * 0.0062, zc - D * 0.45 + 0.003, { rz: a + Math.PI / 2 }));
  }
  return { eye: zc + D * 0.15 };
}

/** Compact prism optic with rubber eyecup and an amber horseshoe reticle. */
export function prismSight(k: Kit, zc: number, railTop: number) {
  const { b, m } = k;
  const L = 0.075;
  // Body: chamfered box housing around the axis + objective/eyepiece tubes.
  b.section(m.anodized, rrect(0.036, 0.034, 0.008, 0, -0.002, 3), zc + L * 0.2, zc - L * 0.25, { bev: 0.002 });
  tube(k, m.anodized, 0.0185, 0.0155, zc - L * 0.25, zc - L * 0.5, 0, 0, 22, 0.0012);
  tube(k, m.rubber, 0.019, 0.015, zc + L * 0.5, zc + L * 0.2, 0, 0, 22, 0.002);
  // Base down to the rail with cross-bolt.
  b.section(m.anodized, rrect(0.028, -railTop - 0.017, 0.002, 0, (railTop - 0.019) / 2, 2), zc + L * 0.18, zc - L * 0.25, { bev: 0.0012 });
  b.cyl(m.steel, 0.003, zc - 0.006, zc + 0.006, 0.016, railTop + 0.003, 8, { ry: Math.PI / 2 });
  // Turret caps.
  b.lathe(m.anodized, [[0, 0], [0.007, 0], [0.007, -0.007], [0, -0.007]], 0, 0.017, { seg: 12, rx: Math.PI / 2, z: zc });
  b.lathe(m.anodized, [[0, 0], [0.007, 0], [0.007, -0.007], [0, -0.007]], 0.018, 0, { seg: 12, ry: -Math.PI / 2, z: zc });
  b.add(m.lensCoated, new THREE.CircleGeometry(0.0155, 20), place(0, 0, zc - L * 0.5 + 0.004, { ry: Math.PI }));
  b.add(m.lens, new THREE.CircleGeometry(0.015, 20), place(0, 0, zc + L * 0.2 + 0.002));
  // Reticle: horseshoe + dot.
  b.add(m.reticleAmber, new THREE.RingGeometry(0.0034, 0.0039, 28, 1, Math.PI * 0.65, Math.PI * 1.7), place(0, 0, zc - L * 0.15));
  b.add(m.reticleAmber, new THREE.CircleGeometry(0.0005, 8), place(0, 0, zc - L * 0.15));
  b.add(m.reticleAmber, new THREE.PlaneGeometry(0.0003, 0.0026), place(0, -0.0024, zc - L * 0.15));
  return { eye: zc + L * 0.5 };
}

/** Variable-power rifle scope: bells, saddle, turrets, rings. */
export function rifleScope(k: Kit, zc: number, railTop: number) {
  const { b, m } = k;
  const r = 0.0152;
  b.lathe(m.anodized, [
    [0.0225, zc - 0.155], [0.0245, zc - 0.152], [0.0245, zc - 0.12], [0.023, zc - 0.112], [r, zc - 0.085], [r, zc + 0.03],
    [0.0175, zc + 0.04], [0.0185, zc + 0.05], [0.0185, zc + 0.07], [0.0205, zc + 0.08], [0.0205, zc + 0.115], [0.019, zc + 0.12], [0.017, zc + 0.12],
    [0.017, zc + 0.115], [0.0, zc + 0.115],
  ], 0, 0, { seg: 20 });
  // Power ring knurl + throw lever.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(m.rubber, 0.003, 0.002, 0.016, Math.cos(a) * 0.0192, Math.sin(a) * 0.0192, zc + 0.06, { rz: a + Math.PI / 2, bev: 0.0005 });
  }
  b.box(m.anodized, 0.004, 0.012, 0.006, 0.02, 0.006, zc + 0.06, { bev: 0.001, rz: -0.6 });
  // Objective rim (front) inside the bell.
  b.lathe(m.anodized, [[0.0225, zc - 0.155], [0.0205, zc - 0.155], [0.0205, zc - 0.145], [0.0225, zc - 0.145]], 0, 0, { seg: 24 });
  b.add(m.lensCoated, new THREE.CircleGeometry(0.0207, 24), place(0, 0, zc - 0.146, { ry: Math.PI }));
  b.add(m.lens, new THREE.CircleGeometry(0.0172, 24), place(0, 0, zc + 0.114));
  // Saddle + turrets (elevation top, windage right, parallax left).
  b.section(m.anodized, rrect(0.036, 0.036, 0.009, 0, 0, 3), zc - 0.035, zc + 0.005, { bev: 0.0025 });
  const turret = (x: number, y: number, rx: number, ry: number, rad: number, h: number) => {
    b.lathe(m.anodized, [[0, 0], [rad, 0], [rad, -h * 0.85], [rad - 0.0015, -h], [0, -h]], x, y, { seg: 16, rx, ry, z: zc - 0.015 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ox = Math.cos(a) * rad;
      const oy = Math.sin(a) * rad;
      if (rx) b.box(m.anodized, 0.0018, h * 0.5, 0.0018, x + ox, y + h * 0.55, zc - 0.015 + oy);
      else b.box(m.anodized, h * 0.5, 0.0018, 0.0018, x + Math.sign(x) * h * 0.55, y + ox, zc - 0.015 + oy);
    }
  };
  turret(0, 0.018, Math.PI / 2, 0, 0.0105, 0.016);
  turret(0.018, 0, 0, -Math.PI / 2, 0.0095, 0.013);
  turret(-0.018, 0, 0, Math.PI / 2, 0.0085, 0.01);
  // Rings + mount bases.
  for (const z of [zc - 0.07, zc + 0.022]) {
    const ro = r + 0.004;
    b.lathe(m.anodized, [[r, z + 0.008], [ro, z + 0.008], [ro + 0.0005, z], [ro, z - 0.008], [r, z - 0.008]], 0, 0, { seg: 20 });
    b.profile(m.anodized, [[z + 0.009, railTop], [z - 0.009, railTop], [z - 0.007, -r - 0.002], [z + 0.007, -r - 0.002]], 0.02, 0, { bev: 0.0012 });
    b.box(m.steel, 0.026, 0.005, 0.01, 0, railTop + 0.0025, z, { bev: 0.0009 });
    b.cyl(m.steel, 0.0022, z - 0.003, z + 0.003, ro + 0.001, 0.006, 8, { ry: Math.PI / 2 });
    b.cyl(m.steel, 0.0022, z - 0.003, z + 0.003, -ro - 0.001, 0.006, 8, { ry: Math.PI / 2 });
  }
  return { eye: zc + 0.12 };
}

/** Low-profile folded backup sights (rear + front). */
export function foldedIrons(k: Kit, zRear: number, zFront: number, railTop: number) {
  const { b, m } = k;
  b.box(m.anodized, 0.02, 0.008, 0.026, 0, railTop + 0.004, zRear, { bev: 0.0015 });
  b.box(m.anodized, 0.016, 0.004, 0.022, 0, railTop + 0.0095, zRear + 0.002, { bev: 0.0012 });
  b.box(m.anodized, 0.018, 0.008, 0.024, 0, railTop + 0.004, zFront, { bev: 0.0015 });
  b.box(m.anodized, 0.012, 0.004, 0.02, 0, railTop + 0.0095, zFront - 0.002, { bev: 0.0012 });
}

/** Aperture rear sight with protective ears; aperture centred on the sight line. */
export function apertureRear(k: Kit, mat: THREE.Material, z: number, baseY: number, ringR = 0.0042) {
  const { b } = k;
  const hole = circle(ringR * 0.55, 0, 0, 14);
  b.section(mat, circle(ringR + 0.003, 0, 0, 16), z + 0.002, z - 0.002, { bev: 0.0006, holes: [hole] });
  b.box(mat, 0.007, -baseY - ringR, 0.004, 0, (baseY - ringR - 0.002) / 2, z, { bev: 0.0006 });
  for (const sx of [-1, 1]) b.box(mat, 0.0035, -baseY + 0.006, 0.012, sx * (ringR + 0.006), (baseY + 0.006) / 2, z + 0.001, { bev: 0.0008 });
  b.box(mat, ringR * 2 + 0.016, 0.006, 0.02, 0, baseY + 0.003, z + 0.002, { bev: 0.0012 });
}

/** Front post with wings; post tip exactly on the sight line. */
export function frontPost(k: Kit, mat: THREE.Material, z: number, baseY: number, insert?: THREE.Material) {
  const { b } = k;
  b.box(mat, 0.0024, -baseY, 0.0028, 0, baseY / 2, z, { bev: 0.0004 });
  for (const sx of [-1, 1]) b.profile(mat, [[z + 0.006, baseY], [z - 0.006, baseY], [z - 0.004, 0.002], [z + 0.004, 0.002]], 0.0026, sx * 0.0072, { bev: 0.0005 });
  b.box(mat, 0.018, 0.005, 0.016, 0, baseY + 0.0025, z, { bev: 0.001 });
  if (insert) b.add(insert, new THREE.CircleGeometry(0.0008, 8), place(0, -0.0016, z + 0.0015));
}

/** Rotate a lathe-around-Z geometry part to run along X (helpers for pins). */
export function pinX(k: Kit, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number) {
  k.b.add(mat, latheZ([[0, len / 2], [r, len / 2], [r, -len / 2], [0, -len / 2]], 8), place(x, y, z, { ry: Math.PI / 2 }));
}

/** Small flat-faced cylinder pointing along ±X (buttons, screws). */
export function buttonX(k: Kit, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number) {
  const s = Math.sign(x) || 1;
  k.b.add(mat, latheZ([[0, 0], [r, 0], [r, -h * 0.8], [r * 0.8, -h], [0, -h]], 10), place(x, y, z, { ry: -s * Math.PI / 2 }));
}

/** Simple shape helper re-export for gun files. */
export { extrude, shape, rrect, slot, circle, place };
