import * as THREE from "three";
import type { MeshBuilder } from "../MeshBuilder";
import type { MapBox } from "../MapLoader";
import { decal, pendantLamp } from "../architecture/kit";
import {
  BRIDGE, CATWALK, CONVEYOR, FLIGHT1, FLIGHT2, GALLERY2, HEAD, HOPPER, TAIL, TOWER, conveyorY,
} from "../maps/saltpanGantry";
import { beam, cladWall, faceDecal, handrail, hColumn, hopper, ladder, PAINT, put, tube, xBay, type Rnd, type V3 } from "./saltpanGantryKit";
import type { DressingKit, WorldExtra } from "./common";

const T = TOWER;
const COL = 0x8a5c40; // column paint: rust-red primer gone brown
const GIRDER = 0x7e5a44;
const BRACE = 0x8a6448;

/** Steel deck: plate on the collider top, edge girders and joists below. */
function deck(B: MeshBuilder, x0: number, x1: number, z0: number, z1: number, top: number, joists = true) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  B.box("metal_dark", cx, top - 0.03, cz, w + 0.02, 0.06, d + 0.02, PAINT.grating);
  B.box("metal_painted", cx, top - 0.2, cz, w, 0.3, d, GIRDER); // collider-sized slab
  for (const s of [-1, 1]) {
    B.box("metal_painted", cx, top - 0.42, cz + s * (d / 2 - 0.1), w, 0.5, 0.2, GIRDER);
    B.box("metal_painted", cx + s * (w / 2 - 0.1), top - 0.42, cz, 0.2, 0.5, d - 0.4, GIRDER);
  }
  if (!joists) return;
  for (let x = x0 + 1.25; x < x1 - 0.4; x += 1.25) B.box("metal_painted", x, top - 0.5, cz, 0.12, 0.34, d - 0.4, GIRDER);
}

/** Rails and toe boards drawn over the hip-height rail colliders. */
function rails(B: MeshBuilder, boxes: MapBox[]) {
  for (const b of boxes) {
    if (b.tag !== "rail") continue;
    const top = (b.y ?? 0) - 0.85;
    const alongX = b.w > b.d;
    const a: V3 = alongX ? [b.x - b.w / 2, top, b.z] : [b.x, top, b.z - b.d / 2];
    const c: V3 = alongX ? [b.x + b.w / 2, top, b.z] : [b.x, top, b.z + b.d / 2];
    handrail(B, a, c);
    B.box("metal_painted", b.x, top + 0.075, b.z, alongX ? b.w : 0.02, 0.15, alongX ? 0.02 : b.d, PAINT.rail);
  }
}

/**
 * A covered conveyor gallery between two points: truss sides, corrugated
 * roof, clad upper sides with missing sheets, the belt on idlers with its
 * load, a walkway and a cable tray. `side` cladding is skipped when `open`.
 */
