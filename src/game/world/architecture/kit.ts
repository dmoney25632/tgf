import * as THREE from "three";
import type { AddOptions, MeshBuilder } from "../MeshBuilder";
import { makeWireGeometry } from "../MeshBuilder";
import { decalRect, CLOTH_SCHEMES, type DecalKind, type WorldMat } from "../WorldMaterials";

/**
 * Low-level architectural pieces shared by buildings, ruins and set
 * dressing. Everything is merged into the MeshBuilder (per material), so a
 * piece costs triangles, never draw calls.
 */

export type Tint = THREE.ColorRepresentation;

/** A vertical facade frame: origin on the outer face at ground, `t` along the wall, `n` out of it. */
export class Frame {
  readonly t: THREE.Vector3;
  readonly n: THREE.Vector3;
  readonly rotY: number;
  constructor(
    readonly o: THREE.Vector3,
    t: THREE.Vector3,
  ) {
    this.t = t.clone().setY(0).normalize();
    this.n = new THREE.Vector3(this.t.z, 0, -this.t.x); // t × up → outward when walking counter-clockwise
    this.rotY = Math.atan2(-this.t.z, this.t.x);
  }
  /** World point at (u along, y up, d out). */
  at(u: number, y: number, d = 0, out = new THREE.Vector3()) {
    return out.copy(this.o).addScaledVector(this.t, u).addScaledVector(this.n, d).setY(this.o.y + y);
  }
  /** Matrix mapping local (x=u, y, z=-d) → world (z points into the wall). */
  matrix(u = 0, y = 0, d = 0) {
    const p = this.at(u, y, d);
    return new THREE.Matrix4().makeRotationY(this.rotY).setPosition(p);
  }
}

const _v = new THREE.Vector3();

/** Box in a frame: centred at (u, y, d) with size (w along, h, depth out). */
export function fbox(B: MeshBuilder, f: Frame, mat: WorldMat, u: number, y: number, d: number, w: number, h: number, depth: number, tint: Tint, opts: AddOptions & { rotX?: number; rotZ?: number; yaw?: number } = {}) {
  f.at(u, y, d, _v);
  const { yaw = 0, ...rest } = opts;
  B.box(mat, _v.x, _v.y, _v.z, w, h, depth, tint, { ...rest, rotY: f.rotY + yaw });
}

export type Opening = {
  /** Centre along the wall, bottom height, width, height. */
  u: number;
  y: number;
  w: number;
  h: number;
  /** Round-arched head (the arch rises above y + h by w/2). */
  arch?: boolean;
};

export type Blast = { u: number; y: number; r: number; seed: number };

export type WallSpec = {
  length: number;
  height: number;
  thickness: number;
  openings?: Opening[];
  blasts?: Blast[];
  /** Broken top edge: amplitude (m) of the jagged crown; 0 = straight. */
  ruin?: number;
  /** Collapse: [u0, u1, drop] — the crown sags to `height - drop` between u0..u1. */
  collapse?: [number, number, number];
  seed?: number;
};

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Irregular blast-hole outline (counter-clockwise) around (u, y). */
export function blastOutline(b: Blast, n = 11) {
  const r = rnd(b.seed);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = b.r * (0.65 + r() * 0.55);
    pts.push(new THREE.Vector2(b.u + Math.cos(a) * rr, b.y + Math.sin(a) * rr * 0.85));
  }
  return pts;
}

/**
 * A wall slab with real thickness, cut by window/door/arch openings and
 * blast holes, optionally with a broken crown. Built as one extruded shape
 * (so reveals, arches and jagged tops come for free).
 */
