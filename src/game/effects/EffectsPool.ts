import * as THREE from "three";
import { ParticleSystem } from "./Particles";

export type Surface = "concrete" | "metal" | "wood" | "sand" | "target" | "steel" | "flesh" | "armor";

/** Debris color per surface (linear RGB). */
const DEBRIS: Record<Surface, [number, number, number]> = {
  concrete: [0.55, 0.54, 0.5],
  metal: [0.35, 0.3, 0.28],
  wood: [0.45, 0.3, 0.16],
  sand: [0.6, 0.52, 0.36],
  target: [0.7, 0.35, 0.12],
  steel: [0.5, 0.5, 0.52],
  flesh: [0.32, 0.03, 0.02],
  armor: [0.4, 0.4, 0.4],
};

const MAX_TRACERS = 40;
const TRACER_SPEED = 520; // m/s, visual only
const TRACER_LENGTH = 5;

type Tracer = { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; dist: number; travelled: number; active: boolean };

/**
 * All transient combat visuals, pooled: tracers, sparks, debris/dust,
 * bullet-hole decals and the world-space muzzle light.
 */
export class EffectsPool {
  readonly sparks: ParticleSystem;
  readonly debris: ParticleSystem;
  private readonly tracers: Tracer[] = [];
  private nextTracer = 0;
  private readonly tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tracerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(4, 2.6, 1.2), // >1 so bloom picks it up
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  private readonly decals: THREE.Mesh[] = [];
  private nextDecal = 0;
  private decalCap: number;
  private readonly decalGeo = new THREE.PlaneGeometry(0.075, 0.075);
  private readonly decalMats: Record<"dark" | "metal", THREE.MeshBasicMaterial>;
  private readonly decalTex: THREE.CanvasTexture;

  private readonly hostileTracerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(4, 1.1, 0.5),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  readonly muzzleLight = new THREE.PointLight(0xffa850, 0, 7, 2);
  private muzzleTimer = 0;
  /** Big light for explosions. */
  readonly blastLight = new THREE.PointLight(0xff9a40, 0, 24, 2);
  private blastTimer = 0;

