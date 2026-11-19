import * as THREE from "three";
import { rng, type BushPlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import type { WorldMat as MaterialName } from "../WorldMaterials";
import type { MeshBuilder } from "../MeshBuilder";
import { LIGHTS, PUMPJACKS, RACK, TANKS } from "../maps/cinderFlats";
import { band, clearOf, concertina, fbm2, pallets, poleLine, rubble, smoothstep, tyre, type Dressing, type PoleSpot } from "./common";

const BERM = 48;
const STEEL = 0x9a9c9c;
const STEEL_D = 0x55585a;
const WHITE = 0xe4dfd2;

const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Adds `geo` (disposed) at a local transform inside `frame` (or world when null). */
function put(B: MeshBuilder, geo: THREE.BufferGeometry, frame: THREE.Matrix4 | null, x: number, y: number, z: number, rx: number, ry: number, rz: number, mat: MaterialName, tint: number, uvScale: [number, number] = [1, 1]) {
  _e.set(rx, ry, rz, "YXZ");
  _l.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
  if (frame) _m.multiplyMatrices(frame, _l);
  else _m.copy(_l);
  B.add(geo, _m, mat, tint, { uv: "keep", uvScale });
  geo.dispose();
}

/** Cylinder between two points. */
function pipe(B: MeshBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: MaterialName, tint: number, seg = 10) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  _q.setFromUnitVectors(_p.set(0, 1, 0), _s.set(dx / len, dy / len, dz / len));
  _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, 1, 1));
  B.add(geo, _m, mat, tint, { uv: "keep", uvScale: [r * 6.28, len] });
  geo.dispose();
}

/** Vertical crude-oil storage tank: shell, stiffener rings, cone roof, ring footing, spiral stair. */
function storageTank(B: MeshBuilder, t: { x: number; z: number; r: number; h: number }, r: () => number) {
  put(B, new THREE.CylinderGeometry(t.r + 0.6, t.r + 0.7, 0.3, 40), null, t.x, 0.15, t.z, 0, 0, 0, "concrete_dirty", 0xb9b2a4, [8, 1]);
  put(B, new THREE.CylinderGeometry(t.r, t.r, t.h, 40, 1, true), null, t.x, t.h / 2 + 0.3, t.z, 0, r() * 6, 0, "metal_painted", WHITE, [t.r * 6.28, t.h]);
  put(B, new THREE.CylinderGeometry(t.r * 0.12, t.r + 0.12, t.r * 0.18, 40), null, t.x, t.h + 0.3 + t.r * 0.09, t.z, 0, 0, 0, "metal_painted", 0xcfcabd, [t.r * 6.28, t.r]);
  for (let y = 1.6; y < t.h; y += 2.4) put(B, new THREE.CylinderGeometry(t.r + 0.06, t.r + 0.06, 0.12, 40, 1, true), null, t.x, y + 0.3, t.z, 0, 0, 0, "metal_dark", STEEL_D);
  // Dirty band where crude has run down from the roof nozzles.
  put(B, new THREE.CylinderGeometry(t.r + 0.02, t.r + 0.02, 0.9, 40, 1, true), null, t.x, t.h - 0.2, t.z, 0, 0, 0, "metal_rust", 0x8a7a68, [t.r * 6.28, 1]);
  // Spiral stair: treads climbing ~300° around the shell, with a handrail post every few steps.
  const steps = Math.round(t.h / 0.3);
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < steps; i++) {
    const k = i / steps;
    const a = a0 + k * Math.PI * 1.65;
    const y = 0.3 + k * t.h;
    const x = t.x + Math.cos(a) * (t.r + 0.45), z = t.z + Math.sin(a) * (t.r + 0.45);
    put(B, new THREE.BoxGeometry(0.85, 0.05, 0.32), null, x, y, z, 0, -a, 0, "metal_dark", 0x6a6c6c);
    if (i % 4 === 0) {
      const ox = t.x + Math.cos(a) * (t.r + 0.85), oz = t.z + Math.sin(a) * (t.r + 0.85);
      pipe(B, ox, y, oz, ox, y + 1.0, oz, 0.025, "metal_dark", 0x8a6a2a, 5);
    }
  }
  // Inlet pipe at the base heading toward the yard.
  const ang = Math.atan2(-t.z, -t.x);
  const ix = t.x + Math.cos(ang) * t.r, iz = t.z + Math.sin(ang) * t.r;
  pipe(B, ix, 0.8, iz, ix + Math.cos(ang) * 3, 0.8, iz + Math.sin(ang) * 3, 0.22, "metal_painted", STEEL);
  put(B, new THREE.CylinderGeometry(0.34, 0.34, 0.1, 12), null, ix + Math.cos(ang) * 1.2, 0.8, iz + Math.sin(ang) * 1.2, 0, -ang, Math.PI / 2, "metal_dark", STEEL_D);
}

