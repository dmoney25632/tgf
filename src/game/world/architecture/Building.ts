import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { ModelPlacer } from "../Props";
import type { WorldMat } from "../WorldMaterials";
import {
  Frame, acUnit, awning, blastOutline, cable, dish, downpipe, fbox, railing, rebar, wall, wallDecal, waterTank,
  type Blast, type Opening, type Tint,
} from "./kit";

/** Sun-faded plaster colours common to the region (tints over the plaster photo texture). */
export const PLASTER_TINTS = [0xe4d8c0, 0xd9c7a4, 0xcdb898, 0xe8dccb, 0xc9b9a6, 0xd6c2b4, 0xbfb6a6, 0xe0cfae, 0xc4ae8e, 0xd2c8b8];

export type BuildingSpec = {
  /** Footprint centre and size (axis-aligned). */
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  floorH?: number;
  /** Lowest ground under the footprint (the foundation reaches below it). */
  groundY?: number;
  seed: number;
  tint?: Tint;
  /** Builder group (e.g. "far" for backdrop: no shadows). */
  group?: string;
  /** Balconies, awnings, AC units, rooftop clutter, frames. */
  detail?: boolean;
  /** 0..1: blown windows, shell holes, spalled plaster, soot. */
  damage?: number;
  /** Roofless shell with a collapsed crown on some walls. */
  ruin?: boolean;
  /** Ground floor arcade (round arches) on facades facing `front`. */
  arcade?: boolean;
  /** Which facades get the full treatment (N, E, S, W); others get plain windows. */
  faces?: [boolean, boolean, boolean, boolean];
  /** Index of the street-facing facade (shops/awnings go here), 0..3 = N, E, S, W. */
  front?: number;
  /** Facade never seen (backdrop): a blank wall, no openings. */
  back?: number;
  /** Dark interior volume behind the windows (backdrop buildings). */
  hollow?: boolean;
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

/** The four facades (N, E, S, W) of an axis-aligned footprint, outward normals. */
export function facades(x: number, z: number, w: number, d: number, y: number) {
  return [
    new Frame(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(1, 0, 0)),
    new Frame(new THREE.Vector3(x + w / 2, y, z - d / 2), new THREE.Vector3(0, 0, 1)),
    new Frame(new THREE.Vector3(x + w / 2, y, z + d / 2), new THREE.Vector3(-1, 0, 0)),
    new Frame(new THREE.Vector3(x - w / 2, y, z + d / 2), new THREE.Vector3(0, 0, -1)),
  ];
}

const SHUTTER_TINTS = [0x5f7a6a, 0x5a6f86, 0x8a6a4a, 0x7a7a70, 0x6e8a8a, 0x9a8a60];

/** Exposed-brick patch ring around a blast hole (or a spalled patch when no hole). */
export function spall(B: MeshBuilder, f: Frame, b: Blast, group: string, through: boolean) {
  const outer = blastOutline({ ...b, r: b.r * (through ? 1.6 : 1), seed: b.seed + 3 });
  const shape = new THREE.Shape(outer);
  if (through) shape.holes.push(new THREE.Path(blastOutline(b).reverse()));
  const geo = new THREE.ShapeGeometry(shape);
  // Shape lies in (u, y) facing local +z (into the wall): flip it to face out, just proud of the plaster.
  const m = f.matrix(0, 0, 0.008);
  const idx = geo.index!.array as Uint16Array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setZ(i, -1);
  B.add(geo, m, "plaster_damaged", 0xd8cfc4, { group, noAo: true });
  geo.dispose();
}

/**
 * A plastered masonry building in the regional style: thick walls with
 * framed, sill-and-lintel windows, arched shopfronts with roller shutters,
 * iron-railed balconies, striped awnings, a parapet roof with water tanks
 * and dishes, wall-hung AC units, downpipes, grime and war damage. All
 * merged into the MeshBuilder; repeated hardware (shutters) is instanced.
 */
export function building(B: MeshBuilder, props: ModelPlacer | null, s: BuildingSpec) {
  const r = rnd(s.seed);
  const fh = s.floorH ?? 3.1;
  const gy = s.groundY ?? 0;
  const group = s.group ?? "decor";
  const detail = s.detail ?? true;
  const damage = s.damage ?? 0;
  const tint = new THREE.Color(s.tint ?? PLASTER_TINTS[Math.floor(r() * PLASTER_TINTS.length)]);
  const trim = tint.clone().lerp(new THREE.Color(0xf0ebe0), 0.35);
  const H = s.floors * fh;
  const parapet = s.ruin ? 0 : 0.9;
  const T = 0.3;
  const frames = facades(s.x, s.z, s.w, s.d, gy);
  const front = s.front ?? 0;
  const wallMat: WorldMat = "plaster";

  // Foundation (hides slopes), plinth.
  B.box("concrete_dirty", s.x, gy - 0.4, s.z, s.w + 0.12, 1.2, s.d + 0.12, tint.clone().multiplyScalar(0.7), { group });
  if (s.hollow) B.box("plain", s.x, gy + H / 2, s.z, s.w - 2 * T - 0.02, H - 0.05, s.d - 2 * T - 0.02, 0x0e0d0c, { group, noAo: true });

  frames.forEach((f, side) => {
    const L = side % 2 === 0 ? s.w : s.d;
    const full = s.faces ? s.faces[side] : true;
    const isFront = side === front;
    const blank = side === s.back;
    const cols = Math.max(1, Math.floor((L - 1.0) / 2.7));
    const step = L / cols;
    const openings: Opening[] = [];
    const blasts: Blast[] = [];
    type Win = Opening & { floor: number; kind: "win" | "door" | "shop" | "arch" | "balcony" };
    const wins: Win[] = [];
    for (let fl = 0; fl < (blank ? 0 : s.floors); fl++) {
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) * step;
        if (fl === 0) {
          if (isFront && s.arcade) wins.push({ u, y: 0, w: Math.min(2.2, step - 0.6), h: 1.9, arch: true, floor: 0, kind: "arch" });
          else if (isFront && r() < 0.7) wins.push({ u, y: 0, w: Math.min(2.4, step - 0.5), h: 2.5, floor: 0, kind: "shop" });
          else if (c === Math.floor(cols / 2) && (side === front || side === (front + 2) % 4)) wins.push({ u, y: 0, w: 1.1, h: 2.2, floor: 0, kind: "door", arch: r() < 0.4 });
          else if (r() < 0.75) wins.push({ u, y: 1.0, w: 1.0, h: 1.3, floor: 0, kind: "win" });
        } else {
          if (full && detail && r() < 0.28) wins.push({ u, y: fl * fh + 0.05, w: 1.0, h: 2.15, floor: fl, kind: "balcony" });
          else if (r() < 0.9) wins.push({ u, y: fl * fh + 0.9, w: 1.05, h: 1.4, floor: fl, kind: "win", arch: r() < 0.15 });
        }
      }
    }
    // War damage: some openings become ragged shell holes.
    for (const w of wins) {
      if (w.floor > 0 && r() < damage * 0.22) {
        blasts.push({ u: w.u + (r() - 0.5) * 0.4, y: w.y + w.h / 2, r: 0.9 + r() * 0.5, seed: Math.floor(r() * 1e6) });
        w.kind = "win";
        w.w = 0;
      }
    }
    // Clamp blasts inside the wall.
    for (const b of blasts) b.u = Math.min(L - b.r * 1.3 - 0.2, Math.max(b.r * 1.3 + 0.2, b.u));
    for (const w of wins) if (w.w > 0) openings.push(w);

    let collapse: [number, number, number] | undefined;
    if (s.ruin && r() < 0.7) {
      const a = r() * L * 0.5;
      collapse = [a, a + L * (0.3 + r() * 0.4), H * (0.3 + r() * 0.4)];
    }
    // Openings that a collapse would cut through are dropped (keeps the shape valid).
    const crownAt = (u: number) => (collapse && u > collapse[0] - 0.8 && u < collapse[1] + 0.8 ? H + parapet - collapse[2] : H + parapet);
    const okOpen = openings.filter((o) => o.y + o.h + (o.arch ? o.w / 2 : 0) < crownAt(o.u) - (s.ruin ? 0.9 : 0.25));
    const okBlast = blasts.filter((b) => b.y + b.r < crownAt(b.u) - 0.9);
    wall(B, f, { length: L, height: H + parapet, thickness: T, openings: okOpen, blasts: okBlast, ruin: s.ruin ? 0.6 : 0, collapse, seed: s.seed + side }, wallMat, tint, { group });

    // Floor bands + cornice + coping (skipped over collapsed stretches).
    const bandable = (y: number) => !collapse || y < H + parapet - collapse[2] - 0.3;
    if (detail || full) {
      for (let fl = 1; fl <= s.floors; fl++) {
        const y = fl * fh;
        if (!bandable(y)) continue;
        const proud = fl === s.floors ? 0.16 : 0.06;
        fbox(B, f, wallMat, L / 2, y - 0.08, proud / 2, L + proud * 2, fl === s.floors ? 0.3 : 0.16, proud, trim, { group });
      }
    }
    if (!s.ruin) fbox(B, f, "concrete", L / 2, H + parapet + 0.04, -T / 2 + 0.03, L + 0.06, 0.08, T + 0.12, trim, { group });
    // Painted plinth.
    fbox(B, f, wallMat, L / 2, 0.45, 0.015, L + 0.03, 0.9, 0.03, tint.clone().multiplyScalar(0.72), { group });

    for (const o of okOpen) {
      const w = o as Win;
      const top = o.y + o.h;
      if (w.kind === "shop") {
        fbox(B, f, "concrete", o.u, top + 0.12, 0.05, o.w + 0.4, 0.24, 0.1, trim, { group });
        if (props) {
          const open = r();
          const sh = open < 0.35 ? o.h : open < 0.7 ? o.h * (0.25 + r() * 0.4) : 0;
          if (sh > 0) {
            const p = f.at(o.u, top - sh, -0.06);
            props.place("rollershutter_door", { x: p.x, y: p.y, z: p.z, fit: [o.w, sh, 0.25], rotY: f.rotY + Math.PI });
          }
        }
        if (detail && full && r() < 0.7) awning(B, f, o.u, gy + top + 0.55, o.w + 0.6, 1.4, 0.5, Math.floor(r() * 4), Math.floor(r() * 1e6), r() < damage * 0.6, group);
        continue;
      }
      if (w.kind === "arch") {
        fbox(B, f, wallMat, o.u - o.w / 2 - 0.12, 0.6, 0.04, 0.24, 1.2, 0.08, trim, { group });
        fbox(B, f, wallMat, o.u + o.w / 2 + 0.12, 0.6, 0.04, 0.24, 1.2, 0.08, trim, { group });
        continue;
      }
      if (!detail && !full) continue;
      // Frame inside the reveal.
      const fd = -0.12;
      const ft = 0.06;
      const frameTint = SHUTTER_TINTS[Math.floor(r() * SHUTTER_TINTS.length)];
      const fmat: WorldMat = r() < 0.5 ? "wood" : "metal_painted";
      if (detail) {
        fbox(B, f, fmat, o.u - o.w / 2 + ft / 2, o.y + o.h / 2, fd, ft, o.h, 0.08, frameTint, { group });
        fbox(B, f, fmat, o.u + o.w / 2 - ft / 2, o.y + o.h / 2, fd, ft, o.h, 0.08, frameTint, { group });
        fbox(B, f, fmat, o.u, top - ft / 2, fd, o.w, ft, 0.08, frameTint, { group });
        if (w.kind === "win") fbox(B, f, fmat, o.u, o.y + o.h * 0.62, fd, o.w, 0.04, 0.05, frameTint, { group });
      }
      if (w.kind === "win" || w.kind === "balcony") {
        if (w.kind === "win") fbox(B, f, "concrete", o.u, o.y - 0.04, 0.06, o.w + 0.22, 0.08, 0.2, trim, { group });
        if (!o.arch) fbox(B, f, wallMat, o.u, top + 0.09, 0.03, o.w + 0.3, 0.18, 0.06, trim, { group });
        // Shutters: open against the wall, closed, or one hanging off.
        if (detail) {
          const k = r();
          const sw = o.w / 2;
          const sTint = new THREE.Color(frameTint).multiplyScalar(0.85 + r() * 0.2);
          if (k < 0.3) {
            for (const sgn of [-1, 1]) fbox(B, f, "wood", o.u + sgn * (o.w / 2 + sw / 2 + 0.02), o.y + o.h / 2, 0.03, sw, o.h, 0.03, sTint, { group });
          } else if (k < 0.42) {
            fbox(B, f, "wood", o.u, o.y + o.h / 2, -0.06, o.w - 0.02, o.h - 0.02, 0.03, sTint, { group });
          } else if (k < 0.48) {
            fbox(B, f, "wood", o.u + o.w / 2 + sw / 2, o.y + o.h / 2 - 0.15, 0.06, sw, o.h, 0.03, sTint, { group, rotZ: 0.35 });
          }
        }
        if (w.kind === "win" && w.floor === 0 && detail) {
          for (let i = 1; i < 6; i++) fbox(B, f, "metal_dark", o.u - o.w / 2 + (i * o.w) / 6, o.y + o.h / 2, -0.02, 0.025, o.h, 0.025, 0x2e2e2c, { group });
        }
      }
      if (w.kind === "door") {
        const ajar = r();
        fbox(B, f, "metal_painted", o.u + (ajar < 0.5 ? 0 : 0.25), o.h / 2, -0.15, o.w - 0.04, o.h - 0.02, 0.05, frameTint, { group, yaw: ajar < 0.5 ? 0 : 0.9 });
        fbox(B, f, "concrete", o.u, 0.07, 0.25, o.w + 0.5, 0.14, 0.5, trim, { group });
      }
      if (w.kind === "balcony" && detail) {
        const bd = 1.0, bw = o.w + 1.0;
        fbox(B, f, "concrete", o.u, o.y - 0.12, bd / 2, bw, 0.16, bd, trim, { group });
        const c0 = f.at(o.u - bw / 2 + 0.03, o.y - 0.04, 0.03), c1 = f.at(o.u - bw / 2 + 0.03, o.y - 0.04, bd - 0.03);
        const c2 = f.at(o.u + bw / 2 - 0.03, o.y - 0.04, bd - 0.03), c3 = f.at(o.u + bw / 2 - 0.03, o.y - 0.04, 0.03);
        c0.y = c1.y = c2.y = c3.y = gy + o.y - 0.04;
        const ironTint = r() < 0.6 ? 0x232321 : 0x3c4a4a;
        railing(B, c0, c1, 1.0, ironTint, 0.14, group);
        railing(B, c1, c2, 1.0, ironTint, 0.14, group);
        railing(B, c2, c3, 1.0, ironTint, 0.14, group);
        wallDecal(B, f, "leak", o.u, o.y - 0.9, bw * 0.8, 1.4, 0xffffff, 0.012, group);
        if (r() < 0.3) awning(B, f, o.u, gy + top + 0.45, bw, 1.0, 0.35, Math.floor(r() * 4), Math.floor(r() * 1e6), r() < damage, group);
      }
      // Grime: drips under sills, soot above some upper windows.
      if (r() < 0.5) wallDecal(B, f, "leak", o.u + (r() - 0.5) * 0.3, o.y - 0.55, o.w * 0.9, 1.0, 0xffffff, 0.012, group);
      if (w.floor > 0 && r() < damage * 0.4) wallDecal(B, f, "soot", o.u, top + 0.7, o.w * 1.8, 1.8, 0xffffff, 0.014, group);
      if (detail && full && w.kind === "win" && r() < 0.12) acUnit(B, f, o.u + o.w / 2 + 0.6, o.y + 0.1, Math.floor(r() * 1e6), group);
    }
    // Damage: spalled plaster rings around holes, loose spalls, bullet pocks, rebar.
    for (const b of okBlast) {
      spall(B, f, b, group, true);
      wallDecal(B, f, "soot", b.u, b.y + b.r * 1.2, b.r * 3, b.r * 3, 0xffffff, 0.014, group);
      if (detail) rebar(B, f, b.u, b.y - b.r * 0.6, 4, b.seed, group, b.r * 0.6);
    }
    const spalls = Math.round((damage * 3 + 0.5) * (L / 8) * r());
    for (let i = 0; i < spalls; i++) {
      const u = 0.8 + r() * (L - 1.6), y = 0.4 + r() * Math.min(H - 0.8, 4);
      const clash = okOpen.some((o) => Math.abs(o.u - u) < o.w / 2 + 0.8 && y > o.y - 0.8 && y < o.y + o.h + 0.8);
      if (!clash) spall(B, f, { u, y, r: 0.35 + r() * 0.5, seed: Math.floor(r() * 1e6) }, group, false);
    }
    if (damage > 0.2 && full) for (let i = 0; i < Math.round(damage * 3); i++) wallDecal(B, f, "pocks", 0.8 + r() * (L - 1.6), 0.8 + r() * Math.min(H - 1, 4), 1.4, 1.4, 0xffffff, 0.013, group);
    wallDecal(B, f, "baseDirt", L / 2, 0.55, L, 1.1, 0xffffff, 0.02, group);
    if (detail && full) {
      downpipe(B, f, 0.25, H + parapet - 0.1, group);
      if (r() < 0.5) downpipe(B, f, L - 0.25, H + parapet - 0.1, group);
    }
  });

  // Roof slab + rooftop clutter.
  if (!s.ruin) {
    B.box("concrete", s.x, gy + H - 0.1, s.z, s.w - 0.02, 0.2, s.d - 0.02, tint.clone().multiplyScalar(0.85), { group });
    if (detail) {
      const ry = gy + H;
      if (r() < 0.6) B.boxFeet(wallMat, s.x + (r() - 0.5) * (s.w - 3), ry, s.z + (r() - 0.5) * (s.d - 3), 2.4, 2.3, 2.2, tint, { group });
      const tanks = 1 + Math.floor(r() * 3);
      for (let i = 0; i < tanks; i++) waterTank(B, s.x + (r() - 0.5) * (s.w - 2), ry, s.z + (r() - 0.5) * (s.d - 2), r() < 0.5, group);
      if (r() < 0.7) dish(B, s.x + (r() - 0.5) * (s.w - 1.5), ry, s.z + (r() - 0.5) * (s.d - 1.5), r() * 6, 0.45 + r() * 0.3, group);
      if (r() < 0.5) {
        // Washing line across the roof.
        const a = new THREE.Vector3(s.x - s.w / 2 + 0.5, ry + 1.6, s.z + (r() - 0.5) * s.d * 0.6);
        const b = new THREE.Vector3(s.x + s.w / 2 - 0.5, ry + 1.6, a.z + (r() - 0.5));
        cable(B, a, b, 0.15, group);
      }
    }
  } else {
    // Ruins: a broken slab hanging at one floor, the rest open to the sky.
    if (s.floors > 1) B.box("concrete_broken", s.x - s.w * 0.15, gy + fh - 0.1, s.z, s.w * 0.6, 0.2, s.d - 0.7, 0x9a958a, { group, rotZ: 0.12 });
  }
}

/** Distant low-detail block for skyline silhouettes (a few boxes, dark windows as decals). */
export function silhouette(B: MeshBuilder, x: number, z: number, w: number, d: number, h: number, gy: number, seed: number) {
  const r = rnd(seed);
  const tint = new THREE.Color(PLASTER_TINTS[Math.floor(r() * PLASTER_TINTS.length)]).multiplyScalar(0.9);
  B.box("plaster", x, gy + h / 2 - 0.5, z, w, h + 1, d, tint, { group: "far" });
  if (r() < 0.6) B.box("plaster", x + (r() - 0.5) * w * 0.4, gy + h + 1.1, z + (r() - 0.5) * d * 0.4, w * 0.3, 2.2, d * 0.3, tint, { group: "far" });
  if (r() < 0.5) waterTank(B, x + (r() - 0.5) * w * 0.6, gy + h, z + (r() - 0.5) * d * 0.6, r() < 0.5, "far");
}