  private readonly q = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, maxDecals: number, maxParticles: number) {
    this.sparks = new ParticleSystem(maxParticles, true);
    this.debris = new ParticleSystem(maxParticles, false);
    scene.add(this.sparks.points, this.debris.points, this.muzzleLight, this.blastLight);

    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, active: false });
    }

    this.decalTex = makeBulletHoleTexture();
    const decalBase = { map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 };
    this.decalMats = {
      dark: new THREE.MeshBasicMaterial({ ...decalBase, color: 0x1a1816 }),
      metal: new THREE.MeshBasicMaterial({ ...decalBase, color: 0x9a948a }),
    };
    this.decalCap = maxDecals;
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMats.dark);
      m.visible = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      this.decals.push(m);
    }
  }

  setLimits(maxDecals: number, maxParticles: number) {
    this.decalCap = Math.min(maxDecals, this.decals.length);
    for (let i = this.decalCap; i < this.decals.length; i++) this.decals[i].visible = false;
    this.nextDecal %= this.decalCap;
    this.sparks.cap = Math.min(maxParticles, this.sparks.capacity);
    this.debris.cap = Math.min(maxParticles, this.debris.capacity);
  }

  setViewportHeight(h: number) {
    this.sparks.setViewportHeight(h);
    this.debris.setViewportHeight(h);
  }

  muzzleFlash(at: THREE.Vector3) {
    this.muzzleLight.position.copy(at);
    this.muzzleLight.intensity = 6 + Math.random() * 3;
    this.muzzleTimer = 0.05;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, hostile = false) {
    const t = this.tracers[this.nextTracer];
    t.mesh.material = hostile ? this.hostileTracerMat : this.tracerMat;
    this.nextTracer = (this.nextTracer + 1) % MAX_TRACERS;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 2) return;
    t.dir.divideScalar(t.dist);
    t.travelled = 1.2; // start slightly ahead of the muzzle
    t.active = true;
    t.mesh.quaternion.setFromUnitVectors(this.zAxis, t.dir);
    t.mesh.visible = true;
  }

  /** Enemy muzzle: a few bright sparks forward (no light, it's cheap). */
  muzzlePuff(at: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      const s = 3 + Math.random() * 5;
      this.sparks.spawn(
        at.x, at.y, at.z,
        (dir.x + (Math.random() - 0.5) * 0.5) * s, (dir.y + (Math.random() - 0.5) * 0.5) * s, (dir.z + (Math.random() - 0.5) * 0.5) * s,
        4, 2.4, 1, 0.05 + Math.random() * 0.04, 0.12, 0.04, 1, 0, 6,
      );
    }
  }

  /** Frag explosion: flash, fireball sparks, debris, and lingering smoke. */
  explosion(at: THREE.Vector3) {
    this.blastLight.position.copy(at);
    this.blastLight.position.y += 0.6;
    this.blastLight.intensity = 60;
    this.blastTimer = 0.18;
    for (let i = 0; i < 46; i++) {
      const s = 6 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const h = Math.sqrt(1 - up * up);
      this.sparks.spawn(at.x, at.y + 0.2, at.z, Math.cos(a) * h * s, up * s, Math.sin(a) * h * s, 4, 2.2, 0.8, 0.25 + Math.random() * 0.35, 0.06, 0.015, 1, 14, 2.5);
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.sparks.spawn(at.x, at.y + 0.4, at.z, Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s, 3.5, 1.6, 0.5, 0.18 + Math.random() * 0.12, 1.4, 2.6, 0.9, -1, 4);
    }
    for (let i = 0; i < 26; i++) {
      const s = 3 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2;
      this.debris.spawn(at.x, at.y + 0.1, at.z, Math.cos(a) * s * 0.6, 3 + Math.random() * 8, Math.sin(a) * s * 0.6, 0.22, 0.2, 0.17, 0.8 + Math.random() * 0.6, 0.06, 0.04, 1, 16, 0.8);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.5;
      this.debris.spawn(
        at.x + Math.cos(a) * r, at.y + 0.5 + Math.random(), at.z + Math.sin(a) * r,
        Math.cos(a) * 0.8, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.8,
        0.18, 0.17, 0.16, 2.2 + Math.random() * 1.6, 1.2, 4.2, 0.55, -0.15, 0.9,
      );
    }
  }

  /** Bullet impact on a surface: decal + debris + sparks + dust puff. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, decal = true) {
    if (surface === "flesh") return this.blood(point, normal);
    if (decal && surface !== "target" && surface !== "armor") this.decal(point, normal, surface === "metal" || surface === "steel");

    const [r, g, b] = DEBRIS[surface];
    const n = normal;
    const sparky = surface === "metal" || surface === "steel" || surface === "concrete";

    // Sparks: fast, bright, short-lived, bounce off along the normal.
    const sparkCount = surface === "steel" ? 14 : surface === "metal" ? 10 : sparky ? 5 : 0;
    for (let i = 0; i < sparkCount; i++) {
      const s = 4 + Math.random() * 8;
      this.sparks.spawn(
        point.x, point.y, point.z,
        (n.x + (Math.random() - 0.5) * 1.4) * s,
        (n.y + (Math.random() - 0.5) * 1.4 + 0.3) * s,
        (n.z + (Math.random() - 0.5) * 1.4) * s,
        3, 1.8, 0.7,
        0.12 + Math.random() * 0.15, 0.035, 0.01, 1, 12, 2,
      );
    }

    // Chips: small, heavier, fall with gravity.
    const chipCount = surface === "target" ? 8 : 6;
    for (let i = 0; i < chipCount; i++) {
      const s = 2 + Math.random() * 3.5;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + (Math.random() - 0.5) * 1.2) * s,
        (n.y + Math.random() * 0.8) * s,
        (n.z + (Math.random() - 0.5) * 1.2) * s,
        r * 0.8, g * 0.8, b * 0.8,
        0.45 + Math.random() * 0.3, 0.03, 0.02, 1, 14, 1.5,
      );
    }

    // Dust puff: a couple of soft, slow, expanding particles.
    const puff = surface === "sand" ? 3 : 2;
    for (let i = 0; i < puff; i++) {
      this.debris.spawn(
        point.x + n.x * 0.05, point.y + n.y * 0.05, point.z + n.z * 0.05,
        n.x * 0.8 + (Math.random() - 0.5) * 0.4,
        n.y * 0.8 + 0.25 + Math.random() * 0.2,
        n.z * 0.8 + (Math.random() - 0.5) * 0.4,
        r, g, b,
        0.6 + Math.random() * 0.4, 0.12, 0.55, surface === "target" ? 0.25 : 0.45, -0.2, 2.5,
      );
    }
  }

  private blood(point: THREE.Vector3, n: THREE.Vector3) {
    for (let i = 0; i < 6; i++) {
      const s = 1 + Math.random() * 2.5;
      this.debris.spawn(
        point.x, point.y, point.z,
        (n.x + (Math.random() - 0.5) * 1.4) * s, (n.y + Math.random() * 0.8) * s, (n.z + (Math.random() - 0.5) * 1.4) * s,
        0.3, 0.02, 0.015, 0.35 + Math.random() * 0.25, 0.035, 0.02, 1, 12, 1.5,
      );
    }
    this.debris.spawn(point.x, point.y, point.z, n.x * 0.5, 0.2, n.z * 0.5, 0.22, 0.02, 0.015, 0.4, 0.1, 0.35, 0.7, 0, 3);
  }

  private decal(point: THREE.Vector3, normal: THREE.Vector3, metal: boolean) {
    const m = this.decals[this.nextDecal];
    this.nextDecal = (this.nextDecal + 1) % this.decalCap;
    m.material = metal ? this.decalMats.metal : this.decalMats.dark;
    m.position.copy(point).addScaledVector(normal, 0.004);
    this.tmp.copy(point).add(normal);
    m.lookAt(this.tmp);
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.8 + Math.random() * 0.5;
    m.scale.set(s, s, s);
    m.updateMatrix();
    m.visible = true;
  }

  update(dt: number) {
    if (this.blastTimer > 0) {
      this.blastTimer -= dt;
      this.blastLight.intensity = Math.max(0, this.blastTimer / 0.18) * 60;
    }
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzleLight.intensity = 0;
    }

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.travelled += TRACER_SPEED * dt;
      const head = Math.min(t.travelled, t.dist);
      const tail = Math.max(0, t.travelled - TRACER_LENGTH);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const len = head - tail;
      this.tmp.copy(t.from).addScaledVector(t.dir, (head + tail) / 2);
      t.mesh.position.copy(this.tmp);
      t.mesh.scale.set(0.012, 0.012, len);
    }

    this.sparks.update(dt);
    this.debris.update(dt);
  }

  dispose() {
    this.sparks.dispose();
    this.debris.dispose();
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.hostileTracerMat.dispose();
    this.decalGeo.dispose();
    this.decalMats.dark.dispose();
    this.decalMats.metal.dispose();
    this.decalTex.dispose();
  }
}

function makeBulletHoleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  // Soft scorch ring + dark core with a few cracks.
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.95)");
  g.addColorStop(0.4, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(32, 32);
    ctx.lineTo(32 + Math.cos(a) * (14 + Math.random() * 12), 32 + Math.sin(a) * (14 + Math.random() * 12));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