/** Beam pump ("nodding donkey") on a skid. Local +X is the beam axis, horse head at +X. */
function pumpJack(B: MeshBuilder, p: { x: number; z: number; alongX: boolean; color: number }, r: () => number) {
  const frame = new THREE.Matrix4().makeRotationY(p.alongX ? 0 : Math.PI / 2).setPosition(p.x, 0, p.z);
  const c = p.color;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, mat: MaterialName, tint: number) =>
    put(B, new THREE.BoxGeometry(w, h, d), frame, x, y, z, rx, ry, rz, mat, tint, [Math.max(w, d), h]);
  box(6.2, 0.16, 2.0, 0, 0.08, 0, 0, 0, 0, "concrete_dirty", 0xb4ac9c); // pad
  box(5.4, 0.3, 1.2, 0, 0.31, 0, 0, 0, 0, "metal_dark", STEEL_D); // skid
  // Samson post: two raked legs to the saddle bearing.
  for (const s of [-1, 1]) {
    box(0.16, 3.7, 0.16, 0.45, 2.15, s * 0.36, s * 0.16, 0, 0, "metal_painted", c);
    box(0.14, 3.6, 0.14, -0.55, 2.1, s * 0.36, s * 0.16, 0, -0.3, "metal_painted", c);
  }
  // Walking beam (each jack frozen at a different point of its stroke).
  const tilt = (r() - 0.5) * 0.3;
  box(5.8, 0.42, 0.32, 0.2, 3.95, 0, 0, 0, tilt, "metal_painted", c);
  // Horse head at the well end.
  const hx = 0.2 + 2.95 * Math.cos(tilt), hy = 3.95 + 2.95 * Math.sin(tilt);
  box(0.55, 1.7, 0.42, hx + 0.1, hy - 0.35, 0, 0, 0, tilt, "metal_painted", c);
  box(0.25, 1.4, 0.44, hx + 0.42, hy - 0.4, 0, 0, 0, tilt + 0.25, "metal_painted", c);
  // Bridle cables and polished rod down to the wellhead.
  const wx = hx + 0.55;
  for (const s of [-1, 1]) put(B, new THREE.CylinderGeometry(0.015, 0.015, hy - 1.6, 4, 1, true), frame, wx, (hy + 1.6) / 2 - 0.5, s * 0.1, 0, 0, 0, "metal_dark", 0x2a2a2a);
  put(B, new THREE.CylinderGeometry(0.17, 0.2, 1.2, 10), frame, wx, 0.6, 0, 0, 0, 0, "metal_painted", 0x8a8f7a);
  put(B, new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12), frame, wx, 1.05, 0, 0, 0, 0, "metal_dark", STEEL_D);
  put(B, new THREE.TorusGeometry(0.22, 0.03, 4, 12), frame, wx + 0.3, 0.8, 0, 0, Math.PI / 2, 0, "metal_painted", 0xb83a2a);
  // Equaliser + pitman arms down to the cranks; counterweights; gearbox; motor + belt guard.
  const ex = 0.2 - 2.6 * Math.cos(tilt), ey = 3.95 - 2.6 * Math.sin(tilt);
  box(0.3, 0.25, 1.1, ex, ey, 0, 0, 0, tilt, "metal_painted", c);
  for (const s of [-1, 1]) {
    const cx = -2.05, cy = 1.2;
    const dx = ex - cx, dy = ey - cy;
    box(0.1, Math.hypot(dx, dy), 0.08, (ex + cx) / 2, (ey + cy) / 2, s * 0.5, 0, 0, -Math.atan2(dx, dy), "metal_dark", STEEL_D);
    const ca = r() * 6.28;
    box(1.3, 0.22, 0.12, cx + Math.cos(ca) * 0.35, cy + Math.sin(ca) * 0.35, s * 0.62, 0, 0, ca, "metal_painted", c);
    box(0.8, 0.9, 0.16, cx + Math.cos(ca) * 0.8, cy + Math.sin(ca) * 0.8, s * 0.7, 0, 0, ca, "metal_dark", 0x3a3c3e);
  }
  box(1.0, 0.95, 0.85, -2.05, 0.95, 0, 0, 0, 0, "metal_painted", c);
  box(0.9, 0.7, 0.7, -2.95, 0.8, 0.0, 0, 0, 0, "metal_painted", 0x5f7a4a);
  box(0.9, 0.85, 0.12, -2.55, 0.95, 0.5, 0, 0, 0.15, "metal_painted", 0xd2b04a);
  // Flow line from the wellhead off the skid.
  _p.set(wx, 0.35, 0).applyMatrix4(frame);
  const x0 = _p.x, z0 = _p.z;
  _p.set(wx + 3.5, 0.2, 0.9).applyMatrix4(frame);
  pipe(B, x0, 0.35, z0, _p.x, 0.2, _p.z, 0.06, "metal_dark", 0x4a4c4c, 8);
}

