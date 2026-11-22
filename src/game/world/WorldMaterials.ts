import * as THREE from "three";
import type { QualityPreset } from "../config";
import { EXTRA_MATERIAL_TEXTURES, type ExtraMaterialName, type MaterialName } from "../assets/manifest";
import { loadCompressedTextureSet, loadTextureSet } from "../assets/AssetLoader";
import type { MaterialLibrary } from "../render/Materials";

/** Any material the world builders can bucket geometry into. */
export type WorldMat = MaterialName | ExtraMaterialName;

type ExtraDef = {
  /** Metres per texture repeat (geometry UVs are metres; "keep" UVs are pre-scaled). */
  tile: number;
  roughness: number;
  metalness: number;
  normalScale: number;
  /** Colour shown until the photo maps stream in. */
  placeholder: number;
  /** Borrow the shared world grime shader from this library material. */
  grimeFrom?: MaterialName;
  /** Linear colour gain applied once the photo albedo arrives (e.g. sun-bleach a dark scan). */
  gain?: [number, number, number];
};

const DEFS: Record<ExtraMaterialName, ExtraDef> = {
  plaster: { tile: 3.2, roughness: 1, metalness: 0, normalScale: 1, placeholder: 0xb8ad98, grimeFrom: "concrete" },
  plaster_damaged: { tile: 2.6, roughness: 1, metalness: 0, normalScale: 1.2, placeholder: 0xa48a74, grimeFrom: "concrete" },
  // The scan is fresh black tarmac; desert roads are sun-bleached, dusty grey.
  asphalt: { tile: 4, roughness: 1, metalness: 0, normalScale: 0.9, placeholder: 0x7c7a74, gain: [2.5, 2.6, 2.95] },
  rubble: { tile: 2.4, roughness: 1, metalness: 0, normalScale: 1.3, placeholder: 0x8a8274, grimeFrom: "concrete_dirty" },
  concrete_broken: { tile: 3.5, roughness: 1, metalness: 0, normalScale: 1, placeholder: 0x7e7a72 },
  corrugated_rust: { tile: 2.2, roughness: 1, metalness: 0.35, normalScale: 1.3, placeholder: 0x7a5a42, grimeFrom: "metal_corrugated" },
  cloth: { tile: 1, roughness: 0.95, metalness: 0, normalScale: 0, placeholder: 0xd0c8b8 },
  chainlink: { tile: 1, roughness: 0.6, metalness: 0.6, normalScale: 0, placeholder: 0x9a9a96 },
  decal: { tile: 1, roughness: 1, metalness: 0, normalScale: 0, placeholder: 0x202020 },
  frond: { tile: 1, roughness: 0.9, metalness: 0, normalScale: 0, placeholder: 0x6a7040 },
  glow: { tile: 1, roughness: 0.5, metalness: 0, normalScale: 0, placeholder: 0xffe2b0 },
  signs: { tile: 1, roughness: 0.55, metalness: 0.2, normalScale: 0, placeholder: 0x406050 },
};

/**
 * Road-sign atlas (1024 × 512): overhead gantry board on top, then a
 * roundabout disc, a roundabout-ahead warning triangle, a keep-right
 * arrow disc and a chevron bend board. All names are invented.
 */
