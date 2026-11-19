import * as THREE from "three";
import type { WorldExtra } from "./dressing/common";
import type { WorldMaterials } from "./WorldMaterials";

export type PalmPlacement = { x: number; y: number; z: number; height: number; rot: number; lean: number };

function rnd(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit-height palm (top of trunk at y=1 before scaling): curved ringed trunk + frond crown. */
function makePalm(seed: number) {
  const r = rnd(seed);
  const H = 1;
  const bend = 0.06 + r() * 0.06;
  const spine = (t: number) => new THREE.Vector3(bend * t * t, t * H, 0);
  // Trunk: tapered tube with ring bumps (vertex colour carries the ring shading).
  const seg = 14, rad = 6;
  const tp: number[] = [], tn: number[] = [], tu: number[] = [], tc: number[] = [], ti: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = spine(t);
    const ring = 1 + 0.08 * Math.max(0, Math.sin(t * 60));
    const R = (0.028 - 0.01 * t) * ring;
    for (let k = 0; k <= rad; k++) {
      const a = (k / rad) * Math.PI * 2;
      tp.push(c.x + Math.cos(a) * R, c.y, c.z + Math.sin(a) * R);
      tn.push(Math.cos(a), 0, Math.sin(a));
      tu.push(k / rad, t * 6);
      const shade = 0.7 + 0.3 * Math.max(0, Math.sin(t * 60));
      tc.push(shade, shade * 0.95, shade * 0.85);
    }
  }
  for (let i = 0; i < seg; i++) for (let k = 0; k < rad; k++) {
    const a = i * (rad + 1) + k, b = a + rad + 1;
    ti.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  trunk.setAttribute("normal", new THREE.Float32BufferAttribute(tn, 3));
  trunk.setAttribute("uv", new THREE.Float32BufferAttribute(tu, 2));
  trunk.setAttribute("color", new THREE.Float32BufferAttribute(tc, 3));
  trunk.setIndex(ti);

  // Crown: arching fronds (strips, 6 segments) + a few dead ones hanging down.
  const fp: number[] = [], fn: number[] = [], fu: number[] = [], fc: number[] = [], fi: number[] = [];
  const top = spine(1);
  const fronds = 13;
  for (let f = 0; f < fronds; f++) {
    const dead = f >= fronds - 3;
    const yaw = (f / fronds) * Math.PI * 2 + r() * 0.4;
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const len = (dead ? 0.22 : 0.3) + r() * 0.08;
    const lift = dead ? -0.6 : 0.35 + r() * 0.4;
    const droop = dead ? 0.1 : 0.55 + r() * 0.3;
    const width = 0.075;
    const n = 6;
    const base = fp.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = top.clone().addScaledVector(dir, t * len);
      p.y += (lift * t - droop * t * t) * len;
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * (dead ? 0.5 : 1);
      // Fold the leaflets down along the rib (V-section) for volume.
      for (const sgn of [-1, 1]) {
        const q = p.clone().addScaledVector(side, sgn * w);
        q.y -= w * 0.35;
        fp.push(q.x, q.y, q.z);
        fn.push(0, 1, 0);
        fu.push(sgn < 0 ? 0 : 1, t);
        const g = dead ? [0.62, 0.5, 0.34] : [0.75 + r() * 0.1, 0.82 + r() * 0.12, 0.6];
        fc.push(g[0], g[1], g[2]);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      fi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  crown.setAttribute("normal", new THREE.Float32BufferAttribute(fn, 3));
  crown.setAttribute("uv", new THREE.Float32BufferAttribute(fu, 2));
  crown.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
  crown.setIndex(fi);
  crown.computeVertexNormals();
  return { trunk, crown };
}

/**
 * Date palms, instanced (two shape variants → four draw calls total). The
 * crown sways with the shared wind clock. Visual only: colliders, if any,
 * come from map boxes.
 */
export function palms(list: PalmPlacement[], wm: WorldMaterials, windTime: { value: number }): WorldExtra {
  const group = new THREE.Group();
  group.name = "palms";
  const variants = [makePalm(11), makePalm(23)];
  const bark = wm.get("bark");
  const frond = (wm.get("frond") as THREE.MeshStandardMaterial).clone();
  frond.onBeforeCompile = (shader) => {
    shader.uniforms.time = windTime;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float time;").replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iPos = vec3(instanceMatrix[3]);
      #else
        vec3 iPos = vec3(0.0);
      #endif
      float reach = length(position.xz);
      float sway = sin(time * 1.3 + iPos.x * 0.3 + iPos.z * 0.2) * 0.5 + sin(time * 3.1 + position.x * 30.0) * 0.15;
      transformed.y += sway * reach * 0.25;
      transformed.xz += vec2(0.6, 0.4) * sway * reach * 0.12;`,
    );
  };
  frond.customProgramCacheKey = () => "ih-frond";
  let tris = 0;
  const per = variants.map(() => [] as THREE.Matrix4[]);
  list.forEach((p, i) => {
    const s = p.height;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, p.y - 0.2, p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rot, p.lean)),
      new THREE.Vector3(s, s, s),
    );
    per[i % variants.length].push(m);
  });
  variants.forEach((v, i) => {
    const mats = per[i];
    if (!mats.length) return;
    for (const [geo, mat, shadow] of [[v.trunk, bark, true], [v.crown, frond, true]] as const) {
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      tris += (geo.index!.count / 3) * mats.length;
    }
  });
  return {
    object: group,
    triangles: tris,
    dispose() {
      for (const v of variants) {
        v.trunk.dispose();
        v.crown.dispose();
      }
      frond.dispose();
    },
  };
}
