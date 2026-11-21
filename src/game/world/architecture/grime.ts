import * as THREE from "three";
import type { QualityName } from "../../config";
import type { MeshBuilder } from "../MeshBuilder";
import type { MapBox } from "../MapLoader";
import type { WorldExtra } from "../dressing/common";
import { Frame, type Opening, type Blast } from "./kit";

/**
 * Weathering layer for facades: rain streaks hanging from parapets, roof
 * runs, rising damp and splash at wall feet, corner grime, smudges, cracks
 * off window corners, rust runs and algae. One procedurally painted atlas
 * (canvas, licence-free) and ONE merged, alpha-blended mesh per map, so the
 * whole layer costs a single draw call and no extra shader variants.
 *
 * Builders reach the layer through the MeshBuilder they draw into:
 * a dressing calls `attachGrime(B, ...)` first, building()/grimeBoxes()
 * then add quads via `grimeOf(B)`, and the dressing pushes `layer.extra()`
 * into its plan. Without an attached layer nothing is drawn.
 */

export type GrimeKind = "streaks" | "runs" | "damp" | "cracks" | "rust" | "smudge" | "algae" | "corner";
const CELL: Record<GrimeKind, number> = { streaks: 0, runs: 1, damp: 2, cracks: 3, rust: 4, smudge: 5, algae: 6, corner: 7 };
export type GrimeClimate = "dry" | "wet";

/** Quad budget scale per preset (the layer is one draw either way). */
export const GRIME_DETAIL: Record<QualityName, number> = { low: 0.45, medium: 0.8, high: 1 };

const ATLAS_W = 1024, ATLAS_H = 512, CW = 256, CH = 256;

/** UV rect [u0, v0, u1, v1] of a cell (4 × 2 grid), padded against mip bleed. */
export function grimeRect(kind: GrimeKind): [number, number, number, number] {
  const i = CELL[kind];
  const cx = i % 4, cy = Math.floor(i / 4);
  const pu = 3 / ATLAS_W, pv = 3 / ATLAS_H;
  return [cx / 4 + pu, 1 - (cy + 1) / 2 + pv, (cx + 1) / 4 - pu, 1 - cy / 2 - pv];
}

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let atlasCanvas: HTMLCanvasElement | null = null;

