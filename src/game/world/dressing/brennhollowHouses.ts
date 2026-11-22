import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { ModelPlacer } from "../Props";
import type { WorldMat } from "../WorldMaterials";
import type { WorldDetail } from "../quality";
import { facades, spall } from "../architecture/Building";
import { Frame, acUnit, blastOutline, cable, dish, downpipe, fbox, railing, rebar, rod, wallDecal, type Blast, type Tint } from "../architecture/kit";
import { debrisScatter, rubblePile } from "../architecture/debris";
import { grimeOf, holeRects } from "../architecture/grime";
import { HOUSES, TOWER, WALL_T, houseOpenings, sideLength, type HouseDef, type HouseOpening, type Side } from "../maps/brennhollow";

/** The builders a Brennhollow structure draws into (one merged mesh per layer and material). */
export type Village = {
  /** World-material geometry (plaster, wood, metal, decals...). */
  B: MeshBuilder;
  /** Custom layers (each one material / one draw call). */
  slate: MeshBuilder;
  stone: MeshBuilder;
  timber: MeshBuilder;
  props: ModelPlacer;
  detail: WorldDetail;
  high: boolean;
};

export function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s: string) => s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 17);

// ---- Walls ---------------------------------------------------------------------------

type WallOpts = {
  L: number;
  T: number;
  /** Crown height along u (gables, collapses). Sampled every 0.3 m when not flat. */
  crown: (u: number) => number;
  flat?: boolean;
  openings: { u: number; y: number; w: number; h: number; arch?: boolean }[];
  blasts?: Blast[];
};

/** Extruded wall slab (u along, y up, thickness into the building) with openings cut through. */
function wallGeo(o: WallOpts) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(o.L, 0);
  if (o.flat) {
    s.lineTo(o.L, o.crown(o.L));
    s.lineTo(0, o.crown(0));
  } else {
    const n = Math.max(2, Math.ceil(o.L / 0.3));
    for (let i = n; i >= 0; i--) s.lineTo((i / n) * o.L, o.crown((i / n) * o.L));
  }
  s.closePath();
  for (const p of o.openings) {
    const path = new THREE.Path();
    const x0 = p.u - p.w / 2, x1 = p.u + p.w / 2;
    path.moveTo(x0, p.y);
    path.lineTo(x0, p.y + p.h);
    if (p.arch) path.absarc(p.u, p.y + p.h, p.w / 2, Math.PI, 0, true);
    else path.lineTo(x1, p.y + p.h);
    path.lineTo(x1, p.y);
    path.closePath();
    s.holes.push(path);
  }
  for (const b of o.blasts ?? []) s.holes.push(new THREE.Path(blastOutline(b).reverse()));
  return new THREE.ExtrudeGeometry(s, { depth: o.T, bevelEnabled: false, curveSegments: 6 });
}

function addWall(B: MeshBuilder, f: Frame, u0: number, o: WallOpts, mat: WorldMat, tint: Tint, group = "decor") {
  const geo = wallGeo(o);
  B.add(geo, f.matrix(u0, 0, 0), mat, tint, { group });
  geo.dispose();
}

/** Stone quoins up a corner: alternating long and short blocks proud of the render. */
function quoins(V: Village, f: Frame, u: number, dir: 1 | -1, top: number, tint: Tint) {
  for (let y = 0.5, i = 0; y + 0.3 < top; y += 0.32, i++) {
    const w = i % 2 ? 0.34 : 0.62;
    fbox(V.stone, f, "plain", u + dir * w / 2, y + 0.15, 0.025, w, 0.29, 0.05, tint);
  }
}

// ---- Roofs -------------------------------------------------------------------------------

/**
 * A roof face: a polygon in (u along the eaves, v up the slope) metres,
 * placed by an eave origin and two unit axes, with optional holes (shell
 * damage). Slate on top (keep-UVs in metres), boards underneath.
 */
function roofFace(V: Village, origin: THREE.Vector3, along: THREE.Vector3, up: THREE.Vector3, outline: [number, number][], holes: [number, number][][] = [], under: Tint = 0x5a4a3c) {
  if (new THREE.Vector3().crossVectors(along, up).y < 0) {
    // Mirror the parametrisation so the face normal points out of the roof (same world shape).
    const U = Math.max(...outline.map(([u]) => u));
    origin = origin.clone().addScaledVector(along, U);
    along = along.clone().negate();
    outline = outline.map(([u, v]) => [U - u, v]);
    holes = holes.map((h) => h.map(([u, v]) => [U - u, v] as [number, number]));
  }
  const shape = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ShapeGeometry(shape);
  const n = new THREE.Vector3().crossVectors(along, up).normalize();
  const m = new THREE.Matrix4().makeBasis(along, up, n).setPosition(origin);
  // ShapeGeometry UVs are the shape coordinates (metres) already.
  V.slate.add(geo, m, "plain", 0xffffff, { uv: "keep" });
  // Underside: a flipped copy (the builder keeps a reference to the first), a touch below.
  const g2 = geo.clone();
  const idx = g2.index!.array as Uint16Array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const nn = g2.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 0, -1);
  const m2 = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.07));
  V.timber.add(g2, m2, "plain", under, { uv: "keep", noAo: true });
  geo.dispose();
  g2.dispose();
}

/** Exposed rafters + battens across a hole (charred or bare). */
function rafters(V: Village, origin: THREE.Vector3, along: THREE.Vector3, up: THREE.Vector3, u0: number, u1: number, v0: number, v1: number, tint: Tint, r: () => number) {
  const n = new THREE.Vector3().crossVectors(along, up).normalize();
  if (n.y < 0) n.negate();
  const P = (u: number, v: number, d: number) => origin.clone().addScaledVector(along, u).addScaledVector(up, v).addScaledVector(n, d);
  for (let u = Math.ceil(u0 / 0.6) * 0.6; u < u1; u += 0.6) {
    if (r() < 0.25) continue;
    const broken = r() < 0.35 ? v0 + (v1 - v0) * (0.3 + r() * 0.5) : v1;
    rod(V.B, P(u, Math.max(0, v0 - 0.4), -0.12), P(u + (broken < v1 ? (r() - 0.5) * 0.3 : 0), broken, -0.12), 0.05, tint, "decor", "wood");
  }
  for (let v = v0 + 0.3; v < v1; v += 0.35) {
    if (r() < 0.5) continue;
    const a = u0 + r() * (u1 - u0) * 0.3, b = u1 - r() * (u1 - u0) * 0.3;
    rod(V.B, P(a, v, -0.05), P(b, v, -0.05), 0.02, tint, "decor", "wood");
  }
}

type RoofSpec = { x0: number; x1: number; z0: number; z1: number; eave: number; pitch: number; axis: "x" | "z"; hip?: boolean; over?: number; holes?: { side: 0 | 1; u: [number, number]; v: [number, number] }[]; charred?: boolean; skipHipEnd?: boolean };

