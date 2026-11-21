import * as THREE from "three";
import type { QualityPreset } from "../config";
import type { MaterialLibrary } from "../render/Materials";
import { leafPixels, makeDataTexture } from "../render/ProceduralTextures";

export type TreePlacement = { x: number; z: number; scale: number; variant: number; rot: number };
export type BushPlacement = { x: number; z: number; scale: number; dry?: boolean };

export type FoliageSpec = {
  /** Grass density 0..1 at a point. */
  grass(x: number, z: number): number;
  /** Grass is scattered within ±grassBounds. */
  grassBounds: number;
  trees: TreePlacement[];
  bushes: BushPlacement[];
  /** Waist-high dry grass density 0..1 (scattered within ±tallGrassBounds). */
  tallGrass?(x: number, z: number): number;
  tallGrassBounds?: number;
  /** Short-grass colours (sRGB hex); defaults are a dry, sunburnt mix. */
  grassPalette?: Partial<GrassPalette>;
};

/** Patches blend dry → lush with age; the sparsest patches go brown or rusty. */
export type GrassPalette = { dry: number; lush: number; brown: number; rust: number };
const DRY_GRASS: GrassPalette = { dry: 0xa59a68, lush: 0x6f7a44, brown: 0x7d6a48, rust: 0x8a5a3a };