/** Paints the atlas once per session (RGB = stain colour, A = strength). */
function grimeAtlas(): HTMLCanvasElement | null {
  if (atlasCanvas) return atlasCanvas;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = rnd(4242);
  const cell = (k: GrimeKind) => [(CELL[k] % 4) * CW, Math.floor(CELL[k] / 4) * CH] as const;
  // Side fade so neighbouring quads never show a hard vertical edge.
  const fadeSides = (x: number, y: number, edge = 28) => {
    g.save();
    g.globalCompositeOperation = "destination-out";
    for (const [x0, dir] of [[x, 1], [x + CW, -1]] as const) {
      const gr = g.createLinearGradient(x0, 0, x0 + dir * edge, 0);
      gr.addColorStop(0, "rgba(0,0,0,1)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(dir > 0 ? x0 : x0 - edge, y, edge, CH);
    }
    g.restore();
  };
  const streak = (x: number, y: number, len: number, w: number, rgb: string, a: number) => {
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    // Slight wobble: draw in short vertical pieces.
    let sx = x;
    for (let yy = y; yy < y + len; yy += 12) {
      sx += (r() - 0.5) * 0.8;
      g.fillRect(sx, yy, w, Math.min(13, y + len - yy));
    }
  };
  const blob = (x: number, y: number, rad: number, rgb: string, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);

  // 0 rain streaks: dense thin runs from the top edge, varied lengths.
  {
    const [x, y] = cell("streaks");
    const top = g.createLinearGradient(0, y, 0, y + 26);
    top.addColorStop(0, "rgba(40,34,26,0.55)");
    top.addColorStop(1, "rgba(40,34,26,0)");
    g.fillStyle = top;
    g.fillRect(x, y, CW, 26);
    for (let k = 0; k < 70; k++) {
      const len = CH * (0.25 + r() * r() * 0.75 + r() * 0.1);
      streak(x + 6 + r() * (CW - 12), y, len, 1 + r() * 4, "38,32,24", 0.12 + r() * 0.3);
    }
    fadeSides(x, y);
  }
  // 1 roof runs: broad wash under a parapet, ragged lower edge, a few long drips.
  {
    const [x, y] = cell("runs");
    for (let k = 0; k < 26; k++) blob(x + r() * CW, y + r() * 50, 30 + r() * 50, "44,38,30", 0.18 + r() * 0.18);
    const band = g.createLinearGradient(0, y, 0, y + 70);
    band.addColorStop(0, "rgba(44,38,30,0.6)");
    band.addColorStop(1, "rgba(44,38,30,0)");
    g.fillStyle = band;
    g.fillRect(x, y, CW, 70);
    for (let k = 0; k < 22; k++) streak(x + 8 + r() * (CW - 16), y + 20, CH * (0.3 + r() * 0.65), 2 + r() * 6, "44,38,30", 0.15 + r() * 0.2);
    // Clean the very bottom so the run never ends in a line.
    g.save();
    g.globalCompositeOperation = "destination-out";
    const end = g.createLinearGradient(0, y + CH - 40, 0, y + CH);
    end.addColorStop(0, "rgba(0,0,0,0)");
    end.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = end;
    g.fillRect(x, y + CH - 40, CW, 40);
    g.restore();
    fadeSides(x, y, 40);
  }
  // 2 rising damp: dark wet base, wavy tide line, pale salt bloom above it.
  {
    const [x, y] = cell("damp");
    const tide: number[] = [];
    for (let i = 0; i <= 32; i++) tide.push(y + CH * (0.35 + 0.18 * Math.sin(i * 0.7 + r() * 2) * r() + r() * 0.08));
    const path = () => {
      g.beginPath();
      g.moveTo(x, y + CH);
      tide.forEach((ty, i) => g.lineTo(x + (i / 32) * CW, ty));
      g.lineTo(x + CW, y + CH);
      g.closePath();
    };
    const wet = g.createLinearGradient(0, y + CH * 0.3, 0, y + CH);
    wet.addColorStop(0, "rgba(46,40,30,0.25)");
    wet.addColorStop(1, "rgba(40,34,26,0.7)");
    g.fillStyle = wet;
    path();
    g.fill();
    g.strokeStyle = "rgba(214,206,186,0.35)";
    g.lineWidth = 5;
    g.beginPath();
    tide.forEach((ty, i) => (i ? g.lineTo(x + (i / 32) * CW, ty - 4) : g.moveTo(x, ty - 4)));
    g.stroke();
    g.strokeStyle = "rgba(36,30,22,0.4)";
    g.lineWidth = 2;
    g.beginPath();
    tide.forEach((ty, i) => (i ? g.lineTo(x + (i / 32) * CW, ty) : g.moveTo(x, ty)));
    g.stroke();
    // Splash specks near the ground.
    for (let k = 0; k < 260; k++) {
      g.fillStyle = `rgba(54,44,32,${0.2 + r() * 0.4})`;
      const s = 1 + r() * 3;
      g.fillRect(x + r() * CW, y + CH - r() * r() * CH * 0.5, s, s);
    }
    fadeSides(x, y, 36);
  }
  // 3 cracks: a plaster crack running up and out from the bottom-left corner.
  {
    const [x, y] = cell("cracks");
    g.lineCap = "round";
    const crack = (px: number, py: number, ang: number, len: number, w: number, depth: number) => {
      let cx = px, cy = py;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx, cy);
      const steps = Math.max(3, Math.round(len / 9));
      for (let s = 0; s < steps; s++) {
        ang += (r() - 0.5) * 0.8;
        cx = Math.min(x + CW - 4, Math.max(x + 4, cx + Math.cos(ang) * (len / steps)));
        cy = Math.min(y + CH - 4, Math.max(y + 4, cy + Math.sin(ang) * (len / steps)));
        g.lineTo(cx, cy);
        if (depth > 0 && r() < 0.22) crack(cx, cy, ang + (r() - 0.5) * 1.8, len * 0.4, w * 0.6, depth - 1);
      }
      g.stroke();
    };
    g.strokeStyle = "rgba(120,104,84,0.35)";
    crack(x + 10, y + CH - 10, -0.95, 300, 6, 0);
    g.strokeStyle = "rgba(22,18,14,0.85)";
    for (let k = 0; k < 2; k++) crack(x + 10, y + CH - 10, -0.9 - k * 0.3, 280 - k * 90, 2.2 - k * 0.6, 2);
  }
  // 4 rust run: orange-brown streaks from a fixing at the top.
  {
    const [x, y] = cell("rust");
    blob(x + CW / 2, y + 14, 36, "112,58,24", 0.55);
    for (let k = 0; k < 30; k++) streak(x + CW / 2 + (r() - 0.5) * 110 * r(), y + 8, CH * (0.3 + r() * 0.65), 1.5 + r() * 5, r() < 0.7 ? "118,62,26" : "70,40,20", 0.15 + r() * 0.3);
    fadeSides(x, y, 30);
  }
  // 5 smudge: soft mottled dirt patch.
  {
    const [x, y] = cell("smudge");
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 85;
      blob(x + CW / 2 + Math.cos(a) * d, y + CH / 2 + Math.sin(a) * d * 0.9, 18 + r() * 40, "52,44,34", 0.06 + r() * 0.12);
    }
  }
  // 6 algae: green-black streaks (damp climates), heavier at the top.
  {
    const [x, y] = cell("algae");
    for (let k = 0; k < 16; k++) blob(x + r() * CW, y + r() * 30, 20 + r() * 30, "34,44,26", 0.25);
    for (let k = 0; k < 55; k++) streak(x + 6 + r() * (CW - 12), y, CH * (0.2 + r() * 0.8), 1.5 + r() * 5, r() < 0.6 ? "30,42,24" : "24,26,20", 0.12 + r() * 0.3);
    fadeSides(x, y);
  }
  // 7 corner: grime collecting along a vertical edge (strongest at the left), darker low down.
  {
    const [x, y] = cell("corner");
    const gr = g.createLinearGradient(x, 0, x + CW, 0);
    gr.addColorStop(0, "rgba(36,30,24,0.6)");
    gr.addColorStop(0.35, "rgba(36,30,24,0.22)");
    gr.addColorStop(1, "rgba(36,30,24,0)");
    g.fillStyle = gr;
    g.fillRect(x, y, CW, CH);
    for (let k = 0; k < 24; k++) streak(x + r() * CW * 0.4, y, CH * (0.4 + r() * 0.6), 2 + r() * 6, "36,30,24", 0.08 + r() * 0.14);
    g.save();
    g.globalCompositeOperation = "destination-out";
    for (const [y0, y1] of [[y, y + 20], [y + CH, y + CH - 20]] as const) {
      const e = g.createLinearGradient(0, y0, 0, y1);
      e.addColorStop(0, "rgba(0,0,0,1)");
      e.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = e;
      g.fillRect(x, Math.min(y0, y1), CW, 20);
    }
    g.restore();
  }
  atlasCanvas = c;
  return c;
}