/** Gable (or hip) roof over a footprint; returns ridge height. */
function roof(V: Village, s: RoofSpec, r: () => number) {
  const over = s.over ?? 0.45;
  const alongX = s.axis === "x";
  const len = (alongX ? s.x1 - s.x0 : s.z1 - s.z0) + (s.hip ? 2 * over : 0.6);
  const half = (alongX ? s.z1 - s.z0 : s.x1 - s.x0) / 2 + over;
  const tan = Math.tan(s.pitch);
  const rise = half * tan;
  const slope = half / Math.cos(s.pitch);
  const eaveY = s.eave - over * tan;
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
  const ridge = eaveY + rise;
  const ax = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const hip = s.hip ? Math.min(slope, len / 2) : 0;
  const hipRun = s.hip ? half : 0; // horizontal hip setback at the ridge
  for (const side of [0, 1] as const) {
    // Side 0 slopes down toward -perp, side 1 toward +perp.
    const perp = alongX ? new THREE.Vector3(0, 0, side ? 1 : -1) : new THREE.Vector3(side ? 1 : -1, 0, 0);
    const along = side ? ax.clone().negate() : ax.clone();
    if (!alongX) along.negate();
    const upDir = new THREE.Vector3().addScaledVector(perp, -Math.cos(s.pitch)).add(new THREE.Vector3(0, Math.sin(s.pitch), 0)).normalize();
    const eaveMid = new THREE.Vector3(cx, eaveY, cz).addScaledVector(perp, half);
    const origin = eaveMid.clone().addScaledVector(along, -len / 2);
    const k = hip ? hipRun / (len / 2) : 0;
    void k;
    const outline: [number, number][] = s.hip
      ? [[0, 0], [len, 0], [len - hipRun, slope], [hipRun, slope]]
      : [[0, 0], [len, 0], [len, slope], [0, slope]];
    const holes = (s.holes ?? []).filter((h) => h.side === side).map((h) => [[h.u[0], h.v[0]], [h.u[1], h.v[0] + 0.3], [h.u[1] - 0.4, h.v[1]], [h.u[0] + 0.3, h.v[1] - 0.2]] as [number, number][]);
    roofFace(V, origin, along, upDir, outline, holes, s.charred ? 0x2a2420 : 0x5a4a3c);
    for (const h of s.holes ?? []) if (h.side === side) rafters(V, origin, along, upDir, h.u[0], h.u[1], h.v[0], h.v[1], s.charred ? 0x2a2018 : 0x7a644a, r);
    // Gutter and fascia along the eave.
    const g0 = origin.clone().addScaledVector(perp, 0.06).add(new THREE.Vector3(0, -0.08, 0));
    const g1 = g0.clone().addScaledVector(along, len);
    rod(V.B, g0, g1, 0.06, 0x6a6a64, "decor", "metal_painted");
    // Eave edge of the slates (thickness line).
    const e = origin.clone().addScaledVector(along, len / 2).add(new THREE.Vector3(0, -0.02, 0));
    V.slate.box("plain", e.x, e.y, e.z, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, 0x8a8a8a);
  }
  if (s.hip) {
    // Hip ends: triangles from the eave corners to the ridge ends.
    for (const end of [-1, 1]) {
      const outward = ax.clone().multiplyScalar(end);
      const perpAlong = alongX ? new THREE.Vector3(0, 0, end) : new THREE.Vector3(-end, 0, 0);
      const upDir = new THREE.Vector3().addScaledVector(outward, -Math.cos(s.pitch)).add(new THREE.Vector3(0, Math.sin(s.pitch), 0)).normalize();
      if (s.skipHipEnd && end < 0) continue;
      const mid = new THREE.Vector3(cx, eaveY, cz).addScaledVector(outward, len / 2);
      const origin = mid.clone().addScaledVector(perpAlong, -half);
      roofFace(V, origin, perpAlong, upDir, [[0, 0], [half * 2, 0], [half, hipRun / Math.cos(s.pitch)]], [], s.charred ? 0x2a2420 : 0x5a4a3c);
    }
  }
  // Ridge cap: a row of angled tiles.
  const rl = s.hip ? len - 2 * hipRun : len;
  if (rl > 0.2) {
    V.slate.box("plain", cx, ridge + 0.02, cz, alongX ? rl : 0.26, 0.12, alongX ? 0.26 : rl, 0x6a6a6a, { rotX: alongX ? Math.PI / 4 : 0, rotZ: alongX ? 0 : Math.PI / 4 });
  }
  return { ridge, eaveY, len, half, rise };
}

// ---- Openings: frames, glass, shutters, doors ----------------------------------------------

function dressOpening(V: Village, f: Frame, o: HouseOpening, uWall: number, h: HouseDef, r: () => number, interior: boolean) {
  const B = V.B;
  const u = o.u - uWall;
  const stoneTrim = h.wall === "stone" ? 0xd8d0c0 : 0xe4dccb;
  const top = o.y + o.h;
  if (o.kind === "hole") return;
  // Stone surround: sill, lintel/keystone, jambs.
  if (o.kind === "win") {
    fbox(V.stone, f, "plain", u, o.y - 0.06, 0.05, o.w + 0.26, 0.12, 0.16, stoneTrim);
    if (!o.arch) fbox(V.stone, f, "plain", u, top + 0.1, 0.02, o.w + 0.3, 0.2, 0.06, stoneTrim);
    for (const s of [-1, 1]) fbox(V.stone, f, "plain", u + s * (o.w / 2 + 0.06), o.y + o.h / 2, 0.015, 0.12, o.h, 0.04, stoneTrim);
    if (o.arch) fbox(V.stone, f, "plain", u, top + o.w / 2 + 0.06, 0.02, 0.2, 0.28, 0.06, stoneTrim);
    // Frame, glazing bars, glass (some panes blown out).
    const fr = h.id === "church" ? 0x3a3430 : h.wall === "white" ? 0xe8e4dc : 0x6a5440;
    const d = -0.16;
    fbox(B, f, "wood", u, o.y + 0.03, d, o.w, 0.06, 0.08, fr);
    fbox(B, f, "wood", u, top - 0.03, d, o.w, 0.06, 0.08, fr);
    for (const s of [-1, 0, 1]) fbox(B, f, "wood", u + (s * (o.w - 0.06)) / 2, o.y + o.h / 2, d, s ? 0.06 : 0.04, o.h, 0.08, fr);
    fbox(B, f, "wood", u, o.y + o.h * 0.62, d, o.w, 0.04, 0.06, fr);
    const broken = r() < h.damage * 0.55;
    if (!broken || !interior) {
      const glass = h.id === "church" ? (r() < 0.5 ? 0x3a4a5a : 0x5a4a38) : 0x2a3036;
      fbox(B, f, "plain", u, o.y + o.h / 2 + (o.arch ? o.w * 0.2 : 0), d - 0.02, o.w - 0.04, o.h + (o.arch ? o.w * 0.4 : 0) - 0.04, 0.01, broken ? 0x0c0c0c : glass, { noAo: true });
    }
    // Shutters: folded back, closed, or hanging off a hinge.
    if (h.id !== "church" && h.id !== "barn") {
      const k = r();
      const sw = o.w / 2 + 0.02;
      const st = new THREE.Color(h.shutter).lerp(new THREE.Color(0x8a8478), 0.3).multiplyScalar(0.8 + r() * 0.25);
      const leaf = (cu: number, dd: number, rotZ = 0, yy = o.y + o.h / 2) => {
        fbox(V.timber, f, "plain", cu, yy, dd, sw, o.h - 0.02, 0.035, st, { rotZ });
        for (const by of [0.2, 0.5, 0.8]) fbox(V.timber, f, "plain", cu, o.y + o.h * by - (rotZ ? 0.1 : 0), dd + 0.02, sw - 0.04, 0.05, 0.012, st.clone().multiplyScalar(0.8), { rotZ });
      };
      if (k < 0.55) for (const s of [-1, 1]) leaf(u + s * (o.w / 2 + sw / 2 + 0.1), 0.03);
      else if (k < 0.72 && !interior) for (const s of [-1, 1]) leaf(u + (s * sw) / 2, -0.06);
      else if (k < 0.8) {
        leaf(u - (o.w / 2 + sw / 2 + 0.1), 0.03);
        leaf(u + o.w / 2 + sw / 2 + 0.05, 0.06, 0.4, o.y + o.h / 2 - 0.2);
      }
    }
    // Window box with geraniums now and then (survivors of the shelling).
    if (o.y > 2 && r() < 0.15 && h.id !== "church") {
      fbox(V.timber, f, "plain", u, o.y - 0.02, 0.18, o.w, 0.18, 0.2, 0x6a4a30);
      for (let i = 0; i < 5; i++) fbox(B, f, "plain", u - o.w / 2 + 0.12 + i * (o.w - 0.24) / 4, o.y + 0.12, 0.18, 0.14, 0.14, 0.14, i % 2 ? 0xb8382a : 0x4a6a30);
    }
    if (r() < 0.45) wallDecal(B, f, "leak", u, o.y - 0.5, o.w * 0.9, 0.9, 0xffffff, 0.012);
    return;
  }
  // Doors and archways: stone frame, step, a leaf (open on enterable houses).
  for (const s of [-1, 1]) fbox(V.stone, f, "plain", u + s * (o.w / 2 + 0.09), o.h / 2, 0.02, 0.18, o.h, 0.06, stoneTrim);
  if (!o.arch) fbox(V.stone, f, "plain", u, o.h + 0.12, 0.03, o.w + 0.5, 0.24, 0.08, stoneTrim);
  else fbox(V.stone, f, "plain", u, o.h + o.w / 2 + 0.1, 0.03, 0.26, 0.34, 0.08, stoneTrim);
  fbox(V.stone, f, "plain", u, 0.05, 0.22, o.w + 0.4, 0.1, 0.42, 0xb8b0a2);
  const leafT = new THREE.Color(r() < 0.5 ? 0x6a4a30 : h.shutter).multiplyScalar(0.85);
  // Interactive door (world/interaction/doors) hangs here: frame only.
  if (o.leaf) return;
  if (interior || o.w > 2.4) {
    // Swung inwards against the reveal.
    const n = o.w > 2.4 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const lw = o.w / n;
      const sgn = i ? 1 : -1;
      const hinge = u + sgn * (o.w / 2);
      fbox(V.timber, f, "plain", hinge - sgn * 0.03, o.h / 2, -WALL_T - lw / 2 + 0.02, 0.05, o.h - 0.05, lw - 0.06, leafT, { yaw: 0 });
    }
  } else {
    fbox(V.timber, f, "plain", u, o.h / 2, -0.14, o.w - 0.04, o.h - 0.04, 0.06, leafT);
    fbox(B, f, "metal_dark", u + o.w * 0.35, 1.05, -0.1, 0.04, 0.16, 0.04, 0x2a2a28);
  }
}

