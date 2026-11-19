import * as THREE from "three";
import type { Surface } from "../effects/EffectsPool";
import type { MaterialName } from "../render/Materials";
import type { MapBox } from "./MapLoader";
import { makeSandbagGeometry, type MeshBuilder } from "./MeshBuilder";
import type { ModelPlacer } from "./Props";
import { rng } from "./Foliage";

/** Telephone pole top height (m) — wires hang from just below. */
export const POLE_HEIGHT = 8.6;

export const DEFAULT_MATERIAL: Record<Surface, MaterialName> = {
  concrete: "concrete",
  metal: "metal_painted",
  wood: "wood",
  sand: "sandbag",
  target: "plain",
  steel: "metal_dark",
  flesh: "plain",
  armor: "plain",
};

/** Bullet-impact surface for a material (merged meshes carry it in userData). */
export function surfaceOf(mat: MaterialName): Surface {
  switch (mat) {
    case "metal_corrugated":
    case "metal_painted":
    case "metal_rust":
    case "metal_dark":
      return "metal";
    case "wood":
    case "bark":
      return "wood";
    case "sandbag":
    case "canvas":
    case "gravel":
    case "ground":
      return "sand";
    default:
      return "concrete";
  }
}

export type StyleKit = {
  builder: MeshBuilder;
  props: ModelPlacer;
  sandbag: THREE.BufferGeometry;
};

export function createStyleKit(builder: MeshBuilder, props: ModelPlacer): StyleKit {
  return { builder, props, sandbag: makeSandbagGeometry() };
}

const seedOf = (b: MapBox) => Math.abs(Math.round(b.x * 73.1 + b.z * 31.7 + (b.y ?? 0) * 11.3 + b.w * 5.1)) + 1;

/** Slightly varied tint (keeps repeated props from looking cloned). */
function vary(hex: number, r: () => number, amt = 0.08) {
  const c = new THREE.Color(hex);
  const k = 1 + (r() * 2 - 1) * amt;
  return c.multiplyScalar(k);
}

/** Invisible-but-raycastable collider face for boxes drawn as something else. */
function proxy(kit: StyleKit, b: MapBox, surface: Surface) {
  if (b.decor) return;
  const y = b.y ?? 0;
  kit.builder.boxFeet("plain", b.x, y, b.z, b.w, b.h, b.d, 0xffffff, { group: `proxy:${surface}` });
}

/**
 * Draws one map box according to its `style`. Colliders are untouched
 * (MapLoader registers the AABB); styles only decide what you see and which
 * mesh bullets hit. Detail pieces are "decor" (merged, not raycast).
 */