export const SIGN = {
  gantry: [0, 0, 1024, 300],
  roundabout: [0, 300, 212, 512],
  warning: [212, 300, 424, 512],
  arrow: [424, 300, 636, 512],
  chevron: [636, 300, 1024, 512],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type SignKind = keyof typeof SIGN;
/** UV rect [u0, v0, u1, v1] of a sign in the atlas. */
export function signRect(kind: SignKind): [number, number, number, number] {
  const [x0, y0, x1, y1] = SIGN[kind];
  return [(x0 + 2) / 1024, 1 - (y1 - 2) / 512, (x1 - 2) / 1024, 1 - (y0 + 2) / 512];
}

function makeSigns(): HTMLCanvasElement {
  const [c, g] = canvas(1024, 512);
  const r = seeded(77);
  g.fillStyle = "#6a6a64";
  g.fillRect(0, 0, 1024, 512);
  // --- Gantry board: green, white border, three destinations with arrows.
  g.fillStyle = "#1d5a3c";
  g.fillRect(4, 4, 1016, 292);
  g.strokeStyle = "#e8eee8";
  g.lineWidth = 8;
  g.strokeRect(16, 16, 992, 268);
  g.fillStyle = "#eef2ee";
  g.font = "bold 66px Arial, Helvetica, sans-serif";
  g.textBaseline = "middle";
  const line = (y: number, arrow: string, name: string, km: string) => {
    g.textAlign = "left";
    g.fillText(arrow, 44, y);
    g.fillText(name, 130, y);
    g.textAlign = "right";
    g.fillText(km, 980, y);
  };
  line(70, "\u2191", "MARROW JCT", "9");
  line(150, "\u2190", "DUSTFALL", "4");
  line(230, "\u2192", "KESTREL RIDGE", "27");
  // --- Roundabout disc: blue with three chasing arrows.
  const disc = (cx: number, cy: number, rad: number) => {
    g.fillStyle = "#1f4f9a";
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#e8ecf2";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, rad - 6, 0, Math.PI * 2);
    g.stroke();
  };
  const ringArrows = (cx: number, cy: number, rad: number, col: string) => {
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = rad * 0.2;
    for (let k = 0; k < 3; k++) {
      const a0 = (k * Math.PI * 2) / 3 - Math.PI / 2, a1 = a0 + 1.5;
      g.beginPath();
      g.arc(cx, cy, rad * 0.55, a0, a1);
      g.stroke();
      const tx = cx + Math.cos(a1) * rad * 0.55, ty = cy + Math.sin(a1) * rad * 0.55;
      const dx = -Math.sin(a1), dy = Math.cos(a1);
      g.beginPath();
      g.moveTo(tx + dx * rad * 0.28, ty + dy * rad * 0.28);
      g.lineTo(tx + Math.cos(a1) * rad * 0.22, ty + Math.sin(a1) * rad * 0.22);
      g.lineTo(tx - Math.cos(a1) * rad * 0.22, ty - Math.sin(a1) * rad * 0.22);
      g.fill();
    }
  };
  g.clearRect(0, 300, 212, 212);
  disc(106, 406, 100);
  ringArrows(106, 406, 100, "#eef2f6");
  // --- Warning triangle (roundabout ahead).
  g.clearRect(212, 300, 212, 212);
  g.fillStyle = "#c42a22";
  g.beginPath();
  g.moveTo(318, 308);
  g.lineTo(416, 500);
  g.lineTo(220, 500);
  g.closePath();
  g.fill();
  g.fillStyle = "#f2efe6";
  g.beginPath();
  g.moveTo(318, 346);
  g.lineTo(386, 480);
  g.lineTo(250, 480);
  g.closePath();
  g.fill();
  ringArrows(318, 438, 56, "#1c1c1c");
  // --- Keep-right arrow disc.
  g.clearRect(424, 300, 212, 212);
  disc(530, 406, 100);
  g.save();
  g.translate(530, 406);
  g.rotate(Math.PI / 4);
  g.fillStyle = "#eef2f6";
  g.fillRect(-14, -10, 28, 70);
  g.beginPath();
  g.moveTo(-44, -6);
  g.lineTo(0, -60);
  g.lineTo(44, -6);
  g.fill();
  g.restore();
  // --- Chevron bend board.
  g.fillStyle = "#16161a";
  g.fillRect(640, 304, 380, 204);
  g.fillStyle = "#e8c22a";
  for (let k = 0; k < 4; k++) {
    const x0 = 690 + k * 86;
    g.beginPath();
    g.moveTo(x0 + 52, 324);
    g.lineTo(x0, 406);
    g.lineTo(x0 + 52, 488);
    g.lineTo(x0 + 82, 488);
    g.lineTo(x0 + 30, 406);
    g.lineTo(x0 + 82, 324);
    g.closePath();
    g.fill();
  }
  // Weathering: dust from the top, rust runs, peeled spots and bullet holes.
  const dust = g.createLinearGradient(0, 0, 0, 512);
  dust.addColorStop(0, "rgba(190,170,130,0.28)");
  dust.addColorStop(0.5, "rgba(190,170,130,0.08)");
  dust.addColorStop(1, "rgba(190,170,130,0.22)");
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = dust;
  g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 26; i++) {
    const x = r() * 1024, y = r() * 512;
    const run = g.createLinearGradient(x, y, x, y + 40 + r() * 80);
    run.addColorStop(0, "rgba(110,60,30,0.5)");
    run.addColorStop(1, "rgba(110,60,30,0)");
    g.fillStyle = run;
    g.fillRect(x, y, 3 + r() * 4, 120);
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * 1024, y = r() * 512, rad = 2 + r() * 4;
    g.fillStyle = "rgba(200,200,190,0.9)";
    g.beginPath();
    g.arc(x, y, rad + 2.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(15,15,15,1)";
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  return c;
}

/** Ground decals overlay the terrain; wall decals sit 1-2 cm proud. Both use the atlas below. */
export const DECAL = {
  burn: 0,
  oil: 1,
  puddle: 2,
  tracks: 3,
  leak: 4,
  baseDirt: 5,
  cracks: 6,
  paper: 7,
  pocks: 8,
  soot: 9,
  sand: 10,
  specks: 11,
} as const;
export type DecalKind = keyof typeof DECAL;
/** Atlas is 4×4 cells; returns [u0, v0, u1, v1] of a cell (with a texel of padding). */
export function decalRect(kind: DecalKind): [number, number, number, number] {
  const i = DECAL[kind];
  const cx = i % 4, cy = Math.floor(i / 4);
  const p = 2 / 1024;
  return [cx / 4 + p, 1 - (cy + 1) / 4 + p, (cx + 1) / 4 - p, 1 - cy / 4 - p];
}

/** Awning cloth schemes: each is a horizontal band of the cloth texture. */
export const CLOTH_SCHEMES = 4;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grimy decal atlas: colour+alpha, and a roughness atlas (puddles/oil are glossy). */
function makeDecalAtlas(): { color: HTMLCanvasElement; rough: HTMLCanvasElement } {
  const S = 1024, C = 256;
  const [col, g] = canvas(S, S);
  const [rgh, gr] = canvas(S, S);
  gr.fillStyle = "#fff";
  gr.fillRect(0, 0, S, S);
  const r = seeded(77);
  const cell = (i: number) => [(i % 4) * C, Math.floor(i / 4) * C] as const;
  const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, n = 18) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = r() * rad * 0.6;
      const rr = rad * (0.25 + r() * 0.45);
      const gg = ctx.createRadialGradient(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, x + Math.cos(a) * d, y + Math.sin(a) * d, rr);
      gg.addColorStop(0, color);
      gg.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const specks = (ctx: CanvasRenderingContext2D, x0: number, y0: number, n: number, color: () => string, size: number, inR = C / 2) => {
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * inR * 0.9;
      ctx.fillStyle = color();
      const s = size * (0.4 + r());
      ctx.fillRect(x0 + C / 2 + Math.cos(a) * d, y0 + C / 2 + Math.sin(a) * d, s, s * (0.6 + r() * 0.8));
    }
  };
  // 0 burn: charred core, sooty halo, ash flecks.
  {
    const [x, y] = cell(0);
    blob(g, x + C / 2, y + C / 2, 110, "rgba(30,26,22,0.55)", 22);
    blob(g, x + C / 2, y + C / 2, 70, "rgba(8,7,6,0.85)", 16);
    specks(g, x, y, 260, () => (r() < 0.5 ? "rgba(120,115,105,0.7)" : "rgba(10,9,8,0.8)"), 2.4, 100);
  }
  // 1 oil stain.
  {
    const [x, y] = cell(1);
    blob(g, x + C / 2, y + C / 2, 90, "rgba(14,12,10,0.7)", 14);
    blob(gr, x + C / 2, y + C / 2, 80, "rgba(70,70,70,0.9)", 12);
  }
  // 2 puddle: dark wet core, muddy rim; very glossy.
  {
    const [x, y] = cell(2);
    blob(g, x + C / 2, y + C / 2, 115, "rgba(58,50,40,0.55)", 20);
    blob(g, x + C / 2, y + C / 2, 85, "rgba(34,32,30,0.82)", 16);
    blob(gr, x + C / 2, y + C / 2, 88, "rgba(10,10,10,1)", 16);
  }
  // 3 tyre tracks: two tread bands along v (tileable vertically).
  {
    const [x, y] = cell(3);
    for (const bx of [x + 40, x + 156]) {
      for (let yy = 0; yy < C; yy += 8) {
        g.fillStyle = `rgba(40,34,26,${0.35 + r() * 0.2})`;
        g.fillRect(bx, y + yy, 60, 5);
        g.fillStyle = "rgba(40,34,26,0.25)";
        g.fillRect(bx + 4, y + yy + 5, 52, 3);
      }
    }
  }
  // 4 leak streak: from the top, fading down, a few drips.
  {
    const [x, y] = cell(4);
    for (let k = 0; k < 26; k++) {
      const sx = x + C / 2 + (r() - 0.5) * 120 * (1 - k / 40);
      const len = C * (0.35 + r() * 0.65);
      const gg = g.createLinearGradient(0, y, 0, y + len);
      const a = 0.12 + r() * 0.2;
      gg.addColorStop(0, `rgba(36,30,22,${a})`);
      gg.addColorStop(1, "rgba(36,30,22,0)");
      g.fillStyle = gg;
      g.fillRect(sx, y, 3 + r() * 10, len);
    }
  }
  // 5 base dirt: splash band from the bottom up, ragged.
  {
    const [x, y] = cell(5);
    for (let k = 0; k < 60; k++) {
      const sx = x + r() * C, h = C * (0.3 + r() * 0.7);
      const gg = g.createLinearGradient(0, y + C, 0, y + C - h);
      gg.addColorStop(0, `rgba(62,52,38,${0.25 + r() * 0.2})`);
      gg.addColorStop(1, "rgba(62,52,38,0)");
      g.fillStyle = gg;
      g.fillRect(sx, y + C - h, 6 + r() * 14, h);
    }
  }
  // 6 cracks: branching dark lines.
  {
    const [x, y] = cell(6);
    g.strokeStyle = "rgba(20,18,15,0.75)";
    g.lineCap = "round";
    const crack = (px: number, py: number, ang: number, len: number, w: number, depth: number) => {
      let cx = px, cy = py;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx, cy);
      const steps = Math.max(3, Math.round(len / 10));
      for (let s = 0; s < steps; s++) {
        ang += (r() - 0.5) * 0.9;
        cx += Math.cos(ang) * (len / steps);
        cy += Math.sin(ang) * (len / steps);
        g.lineTo(Math.min(x + C - 2, Math.max(x + 2, cx)), Math.min(y + C - 2, Math.max(y + 2, cy)));
        if (depth > 0 && r() < 0.25) crack(cx, cy, ang + (r() - 0.5) * 2, len * 0.45, w * 0.6, depth - 1);
      }
      g.stroke();
    };
    for (let k = 0; k < 4; k++) crack(x + C / 2, y + C / 2, r() * 6.28, 100, 2.4, 2);
  }
  // 7 paper sheet: off-white page, faint text lines, creased.
  {
    const [x, y] = cell(7);
    g.fillStyle = "rgba(214,208,192,1)";
    g.fillRect(x + 48, y + 28, 160, 200);
    g.fillStyle = "rgba(60,58,52,0.35)";
    for (let l = 0; l < 14; l++) g.fillRect(x + 62, y + 48 + l * 12, 80 + r() * 50, 3);
    g.fillStyle = "rgba(90,80,60,0.25)";
    g.fillRect(x + 48, y + 120, 160, 3);
    blob(g, x + 150, y + 190, 40, "rgba(110,95,70,0.25)", 6);
  }
  // 8 bullet pocks: chipped plaster craters.
  {
    const [x, y] = cell(8);
    for (let k = 0; k < 22; k++) {
      const px = x + 20 + r() * (C - 40), py = y + 20 + r() * (C - 40), rad = 4 + r() * 9;
      const gg = g.createRadialGradient(px, py, 0, px, py, rad * 1.8);
      gg.addColorStop(0, "rgba(28,24,20,0.9)");
      gg.addColorStop(0.4, "rgba(120,104,84,0.6)");
      gg.addColorStop(1, "rgba(160,145,120,0)");
      g.fillStyle = gg;
      g.beginPath();
      g.arc(px, py, rad * 1.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 9 soot plume: rises from the bottom (scorch above a window/hole).
  {
    const [x, y] = cell(9);
    for (let k = 0; k < 30; k++) {
      const t = k / 30;
      blob(g, x + C / 2 + (r() - 0.5) * 60 * t, y + C - 30 - t * 190, 40 + t * 50, `rgba(12,10,9,${0.28 * (1 - t * 0.6)})`, 2);
    }
  }
  // 10 sand drift: soft pale blob.
  {
    const [x, y] = cell(10);
    blob(g, x + C / 2, y + C / 2, 115, "rgba(178,160,128,0.4)", 24);
  }
  // 11 debris specks: grit, chips and small stones.
  {
    const [x, y] = cell(11);
    specks(g, x, y, 700, () => {
      const v = 60 + r() * 120;
      return `rgba(${v},${v * 0.93},${v * 0.82},${0.6 + r() * 0.4})`;
    }, 3.2, 120);
  }
  return { color: col, rough: rgh };
}

/** Striped awning cloth: 4 colour schemes stacked in v, stripes along u. */
function makeCloth(): HTMLCanvasElement {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  const r = seeded(12);
  const schemes = [
    ["#b8473a", "#e2d9c6"],
    ["#3e6d55", "#ddd6c2"],
    ["#36597e", "#e0d8c4"],
    ["#c98a3a", "#e6dcc4"],
  ];
  const bh = H / 4;
  schemes.forEach(([a, b], i) => {
    const sw = W / 8;
    for (let s = 0; s < 8; s++) {
      g.fillStyle = s % 2 ? b : a;
      g.fillRect(s * sw, i * bh, sw, bh);
    }
    // Sun-bleach and grime: lighter top, dirty sag line, stains.
    const gg = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
    gg.addColorStop(0, "rgba(255,248,230,0.18)");
    gg.addColorStop(0.7, "rgba(0,0,0,0)");
    gg.addColorStop(1, "rgba(50,40,28,0.35)");
    g.fillStyle = gg;
    g.fillRect(0, i * bh, W, bh);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(60,48,32,${r() * 0.12})`;
      g.fillRect(r() * W, i * bh + r() * bh, 4 + r() * 30, 2 + r() * 14);
    }
  });
  return c;
}

/** Chain-link diamond mesh (alpha-tested), one repeat ≈ 0.25 m. */
function makeChainlink(): HTMLCanvasElement {
  const S = 64;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "rgba(200,200,196,1)";
  g.lineWidth = 3;
  for (const o of [-S, 0, S]) {
    g.beginPath();
    g.moveTo(o, 0);
    g.lineTo(o + S, S);
    g.moveTo(o + S, 0);
    g.lineTo(o, S);
    g.stroke();
  }
  return c;
}

/** Palm frond: central rib with drooping leaflets either side (alpha-tested). */
function makeFrond(): HTMLCanvasElement {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const r = seeded(5);
  g.clearRect(0, 0, W, H);
  // Dense, fairly wide leaflets so the alpha-tested card keeps its coverage
  // when mipmapped at distance (thin lines vanish and leave a bare rib).
  for (let y = 6; y < H - 6; y += 3.2) {
    const t = y / H;
    const len = (W / 2 - 3) * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) * (0.8 + r() * 0.2);
    const shade = 92 + r() * 45;
    g.strokeStyle = `rgb(${shade * 0.92},${shade * 1.06},${shade * 0.62})`;
    g.lineWidth = 5;
    for (const s of [-1, 1]) {
      if (r() < 0.08) continue; // torn leaflet
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * len * 0.6, y + 6, W / 2 + s * len, y + 18 + r() * 10);
      g.stroke();
    }
  }
  g.strokeStyle = "rgb(120,110,70)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2, 0);
  g.lineTo(W / 2, H);
  g.stroke();
  return c;
}

function solid(hex: number, srgb = true) {
  const t = new THREE.DataTexture(new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Extra world materials on top of the shared MaterialLibrary: photo-textured
 * plaster / asphalt / rubble / rusty sheet (streamed like the library's,
 * same shader defines before and after so nothing recompiles) and a few
 * canvas-generated ones (decal atlas, awning cloth, chain-link, palm
 * fronds). Library names are passed straight through, so geometry builders
 * can bucket into any of them.
 */
export class WorldMaterials {
  private readonly mats = new Map<ExtraMaterialName, THREE.MeshStandardMaterial>();
  private readonly owned: { dispose(): void }[] = [];
  private disposed = false;

  constructor(
    readonly lib: MaterialLibrary,
    private readonly quality: QualityPreset,
  ) {}

  get(name: WorldMat): THREE.Material {
    if (!(name in DEFS)) return this.lib.get(name as MaterialName);
    const key = name as ExtraMaterialName;
    let m = this.mats.get(key);
    if (!m) {
      m = this.create(key);
      m.name = `ih-${key}`;
      this.mats.set(key, m);
      this.owned.push(m);
    }
    return m;
  }

  private tex(src: TexImageSource | HTMLCanvasElement, srgb: boolean, repeat = 1) {
    const t = new THREE.Texture(src as HTMLCanvasElement);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.quality.anisotropy;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    this.owned.push(t);
    return t;
  }

  private create(name: ExtraMaterialName): THREE.MeshStandardMaterial {
    const def = DEFS[name];
    const base = { vertexColors: true, roughness: def.roughness, metalness: def.metalness };
    switch (name) {
      case "decal": {
        const atlas = makeDecalAtlas();
        const m = new THREE.MeshStandardMaterial({
          ...base,
          map: this.tex(atlas.color, true),
          roughnessMap: this.tex(atlas.rough, false),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -4,
        });
        for (const t of [m.map!, m.roughnessMap!]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        return m;
      }
      case "cloth":
        return new THREE.MeshStandardMaterial({ ...base, map: this.tex(makeCloth(), true), side: THREE.DoubleSide });
      case "chainlink":
        return new THREE.MeshStandardMaterial({ ...base, map: this.tex(makeChainlink(), true), alphaTest: 0.5, side: THREE.DoubleSide });
      case "frond":
        return new THREE.MeshStandardMaterial({ ...base, map: this.tex(makeFrond(), true), alphaTest: 0.45, side: THREE.DoubleSide });
      case "signs": {
        const m = new THREE.MeshStandardMaterial({ ...base, map: this.tex(makeSigns(), true), alphaTest: 0.5 });
        m.map!.wrapS = m.map!.wrapT = THREE.ClampToEdgeWrapping;
        return m;
      }
      case "glow":
        // Lamp bulbs and lit panels: unlit warm emissive, picked up by bloom.
        return new THREE.MeshStandardMaterial({ ...base, color: 0x000000, emissive: 0xffe2b0, emissiveIntensity: 3.2 });
      default:
        return this.photo(name, def);
    }
  }

  /** Photo-textured PBR material: 1×1 placeholders now, real maps when loaded. */
  private photo(name: ExtraMaterialName, def: ExtraDef) {
    const setId = EXTRA_MATERIAL_TEXTURES[name];
    const rep = 1 / def.tile;
    const place = [solid(def.placeholder), solid(0x8080ff, false), solid(0xffffff, false), solid(0xffffff, false)];
    for (const t of place) {
      t.repeat.set(rep, rep);
      this.owned.push(t);
    }
    const m = new THREE.MeshStandardMaterial({
      ...base(def),
      map: place[0],
      normalMap: place[1],
      roughnessMap: place[2],
      aoMap: place[3],
      aoMapIntensity: 0.9,
      normalScale: new THREE.Vector2(def.normalScale, def.normalScale),
    });
    if (def.grimeFrom) {
      const src = this.lib.get(def.grimeFrom);
      if (src.onBeforeCompile) {
        m.onBeforeCompile = src.onBeforeCompile;
        m.customProgramCacheKey = src.customProgramCacheKey;
      }
    }
    if (setId && typeof window !== "undefined") {
      const max = this.quality.maxTextureSize;
      // GPU-compressed copies when the device supports them, else the JPEGs.
      void loadCompressedTextureSet(setId, max).then(async (ktx) => {
        if (this.disposed) return;
        if (ktx?.albedo) {
          const ck = (c: THREE.CompressedTexture | undefined, srgb: boolean, fallback: THREE.Texture) => {
            if (!c) return fallback;
            // Clone the cached template: clones share one GPU upload.
            const t = c.clone();
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = this.quality.anisotropy;
            t.repeat.set(rep, rep);
            t.needsUpdate = true;
            this.owned.push(t);
            return t;
          };
          m.map = ck(ktx.albedo, true, place[0]);
          m.normalMap = ck(ktx.normal, false, place[1]);
          m.roughnessMap = ck(ktx.roughness, false, place[2]);
          m.aoMap = ck(ktx.ao, false, place[3]);
          if (def.gain) m.color.setRGB(...def.gain);
          return;
        }
        const imgs = await loadTextureSet(setId, max);
        if (this.disposed || !imgs?.albedo) return;
        const mk = (img: TexImageSource | undefined, srgb: boolean, fallback: THREE.Texture) => {
          if (!img) return fallback;
          const t = this.tex(img, srgb, rep);
          return t;
        };
        m.map = mk(imgs.albedo, true, place[0]);
        m.normalMap = mk(imgs.normal, false, place[1]);
        m.roughnessMap = mk(imgs.roughness, false, place[2]);
        m.aoMap = mk(imgs.ao, false, place[3]);
        if (def.gain) m.color.setRGB(...def.gain);
      });
    }
    return m;
  }

  dispose() {
    this.disposed = true;
    for (const o of this.owned) o.dispose();
    this.mats.clear();
  }
}

function base(def: ExtraDef) {
  return { vertexColors: true, roughness: def.roughness, metalness: def.metalness };
}
