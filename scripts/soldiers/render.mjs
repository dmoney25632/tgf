// Tiny CPU rasteriser for checking poses offline: renders skinned meshes
// (textured from a top-down RGBA atlas, or flat grey) into a PNG.
import { THREE, writePNG } from "./lib.mjs";

/**
 * views: array of { yaw } (radians, camera orbit about Y). Each view is W x H,
 * placed side by side. extra: [{ a, b, color }] world-space line segments.
 */
export function render(path, meshes, { W = 320, H = 400, views = [{ yaw: 0 }, { yaw: Math.PI / 2 }], tex = null, center = new THREE.Vector3(0, 0.9, 0), span = 2.1, lines = [] } = {}) {
  const TW = W * views.length;
  const img = new Uint8Array(TW * H * 3).fill(235);
  const zb = new Float32Array(TW * H).fill(-1e9);
  const v = new THREE.Vector3();
  const tris = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    if (m.skeleton) m.skeleton.update();
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv;
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v);
      v.applyMatrix4(m.matrixWorld);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    const idx = g.index.array;
    const tint = m.userData.color ?? [180, 180, 180];
    for (let t = 0; t < idx.length; t += 3) tris.push([P, idx[t], idx[t + 1], idx[t + 2], uv, tint, m.userData.tex ?? tex]);
  }
  const L = new THREE.Vector3(0.4, 0.8, 0.6).normalize();
  views.forEach(({ yaw }, vi) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const sc = H / span;
    const proj = (x, y, z) => {
      const dx = x - center.x, dz = z - center.z;
      const rx = dx * c - dz * s, rz = dx * s + dz * c; // camera looks along -Z rotated
      return [vi * W + W / 2 + rx * sc, H / 2 - (y - center.y) * sc, rz];
    };
    for (const [P, a, b, d, uv, tint, tx] of tris) {
      const A = proj(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), B = proj(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), C = proj(P[d * 3], P[d * 3 + 1], P[d * 3 + 2]);
      // World normal for shading.
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
      const e2 = [P[d * 3] - P[a * 3], P[d * 3 + 1] - P[a * 3 + 1], P[d * 3 + 2] - P[a * 3 + 2]];
      const n = new THREE.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize();
      const sh = 0.35 + 0.65 * Math.abs(n.dot(L));
      const minX = Math.max(vi * W, Math.floor(Math.min(A[0], B[0], C[0]))), maxX = Math.min(vi * W + W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const k = y * TW + x;
        if (z <= zb[k]) continue;
        zb[k] = z;
        let col = tint;
        if (tx && uv) {
          const u = w0 * uv.getX(a) + w1 * uv.getX(b) + w2 * uv.getX(d);
          const vv = w0 * uv.getY(a) + w1 * uv.getY(b) + w2 * uv.getY(d);
          const ix = Math.min(tx.width - 1, Math.max(0, Math.floor(u * tx.width)));
          const iy = Math.min(tx.height - 1, Math.max(0, Math.floor((1 - vv) * tx.height)));
          const o = (iy * tx.width + ix) * 4;
          col = [tx.data[o], tx.data[o + 1], tx.data[o + 2]];
        }
        img[k * 3] = col[0] * sh; img[k * 3 + 1] = col[1] * sh; img[k * 3 + 2] = col[2] * sh;
      }
    }
    for (const { a, b, color = [255, 0, 0] } of lines) {
      const A = proj(a.x, a.y, a.z), B = proj(b.x, b.y, b.z);
      const n = Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1])) + 1;
      for (let i = 0; i <= n; i++) {
        const x = Math.round(A[0] + ((B[0] - A[0]) * i) / n), y = Math.round(A[1] + ((B[1] - A[1]) * i) / n);
        if (x < vi * W || x >= vi * W + W || y < 0 || y >= H) continue;
        const k = y * TW + x; img[k * 3] = color[0]; img[k * 3 + 1] = color[1]; img[k * 3 + 2] = color[2];
      }
    }
  });
  writePNG(path, img, TW, H, 3);
}