export function drawBox(kit: StyleKit, b: MapBox) {
  const B = kit.builder;
  const y = b.y ?? 0;
  const surface = b.surface ?? "concrete";
  const mat = b.mat ?? DEFAULT_MATERIAL[surface];
  const group = b.decor ? "decor" : "solid";
  const r = rng(seedOf(b));
  const style = b.style ?? "plain";

  switch (style) {
    case "plain":
      B.boxFeet(mat, b.x, y, b.z, b.w, b.h, b.d, b.color, { group, rot90: b.rot90 });
      return;

    case "hidden":
      proxy(kit, b, surface);
      return;

    case "crate": {
      B.boxFeet(mat, b.x, y, b.z, b.w, b.h, b.d, vary(b.color, r), { group, rot90: r() > 0.5, uvOffset: [r() * 3, r() * 3] });
      // Edge battens + a mid band, a couple of cm proud.
      const t = 0.07, o = 0.025;
      const tint = vary(b.color, r, 0.05).multiplyScalar(0.8);
      const cy = y + b.h / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box("wood", b.x + sx * (b.w / 2 - t / 2 + o), cy, b.z + sz * (b.d / 2 - t / 2 + o), t, b.h + 0.01, t, tint);
      for (const yy of [y + t / 2, y + b.h - t / 2, y + b.h / 2]) {
        for (const sz of [-1, 1]) B.box("wood", b.x, yy, b.z + sz * (b.d / 2 + o - 0.01), b.w + 2 * o, t, 0.03, tint, { rot90: true });
        for (const sx of [-1, 1]) B.box("wood", b.x + sx * (b.w / 2 + o - 0.01), yy, b.z, 0.03, t, b.d + 2 * o, tint, { rot90: true });
      }
      return;
    }

    case "container": {
      B.boxFeet("metal_corrugated", b.x, y, b.z, b.w, b.h, b.d, b.color, { group, uvOffset: [r() * 5, 0] });
      const dark = new THREE.Color(b.color).multiplyScalar(0.55);
      const p = 0.16;
      // Corner posts and top/bottom rails.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box("metal_painted", b.x + sx * (b.w / 2 - p / 2 + 0.03), y + b.h / 2, b.z + sz * (b.d / 2 - p / 2 + 0.03), p, b.h + 0.02, p, dark);
      for (const yy of [y + 0.08, y + b.h - 0.08]) {
        for (const sz of [-1, 1]) B.box("metal_painted", b.x, yy, b.z + sz * (b.d / 2 + 0.02), b.w, 0.16, 0.08, dark);
        for (const sx of [-1, 1]) B.box("metal_painted", b.x + sx * (b.w / 2 + 0.02), yy, b.z, 0.08, 0.16, b.d, dark);
      }
      // Door end: locking bars on the short face.
      const alongX = b.w >= b.d;
      const end = r() > 0.5 ? 1 : -1;
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * ((alongX ? b.d : b.w) / 4.4);
        if (alongX) B.box("metal_dark", b.x + end * (b.w / 2 + 0.05), y + b.h / 2, b.z + off, 0.04, b.h - 0.3, 0.04, 0x3a3a38);
        else B.box("metal_dark", b.x + off, y + b.h / 2, b.z + end * (b.d / 2 + 0.05), 0.04, b.h - 0.3, 0.04, 0x3a3a38);
      }
      return;
    }

    case "sandbags": {
      proxy(kit, b, "sand");
      const alongX = b.w >= b.d;
      const len = alongX ? b.w : b.d;
      const depth = alongX ? b.d : b.w;
      const bagL = 0.62, bagH = 0.17, bagW = 0.38;
      const rows = Math.max(1, Math.round(b.h / (bagH * 0.92)));
      const cols = Math.max(1, Math.round(depth / bagW));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const tint = new THREE.Color(b.color);
      for (let row = 0; row < rows; row++) {
        const n = Math.max(1, Math.round(len / bagL));
        const stagger = row % 2 ? 0.5 : 0;
        for (let c = 0; c < cols; c++) {
          // Hidden inner bags are skipped (only faces and the top course show).
          if (c > 0 && c < cols - 1 && row < rows - 1) continue;
          for (let i = 0; i < n + (stagger ? -1 : 0); i++) {
            const a = (-len / 2 + (i + 0.5 + stagger) * (len / n));
            const across = -depth / 2 + (c + 0.5) * (depth / cols);
            const yy = y + (row + 0.5) * (b.h / rows);
            e.set((r() - 0.5) * 0.06, (alongX ? 0 : Math.PI / 2) + (r() - 0.5) * 0.12, (r() - 0.5) * 0.06);
            q.setFromEuler(e);
            m.compose(
              new THREE.Vector3(alongX ? b.x + a : b.x + across, yy, alongX ? b.z + across : b.z + a),
              q,
              new THREE.Vector3((len / n) * 1.04, (b.h / rows) * 1.18, (depth / cols) * 1.06),
            );
            B.add(kit.sandbag, m, "sandbag", vary(tint.getHex(), r, 0.1), { uv: "keep", uvScale: [1.6, 0.5], uvOffset: [r() * 4, r() * 4] });
          }
        }
      }
      return;
    }

    case "barrier": {
      proxy(kit, b, "concrete");
      const alongX = b.w >= b.d;
      const len = alongX ? b.w : b.d;
      const hw = (alongX ? b.d : b.w) / 2;
      const h = b.h;
      const shape = new THREE.Shape();
      const pts: [number, number][] = [
        [-hw, 0], [hw, 0], [hw, 0.08], [hw * 0.72, 0.3], [hw * 0.38, h * 0.95], [hw * 0.3, h], [-hw * 0.3, h], [-hw * 0.38, h * 0.95], [-hw * 0.72, 0.3], [-hw, 0.08],
      ];
      shape.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) shape.lineTo(px, py);
      const sections = len > 2.2 ? 2 : 1;
      const segL = len / sections - 0.04;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: segL, bevelEnabled: false });
      geo.translate(0, 0, -segL / 2);
      const m = new THREE.Matrix4();
      for (let i = 0; i < sections; i++) {
        const a = -len / 2 + (i + 0.5) * (len / sections);
        const yaw = (alongX ? Math.PI / 2 : 0) + (r() - 0.5) * 0.03;
        m.makeRotationY(yaw).setPosition(alongX ? b.x + a : b.x, y, alongX ? b.z : b.z + a);
        B.add(geo, m, "concrete_dirty", vary(b.color, r, 0.06), { uvOffset: [r() * 4, 0] });
      }
      geo.dispose();
      return;
    }

    case "rock": {
      proxy(kit, b, "sand");
      kit.props.place(
        "rock_moss_set_01",
        { x: b.x, y, z: b.z, fit: [b.w * 1.12, b.h * 1.08, b.d * 1.12], rotY: Math.round(r() * 3) * (Math.PI / 2), variant: Math.floor(r() * 6), sink: b.h * 0.08 },
        (bb, g) => {
          const geo = new THREE.IcosahedronGeometry(0.5, 2);
          const p = geo.attributes.position as THREE.BufferAttribute;
          const v = new THREE.Vector3();
          const ph = r() * 10;
          for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i);
            const n = 1 + 0.18 * Math.sin(v.x * 9 + ph) * Math.cos(v.z * 7 - ph) + 0.08 * Math.sin(v.y * 15 + ph);
            v.multiplyScalar(n);
            v.y = Math.max(v.y, -0.35);
            p.setXYZ(i, v.x, v.y, v.z);
          }
          geo.computeVertexNormals();
          const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, y + b.h * 0.42, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w * 1.1, b.h * 1.15, b.d * 1.1));
          bb.add(geo, m, "rock", b.color, { group: g });
          geo.dispose();
        },
      );
      return;
    }

    case "model": {
      proxy(kit, b, surface);
      if (!b.model) return;
      kit.props.place(b.model, { x: b.x, y, z: b.z, fit: [b.w, b.h, b.d], rotY: b.rotY ?? 0 }, (bb, g) => {
        if (/barrel/i.test(b.model!)) {
          const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, y + b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
          bb.add(geo, m, "metal_painted", b.color, { group: g, uv: "keep", uvScale: [b.w * 3.14, b.h] });
          geo.dispose();
        } else bb.boxFeet(mat, b.x, y, b.z, b.w, b.h, b.d, b.color, { group: g });
      });
      return;
    }

    case "tank": {
      proxy(kit, b, "metal");
      const alongX = b.w >= b.d;
      const len = alongX ? b.w : b.d;
      const rad = Math.min(b.h, alongX ? b.d : b.w) / 2 - 0.05;
      const geo = new THREE.CylinderGeometry(rad, rad, len - 0.1, 18, 1, false);
      const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
      if (!alongX) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      m.setPosition(b.x, y + b.h - rad - 0.02, b.z);
      B.add(geo, m, "metal_painted", b.color, { uv: "keep", uvScale: [rad * 6.28, len] });
      geo.dispose();
      // Saddles + filler cap.
      for (const s of [-1, 1]) {
        const o = s * len * 0.3;
        B.box("concrete_dirty", alongX ? b.x + o : b.x, y + 0.2, alongX ? b.z : b.z + o, alongX ? 0.3 : b.w * 0.9, 0.4, alongX ? b.d * 0.9 : 0.3, 0x8a877e);
      }
      B.box("metal_dark", b.x, y + b.h - 0.02, b.z, 0.25, 0.12, 0.25, 0x2e2f30);
      return;
    }

    case "bale": {
      // Plastic-wrapped round bale standing on end, slightly squashed.
      proxy(kit, b, "sand");
      const rad = Math.min(b.w, b.d) / 2;
      const geo = new THREE.CylinderGeometry(rad * 0.97, rad, b.h, 20, 3);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const yy = p.getY(i) / b.h + 0.5;
        const bulge = 1 + 0.04 * Math.sin(yy * Math.PI);
        p.setXYZ(i, p.getX(i) * bulge, p.getY(i), p.getZ(i) * bulge);
      }
      geo.computeVertexNormals();
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, y + b.h / 2, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(1, 1, 1));
      B.add(geo, m, "canvas", vary(b.color, r, 0.06), { uv: "keep", uvScale: [rad * 6.28, b.h], uvOffset: [r() * 3, 0] });
      geo.dispose();
      return;
    }

    case "pole": {
      proxy(kit, b, "wood");
      drawPole(B, b.x, y, b.z, b.rotY ?? 0, r);
      return;
    }

    case "perch": {
      // Timber-revetted earth platform: horizontal planks, posts, earth top, ladder.
      B.boxFeet("wood", b.x, y, b.z, b.w, b.h, b.d, b.color, { group, rot90: true });
      const post = 0.26;
      const postTint = new THREE.Color(b.color).multiplyScalar(0.7);
      for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
        if (sx === 0 && sz === 0) continue;
        B.box("wood", b.x + sx * (b.w / 2 + 0.04), y + b.h / 2 + 0.1, b.z + sz * (b.d / 2 + 0.04), post, b.h + 0.2, post, postTint);
      }
      B.box("ground", b.x, y + b.h + 0.01, b.z, b.w + 0.1, 0.04, b.d + 0.1, 0xa09a88);
      // Ladder on the side facing the map centre.
      const sx = -Math.sign(b.x), sz = -Math.sign(b.z);
      const lx = b.x + sx * (b.w / 2 + 0.25);
      for (const o of [-0.25, 0.25]) B.box("wood", lx, y + b.h / 2 + 0.4, b.z + o + sz * 0.8, 0.08, b.h + 0.8, 0.08, postTint);
      for (let k = 0.3; k < b.h + 0.3; k += 0.32) B.box("wood", lx, y + k, b.z + sz * 0.8, 0.05, 0.05, 0.5, postTint);
      return;
    }

    case "berm": {
      // Collider face: timber revetment (horizontal planks, posts, walers);
      // behind it an earth embankment slopes away from the map.
      const alongX = b.w >= b.d;
      B.boxFeet("wood", b.x, y, b.z, b.w, b.h, b.d, b.color, { group, rot90: true });
      const inward = alongX ? -Math.sign(b.z) : -Math.sign(b.x);
      const len = alongX ? b.w : b.d;
      const faceOff = (alongX ? b.d : b.w) / 2 + 0.08;
      const postTint = new THREE.Color(b.color).multiplyScalar(0.62);
      for (let a = -len / 2 + 1.2; a < len / 2; a += 2.4) {
        if (alongX) B.box("wood", b.x + a, y + b.h / 2, b.z + inward * faceOff, 0.24, b.h + 0.15, 0.16, postTint);
        else B.box("wood", b.x + inward * faceOff, y + b.h / 2, b.z + a, 0.16, b.h + 0.15, 0.24, postTint);
      }
      for (const wy of [y + 1.9, y + 4.1]) {
        if (alongX) B.box("wood", b.x, wy, b.z + inward * (faceOff + 0.1), len, 0.2, 0.12, postTint, { rot90: true });
        else B.box("wood", b.x + inward * (faceOff + 0.1), wy, b.z, 0.12, 0.2, len, postTint, { rot90: true });
      }
      // Earth: a ribbon profile extruded along the berm.
      const half = (alongX ? b.d : b.w) / 2;
      const prof: [number, number][] = [
        [-half - 0.05, b.h - 0.05], [-half + 0.4, b.h + 0.25], [half * 0.4, b.h + 0.45], [half + 2, b.h - 0.5], [half + 6, b.h * 0.45], [half + 11, 0.3], [half + 14, -0.6],
      ];
      const pos: number[] = [];
      const idx: number[] = [];
      const steps = Math.ceil(len / 2);
      const nz = (u: number, v: number) => Math.sin(u * 0.7 + v * 1.3) * 0.25 + Math.sin(u * 1.9 - v * 0.4) * 0.15;
      for (let i = 0; i <= steps; i++) {
        const a = -len / 2 + (i / steps) * len;
        for (let k = 0; k < prof.length; k++) {
          const [o, hh] = prof[k];
          const out = -inward * o;
          const jitter = k > 1 ? nz(a, k) : 0;
          const px = alongX ? b.x + a : b.x + out + (k > 2 ? -inward * jitter : 0);
          const pz = alongX ? b.z + out + (k > 2 ? -inward * jitter : 0) : b.z + a;
          pos.push(px, y + hh + (k > 0 && k < prof.length - 1 ? jitter * 0.6 : 0), pz);
        }
        if (i > 0) {
          const p0 = (i - 1) * prof.length, p1 = i * prof.length;
          for (let k = 0; k < prof.length - 1; k++) idx.push(p0 + k, p1 + k, p0 + k + 1, p0 + k + 1, p1 + k, p1 + k + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      // Winding depends on which side faces out; make normals point up.
      geo.computeVertexNormals();
      const ny = geo.attributes.normal.getY(1);
      if (ny < 0) {
        const ix = geo.index!.array as unknown as number[];
        for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
        geo.index!.needsUpdate = true;
        geo.computeVertexNormals();
      }
      B.add(geo, null, "ground", 0xb8b098);
      geo.dispose();
      return;
    }
  }
}

/** Wooden telephone pole (base at y) with a cross-arm and insulators. */
export function drawPole(B: MeshBuilder, x: number, y: number, z: number, rotY: number, r: () => number) {
  const lean = (r() - 0.5) * 0.012;
  const geo = new THREE.CylinderGeometry(0.11, 0.15, POLE_HEIGHT + 0.6, 10);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y + (POLE_HEIGHT + 0.6) / 2 - 0.5, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, rotY, lean)),
    new THREE.Vector3(1, 1, 1),
  );
  B.add(geo, m, "wood", 0x6a5a48, { uv: "keep", uvScale: [0.8, POLE_HEIGHT] });
  geo.dispose();
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const top = y + POLE_HEIGHT - 0.6;
  B.box("wood", x, top, z, 2.1, 0.11, 0.11, 0x5a4c3c, { rotY, rot90: true });
  for (const o of [-0.85, 0, 0.85]) B.box("plain", x + c * o, top + 0.13, z - s * o, 0.07, 0.16, 0.07, 0x2c4a3e);
  // A transformer can on some poles.
  if (r() < 0.3) {
    const can = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10);
    B.add(can, new THREE.Matrix4().makeTranslation(x + s * 0.3, top - 1.1, z + c * 0.3), "metal_painted", 0x7d817c, { uv: "keep", uvScale: [1.4, 0.7] });
    can.dispose();
  }
}

/** Wire attachment points (world) for a pole, along its cross-arm. */
export function poleWirePoints(x: number, y: number, z: number, rotY: number) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const top = y + POLE_HEIGHT - 0.6 + 0.2;
  return [-0.85, 0, 0.85].map((o) => new THREE.Vector3(x + c * o, top, z - s * o));
}