function gallery(B: MeshBuilder, r: Rnd, a: V3, b: V3, W: number, H: number, opts: { lowClad?: boolean; salt?: boolean } = {}) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const len = A.distanceTo(Bv);
  const u = Bv.clone().sub(A).normalize();
  const s = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0)).normalize();
  const n = new THREE.Vector3().crossVectors(s, u).normalize();
  const P = (t: number, ns: number, nn: number): V3 => {
    const p = A.clone().addScaledVector(u, t).addScaledVector(s, ns).addScaledVector(n, nn);
    return [p.x, p.y, p.z];
  };
  const hw = W / 2, hh = H / 2;
  // Chords, floor, walkway grating.
  for (const sd of [-1, 1]) {
    beam(B, P(0, sd * hw, -hh), P(len, sd * hw, -hh), 0.14, 0.26, "metal_painted", GIRDER);
    beam(B, P(0, sd * hw, hh), P(len, sd * hw, hh), 0.12, 0.18, "metal_painted", GIRDER);
  }
  beam(B, P(0, 0, -hh + 0.04), P(len, 0, -hh + 0.04), W - 0.1, 0.06, "metal_dark", PAINT.grating);
  // Posts + diagonals.
  const bays = Math.max(2, Math.round(len / 2.6));
  const step = len / bays;
  for (let i = 0; i <= bays; i++) {
    const t = i * step;
    for (const sd of [-1, 1]) {
      beam(B, P(t, sd * hw, -hh), P(t, sd * hw, hh), 0.1, 0.12, "metal_painted", GIRDER);
      if (i < bays) beam(B, P(t, sd * hw, i % 2 ? hh : -hh), P(t + step, sd * hw, i % 2 ? -hh : hh), 0.06, 0.08, "metal_painted", BRACE);
    }
    beam(B, P(t, -hw, hh), P(t, hw, hh), 0.1, 0.12, "metal_painted", GIRDER);
    beam(B, P(t, -hw, -hh), P(t, hw, -hh), 0.12, 0.16, "metal_painted", GIRDER);
  }
  // Roof sheets (a few missing), side cladding on the upper half.
  for (let t = 0; t < len - 0.1; t += 1.8) {
    const t1 = Math.min(len, t + 1.82);
    if (r() < 0.06) continue;
    beam(B, P(t, 0, hh + 0.12), P(t1, 0, hh + 0.12), W + 0.4, 0.04, r() < 0.8 ? "corrugated_rust" : "metal_corrugated", r() < 0.5 ? 0xa06c4c : 0xb08a6a);
  }
  for (const sd of [-1, 1]) {
    for (let t = 0; t < len - 0.1; t += 0.95) {
      const t1 = Math.min(len, t + 0.97);
      if (r() < 0.1) continue;
      const lo = opts.lowClad ? -hh + 0.1 : -0.1;
      const tint = [0xa8704c, 0x9a6a4e, 0xb88a64, 0x8f7c6a][Math.floor(r() * 4)];
      const mid = (lo + hh) / 2;
      beam(B, P(t, sd * (hw + 0.05), mid), P(t1, sd * (hw + 0.05), mid), 0.03, hh - lo, r() < 0.75 ? "corrugated_rust" : "metal_corrugated", tint);
    }
    // Rust runs down the cladding.
    for (let k = 0; k < Math.round(len / 6); k++) {
      const t = 1 + r() * (len - 2);
      const c = new THREE.Vector3(...P(t, sd * (hw + 0.08), hh * 0.35));
      decal(B, "leak", c, u.clone().multiplyScalar(sd), n, 0.7 + r() * 0.6, hh * 1.2, 0xb06a3a);
    }
  }
  // Belt on idlers, with a stripe of load; cable tray under one top chord.
  for (let t = 0.8; t < len - 0.5; t += 1.5) {
    beam(B, P(t, -hw * 0.35, -hh + 0.32), P(t, hw * 0.35, -hh + 0.32), 0.08, 0.08, "metal_dark", PAINT.dark);
    for (const sd of [-1, 1]) beam(B, P(t, sd * hw * 0.32, -hh + 0.06), P(t, sd * hw * 0.32, -hh + 0.32), 0.05, 0.05, "metal_dark", PAINT.dark);
  }
  beam(B, P(0.3, 0, -hh + 0.39), P(len - 0.3, 0, -hh + 0.39), W * 0.42, 0.03, "plain", 0x2a2826);
  if (opts.salt) beam(B, P(0.3, 0, -hh + 0.43), P(len - 0.3, 0, -hh + 0.43), W * 0.26, 0.05, "gravel", 0xf0ece4);
  beam(B, P(0, hw - 0.25, hh - 0.25), P(len, hw - 0.25, hh - 0.25), 0.35, 0.06, "metal_dark", PAINT.dark);
}

