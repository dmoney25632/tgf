import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import { signRect, type SignKind } from "../WorldMaterials";
import { rod } from "./kit";

/** Sign face (from the atlas) facing +local z, centred at (x, y, z), turned by yaw, plus a metal backing plate. */
export function signFace(B: MeshBuilder, kind: SignKind, x: number, y: number, z: number, yaw: number, w: number, h: number, group = "decor") {
  const [u0, v0, u1, v1] = signRect(kind);
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  B.add(geo, m, "signs", 0xffffff, { group, uv: "keep", noAo: true });
  geo.dispose();
  // Backing: a thin plate just behind the face (round/triangular signs show
  // their cut-out face in front of it from the front, grey metal from behind).
  const back = new THREE.Vector3(0, 0, -0.03).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  if (kind === "gantry" || kind === "chevron") B.box("metal_painted", x + back.x, y, z + back.z, w, h, 0.04, 0x8a8a84, { group, rotY: yaw });
}

/** Post-mounted road sign: galvanised pole, sign face at the top. */
export function postSign(B: MeshBuilder, kind: SignKind, x: number, z: number, yaw: number, gy: number, size = 0.9, lean = 0, group = "decor") {
  const top = gy + 2.3;
  rod(B, new THREE.Vector3(x, gy - 0.1, z), new THREE.Vector3(x + lean, top + size / 2, z), 0.04, 0x9a9c98, group, "metal_painted");
  const fwd = new THREE.Vector3(0, 0, 0.06).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const w = kind === "chevron" ? size * 1.8 : size;
  signFace(B, kind, x + lean + fwd.x, top, z + fwd.z, yaw, w, size, group);
}

/**
 * Overhead sign gantry across a road running along x at `z`: two lattice
 * legs, a box-truss beam and a large destination board facing `facing`
 * (+1 → the board faces +x). Legs stand at z ± span/2.
 */
export function signGantry(B: MeshBuilder, x: number, z: number, span: number, height: (x: number, z: number) => number, facing: 1 | -1, group = "far") {
  const steel = 0x8e908a;
  const clear = 6.2;
  const legs = [z - span / 2, z + span / 2];
  const gyTop = Math.max(height(x, legs[0]), height(x, legs[1])) + clear;
  for (const lz of legs) {
    const gy = height(x, lz);
    // Lattice leg: four chords and zig-zag bracing.
    for (const sx of [-0.35, 0.35]) for (const sz of [-0.3, 0.3]) {
      rod(B, new THREE.Vector3(x + sx, gy, lz + sz), new THREE.Vector3(x + sx, gyTop + 0.9, lz + sz), 0.05, steel, group, "metal_painted");
    }
    for (let yy = gy; yy < gyTop; yy += 0.9) {
      for (const sz of [-0.3, 0.3]) rod(B, new THREE.Vector3(x - 0.35, yy, lz + sz), new THREE.Vector3(x + 0.35, yy + 0.9, lz + sz), 0.02, steel, group, "metal_painted");
      for (const sx of [-0.35, 0.35]) rod(B, new THREE.Vector3(x + sx, yy + 0.45, lz - 0.3), new THREE.Vector3(x + sx, yy + 0.9, lz + 0.3), 0.02, steel, group, "metal_painted");
    }
    B.box("concrete", x, gy + 0.2, lz, 1.2, 0.5, 1.1, 0xa8a49a, { group });
  }
  // Box truss across the top.
  const len = span + 0.9;
  for (const dy of [0, 0.9]) for (const dx of [-0.3, 0.3]) B.box("metal_painted", x + dx, gyTop + dy, z, 0.07, 0.07, len, steel, { group });
  for (let t = -span / 2; t < span / 2; t += 0.9) {
    for (const dx of [-0.3, 0.3]) rod(B, new THREE.Vector3(x + dx, gyTop, z + t), new THREE.Vector3(x + dx, gyTop + 0.9, z + t + 0.9), 0.02, steel, group, "metal_painted");
  }
  // Destination board hung off the front of the truss, with a walkway grate below.
  const bx = x + facing * 0.45;
  signFace(B, "gantry", bx + facing * 0.03, gyTop + 0.25, z, facing > 0 ? Math.PI / 2 : -Math.PI / 2, 6.6, 1.95, group);
  B.box("metal_dark", bx - facing * 0.02, gyTop - 0.86, z, 0.5, 0.05, 6.8, 0x4a4a46, { group });
}

/** Painted straight / turn arrow on the road surface, pointing along `yaw` (0 → +z). */
export function roadArrow(B: MeshBuilder, x: number, z: number, yaw: number, height: (x: number, z: number) => number, turn = 0, group = "far", lift = 0.08) {
  const s = new THREE.Shape();
  // Shaft (0.18 wide, 2.4 long) then a 0.7-wide head; turn bends the head sideways.
  s.moveTo(-0.09, -1.6);
  s.lineTo(0.09, -1.6);
  s.lineTo(0.09, 0.4);
  s.lineTo(0.35, 0.4);
  s.lineTo(0, 1.4);
  s.lineTo(-0.35, 0.4);
  s.lineTo(-0.09, 0.4);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  // Shape lies in XY; lay it flat (y → -z… so +y of the shape points along +z after the turn).
  geo.rotateX(Math.PI / 2);
  geo.scale(1, 1, 1);
  if (turn) {
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const pz = p.getZ(i);
      if (pz > 0.2) p.setX(i, p.getX(i) + turn * (pz - 0.2) * 0.7);
    }
  }
  const p = geo.attributes.position as THREE.BufferAttribute;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i);
    const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
    p.setXYZ(i, wx, height(wx, wz) + lift, wz);
  }
  geo.computeVertexNormals();
  if ((geo.attributes.normal as THREE.BufferAttribute).getY(0) < 0) {
    const idx = geo.index!;
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    geo.computeVertexNormals();
  }
  B.add(geo, null, "plain", 0xd6d2c4, { group, noAo: true, uv: "keep" });
  geo.dispose();
}