export function wallGeometry(spec: WallSpec) {
  const { length: L, height: H } = spec;
  const r = rnd(spec.seed ?? 7);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L, 0);
  const crown = (u: number) => {
    let h = H;
    if (spec.collapse) {
      const [a, b, drop] = spec.collapse;
      const edge = 0.8;
      const k = Math.min(1, Math.max(0, Math.min((u - a) / edge, (b - u) / edge)));
      h -= drop * k;
    }
    return h;
  };
  if (spec.ruin || spec.collapse) {
    const step = 0.35;
    const n = Math.max(2, Math.ceil(L / step));
    for (let i = n; i >= 0; i--) {
      const u = (i / n) * L;
      const j = spec.ruin ? (r() - 0.5) * spec.ruin * (i === 0 || i === n ? 0.3 : 1) : 0;
      shape.lineTo(u, Math.max(0.3, crown(u) + j - (spec.ruin ?? 0) * 0.5));
    }
  } else {
    shape.lineTo(L, H);
    shape.lineTo(0, H);
  }
  shape.closePath();
  for (const o of spec.openings ?? []) {
    const p = new THREE.Path();
    const x0 = o.u - o.w / 2, x1 = o.u + o.w / 2;
    p.moveTo(x0, o.y);
    if (o.arch) {
      p.lineTo(x0, o.y + o.h);
      p.absarc(o.u, o.y + o.h, o.w / 2, Math.PI, 0, true);
      p.lineTo(x1, o.y);
    } else {
      p.lineTo(x0, o.y + o.h);
      p.lineTo(x1, o.y + o.h);
      p.lineTo(x1, o.y);
    }
    p.closePath();
    shape.holes.push(p);
  }
  for (const b of spec.blasts ?? []) shape.holes.push(new THREE.Path(blastOutline(b).reverse()));
  // Extrudes along local +z, which a Frame maps to "into the building".
  return new THREE.ExtrudeGeometry(shape, { depth: spec.thickness, bevelEnabled: false, curveSegments: 5 });
}

/** Adds a wall to the builder in a frame (outer face on the frame plane). */
export function wall(B: MeshBuilder, f: Frame, spec: WallSpec, mat: WorldMat, tint: Tint, opts: AddOptions = {}) {
  const geo = wallGeometry(spec);
  B.add(geo, f.matrix(), mat, tint, opts);
  geo.dispose();
}

function flipWinding(geo: THREE.BufferGeometry) {
  const idx = geo.index;
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
  } else {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const swap = (attr: THREE.BufferAttribute | undefined) => {
      if (!attr) return;
      const s = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = attr.array[(i + 1) * s + k];
          (attr.array as Float32Array)[(i + 1) * s + k] = attr.array[(i + 2) * s + k];
          (attr.array as Float32Array)[(i + 2) * s + k] = t;
        }
      }
    };
    swap(p);
    swap(geo.attributes.normal as THREE.BufferAttribute);
    swap(geo.attributes.uv as THREE.BufferAttribute);
  }
  const n = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (n) for (let i = 0; i < n.count; i++) n.setZ(i, -n.getZ(i));
}

/** Atlas-mapped quad (decal) given a centre, its right and up axes (unit) and size. */
export function decal(B: MeshBuilder, kind: DecalKind, c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, tint: Tint, group = "decor", flipU = false) {
  const [u0, v0, u1, v1] = decalRect(kind);
  const geo = new THREE.BufferGeometry();
  const p = (sx: number, sy: number) => c.clone().addScaledVector(right, sx * w / 2).addScaledVector(up, sy * h / 2);
  const a = p(-1, -1), b = p(1, -1), cc = p(1, 1), d = p(-1, 1);
  geo.setAttribute("position", new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z, a.x, a.y, a.z, cc.x, cc.y, cc.z, d.x, d.y, d.z], 3));
  const L = flipU ? u1 : u0, R = flipU ? u0 : u1;
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([L, v0, R, v0, R, v1, L, v0, R, v1, L, v1], 2));
  const nrm = new THREE.Vector3().crossVectors(right, up).normalize();
  geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 2, 3, 4, 5].flatMap(() => [nrm.x, nrm.y, nrm.z]), 3));
  B.add(geo, null, "decal", tint, { group, uv: "keep" });
  geo.dispose();
}

/** Decal on a facade at (u, y) (centre), slightly proud of the wall. */
export function wallDecal(B: MeshBuilder, f: Frame, kind: DecalKind, u: number, y: number, w: number, h: number, tint: Tint = 0xffffff, d = 0.012, group = "decor") {
  // right × up must point out of the wall (n): use -t and mirror u back.
  decal(B, kind, f.at(u, y, d), f.t.clone().negate(), new THREE.Vector3(0, 1, 0), w, h, tint, group, true);
}

/**
 * Ground decal: a quad lying on the ground, rotated by `yaw`. With a height
 * function it is subdivided to follow uneven terrain.
 */
