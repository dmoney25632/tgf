import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { ModelPlacer } from "../Props";
import type { ModelId } from "../../assets/manifest";
import type { WorldMat } from "../WorldMaterials";
import { cable, fbox, type Frame, type Opening, type Tint } from "./kit";

/**
 * Facade detail shared by building(): corner quoins / pilasters, cornice
 * corbels, glazed and backed openings, door surrounds, wall-hugging cable
 * runs and street clutter at the wall foot. Everything merges into the
 * MeshBuilder (triangles, not draw calls); props go through the instanced
 * ModelPlacer.
 */

export type CornerStyle = "quoins" | "pilaster" | "none";

/** How far an opening reaches up (arched heads rise by w/2). */
const headOf = (o: Opening) => o.y + o.h + (o.arch ? o.w / 2 : 0);

/** Widest trim that fits at a wall edge between y0..y1 without covering an opening. */
function edgeRoom(openings: Opening[], L: number, atStart: boolean, y0: number, y1: number, want: number) {
  let w = want;
  for (const o of openings) {
    if (headOf(o) + 0.1 < y0 || o.y - 0.1 > y1) continue;
    const gap = atStart ? o.u - o.w / 2 - 0.08 : L - (o.u + o.w / 2) - 0.08;
    w = Math.min(w, gap);
  }
  return w;
}

/**
 * Corner treatment on both vertical edges of a facade: alternating long/short
 * quoin blocks (stone corners) or a plain proud pilaster strip. The u = 0 edge
 * also fills the corner cube so the neighbouring facade's trim meets it.
 */
export function cornerTrim(B: MeshBuilder, f: Frame, L: number, H: number, openings: Opening[], style: CornerStyle, tint: Tint, group: string, mat: WorldMat = "plaster") {
  if (style === "none" || L < 2) return;
  const P = 0.04; // proud
  if (style === "quoins") {
    const course = 0.34, gap = 0.035;
    let k = 0;
    for (let y = 0.95; y + course < H - 0.3; y += course, k++) {
      for (const atStart of [true, false]) {
        const long = (k % 2 === 0) === atStart;
        const w = edgeRoom(openings, L, atStart, y, y + course, long ? 0.56 : 0.3);
        if (w < 0.14) continue;
        const u0 = atStart ? -P : L - w, u1 = atStart ? w : L;
        fbox(B, f, mat, (u0 + u1) / 2, y + (course - gap) / 2, P / 2, u1 - u0, course - gap, P, tint, { group });
      }
    }
    return;
  }
  for (const atStart of [true, false]) {
    // Start above any opening hugging this edge (shopfronts).
    let y0 = 0.95;
    for (const o of openings) {
      const gap = atStart ? o.u - o.w / 2 : L - (o.u + o.w / 2);
      if (gap < 0.42) y0 = Math.max(y0, headOf(o) + 0.3);
    }
    if (y0 > H - 1) continue;
    const w = 0.34;
    const u0 = atStart ? -P : L - w, u1 = atStart ? w : L;
    fbox(B, f, mat, (u0 + u1) / 2, (y0 + H - 0.25) / 2, P / 2, u1 - u0, H - 0.25 - y0, P, tint, { group });
  }
}

/** Corbel brackets under the top cornice band, skipped over tall window heads. */
export function corbels(B: MeshBuilder, f: Frame, L: number, H: number, openings: Opening[], tint: Tint, group: string, mat: WorldMat = "plaster") {
  const y = H - 0.33;
  const n = Math.max(2, Math.round((L - 0.8) / 0.55));
  for (let i = 0; i <= n; i++) {
    const u = 0.4 + ((L - 0.8) * i) / n;
    if (openings.some((o) => Math.abs(o.u - u) < o.w / 2 + 0.25 && headOf(o) + 0.2 > y - 0.1)) continue;
    fbox(B, f, mat, u, y, 0.07, 0.13, 0.2, 0.14, tint, { group });
    // Little step under each bracket reads as a moulded profile.
    fbox(B, f, mat, u, y - 0.13, 0.04, 0.1, 0.06, 0.08, tint, { group });
  }
}

const GLASS = [0x1b2125, 0x232a2f, 0x2b3236, 0x181c20, 0x343b3c, 0x262a2a];
const CURTAIN = [0x8a7a64, 0x6e5a48, 0x7a6e62, 0x5c6470, 0x8c8676, 0x7a4a3a];

/**
 * Glass in a window/door opening (dark, slightly varied panes, some with a
 * drawn curtain, the odd broken one), plus a dark backing inside the wall so
 * a sealed building never shows its empty shell. Visual only.
 */
