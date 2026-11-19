import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/**
 * Tiny build-time helper for procedural props (armour plates, airframes):
 * accumulates primitives with a transform and a vertex colour, then merges
 * them into ONE non-indexed geometry (position / normal / color) so a whole
 * part draws in a single call with one shared vertex-coloured material.
 * Build time only — never call from the frame loop.
 */
export class PartGeometry {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Adds `geo` (consumed) at (x, y, z) with Euler rotation (rx, ry, rz) and scale. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute("uv");
    g.deleteAttribute("uv1");
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    _c.set(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  cyl(rTop: number, rBottom: number, h: number, seg: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1), color, x, y, z, rx, ry, rz);
  }

  /** Ellipsoid (scaled sphere). */
  blob(rx: number, ry: number, rz: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, seg = 10, pitch = 0, yaw = 0, roll = 0) {
    return this.add(new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.6))), color, x, y, z, pitch, yaw, roll, rx, ry, rz);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build() {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}