export function groundDecal(B: MeshBuilder, kind: DecalKind, x: number, z: number, w: number, l: number, yaw: number, tint: Tint, height?: (x: number, z: number) => number, group = "decor", lift = 0.02) {
  const [u0, v0, u1, v1] = decalRect(kind);
  const segs = height ? Math.max(1, Math.ceil(Math.max(w, l) / 2)) : 1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const vert = (i: number, j: number) => {
    const a = (i / segs - 0.5) * w, b = (j / segs - 0.5) * l;
    const px = x + a * c + b * s, pz = z - a * s + b * c;
    pos.push(px, (height ? height(px, pz) : 0) + lift, pz);
    uv.push(u0 + (u1 - u0) * (i / segs), v0 + (v1 - v0) * (j / segs));
    nor.push(0, 1, 0);
  };
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      vert(i, j); vert(i, j + 1); vert(i + 1, j + 1);
      vert(i, j); vert(i + 1, j + 1); vert(i + 1, j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  B.add(geo, null, "decal", tint, { group, uv: "keep" });
  geo.dispose();
}

/** Flat irregular slab (asphalt / concrete patch) with ragged edges, lying on the ground. */
export function groundPatch(B: MeshBuilder, mat: WorldMat, x: number, z: number, rx: number, rz: number, yaw: number, tint: Tint, seed: number, y = 0.012, group = "decor") {
  const r = rnd(seed);
  const shape = new THREE.Shape();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Superellipse (squarish) with chewed edges.
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = 1 / Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), 0.25);
    const j = 0.82 + r() * 0.2;
    const px = ca * k * rx * j, pz = sa * k * rz * j;
    if (i === 0) shape.moveTo(px, pz);
    else shape.lineTo(px, pz);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  // rotateX(+90°) makes normals point down; flip.
  flipWinding(geo);
  const nn = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  B.add(geo, m, mat, tint, { group, noAo: true, uvOffset: [r() * 5, r() * 5] });
  geo.dispose();
}

/** Iron railing between two points: top/bottom rail and balusters. */
export function railing(B: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, h: number, tint: Tint, spacing = 0.14, group = "decor", mat: WorldMat = "metal_dark") {
  const len = a.distanceTo(b);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  B.box(mat, mid.x, a.y + h, mid.z, len, 0.04, 0.05, tint, { rotY: yaw, group });
  B.box(mat, mid.x, a.y + 0.1, mid.z, len, 0.03, 0.03, tint, { rotY: yaw, group });
  const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    const w = i === 0 || i === n ? 0.05 : 0.018;
    B.box(mat, p.x, a.y + h / 2, p.z, w, h, w, tint, { group });
  }
}

/** Pipe handrail (round-ish, e.g. yellow safety rail) between two points with posts. */
export function pipeRail(B: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, h: number, tint: Tint, group = "decor") {
  const geo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
  const tube = (p: THREE.Vector3, q: THREE.Vector3) => {
    const len = p.distanceTo(q);
    const m = new THREE.Matrix4().compose(
      p.clone().add(q).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()),
      new THREE.Vector3(1, len, 1),
    );
    B.add(geo, m, "metal_painted", tint, { group, uv: "keep", uvScale: [0.2, len] });
  };
  const up = new THREE.Vector3(0, h, 0);
  const mid = new THREE.Vector3(0, h * 0.5, 0);
  tube(a.clone().add(up), b.clone().add(up));
  tube(a.clone().add(mid), b.clone().add(mid));
  const n = Math.max(1, Math.round(a.distanceTo(b) / 1.4));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    tube(p, p.clone().add(up));
  }
  geo.dispose();
}

/**
 * Sagging striped fabric awning. Hangs off the wall at height `y`, `depth`
 * out from the facade, front edge lower by `drop`; sags between frame rods.
 */