/** The faded round works sign: one canvas texture, two discs, a single draw call. */
function dialSign(spots: { x: number; y: number; z: number; ry: number }[], radius: number): WorldExtra | null {
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let seed = 9173;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = S / 2;
  g.fillStyle = "#7a5a44";
  g.fillRect(0, 0, S, S);
  // Outer band (faded teal), cream face, ticks.
  g.fillStyle = "#4f7a78";
  g.beginPath(); g.arc(cx, cx, 250, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#e2d6b8";
  g.beginPath(); g.arc(cx, cx, 182, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#2c2a26";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = i % 5 ? 168 : 152;
    g.lineWidth = i % 5 ? 3 : 7;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * 178, cx + Math.sin(a) * 178);
    g.stroke();
  }
  // Lettering round the band.
  const text = "HARROW PAN SALT WORKS  •  No. 3  •  ";
  g.fillStyle = "#efe6cc";
  g.font = "bold 40px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + (i / text.length) * Math.PI * 2;
    g.save();
    g.translate(cx + Math.cos(a) * 216, cx + Math.sin(a) * 216);
    g.rotate(a + Math.PI / 2);
    g.fillText(text[i], 0, 0);
    g.restore();
  }
  // Emblem: a stepped crystal over three brine pans.
  g.fillStyle = "#a8432e";
  g.beginPath();
  g.moveTo(cx, cx - 110); g.lineTo(cx + 62, cx - 20); g.lineTo(cx + 30, cx + 40); g.lineTo(cx - 30, cx + 40); g.lineTo(cx - 62, cx - 20);
  g.closePath(); g.fill();
  g.fillStyle = "#e2d6b8";
  g.beginPath(); g.moveTo(cx, cx - 82); g.lineTo(cx + 22, cx - 20); g.lineTo(cx, cx + 22); g.lineTo(cx - 22, cx - 20); g.closePath(); g.fill();
  g.fillStyle = "#2c2a26";
  for (let k = 0; k < 3; k++) g.fillRect(cx - 96 + k * 66, cx + 62, 58, 14);
  g.font = "bold 44px Arial, Helvetica, sans-serif";
  g.fillText("HP-3", cx, cx + 118);
  // Weathering: sun fade, peeled patches, rust runs, bullet holes.
  g.globalCompositeOperation = "source-atop";
  const fade = g.createLinearGradient(0, 0, S * 0.3, S);
  fade.addColorStop(0, "rgba(236,226,200,0.42)");
  fade.addColorStop(1, "rgba(236,226,200,0.12)");
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${120 + r() * 40},${70 + r() * 30},${40 + r() * 20},${0.25 + r() * 0.45})`;
    g.beginPath();
    g.ellipse(r() * S, r() * S, 4 + r() * 22, 3 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 30; i++) {
    const x = r() * S, y = r() * S * 0.8;
    const run = g.createLinearGradient(x, y, x, y + 80 + r() * 160);
    run.addColorStop(0, "rgba(110,58,28,0.55)");
    run.addColorStop(1, "rgba(110,58,28,0)");
    g.fillStyle = run;
    g.fillRect(x, y, 2 + r() * 6, 240);
  }
  for (let i = 0; i < 14; i++) {
    const x = cx + (r() - 0.5) * 380, y = cx + (r() - 0.5) * 380, rad = 3 + r() * 4;
    g.fillStyle = "rgba(200,190,170,0.9)";
    g.beginPath(); g.arc(x, y, rad + 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#121110";
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.15 });
  const parts: THREE.BufferGeometry[] = [];
  for (const p of spots) {
    const disc = new THREE.CircleGeometry(radius, 48);
    disc.applyMatrix4(new THREE.Matrix4().makeRotationY(p.ry).setPosition(p.x, p.y, p.z));
    parts.push(disc);
  }
  // Merge by hand (same attributes).
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g2 of parts) {
    pos.push(...(g2.attributes.position.array as Float32Array));
    nor.push(...(g2.attributes.normal.array as Float32Array));
    uv.push(...(g2.attributes.uv.array as Float32Array));
    for (const i of g2.index!.array as ArrayLike<number> as number[]) idx.push(i + base);
    base += g2.attributes.position.count;
    g2.dispose();
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.userData.surface = "metal";
  return {
    object: mesh,
    triangles: idx.length / 3,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

/**
 * The processing tower and both conveyor galleries: frame, decks, stairs,
 * rails, hopper and chute, the clad screen house with its round sign, the
 * lattice crown with sheave wheel, the head house, the east gallery on its
 * trestles with the maintenance stair and bridge, the tail station, and the
 * second gallery to the silos on its support tower.
 */
export function buildTower(kit: DressingKit, r: Rnd, extras: WorldExtra[], detail: number) {
  const B = kit.builder;
  const boxes = kit.def.boxes;
  const c = T.col;

  // ---- Footings, ground slab, columns ----------------------------------------------
  B.box("concrete_dirty", T.x, 0.02, T.z, 11.2, 0.04, 11.2, 0xb4ac9c);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = T.x + sx * c, z = T.z + sz * c;
    B.box("concrete_dirty", x, 0.18, z, 1.0, 0.36, 1.0, 0xb9b2a4);
    B.box("metal_dark", x, 0.38, z, 0.7, 0.04, 0.7, PAINT.dark);
    for (const bx of [-0.25, 0.25]) for (const bz of [-0.25, 0.25]) B.box("metal_dark", x + bx, 0.44, z + bz, 0.05, 0.08, 0.05, 0x3a3836);
    hColumn(B, x, z, 0.36, T.houseTop + 0.1, 0.5, COL);
  }

  // ---- Decks ------------------------------------------------------------------------
  deck(B, T.x - 5, T.x + 5, T.z - 5, T.z + 5, T.deck1);
  deck(B, T.x - 3.5, T.x + 5, T.z - 5, T.z + 5, T.deck2);
  deck(B, T.x - 5, T.x - 3.5, T.z - 5, T.z - 1, T.deck2, false);
  rails(B, boxes);
  // Dust drifted onto the plates.
  for (let k = 0; k < 6; k++) {
    const top = k < 3 ? T.deck1 : T.deck2;
    const x = T.x + (r() - 0.5) * 8, z = T.z + (r() - 0.5) * 8;
    decal(B, "sand", new THREE.Vector3(x, top + 0.012, z), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), 2 + r() * 2, 2 + r() * 2, 0xd8c8a8);
  }

  // ---- Bracing ----------------------------------------------------------------------
  const zn = T.z - c, zs = T.z + c, xw = T.x - c, xe = T.x + c;
  // Ground floor north face (behind the blast wall), two bays.
  for (const [x0, x1] of [[xw, T.x], [T.x, xe]]) xBay(B, [x0, 1.3, zn], [x1, 1.3, zn], [x1, 2.9, zn], [x0, 2.9, zn], 0.1, BRACE);
  // Between the decks: north, south, west faces.
  for (const [x0, x1] of [[xw, T.x], [T.x, xe]]) {
    xBay(B, [x0, 3.65, zn], [x1, 3.65, zn], [x1, 6.45, zn], [x0, 6.45, zn], 0.1, BRACE);
    xBay(B, [x0, 3.65, zs], [x1, 3.65, zs], [x1, 6.45, zs], [x0, 6.45, zs], 0.1, BRACE);
  }
  for (const [z0, z1] of [[zn, T.z], [T.z, zs]]) xBay(B, [xw, 3.65, z0], [xw, 3.65, z1], [xw, 6.45, z1], [xw, 6.45, z0], 0.1, BRACE);
  // Knee braces on the open east face and under deck 1 corners.
  for (const z of [zn, zs]) {
    beam(B, [xe, 2.0, z], [xe, 2.95, z + (z < T.z ? 1.2 : -1.2)], 0.1, 0.12, "metal_painted", BRACE);
    beam(B, [xe, 5.6, z], [xe, 6.5, z + (z < T.z ? 1.2 : -1.2)], 0.1, 0.12, "metal_painted", BRACE);
  }
  // Above deck 2: ring girders and struts to the house, X bays on N and W, upper S.
  for (const y of [11.6, 15.9]) {
    for (const [a, b] of [[[xw, zn], [xe, zn]], [[xe, zn], [xe, zs]], [[xe, zs], [xw, zs]], [[xw, zs], [xw, zn]]] as const) {
      beam(B, [a[0], y, a[1]], [b[0], y, b[1]], 0.18, 0.36, "metal_painted", GIRDER);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(B, [T.x + sx * c, y - 0.1, T.z + sz * c], [T.x + sx * T.house, y - 0.1, T.z + sz * T.house], 0.14, 0.2, "metal_painted", GIRDER);
  }
  // Upper tier X-braced on three faces; the deck-2 tier keeps only knee braces (clear sight lines).
  xBay(B, [xw, 11.7, zn], [xe, 11.7, zn], [xe, 15.8, zn], [xw, 15.8, zn], 0.1, BRACE);
  xBay(B, [xw, 11.7, zn], [xw, 11.7, zs], [xw, 15.8, zs], [xw, 15.8, zn], 0.1, BRACE);
  xBay(B, [xw, 11.7, zs], [xe, 11.7, zs], [xe, 15.8, zs], [xw, 15.8, zs], 0.1, BRACE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = T.x + sx * c, z = T.z + sz * c;
    beam(B, [x, 9.9, z], [x - sx * 1.6, 11.5, z], 0.1, 0.12, "metal_painted", BRACE);
    beam(B, [x, 9.9, z], [x, 11.5, z - sz * 1.6], 0.1, 0.12, "metal_painted", BRACE);
  }

  // ---- Stairs ---------------------------------------------------------------------
  for (const b of boxes) {
    if (b.tag !== "stair" && b.tag !== "catwalk") continue;
    const top = (b.y ?? 0) + b.h;
    B.box("metal_dark", b.x, top - 0.02, b.z, b.w - 0.02, 0.04, b.d - 0.12, PAINT.grating);
    // Nosing on the tread's front edge.
    if (b.tag === "catwalk") B.box("metal_painted", b.x + b.w / 2 - 0.02, top - 0.05, b.z, 0.04, 0.08, b.d - 0.12, PAINT.rail);
  }
  {
    const F = FLIGHT1, xBot = F.x0 + F.run * F.n;
    for (const s of [-1, 1]) {
      const z = F.z + s * (F.width / 2 - 0.02);
      beam(B, [xBot + 0.15, -0.05, z], [F.x0, T.deck1 - 0.25, z], 0.06, 0.3, "metal_painted", GIRDER);
      handrail(B, [xBot - 0.1, 0.4, z], [F.x0 + 0.05, T.deck1, z]);
    }
  }
  {
    const F = FLIGHT2, zEnd = F.z0 - F.run * F.n;
    for (const s of [-1, 1]) {
      const x = F.x + s * (F.width / 2 - 0.02);
      beam(B, [x, T.deck1 - 0.05, F.z0 + 0.1], [x, T.deck2 - 0.25, zEnd], 0.06, 0.3, "metal_painted", GIRDER);
      if (s > 0) handrail(B, [x, T.deck1 + 0.4, F.z0 - 0.1], [x, T.deck2, zEnd + 0.05]);
    }
  }
  // Conveyor maintenance stair: stringers, handrails, the bridge onto deck 2.
  {
    const W = CATWALK, xBot = W.xTop + W.run * W.n;
    for (const s of [-1, 1]) {
      const z = W.z + s * (W.width / 2 - 0.02);
      beam(B, [xBot + 0.25, -0.15, z], [W.xTop + 0.2, T.deck2 - 0.3, z], 0.07, 0.34, "metal_painted", GIRDER);
      handrail(B, [xBot - 0.1, 0.2, z], [W.xTop + 0.3, T.deck2, z]);
    }
    deck(B, BRIDGE.x0, BRIDGE.x1, W.z - W.width / 2, W.z + W.width / 2, T.deck2, false);
    hColumn(B, BRIDGE.post, W.z, 0, T.deck2 - 0.6, 0.3, COL, true);
    B.box("concrete_dirty", BRIDGE.post, 0.15, W.z, 0.7, 0.3, 0.7, 0xb9b2a4);
  }

  // ---- Hopper on deck 1, chute and spill below -----------------------------------
  {
    const { x, z, size } = HOPPER, h = size / 2;
    B.box("metal_rust", x, 6.25, z, size + 0.8, 1.2, size + 0.8, 0x8a5a3c);
    hopper(B, x, z, 4.3, 0.6, 5.65, h + 0.4, "metal_rust", 0x7e5236);
    B.box("metal_rust", x, 3.2, z, 1.2, 2.2, 1.2, 0x7e5236);
    hopper(B, x, z, 1.95, 0.75, 2.3, 0.6, "metal_rust", 0x6e4a34);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) hColumn(B, x + sx * (h + 0.2), z + sz * (h + 0.2), T.deck1, 5.7, 0.22, COL);
    // Stiffener bands + a slide-gate wheel.
    for (const y of [5.9, 6.6]) B.box("metal_dark", x, y, z, size + 0.86, 0.08, size + 0.86, PAINT.dark);
    put(B, new THREE.TorusGeometry(0.28, 0.03, 4, 14), x + 0.66, 2.7, z, 0, Math.PI / 2, 0, "metal_painted", 0xb83a2a);
    for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) faceDecal(B, "leak", x + nx * (h + 0.42), 6.1, z + nz * (h + 0.42), nx, nz, 1.2, 1.8, 0xb06a3a);
    // Salt spill heap under the chute.
    const heap = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = heap.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + Math.sin(p.getX(i) * 5.1 + p.getZ(i) * 3.3) * 0.08;
      p.setXYZ(i, p.getX(i) * 1.7 * k, p.getY(i) * 0.38, p.getZ(i) * 1.5 * k);
    }
    heap.computeVertexNormals();
    put(B, heap, x, 0, z, 0, 0.3, 0, "gravel", 0xf0ece4, "decor", [3, 3]);
    decal(B, "specks", new THREE.Vector3(x, 0.03, z), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), 6, 6, 0xf4f0e8);
  }

  // ---- Screen house -----------------------------------------------------------------
  {
    const h = T.house, y0 = T.deck2, y1 = T.houseTop - 0.15;
    B.box("metal_dark", T.x, (y0 + y1) / 2, T.z, h * 2 - 0.12, y1 - y0, h * 2 - 0.12, 0x1e1c1a);
    const win: [number, number] = [9.3, 10.2];
    cladWall(B, r, T.x - h, T.z + h, T.x + h, T.z + h, 0, 1, y0, y1, { gaps: 0.05, window: win, streaks: 5 });
    cladWall(B, r, T.x + h, T.z + h, T.x + h, T.z - h, 1, 0, y0, y1, { gaps: 0.06, window: win, streaks: 4 });
    cladWall(B, r, T.x + h, T.z - h, T.x - h, T.z - h, 0, -1, y0, y1, { gaps: 0.04, streaks: 4 });
    cladWall(B, r, T.x - h, T.z - h, T.x - h, T.z + h, -1, 0, y0, y1, { gaps: 0.06, window: win, streaks: 4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box("metal_dark", T.x + sx * h, (y0 + y1) / 2, T.z + sz * h, 0.14, y1 - y0, 0.14, PAINT.dark);
    // Roof with overhang and a vent.
    B.box("corrugated_rust", T.x, T.houseTop, T.z, h * 2 + 0.6, 0.12, h * 2 + 0.6, 0x9a6a4e);
    B.box("metal_dark", T.x, T.houseTop - 0.12, T.z, h * 2 + 0.66, 0.2, h * 2 + 0.66, PAINT.dark);
    tube(B, [T.x - 1.6, T.houseTop, T.z + 1.2], [T.x - 1.6, T.houseTop + 1.4, T.z + 1.2], 0.25, "metal_rust", 0x7a5038, 10);
    put(B, new THREE.ConeGeometry(0.42, 0.3, 10), T.x - 1.6, T.houseTop + 1.55, T.z + 1.2, 0, 0, 0, "metal_rust", 0x6a4a36);
    // Door onto deck 2 (south) with a small hood.
    B.box("metal_painted", T.x + 1.6, T.deck2 + 1.05, T.z + h + 0.06, 0.95, 2.1, 0.06, 0x5f6a5c);
    B.box("metal_dark", T.x + 1.6, T.deck2 + 2.3, T.z + h + 0.35, 1.4, 0.06, 0.7, PAINT.dark);
    faceDecal(B, "baseDirt", T.x, T.deck2 + 0.5, T.z + h + 0.05, 0, 1, 6, 1, 0xffffff);
    // Ladder up the north face to the roof, caged.
    ladder(B, T.x + 2.0, T.z - h - 0.2, T.deck2, T.houseTop + 1.0, 0, -1, PAINT.dark, true);
    // Conduit down the NE column + junction boxes.
    tube(B, [xe + 0.32, 0.4, zn + 0.32], [xe + 0.32, T.houseTop, zn + 0.32], 0.05, "metal_dark", 0x4a4a46, 6);
    for (const y of [1.4, 4.8, 8.6]) B.box("metal_painted", xe + 0.42, y, zn + 0.42, 0.4, 0.55, 0.25, 0x8a9088);
  }
  // Round works sign on the south and west faces.
  const sign = dialSign([
    { x: T.x - 0.4, y: 13.2, z: T.z + T.house + 0.09, ry: 0 },
    { x: T.x - T.house - 0.09, y: 13.2, z: T.z - 0.2, ry: -Math.PI / 2 },
  ], 1.85);
  if (sign) extras.push(sign);
  for (const [x, z, ry] of [[T.x - 0.4, T.z + T.house + 0.06, 0], [T.x - T.house - 0.06, T.z - 0.2, -Math.PI / 2]] as const) {
    put(B, new THREE.TorusGeometry(1.88, 0.07, 6, 40), x, 13.2, z, 0, ry, 0, "metal_dark", 0x5a4a3e);
    put(B, new THREE.CircleGeometry(1.95, 32), x - (ry ? 0.02 : 0), 13.2, z - (ry ? 0 : 0.02), 0, ry, 0, "metal_dark", 0x3a3430);
  }

  // ---- Lattice crown, sheave wheel, mast -------------------------------------------
  {
    const y0 = T.houseTop + 0.1, y1 = T.crownTop - 2, s0 = c, s1 = 1.5;
    const at = (y: number) => s0 + (s1 - s0) * ((y - y0) / (y1 - y0));
    const levels = [y0, 18.9, 21.5, 23.8, 25.9, 27.6, y1];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(B, [T.x + sx * s0, y0, T.z + sz * s0], [T.x + sx * s1, y1, T.z + sz * s1], 0.3, 0.3, "metal_painted", COL);
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i], s = at(y);
      const corners: V3[] = [[T.x - s, y, T.z - s], [T.x + s, y, T.z - s], [T.x + s, y, T.z + s], [T.x - s, y, T.z + s]];
      for (let k = 0; k < 4; k++) beam(B, corners[k], corners[(k + 1) % 4], 0.14, 0.18, "metal_painted", GIRDER);
      if (i === 0) continue;
      const yb = levels[i - 1], sb = at(yb);
      const lower: V3[] = [[T.x - sb, yb, T.z - sb], [T.x + sb, yb, T.z - sb], [T.x + sb, yb, T.z + sb], [T.x - sb, yb, T.z + sb]];
      for (let k = 0; k < 4; k++) xBay(B, lower[k], lower[(k + 1) % 4], corners[(k + 1) % 4], corners[k], 0.08, BRACE);
    }
    // Head platform, rails, sheave wheel on its A-frame, aviation light and mast.
    B.box("metal_dark", T.x, y1 + 0.05, T.z, s1 * 2 + 0.6, 0.1, s1 * 2 + 0.6, PAINT.grating);
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as const) {
      handrail(B, [T.x + a[0] * (s1 + 0.28), y1 + 0.1, T.z + a[1] * (s1 + 0.28)], [T.x + b[0] * (s1 + 0.28), y1 + 0.1, T.z + b[1] * (s1 + 0.28)], 1.0, PAINT.rail);
    }
    for (const sz of [-0.5, 0.5]) {
      beam(B, [T.x - 1.2, y1 + 0.1, T.z + sz], [T.x, y1 + 1.9, T.z + sz], 0.12, 0.12, "metal_painted", COL);
      beam(B, [T.x + 1.2, y1 + 0.1, T.z + sz], [T.x, y1 + 1.9, T.z + sz], 0.12, 0.12, "metal_painted", COL);
    }
    tube(B, [T.x, y1 + 1.9, T.z - 0.6], [T.x, y1 + 1.9, T.z + 0.6], 0.07, "metal_dark", PAINT.dark, 8, "decor", false);
    put(B, new THREE.TorusGeometry(1.25, 0.09, 6, 36), T.x, y1 + 1.9, T.z, 0, 0, 0, "metal_rust", 0x7a5038);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      beam(B, [T.x, y1 + 1.9, T.z], [T.x + Math.cos(a) * 1.2, y1 + 1.9 + Math.sin(a) * 1.2, T.z], 0.05, 0.08, "metal_rust", 0x7a5038);
    }
    tube(B, [T.x + 1.2, y1 + 0.1, T.z + 1.2], [T.x + 1.2, T.crownTop + 3.8, T.z + 1.2], 0.06, "metal_dark", 0x6a6a66, 6);
    for (const y of [T.crownTop + 1, T.crownTop + 2.4]) B.box("metal_dark", T.x + 1.2, y, T.z + 1.2, 0.7, 0.03, 0.03, 0x6a6a66);
    const bulb = new THREE.SphereGeometry(0.14, 8, 6);
    put(B, bulb, T.x + 1.2, T.crownTop + 3.9, T.z + 1.2, 0, 0, 0, "plain", 0xc8301e);
    // Ladder from the house roof to the head platform.
    ladder(B, T.x - 0.6, T.z - 1.3, T.houseTop + 0.1, y1, 0, -1, PAINT.dark, true);
  }

  // ---- Head house over the conveyor head ---------------------------------------
  {
    const { x, y, z, w, h, d } = HEAD;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    B.box("metal_dark", x, y + h / 2, z, w - 0.1, h, d - 0.1, 0x1e1c1a);
    cladWall(B, r, x0, z1, x1, z1, 0, 1, y, y + h, { gaps: 0.04, streaks: 2 });
    cladWall(B, r, x1, z0, x0, z0, 0, -1, y, y + h, { gaps: 0.04, streaks: 2 });
    B.box("corrugated_rust", x + 0.2, y + h + 0.06, z, w + 0.7, 0.1, d + 0.5, 0x9a6a4e);
    B.box("metal_painted", x, y - 0.12, z, w, 0.24, d, GIRDER);
    for (const zz of [z0 + 0.1, z1 - 0.1]) {
      beam(B, [x1 - 0.1, y, zz], [T.x + T.house + 0.05, 8.2, zz], 0.16, 0.2, "metal_painted", GIRDER);
      beam(B, [x1 - 0.1, y + h, zz], [x1 - 0.1, y, zz], 0.16, 0.2, "metal_painted", GIRDER);
    }
    // Drive: motor + gearbox on a bracket shelf, guard.
    B.box("metal_dark", x + 0.4, y + 0.06, z0 - 0.7, 2.2, 0.1, 1.3, PAINT.grating);
    B.box("metal_painted", x + 1.0, y + 0.45, z0 - 0.7, 0.9, 0.7, 0.8, 0x5f7a5a);
    B.box("metal_painted", x - 0.1, y + 0.4, z0 - 0.7, 0.7, 0.6, 0.6, 0x6a6c64);
    tube(B, [x + 0.55, y + 0.45, z0 - 0.7], [x + 0.25, y + 0.45, z0 - 0.7], 0.12, "metal_dark", PAINT.dark, 8, "decor", false);
    for (const xx of [x - 0.6, x + 1.4]) beam(B, [xx, y, z0 - 1.3], [xx, y - 1.4, z0 - 0.05], 0.1, 0.1, "metal_painted", GIRDER);
  }

  // ---- East gallery, trestles, tail station ----------------------------------------
  const [ax, ay, az] = CONVEYOR.a;
  const tailX = TAIL.x - TAIL.w / 2 + 1.5;
  gallery(B, r, [ax, ay, az], [tailX, conveyorY(tailX), az], CONVEYOR.width, CONVEYOR.height, { salt: true });
  const treadTop = (x: number) => (x < CATWALK.xTop ? T.deck2 : CATWALK.rise * (CATWALK.n - Math.floor((x - CATWALK.xTop) / CATWALK.run)));
  for (const x of CONVEYOR.trestles) {
    const top = conveyorY(x) - 1.45;
    for (const z of [-7.3, -2.6]) {
      hColumn(B, x, z, 0, top, 0.4, COL, true);
      B.box("concrete_dirty", x, 0.15, z, 0.9, 0.3, 0.9, 0xb9b2a4);
    }
    B.box("metal_painted", x, top - 0.18, -4.95, 0.4, 0.36, 5.3, GIRDER);
    for (const z of [-7.3, -2.6]) beam(B, [x, top - 1.3, z], [x, top - 0.36, z + (z < -5 ? 1.1 : -1.1)], 0.1, 0.12, "metal_painted", BRACE);
    const limit = treadTop(x) - 0.5;
    if (limit - 2.3 > 1.4) {
      xBay(B, [x, 2.3, -7.3], [x, 2.3, -2.6], [x, limit, -2.6], [x, limit, -7.3], 0.1, BRACE, "decor", true);
    }
    if (x > CATWALK.xTop) {
      const y = treadTop(x) - 0.45;
      B.box("metal_painted", x, y, -2.75, 0.2, 0.2, 0.5, GIRDER);
    }
  }
  {
    const t = TAIL, x0 = t.x - t.w / 2, z0 = t.z - t.d / 2, z1 = t.z + t.d / 2;
    B.box("concrete_dirty", t.x, t.plinth / 2, t.z, t.w, t.plinth, t.d, 0xc0b8a8);
    B.box("concrete_dirty", t.x, t.plinth + 0.08, t.z, t.w + 0.2, 0.16, t.d + 0.2, 0xb4ac9c);
    const hx0 = x0 + 1.5;
    B.box("metal_dark", (hx0 + x0 + t.w) / 2, (t.plinth + t.h) / 2 + 0.08, t.z, x0 + t.w - hx0 - 0.1, t.h - t.plinth, t.d - 0.1, 0x1e1c1a);
    cladWall(B, r, hx0, z1, x0 + t.w, z1, 0, 1, t.plinth + 0.16, t.h, { gaps: 0.05, streaks: 2 });
    cladWall(B, r, x0 + t.w, z0, hx0, z0, 0, -1, t.plinth + 0.16, t.h, { gaps: 0.05, streaks: 2 });
    cladWall(B, r, x0 + t.w, z1, x0 + t.w, z0, 1, 0, t.plinth + 0.16, t.h, { gaps: 0.03 });
    B.box("corrugated_rust", (hx0 + x0 + t.w) / 2, t.h + 0.05, t.z, x0 + t.w - hx0 + 0.4, 0.1, t.d + 0.5, 0x9a6a4e);
    faceDecal(B, "baseDirt", t.x, 0.6, z1 + 0.01, 0, 1, t.w, 1.2, 0xffffff);
    faceDecal(B, "baseDirt", t.x, 0.6, z0 - 0.01, 0, -1, t.w, 1.2, 0xffffff);
    // Spilled load round the station.
    for (let k = 0; k < 3; k++) decal(B, "specks", new THREE.Vector3(t.x + (r() - 0.5) * 6, 0.03, t.z - 3 + (r() - 0.5) * 2), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), 3 + r() * 2, 2 + r() * 2, 0xf0ece4);
  }

  // ---- Gallery to the silos, on its support tower -------------------------------------
  {
    const g = GALLERY2;
    gallery(B, r, g.a, g.b, 2.0, 2.0, { lowClad: true });
    const { x, z } = g.tower;
    const top = 12.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      hColumn(B, x + sx, z + sz, 0, top + 0.6, 0.35, COL);
      B.box("concrete_dirty", x + sx, 0.15, z + sz, 0.8, 0.3, 0.8, 0xb9b2a4);
    }
    for (let y = 2.4; y < top; y += 3.4) {
      const y1 = Math.min(top, y + 3.4);
      const corners: V3[][] = [0, 1].map((k) => {
        const yy = k ? y1 : y;
        return [[x - 1, yy, z - 1], [x + 1, yy, z - 1], [x + 1, yy, z + 1], [x - 1, yy, z + 1]];
      });
      for (let k = 0; k < 4; k++) xBay(B, corners[0][k], corners[0][(k + 1) % 4], corners[1][(k + 1) % 4], corners[1][k], 0.08, BRACE, "decor", true);
    }
    B.box("metal_painted", x, top + 0.7, z, 2.8, 0.3, 2.8, GIRDER);
    ladder(B, x + 1.2, z, 0, top + 0.8, 1, 0, PAINT.dark, true);
  }

  // ---- Lights and grime round the tower -----------------------------------------
  for (const [x, z] of [[T.x - 2.5, T.z - 2.5], [T.x + 2.5, T.z + 2.5], [T.x - 2.5, T.z + 2.8]] as const) pendantLamp(B, x, 2.95, z, 0.6, 1, 0x4f5a4c);
  kit.addLamp?.(new THREE.Vector3(T.x, 2.2, T.z), 0xffd9a0, 3, 9);
  for (const z of [zn - 0.21, zs + 0.21]) {
    const nz = z < T.z ? -1 : 1;
    faceDecal(B, "soot", T.x + (r() - 0.5) * 4, 0.7, z, 0, nz, 2.5, 1.2, 0xffffff);
    if (detail > 0.5) faceDecal(B, "pocks", T.x + (r() - 0.5) * 6, 0.7, z, 0, nz, 1.8, 0.9, 0xffffff);
  }
}
