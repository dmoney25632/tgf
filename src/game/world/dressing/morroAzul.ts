import * as THREE from "three";
import type { Dressing, WorldExtra } from "./common";
import { fbm2, smoothstep, poleLine, type PoleSpot } from "./common";
import type { MeshBuilder } from "../MeshBuilder";
import { clutterGroup } from "../MeshBuilder";
import { facades } from "../architecture/Building";
import { Frame, acUnit, awning, cable, chainlink, dish, downpipe, groundStrip, paintLine, rod, railing, wall, wallDecal, type Tint } from "../architecture/kit";
import { burntCar, litter, rubblePile } from "../architecture/debris";
import { palms, type PalmPlacement } from "../Palms";
import { qualityName, worldDetail } from "../quality";
import {
  BOUND, COURT, HALF, KIOSK, LOTS, PLAZA, POLES, ROADS_X, ROADS_Z, SHELTER, SHOP_SIGNS, TREES, WALL_T, WRECKS,
  doorsOf, rnd, sideLength, stairOf, laneRect, windowsOf, type Lot, type Side,
} from "../maps/morroAzul";

/**
 * Morro Azul set dressing: hillside terrain packed with more houses, the
 * stacked brick / painted-render houses of the play area (real wall
 * openings on the enterable ones), slab edges, roofs crowded with water
 * tanks, dishes, laundry and rebar, shop fronts with awnings and signs,
 * graffiti and murals, the futsal court, power poles with tangled wiring,
 * wrecks, litter and palms.
 */

// ---------------------------------------------------------------------------
// Terrain: flat play area, hills of houses all round, granite peaks beyond
// ---------------------------------------------------------------------------

const PEAKS: [number, number, number, number][] = [
  // x, z, height, radius
  [-140, -360, 270, 120],
  [300, -240, 170, 110],
  [-340, 120, 150, 120],
  [160, 380, 120, 130],
];

export function maHeight(x: number, z: number) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d < BOUND + 2) return 0;
  // The north and west climb steeper (the hill the favela clings to).
  const lean = 1 + 0.5 * smoothstep(0, 1, (-z / (d + 1) + 1) / 2) + 0.25 * smoothstep(0, 1, (-x / (d + 1) + 1) / 2);
  let h = Math.pow(smoothstep(BOUND + 2, 240, d), 1.3) * 62 * lean;
  h += (fbm2(x * 0.012, z * 0.012, 4) - 0.5) * 16 * smoothstep(BOUND + 2, 130, d);
  for (const [px, pz, ph, pr] of PEAKS) {
    const q = Math.hypot(x - px, z - pz) / pr;
    h += ph * Math.exp(-q * q * 1.6);
  }
  return Math.max(0, h);
}

// ---------------------------------------------------------------------------
// Sign / mural / graffiti atlas (one canvas, one draw call)
// ---------------------------------------------------------------------------

const ATLAS = 2048;
type Rect = [number, number, number, number];