export function glazeOpening(B: MeshBuilder, f: Frame, o: Opening, r: () => number, damage: number, backing: boolean, group: string, T = 0.3) {
  const broken = r() < damage * 0.35;
  if (backing) {
    // Inside face of the wall: a dark "room" plane behind the opening.
    fbox(B, f, "plain", o.u, o.y + (o.h + (o.arch ? o.w / 2 : 0)) / 2, -T - 0.03, o.w + 0.1, o.h + (o.arch ? o.w / 2 : 0) + 0.1, 0.02, 0x0f0e0d, { group, noAo: true });
  }
  if (broken) return;
  const d = -0.15;
  const tint = GLASS[Math.floor(r() * GLASS.length)];
  const curtain = r() < 0.35;
  const ph = o.h - 0.03;
  if (curtain) {
    const ch = ph * (0.45 + r() * 0.5);
    const ct = new THREE.Color(CURTAIN[Math.floor(r() * CURTAIN.length)]).multiplyScalar(0.55);
    fbox(B, f, "plain", o.u, o.y + o.h - 0.015 - ch / 2, d, o.w - 0.03, ch, 0.012, ct, { group, noAo: true });
    if (ph - ch > 0.05) fbox(B, f, "plain", o.u, o.y + 0.015 + (ph - ch) / 2, d, o.w - 0.03, ph - ch, 0.012, tint, { group, noAo: true });
  } else fbox(B, f, "plain", o.u, o.y + o.h / 2, d, o.w - 0.03, ph, 0.012, tint, { group, noAo: true });
  if (o.arch) {
    const geo = new THREE.CircleGeometry(o.w / 2 - 0.015, 10, 0, Math.PI).rotateY(Math.PI);
    B.add(geo, f.matrix(o.u, o.y + o.h - 0.01, d + 0.006), "plain", tint, { group, noAo: true, uv: "keep" });
    geo.dispose();
  }
}

/** Shopfront glazing: big pane with a mullion grid and a stall riser, dark inside. */
export function glazeShop(B: MeshBuilder, f: Frame, o: Opening, r: () => number, backing: boolean, frameTint: Tint, group: string, T = 0.3) {
  if (backing) fbox(B, f, "plain", o.u, o.y + o.h / 2, -T - 0.03, o.w + 0.1, o.h + 0.1, 0.02, 0x0f0e0d, { group, noAo: true });
  const d = -0.2;
  fbox(B, f, "plain", o.u, o.y + 0.25, d, o.w - 0.02, 0.5, 0.06, new THREE.Color(frameTint).multiplyScalar(0.7), { group });
  if (r() < 0.25) return; // smashed out
  fbox(B, f, "plain", o.u, o.y + 0.5 + (o.h - 0.5) / 2, d, o.w - 0.04, o.h - 0.52, 0.012, GLASS[Math.floor(r() * GLASS.length)], { group, noAo: true });
  const n = Math.max(1, Math.round(o.w / 1.1));
  for (let i = 1; i < n; i++) fbox(B, f, "metal_painted", o.u - o.w / 2 + (i * o.w) / n, o.y + o.h / 2, d + 0.02, 0.05, o.h, 0.05, frameTint, { group });
  fbox(B, f, "metal_painted", o.u, o.y + o.h * 0.8, d + 0.02, o.w, 0.05, 0.05, frameTint, { group });
}

/** Moulded surround: jambs proud of the plaster beside a window (sill/lintel done by the caller). */
export function windowSurround(B: MeshBuilder, f: Frame, o: Opening, tint: Tint, group: string, mat: WorldMat = "plaster") {
  for (const s of [-1, 1]) fbox(B, f, mat, o.u + s * (o.w / 2 + 0.06), o.y + o.h / 2, 0.02, 0.12, o.h + 0.06, 0.04, tint, { group });
}

/** Door architrave (jambs + head) and an optional concrete hood on brackets. */
export function doorSurround(B: MeshBuilder, f: Frame, o: Opening, tint: Tint, hood: boolean, group: string, mat: WorldMat = "plaster") {
  const top = headOf(o);
  for (const s of [-1, 1]) fbox(B, f, mat, o.u + s * (o.w / 2 + 0.08), (top + 0.08) / 2, 0.025, 0.16, top + 0.08, 0.05, tint, { group });
  if (!o.arch) fbox(B, f, mat, o.u, top + 0.09, 0.03, o.w + 0.36, 0.18, 0.06, tint, { group });
  if (hood && !o.arch) {
    fbox(B, f, "concrete", o.u, top + 0.42, 0.36, o.w + 0.9, 0.1, 0.72, tint, { group });
    for (const s of [-1, 1]) fbox(B, f, "metal_dark", o.u + s * (o.w / 2 + 0.3), top + 0.25, 0.25, 0.04, 0.3, 0.5, 0x3a3a36, { group });
  }
}

/**
 * Service cable clipped along a facade at height y, sagging between clips,
 * with a drop to a meter box at `boxU` when there is room. Returns the box u (or -1).
 */