/** Deterministic RNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grass clump: `blades` tapered, leaning blades (3 tris each), unit height, rounded normals. `width` scales blade width, `spread` the clump radius. */
function makeGrassClump(r: () => number, blades = 6, width = 1, spread = 0.14) {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2;
    const off = Math.sqrt(r()) * spread;
    const ox = Math.cos(a) * off, oz = Math.sin(a) * off;
    const lean = (r() * 2 - 1) * 0.6 + Math.PI;
    const lx = Math.cos(a + lean * 0.2) * (0.15 + r() * 0.25), lz = Math.sin(a + lean * 0.2) * (0.15 + r() * 0.25);
    const face = r() * Math.PI;
    const px = Math.cos(face), pz = Math.sin(face);
    const w = (0.022 + r() * 0.015) * width;
    const h = 0.65 + r() * 0.35;
    const base = pos.length / 3;
    const lvl = [
      [0, 1],
      [0.5, 0.7],
    ];
    for (const [t, wf] of lvl) {
      const bend = t * t;
      const cx = ox + lx * bend, cz = oz + lz * bend;
      pos.push(cx - px * w * wf, t * h, cz - pz * w * wf, cx + px * w * wf, t * h, cz + pz * w * wf);
      const c = 0.42 + t * 0.58;
      col.push(c, c, c, c, c, c);
    }
    pos.push(ox + lx, h, oz + lz);
    col.push(1, 1, 1);
    // Rounded normals: the blade's face normal tipped up and out from the clump
    // centre, bent further towards its own lean at the tip (shading varies across blades).
    const fx = -pz, fz = px;
    const ol = Math.hypot(ox + lx, oz + lz) || 1;
    for (let k = 0; k < 5; k++) {
      const t = k < 2 ? 0 : k < 4 ? 0.5 : 1;
      const n = new THREE.Vector3(fx * 0.55 + ((ox + lx) / ol) * (0.25 + t * 0.3), 0.75 - t * 0.15, fz * 0.55 + ((oz + lz) / ol) * (0.25 + t * 0.3)).normalize();
      nor.push(n.x, n.y, n.z);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

type Cluster = { c: THREE.Vector3; size: number };

/** Appends `count` crossed cards around a cluster with crown-spherical normals. */
function addCards(cl: Cluster, crown: THREE.Vector3, r: () => number, pos: number[], nor: number[], uv: number[], idx: number[], cards = 3) {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corners = [
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
  ];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let k = 0; k < cards; k++) {
    e.set((r() - 0.5) * 1.2, (k / cards) * Math.PI + r() * 0.5, (r() - 0.5) * 0.8);
    q.setFromEuler(e);
    const base = pos.length / 3;
    const s = cl.size * (0.8 + r() * 0.4);
    for (const [cx, cy] of corners) {
      v.set(cx * s, cy * s * 0.85, 0).applyQuaternion(q).add(cl.c);
      pos.push(v.x, v.y, v.z);
      n.subVectors(v, crown).normalize();
      n.y = n.y * 0.6 + 0.4;
      n.normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(cx + 0.5, cy + 0.5);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Tapered tube along a path with UVs in metres and a darker base. */
function addTube(path: THREE.Vector3[], r0: number, r1: number, radial: number, pos: number[], nor: number[], uv: number[], col: number[], idx: number[]) {
  const n = path.length;
  const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += path[i].distanceTo(path[i - 1]);
    t.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    a.set(0, 0, 1);
    if (Math.abs(t.dot(a)) > 0.9) a.set(1, 0, 0);
    a.cross(t).normalize();
    b.crossVectors(t, a).normalize();
    const rad = r0 + (r1 - r0) * (i / (n - 1));
    const base = pos.length / 3;
    for (let k = 0; k <= radial; k++) {
      const ang = (k / radial) * Math.PI * 2;
      d.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
      pos.push(path[i].x + d.x * rad, path[i].y + d.y * rad, path[i].z + d.z * rad);
      nor.push(d.x, d.y, d.z);
      uv.push((k / radial) * Math.PI * 2 * Math.max(rad, 0.08), len);
      const shade = 0.75 + Math.min(1, path[i].y / 2) * 0.25;
      col.push(shade, shade, shade);
    }
    if (i > 0) {
      const p0 = base - (radial + 1);
      for (let k = 0; k < radial; k++) {
        idx.push(p0 + k, base + k, p0 + k + 1, p0 + k + 1, base + k, base + k + 1);
      }
    }
  }
}

type TreeKind = { height: number; radius: number; branches: number; clusters: number; size: number; crownWidth: number; dry: boolean; leafy: number };
const TREE_KINDS: TreeKind[] = [
  { height: 9.5, radius: 0.3, branches: 6, clusters: 20, size: 2.8, crownWidth: 3.6, dry: false, leafy: 1 }, // broad
  { height: 12, radius: 0.22, branches: 8, clusters: 18, size: 2.2, crownWidth: 2.0, dry: false, leafy: 1 }, // tall narrow
  { height: 7.5, radius: 0.24, branches: 6, clusters: 6, size: 1.8, crownWidth: 2.6, dry: true, leafy: 0.3 }, // dying
  { height: 5.5, radius: 0.13, branches: 4, clusters: 10, size: 1.8, crownWidth: 1.8, dry: false, leafy: 1 }, // young
];
export const TREE_VARIANTS = TREE_KINDS.length;

/** Procedural tree: bent trunk, branches, and leaf-card clusters. */
function makeTree(kind: TreeKind, seed: number) {
  const r = rng(seed);
  const bp: number[] = [], bn: number[] = [], bu: number[] = [], bc: number[] = [], bi: number[] = [];
  const lp: number[] = [], ln: number[] = [], lu: number[] = [], li: number[] = [];
  const H = kind.height;
  const bendX = (r() - 0.5) * 0.8, bendZ = (r() - 0.5) * 0.8;
  const trunkAt = (t: number) => new THREE.Vector3(bendX * t * t + Math.sin(t * 5 + seed) * 0.08, t * H * 0.82, bendZ * t * t);
  const trunk: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) trunk.push(trunkAt(i / 6));
  trunk[0].y = -0.3;
  addTube(trunk, kind.radius * 1.25, kind.radius * 0.25, 7, bp, bn, bu, bc, bi);
  const crown = new THREE.Vector3(bendX, H * 0.7, bendZ);
  const clusters: Cluster[] = [];
  for (let b = 0; b < kind.branches; b++) {
    const t = 0.4 + (b / kind.branches) * 0.45 + r() * 0.05;
    const start = trunkAt(t);
    const ang = b * 2.4 + r() * 0.6;
    const len = kind.crownWidth * (0.6 + r() * 0.5) * (1.1 - t * 0.4);
    const up = 0.4 + r() * 0.6;
    const dir = new THREE.Vector3(Math.cos(ang), up, Math.sin(ang)).normalize();
    const mid = start.clone().addScaledVector(dir, len * 0.5);
    mid.y += 0.2;
    const end = start.clone().addScaledVector(dir, len);
    end.y += kind.dry ? 0.1 : 0.4;
    addTube([start, mid, end], kind.radius * 0.35, 0.025, 5, bp, bn, bu, bc, bi);
    if (r() < kind.leafy) clusters.push({ c: end, size: kind.size }, { c: mid.clone().add(new THREE.Vector3(0, 0.3, 0)), size: kind.size * 0.8 });
  }
  const leafCount = Math.round(kind.clusters * kind.leafy);
  for (let i = clusters.length; i < leafCount; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * kind.crownWidth * 0.8;
    const y = H * (0.55 + r() * 0.42);
    clusters.push({ c: new THREE.Vector3(bendX + Math.cos(a) * rr, y, bendZ + Math.sin(a) * rr), size: kind.size * (0.7 + r() * 0.5) });
  }
  for (const cl of clusters) addCards(cl, crown, r, lp, ln, lu, li);
  const bark = new THREE.BufferGeometry();
  bark.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
  bark.setAttribute("normal", new THREE.Float32BufferAttribute(bn, 3));
  bark.setAttribute("uv", new THREE.Float32BufferAttribute(bu, 2));
  bark.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
  bark.setIndex(bi);
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
  leaves.setAttribute("normal", new THREE.Float32BufferAttribute(ln, 3));
  leaves.setAttribute("uv", new THREE.Float32BufferAttribute(lu, 2));
  leaves.setIndex(li);
  return { bark, leaves };
}

/** Indirect-light multiplier for Lambert vegetation (≈ hemisphere + the IBL it can't see). */
const VEG_SKY_FILL = 1.9;

/** Wind + distance fade for instanced vegetation (Lambert). */
function windHook(time: { value: number }, fadeFar: { value: number }, strength: number, heightScale: number, fade: boolean) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.time = time;
    shader.uniforms.fadeFar = fadeFar;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float time;\nuniform float fadeFar;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = vec3(instanceMatrix[3]);
          mat3 iRot = mat3(instanceMatrix);
          float iS2 = max(dot(iRot[0], iRot[0]), 1e-4);
        #else
          vec3 iPos = vec3(0.0);
          mat3 iRot = mat3(1.0);
          float iS2 = 1.0;
        #endif
        float hgt = clamp(position.y * ${heightScale.toFixed(4)}, 0.0, 1.0);
        float gust = sin(time * 1.1 + dot(iPos.xz, vec2(0.08, 0.05))) * 0.5 + 0.5;
        float flutter = sin(time * 3.7 + iPos.x * 1.7 + iPos.z * 1.3 + position.x * 7.0 + position.z * 5.0);
        vec3 windW = vec3(0.8, 0.0, 0.6) * (gust * 0.7 + flutter * 0.3) * hgt * hgt * ${strength.toFixed(3)};
        transformed += transpose(iRot) * windW / iS2;
        ${fade ? "transformed *= 1.0 - smoothstep(fadeFar * 0.7, fadeFar, distance(iPos.xz, cameraPosition.xz));" : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_lambert_pars_fragment>", VEG_LIGHT)
      // Lambert gets no image-based light (scene.environment is PBR-only), so
      // the sky fill that lights the ground around it would be missing and
      // grass/leaves would read as dark cut-outs: stand in for it here.
      .replace("#include <lights_fragment_end>", `irradiance *= ${VEG_SKY_FILL.toFixed(2)};\n#include <lights_fragment_end>`);
  };
}

/**
 * Thin-leaf lighting for vegetation (replaces Lambert's direct term): wrapped
 * diffuse so blades and leaves never go flat black on their shaded side, plus
 * light transmitted through them when the camera looks towards the sun —
 * backlit grass and canopies glow warm, the way they do on a clear day.
 * The direct light arrives already shadowed, so nothing glows in shade.
 */
const VEG_LIGHT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  /void RE_Direct_Lambert\([^]*?\n}\n/,
  /* glsl */ `void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float nl = dot( geometryNormal, directLight.direction );
	float wrap = saturate( ( nl + 0.4 ) / 1.4 );
	float toSun = saturate( dot( - geometryViewDir, directLight.direction ) );
	float trans = ( toSun * toSun * toSun * 0.8 + 0.05 ) * ( 1.0 - saturate( nl ) * 0.6 );
	vec3 tint = material.diffuseColor * vec3( 1.1, 1.06, 0.7 );
	reflectedLight.directDiffuse += directLight.color * ( wrap * BRDF_Lambert( material.diffuseColor ) + trans * BRDF_Lambert( tint ) );
}
`,
);