/** Knee-high pipe run: two or three lines on sleepers, flanges and a valve wheel. */
function pipeRun(B: MeshBuilder, b: { x: number; z: number; w: number; d: number }, r: () => number) {
  const alongX = b.w > b.d;
  const len = alongX ? b.w : b.d;
  const lines = r() < 0.5 ? 2 : 3;
  const ax = alongX ? b.x - len / 2 : b.x, az = alongX ? b.z : b.z - len / 2;
  const bx = alongX ? b.x + len / 2 : b.x, bz = alongX ? b.z : b.z + len / 2;
  for (let s = 0; s < lines; s++) {
    const off = (s - (lines - 1) / 2) * 0.32;
    const rad = 0.13 + r() * 0.05;
    const y = 0.42 + rad + (s === 1 && lines === 3 ? 0.12 : 0);
    const ox = alongX ? 0 : off, oz = alongX ? off : 0;
    pipe(B, ax + ox, y, az + oz, bx + ox, y, bz + oz, rad, "metal_painted", s % 2 ? 0xb4a688 : STEEL);
    for (let k = 3; k < len - 1; k += 6) {
      const fx = alongX ? ax + k : b.x + ox, fz = alongX ? b.z + oz : az + k;
      put(B, new THREE.CylinderGeometry(rad + 0.06, rad + 0.06, 0.08, 10), null, fx, y, fz, 0, alongX ? 0 : Math.PI / 2, alongX ? Math.PI / 2 : 0, "metal_dark", STEEL_D);
    }
  }
  for (let k = 1; k < len; k += 3) {
    const sx = alongX ? ax + k : b.x, sz = alongX ? b.z : az + k;
    B.box("concrete_dirty", sx, 0.2, sz, alongX ? 0.35 : 0.95, 0.4, alongX ? 0.95 : 0.35, 0xb9b2a4);
  }
  const mx = alongX ? b.x + len * 0.15 : b.x, mz = alongX ? b.z : b.z + len * 0.15;
  put(B, new THREE.TorusGeometry(0.25, 0.03, 4, 14), null, mx, 0.98, mz, Math.PI / 2, 0, 0, "metal_painted", 0xb83a2a);
  pipe(B, mx, 0.6, mz, mx, 0.98, mz, 0.035, "metal_dark", STEEL_D, 6);
}

/** Overhead pipe rack along x at RACK.z: H-frames on the collider posts, four lines, drops at the ends. */
function pipeRack(B: MeshBuilder) {
  const { z, x0, x1, step, height } = RACK;
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    for (const s of [-0.65, 0.65]) B.box("metal_painted", x, height / 2, z + s, 0.2, height, 0.2, 0x7a8a8e);
    B.box("metal_painted", x, height - 0.85, z, 0.22, 0.18, 1.6, 0x7a8a8e);
    B.box("metal_painted", x, height - 0.05, z, 0.22, 0.18, 1.6, 0x7a8a8e);
    B.box("concrete_dirty", x, 0.15, z, 0.6, 0.3, 1.9, 0xb9b2a4);
  }
  const lines: [number, number, number, number][] = [
    [-0.45, height - 0.6, 0.2, STEEL], [0.05, height - 0.6, 0.28, 0xc9b78e], [0.5, height - 0.62, 0.16, STEEL],
    [-0.3, height + 0.2, 0.22, 0xd0cbc0], [0.35, height + 0.2, 0.14, 0x8a8e7a],
  ];
  for (const [o, y, rad, tint] of lines) {
    pipe(B, x0 - 1.5, y, z + o, x1 + 1.5, y, z + o, rad, "metal_painted", tint, 12);
    // Elbows down into the ground at both ends.
    pipe(B, x0 - 1.5, 0, z + o, x0 - 1.5, y, z + o, rad, "metal_painted", tint, 12);
    pipe(B, x1 + 1.5, 0, z + o, x1 + 1.5, y, z + o, rad, "metal_painted", tint, 12);
  }
  // Cable tray from the rack to the control shack roof.
  B.box("metal_dark", 0, height + 0.55, (z + 3.5) / 2 + 0.2, 0.5, 0.08, z - 3.5, STEEL_D);
}