export function facadeCable(B: MeshBuilder, f: Frame, L: number, y: number, openings: Opening[], r: () => number, group: string, boxU = -1) {
  const n = Math.max(2, Math.round(L / 2.4));
  const d = 0.05;
  let prev = f.at(0.15, y, d);
  for (let i = 1; i <= n; i++) {
    const u = 0.15 + ((L - 0.3) * i) / n;
    const p = f.at(u, y + (r() - 0.5) * 0.04, d);
    cable(B, prev, p, 0.04 + r() * 0.05, group);
    fbox(B, f, "metal_dark", u, p.y - f.o.y, 0.03, 0.04, 0.06, 0.05, 0x2a2a28, { group });
    prev = p;
  }
  if (boxU < 0) return -1;
  const bw = 0.36, bh = 0.48, by = 1.35;
  const clear = !openings.some((o) => Math.abs(o.u - boxU) < o.w / 2 + bw / 2 + 0.1 && o.y < by + bh / 2 + 0.1 && headOf(o) > by - bh / 2 - 0.1);
  if (!clear || boxU < 0.5 || boxU > L - 0.5) return -1;
  fbox(B, f, "metal_painted", boxU, by, 0.08, bw, bh, 0.16, 0x9a9a90, { group });
  fbox(B, f, "metal_dark", boxU, by + bh / 2 + 0.01, 0.1, bw + 0.04, 0.03, 0.2, 0x3a3a36, { group });
  const a = f.at(boxU, by + bh / 2, d), b = f.at(boxU, y, d);
  cable(B, b, a, 0.005, group);
  return boxU;
}

/** ModelPlacer fits in world axes: swap the footprint when the yaw is a quarter turn. */
export function worldFit(yaw: number, w: number, h: number, d: number): [number, number, number] {
  return Math.abs(Math.sin(yaw)) > 0.7 ? [d, h, w] : [w, h, d];
}

type ClutterItem = { id: ModelId; size: [number, number, number]; tint: number; mat: WorldMat; big?: boolean };
// Cheap pieces (cement bags ~0.8k tris, bin bags) are listed twice so they turn up most.
const CLUTTER: ClutterItem[] = [
  { id: "cement_bag", size: [0.6, 0.15, 0.4], tint: 0xb8b0a0, mat: "canvas" },
  { id: "trashbag", size: [0.6, 0.55, 0.55], tint: 0x1e1f1e, mat: "plain" },
  { id: "trashbag", size: [0.6, 0.55, 0.55], tint: 0x1e1f1e, mat: "plain" },
  { id: "plastic_crate_02", size: [0.51, 0.26, 0.41], tint: 0x3a6a8a, mat: "plain" },
  { id: "plastic_jerrycan", size: [0.35, 0.45, 0.2], tint: 0x8a2a20, mat: "plain" },
  { id: "cement_bag", size: [0.6, 0.15, 0.4], tint: 0xb8b0a0, mat: "canvas" },
  { id: "wooden_crate_02", size: [1.17, 0.46, 0.53], tint: 0x8a7050, mat: "wood", big: true },
  { id: "Barrel_02", size: [0.49, 0.88, 0.49], tint: 0x3a5a3a, mat: "metal_painted", big: true },
  { id: "utility_box_02", size: [0.92, 1.12, 0.43], tint: 0x8a8a80, mat: "metal_painted", big: true },
];

/**
 * A few street-clutter clusters along the foot of a facade, hugging the wall
 * and kept clear of doors and shopfronts. Small, low items only unless `big`
 * (backdrop streets nobody walks): never adds collision.
 */
export function wallClutter(props: ModelPlacer, f: Frame, L: number, openings: Opening[], ground: (x: number, z: number) => number, r: () => number, big: boolean, clusters: number) {
  // Backdrop streets: only the larger pieces read from afar, and only on high.
  const items = CLUTTER.filter((c) => (big ? c.big : !c.big));
  // Keep doorways, shopfronts and arcades clear (windows above the sill are fine).
  const blocked = (u: number, w: number) => openings.some((o) => o.y < 0.5 && Math.abs(o.u - u) < o.w / 2 + w / 2 + 0.35);
  for (let c = 0; c < clusters; c++) {
    let u = 0.8 + r() * (L - 1.6);
    if (blocked(u, 1.2)) {
      u = 0.8 + r() * (L - 1.6);
      if (blocked(u, 1.2)) continue;
    }
    const n = 1 + Math.floor(r() * 3);
    let along = u - 0.5;
    for (let i = 0; i < n; i++) {
      const it = items[Math.floor(r() * items.length)];
      const [w, h, d] = it.size;
      if (along + w / 2 > L - 0.3 || blocked(along, w)) break;
      const p = f.at(along + w / 2, 0, d / 2 + 0.04 + r() * 0.05);
      const y = ground(p.x, p.z);
      const yaw = f.rotY + Math.PI + (r() - 0.5) * 0.35;
      const stack = it.id === "plastic_crate_02" || it.id === "cement_bag" ? 1 + Math.floor(r() * 2) : 1;
      for (let k = 0; k < stack; k++) {
        const pk = { x: p.x, y: y + k * h, z: p.z, rotY: yaw + (r() - 0.5) * 0.2, fit: worldFit(yaw, w, h, d), tier: (big || k > 0 || i > 0 ? 2 : 1) as 1 | 2 };
        props.place(it.id, pk, (bb, g) => bb.box(it.mat, pk.x, pk.y + h / 2, pk.z, w * 0.95, h * 0.95, d * 0.95, it.tint, { group: g, rotY: pk.rotY }));
      }
      along += w + 0.05 + r() * 0.2;
    }
  }
}