// ---- Houses ---------------------------------------------------------------------------------

const wallMat = (h: HouseDef): { B: "stone" | "B"; mat: WorldMat; tint: number } =>
  h.wall === "stone" ? { B: "stone", mat: "plain", tint: h.tint } : { B: "B", mat: "plaster", tint: h.tint };

/** Draws one HouseDef (walls, openings, roof, chimneys, interior or a dark void, damage). */
export function house(V: Village, h: HouseDef) {
  const r = rnd(seedOf(h.id));
  const ops = houseOpenings(h);
  const H = h.floors * h.fh;
  const T = h.id === "church" ? 0.6 : WALL_T;
  const W = h.x1 - h.x0, D = h.z1 - h.z0;
  const fr = facades((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, W, D, 0);
  const wm = wallMat(h);
  const WB = wm.B === "stone" ? V.stone : V.B;
  const interior = !!h.enter;
  const roofSpec = h.roof;
  const tan = roofSpec ? Math.tan(roofSpec.pitch) : 0;
  const span = roofSpec ? (roofSpec.axis === "x" ? D : W) : 0;
  const blasts: Blast[][] = [[], [], [], []];
  // Shell damage: some upper windows become holes on non-enterable houses.
  if (!interior && !h.ruin) {
    for (const o of ops) if (o.kind === "win" && o.y > 2 && r() < h.damage * 0.25) {
      blasts[o.side].push({ u: o.u, y: o.y + o.h / 2, r: 0.75 + r() * 0.4, seed: Math.floor(r() * 1e6) });
      o.w = 0;
    }
  }
  const crownFor = (side: Side) => {
    // Gable ends rise to the ridge; eave walls stop at H. Ruins get a broken crown.
    const L = sideLength(h, side);
    const gable = roofSpec && !roofSpec.hip && (roofSpec.axis === "x" ? side % 2 === 1 : side % 2 === 0);
    if (h.ruin) {
      const rr = rnd(seedOf(h.id) + side);
      const keep = h.id === "s4" ? (side === 0 ? h.fh + 0.4 : side === 2 ? h.fh + 2.6 : side === 1 ? h.fh + 1.8 : h.fh + 1.2) : H * (side === 2 ? 0.95 : side === 1 ? 0.7 : 0.55);
      const pts = Array.from({ length: Math.ceil(L / 0.3) + 1 }, () => (rr() - 0.5) * 0.7);
      return { flat: false, crown: (u: number) => Math.max(0.6, keep + pts[Math.round(u / 0.3)] - 0.3 + Math.sin(u * 1.3 + side) * 0.4) };
    }
    if (!gable) return { flat: true, crown: () => H };
    return { flat: false, crown: (u: number) => H - 0.12 + Math.max(0, (span / 2 - Math.abs(u - L / 2))) * tan };
  };
  for (const side of [0, 1, 2, 3] as Side[]) {
    const f = fr[side];
    const L = sideLength(h, side);
    // N/S walls full length; E/W tucked between them (no coplanar corners).
    const ew = side % 2 === 1;
    const u0 = ew ? T : 0, len = ew ? L - 2 * T : L;
    const c = crownFor(side);
    if (h.id === "manor" && (side === 2 || side === 3)) {
      // Blown corner: the crown collapses to the first floor at the SW corner.
      const corner = side === 2 ? L : 0;
      const base = c.crown;
      c.flat = false;
      c.crown = (u: number) => {
        const d = Math.abs(u - corner);
        const reach = side === 2 ? 6.2 : 4.4;
        const k = Math.min(1, Math.max(0, (d - reach + 1.2) / 1.6));
        const jag = Math.sin(u * 7.1) * 0.25 + Math.sin(u * 3.3) * 0.35;
        return Math.min(base(u), h.fh + 0.9 + jag + k * (H - h.fh));
      };
    }
    const sideOps = ops.filter((o) => o.side === side && o.w > 0).map((o) => ({ ...o, u: o.u - u0 }));
    const sideBlasts = blasts[side].map((b) => ({ ...b, u: b.u - u0 }));
    // Drop openings the crown would cut.
    const okOps = sideOps.filter((o) => o.y + o.h + (o.arch ? o.w / 2 : 0) < c.crown(o.u) - 0.35 && o.u - o.w / 2 > 0.2 && o.u + o.w / 2 < len - 0.2);
    addWall(WB, f, u0, { L: len, T, crown: (u) => c.crown(u + u0), flat: c.flat, openings: okOps, blasts: sideBlasts }, wm.mat, wm.tint);
    for (const o of okOps) dressOpening(V, f, { ...o, u: o.u + u0 }, 0, h, r, interior);
    // Plinth band of dressed stone, plaster grime, string course, eaves cornice.
    if (h.wall !== "stone") {
      fbox(V.stone, f, "plain", L / 2, 0.35, 0.03, L + 0.06, 0.7, 0.06, 0xb8b0a0);
      if (!h.ruin) {
        for (let fl = 1; fl < h.floors; fl++) fbox(WB, f, wm.mat, L / 2, fl * h.fh + 0.05, 0.03, L + 0.06, 0.14, 0.06, new THREE.Color(wm.tint).multiplyScalar(1.04));
        if (c.flat) fbox(WB, f, wm.mat, L / 2, H - 0.18, 0.06, L + 0.12, 0.3, 0.12, new THREE.Color(wm.tint).multiplyScalar(1.05));
      }
    } else fbox(V.stone, f, "plain", L / 2, 0.25, 0.04, L + 0.08, 0.5, 0.08, 0xa49a8a);
    if (h.wall !== "stone" && h.id !== "church") {
      quoins(V, f, 0, 1, c.crown(0) - 0.2, 0xd2c8b6);
      quoins(V, f, L, -1, c.crown(L) - 0.2, 0xd2c8b6);
    }
    // Weathering: dirt at the base, streaks below the eaves, soot and pocks with damage.
    wallDecal(V.B, f, "baseDirt", L / 2, 0.6, L, 1.2, 0xffffff, 0.035);
    for (let uu = 1 + r() * 2; uu < L - 1; uu += 2.5 + r() * 3) wallDecal(V.B, f, "leak", uu, Math.min(H, c.crown(uu)) - 0.8, 0.9 + r() * 0.8, 1.6, 0xffffff, 0.03);
    if (h.damage > 0.3) {
      for (let i = 0; i < Math.round(h.damage * 3); i++) wallDecal(V.B, f, "pocks", 1 + r() * (L - 2), 1 + r() * Math.min(4, H - 1.5), 1.4, 1.4, 0xffffff, 0.03);
      const spalls = Math.round(h.damage * 1.4 * (L / 8));
      for (let i = 0; i < spalls && h.wall !== "stone"; i++) {
        const su = 0.8 + r() * (L - 1.6), sy = 0.6 + r() * Math.min(H - 1.2, 4.5);
        if (okOps.some((o) => Math.abs(o.u + u0 - su) < o.w / 2 + 0.8 && sy > o.y - 0.7 && sy < o.y + o.h + 0.8)) continue;
        spall(V.B, f, { u: su, y: sy, r: 0.3 + r() * 0.5, seed: Math.floor(r() * 1e6) }, "decor", false);
      }
    }
    for (const b of blasts[side]) {
      wallDecal(V.B, f, "soot", b.u, b.y + b.r * 1.3, b.r * 3.2, b.r * 3.4, 0xffffff, 0.035);
      rebar(V.B, f, b.u, b.y - b.r * 0.5, 4, b.seed);
    }
    if (h.damage > 0.6 && r() < 0.5) wallDecal(V.B, f, "soot", L * (0.3 + r() * 0.4), H - 1.2, 3, 2.6, 0xffffff, 0.035);
    // Shared grime layer (rain streaks, algae, corner dirt, damp, cracks) when the dressing attached one.
    const grime = grimeOf(V.B);
    if (grime) {
      const facadeOps = okOps.map((o) => ({ ...o, u: o.u + u0 }));
      let low = Infinity;
      for (let uu = 0; uu <= L; uu += 0.5) low = Math.min(low, c.crown(uu));
      grime.facade(f, {
        length: L,
        top: c.flat ? H : Math.min(H, low) - (h.ruin ? 0.5 : 0.1),
        seed: seedOf(h.id) * 5 + side,
        holes: holeRects(facadeOps, blasts[side]),
        fromTop: !h.ruin,
        corners: !h.ruin && h.wall !== "stone",
        cracks: h.wall === "stone" ? [] : facadeOps.filter((o) => o.kind === "win"),
        amount: h.wall === "stone" ? 0.6 : 1,
        d: 0.048,
      });
    }
    if (!h.ruin && c.flat && r() < 0.6) downpipe(V.B, f, r() < 0.5 ? 0.3 : L - 0.3, H - 0.1);
    if (!h.ruin && !interior && side !== 3 && r() < 0.25 && h.floors > 1) acUnit(V.B, f, 1.2 + r() * (L - 2.4), h.fh + 0.4, Math.floor(r() * 1e6));
    if (!h.ruin && r() < 0.18 && h.floors > 1) dish(V.B, ...(() => { const p = f.at(L * 0.8, H - 1.2, 0.35); return [p.x, p.y, p.z] as const; })(), f.rotY + Math.PI / 2, 0.4);
  }
  // Inside: dark void for closed houses (windows read as unlit rooms); floors for enterable ones.
  if (!interior && !h.ruin) V.B.box("plain", (h.x0 + h.x1) / 2, H / 2, (h.z0 + h.z1) / 2, W - 2 * T - 0.1, H - 0.1, D - 2 * T - 0.1, 0x0d0c0b, { noAo: true });
  if (interior) {
    V.timber.box("plain", (h.x0 + h.x1) / 2, 0.01, (h.z0 + h.z1) / 2, W - 2 * T, 0.02, D - 2 * T, 0x8a7458, { noAo: true });
  }
  if (h.ruin) {
    // Rubble inside the shell, a broken floor slab with boards hanging.
    rubblePile(V.B, (h.x0 + h.x1) / 2 + 0.6, (h.z0 + h.z1) / 2, W * 0.32, D * 0.3, h.id === "s4" ? 0.3 : 0.8, seedOf(h.id) + 5, "decor", undefined, V.detail.debris);
    if (h.id === "s4") {
      V.B.box("concrete_broken", (h.x0 + h.x1) / 2, h.fh - 0.1, (h.z0 + h.z1) / 2, W - 0.2, 0.2, D - 0.2, 0xa8a090);
      for (let i = 0; i < 8; i++) V.timber.box("plain", h.x0 + 0.6 + r() * (W - 1.2), h.fh + 0.02, h.z0 + 0.6 + r() * (D - 1.2), 0.18, 0.03, 1.4 + r(), 0x7a6450, { rotY: r() * 3 });
      // The rubble-choked ground floor seen through the gaps.
      V.B.box("rubble", (h.x0 + h.x1) / 2, h.fh / 2, (h.z0 + h.z1) / 2, W - 2 * T - 0.05, h.fh - 0.3, D - 2 * T - 0.05, 0x8a8478);
    } else {
      for (let i = 0; i < 6; i++) rod(V.B, new THREE.Vector3(h.x0 + 0.4, h.fh - 0.15, h.z0 + 1 + i * 1.3), new THREE.Vector3(h.x0 + 1.6 + r() * 2, h.fh - 0.6 - r() * 1.2, h.z0 + 1 + i * 1.3 + (r() - 0.5)), 0.08, 0x5a4636, "decor", "wood");
    }
  }
  // Roof, chimneys, aerials.
  if (roofSpec && h.id !== "manor") {
    const holes: RoofSpec["holes"] = [];
    if (h.damage > 0.45 && r() < 0.8) {
      const L = (roofSpec.axis === "x" ? W : D) + 0.6;
      const a = 1 + r() * (L - 4);
      holes.push({ side: r() < 0.5 ? 0 : 1, u: [a, a + 1.6 + r() * 1.8], v: [0.8 + r() * 1.2, 2.6 + r() * 1.5] });
    }
    const rs = roof(V, { x0: h.x0, x1: h.x1, z0: h.z0, z1: h.z1, eave: H, pitch: roofSpec.pitch, axis: roofSpec.axis, holes }, r);
    // Barge boards along the gable verges.
    for (const end of [-1, 1]) {
      const alongX = roofSpec.axis === "x";
      const ex = alongX ? (end < 0 ? h.x0 - 0.3 : h.x1 + 0.3) : (h.x0 + h.x1) / 2;
      const ez = alongX ? (h.z0 + h.z1) / 2 : end < 0 ? h.z0 - 0.3 : h.z1 + 0.3;
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(ex + (alongX ? 0 : s * rs.half), rs.eaveY - 0.08, ez + (alongX ? s * rs.half : 0));
        const b = new THREE.Vector3(ex, rs.ridge - 0.04, ez);
        rod(V.B, a, b, 0.07, 0x4a3e32, "decor", "wood");
      }
    }
    for (const [cx, cz] of h.chimneys ?? []) chimney(V, cx, cz, rs.ridge, h.wall === "stone" ? "stone" : "brick", r);
    if (h.chimneys?.length && r() < 0.75) aerial(V, h.chimneys[0][0], rs.ridge + 1.1, h.chimneys[0][1], r);
  }
}