export function awning(B: MeshBuilder, f: Frame, u: number, y: number, w: number, depth: number, drop: number, scheme: number, seed: number, torn = false, group = "decor") {
  const r = rnd(seed);
  const nu = 8, nv = 4;
  const band = (scheme % CLOTH_SCHEMES) / CLOTH_SCHEMES;
  const pos: number[] = [], uv: number[] = [];
  const P = (i: number, j: number) => {
    const s = i / nu, t = j / nv;
    const sag = Math.sin(Math.PI * s) * 0.12 * t + Math.sin(Math.PI * t) * 0.06;
    const tear = torn && s > 0.55 && t > 0.6 ? (t - 0.6) * 1.6 : 0;
    const yy = y - drop * t - sag - tear;
    const p = f.at(u + (s - 0.5) * w, yy - f.o.y, t * depth * (1 - tear * 0.4));
    return { p, uv: [s * w * 0.9, 1 - (band + 0.01 + t * (1 / CLOTH_SCHEMES - 0.02))] };
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (torn && i >= nu - 2 && j >= nv - 1 && r() < 0.8) continue;
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j), P(i + 1, j + 1), P(i, j + 1)];
      for (const v of q) {
        pos.push(v.p.x, v.p.y, v.p.z);
        uv.push(v.uv[0], v.uv[1]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  B.add(geo, null, "cloth", 0xffffff, { group, uv: "keep" });
  geo.dispose();
  // Valance strip along the front edge and two support rods.
  const front = P(nu / 2, nv).p;
  B.box("cloth", front.x, front.y - 0.1, front.z, w, 0.2, 0.01, 0xd8d0c0, { rotY: f.rotY, group, uv: "keep" });
  for (const s of [-0.5, 0.5]) {
    const a = f.at(u + s * w, y - f.o.y - drop - 0.05, depth * 0.98);
    const b = f.at(u + s * w, y - f.o.y + 0.35, 0);
    rod(B, a, b, 0.012, 0x3a3a38, group);
  }
}

/** Thin metal rod between two points. */
export function rod(B: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, radius: number, tint: Tint, group = "decor", mat: WorldMat = "metal_dark") {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 5);
  const len = a.distanceTo(b);
  const m = new THREE.Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
    new THREE.Vector3(1, len, 1),
  );
  B.add(geo, m, mat, tint, { group, uv: "keep", uvScale: [0.1, len] });
  geo.dispose();
}

/**
 * Industrial pendant lamp hanging from (x, top, z): enamel shade (outer and
 * inner skins), socket cap and a glowing bulb. About 300 tris, no draw calls.
 */
export function pendantLamp(B: MeshBuilder, x: number, top: number, z: number, drop: number, scale = 1, tint: Tint = 0x4f5a4c, group = "decor") {
  const s = scale;
  const prof: [number, number][] = [[0.035, 0], [0.06, -0.02], [0.075, -0.07], [0.15, -0.17], [0.25, -0.27], [0.28, -0.3]];
  const outer = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 14);
  const inner = new THREE.LatheGeometry(prof.slice().reverse().map(([r, y]) => new THREE.Vector2(r * s * 0.97, (y + 0.004) * s)), 14);
  const y0 = top - drop;
  const m = new THREE.Matrix4().makeTranslation(x, y0, z);
  B.add(outer, m, "metal_painted", tint, { group, uv: "keep" });
  B.add(inner, m, "metal_painted", 0xe8e4d8, { group, uv: "keep" });
  outer.dispose();
  inner.dispose();
  const bulb = new THREE.SphereGeometry(0.06 * s, 8, 6);
  B.add(bulb, new THREE.Matrix4().makeTranslation(x, y0 - 0.12 * s, z), "glow", 0xffffff, { group, uv: "keep" });
  bulb.dispose();
  rod(B, new THREE.Vector3(x, top, z), new THREE.Vector3(x, y0, z), 0.006, 0x1e1e1e, group);
}

/** Wall-hung split AC unit with a fan grille, brackets and a drip stain. */
export function acUnit(B: MeshBuilder, f: Frame, u: number, y: number, seed: number, group = "decor") {
  const r = rnd(seed);
  const tint = new THREE.Color(0xd8d6cc).multiplyScalar(0.75 + r() * 0.25);
  fbox(B, f, "metal_painted", u, y + 0.3, 0.2, 0.8, 0.58, 0.3, tint, { group });
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12).rotateX(Math.PI / 2);
  const p = f.at(u - 0.12, y + 0.3, 0.355);
  B.add(disc, new THREE.Matrix4().makeRotationY(f.rotY).setPosition(p), "metal_dark", 0x2a2a28, { group, uv: "keep" });
  disc.dispose();
  for (const s of [-0.3, 0.3]) fbox(B, f, "metal_dark", u + s, y - 0.02, 0.2, 0.04, 0.04, 0.4, 0x3a3a36, { group });
  wallDecal(B, f, "leak", u + 0.2, y - 0.6, 0.5, 1.2, 0xffffff, 0.012, group);
}