type Rect = { u0: number; u1: number; y0: number; y1: number };

/** Opening/blast rectangles in facade (u, y) space, for keeping stains off holes. */
export function holeRects(openings: Opening[] = [], blasts: Blast[] = []): Rect[] {
  const out: Rect[] = [];
  for (const o of openings) out.push({ u0: o.u - o.w / 2 - 0.05, u1: o.u + o.w / 2 + 0.05, y0: o.y - 0.05, y1: o.y + o.h + (o.arch ? o.w / 2 : 0) + 0.05 });
  for (const b of blasts) out.push({ u0: b.u - b.r * 1.25, u1: b.u + b.r * 1.25, y0: b.y - b.r * 1.1, y1: b.y + b.r * 1.1 });
  return out;
}

export type FacadeGrime = {
  /** Facade length and the wall's top edge above the frame origin. */
  length: number;
  top: number;
  seed: number;
  holes?: Rect[];
  /** Base splash/damp band (skip for walls whose foot is hidden). */
  base?: boolean;
  /** Corner grime on both vertical edges. */
  corners?: boolean;
  /** 0..1 scale on everything (backdrop walls get less). */
  amount?: number;
  /** Streaks/runs from the top (off for broken crowns). */
  fromTop?: boolean;
  /** Openings whose corners may crack. */
  cracks?: Opening[];
  /** Offset out of the wall plane (clears plinths / bands). */
  d?: number;
};