function chimney(V: Village, x: number, z: number, ridge: number, kind: "stone" | "brick", r: () => number) {
  const top = ridge + 0.9 + r() * 0.4;
  const y0 = ridge - 2.6;
  const w = 0.62, d = 0.5;
  if (kind === "stone") V.stone.box("plain", x, (y0 + top) / 2, z, w, top - y0, d, 0xc8c0b2);
  else V.B.box("brick", x, (y0 + top) / 2, z, w, top - y0, d, 0xc8a898);
  V.stone.box("plain", x, top + 0.05, z, w + 0.14, 0.1, d + 0.14, 0xb8b0a4);
  const pot = new THREE.CylinderGeometry(0.1, 0.12, 0.35, 8);
  for (const o of r() < 0.5 ? [-0.14, 0.14] : [0]) V.B.add(pot, new THREE.Matrix4().makeTranslation(x + o, top + 0.27, z), "plain", 0x9a5a3a, { uv: "keep" });
  pot.dispose();
  // Soot round the top.
  V.B.box("plain", x, top - 0.25, z, w + 0.004, 0.5, d + 0.004, 0x2a2624, { noAo: true });
}

/** Old TV aerial (yagi) on a mast. */
function aerial(V: Village, x: number, y: number, z: number, r: () => number) {
  const h = 1.6 + r();
  rod(V.B, new THREE.Vector3(x, y - 1.2, z), new THREE.Vector3(x, y + h, z), 0.02, 0x7a7a74);
  const yaw = r() * Math.PI;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const boom = (yy: number, L: number) => {
    rod(V.B, new THREE.Vector3(x - c * L / 2, y + yy, z + s * L / 2), new THREE.Vector3(x + c * L / 2, y + yy, z - s * L / 2), 0.01, 0x8a8a84);
    for (let i = 0; i < 6; i++) {
      const t = -L / 2 + (i * L) / 5;
      const ex = 0.5 - i * 0.05;
      rod(V.B, new THREE.Vector3(x + c * t - s * ex, y + yy, z - s * t - c * ex), new THREE.Vector3(x + c * t + s * ex, y + yy, z - s * t + c * ex), 0.006, 0x9a9a94);
    }
  };
  boom(h - 0.1, 1.6);
  if (r() < 0.5) boom(h * 0.6, 1.1);
  if (r() < 0.6) cable(V.B, new THREE.Vector3(x, y + 0.2, z), new THREE.Vector3(x + 1.5, y - 2.4, z + 0.8), 0.3);
}

