import type { MeshBuilder } from "../MeshBuilder";
import type { ModelPlacer } from "../Props";
import { building, silhouette } from "../architecture/Building";
import { burntCar, rubblePile } from "../architecture/debris";
import type { PalmPlacement } from "../Palms";
import type { WorldDetail } from "../quality";

type Rect = { x0: number; x1: number; z0: number; z1: number };

export type TownSpec = {
  /** Inner edge of the first row, measured from the map centre on each side. */
  rows: { dist: number; depth: [number, number]; floors: [number, number]; detail: boolean }[];
  /** Half-length along each side covered by buildings. */
  span: number;
  height: (x: number, z: number) => number;
  /** Footprints to keep clear (roads, landmarks). */
  keepOut: Rect[];
  seed: number;
  detail: WorldDetail;
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

/**
 * The war-torn town around the outpost: rows of plastered blocks on all
 * four sides beyond the berm (the first row detailed on the side facing the
 * outpost, later rows plainer and taller for the skyline), the odd ruin and
 * burnt car, palms along the street, power poles with sagging cables, and
 * far silhouettes on the hills. All visual; nothing here has colliders.
 */
export function town(B: MeshBuilder, props: ModelPlacer, spec: TownSpec) {
  const r = rnd(spec.seed);
  const palms: PalmPlacement[] = [];
  const blocked = (x0: number, x1: number, z0: number, z1: number) =>
    spec.keepOut.some((k) => x1 > k.x0 && x0 < k.x1 && z1 > k.z0 && z0 < k.z1);
  const groundUnder = (x: number, z: number, w: number, d: number) => {
    let m = Infinity;
    for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) m = Math.min(m, spec.height(x + sx * w, z + sz * d));
    return m;
  };
  // side: 0 = north (z < 0, facing south toward the map), 1 = east, 2 = south, 3 = west.
  for (let side = 0; side < 4; side++) {
    const toMap = (side + 2) % 4; // facade index facing the outpost
    spec.rows.forEach((row, ri) => {
      let a = -spec.span + r() * 4;
      while (a < spec.span) {
        const w = 8 + r() * 7;
        const d = row.depth[0] + r() * (row.depth[1] - row.depth[0]);
        const along = a + w / 2;
        const out = row.dist + d / 2 + r() * 2;
        a += w + 2.5 + r() * 5;
        if (r() < 0.12) continue; // empty lot
        const [x, z, bw, bd] =
          side === 0 ? [along, -out, w, d] : side === 1 ? [out, along, d, w] : side === 2 ? [-along, out, w, d] : [-out, -along, d, w];
        if (blocked(x - bw / 2, x + bw / 2, z - bd / 2, z + bd / 2)) continue;
        const gy = groundUnder(x, z, bw, bd);
        const floors = Math.round(row.floors[0] + r() * (row.floors[1] - row.floors[0]));
        const ruin = ri === 0 && r() < 0.18;
        const detail = row.detail && spec.detail.backdropDetail;
        if (ri >= 2 || (!row.detail && !spec.detail.backdropDetail)) {
          silhouette(B, x, z, bw, bd, floors * 3.1, gy, Math.floor(r() * 1e6));
          continue;
        }
        const faces: [boolean, boolean, boolean, boolean] = [false, false, false, false];
        faces[toMap] = true;
        building(B, detail ? props : null, {
          x, z, w: bw, d: bd, floors, groundY: gy, seed: Math.floor(r() * 1e6),
          group: "far", detail, damage: 0.25 + r() * 0.7, ruin, front: toMap, faces,
          arcade: ri === 0 && r() < 0.25, hollow: true, back: side,
        });
        if (ri === 0) {
          // Street life in front of the first row: rubble from shelling, a palm, a wreck.
          const fx = x + (side === 1 ? -bw / 2 - 3 : side === 3 ? bw / 2 + 3 : 0);
          const fz = z + (side === 0 ? bd / 2 + 3 : side === 2 ? -bd / 2 - 3 : 0);
          if (ruin || r() < 0.3) rubblePile(B, fx + (r() - 0.5) * bw * 0.5, fz + (r() - 0.5) * bw * 0.5, 2 + r() * 2, 1.5 + r() * 1.5, 0.8 + r() * 1.2, Math.floor(r() * 1e6), "far", spec.height, 0.6);
          if (r() < 0.45) {
            const px = fx + (side % 2 ? 0 : (r() - 0.5) * bw), pz = fz + (side % 2 ? (r() - 0.5) * bw : 0);
            palms.push({ x: px, y: spec.height(px, pz), z: pz, height: 7 + r() * 5, rot: r() * 6.28, lean: (r() - 0.5) * 0.25 });
          }
          if (r() < 0.1) burntCar(B, fx, fz, side % 2 ? Math.PI / 2 : 0, r() < 0.5 ? "sedan" : "pickup", Math.floor(r() * 1e6), "far", spec.height(fx, fz));
        }
      }
    });
  }
  return { palms };
}