function makeAtlas() {
  const c = document.createElement("canvas");
  c.width = ATLAS;
  c.height = ATLAS;
  const g = c.getContext("2d")!;
  const r = rnd(77);
  const rects = { signs: [] as Rect[], tags: [] as Rect[], murals: [] as Rect[], numbers: [] as Rect[] };

  // Shop signs: painted boards, 4 × 3 of 512 × 128.
  const boards = ["#f2d24a", "#d84a3a", "#3a7ad0", "#f4f0e4", "#2f9a6a", "#e88a2a", "#7a4ab0", "#1e1e1e", "#e8e0c8", "#3ab0c8"];
  const inks = ["#1e1e1e", "#f8f4e8", "#f8f4e8", "#c83028", "#f8f4e8", "#1e1e1e", "#f8e86a", "#f2d24a", "#2a5aa0", "#1e1e1e"];
  SHOP_SIGNS.forEach((text, i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 128;
    g.fillStyle = boards[i % boards.length];
    g.fillRect(x, y, 512, 128);
    g.strokeStyle = "rgba(0,0,0,.35)";
    g.lineWidth = 6;
    g.strokeRect(x + 6, y + 6, 500, 116);
    g.fillStyle = inks[i % inks.length];
    g.font = `900 ${text.length > 13 ? 50 : 62}px Impact, "Arial Black", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, x + 256, y + 68, 470);
    // Weathering: faded patches, rust from the bolts, grime at the bottom.
    for (let k = 0; k < 500; k++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "60,40,20"},${r() * 0.09})`;
      g.fillRect(x + r() * 512, y + r() * 128, 3 + r() * 6, 2 + r() * 4);
    }
    const gr = g.createLinearGradient(0, y, 0, y + 128);
    gr.addColorStop(0, "rgba(80,50,20,0)");
    gr.addColorStop(1, "rgba(80,50,20,.3)");
    g.fillStyle = gr;
    g.fillRect(x, y, 512, 128);
    rects.signs.push([x, y, x + 512, y + 128]);
  });

  // Graffiti tags: 8 × 2 of 256 × 128, transparent background.
  const words = ["MAZ", "RUA", "PAZ", "SOL", "K2", "VIDA", "LUZ", "ZN", "FÉ", "AZUL", "MORRO", "BR", "OK", "JUH", "TRK", "NOVA"];
  const cols = ["#e8452e", "#2fb5e0", "#f2d24a", "#9a4ad0", "#36c06a", "#f07ab0", "#ffffff", "#ff8a1e"];
  for (let i = 0; i < 16; i++) {
    const x = (i % 8) * 256, y = 384 + Math.floor(i / 8) * 128;
    g.save();
    g.translate(x + 128, y + 66);
    g.rotate((r() - 0.5) * 0.25);
    const word = words[i];
    g.font = `900 ${word.length > 3 ? 60 : 78}px "Arial Black", Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    if (i % 3 === 0) {
      // Bubble piece: fat outline, fill, highlight.
      g.lineWidth = 16;
      g.strokeStyle = "#141414";
      g.strokeText(word, 0, 0, 230);
      g.fillStyle = cols[i % cols.length];
      g.fillText(word, 0, 0, 230);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,.7)";
      g.strokeText(word, -3, -4, 230);
    } else {
      // Quick tag: thin drippy stroke.
      g.font = `italic 700 ${64 + r() * 20}px "Brush Script MT", cursive, sans-serif`;
      g.lineWidth = 5;
      g.strokeStyle = i % 2 ? "#141414" : cols[(i + 3) % cols.length];
      g.strokeText(word, 0, 0, 230);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = g.strokeStyle;
        g.fillRect(-90 + r() * 180, 10, 3, 10 + r() * 30);
      }
    }
    g.restore();
    rects.tags.push([x, y, x + 256, y + 128]);
  }

  // Murals: 3 × 2 of 682 × 512 (original abstract / landscape pieces).
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 682, y = 640 + Math.floor(i / 3) * 512;
    const W = 682, H = 512;
    g.save();
    g.beginPath();
    g.rect(x, y, W, H);
    g.clip();
    const sky = g.createLinearGradient(0, y, 0, y + H);
    const pal = [
      ["#2a8ad8", "#8fd8f0", "#f2d24a"],
      ["#f07a3a", "#f8c85a", "#2a5aa0"],
      ["#36a07a", "#bfe88a", "#f07ab0"],
      ["#6a3ab0", "#f07ab0", "#f8e86a"],
      ["#1e7a9a", "#5fd0c8", "#e8452e"],
      ["#e8b030", "#f8f0d0", "#2f9a6a"],
    ][i];
    sky.addColorStop(0, pal[0]);
    sky.addColorStop(1, pal[1]);
    g.fillStyle = sky;
    g.fillRect(x, y, W, H);
    if (i % 2 === 0) {
      // Sun over a hill of little coloured houses.
      g.fillStyle = pal[2];
      g.beginPath();
      g.arc(x + W * (0.3 + r() * 0.4), y + H * 0.3, 70 + r() * 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2f6a3a";
      g.beginPath();
      g.moveTo(x, y + H);
      g.quadraticCurveTo(x + W * 0.5, y + H * 0.25, x + W, y + H * 0.85);
      g.lineTo(x + W, y + H);
      g.fill();
      const hc = ["#e8452e", "#f2d24a", "#f8f4e8", "#2fb5e0", "#f07ab0", "#36c06a"];
      for (let k = 0; k < 60; k++) {
        const hx = x + r() * W, t = (hx - x) / W;
        const top = y + H * (1 - 0.75 * Math.sin(Math.PI * t * 0.95)) + 10;
        const hy = top + r() * (y + H - top);
        g.fillStyle = hc[Math.floor(r() * hc.length)];
        g.fillRect(hx, hy, 18 + r() * 18, 14 + r() * 14);
        g.fillStyle = "rgba(0,0,0,.45)";
        g.fillRect(hx + 4, hy + 4, 5, 5);
      }
    } else {
      // Geometric waves and birds.
      for (let k = 0; k < 7; k++) {
        g.fillStyle = k % 2 ? pal[2] : "rgba(255,255,255,.55)";
        g.beginPath();
        const yy = y + H * (0.35 + k * 0.1);
        g.moveTo(x, yy);
        for (let s = 0; s <= 12; s++) g.lineTo(x + (W * s) / 12, yy + Math.sin(s * 1.3 + k) * 18);
        g.lineTo(x + W, yy + 40);
        g.lineTo(x, yy + 40);
        g.fill();
      }
      g.strokeStyle = "#1e1e1e";
      g.lineWidth = 6;
      for (let k = 0; k < 6; k++) {
        const bx = x + 80 + r() * (W - 160), by = y + 50 + r() * 140;
        g.beginPath();
        g.moveTo(bx - 22, by);
        g.quadraticCurveTo(bx - 10, by - 14, bx, by);
        g.quadraticCurveTo(bx + 10, by - 14, bx + 22, by);
        g.stroke();
      }
    }
    // Paint wear.
    for (let k = 0; k < 1500; k++) {
      g.fillStyle = `rgba(220,210,190,${r() * 0.25})`;
      g.fillRect(x + r() * W, y + r() * H, 2 + r() * 8, 2 + r() * 5);
    }
    g.restore();
    rects.murals.push([x, y, x + W, y + H]);
  }

  // House numbers (small painted digits on a light patch).
  for (let i = 0; i < 16; i++) {
    const x = (i % 16) * 128, y = 1664;
    g.fillStyle = "#e8e2d0";
    g.fillRect(x + 8, y + 8, 112, 80);
    g.fillStyle = "#1e1e1e";
    g.font = "700 56px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(10 + Math.floor(r() * 890)), x + 64, y + 50);
    rects.numbers.push([x + 8, y + 8, x + 120, y + 88]);
  }
  return { canvas: c, rects };
}

type Quad = { c: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; w: number; h: number; rect: Rect };

function atlasExtra(quads: Quad[], canvas: HTMLCanvasElement, anisotropy: number): WorldExtra {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const n = new THREE.Vector3();
  for (const q of quads) {
    const [x0, y0, x1, y1] = q.rect;
    const u0 = x0 / ATLAS, u1 = x1 / ATLAS, v0 = 1 - y1 / ATLAS, v1 = 1 - y0 / ATLAS;
    const hw = q.w / 2, hh = q.h / 2;
    const P = (sx: number, sy: number) => q.c.clone().addScaledVector(q.right, sx * hw).addScaledVector(q.up, sy * hh);
    const a = P(-1, -1), b = P(1, -1), c = P(1, 1), d = P(-1, 1);
    n.crossVectors(q.right, q.up).normalize();
    for (const [p, u, v] of [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [d, u0, v1]] as const) {
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
      nor.push(n.x, n.y, n.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "morro-atlas";
  mesh.matrixAutoUpdate = false;
  return {
    object: mesh,
    triangles: pos.length / 9,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Blue fibreglass water tank with a lid (the skyline's signature shape). */
function caixa(B: MeshBuilder, x: number, y: number, z: number, size: number, tint: Tint, group: string) {
  const body = new THREE.CylinderGeometry(0.62 * size, 0.5 * size, 0.85 * size, 12);
  B.add(body, new THREE.Matrix4().makeTranslation(x, y + 0.425 * size, z), "plain", tint, { group, uv: "keep" });
  body.dispose();
  const lid = new THREE.CylinderGeometry(0.2 * size, 0.66 * size, 0.18 * size, 12);
  B.add(lid, new THREE.Matrix4().makeTranslation(x, y + 0.94 * size, z), "plain", tint, { group, uv: "keep" });
  lid.dispose();
}

/** Laundry line between two points with a few hanging clothes. */
function laundry(B: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, r: () => number, group: string) {
  cable(B, a, b, 0.12, group);
  const n = 2 + Math.floor(r() * 4);
  const cloth = [0xe8e4da, 0x3a6ab0, 0xd84a3a, 0xf2d24a, 0x2f9a6a, 0xf07ab0, 0x1e1e1e, 0xffffff];
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (r() - 0.5) * 0.4) / n;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(Math.PI * t) * 0.12;
    const w = 0.4 + r() * 0.5, h = 0.45 + r() * 0.5;
    B.box("cloth", p.x, p.y - h / 2, p.z, Math.min(w, len / n), h, 0.02, cloth[Math.floor(r() * cloth.length)], { rotY: yaw, group, uv: "keep", uvScale: [0.2, 0.2] });
  }
}

function frameAt(f: Frame, u: number, y: number) {
  return new Frame(f.at(u, y), f.t);
}

const BRICK_TINTS = [0xf2d8c8, 0xe8c8b4, 0xf8e4d6, 0xdcb8a2];

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

type Ctx = { B: MeshBuilder; quads: Quad[]; atlas: ReturnType<typeof makeAtlas>["rects"]; high: boolean };

function house(ctx: Ctx, l: Lot) {
  const { B, quads, atlas } = ctx;
  const r = rnd(l.seed ^ 0x5bd1);
  const H = l.floors * l.fh;
  const W = l.x1 - l.x0, D = l.z1 - l.z0;
  const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
  const T = WALL_T;
  const fs = facades(cx, cz, W, D, 0);
  const doors = doorsOf(l);
  const wins = windowsOf(l);
  const brickTint = BRICK_TINTS[Math.floor(r() * BRICK_TINTS.length)];
  const paint = new THREE.Color(l.paint).multiplyScalar(0.86 + r() * 0.14);
  // Ground floor often a different, grubbier colour.
  const ground = r() < 0.4 ? new THREE.Color(0xd8d0c0).lerp(paint, 0.4) : paint;
  const bands: { f0: number; f1: number; mat: "brick" | "plaster"; tint: Tint }[] = [];
  if (l.brickFrom > 0) {
    if (ground !== paint) {
      bands.push({ f0: 0, f1: 1, mat: "plaster", tint: ground });
      if (Math.min(l.brickFrom, l.floors) > 1) bands.push({ f0: 1, f1: Math.min(l.brickFrom, l.floors), mat: "plaster", tint: paint });
    } else bands.push({ f0: 0, f1: Math.min(l.brickFrom, l.floors), mat: "plaster", tint: paint });
  }
  if (l.brickFrom < l.floors) bands.push({ f0: l.brickFrom, f1: l.floors, mat: "brick", tint: brickTint });

  for (const s of [0, 1, 2, 3] as Side[]) {
    const f = fs[s];
    const L = sideLength(l, s);
    const [u0, u1] = s % 2 === 0 ? [0, L] : [T, L - T];
    const sideOps = [...doors.filter((d) => d.side === s).map((d) => ({ u: d.u, y: 0, w: d.w, h: d.h })), ...wins.filter((w) => w.side === s)];
    for (const band of bands) {
      const y0 = band.f0 * l.fh, y1 = band.f1 * l.fh;
      if (l.enter) {
        // Real openings.
        const openings = sideOps.filter((o) => o.y >= y0 - 0.01 && o.y < y1).map((o) => ({ u: o.u - u0, y: o.y - y0, w: o.w, h: o.h }));
        wall(B, frameAt(f, u0, y0), { length: u1 - u0, height: y1 - y0, thickness: T, openings }, band.mat, band.tint, { group: "solid", uvOffset: [r() * 4, r() * 4] });
      } else {
        // Solid house: a slab of wall; windows are drawn on it.
        const mid = f.at((u0 + u1) / 2, (y0 + y1) / 2, -T / 2);
        B.box(band.mat, mid.x, mid.y, mid.z, u1 - u0, y1 - y0, T, band.tint, { rotY: f.rotY, group: "solid", uvOffset: [r() * 4, r() * 4] });
      }
    }
    // Parapet (or nothing on an unfinished laje).
    if (!l.laje) {
      const mat = l.brickFrom < l.floors ? "brick" : "plaster";
      const mid = f.at((u0 + u1) / 2, H + 0.5, -T / 2);
      B.box(mat, mid.x, mid.y, mid.z, u1 - u0, 1.0, T, mat === "brick" ? brickTint : paint, { rotY: f.rotY, group: "solid" });
      const cap = f.at((u0 + u1) / 2, H + 1.03, -T / 2);
      B.box("concrete", cap.x, cap.y, cap.z, u1 - u0 + 0.04, 0.06, T + 0.06, 0xbab6aa, { rotY: f.rotY });
    }
    // Slab edges proud of the wall at every level.
    for (let k = 1; k <= l.floors; k++) {
      const p = f.at(L / 2, k * l.fh - 0.1, 0.04);
      B.box("concrete", p.x, p.y, p.z, L + 0.1, 0.22, 0.1, 0xb4b0a4, { rotY: f.rotY });
    }
    // Plinth / grime band.
    wallDecal(B, f, "baseDirt", L / 2, 0.7, L, 1.4, 0xffffff, 0.02);
    if (r() < 0.6) wallDecal(B, f, "leak", 0.6 + r() * (L - 1.2), H - 0.8, 0.9, 1.8, 0xffffff, 0.015);

    // Windows.
    for (const w of wins.filter((k) => k.side === s)) {
      const fl = Math.floor(w.y / l.fh);
      const brick = fl >= l.brickFrom;
      const frameTint = brick ? 0x6a6a64 : 0xe8e4d8;
      // Sill + lintel.
      fbox(B, f, "concrete", w.u, w.y - 0.05, 0.05, w.w + 0.24, 0.1, 0.12, 0xc4c0b4);
      fbox(B, f, "concrete", w.u, w.y + w.h + 0.06, 0.03, w.w + 0.2, 0.12, 0.08, 0xbcb8ac);
      if (!l.enter) {
        // Dark interior / shutters / boards.
        const k = r();
        if (k < 0.55) fbox(B, f, "plain", w.u, w.y + w.h / 2, -0.06, w.w, w.h, 0.02, 0x15171a);
        else if (k < 0.8) fbox(B, f, "wood", w.u, w.y + w.h / 2, -0.04, w.w, w.h, 0.03, [0x5a8a7a, 0x8a5a3a, 0x3a5a8a, 0x9a9a8a][Math.floor(r() * 4)], { rot90: true });
        else fbox(B, f, "metal_rust", w.u, w.y + w.h / 2, -0.03, w.w, w.h, 0.02, 0xb8a890);
      }
      // Burglar bars on the low floors.
      if ((fl <= 1 && r() < 0.75) || r() < 0.25) {
        const n = Math.max(3, Math.round(w.w / 0.16));
        const g = ctx.high ? "decor" : clutterGroup(f.at(w.u, 0).x, f.at(w.u, 0).z);
        for (let i = 1; i < n; i++) fbox(B, f, "metal_dark", w.u - w.w / 2 + (w.w * i) / n, w.y + w.h / 2, 0.03, 0.025, w.h, 0.025, frameTint, { group: g });
        fbox(B, f, "metal_dark", w.u, w.y + w.h * 0.5, 0.03, w.w, 0.03, 0.03, frameTint, { group: g });
      }
      // Wall AC or a small balcony on upper floors.
      if (fl >= 1 && r() < 0.12) acUnit(B, f, w.u + w.w / 2 + 0.6 > sideLength(l, s) - 0.5 ? w.u - w.w / 2 - 0.6 : w.u + w.w / 2 + 0.6, w.y + 0.2, Math.floor(r() * 1e6), clutterGroup(f.at(w.u, 0).x, f.at(w.u, 0).z));
      else if (fl >= 1 && !l.enter && r() < 0.18) {
        const base = fl * l.fh;
        fbox(B, f, "concrete", w.u, base - 0.06, 0.45, w.w + 1.0, 0.12, 0.9, 0xbcb8ac);
        railing(B, f.at(w.u - w.w / 2 - 0.5, base, 0.88), f.at(w.u + w.w / 2 + 0.5, base, 0.88), 0.95, 0x3a3a38, 0.12, clutterGroup(f.at(w.u, 0).x, f.at(w.u, 0).z));
      }
    }

    // Doors.
    for (const d of doors.filter((k) => k.side === s)) {
      fbox(B, f, "concrete", d.u, d.h + 0.08, 0.03, d.w + 0.2, 0.16, 0.08, 0xbcb8ac);
      if (l.shop) {
        // Roll-up shutter part way up, awning and sign above.
        const open = 0.55 + r() * 0.35;
        fbox(B, f, "metal_corrugated", d.u, d.h - (d.h * (1 - open)) / 2, -0.05, d.w, d.h * (1 - open), 0.04, 0xa8aca8);
        fbox(B, f, "plain", d.u, (d.h * open) / 2, -0.4, d.w, d.h * open, 0.02, 0x1c1c1e);
        fbox(B, f, "metal_painted", d.u, d.h + 0.3, 0.1, d.w + 0.3, 0.32, 0.08, 0xd8d4c8);
        if (r() < 0.7) awning(B, f, d.u, d.h + 0.55, d.w + 0.4, 1.3, 0.35, Math.floor(r() * 4), Math.floor(r() * 1e6), r() < 0.25);
        const p = f.at(d.u, d.h + 0.95, 0.14);
        quads.push({ c: p, right: f.t.clone(), up: new THREE.Vector3(0, 1, 0), w: Math.min(d.w + 0.6, 3.4), h: Math.min(d.w + 0.6, 3.4) / 4, rect: atlas.signs[Math.floor(r() * atlas.signs.length)] });
      } else if (!l.enter) {
        const tint = [0x5a7a9a, 0x8a3a2a, 0x3a6a4a, 0xd8d4c8, 0x2a2a2a][Math.floor(r() * 5)];
        fbox(B, f, "metal_painted", d.u, d.h / 2, -0.04, d.w, d.h, 0.04, tint);
      }
      if (r() < 0.5) {
        const p = f.at(d.u + d.w / 2 + 0.35, 1.9, 0.02);
        quads.push({ c: p, right: f.t.clone(), up: new THREE.Vector3(0, 1, 0), w: 0.28, h: 0.2, rect: atlas.numbers[Math.floor(r() * atlas.numbers.length)] });
      }
    }

    // Graffiti on street-facing ground floors; the odd mural on a big blank wall.
    const street = !l.blank.includes(s);
    if (street && r() < 0.55) {
      const tw = 1.4 + r() * 1.4;
      const u = 0.8 + tw / 2 + r() * Math.max(0, L - tw - 1.6);
      if (!doors.some((d) => d.side === s && Math.abs(d.u - u) < d.w / 2 + tw / 2) && !wins.some((w) => w.side === s && w.y < 2 && Math.abs(w.u - u) < w.w / 2 + tw / 2)) {
        quads.push({ c: f.at(u, 0.5 + r() * 0.8 + tw / 4, 0.015), right: f.t.clone(), up: new THREE.Vector3(0, 1, 0), w: tw, h: tw / 2, rect: atlas.tags[Math.floor(r() * atlas.tags.length)] });
      }
    }
    if (street && L > 6 && !wins.some((w) => w.side === s) && !doors.some((d) => d.side === s) && r() < 0.5) {
      const mw = Math.min(L - 1, 7), mh = Math.min(H - 0.6, mw * 0.75);
      quads.push({ c: f.at(L / 2, 0.4 + mh / 2, 0.015), right: f.t.clone(), up: new THREE.Vector3(0, 1, 0), w: mw, h: mh, rect: atlas.murals[Math.floor(r() * atlas.murals.length)] });
    }
    if (r() < 0.35) downpipe(B, f, r() < 0.5 ? 0.25 : L - 0.25, H, clutterGroup(cx, cz));
  }

  // Roof slab (solid houses; enterable roofs come from the colliders).
  if (!l.enter) B.box("concrete", cx, H - 0.1, cz, W - 0.02, 0.2, D - 0.02, 0xa8a49a, { group: "solid" });
  // Rooftop life.
  const g = clutterGroup(cx, cz);
  const tanks = 1 + (r() < 0.45 ? 1 : 0);
  const tankBlue = [0x3a6fb8, 0x4a82c8, 0x2f5f9a, 0x5a8fd0];
  for (let i = 0; i < tanks; i++) {
    const tx = l.x0 + 1.0 + r() * (W - 2), tz = l.z0 + 1.0 + r() * (D - 2);
    if (l.enter) {
      // Keep the stair hole clear.
      const st = stairOf(l);
      const [hx0, hx1, hz0, hz1] = laneRect(st, ((l.floors - 1) % 2) as 0 | 1, 0.8);
      if (tx > hx0 - 0.8 && tx < hx1 + 0.8 && tz > hz0 - 0.8 && tz < hz1 + 0.8) continue;
    }
    const raised = r() < 0.4;
    if (raised) {
      // On a little brick plinth.
      B.box("brick", tx, H + 0.4, tz, 1.4, 0.8, 1.4, brickTint);
      caixa(B, tx, H + 0.8, tz, 1.15, tankBlue[Math.floor(r() * 4)], "decor");
    } else caixa(B, tx, H, tz, 1 + r() * 0.3, r() < 0.8 ? tankBlue[Math.floor(r() * 4)] : 0x9a9a92, "decor");
  }
  if (r() < 0.45) dish(B, l.x0 + 0.6 + r() * (W - 1.2), H + (l.laje ? 0 : 0.6), l.z0 + 0.6 + r() * (D - 1.2), r() * 6.28, 0.45 + r() * 0.2, g);
  if (r() < 0.55 && W > 3 && D > 3) {
    const y = H + 1.5;
    const a = new THREE.Vector3(l.x0 + 0.4, y, l.z0 + 0.5 + r() * (D - 1));
    const b = new THREE.Vector3(l.x1 - 0.4, y, l.z0 + 0.5 + r() * (D - 1));
    rod(B, new THREE.Vector3(a.x, H, a.z), a, 0.02, 0x4a4a46, g);
    rod(B, new THREE.Vector3(b.x, H, b.z), b, 0.02, 0x4a4a46, g);
    laundry(B, a, b, r, g);
  }
  if (l.laje) {
    // Columns with rebar sprouting from the top, a half-built brick wall.
    for (const [px, pz] of [[l.x0 + 0.15, l.z0 + 0.15], [l.x1 - 0.15, l.z0 + 0.15], [l.x0 + 0.15, l.z1 - 0.15], [l.x1 - 0.15, l.z1 - 0.15]]) {
      B.box("concrete", px, H + 1.2, pz, 0.3, 2.4, 0.3, 0xb8b4aa, { group: "solid" });
      for (let k = 0; k < 4; k++) rod(B, new THREE.Vector3(px + (k % 2 ? 0.08 : -0.08), H + 2.4, pz + (k < 2 ? 0.08 : -0.08)), new THREE.Vector3(px + (k % 2 ? 0.12 : -0.12) + (r() - 0.5) * 0.2, H + 3.0 + r() * 0.5, pz + (k < 2 ? 0.12 : -0.12)), 0.008, 0x6a4a3a, g, "metal_rust");
    }
    if (r() < 0.6) {
      const s = Math.floor(r() * 4) as Side;
      const f = fs[s];
      const L = sideLength(l, s);
      const hgt = 0.4 + r() * 1.1;
      const mid = f.at(L * 0.35, H + hgt / 2, -0.1);
      B.box("brick", mid.x, mid.y, mid.z, L * 0.5, hgt, 0.2, brickTint, { rotY: f.rotY });
    }
    if (!l.enter && r() < 0.5) rubblePile(B, cx + (r() - 0.5) * (W - 2), cz + (r() - 0.5) * (D - 2), 0.8, 0.6, 0.35, Math.floor(r() * 1e6), g, () => H);
  }
}

/** Enterable house interiors: slabs, stair flights and rails (drawn from their colliders). */
function interiors(B: MeshBuilder, boxes: { x: number; z: number; w: number; d: number; y?: number; h: number; tag?: string }[]) {
  for (const b of boxes) {
    const y = b.y ?? 0;
    if (b.tag === "floor" || b.tag === "roof") {
      B.box("concrete", b.x, y + b.h / 2, b.z, b.w, b.h, b.d, b.tag === "roof" ? 0xa8a49a : 0xbcb6aa, { group: "solid" });
      // Tiled floor on top inside.
      if (b.tag === "floor") B.box("concrete_dirty", b.x, y + b.h + 0.005, b.z, b.w, 0.01, b.d, 0xd8ccb8, { noAo: true });
    } else if (b.tag === "stair") {
      B.box("concrete", b.x, y + b.h / 2, b.z, b.w, b.h, b.d, 0xc0bcb2, { group: "solid" });
    } else if (b.tag === "rail") {
      const alongX = b.w > b.d;
      const a = new THREE.Vector3(alongX ? b.x - b.w / 2 : b.x, y, alongX ? b.z : b.z - b.d / 2);
      const e = new THREE.Vector3(alongX ? b.x + b.w / 2 : b.x, y, alongX ? b.z : b.z + b.d / 2);
      railing(B, a, e, 0.95, 0x2e3a3a, 0.14);
    }
  }
}

// ---------------------------------------------------------------------------
// Hillside backdrop: hundreds of houses climbing the slopes
// ---------------------------------------------------------------------------

function hillsideHouses(B: MeshBuilder, quads: Quad[], atlas: ReturnType<typeof makeAtlas>["rects"]) {
  const r = rnd(4242);
  const paints = [0x5fb3a8, 0xe6c85a, 0xd77a6a, 0x7fa6d6, 0xa6c86a, 0xe0a0b8, 0xf0e2c0, 0xd8d0c0, 0xe8b070];
  for (let d = BOUND + 6; d < 235; d += 7 + (d - BOUND) * 0.025) {
    const per = Math.floor((8 * d) / (7.5 + r() * 2));
    for (let i = 0; i < per; i++) {
      // Walk the square ring at distance d.
      const t = (i + r() * 0.6) / per;
      const side = Math.floor(t * 4), a = (t * 4 - side) * 2 - 1;
      const x = side === 0 ? a * d : side === 1 ? d : side === 2 ? -a * d : -d;
      const z = side === 0 ? -d : side === 1 ? a * d : side === 2 ? d : -a * d;
      const jx = x + (r() - 0.5) * 4, jz = z + (r() - 0.5) * 4;
      const h0 = maHeight(jx, jz);
      if (h0 > 110 || fbm2(jx * 0.02, jz * 0.02, 3) < 0.34) continue; // too steep / green patches
      const w = 4.5 + r() * 4, dd = 4.5 + r() * 3.5;
      let gy = Infinity;
      for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) gy = Math.min(gy, maHeight(jx + sx * w, jz + sz * dd));
      const floors = 1 + Math.floor(r() * (d < 140 ? 4 : 3));
      const fh = 2.8;
      const top = gy + floors * fh + (h0 - gy) * 0.5;
      const brick = r() < 0.45;
      const tint = brick ? BRICK_TINTS[Math.floor(r() * 4)] : paints[Math.floor(r() * paints.length)];
      const y0 = gy - 3;
      B.box(brick ? "brick" : "plaster", jx, (y0 + top) / 2, jz, w, top - y0, dd, tint, { group: "far" });
      B.box("concrete", jx, top + 0.1, jz, w + 0.1, 0.2, dd + 0.1, 0x9a968c, { group: "far" });
      // Window holes on the face toward the map.
      const toX = Math.abs(jx) > Math.abs(jz);
      const face = toX ? -Math.sign(jx) : -Math.sign(jz);
      const L = toX ? dd : w;
      const cols = Math.max(1, Math.floor(L / 2.4));
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          if (r() < 0.2) continue;
          const u = -L / 2 + ((c + 0.5) * L) / cols;
          const wy = top - floors * fh + f * fh + 1.5;
          const wx = toX ? jx + face * (w / 2 + 0.02) : jx + u;
          const wz = toX ? jz + u : jz + face * (dd / 2 + 0.02);
          B.box("plain", wx, wy, wz, toX ? 0.04 : 0.9, 1.0, toX ? 0.9 : 0.04, 0x1c1e22, { group: "far" });
        }
      }
      if (r() < 0.55) caixa(B, jx + (r() - 0.5) * (w - 1.5), top + 0.2, jz + (r() - 0.5) * (dd - 1.5), 1.1, [0x3a6fb8, 0x4a82c8, 0x2f5f9a][Math.floor(r() * 3)], "far");
      if (d < 130 && r() < 0.06) {
        const p = new THREE.Vector3(toX ? jx + face * (w / 2 + 0.03) : jx, top - floors * fh + Math.min(floors * fh, 4) / 2 + 0.3, toX ? jz : jz + face * (dd / 2 + 0.03));
        const right = toX ? new THREE.Vector3(0, 0, face) : new THREE.Vector3(-face, 0, 0);
        quads.push({ c: p, right, up: new THREE.Vector3(0, 1, 0), w: Math.min(L - 0.5, 5), h: Math.min(L - 0.5, 5) * 0.75, rect: atlas.murals[Math.floor(r() * atlas.murals.length)] });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dressing
// ---------------------------------------------------------------------------

export const morroAzul: Dressing = (kit) => {
  const B = kit.builder;
  const q = qualityName(kit.quality);
  const detail = worldDetail(q);
  const high = q === "high";
  const r = rnd(9001);
  const atlasData = makeAtlas();
  const quads: Quad[] = [];
  const ctx: Ctx = { B, quads, atlas: atlasData.rects, high };
  const flat = () => 0;

  // ---- Streets ------------------------------------------------------------------
  const asphalt = 0xa8a8a2, concreteT = 0xc2beb4;
  for (const [c, h] of ROADS_X) {
    const main = h > 3;
    groundStrip(B, main ? "asphalt" : "concrete_broken", c, -HALF - 2, c, HALF + 2, h * 2 + (main ? 0 : 0.4), flat, main ? asphalt : concreteT, 11 + c, "decor", 0.03);
    if (main) {
      // Sidewalks + curbs, a dashed centre line.
      for (const s of [-1, 1]) {
        B.box("concrete", c + s * (h - 0.75), 0.07, 0, 1.5, 0.14, HALF * 2, 0xc8c4ba, { group: "solid" });
        B.box("concrete_dirty", c + s * (h - 1.52), 0.08, 0, 0.12, 0.16, HALF * 2, 0xd4d0c6);
      }
      paintLine(B, c, -HALF, c, HALF, 0, 0.12, 2.4, 3.2, flat, 5, 0xe8d070, "decor", 0.05);
    } else {
      // Drainage channel down the middle of the beco.
      B.box("concrete_dirty", c, 0.035, 0, 0.3, 0.01, HALF * 2, 0x6a665e, { noAo: true });
    }
  }
  for (const [c, h] of ROADS_Z) {
    const main = h > 3;
    groundStrip(B, main ? "asphalt" : "concrete_broken", -HALF - 2, c, HALF + 2, c, h * 2 + (main ? 0 : 0.4), flat, main ? asphalt : concreteT, 23 + c, "decor", main ? 0.035 : 0.032);
    if (main) {
      for (const s of [-1, 1]) {
        for (const [a, b] of [[-HALF, -5], [5, HALF]]) {
          B.box("concrete", (a + b) / 2, 0.07, c + s * (h - 0.75), b - a, 0.14, 1.5, 0xc8c4ba, { group: "solid" });
        }
      }
      paintLine(B, -HALF, c, -5, c, 0, 0.12, 2.4, 3.2, flat, 6, 0xe8d070, "decor", 0.05);
      paintLine(B, 5, c, HALF, c, 0, 0.12, 2.4, 3.2, flat, 7, 0xe8d070, "decor", 0.05);
    } else B.box("concrete_dirty", 0, 0.036, c, HALF * 2, 0.01, 0.3, 0x6a665e, { noAo: true });
  }
  // Plaza paving and zebra crossings.
  B.box("concrete", (PLAZA.x0 + PLAZA.x1) / 2, 0.02, (PLAZA.z0 + PLAZA.z1) / 2, PLAZA.x1 - PLAZA.x0, 0.04, PLAZA.z1 - PLAZA.z0, 0xd0c8b8, { noAo: true });
  for (const z of [-7, 7]) for (let x = -4; x <= 4; x += 1.1) B.box("plain", x, 0.06, z, 0.6, 0.01, 2.4, 0xe8e6de, { noAo: true });
  // Rubbish piles in the becos, puddles, litter everywhere.
  for (let i = 0; i < 70; i++) {
    const roads = r() < 0.5 ? ROADS_X : ROADS_Z;
    const [c, h] = roads[Math.floor(r() * roads.length)];
    const along = (r() * 2 - 1) * (HALF - 4);
    const off = (r() < 0.5 ? -1 : 1) * (h - 0.4);
    const [x, z] = roads === ROADS_X ? [c + off, along] : [along, c + off];
    litter(B, x, z, 1.4, 10, Math.floor(r() * 1e6), clutterGroup(x, z));
  }

  // ---- Houses ---------------------------------------------------------------------
  for (const l of LOTS) house(ctx, l);
  interiors(B, kit.def.boxes.filter((b) => b.tag === "floor" || b.tag === "roof" || b.tag === "stair" || b.tag === "rail"));
  // Laje columns of enterable houses are colliders tagged "column": already drawn by house().

  // ---- Futsal court ------------------------------------------------------------------
  {
    const c = COURT;
    const mid = (c.x0 + c.x1) / 2, midZ = (c.z0 + c.z1) / 2;
    B.box("concrete", mid, 0.03, midZ, c.x1 - c.x0, 0.05, c.z1 - c.z0, 0x5aa8a0, { noAo: true });
    const px0 = c.x0 + 1.2, px1 = c.x1 - 1.2, pz0 = c.z0 + 1.4, pz1 = c.z1 - 1.4;
    const line = (ax: number, az: number, bx: number, bz: number) => paintLine(B, ax, az, bx, bz, 0, 0.1, 100, 0, flat, 3, 0xf0f0ea, "decor", 0.065);
    line(px0, pz0, px1, pz0);
    line(px1, pz0, px1, pz1);
    line(px1, pz1, px0, pz1);
    line(px0, pz1, px0, pz0);
    line(px0, midZ, px1, midZ);
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      line(mid + Math.cos(a0) * 2.6, midZ + Math.sin(a0) * 2.6, mid + Math.cos(a1) * 2.6, midZ + Math.sin(a1) * 2.6);
    }
    for (const [gz, s] of [[pz0, 1], [pz1, -1]] as const) {
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * Math.PI, a1 = ((i + 1) / 12) * Math.PI;
        line(mid - Math.cos(a0) * 4, gz + s * Math.sin(a0) * 4, mid - Math.cos(a1) * 4, gz + s * Math.sin(a1) * 4);
      }
    }
    // Goals: white posts, crossbar, sagging net.
    for (const gz of [c.z0 + 2.2, c.z1 - 2.2]) {
      const back = gz < midZ ? -1 : 1;
      for (const gx of [mid - 1.45, mid + 1.45]) B.box("metal_painted", gx, 1.0, gz, 0.1, 2.0, 0.1, 0xf0f0ea);
      B.box("metal_painted", mid, 2.0, gz, 3.0, 0.1, 0.1, 0xf0f0ea);
      B.box("chainlink", mid, 1.0, gz + back * 0.8, 2.9, 1.95, 0.02, 0xe0e0e0, { uv: "keep", uvScale: [3, 2] });
      B.box("chainlink", mid, 1.98, gz + back * 0.4, 2.9, 0.02, 0.8, 0xe0e0e0, { uv: "keep", uvScale: [3, 1] });
    }
    // Walls: low walls + chain-link on the street sides; tall mural walls on the alley sides.
    for (const b of kit.def.boxes.filter((k) => k.tag === "courtlow" || k.tag === "courtwall")) {
      const y = b.y ?? 0;
      B.box("plaster", b.x, y + b.h / 2, b.z, b.w, b.h, b.d, b.tag === "courtwall" ? 0xe8e0cc : 0xd8d0bc, { group: "solid" });
      B.box("concrete", b.x, y + b.h + 0.04, b.z, b.w + 0.05, 0.08, b.d + 0.05, 0xbab6aa);
      if (b.tag === "courtlow") {
        const alongX = b.w > b.d;
        if (alongX) chainlink(B, b.x - b.w / 2, b.z, b.x + b.w / 2, b.z, 2.6, () => b.h, Math.floor(r() * 1e6));
        else chainlink(B, b.x, b.z - b.d / 2, b.x, b.z + b.d / 2, 2.6, () => b.h, Math.floor(r() * 1e6));
      } else {
        // Murals on the court side.
        const alongX = b.w > b.d;
        const len = alongX ? b.w : b.d;
        const inward = alongX ? -1 : -1;
        const n = Math.max(1, Math.floor(len / 5.5));
        for (let i = 0; i < n; i++) {
          const t = -len / 2 + ((i + 0.5) * len) / n;
          const c3 = alongX ? new THREE.Vector3(b.x + t, 1.65, b.z + inward * (b.d / 2 + 0.02)) : new THREE.Vector3(b.x + inward * (b.w / 2 + 0.02), 1.65, b.z + t);
          const right = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
          quads.push({ c: c3, right, up: new THREE.Vector3(0, 1, 0), w: Math.min(len / n - 0.3, 5), h: 2.9, rect: atlasData.rects.murals[(i + Math.floor(b.x)) % 6] });
        }
      }
    }
    for (const b of kit.def.boxes.filter((k) => k.tag === "bench")) B.box("wood", b.x, (b.y ?? 0) + b.h / 2, b.z, b.w, b.h, b.d, 0x9a7a5a, { rot90: b.d > b.w });
  }

  // ---- Plaza furniture --------------------------------------------------------------------
  {
    const s = SHELTER;
    B.box("metal_painted", s.x, 1.25, s.z - 0.85, 4, 2.5, 0.08, 0x3a7a5a);
    B.box("metal_corrugated", s.x, 2.6, s.z - 0.2, 4.4, 0.06, 1.8, 0x5a8a6a);
    for (const sx of [-1.9, 1.9]) B.box("metal_dark", s.x + sx, 1.3, s.z + 0.5, 0.08, 2.6, 0.08, 0x3a3a38);
    B.box("wood", s.x, 0.43, s.z - 0.4, 3.2, 0.06, 0.4, 0xa88a5a);
    quads.push({ c: new THREE.Vector3(s.x - 0.8, 1.5, s.z - 0.8), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), w: 1.4, h: 0.7, rect: atlasData.rects.tags[3] });
    const k = KIOSK;
    B.box("metal_painted", k.x, 1.3, k.z, 2.6, 2.6, 2.2, 0xd84a3a);
    B.box("metal_corrugated", k.x, 2.68, k.z, 3.0, 0.08, 2.6, 0xe8e4d8);
    B.box("plain", k.x, 1.4, k.z + 1.11, 2.0, 1.0, 0.02, 0x1c1c1e);
    quads.push({ c: new THREE.Vector3(k.x, 2.25, k.z + 1.13), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), w: 2.4, h: 0.6, rect: atlasData.rects.signs[2] });
    for (const b of kit.def.boxes.filter((x) => x.tag === "planter")) {
      B.box("concrete", b.x, b.h / 2, b.z, b.w, b.h, b.d, 0xc8c0b0);
      B.box("ground", b.x, b.h - 0.04, b.z, b.w - 0.2, 0.06, b.d - 0.2, 0x5a4a32, { noAo: true });
    }
  }

  // ---- Wrecks -----------------------------------------------------------------------------
  for (const w of WRECKS) burntCar(B, w.x, w.z, w.yaw, w.kind, Math.floor(r() * 1e6));

  // ---- Power poles and the spaghetti of wiring ---------------------------------------------
  const spots: PoleSpot[] = POLES.map(([x, z, rotY]) => ({ x, y: 0, z, rotY }));
  const roadPoles = spots.filter((p) => p.rotY === 0).sort((a, b) => a.z - b.z);
  const crossPoles = spots.filter((p) => p.rotY !== 0).sort((a, b) => a.x - b.x);
  for (const run of [roadPoles.filter((p) => p.z < 0), roadPoles.filter((p) => p.z > 0), crossPoles.filter((p) => p.x < 0), crossPoles.filter((p) => p.x > 0)]) {
    poleLine(B, run, r, 1.1, false);
  }
  // Drops from every pole to the nearby houses (lots of them, at all angles).
  for (const p of spots) {
    const near = LOTS.filter((l) => Math.hypot((l.x0 + l.x1) / 2 - p.x, (l.z0 + l.z1) / 2 - p.z) < 16).slice(0, 8);
    const top = new THREE.Vector3(p.x, 7.4 + r() * 0.6, p.z);
    for (const l of near) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const s = l.front;
        const f = facades((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2, l.x1 - l.x0, l.z1 - l.z0, 0)[s];
        const end = f.at(0.3 + r() * (sideLength(l, s) - 0.6), Math.min(l.floors * l.fh - 0.3, 2.8 + r() * 3), 0.05);
        cable(B, top.clone().add(new THREE.Vector3((r() - 0.5) * 0.4, (r() - 0.5) * 0.5, (r() - 0.5) * 0.4)), end, 0.3 + r() * 0.7, clutterGroup(p.x, p.z));
      }
    }
    // A transformer drum on some poles, a bundle of junk cables wrapped round it.
    if (r() < 0.35) {
      const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10);
      B.add(drum, new THREE.Matrix4().makeTranslation(p.x + 0.35, 6.4, p.z), "metal_painted", 0x7a7e7a, { uv: "keep" });
      drum.dispose();
    }
  }
  // Wires strung across the becos from roof to roof.
  for (let i = 0; i < 140; i++) {
    const a = LOTS[Math.floor(r() * LOTS.length)];
    const b = LOTS.filter((o) => o !== a && Math.hypot(o.x0 - a.x0, o.z0 - a.z0) < 14)[Math.floor(r() * 6)];
    if (!b) continue;
    const pa = new THREE.Vector3(a.x0 + r() * (a.x1 - a.x0), a.floors * a.fh + 0.3 + r() * 0.8, a.z0 + r() * (a.z1 - a.z0));
    const pb = new THREE.Vector3(b.x0 + r() * (b.x1 - b.x0), b.floors * b.fh + 0.3 + r() * 0.8, b.z0 + r() * (b.z1 - b.z0));
    cable(B, pa, pb, 0.4 + r() * 0.8, clutterGroup(pa.x, pa.z));
  }

  // ---- Edges: retaining wall the backdrop rises behind --------------------------------------
  for (const s of [-1, 1]) {
    B.box("concrete_dirty", 0, 2.0, s * (BOUND + 0.5), BOUND * 2 + 2, 4, 1, 0xb0aca2, { group: "far" });
    B.box("concrete_dirty", s * (BOUND + 0.5), 2.0, 0, 1, 4, BOUND * 2 + 2, 0xb0aca2, { group: "far" });
  }
  hillsideHouses(B, quads, atlasData.rects);

  // ---- Trees and palms -----------------------------------------------------------------
  const palmList: PalmPlacement[] = [];
  for (const [x, z] of TREES) palmList.push({ x, y: 0.6, z, height: 7 + r() * 2, rot: r() * 6.28, lean: 0.05 });
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = BOUND + 8 + r() * 120;
    const x = Math.cos(a) * d * 1.2, z = Math.sin(a) * d * 1.2;
    if (Math.max(Math.abs(x), Math.abs(z)) < BOUND + 6) continue;
    palmList.push({ x, y: maHeight(x, z), z, height: 7 + r() * 5, rot: r() * 6.28, lean: (r() - 0.5) * 0.2 });
  }
  const trees: { x: number; z: number; scale: number; variant: number; rot: number }[] = [];
  for (let i = 0; i < 900 && trees.length < 420; i++) {
    const x = (r() * 2 - 1) * 330, z = (r() * 2 - 1) * 330;
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < BOUND + 10) continue;
    // Forest on the steep upper slopes and peaks, between the house rings.
    if (maHeight(x, z) < 45 && fbm2(x * 0.02, z * 0.02, 3) > 0.36) continue;
    trees.push({ x, z, scale: 1.0 + r() * 0.8, variant: Math.floor(r() * 4), rot: r() * 6.28 });
  }

  const extras: WorldExtra[] = [];
  extras.push(palms(palmList, kit.materials, kit.windTime));
  extras.push(atlasExtra(quads, atlasData.canvas, high ? 8 : 4));

  return {
    terrain: {
      height: maHeight,
      splat: (x, z, o) => {
        const d = Math.max(Math.abs(x), Math.abs(z));
        const h = maHeight(x, z);
        const n = fbm2(x * 0.05, z * 0.05, 3);
        if (d < BOUND + 2) {
          o.gravel = 1;
          o.ground = 0.2 * n;
          o.mud = 0;
          return;
        }
        o.gravel = h > 80 ? 0.9 : 0.3 + 0.3 * n;
        o.ground = h > 80 ? 0.4 : 0.9;
        o.mud = 0.1;
      },
      inner: 110,
      outer: 800,
    },
    foliage: {
      grass: (x, z) => {
        const d = Math.max(Math.abs(x), Math.abs(z));
        if (d < BOUND + 3) {
          // Weeds at wall bases in vacant corners only.
          return detail.clutterDistance > 0 && fbm2(x * 0.3, z * 0.3, 2) > 0.68 ? 0.25 : 0;
        }
        return 0.55 * smoothstep(0.3, 0.6, fbm2(x * 0.04, z * 0.04, 3));
      },
      grassBounds: 130,
      trees,
      bushes: trees.slice(0, 160).map((t, i) => ({ x: t.x + 4 * Math.sin(i), z: t.z + 4 * Math.cos(i), scale: 0.9 + (i % 5) * 0.12 })),
    },
    extras,
  };
};

/** Box in a frame (local import kept here to avoid widening kit's public surface). */
function fbox(B: MeshBuilder, f: Frame, mat: Parameters<MeshBuilder["box"]>[0], u: number, y: number, d: number, w: number, h: number, depth: number, tint: Tint, opts: { group?: string; rot90?: boolean } = {}) {
  const p = f.at(u, y, d);
  B.box(mat, p.x, p.y, p.z, w, h, depth, tint, { ...opts, rotY: f.rotY });
}