/** Lattice flood-light tower on its collider. */
function lightTower(B: MeshBuilder, l: { x: number; z: number }) {
  const H = 10;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pipe(B, l.x + sx * 0.45, 0, l.z + sz * 0.45, l.x + sx * 0.22, H, l.z + sz * 0.22, 0.045, "metal_dark", 0x8a8c8c, 5);
  }
  for (let y = 0.8; y < H - 0.5; y += 1.4) {
    const w = 0.45 - (y / H) * 0.23;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      pipe(B, l.x + ax * w, y, l.z + az * w, l.x + bx * w, y + 1.4, l.z + bz * w, 0.02, "metal_dark", 0x8a8c8c, 4);
    }
  }
  B.box("metal_dark", l.x, H - 0.05, l.z, 1.8, 0.1, 0.9, 0x6a6c6c);
  B.box("metal_dark", l.x, H + 0.35, l.z - 0.2, 1.75, 0.7, 0.18, 0x3a3c3c);
  B.box("concrete_dirty", l.x, 0.12, l.z, 1.4, 0.24, 1.4, 0xb9b2a4);
}

/**
 * Cinder Flats set dressing: flat sand yard with packed-gravel roads and
 * oil-stained ground round the wells, dunes beyond the berm, the tank farm,
 * pump jacks, pipe runs, the overhead rack, light towers, a flare stack and
 * power line outside, razor wire on the berm and clutter. Visual only.
 */
