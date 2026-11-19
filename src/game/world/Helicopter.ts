import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldExtra } from "./dressing/common";
import type { QualityName } from "../config";

/**
 * A distant utility helicopter flying a slow, lazy loop around the map
 * (pure backdrop, never closer than ~150 m). Two draws: a merged body and
 * a motion-blurred rotor disc. Hidden on low.
 */
export function helicopter(clock: { value: number }, center: THREE.Vector2, radius: number, altitude: number): WorldExtra {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  // Fuselage (+x forward): rounded cabin, tapering tail boom, fin, skids.
  const cabin = new THREE.SphereGeometry(1, 12, 8);
  add(cabin, T(0.6, 0, 0).multiply(new THREE.Matrix4().makeScale(2.6, 1.25, 1.15)));
  const boom = new THREE.CylinderGeometry(0.22, 0.45, 5.5, 8);
  add(boom, T(-4.2, 0.25, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  add(new THREE.BoxGeometry(0.9, 1.5, 0.1), T(-6.9, 0.9, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.35)));
  add(new THREE.BoxGeometry(1.3, 0.08, 1.8), T(-6.3, 0.25, 0));
  add(new THREE.BoxGeometry(0.9, 0.4, 0.9), T(0.4, 1.35, 0));
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(3.6, 0.08, 0.08), T(0.4, -1.55, s * 0.95));
    for (const x of [-0.5, 1.3]) add(new THREE.BoxGeometry(0.08, 0.5, 0.08), T(x, -1.3, s * 0.85));
  }
  const body = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  body.computeVertexNormals();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a4e3e, roughness: 0.7, metalness: 0.2 });
  const bodyMesh = new THREE.Mesh(body, bodyMat);
  // Rotor: a translucent disc with blade-streak rings (no spinning geometry).
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(30,30,28,0.55)");
  grad.addColorStop(0.85, "rgba(30,30,28,0.28)");
  grad.addColorStop(1, "rgba(30,30,28,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 64, 63, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const discMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const discGeo = new THREE.CircleGeometry(5.6, 24);
  discGeo.rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.set(0.4, 1.6, 0);
  disc.renderOrder = 2;
  const heli = new THREE.Group();
  heli.name = "helicopter";
  heli.add(bodyMesh, disc);
  for (const m of [bodyMesh, disc]) m.castShadow = m.receiveShadow = false;
  const speed = 0.045; // rad/s round the loop
  let enabled = true;
  return {
    object: heli,
    triangles: body.attributes.position.count / 3 + 24,
    update() {
      heli.visible = enabled;
      if (!enabled) return;
      const t = clock.value * speed;
      // Lissajous-ish loop: wanders in and out, rises and dips a little.
      const a = t, rr = radius * (1 + 0.18 * Math.sin(t * 2.3));
      const x = center.x + Math.cos(a) * rr, z = center.y + Math.sin(a) * rr;
      heli.position.set(x, altitude + 6 * Math.sin(t * 3.1), z);
      // Face along the path (derivative), bank into the turn, nose down a touch.
      const dx = -Math.sin(a) * rr, dz = Math.cos(a) * rr;
      heli.rotation.set(0, Math.atan2(-dz, dx), 0);
      heli.rotateX(-0.12);
      heli.rotateZ(-0.08);
      disc.rotation.y = clock.value * 9;
    },
    setQuality(q: QualityName) {
      enabled = q !== "low";
    },
    dispose() {
      body.dispose();
      bodyMat.dispose();
      discGeo.dispose();
      discMat.dispose();
      tex.dispose();
    },
  };
}