// ---- Church tower, belfry and onion dome ------------------------------------------------------

export function churchTower(V: Village) {
  const t = TOWER;
  const r = rnd(991);
  const cx = 0, cz = (t.z0 + t.z1) / 2, W = t.x1 - t.x0;
  const fr = facades(cx, cz, W, W, 0);
  const tint = 0xece6d8;
  for (const side of [0, 1, 2, 3] as Side[]) {
    const f = fr[side];
    // Shaft: south face has the arched porch door; a clock face and slit windows up the shaft.
    const ops = side === 2 ? [{ u: W / 2, y: 0, w: 2.0, h: 2.6, arch: true }] : [];
    if (side !== 0) ops.push({ u: W / 2, y: 7.0, w: 0.5, h: 1.2, arch: true });
    const ew = side % 2 === 1;
    const u0 = ew ? 0.6 : 0, len = ew ? W - 1.2 : W;
    addWall(V.B, f, u0, { L: len, T: 0.6, crown: () => t.shaft, flat: true, openings: ops.map((o) => ({ ...o, u: o.u - u0 })), blasts: [] }, "plaster", tint);
    quoins(V, f, 0, 1, t.belfry, 0xd2c8b6);
    quoins(V, f, W, -1, t.belfry, 0xd2c8b6);
    fbox(V.stone, f, "plain", W / 2, 0.4, 0.03, W + 0.06, 0.8, 0.06, 0xb8b0a0);
    // Cornices at the porch and the belfry floor.
    fbox(V.B, f, "plaster", W / 2, t.porch + 0.1, 0.08, W + 0.2, 0.2, 0.16, 0xf4f0e6);
    fbox(V.B, f, "plaster", W / 2, t.shaft - 0.1, 0.1, W + 0.3, 0.3, 0.2, 0xf4f0e6);
    fbox(V.B, f, "plaster", W / 2, t.belfry + 0.15, 0.12, W + 0.4, 0.3, 0.24, 0xf4f0e6);
    if (side === 2) for (const s of [-1, 1]) fbox(V.stone, f, "plain", W / 2 + s * 1.12, 1.3, 0.03, 0.22, 2.6, 0.08, 0xd8d0c0);
    // Clock.
    if (side !== 0) {
      const c = f.at(W / 2, 9.9, 0.04);
      const disc = new THREE.CylinderGeometry(0.75, 0.75, 0.06, 24).rotateX(Math.PI / 2);
      V.B.add(disc, new THREE.Matrix4().makeRotationY(f.rotY).setPosition(c), "metal_painted", 0x2a3a34, { uv: "keep" });
      const ring = new THREE.TorusGeometry(0.75, 0.05, 4, 24);
      V.B.add(ring, new THREE.Matrix4().makeRotationY(f.rotY).setPosition(f.at(W / 2, 9.9, 0.08)), "metal_painted", 0xb89a50, { uv: "keep" });
      disc.dispose();
      ring.dispose();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        fbox(V.B, f, "metal_painted", W / 2 + Math.cos(a) * 0.6, 9.9 + Math.sin(a) * 0.6, 0.08, 0.05, 0.12, 0.02, 0xc8aa60, { rotZ: -a });
      }
      fbox(V.B, f, "metal_painted", W / 2 + 0.12, 9.9 + 0.2, 0.1, 0.04, 0.5, 0.02, 0xc8aa60, { rotZ: -0.5 });
      fbox(V.B, f, "metal_painted", W / 2 - 0.15, 9.9 + 0.05, 0.1, 0.035, 0.36, 0.02, 0xc8aa60, { rotZ: 1.9 });
    }
    wallDecal(V.B, f, "baseDirt", W / 2, 0.7, W, 1.4, 0xffffff, 0.04);
    wallDecal(V.B, f, "leak", W * 0.3, t.shaft - 1.2, 1.2, 2.4, 0xffffff, 0.04);
    if (side === 1) wallDecal(V.B, f, "pocks", W * 0.6, 6, 1.6, 1.6, 0xffffff, 0.04);
    // Belfry: piers between big arches, a parapet rail.
    fbox(V.B, f, "plaster", W / 2, t.belfry - 0.4, 0.0, W, 0.8, 0.6, tint);
    for (const s of [-1, 1]) fbox(V.B, f, "plaster", W / 2 + s * 2.1, (t.shaft + t.belfry) / 2, -0.5, 1.0, t.belfry - t.shaft, 1.0, tint);
    const archGeo = new THREE.TorusGeometry(1.6, 0.18, 4, 10, Math.PI);
    V.B.add(archGeo, f.matrix(W / 2, t.belfry - 1.8, 0.02), "plaster", 0xf4f0e6, { uv: "keep" });
    archGeo.dispose();
    railing(V.B, f.at(0.6, t.shaft + 0.02, 0.05), f.at(W - 0.6, t.shaft + 0.02, 0.05), 0.9, 0x2a2a28, 0.16);
  }
  // Bell.
  const bell = new THREE.LatheGeometry([[0, 1.0], [0.18, 0.98], [0.3, 0.8], [0.36, 0.35], [0.55, 0.02], [0.5, 0]].map(([a, b]) => new THREE.Vector2(a, b)), 14);
  V.B.add(bell, new THREE.Matrix4().makeTranslation(cx, t.belfry - 1.25, cz), "metal_painted", 0x7a6a40, { uv: "keep" });
  bell.dispose();
  V.timber.box("plain", cx, t.belfry - 0.15, cz, W - 1.4, 0.2, 0.24, 0x5a4636);
  // Onion dome with a lantern and finial (patinated copper).
  const copper = 0x6e9a88;
  const prof: [number, number][] = [[2.95, 0], [2.95, 0.25], [2.6, 0.4], [2.3, 0.9], [2.55, 1.7], [2.35, 2.5], [1.6, 3.2], [0.7, 3.8], [0.35, 4.3], [0.4, 4.4]];
  const dome = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 20);
  const y0 = t.belfry + 0.3;
  V.B.add(dome, new THREE.Matrix4().makeTranslation(cx, y0, cz), "metal_painted", copper, { uv: "keep", uvScale: [6, 3] });
  dome.dispose();
  // Lantern: little open drum on posts + a second small onion.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    V.B.box("plaster", cx + Math.cos(a) * 0.38, y0 + 4.85, cz + Math.sin(a) * 0.38, 0.1, 0.9, 0.1, 0xf0ece2);
  }
  const small = new THREE.LatheGeometry([[0.55, 0], [0.6, 0.2], [0.5, 0.55], [0.2, 0.9], [0.06, 1.2], [0, 1.25]].map(([a, b]) => new THREE.Vector2(a, b)), 14);
  V.B.add(small, new THREE.Matrix4().makeTranslation(cx, y0 + 5.3, cz), "metal_painted", copper, { uv: "keep" });
  small.dispose();
  rod(V.B, new THREE.Vector3(cx, y0 + 6.5, cz), new THREE.Vector3(cx, y0 + 8.0, cz), 0.035, 0xb89a50, "decor", "metal_painted");
  const ball = new THREE.SphereGeometry(0.16, 10, 8);
  V.B.add(ball, new THREE.Matrix4().makeTranslation(cx, y0 + 6.8, cz), "metal_painted", 0xc8a850, { uv: "keep" });
  ball.dispose();
  // Weathervane arrow.
  V.B.box("metal_dark", cx, y0 + 7.6, cz, 0.9, 0.04, 0.02, 0x2a2a28, { rotY: 0.7 });
  void r;
}