export const cinderFlats: Dressing = (kit) => {
  const { def, builder: B } = kit;
  const r = rng(4417);
  const boxes = def.boxes;

  // ---- Terrain -------------------------------------------------------------------------
  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= 50) return 0;
    // Dunes: long ridges plus smaller ripples.
    const ridge = Math.abs(Math.sin(x * 0.018 + z * 0.011 + fbm2(x * 0.01, z * 0.01, 3) * 3));
    return smoothstep(50, 140, d) * (3 + 14 * ridge * fbm2(x * 0.006 + 2, z * 0.006 - 5, 3)) + smoothstep(52, 70, d) * (fbm2(x * 0.08, z * 0.08, 2) - 0.5) * 0.6;
  };
  const roads = (x: number, z: number) => {
    const wob = (fbm2(x * 0.04, z * 0.04, 2) - 0.5) * 2;
    return Math.max(band(x + wob, 3.2), band(z + wob, 3.2));
  };
  const stain = (x: number, z: number) => {
    let s = 0;
    for (const p of PUMPJACKS) s = Math.max(s, 1 - smoothstep(1.5, 5.5, Math.hypot(x - p.x, z - p.z)));
    for (const t of TANKS) s = Math.max(s, (1 - smoothstep(t.r + 0.5, t.r + 4, Math.hypot(x - t.x, z - t.z))) * 0.7);
    return s * (0.6 + 0.6 * fbm2(x * 0.3, z * 0.3, 2));
  };
  const splat = (x: number, z: number, o: Splat) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const n = fbm2(x * 0.05, z * 0.05, 3);
    if (d < BERM) {
      const rd = roads(x, z) * (d < 46 ? 1 : 0);
      o.gravel = 0.9 + rd * 1.2 + smoothstep(0.55, 0.7, n) * 0.4;
      o.ground = 0.35 - rd * 0.3 + smoothstep(0.45, 0.65, fbm2(x * 0.11 + 4, z * 0.11, 2)) * 0.35;
      o.mud = stain(x, z) * 1.6 + smoothstep(0.66, 0.78, n) * 0.25;
    } else {
      o.gravel = 0.7;
      o.ground = 0.45;
      o.mud = 0;
    }
  };

  // ---- Structures ---------------------------------------------------------------------------
  for (const t of TANKS) storageTank(B, t, r);
  for (const p of PUMPJACKS) pumpJack(B, p, r);
  for (const b of boxes) if (b.tag === "pipeX" || b.tag === "pipeZ") pipeRun(B, b, r);
  pipeRack(B);
  for (const l of LIGHTS) lightTower(B, l);
  // Two real lights: the shack interior and the console glow.
  kit.addLamp?.(new THREE.Vector3(0, 2.4, 0), 0xffe2b0, 4, 9);
  kit.addLamp?.(new THREE.Vector3(-3, 1.4, -2.2), 0x7ad8ff, 1.5, 4);

  // Control shack: door frames, a sun canopy over the south door, antenna mast, stencil band.
  for (const z of [-3.5, 3.5]) {
    for (const s of [-1, 1]) B.box("metal_dark", s * 1.15, 1.12, z, 0.1, 2.25, 0.4, STEEL_D);
    B.box("metal_dark", 0, 2.27, z, 2.4, 0.1, 0.4, STEEL_D);
  }
  B.box("metal_corrugated", 0, 2.75, 5.0, 4.2, 0.08, 2.6, 0xb8a888, { rotX: -0.12 });
  for (const s of [-1, 1]) pipe(B, s * 2.0, 0, 6.2, s * 2.0, 2.6, 6.2, 0.05, "metal_dark", STEEL_D, 6);
  pipe(B, -4.2, 3.2, -2.8, -4.2, 9.5, -2.8, 0.06, "metal_dark", 0x8a8c8c, 6);
  for (const y of [5, 7, 9]) B.box("metal_dark", -4.2, y, -2.8, 0.9, 0.04, 0.04, 0x8a8c8c);
  B.box("plain", 0, 2.55, 3.66, 10, 0.25, 0.02, 0xb8692e);

  // Flare stack and power line beyond the east berm.
  const fx = 66, fz = -60;
  pipe(B, fx, height(fx, fz) - 0.5, fz, fx, 24, fz, 0.6, "metal_rust", 0x9a8a78, 14);
  B.box("metal_dark", fx, 24.2, fz, 1.6, 0.4, 1.6, 0x3a3c3c);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    pipe(B, fx, 16, fz, fx + Math.cos(a) * 12, height(fx + Math.cos(a) * 12, fz + Math.sin(a) * 12), fz + Math.sin(a) * 12, 0.02, "metal_dark", 0x2a2a2a, 3);
  }
  const poles: PoleSpot[] = [];
  for (let z = -170; z <= 170; z += 34) poles.push({ x: 64, y: height(64, z), z, rotY: 0 });
  poleLine(B, poles, r, 1.1);

  // Razor wire along the berm crest on the north and east.
  concertina(B, -46, -BERM - 0.2, 46, -BERM - 0.2, 5.3);
  concertina(B, BERM + 0.2, -46, BERM + 0.2, 46, 5.3);

  // Clutter.
  pallets(B, -9.5, 9.5, 0.3, 3, r);
  pallets(B, 22, 4.5, 1.2, 2, r);
  pallets(B, -30, 16, 0.8, 4, r);
  for (const [x, z, side] of [[-2, -18, false], [24.5, -6, true], [-38, 24, false], [10, 36, true], [-20, -34, false]] as const) {
    if (clearOf(boxes, x, z, 0.5)) tyre(B, x, z, side, r);
  }
  rubble(B, 36, -38, 4, 16, r, boxes);
  rubble(B, -8, -20, 3, 8, r, boxes);

  // A few dry bushes on the dunes and along the berm foot.
  const bushes: BushPlacement[] = [];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 52 + r() * 70;
    bushes.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, scale: 0.5 + r() * 0.5, dry: true });
  }
  for (let i = 0; i < 18; i++) {
    const a = (r() * 2 - 1) * 44;
    const side = Math.floor(r() * 4);
    const off = BERM - 1.6 - r() * 0.8;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (clearOf(boxes, x, z, 1.2)) bushes.push({ x, z, scale: 0.45 + r() * 0.3, dry: true });
  }

  return {
    terrain: { height, splat, inner: 60, outer: 700 },
    foliage: { grass: () => 0, grassBounds: 0, trees: [], bushes },
  };
};