/**
 * Collects grime quads. Every quad carries an RGBA vertex colour: RGB tints
 * the stain, A sets its strength, so one atlas covers dry dust and wet soot.
 */
export class GrimeLayer {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  readonly density: number;

  constructor(
    readonly climate: GrimeClimate,
    /** The preset the map was built for (builders use it to thin fine detail on low). */
    readonly quality: QualityName,
  ) {
    this.density = GRIME_DETAIL[quality];
  }

  get quads() {
    return this.pos.length / 18;
  }

  /** Quad centred on `c` spanning `right` (w) and `up` (h); faces right × up. */
  quad(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, kind: GrimeKind, alpha: number, tint: THREE.ColorRepresentation = 0xffffff, flipU = false) {
    if (w <= 0.02 || h <= 0.02 || alpha <= 0.01) return;
    const [u0, v0, u1, v1] = grimeRect(kind);
    const L = flipU ? u1 : u0, R = flipU ? u0 : u1;
    const P = (sx: number, sy: number) => [c.x + right.x * sx * w / 2 + up.x * sy * h / 2, c.y + right.y * sx * w / 2 + up.y * sy * h / 2, c.z + right.z * sx * w / 2 + up.z * sy * h / 2];
    const a = P(-1, -1), b = P(1, -1), cc = P(1, 1), d = P(-1, 1);
    this.pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    this.uv.push(L, v0, R, v0, R, v1, L, v0, R, v1, L, v1);
    const n = new THREE.Vector3().crossVectors(right, up).normalize();
    const t = new THREE.Color(tint);
    for (let i = 0; i < 6; i++) {
      this.nor.push(n.x, n.y, n.z);
      this.col.push(t.r, t.g, t.b, Math.min(1, alpha));
    }
  }

  /** Quad on a facade frame: centre (u, y), `d` out of the wall. */
  wall(f: Frame, kind: GrimeKind, u: number, y: number, w: number, h: number, alpha: number, d = 0.022, flipU = false, tint: THREE.ColorRepresentation = 0xffffff) {
    // right × up must point out of the wall: right = -t, so mirror u back.
    this.quad(f.at(u, y, d), f.t.clone().negate(), new THREE.Vector3(0, 1, 0), w, h, kind, alpha, tint, !flipU);
  }

  /** Quad hanging from `yTop` down at most `len`, stopped above the first hole below it. */
  hang(f: Frame, kind: GrimeKind, u: number, w: number, yTop: number, len: number, alpha: number, holes: Rect[], d = 0.022, tint: THREE.ColorRepresentation = 0xffffff, flipU = false) {
    let bottom = Math.max(0.05, yTop - len);
    for (const h of holes) {
      if (h.u1 < u - w / 2 || h.u0 > u + w / 2) continue;
      if (h.y1 > yTop - 0.05 && h.y0 < yTop) return; // starts inside a hole
      if (h.y1 <= yTop && h.y1 > bottom) bottom = h.y1;
    }
    const hh = yTop - bottom;
    if (hh < 0.3) return;
    // The texture's streaks hang from the quad's top edge; shortened quads keep it.
    this.wall(f, kind, u, bottom + hh / 2, w, hh, alpha, d, flipU, tint);
  }