// ---- Church nave interior ---------------------------------------------------------------------

export function churchInterior(V: Village, pews: { x: number; z: number; w: number; d: number; rotY?: number }[]) {
  const r = rnd(4411);
  for (const p of pews) {
    const yaw = p.rotY ?? 0;
    V.timber.box("plain", p.x, 0.45, p.z, p.w, 0.06, 0.42, 0x6a4a32, { rotY: yaw });
    V.timber.box("plain", p.x, 0.75, p.z + 0.22, p.w, 0.5, 0.05, 0x5e4230, { rotY: yaw });
    for (const s of [-1, 1]) V.timber.box("plain", p.x + s * (p.w / 2 - 0.03) * Math.cos(yaw), 0.48, p.z - s * (p.w / 2 - 0.03) * Math.sin(yaw), 0.06, 0.96, 0.5, 0x4e3626, { rotY: yaw });
  }
  // Chancel step, altar, a fallen candlestand and rubble under a shell hole in the roof.
  V.stone.box("plain", 0, 0.15, -32, 10.8, 0.3, 2.8, 0xd0c8b8);
  V.stone.box("plain", 0, 0.78, -32.1, 2.4, 0.95, 1.0, 0xe0d8c8);
  V.B.box("cloth", 0, 1.26, -32.1, 2.5, 0.02, 1.1, 0xe8e0d0);
  V.B.box("metal_painted", 1.6, 0.35, -30.2, 0.06, 1.4, 0.06, 0xb89a50, { rotZ: 1.4 });
  rubblePile(V.B, -3.6, -26.5, 1.4, 1.2, 0.45, 4412, "decor", undefined, V.detail.debris);
  debrisScatter(V.B, -3, -26, 3, 30, 4413, "decor");
  // Light from the tall windows falls on a floor of old flagstones.
  V.stone.box("plain", 0, 0.012, -26.3, 10.8, 0.02, 14.2, 0x9e968a, { noAo: true });
  void r;
}

// ---- The manor: blown corner interior, fire-blackened -----------------------------------------