/** Rooftop satellite dish on a short mast. */
export function dish(B: MeshBuilder, x: number, y: number, z: number, yaw: number, size: number, group = "decor") {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector2(t * size, t * t * size * 0.3));
  }
  const geo = new THREE.LatheGeometry(pts, 12);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.1, yaw, 0, "YXZ")), new THREE.Vector3(1, 1, 1));
  B.add(geo, m, "metal_painted", 0xdcdad2, { group, uv: "keep" });
  geo.dispose();
  B.box("metal_dark", x, y + 0.3, z, 0.05, 0.6, 0.05, 0x55554f, { group });
}

/** Rooftop water tank (plastic cylinder) on a steel stand. */
export function waterTank(B: MeshBuilder, x: number, y: number, z: number, black: boolean, group = "decor") {
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12);
  B.add(geo, new THREE.Matrix4().makeTranslation(x, y + 0.5 + 0.6, z), "plain", black ? 0x232322 : 0xc9c4b4, { group, uv: "keep" });
  geo.dispose();
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.4, 0.4]) B.box("metal_dark", x + sx, y + 0.25, z + sz, 0.05, 0.5, 0.05, 0x4a4a46, { group });
  B.box("metal_dark", x, y + 0.5, z, 1, 0.05, 1, 0x4a4a46, { group });
}

/** Vertical downpipe with a kick-out at the bottom. */
export function downpipe(B: MeshBuilder, f: Frame, u: number, top: number, group = "decor") {
  const a = f.at(u, 0.25, 0.09), b = f.at(u, top, 0.09);
  rod(B, a, b, 0.045, 0x8a8a82, group, "metal_painted");
  rod(B, a, f.at(u, 0.05, 0.3), 0.045, 0x7a7a72, group, "metal_painted");
}

/** Sagging cable bundle between two points. */
export function cable(B: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, sag: number, group = "decor") {
  const geo = makeWireGeometry(a, b, sag, 0.014, 10);
  B.add(geo, null, "plain", 0x1a1a1a, { group, uv: "keep", noAo: true });
  geo.dispose();
}

/** Bent rebar stubs poking out of a broken edge. */
export function rebar(B: MeshBuilder, f: Frame, u: number, y: number, n: number, seed: number, group = "decor", spread = 0.5) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const uu = u + (r() - 0.5) * spread * 2, yy = y + (r() - 0.5) * spread;
    const a = f.at(uu, yy, -0.1);
    const len = 0.25 + r() * 0.5;
    const b = a.clone().addScaledVector(f.n, len * 0.7).add(new THREE.Vector3((r() - 0.5) * 0.3, (r() - 0.6) * len, (r() - 0.5) * 0.3));
    rod(B, a, b, 0.007, 0x5a3a28, group, "metal_rust");
  }
}

/** Chain-link fence run with round posts and a top rail; a few sagging/missing panels. */
export function chainlink(B: MeshBuilder, ax: number, az: number, bx: number, bz: number, h: number, height: (x: number, z: number) => number, seed: number, group = "decor") {
  const r = rnd(seed);
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 3));
  const post = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const yaw = Math.atan2(-dz, dx);
  for (let i = 0; i <= n; i++) {
    const x = ax + dx * (len * i) / n, z = az + dz * (len * i) / n;
    const y = height(x, z);
    const lean = (r() - 0.5) * 0.08;
    B.add(post, new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2 + 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, lean)), new THREE.Vector3(1, h + 0.1, 1)), "metal_painted", 0x8c8e88, { group, uv: "keep" });
    if (i === n) continue;
    if (r() < 0.08) continue; // missing panel
    const x2 = ax + dx * (len * (i + 1)) / n, z2 = az + dz * (len * (i + 1)) / n;
    const y2 = height(x2, z2);
    const segL = len / n;
    const sag = r() < 0.2 ? 0.25 + r() * 0.3 : 0;
    const geo = new THREE.PlaneGeometry(segL, h, 2, 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const top = p.getY(k) > 0;
      const midU = Math.abs(p.getX(k)) < 0.01;
      if (top && midU) p.setY(k, p.getY(k) - sag);
    }
    const uvA = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * segL * 4, uvA.getY(k) * h * 4);
    geo.computeVertexNormals();
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition((x + x2) / 2, (y + y2) / 2 + h / 2 + 0.05, (z + z2) / 2);
    B.add(geo, m, "chainlink", 0xb0b0aa, { group, uv: "keep" });
    geo.dispose();
    const top = new THREE.Vector3(x, y + h + 0.05, z), top2 = new THREE.Vector3(x2, y2 + h + 0.05, z2);
    rod(B, top, top2, 0.02, 0x8c8e88, group, "metal_painted");
  }
  post.dispose();
}