type GrassTile = { mesh: THREE.InstancedMesh; total: number; full: number; box: THREE.Box3 };

/**
 * Grass LOD: tiles keep every instance up close and thin out to this
 * fraction at the fade distance (instances are in random order, so a
 * shorter prefix is an even thinning). Dense near the camera, cheap far away.
 */
const GRASS_FAR_KEEP = 0.4;

/** Small half-buried stones on open ground (per m², at foliage density 1). */
const PEBBLES_PER_M2 = 0.05;

/** Low-poly stone: a jittered, flattened icosahedron (unit size). */
function makePebble(r: () => number) {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed();
  const p = g.getAttribute("position");
  const v = new THREE.Vector3();
  // Same jitter for coincident corners (non-indexed copies), so faces stay closed.
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = jitter.get(key);
    if (k === undefined) jitter.set(key, (k = 0.75 + r() * 0.45));
    p.setXYZ(i, v.x * k, v.y * k * 0.6, v.z * k);
  }
  g.computeVertexNormals(); // flat facets read as chipped stone
  // World materials use vertex colours: white, so the instance colour shows.
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
  return g;
}

/**
 * Instanced vegetation: grass tiles (frustum + distance culled, faded in the
 * shader), procedural trees (a few variants, instanced bark + alpha-tested
 * leaf cards) and leaf-card bushes. Instance order is random, so lowering
 * the quality just draws a prefix of each buffer.
 */