export function manorDetail(V: Village, h: HouseDef) {
  const r = rnd(7070);
  const H = h.floors * h.fh;
  const zf = -29;
  // Exposed inner walls of the upper rooms (sooty, wallpaper strips), broken floor at the second storey.
  V.B.box("plaster_damaged", 23.85, (h.fh + H) / 2, (zf + h.z1) / 2, 0.3, H - h.fh, h.z1 - zf, 0x8a7a6a);
  V.B.box("plaster_damaged", 21.5, (h.fh + H) / 2, zf - 0.15, 5, H - h.fh, 0.3, 0x7a6a5a);
  V.B.box("plain", 23.69, h.fh + 2, -27, 0.02, 2.6, 3.4, 0x1a1614, { noAo: true });
  V.B.box("plain", 21.5, h.fh + 2.4, zf + 0.01, 4.6, 3.2, 0.02, 0x1c1814, { noAo: true });
  V.B.box("concrete_broken", 21.4, h.fh * 2 - 0.1, zf + 1.2, 4.6, 0.2, 2.2, 0x6a625a, { rotX: -0.18 });
  for (let i = 0; i < 6; i++) {
    const z = zf + 0.4 + i * 0.7;
    rod(V.B, new THREE.Vector3(23.8, h.fh * 2 - 0.15, z), new THREE.Vector3(19.6 + r() * 1.5, h.fh * 2 - 0.4 - r() * 1.4, z + (r() - 0.5) * 0.4), 0.09, 0x2a2018, "decor", "wood");
  }
  // Charred first-floor boards where the snipers lie, rubble and ash on them.
  V.timber.box("plain", 21.4, h.fh + 0.21, -27, 4.6, 0.02, 3.6, 0x3a2e24, { noAo: true });
  debrisScatter(V.B, 21.4, -27, 2.2, 26, 7071, "decor", () => h.fh + 0.22);
  rubblePile(V.B, 17.0, -24.2, 2.2, 2.6, 1.3, 7072, "decor", undefined, V.detail.debris);
  rubblePile(V.B, 20.0, -23.5, 1.6, 1.2, 0.7, 7073, "decor", undefined, V.detail.debris);
  // The roof: hipped, burned through over the west half.
  roof(V, { x0: h.x0, x1: h.x1, z0: h.z0, z1: zf + 0.3, eave: H, pitch: h.roof!.pitch, axis: "x", hip: true, charred: true, skipHipEnd: false, holes: [{ side: 1, u: [7.4, 11.6], v: [0.0, 3.6] }, { side: 0, u: [1.5, 3.8], v: [1.4, 3.0] }] }, r);
  // Roof over the east front block (lower, separate) with charred rafters at its broken west end.
  roof(V, { x0: 24, x1: h.x1, z0: zf, z1: h.z1, eave: H, pitch: 0.75, axis: "x", over: 0.3 }, r);
  for (let i = 0; i < 5; i++) {
    const z = zf + 0.4 + i * 0.85;
    rod(V.B, new THREE.Vector3(24.2, H + 0.3, z), new THREE.Vector3(22.2 + r(), H - 0.6 - r() * 1.5, z + (r() - 0.5) * 0.5), 0.07, 0x1e1812, "decor", "wood");
  }
  for (const [cx, cz] of h.chimneys ?? []) chimney(V, cx, cz, H + 3.4, "brick", r);
  // Soot plumes above the openings, scorched render.
  const fr = facades((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0, 0);
  wallDecal(V.B, fr[2], "soot", 9.5, h.fh + 3, 6, 5, 0xffffff, 0.04);
  wallDecal(V.B, fr[3], "soot", 2.5, h.fh + 3, 5, 5, 0xffffff, 0.04);
  wallDecal(V.B, fr[2], "soot", 3.5, h.fh * 2 + 1.5, 3, 3, 0xffffff, 0.04);
  // Entrance hall: fallen plaster, an overturned cabinet, glowing embers deeper in.
  debrisScatter(V.B, 26, -27, 3, 30, 7074, "decor");
  rubblePile(V.B, 21, -27.4, 1.4, 1.2, 0.5, 7075, "decor", undefined, V.detail.debris);
  V.timber.box("plain", 28.6, 0.4, -28.2, 1.8, 0.8, 0.5, 0x4a3426, { rotZ: 1.5 });
  for (let i = 0; i < 10; i++) V.B.box("glow", 19.6 + r() * 3.8, h.fh + 0.25 + r() * 0.05, -28.6 + r() * 3, 0.15 + r() * 0.2, 0.04, 0.1 + r() * 0.1, 0xff7a30, { rotY: r() * 3 });
}

// ---- The statue: a bronze stonemason with his hammer, on a granite plinth --------------------------

export function statue(V: Village, x: number, z: number, top: number) {
  const g = V.stone;
  // Stepped base, die with a bronze plaque, moulded cornice.
  g.box("plain", x, 0.12, z, 3.4, 0.24, 3.4, 0xb8b0a4);
  g.box("plain", x, 0.36, z, 3.0, 0.24, 3.0, 0xc4bcb0);
  g.box("plain", x, 0.95, z, 2.4, 1.0, 2.4, 0xcac2b6);
  g.box("plain", x, 1.52, z, 2.75, 0.18, 2.75, 0xd0c8bc);
  g.box("plain", x, top - 0.05, z, 2.2, 0.1, 2.2, 0xbab2a6);
  V.B.box("metal_painted", x, 0.98, z + 1.205, 1.2, 0.55, 0.02, 0x5a6a52);
  for (let i = 0; i < 3; i++) V.B.box("metal_painted", x, 1.1 - i * 0.14, z + 1.218, 0.9 - i * 0.2, 0.05, 0.01, 0x8a9a7a);
  wallDecal(V.B, facades(x, z, 2.4, 2.4, 0)[2], "leak", 1.2, 1.1, 2.0, 0.9, 0xffffff, 0.015);
  // Figure (≈2.4 m), weathered bronze with verdigris; facing south over the square.
  const bronze = 0x5e7a66, dark = 0x4a5a48;
  const y = top;
  const m = new THREE.Matrix4();
  const put = (geo: THREE.BufferGeometry, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1], tint: Tint = bronze) => {
    m.compose(new THREE.Vector3(x + px, y + py, z + pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
    V.B.add(geo, m, "metal_painted", tint, { uv: "keep" });
  };
  const leg = new THREE.CylinderGeometry(0.1, 0.13, 0.95, 8);
  put(leg, -0.15, 0.48, -0.08, 0.12, 0, 0.04);
  put(leg, 0.16, 0.48, 0.12, -0.18, 0, -0.04);
  const boot = new THREE.BoxGeometry(0.17, 0.12, 0.32);
  put(boot, -0.15, 0.06, -0.02);
  put(boot, 0.17, 0.06, 0.24, 0, 0.1);
  // Long work coat flaring over the knees, belt, torso.
  const coat = new THREE.LatheGeometry([[0.38, 0], [0.34, 0.25], [0.28, 0.55], [0.25, 0.75]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
  put(coat, 0, 0.55, 0.02, 0.06, 0, 0, [1, 1, 0.8]);
  const torso = new THREE.SphereGeometry(0.5, 12, 10);
  put(torso, 0, 1.55, 0.02, 0, 0, 0, [0.52, 0.72, 0.36]);
  put(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 12), 0, 1.3, 0.02, 0, 0, 0, [1, 1, 0.75], dark);
  const head = new THREE.SphereGeometry(0.13, 12, 10);
  put(head, 0, 2.05, 0.04, 0, 0, 0, [1, 1.12, 1.05]);
  put(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), 0, 1.9, 0.03);
  // Flat cap with a brim.
  put(new THREE.CylinderGeometry(0.15, 0.14, 0.08, 12), 0, 2.2, 0.02);
  put(new THREE.BoxGeometry(0.2, 0.02, 0.12), 0, 2.17, 0.15, 0.2);
  // Right arm up, hammer resting on the shoulder; left arm holding a dressed stone at the hip.
  const arm = new THREE.CylinderGeometry(0.06, 0.075, 0.42, 8);
  put(arm, 0.3, 1.66, 0.0, 0, 0, 0.9);
  put(arm, 0.4, 1.86, 0.12, -1.1, 0, 0.2);
  const handle = new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6);
  put(handle, 0.36, 2.02, -0.05, 1.1, 0, -0.25, [1, 1, 1], dark);
  put(new THREE.BoxGeometry(0.3, 0.11, 0.11), 0.33, 2.32, -0.36, 1.1, 0, -0.25, [1, 1, 1], dark);
  put(arm, -0.32, 1.58, 0.04, 0, 0, -0.35);
  put(arm, -0.4, 1.3, 0.16, -1.2, 0, 0);
  put(new THREE.BoxGeometry(0.36, 0.22, 0.26), -0.42, 1.25, 0.3, 0, 0.3, 0, [1, 1, 1], 0x8a9a88);
  for (const geo of [leg, boot, coat, torso, head, arm, handle]) geo.dispose();
}

// ---- Knocked-out tank (original design: low hull, rounded turret, side skirts) --------------------

export function tankHulk(V: Village, x: number, z: number, yaw: number, seed: number) {
  const r = rnd(seed);
  const B = V.B;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const L = 6.9, W = 3.3;
  const body = new THREE.Color(0x868a66), burnt = new THREE.Color(0x5a5048);
  const tint = () => body.clone().lerp(burnt, 0.15 + r() * 0.35);
  const put = (mat: WorldMat, lx: number, ly: number, lz: number, w: number, h: number, d: number, t: Tint, rx = 0, rz = 0, ry = 0) => {
    const m = base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(w, h, d)));
    B.add(UNIT, m, mat, t);
  };
  // Hull: side profile with a sloped glacis and rear deck, extruded across the width.
  const prof = new THREE.Shape();
  prof.moveTo(-L / 2, 0.55);
  prof.lineTo(L / 2 - 0.9, 0.5);
  prof.lineTo(L / 2, 1.0);
  prof.lineTo(L / 2 - 1.35, 1.75);
  prof.lineTo(-L / 2 + 0.2, 1.8);
  prof.lineTo(-L / 2, 1.5);
  prof.closePath();
  const hull = new THREE.ExtrudeGeometry(prof, { depth: W - 1.0, bevelEnabled: false });
  hull.translate(0, 0, -(W - 1.0) / 2);
  B.add(hull, base, "metal_painted", tint(), {});
  hull.dispose();
  // Track runs: belt boxes, road wheels, drive sprocket and idler; fenders; one skirt hanging, one missing.
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12).rotateX(Math.PI / 2);
  for (const sd of [-1, 1]) {
    const tz = sd * (W / 2 - 0.3);
    put("metal_dark", 0, 0.3, tz, L - 0.6, 0.12, 0.6, 0x4a4640);
    put("metal_dark", 0, 1.02, tz, L - 1.2, 0.08, 0.6, 0x4a4640);
    for (let i = 0; i < 6; i++) {
      const lx = -L / 2 + 0.95 + i * 0.98;
      B.add(wheel, base.clone().multiply(new THREE.Matrix4().makeTranslation(lx, 0.45, tz)), "metal_dark", 0x56524a, { uv: "keep" });
    }
    for (const lx of [L / 2 - 0.45, -L / 2 + 0.35]) B.add(wheel, base.clone().multiply(new THREE.Matrix4().makeTranslation(lx, 0.82, tz)), "metal_dark", 0x524e46, { uv: "keep" });
    put("metal_painted", 0, 1.22, sd * (W / 2 - 0.25), L - 0.4, 0.05, 0.7, tint());
    if (sd > 0) put("metal_painted", -0.4, 0.82, sd * (W / 2 + 0.02), 3.2, 0.7, 0.04, tint(), 0.12, 0.05);
  }
  wheel.dispose();
  // Thrown track lying beside the hulk.
  for (let i = 0; i < 14; i++) put("metal_dark", -2.6 + i * 0.38, 0.04, -W / 2 - 0.9 - Math.sin(i * 0.4) * 0.35, 0.34, 0.07, 0.6, 0x4a4640, 0, 0, Math.sin(i * 0.4) * 0.3);
  // Turret: low, rounded cast shape; gun drooping; hatches open; smoke launchers.
  const tur = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const tm = base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-0.3, 1.78, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.35, 0)), new THREE.Vector3(1.55, 0.72, 1.35)));
  B.add(tur, tm, "metal_painted", tint(), {});
  tur.dispose();
  const gyaw = 0.35;
  const gun = new THREE.CylinderGeometry(0.08, 0.11, 4.4, 10).rotateZ(Math.PI / 2);
  const gm = base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-0.3 + Math.cos(gyaw) * 3.4, 2.05 - 0.22, -Math.sin(gyaw) * 3.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, gyaw, -0.1)), new THREE.Vector3(1, 1, 1)));
  B.add(gun, gm, "metal_dark", 0x55554c, { uv: "keep" });
  gun.dispose();
  const mantlet = base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-0.3 + Math.cos(gyaw) * 1.25, 2.05, -Math.sin(gyaw) * 1.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, gyaw, 0)), new THREE.Vector3(0.5, 0.42, 0.7)));
  B.add(UNIT, mantlet, "metal_painted", tint());
  const hatch = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 10);
  B.add(hatch, base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(-0.8, 2.75, 0.45), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.2, 0, 0)), new THREE.Vector3(1, 1, 1))), "metal_painted", tint(), { uv: "keep" });
  hatch.dispose();
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) put("metal_dark", 0.3 + i * 0.16, 2.15, sd * 1.15, 0.1, 0.1, 0.32, 0x2a2a28, 0.5 * sd);
  // Stowage bin, tow cables, a crooked antenna; scorch and debris around.
  put("metal_painted", -1.75, 1.95, 0, 0.6, 0.45, 1.8, tint());
  rod(B, new THREE.Vector3(x - c * 1.6 + s * 0.6, 2.4, z + s * 1.6 + c * 0.6), new THREE.Vector3(x - c * 2.4 + s * 0.6, 4.4, z + s * 2.4 + c * 0.6), 0.012, 0x222222);
  void r;
}
const UNIT = new THREE.BoxGeometry(1, 1, 1);

