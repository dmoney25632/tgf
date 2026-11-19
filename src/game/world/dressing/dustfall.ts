import * as THREE from "three";
import { rng, type BushPlacement, type TreePlacement } from "../Foliage";
import type { Splat } from "../Terrain";
import { poleWirePoints } from "../BoxStyles";
import {
  band, clearOf, concertina, decorBox, fbm2, fence, pallets, poleLine, rubble, scatterTrees, smoothstep, tyre, wireSpan,
  type Dressing, type PoleSpot,
} from "./common";

const ROAD_Z = -74;
const R = 32; // compound wall line
const BERM = 48; // berm inner face

/**
 * Dustfall Outpost set dressing: terrain (flat play area, rolling farmland
 * beyond the berm, gravel yard, worn gate tracks, mud), foliage plan, wall
 * and building detail, gates, razor wire, telephone lines, fences, a ruined
 * farm outside, and clutter. Everything here is visual-only; colliders come
 * from the map's boxes.
 */
export const dustfall: Dressing = (kit) => {
  const { def, builder: B, props, quality } = kit;
  const r = rng(2024);
  const boxes = def.boxes;
  const tagged = (t: string) => boxes.filter((b) => b.tag === t);
  const spawns = def.survival?.enemySpawns ?? [];
  const nearSpawn = (x: number, z: number, m: number) => spawns.some((s) => Math.hypot(s.x - x, s.z - z) < m);

  // ---- Terrain ---------------------------------------------------------------------
  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= 50) return 0;
    let h = smoothstep(50, 130, d) * (2 + 16 * fbm2(x * 0.009 + 3, z * 0.009 - 2, 4));
    h += smoothstep(52, 70, d) * (fbm2(x * 0.07, z * 0.07, 2) - 0.5) * 0.9;
    h *= 1 - 0.8 * Math.exp(-(((z - ROAD_Z) / 8) ** 2)) * smoothstep(55, 70, d);
    return h;
  };
  const track = (x: number, z: number) => {
    const ax = Math.abs(x), az = Math.abs(z);
    // Vehicle tracks through each gate, wobbling slightly.
    const wob = (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 2;
    return Math.max(band(ax + wob, 3) * (az < 47 ? 1 : 0), band(az + wob, 3) * (ax < 47 ? 1 : 0));
  };
  const splat = (x: number, z: number, o: Splat) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const n = fbm2(x * 0.06, z * 0.06, 3);
    const n2 = fbm2(x * 0.17 + 9, z * 0.17, 2);
    const t = track(x, z);
    if (d < R) {
      o.gravel = 1;
      o.ground = smoothstep(29, 31.5, d) * 1.2 + smoothstep(0.6, 0.72, n) * 0.6;
      o.mud = smoothstep(0.58, 0.7, n2) * 0.8 + t * 0.55;
    } else if (d < BERM) {
      o.gravel = t * 0.6 + 0.04;
      o.ground = 1 - t * 0.75;
      o.mud = smoothstep(0.55, 0.7, n) * 0.9 + t * 0.6 + smoothstep(BERM - 2, BERM, d) * 0.4;
    } else {
      const road = band(z - ROAD_Z + (fbm2(x * 0.02, 1, 2) - 0.5) * 4, 3.5);
      o.gravel = road;
      o.ground = 1 - road * 0.9;
      o.mud = road * 0.35 + smoothstep(0.62, 0.75, n) * 0.6;
    }
  };

  // ---- Grass -------------------------------------------------------------------------
  const grass = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < R - 0.4) return d > R - 2.6 ? 0.6 : fbm2(x * 0.3, z * 0.3, 2) > 0.68 ? 0.25 : 0;
    if (d < R + 0.5) return 0;
    if (d > BERM - 0.2) return 0;
    const t = track(x, z);
    const n = fbm2(x * 0.06, z * 0.06, 3);
    return Math.max(0, Math.min(1, 1 - t * 1.3 - smoothstep(0.58, 0.7, n) * 0.7));
  };

  // ---- Wall detail: plinth, coping, pilasters, razor wire ---------------------------
  for (const w of tagged("wall")) {
    const alongX = w.w > w.d;
    const len = alongX ? w.w : w.d;
    B.box("concrete", w.x, w.h + 0.08, w.z, alongX ? w.w : w.w + 0.16, 0.16, alongX ? w.d + 0.16 : w.d, 0xd2cec4);
    B.box("concrete_dirty", w.x, 0.22, w.z, alongX ? w.w : w.w + 0.08, 0.44, alongX ? w.d + 0.08 : w.d, 0xb4b0a6);
    for (let a = -len / 2 + 2.6; a < len / 2 - 1.5; a += 4.6) {
      if (alongX) B.box("concrete", w.x + a, w.h / 2, w.z, 0.5, w.h, w.d + 0.1, 0xc9c5ba);
      else B.box("concrete", w.x, w.h / 2, w.z + a, w.w + 0.1, w.h, 0.5, 0xc9c5ba);
    }
    const outward = alongX ? Math.sign(w.z) : Math.sign(w.x);
    if (alongX) concertina(B, w.x - len / 2 + 0.3, w.z + outward * 0.05, w.x + len / 2 - 0.3, w.z + outward * 0.05, w.h + 0.42);
    else concertina(B, w.x + outward * 0.05, w.z - len / 2 + 0.3, w.x + outward * 0.05, w.z + len / 2 - 0.3, w.h + 0.42);
    // Brackets for the wire.
    for (let a = -len / 2 + 1; a < len / 2; a += 3.2) {
      if (alongX) B.box("metal_dark", w.x + a, w.h + 0.45, w.z, 0.04, 0.6, 0.04, 0x6a6a66);
      else B.box("metal_dark", w.x, w.h + 0.45, w.z + a, 0.04, 0.6, 0.04, 0x6a6a66);
    }
  }
  for (const w of tagged("lowwall")) {
    B.box("concrete", w.x, w.h + 0.06, w.z, w.w + 0.1, 0.12, w.d + 0.1, 0xd2cec4);
  }
  for (const p of tagged("pillar")) {
    B.box("concrete", p.x, p.h + 0.1, p.z, p.w + 0.16, 0.2, p.d + 0.16, 0xd6d2c8);
    B.box("concrete_dirty", p.x, 0.25, p.z, p.w + 0.08, 0.5, p.d + 0.08, 0xb4b0a6);
  }

  // ---- Gate leaves, swung open against the outer wall face --------------------------
  const leaf = (x: number, z: number, alongX: boolean) => {
    const L = 3.3, H = 2.3;
    const tint = 0x8f9670;
    if (alongX) {
      B.box("metal_corrugated", x, 0.15 + H / 2, z, L, H, 0.04, tint);
      for (const yy of [0.18, 0.15 + H]) B.box("metal_dark", x, yy, z, L, 0.08, 0.08, 0x5c5f58);
      for (const o of [-L / 2, L / 2]) B.box("metal_dark", x + o, 0.15 + H / 2, z, 0.08, H, 0.08, 0x5c5f58);
    } else {
      B.box("metal_corrugated", x, 0.15 + H / 2, z, 0.04, H, L, tint);
      for (const yy of [0.18, 0.15 + H]) B.box("metal_dark", x, yy, z, 0.08, 0.08, L, 0x5c5f58);
      for (const o of [-L / 2, L / 2]) B.box("metal_dark", x, 0.15 + H / 2, z + o, 0.08, H, 0.08, 0x5c5f58);
    }
  };
  for (const side of [-1, 1]) {
    for (const g of [-1, 1]) {
      const off = g * (4.1 + 1.75);
      const face = side * (R + 0.35 + 0.08);
      leaf(off, face, true);
      leaf(face, off, false);
    }
  }

  // ---- Corner guard posts: sandbag parapet + tin roof on posts ----------------------
  for (const c of tagged("corner")) {
    const top = c.h;
    for (const [dx, dz, w, d] of [[0, -0.85, 2, 0.35], [0, 0.85, 2, 0.35], [-0.85, 0, 0.35, 1.3], [0.85, 0, 0.35, 1.3]] as const) {
      decorBox(kit, { x: c.x + dx, z: c.z + dz, y: top, w, h: 0.5, d, color: 0xc4b48e, surface: "sand", style: "sandbags" });
    }
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) B.box("wood", c.x + sx, top + 1.0, c.z + sz, 0.1, 2.0, 0.1, 0xa89a84);
    B.box("metal_corrugated", c.x, top + 2.03, c.z, 2.5, 0.05, 2.5, 0x9c9e94, { rotX: 0.08 });
  }

  // ---- Ops building: slab, plinth, cornice, frames, roof sheets, mast ---------------
  B.box("concrete", 0, 0.012, 0, 11.3, 0.024, 9.3, 0xb8b4aa);
  for (const w of tagged("ops")) {
    const y0 = w.y ?? 0;
    const thinX = w.w < w.d;
    const grow = (a: number, isThin: boolean) => (isThin ? a + 0.08 : a);
    if (y0 === 0) B.box("concrete", w.x, 0.22, w.z, grow(w.w, thinX), 0.44, grow(w.d, !thinX), 0xa8a59c);
    if (y0 + w.h >= 3.19) B.box("concrete", w.x, 3.02, w.z, grow(w.w, thinX) + 0.02, 0.24, grow(w.d, !thinX) + 0.02, 0xd0ccc2);
  }
  const frameTint = 0x9c8c74;
  for (const x of [-6, 6]) {
    for (const z of [-2.2, 2.2]) {
      for (const f of [-1, 1]) {
        const fx = x + f * 0.2;
        for (const o of [-1.04, 1.04]) B.box("wood", fx, 1.55, z + o, 0.06, 1.18, 0.08, frameTint);
        B.box("wood", fx, 2.1, z, 0.06, 0.08, 2.16, frameTint, { rot90: true });
        B.box("wood", fx, 1.0, z, 0.06, 0.06, 2.16, frameTint, { rot90: true });
      }
      B.box("concrete", x + Math.sign(x) * 0.12, 0.97, z, 0.28, 0.06, 2.3, 0xd0ccc2);
    }
  }
  for (const z of [-5, 5]) {
    for (const f of [-1, 1]) {
      const fz = z + f * 0.2;
      for (const o of [-1.24, 1.24]) B.box("wood", o, 1.15, fz, 0.1, 2.3, 0.06, frameTint);
      B.box("wood", 0, 2.32, fz, 2.58, 0.1, 0.06, frameTint, { rot90: true });
    }
  }
  // Roof: corrugated sheets with a slight fall, fascia, AC unit, mast with guys.
  B.box("metal_corrugated", 0, 3.53, 0, 12.8, 0.05, 10.8, 0xa3a59c, { rotX: 0.015, rot90: true });
  for (const z of [-5.35, 5.35]) B.box("wood", 0, 3.45, z, 12.8, 0.26, 0.05, 0x8a7c66, { rot90: true });
  for (const x of [-6.35, 6.35]) B.box("wood", x, 3.45, 0, 0.05, 0.26, 10.8, 0x8a7c66, { rot90: true });
  B.box("metal_painted", 3.6, 3.85, -2.8, 1.2, 0.6, 0.9, 0xb8b8b0);
  B.box("metal_dark", 3.6, 4.16, -2.8, 0.9, 0.04, 0.6, 0x555);
  const mast = new THREE.CylinderGeometry(0.035, 0.05, 6, 6);
  B.add(mast, new THREE.Matrix4().makeTranslation(-4.8, 3.55 + 3, 3.8), "metal_dark", 0x8a8a86, { uv: "keep", uvScale: [0.3, 6] });
  mast.dispose();
  for (const [gx, gz] of [[-6, 2.2], [-3.4, 4.9], [-5.9, 5.0]]) wireSpan(B, [new THREE.Vector3(-4.8, 8.9, 3.8)], [new THREE.Vector3(gx, 3.56, gz)], 0.05);
  for (let i = 0; i < 5; i++) decorBox(kit, { x: -5.2 + i * 0.7, z: -4.75, y: 3.55, w: 0.65, h: 0.34, d: 0.4, color: 0xc4b48e, surface: "sand", style: "sandbags" });

  // ---- Watchtower: X-braces and a sandbagged deck edge -------------------------------
  {
    const TX = -20, TZ = -20;
    const L = Math.hypot(3.6, 3.0), ang = Math.atan2(3.0, 3.6);
    const t = 0x9e8f78;
    for (const sz of [-1, 1]) for (const s of [-1, 1]) B.box("wood", TX, 1.8, TZ + sz * 1.8, L, 0.12, 0.08, t, { rotZ: s * ang, rot90: true });
    for (const sx of [-1, 1]) for (const s of [-1, 1]) B.box("wood", TX + sx * 1.8, 1.8, TZ, 0.08, 0.12, L, t, { rotX: s * ang, rot90: true });
    for (const sx of [-1, 1]) B.box("wood", TX + sx * 1.8, 0.8, TZ, 0.1, 0.14, 3.6, t, { rot90: true });
  }

  // ---- Props on the gameplay boxes -------------------------------------------------
  for (const g of tagged("generator")) {
    B.box("metal_dark", g.x, 0.06, g.z, g.w + 0.3, 0.12, g.d + 0.2, 0x4a4a46);
    const ex = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8);
    B.add(ex, new THREE.Matrix4().makeTranslation(g.x + g.w / 2 - 0.3, g.h + 0.5, g.z - g.d / 2 + 0.3), "metal_rust", 0x8a6a50, { uv: "keep", uvScale: [0.4, 1.1] });
    ex.dispose();
    for (let i = 0; i < 6; i++) B.box("metal_dark", g.x - g.w / 2 + 0.4 + i * 0.1, g.h * 0.55, g.z + g.d / 2 + 0.01, 0.04, g.h * 0.5, 0.02, 0x3a3a38);
    B.box("plain", g.x - 0.6, g.h * 0.7, g.z - g.d / 2 - 0.01, 0.5, 0.35, 0.02, 0x2a2c2a);
  }
  for (const a of tagged("ammo")) {
    props.place("ammo_box", { x: a.x - 0.35, y: a.h, z: a.z + 0.3, scale: 2, rotY: Math.PI / 2 }, (bb, g) => bb.box("metal_painted", a.x - 0.35, a.h + 0.16, a.z + 0.3, 0.52, 0.32, 0.16, 0x7d8456, { group: g }));
    props.place("ammo_box", { x: a.x + 0.3, y: a.h, z: a.z - 0.32, scale: 2, rotY: Math.PI / 2 + 0.2 }, (bb, g) => bb.box("metal_painted", a.x + 0.3, a.h + 0.16, a.z - 0.32, 0.52, 0.32, 0.16, 0x7d8456, { group: g }));
  }
  tagged("supply").forEach((c, i) => {
    if (i % 2) return;
    props.place("wooden_crate_01", { x: c.x + (r() - 0.5) * 0.2, y: c.h, z: c.z + (r() - 0.5) * 0.2, scale: 1.15, rotY: r() * 6 }, (bb, g) => bb.box("wood", c.x, c.h + 0.19, c.z, 0.9, 0.38, 0.46, 0xc9b896, { group: g }));
  });
  for (const w of tagged("wreck")) {
    const alongX = w.w > w.d;
    const len = alongX ? w.w : w.d;
    for (const a of [-len * 0.32, len * 0.3]) for (const s of [-1, 1]) {
      const geo = new THREE.TorusGeometry(0.36, 0.15, 6, 14);
      const m = new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2);
      m.setPosition(alongX ? w.x + a : w.x + s * (w.w / 2 + 0.02), 0.42, alongX ? w.z + s * (w.d / 2 + 0.02) : w.z + a);
      B.add(geo, m, "plain", 0x1d1d1c, { uv: "keep" });
      geo.dispose();
    }
    rubble(B, w.x, w.z, 4, 14, r, boxes);
  }
  for (const c of tagged("wreck-cab")) B.box("plain", c.x - 0.81, c.y! + 0.55, c.z, 0.02, 0.5, 1.7, 0x161816);

  // Clutter: pallets, tyres, rubble, cement bags, plants near walls.
  const clutterSpots: [number, number][] = [[-29.6, -28.4], [29.4, -28.8], [-12.6, 29.8], [21.6, -29.5], [-29.4, 16.5], [13.2, -29.8]];
  for (const [x, z] of clutterSpots) if (clearOf(boxes, x, z, 0.9)) pallets(B, x, z, r() * 0.4, 1 + Math.floor(r() * 3), r);
  for (const [x, z] of [[16.2, -11.4], [22.6, -2.2], [-21.3, 14.6], [-26.1, 0.9], [9.4, -26.6]]) if (clearOf(boxes, x, z, 0.5)) tyre(B, x, z, r() < 0.3, r);
  rubble(B, 0, -6.2, 3, 16, r, boxes);
  rubble(B, -7, 5.6, 2.5, 10, r, boxes);
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * 30.8, z = Math.sin(a) * 30.8;
    const sx = Math.abs(x) > Math.abs(z) ? Math.sign(x) * 30.9 : x, sz = Math.abs(z) >= Math.abs(x) ? Math.sign(z) * 30.9 : z;
    if (Math.abs(sx) > 5 && Math.abs(sz) > 5) rubble(B, sx, sz, 1.2, 5, r, boxes);
  }
  for (let i = 0; i < 6; i++) {
    const layer = i < 4 ? 0 : 1;
    props.place("cement_bag", { x: 12.2 + (i % 2) * 0.5 + layer * 0.25, y: layer * 0.17, z: 16.2 + (Math.floor(i / 2) % 2) * 0.75, scale: 0.95, rotY: (r() - 0.5) * 0.3 }, (bb, g) =>
      bb.add(kit.style.sandbag, new THREE.Matrix4().compose(new THREE.Vector3(12.2 + (i % 2) * 0.5 + layer * 0.25, layer * 0.17 + 0.09, 16.2 + (Math.floor(i / 2) % 2) * 0.75), new THREE.Quaternion(), new THREE.Vector3(0.45, 0.18, 0.7)), "sandbag", 0xd8d2c4, { group: g, uv: "keep", uvScale: [1.4, 0.5] }),
    );
  }

  // ---- Telephone lines ------------------------------------------------------------
  const compoundPoles = tagged("pole").map((p) => ({ x: p.x, y: 0, z: p.z, rotY: p.rotY ?? 0 }));
  const roadPoles: PoleSpot[] = [];
  for (let x = -64 - 34 * 5; x <= 200; x += 34) roadPoles.push({ x, y: height(x, ROAD_Z - 5.5), z: ROAD_Z - 5.5, rotY: Math.PI / 2 });
  poleLine(B, roadPoles, r, 1.1);
  if (compoundPoles.length >= 2) {
    const [a, b] = compoundPoles;
    const pa = poleWirePoints(a.x, a.y, a.z, a.rotY), pb = poleWirePoints(b.x, b.y, b.z, b.rotY);
    wireSpan(B, pa, pb, 0.7);
    // Service drops to the ops building roof.
    wireSpan(B, [pa[1]], [new THREE.Vector3(-6.2, 3.5, -5.2)], 0.5);
    wireSpan(B, [pb[2]], [new THREE.Vector3(-6.2, 3.5, 5.2)], 0.5);
    // Spur out over the berm to the road line.
    const spur: PoleSpot[] = [
      { x: -56, y: height(-56, -36), z: -36, rotY: Math.atan2(-11.5 + 36, -30.4 + 56) + Math.PI / 2 },
      { x: -64, y: height(-64, -58), z: -58, rotY: Math.PI / 2.2 },
    ];
    const sp = poleLine(B, spur, r, 0.9);
    wireSpan(B, pa, sp[0], 1.2);
    const road = roadPoles.find((p) => p.x === -64);
    if (road) wireSpan(B, sp[1], poleWirePoints(road.x, road.y, road.z, road.rotY), 0.8);
  }

  // ---- Fences along the road and fields --------------------------------------------
  fence(B, -150, ROAD_Z + 5, -78, ROAD_Z + 5, height, r);
  fence(B, -70, ROAD_Z + 5, -20, ROAD_Z + 4.5, height, r);
  fence(B, 18, ROAD_Z + 5, 120, ROAD_Z + 5.5, height, r);
  fence(B, 60, ROAD_Z + 5.5, 62, -58, height, r);
  fence(B, -120, ROAD_Z - 6, -40, ROAD_Z - 6.5, height, r);
  fence(B, 64, 30, 64, 92, height, r);
  fence(B, -95, 40, -60, 88, height, r);

  // ---- Ruined farm east of the berm (seen from the high ground) ---------------------
  {
    const fx = 84, fz = 16;
    const gy = height(fx, fz) - 0.2;
    const brick = 0xd0c4b8;
    B.box("brick", fx, gy + 2, fz - 4, 14, 4, 0.4, brick);
    B.box("brick", fx - 7, gy + 2, fz, 0.4, 4, 8, brick);
    B.box("brick", fx + 7, gy + 1.4, fz, 0.4, 2.8, 8, brick);
    B.box("brick", fx - 3, gy + 1.8, fz + 4, 8, 3.6, 0.4, brick);
    for (const s of [-1, 1]) B.box("metal_corrugated", fx - 2 + s * 0.4, gy + 5, fz + s * 2.1, 10, 0.06, 4.6, 0xa0786a, { rotX: s * 0.5 });
    B.box("concrete", fx - 7, gy + 0.6, fz + 6, 2, 1.2, 1.4, 0xbab6aa, { rotY: 0.3 });
    const shedY = height(70, -32);
    B.box("metal_corrugated", 70, shedY + 1.5, -32, 6, 3, 4, 0x8e978a);
    B.box("metal_corrugated", 70, shedY + 3.1, -32, 6.6, 0.06, 4.8, 0x9a7c66, { rotX: 0.1 });
  }

  // ---- Foliage plan ---------------------------------------------------------------
  const keepOutOuter = (x: number, z: number) => Math.abs(z - ROAD_Z) < 8 || (Math.abs(x - 84) < 12 && Math.abs(z - 16) < 10) || (Math.abs(x - 70) < 6 && Math.abs(z + 32) < 5);
  const trees: TreePlacement[] = scatterTrees(150, 66, 190, r, keepOutOuter);
  // A hedgerow along the far side of the road.
  for (let x = -180; x < 180; x += 7 + r() * 6) {
    if (r() < 0.3) continue;
    trees.push({ x, z: ROAD_Z - 12 - r() * 3, scale: 0.8 + r() * 0.5, variant: Math.floor(r() * 4), rot: r() * 6 });
  }
  for (const t of tagged("tree")) trees.push({ x: t.x, z: t.z, scale: 1.0 + r() * 0.2, variant: r() < 0.5 ? 0 : 3, rot: r() * 6 });

  const bushes: BushPlacement[] = [];
  const tryBush = (x: number, z: number, s: number, margin = 0.9) => {
    if (!clearOf(boxes, x, z, margin) || nearSpawn(x, z, 4) || track(x, z) > 0.3) return;
    bushes.push({ x, z, scale: s, dry: r() < 0.35 });
  };
  // Along the wall exteriors and the berm base, plus clumps around rocks/trees.
  for (let i = 0; i < 70; i++) {
    const a = (r() * 2 - 1) * 46;
    const side = Math.floor(r() * 4);
    const off = r() < 0.5 ? R + 1.2 + r() * 1.2 : BERM - 0.9 - r() * 0.8;
    const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
    if (Math.abs(a) < 6) continue;
    tryBush(x, z, 0.7 + r() * 0.5);
  }
  for (const b of boxes) if (b.style === "rock" || b.tag === "tree") for (let k = 0; k < 3; k++) tryBush(b.x + (r() - 0.5) * (b.w + 3), b.z + (r() - 0.5) * (b.d + 3), 0.6 + r() * 0.5, 0.3);
  // Outer fringe (beyond the berm, visible over it from height).
  for (let i = 0; i < 60; i++) {
    const x = (r() * 2 - 1) * 110, z = (r() * 2 - 1) * 110;
    if (Math.max(Math.abs(x), Math.abs(z)) > 66 && !keepOutOuter(x, z)) bushes.push({ x, z, scale: 1 + r() * 0.8, dry: r() < 0.4 });
  }

  // glTF plants (instanced) as extra ground clutter, density-scaled.
  const plantBudget = quality.foliageDensity;
  const place = (id: "shrub_03" | "fern_02" | "weed_plant_02", n: number, ring: () => [number, number], scale: () => number) => {
    let placed = 0, guard = 0;
    while (placed < Math.round(n * plantBudget) && guard++ < n * 20) {
      const [x, z] = ring();
      if (!clearOf(boxes, x, z, 0.4) || nearSpawn(x, z, 3) || track(x, z) > 0.4) continue;
      props.place(id, { x, y: 0, z, scale: scale(), rotY: r() * 6.28, variant: Math.floor(r() * 5) });
      placed++;
    }
  };
  const edgeRing = (inside: boolean) => (): [number, number] => {
    const a = (r() * 2 - 1) * (inside ? 29 : 46);
    const off = inside ? R - 0.9 - r() * 0.8 : R + 0.8 + r() * 1.5;
    const side = Math.floor(r() * 4);
    return side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
  };
  place("shrub_03", 24, edgeRing(false), () => 2.2 + r() * 1.2);
  const anchors = boxes.filter((x) => x.style === "rock" || x.tag === "tree");
  if (anchors.length) {
    place("fern_02", 18, () => {
      const b = anchors[Math.floor(r() * anchors.length)];
      return [b.x + (r() - 0.5) * (b.w + 2.5), b.z + (r() - 0.5) * (b.d + 2.5)];
    }, () => 1.6 + r() * 0.8);
  }
  place("weed_plant_02", 16, edgeRing(true), () => 4 + r() * 2.5);

  return {
    terrain: { height, splat, inner: 70, outer: 700 },
    foliage: { grass, grassBounds: 50, trees, bushes },
  };
};