  /** Is the facade rect clear of every hole? */
  static clear(holes: Rect[], u0: number, u1: number, y0: number, y1: number) {
    return !holes.some((h) => h.u1 > u0 && h.u0 < u1 && h.y1 > y0 && h.y0 < y1);
  }

  /** Weathers one facade: streaks, runs, corners, base band, smudges, cracks. */
  facade(f: Frame, g: FacadeGrime) {
    const r = rnd(g.seed);
    const k = (g.amount ?? 1) * this.density;
    const holes = g.holes ?? [];
    const L = g.length, top = g.top;
    const d = g.d ?? 0.022;
    const wet = this.climate === "wet";
    if (L < 0.8 || top < 0.6) return;
    if (g.fromTop ?? true) {
      // Rain streaks in irregular strips along the top edge.
      for (let u = r() * 0.6; u < L - 0.3; ) {
        const w = 0.7 + r() * 1.9;
        if (r() < 0.78 * k + 0.1) {
          const cu = Math.min(L - w / 2 - 0.05, u + w / 2);
          const kind: GrimeKind = wet && r() < 0.45 ? "algae" : "streaks";
          this.hang(f, kind, cu, w, top - 0.02, top * (0.35 + r() * 0.65), 0.45 + r() * 0.5, holes, d);
        }
        u += w * (0.6 + r() * 0.7);
      }
      // A broad run or two under the coping.
      const runs = Math.max(1, Math.round((L / 7) * k));
      for (let i = 0; i < runs; i++) {
        const w = 1.6 + r() * 2.6, u = w / 2 + r() * Math.max(0, L - w);
        this.hang(f, "runs", u, Math.min(w, L), top - 0.02, 0.9 + r() * 1.8, 0.5 + r() * 0.4, holes, d + 0.002);
      }
    }
    if (g.corners ?? true) {
      for (const [u, flip] of [[0.3, false], [L - 0.3, true]] as const) this.hang(f, "corner", u, 0.6, top - 0.02, top, 0.55 + r() * 0.3, holes, d + 0.012, 0xffffff, flip);
    }
    if (g.base ?? true) {
      // Damp / splash band along the foot, broken around doors and shopfronts.
      for (let u = 0; u < L - 0.2; ) {
        const w = Math.min(L - u, 1.8 + r() * 2.4);
        let h = (wet ? 0.8 : 0.5) + r() * (wet ? 0.9 : 0.5);
        // Stop under the lowest sill above this stretch; skip doors / shopfronts.
        const u0 = Math.max(0, u - 0.15), u1 = Math.min(L, u + w + 0.15);
        for (const hole of holes) if (hole.u1 > u0 && hole.u0 < u1) h = Math.min(h, hole.y0 - 0.03);
        if (h > 0.3 && r() < 0.6 + k * 0.4) {
          this.wall(f, "damp", (u0 + u1) / 2, h / 2 - 0.02, u1 - u0, h, wet ? 0.75 : 0.45 + r() * 0.2, d + 0.014, r() < 0.5, wet ? 0xffffff : 0xc8b8a0);
        }
        u += w;
      }
    }
    // Smudges break up big clean areas.
    const smudges = Math.round((L * top) / 18 * k * (0.5 + r()));
    for (let i = 0; i < smudges; i++) {
      const w = 1.2 + r() * 2.2, h = w * (0.7 + r() * 0.5);
      const u = w / 2 + r() * Math.max(0, L - w), y = h / 2 + 0.2 + r() * Math.max(0, top - h - 0.4);
      if (GrimeLayer.clear(holes, u - w / 2, u + w / 2, y - h / 2, y + h / 2)) this.wall(f, "smudge", u, y, w, h, 0.5 + r() * 0.5, d - 0.004);
    }
    // Cracks off the upper corners of some openings (lintel stress).
    for (const o of g.cracks ?? []) {
      if (r() > 0.22 * k) continue;
      const right = r() < 0.5;
      const s = 0.6 + r() * 0.6;
      const oy = o.y + o.h + (o.arch ? o.w / 2 : 0);
      const cu = o.u + (right ? 1 : -1) * (o.w / 2 + s / 2 - 0.04);
      if (cu - s / 2 < 0.1 || cu + s / 2 > L - 0.1 || oy + s > top - 0.1) continue;
      const others = holes.filter((h) => !(Math.abs((h.u0 + h.u1) / 2 - o.u) < 0.01 && Math.abs(h.y0 - (o.y - 0.05)) < 0.01));
      if (!GrimeLayer.clear(others, cu - s / 2, cu + s / 2, oy - 0.04, oy + s)) continue;
      this.wall(f, "cracks", cu, oy - 0.04 + s / 2, s, s, 0.8, d + 0.006, !right);
    }
  }

