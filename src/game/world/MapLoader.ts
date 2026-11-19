import * as THREE from "three";
import { CollisionWorld } from "./Collision";
import type { Surface } from "../effects/EffectsPool";

export type MapBox = {
  x: number; z: number; w: number; h: number; d: number; y?: number; color: number; surface?: Surface;
  /** Glowing panels (buy-station screens, lamps). */
  emissive?: number;
  /** Visual only (no collision, bullets pass). */
  decor?: boolean;
};

/** Points of interest for survival. */
export type SurvivalLayout = {
  /** Where enemies appear (outside the play area). */
  enemySpawns: { x: number; z: number }[];
  /** Elevated sniper positions (feet height y). */
  perches: { x: number; y: number; z: number }[];
  buyStations: { x: number; z: number; name: string }[];
  ammoCrates: { x: number; z: number }[];
  /** Compound bounds (inside = defended area). */
  inner: number;
};
export type MapSpawn = { x: number; z: number; y?: number; yaw: number };
export type MapTarget = { x: number; z: number; y?: number; move?: { axis: "x" | "z"; range: number; speed: number } };
export type MapSteelPlate = { name: string; x: number; y: number; z: number; size: number };
export type MapSign = { x: number; y: number; z: number; text: string; rotY?: number };

export type MapDef = {
  id: string;
  name: string;
  size: number;
  groundColor: number;
  skyTop: number;
  skyHorizon: number;
  fogNear: number;
  fogFar: number;
  sunDirection: [number, number, number];
  spawns: MapSpawn[];
  boxes: MapBox[];
  targets: MapTarget[];
  plates: MapSteelPlate[];
  signs: MapSign[];
  sunColor?: number;
  sunIntensity?: number;
  hemiSky?: number;
  hemiGround?: number;
  survival?: SurvivalLayout;
};

export type LoadedMap = {
  def: MapDef;
  collision: CollisionWorld;
  /** Solid meshes bullets can hit. */
  meshes: THREE.Mesh[];
  sun: THREE.DirectionalLight;
  dispose(): void;
};

/**
 * Builds a map from data: sky dome, fog, sun + fill lighting, ground, box
 * geometry with surface tags, signs, and a matching collision world.
 * Boxes share one unit geometry and one material per color.
 */
export function loadMap(scene: THREE.Scene, def: MapDef): LoadedMap {
  const collision = new CollisionWorld();
  const disposables: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  const half = def.size / 2 + 2;

  // ---- Sky + fog ------------------------------------------------------------
  const sky = makeSky(def.skyTop, def.skyHorizon);
  scene.add(sky.mesh);
  disposables.push(sky);
  scene.fog = new THREE.Fog(def.skyHorizon, def.fogNear, def.fogFar);
  scene.background = new THREE.Color(def.skyHorizon);

  // ---- Lights ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(def.hemiSky ?? 0xcfdcec, def.hemiGround ?? 0x6e604a, 1.15));
  const sun = new THREE.DirectionalLight(def.sunColor ?? 0xffe9cc, def.sunIntensity ?? 2.6);
  const [sx, sy, sz] = def.sunDirection;
  sun.position.set(sx, sy, sz).normalize().multiplyScalar(80);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // ---- Ground ---------------------------------------------------------------
  const groundTex = makeGroundTexture(def.groundColor);
  groundTex.repeat.set(def.size / 4, def.size / 4);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
  const groundGeo = new THREE.PlaneGeometry(def.size + 4, def.size + 4);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.surface = "concrete";
  scene.add(ground);
  meshes.push(ground);
  disposables.push(groundTex, groundMat, groundGeo);
  collision.add(new THREE.Box3(new THREE.Vector3(-half * 2, -1, -half * 2), new THREE.Vector3(half * 2, 0, half * 2)));

  // ---- Boxes ----------------------------------------------------------------
  const unit = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(unit);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (const b of def.boxes) {
    const surface = b.surface ?? "concrete";
    const key = `${b.color}:${surface}:${b.emissive ?? 0}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: b.color,
        roughness: surface === "metal" ? 0.55 : surface === "wood" ? 0.8 : 0.9,
        metalness: surface === "metal" ? 0.35 : 0.02,
        emissive: b.emissive ?? 0,
        emissiveIntensity: b.emissive ? 2.2 : 0,
      });
      materials.set(key, mat);
      disposables.push(mat);
    }
    const y = b.y ?? 0;
    const mesh = new THREE.Mesh(unit, mat);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, y + b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.surface = surface;
    scene.add(mesh);
    if (b.decor) {
      mesh.castShadow = false;
      continue;
    }
    meshes.push(mesh);
    collision.add(
      new THREE.Box3(
        new THREE.Vector3(b.x - b.w / 2, y, b.z - b.d / 2),
        new THREE.Vector3(b.x + b.w / 2, y + b.h, b.z + b.d / 2),
      ),
    );
  }

  // ---- Signs ----------------------------------------------------------------
  for (const s of def.signs) {
    const tex = makeSignTexture(s.text);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const geo = new THREE.PlaneGeometry(1.2, 0.6);
    disposables.push(tex, mat, geo);
    const sign = new THREE.Mesh(geo, mat);
    sign.position.set(s.x, s.y, s.z);
    sign.rotation.y = s.rotY ?? 0;
    sign.userData.surface = "metal";
    scene.add(sign);
    meshes.push(sign);
  }

  return {
    def,
    collision,
    meshes,
    sun,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function makeSky(top: number, horizon: number) {
  const geo = new THREE.SphereGeometry(450, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function makeGroundTexture(base: number) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const col = new THREE.Color(base);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const light = Math.random() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${Math.random() * 0.06})` : `rgba(0,0,0,${Math.random() * 0.08})`;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  // A couple of stains.
  for (let i = 0; i < 4; i++) {
    const g = ctx.createRadialGradient(Math.random() * size, Math.random() * size, 0, 128, 128, 90);
    g.addColorStop(0, "rgba(0,0,0,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSignTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e9e3cf";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#c8752a";
  ctx.fillRect(0, 0, 256, 18);
  ctx.fillStyle = "#1d1e1c";
  ctx.font = "bold 64px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