/**
 * Faded road paint: dashes (or a broken solid line when gap = 0) from a to
 * b, offset sideways by `side`, following the ground. Worn sections drop out.
 */
export function paintLine(B: MeshBuilder, ax: number, az: number, bx: number, bz: number, side: number, width: number, dash: number, gap: number, height: (x: number, z: number) => number, seed: number, tint: Tint = 0xd6d2c4, group = "decor", lift = 0.075) {
  const r = rnd(seed);
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const nx = -dz, nz = dx;
  const step = gap > 0 ? dash + gap : dash;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let t = r() * step; t + dash < len; t += step) {
    if (r() < 0.22) continue; // worn away
    const l = dash * (gap > 0 ? 0.85 + r() * 0.15 : 0.5 + r() * 0.5);
    const segs = Math.max(1, Math.round(l / 3));
    for (let k = 0; k < segs; k++) {
      const t0 = t + (l * k) / segs, t1 = t + (l * (k + 1)) / segs;
      const q = [t0, t1].map((tt) => {
        const cx = ax + dx * tt + nx * side, cz = az + dz * tt + nz * side;
        return [
          [cx - nx * width / 2, height(cx - nx * width / 2, cz - nz * width / 2) + lift, cz - nz * width / 2],
          [cx + nx * width / 2, height(cx + nx * width / 2, cz + nz * width / 2) + lift, cz + nz * width / 2],
        ];
      });
      const [a0, a1] = q[0], [b0, b1] = q[1];
      for (const p of [a0, b0, a1, a1, b0, b1]) {
        pos.push(p[0], p[1], p[2]);
        nor.push(0, 1, 0);
        uv.push(0, 0);
      }
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  // Winding: make sure faces point up.
  const p = geo.attributes.position as THREE.BufferAttribute;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), a = new THREE.Vector3();
  a.fromBufferAttribute(p, 0);
  e1.fromBufferAttribute(p, 1).sub(a);
  e2.fromBufferAttribute(p, 2).sub(a);
  if (e1.cross(e2).y < 0) flipWinding(geo);
  B.add(geo, null, "plain", tint, { group, noAo: true, uv: "keep" });
  geo.dispose();
}

/** Textured strip (road surface) following the ground between two points, with ragged edges. */
export function groundStrip(B: MeshBuilder, mat: WorldMat, ax: number, az: number, bx: number, bz: number, width: number, height: (x: number, z: number) => number, tint: Tint, seed: number, group = "decor", lift = 0.04) {
  const r = rnd(seed);
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  // Left-hand perpendicular; with (along, perp) ordered this way the quads face up.
  const px = dz, pz = -dx;
  const n = Math.max(1, Math.ceil(len / 2.5));
  const edge: [number, number][] = [];
  for (let i = 0; i <= n; i++) edge.push([(width / 2) * (0.8 + r() * 0.2), (width / 2) * (0.8 + r() * 0.2)]);
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  // Columns across the strip so it follows the ground (cuts, cambers) too.
  const m = Math.max(1, Math.ceil(width / 2.2));
  const P = (i: number, j: number) => {
    const t = (i / n) * len;
    const e = -edge[i][0] + ((edge[i][0] + edge[i][1]) * j) / m;
    const x = ax + dx * t + px * e, z = az + dz * t + pz * e;
    pos.push(x, height(x, z) + lift, z);
    uv.push(e, t);
    nor.push(0, 1, 0);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      P(i, j); P(i + 1, j + 1); P(i, j + 1);
      P(i, j); P(i + 1, j); P(i + 1, j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const a = new THREE.Vector3().fromArray(pos, 0), b = new THREE.Vector3().fromArray(pos, 3), c = new THREE.Vector3().fromArray(pos, 6);
  if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y < 0) {
    flipWinding(geo);
    const nn = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
  }
  B.add(geo, null, mat, tint, { group, noAo: true, uv: "keep", uvOffset: [r() * 5, r() * 5] });
  geo.dispose();
}