  /** Rust run hanging under a metal fixing at (u, y). */
  rust(f: Frame, u: number, y: number, w: number, len: number, holes: Rect[] = [], alpha = 0.8) {
    this.hang(f, "rust", u, w, y, len, alpha, holes, 0.03);
  }

  /** The finished layer as a world extra (one mesh, one draw), or null if empty. */
  extra(): WorldExtra | null {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 4));
    geo.computeBoundingSphere();
    const canvas = grimeAtlas();
    let tex: THREE.Texture | null = null;
    if (canvas) {
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 4;
    }
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      // No atlas (tests / no DOM): draw nothing visible.
      opacity: tex ? 1 : 0,
    });
    mat.name = "ih-grime";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "grime";
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    const tris = this.pos.length / 9;
    this.pos.length = this.uv.length = this.nor.length = this.col.length = 0;
    return {
      object: mesh,
      triangles: tris,
      dispose() {
        geo.dispose();
        mat.dispose();
        tex?.dispose();
      },
    };
  }
}

const layers = new WeakMap<MeshBuilder, GrimeLayer>();

/** Starts a grime layer for everything drawn into `B` (one per map). */
export function attachGrime(B: MeshBuilder, quality: QualityName, climate: GrimeClimate = "dry") {
  const l = new GrimeLayer(climate, quality);
  layers.set(B, l);
  return l;
}

/** The grime layer attached to `B`, if its dressing asked for one. */
export function grimeOf(B: MeshBuilder) {
  return layers.get(B);
}

/** Finishes the layer attached to `B` and returns it as an extra (and detaches it). */
export function finishGrime(B: MeshBuilder): WorldExtra[] {
  const l = layers.get(B);
  layers.delete(B);
  const x = l?.extra();
  return x ? [x] : [];
}

const MASONRY = new Set(["plaster", "plaster_damaged", "concrete", "concrete_dirty", "brick"]);

/**
 * Weathers the plain masonry map boxes (walls, shacks, bunkers): streaks,
 * corner grime and a base band on each face. Visual only; boxes are not touched.
 */
export function grimeBoxes(layer: GrimeLayer, boxes: MapBox[], seed = 1, filter: (b: MapBox) => boolean = () => true) {
  let i = 0;
  for (const b of boxes) {
    if (b.style && b.style !== "plain") continue;
    if (b.emissive || b.h < 1.4) continue;
    const mat = b.mat ?? (b.surface === "concrete" || !b.surface ? "concrete" : b.surface);
    if (!MASONRY.has(mat) || !filter(b)) continue;
    const y = b.y ?? 0;
    const faces = [
      new Frame(new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(1, 0, 0)),
      new Frame(new THREE.Vector3(b.x + b.w / 2, y, b.z - b.d / 2), new THREE.Vector3(0, 0, 1)),
      new Frame(new THREE.Vector3(b.x + b.w / 2, y, b.z + b.d / 2), new THREE.Vector3(-1, 0, 0)),
      new Frame(new THREE.Vector3(b.x - b.w / 2, y, b.z + b.d / 2), new THREE.Vector3(0, 0, -1)),
    ];
    faces.forEach((f, s) => {
      const L = s % 2 === 0 ? b.w : b.d;
      if (L < 0.9) return;
      layer.facade(f, { length: L, top: b.h, seed: seed * 977 + i * 13 + s, base: y < 0.3, corners: L > 2, d: 0.016 });
    });
    i++;
  }
}