export class Foliage {
  readonly group = new THREE.Group();
  private readonly tiles: GrassTile[] = [];
  private readonly trees: { mesh: THREE.InstancedMesh; total: number }[] = [];
  private bushes: { mesh: THREE.InstancedMesh; total: number } | null = null;
  private tall: { mesh: THREE.InstancedMesh; total: number } | null = null;
  private litter: { mesh: THREE.InstancedMesh; total: number } | null = null;
  private pebbles: { mesh: THREE.InstancedMesh; total: number } | null = null;
  private readonly tallFade = { value: 90 };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly fadeFar = { value: 50 };
  private grassDistance = 50;
  private readonly tmp = new THREE.Vector3();
  triangles = { grass: 0, trees: 0, bushes: 0, tallGrass: 0, litter: 0, pebbles: 0 };

  constructor(
    spec: FoliageSpec,
    height: (x: number, z: number) => number,
    blocked: (x: number, z: number) => boolean,
    lib: MaterialLibrary,
    windTime: { value: number },
    quality: QualityPreset,
  ) {
    this.group.name = "foliage";
    const r = rng(1337);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const pal = { ...DRY_GRASS, ...spec.grassPalette };
    const dry = new THREE.Color(pal.dry), green = new THREE.Color(pal.lush), brown = new THREE.Color(pal.brown);

    // ---- Grass ---------------------------------------------------------------
    const clump = makeGrassClump(r, 9, 0.66, 0.19);
    this.disposables.push(clump);
    const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    grassMat.name = "ih-grass";
    grassMat.onBeforeCompile = windHook(windTime, this.fadeFar, 0.35, 1.0, true);
    grassMat.customProgramCacheKey = () => "ih-grass-v3";
    this.disposables.push(grassMat);
    const T = 25;
    const B = spec.grassBounds;
    const maxPerM2 = 2.8;
    // Low-frequency colour field: grass grows in patches (lush, dry, rusty), not salt-and-pepper.
    const patch = (x: number, z: number) => {
      const a = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.1) * 0.5 + 0.5;
      const b = Math.sin(z * 0.13 + Math.sin(x * 0.05) * 2.7 + 1.3) * 0.5 + 0.5;
      return a * 0.6 + b * 0.4;
    };
    const rust = new THREE.Color(pal.rust);
    for (let tz = -B; tz < B; tz += T) {
      for (let tx = -B; tx < B; tx += T) {
        const mats: THREE.Matrix4[] = [];
        const cols: THREE.Color[] = [];
        const tries = T * T * maxPerM2;
        for (let i = 0; i < tries; i++) {
          const x = tx + r() * T, z = tz + r() * T;
          if (r() > spec.grass(x, z) || blocked(x, z)) continue;
          q.setFromAxisAngle(up, r() * Math.PI * 2);
          const w = 0.7 + r() * 0.6;
          s.set(w, 0.3 + r() * 0.45, w);
          p.set(x, height(x, z) - 0.02, z);
          mats.push(new THREE.Matrix4().compose(p, q, s));
          const k = patch(x, z) * 0.75 + r() * 0.25;
          col.copy(dry).lerp(green, Math.max(0, k - 0.45) * 1.6).lerp(k < 0.3 ? rust : brown, Math.max(0, 0.35 - k) * 1.4 + r() * 0.15).multiplyScalar(0.8 + r() * 0.35);
          cols.push(col.clone());
        }
        if (!mats.length) continue;
        const mesh = new THREE.InstancedMesh(clump, grassMat, mats.length);
        mats.forEach((mm, i) => {
          mesh.setMatrixAt(i, mm);
          mesh.setColorAt(i, cols[i]);
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();
        this.tiles.push({ mesh, total: mats.length, full: mats.length, box: new THREE.Box3(new THREE.Vector3(tx, -1, tz), new THREE.Vector3(tx + T, 2, tz + T)) });
        this.group.add(mesh);
      }
    }

    // ---- Tall dry grass (one instanced mesh, faded with distance in the shader) --
    if (spec.tallGrass && spec.tallGrassBounds) {
      const tb = spec.tallGrassBounds;
      const mats: THREE.Matrix4[] = [];
      const cols: THREE.Color[] = [];
      const gold = new THREE.Color(0xb09a62), straw = new THREE.Color(0x8e7f4c), pale = new THREE.Color(0x8f9258);
      const tries = Math.round((2 * tb) * (2 * tb) * 0.9);
      for (let i = 0; i < tries; i++) {
        const x = (r() * 2 - 1) * tb, z = (r() * 2 - 1) * tb;
        const dns = spec.tallGrass(x, z);
        if (dns <= 0 || r() > dns || blocked(x, z)) continue;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        const w = 0.9 + r() * 0.7;
        s.set(w, 0.95 + r() * 0.6, w);
        p.set(x, height(x, z) - 0.03, z);
        mats.push(new THREE.Matrix4().compose(p, q, s));
        cols.push(gold.clone().lerp(r() < 0.5 ? straw : pale, r()).multiplyScalar(0.75 + r() * 0.3));
      }
      if (mats.length) {
        const tallClump = makeGrassClump(rng(4242), 12, 0.5, 0.18);
        this.disposables.push(tallClump);
        const tallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        tallMat.name = "ih-tallgrass";
        tallMat.onBeforeCompile = windHook(windTime, this.tallFade, 0.5, 0.8, true);
        tallMat.customProgramCacheKey = () => "ih-tallgrass-v3";
        this.disposables.push(tallMat);
        const order = mats.map((_, i) => i).sort(() => r() - 0.5);
        const mesh = new THREE.InstancedMesh(tallClump, tallMat, mats.length);
        order.forEach((src, i) => {
          mesh.setMatrixAt(i, mats[src]);
          mesh.setColorAt(i, cols[src]);
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        this.tall = { mesh, total: mats.length };
        this.triangles.tallGrass = mats.length * (tallClump.index!.count / 3);
      }
    }

    // ---- Trees ---------------------------------------------------------------
    const leafSize = quality.proceduralTextureSize >= 512 ? 256 : 128;
    const leafGreen = makeDataTexture(leafPixels(leafSize, 0), leafSize, true, quality.anisotropy);
    const leafDry = makeDataTexture(leafPixels(leafSize, 1), leafSize, true, quality.anisotropy);
    leafGreen.wrapS = leafGreen.wrapT = leafDry.wrapS = leafDry.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(leafGreen, leafDry);
    const leafMat = (map: THREE.Texture, strength: number, hScale: number) => {
      const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
      mat.onBeforeCompile = windHook(windTime, this.fadeFar, strength, hScale, false);
      // The hook bakes constants into GLSL, so programs must not be shared across them.
      mat.customProgramCacheKey = () => `ih-leaves-v3:${strength}:${hScale}`;
      mat.name = "ih-leaves";
      this.disposables.push(mat);
      return mat;
    };
    const bark = lib.get("bark");
    const order = [...spec.trees].sort(() => r() - 0.5);
    for (let v = 0; v < TREE_KINDS.length; v++) {
      const list = order.filter((t) => t.variant % TREE_KINDS.length === v);
      if (!list.length) continue;
      const kind = TREE_KINDS[v];
      const geo = makeTree(kind, 100 + v * 17);
      this.disposables.push(geo.bark, geo.leaves);
      const barkMesh = new THREE.InstancedMesh(geo.bark, bark, list.length);
      const leafMesh = new THREE.InstancedMesh(geo.leaves, leafMat(kind.dry ? leafDry : leafGreen, 0.25, 1 / kind.height), list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        s.setScalar(t.scale);
        p.set(t.x, height(t.x, t.z), t.z);
        m.compose(p, q, s);
        barkMesh.setMatrixAt(i, m);
        leafMesh.setMatrixAt(i, m);
        leafMesh.setColorAt(i, col.setRGB(0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.8 + r() * 0.2));
      });
      for (const mesh of [barkMesh, leafMesh]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        this.trees.push({ mesh, total: list.length });
      }
      this.triangles.trees += ((geo.bark.index!.count + geo.leaves.index!.count) / 3) * list.length;
    }

    // ---- Bushes (leaf-card clumps) ------------------------------------------
    if (spec.bushes.length) {
      const lp: number[] = [], ln: number[] = [], lu: number[] = [], li: number[] = [];
      const center = new THREE.Vector3(0, 0.1, 0);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        addCards({ c: new THREE.Vector3(Math.cos(a) * 0.35, 0.45 + r() * 0.2, Math.sin(a) * 0.35), size: 1.1 }, center, r, lp, ln, lu, li, 2);
      }
      addCards({ c: new THREE.Vector3(0, 0.75, 0), size: 1.2 }, center, r, lp, ln, lu, li, 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(ln, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(lu, 2));
      g.setIndex(li);
      this.disposables.push(g);
      const list = [...spec.bushes].sort(() => r() - 0.5);
      const mesh = new THREE.InstancedMesh(g, leafMat(leafGreen, 0.12, 1), list.length);
      list.forEach((b, i) => {
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        s.set(b.scale * (0.8 + r() * 0.4), b.scale * (0.7 + r() * 0.5), b.scale * (0.8 + r() * 0.4));
        p.set(b.x, height(b.x, b.z) - 0.1, b.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const k = r();
        const c = b.dry
          ? col.set(0xc8b27a).multiplyScalar(0.85 + r() * 0.3)
          : k < 0.18
            ? col.setRGB(1.25 + r() * 0.2, 0.62 + r() * 0.15, 0.42 + r() * 0.1) // turning: rust / orange
            : col.setRGB(0.75 + r() * 0.3, 0.82 + r() * 0.25, 0.62 + r() * 0.2);
        mesh.setColorAt(i, c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.bushes = { mesh, total: list.length };
      this.triangles.bushes = (li.length / 3) * list.length;
    }
    // ---- Leaf litter: fallen-leaf cards on the ground under trees and bushes ----
    {
      const spots: { x: number; z: number; r: number; n: number }[] = [];
      for (const t of spec.trees) spots.push({ x: t.x, z: t.z, r: 3.4 * t.scale, n: 40 });
      for (const b of spec.bushes) spots.push({ x: b.x, z: b.z, r: 1.3 * b.scale, n: 6 });
      const mats: THREE.Matrix4[] = [];
      const cols: THREE.Color[] = [];
      const fall = [new THREE.Color(0xe8d0a8), new THREE.Color(0xd8b88c), new THREE.Color(0xf0c890), new THREE.Color(0xd8a080), new THREE.Color(0xc8c49a)];
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const spin = new THREE.Quaternion();
      for (const sp of spots) {
        for (let i = 0; i < sp.n; i++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * sp.r;
          const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
          if (blocked(x, z)) continue;
          spin.setFromAxisAngle(up, r() * Math.PI * 2);
          q.copy(spin).multiply(flat);
          const w = 0.22 + r() * 0.3;
          s.set(w, w, 1);
          p.set(x, height(x, z) + 0.015 + r() * 0.01, z);
          mats.push(new THREE.Matrix4().compose(p, q, s));
          cols.push(fall[Math.floor(r() * fall.length)].clone().multiplyScalar(0.85 + r() * 0.3));
        }
      }
      if (mats.length) {
        const card = new THREE.PlaneGeometry(1, 1);
        card.getAttribute("normal").array.fill(0);
        for (let i = 0; i < 4; i++) card.getAttribute("normal").setXYZ(i, 0, 0, 1);
        this.disposables.push(card);
        const litMat = new THREE.MeshLambertMaterial({ map: leafDry, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
        litMat.name = "ih-litter";
        this.disposables.push(litMat);
        const mesh = new THREE.InstancedMesh(card, litMat, mats.length);
        mats.forEach((mm, i) => {
          mesh.setMatrixAt(i, mm);
          mesh.setColorAt(i, cols[i]);
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        this.litter = { mesh, total: mats.length };
        this.triangles.litter = mats.length * 2;
      }
    }
    // ---- Pebbles: stones half-sunk into open ground (natural ground only) ----
    {
      const bounds = Math.max(spec.grassBounds, spec.tallGrassBounds ?? 0);
      const mats: THREE.Matrix4[] = [];
      const cols: THREE.Color[] = [];
      const tries = Math.round((2 * bounds) * (2 * bounds) * PEBBLES_PER_M2);
      const e = new THREE.Euler();
      for (let i = 0; i < tries; i++) {
        const x = (r() * 2 - 1) * bounds, z = (r() * 2 - 1) * bounds;
        const natural = Math.max(spec.grass(x, z), spec.tallGrass?.(x, z) ?? 0);
        if (natural < 0.05 || blocked(x, z)) continue;
        // Mostly gravel-sized, the odd fist- or head-sized stone.
        const big = r();
        const size = big > 0.93 ? 0.3 + r() * 0.35 : 0.06 + r() * 0.14;
        e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
        q.setFromEuler(e);
        s.set(size * (0.8 + r() * 0.5), size * (0.7 + r() * 0.6), size * (0.8 + r() * 0.5));
        p.set(x, height(x, z) - s.y * 0.18, z);
        mats.push(new THREE.Matrix4().compose(p, q, s));
        const g = 0.72 + r() * 0.4;
        cols.push(new THREE.Color(g * (0.98 + r() * 0.06), g, g * (0.92 + r() * 0.06)));
      }
      if (mats.length) {
        const geo = makePebble(r);
        this.disposables.push(geo);
        const mesh = new THREE.InstancedMesh(geo, lib.get("rock"), mats.length);
        mats.forEach((mm, i) => {
          mesh.setMatrixAt(i, mm);
          mesh.setColorAt(i, cols[i]);
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.name = "pebbles";
        this.group.add(mesh);
        this.pebbles = { mesh, total: mats.length };
        this.triangles.pebbles = mats.length * (geo.getAttribute("position").count / 3);
      }
    }
    this.triangles.grass = this.tiles.reduce((a, t) => a + t.total, 0) * (clump.index!.count / 3);
    this.setQuality(quality);
  }

  setQuality(q: QualityPreset) {
    const d = q.foliageDensity;
    this.grassDistance = q.grassDistance;
    this.fadeFar.value = q.grassDistance;
    for (const t of this.tiles) t.mesh.count = t.full = Math.floor(t.total * d);
    const td = Math.min(1, 0.4 + d * 0.6);
    for (const t of this.trees) t.mesh.count = Math.max(1, Math.floor(t.total * td));
    if (this.bushes) this.bushes.mesh.count = Math.floor(this.bushes.total * Math.min(1, 0.3 + d * 0.7));
    if (this.tall) this.tall.mesh.count = Math.floor(this.tall.total * Math.min(1, 0.15 + d * d * 0.85));
    this.tallFade.value = q.grassDistance * 2;
    if (this.litter) this.litter.mesh.count = Math.floor(this.litter.total * Math.min(1, 0.35 + d * 0.65));
    if (this.pebbles) this.pebbles.mesh.count = Math.floor(this.pebbles.total * Math.min(1, 0.25 + d * 0.75));
  }

  /** Hides grass tiles beyond the fade distance and thins the far ones (cheap CPU LOD). */
  update(camera: THREE.Camera) {
    const cp = camera.position;
    const gd = this.grassDistance;
    for (const t of this.tiles) {
      t.box.clampPoint(cp, this.tmp);
      this.tmp.y = cp.y;
      const dist = this.tmp.distanceTo(cp);
      const keep = 1 - (1 - GRASS_FAR_KEEP) * THREE.MathUtils.smoothstep(dist, gd * 0.2, gd * 0.85);
      t.mesh.count = Math.floor(t.full * keep);
      t.mesh.visible = dist < gd && t.mesh.count > 0;
    }
  }

  dispose() {
    for (const t of this.tiles) t.mesh.dispose();
    for (const t of this.trees) t.mesh.dispose();
    this.bushes?.mesh.dispose();
    this.tall?.mesh.dispose();
    this.litter?.mesh.dispose();
    this.pebbles?.mesh.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
