import * as THREE from "three";
import type { WorldExtra } from "./dressing/common";

export type NetSpec = {
  /** Corner poles (x, z); the net is stretched over them and sags between. */
  corners: [number, number][];
  /** Pole-top height. */
  height: number;
  /** Extra drape below the edge between poles (m). */
  drape?: number;
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

/** Desert camo netting: tan/khaki/brown leaf scrim with holes (alpha-tested). */
function makeNetTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rnd(91);
  g.clearRect(0, 0, S, S);
  const cols = ["#b9a27a", "#9c8660", "#7c6a4a", "#c8b48c", "#6a5a3e"];
  // Leaf-cut scrim: many small irregular polygons, leaving gaps between.
  for (let i = 0; i < 900; i++) {
    const x = r() * S, y = r() * S, rad = 3 + r() * 7;
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.beginPath();
    const k = 5 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + r() * 0.5, rr = rad * (0.5 + r() * 0.6);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (j) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  // The knotted net grid underneath shows through the gaps.
  g.strokeStyle = "rgba(70,62,46,1)";
  g.lineWidth = 1.5;
  for (let i = 0; i <= S; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(S, i - 16);
    g.stroke();
  }
  // Punch some holes so the alpha test leaves a ragged see-through scrim.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 70; i++) {
    g.beginPath();
    g.arc(r() * S, r() * S, 2 + r() * 6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Camo nets stretched over poles: one alpha-tested, double-sided mesh for
 * all nets (one draw + one shadow draw), swaying in the shared wind. The
 * sag weight (aSag, 0 at the poles) scales the sway so poles stay put.
 * The poles themselves are merged static geometry (see the dressing).
 */
export function camoNets(nets: NetSpec[], windTime: { value: number }, height: (x: number, z: number) => number): WorldExtra {
  const pos: number[] = [], uv: number[] = [], sag: number[] = [], idx: number[] = [];
  const N = 10;
  const r = rnd(5);
  for (const net of nets) {
    const [a, b, c, d] = net.corners;
    const base = pos.length / 3;
    const bilerp = (u: number, v: number) => {
      const x = (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c[0] + (1 - u) * v * d[0];
      const z = (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c[1] + (1 - u) * v * d[1];
      return [x, z];
    };
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N, v = j / N;
        const [x, z] = bilerp(u, v);
        // Sag: zero at the four corners, deepest mid-span; edges hang lower.
        const mid = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        const edge = Math.max(Math.sin(Math.PI * u) * (v === 0 || v === 1 ? 1 : 0), Math.sin(Math.PI * v) * (u === 0 || u === 1 ? 1 : 0));
        const s = mid * 0.55 + edge * (net.drape ?? 0.5) + (r() - 0.5) * 0.08 * mid;
        pos.push(x, height(x, z) + net.height - s, z);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), wid = Math.hypot(d[0] - a[0], d[1] - a[1]);
        uv.push((u * len) / 2.2, (v * wid) / 2.2);
        sag.push(Math.min(1, mid * 1.6 + edge));
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const p = base + j * (N + 1) + i;
        idx.push(p, p + N + 1, p + 1, p + 1, p + N + 1, p + N + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("aSag", new THREE.Float32BufferAttribute(sag, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const map = makeNetTexture();
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  mat.name = "ih-camonet";
  const sway = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.time = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float time;\nattribute float aSag;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        float w = sin(time * 1.4 + position.x * 0.6 + position.z * 0.4) * 0.6 + sin(time * 3.3 + position.x * 2.1 - position.z * 1.7) * 0.25;
        transformed.y += w * aSag * 0.12;
        transformed.xz += vec2(0.7, 0.5) * w * aSag * 0.05;`,
      );
  };
  mat.onBeforeCompile = sway;
  mat.customProgramCacheKey = () => "ih-camonet";
  // Shadows: same sway and alpha cut-out in the depth pass.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  depth.onBeforeCompile = sway;
  depth.customProgramCacheKey = () => "ih-camonet-depth";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "camonet";
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "camonets";
  group.add(mesh);
  return {
    object: group,
    triangles: idx.length / 3,
    dispose() {
      geo.dispose();
      map.dispose();
      mat.dispose();
      depth.dispose();
    },
  };
}