/** Dusty farm pickup (intact but abandoned): profile body, cab glass, bed, tyres. */
export function pickup(V: Village, x: number, z: number, yaw: number) {
  const B = V.B;
  const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const L = 5.1, W = 1.86, hl = L / 2;
  const paint = 0xc8c4b4;
  const s = new THREE.Shape();
  s.moveTo(-hl, 0.42);
  s.lineTo(hl, 0.42);
  s.lineTo(hl + 0.05, 0.8);
  s.lineTo(hl - 0.15, 1.05);
  s.lineTo(1.2, 1.08);
  s.lineTo(0.75, 1.7);
  s.lineTo(-0.38, 1.72);
  s.lineTo(-0.5, 1.08);
  s.lineTo(-hl, 1.06);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  geo.translate(0, 0, -W / 2);
  B.add(geo, base, "metal_painted", paint);
  geo.dispose();
  const put = (mat: WorldMat, lx: number, ly: number, lz: number, w: number, h: number, d: number, t: Tint) =>
    B.add(UNIT, base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion(), new THREE.Vector3(w, h, d))), mat, t);
  // Glass: windscreen and side windows as dark panes just proud of the cab.
  for (const sd of [-1, 1]) put("plain", 0.18, 1.4, sd * (W / 2 + 0.045), 0.95, 0.42, 0.01, 0x262c30);
  const ws = new THREE.PlaneGeometry(W - 0.2, 0.68);
  B.add(ws, base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0.99, 1.4, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, -0.95)), new THREE.Vector3(1, 1, 1))), "plain", 0x2a3034, { uv: "keep" });
  ws.dispose();
  // Bed: dark floor, a tarp and jerrycans.
  put("metal_dark", -1.55, 1.08, 0, 1.95, 0.03, W - 0.1, 0x3a3834);
  put("canvas", -1.8, 1.25, 0.2, 1.1, 0.3, 1.2, 0x7a7058);
  // Wheels with tyres, bumpers, lights, mirrors.
  const tyre = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 14).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 8).rotateX(Math.PI / 2);
  for (const ax of [-hl + 0.95, hl - 0.85]) for (const sd of [-1, 1]) {
    B.add(tyre, base.clone().multiply(new THREE.Matrix4().makeTranslation(ax, 0.38, sd * (W / 2 - 0.12))), "plain", 0x1e1d1b, { uv: "keep" });
    B.add(hub, base.clone().multiply(new THREE.Matrix4().makeTranslation(ax, 0.38, sd * (W / 2 - 0.1))), "metal_painted", 0x8a8a84, { uv: "keep" });
  }
  tyre.dispose();
  hub.dispose();
  put("metal_dark", hl + 0.08, 0.55, 0, 0.12, 0.18, W + 0.04, 0x2a2a28);
  put("metal_dark", -hl - 0.06, 0.55, 0, 0.1, 0.16, W + 0.02, 0x2a2a28);
  for (const sd of [-1, 1]) {
    put("plain", hl + 0.04, 0.88, sd * 0.68, 0.03, 0.12, 0.26, 0xd8d4c0);
    put("plain", -hl - 0.01, 0.9, sd * 0.78, 0.03, 0.14, 0.14, 0x8a2a20);
    put("metal_dark", 1.0, 1.42, sd * (W / 2 + 0.16), 0.05, 0.16, 0.12, 0x222222);
  }
  // Dust film on the lower body.
  put("plain", 0, 0.62, W / 2 + 0.05, L - 0.3, 0.32, 0.005, 0xa89a7c);
  put("plain", 0, 0.62, -W / 2 - 0.05, L - 0.3, 0.32, 0.005, 0xa89a7c);
}

export const ALL_HOUSES = HOUSES;
