import * as THREE from "three";

export type ShellKind = "rifle" | "pistol" | "shotgun" | "magnum" | "heavy";

/** Per-kind scale of the base (rifle) casing: [radius, length]. */
const SCALE: Record<Exclude<ShellKind, "shotgun">, [number, number]> = {
  rifle: [1, 1],
  pistol: [1.18, 0.43],
  heavy: [1.22, 1.13],
  magnum: [1.45, 0.72],
};

const GRAVITY = 9.8;
const LIFE = 3.2;

type Shell = {
  active: boolean;
  shotgun: boolean;
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spinAxis: THREE.Vector3;
  spin: number;
  scale: THREE.Vector3;
  life: number;
  ground: number;
  bounces: number;
  resting: boolean;
  kind: ShellKind;
};

/**
 * Ejected brass: pooled instanced casings with light physics (gravity,
 * tumbling spin, bounce + friction on a ground plane, then rest and vanish).
 * Rifle/pistol/magnum casings share one instanced mesh; shotgun hulls use
 * two (plastic body + brass head).
 */
export class ShellPool {
  private readonly brass: THREE.InstancedMesh;
  private readonly hull: THREE.InstancedMesh;
  private readonly hullHead: THREE.InstancedMesh;
  private readonly shells: Shell[] = [];
  private nextBrass = 0;
  private nextHull = 0;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly euler = new THREE.Euler();
  private readonly tmp = new THREE.Vector3();
  /** Called on the first two ground contacts (for the tinkle sound). */
  onLand: ((at: THREE.Vector3, kind: ShellKind, speed: number) => void) | null = null;

  constructor(scene: THREE.Scene, readonly capacity = 40) {
    // Bottle-neck rifle casing along Z, base at z = 0, mouth at -0.045.
    const caseGeo = lathe([
      [0, 0.0], [0.0047, 0.0], [0.0048, -0.0012], [0.0039, -0.0018], [0.0039, -0.003], [0.0048, -0.0036],
      [0.0046, -0.034], [0.0031, -0.038], [0.0029, -0.045], [0.0024, -0.045], [0.0024, -0.04],
    ]);
    const hullGeo = lathe([[0.0098, -0.012], [0.0102, -0.013], [0.0102, -0.068], [0.0088, -0.07], [0.0035, -0.07], [0.0035, -0.066]]);
    const headGeo = lathe([[0, 0], [0.0107, 0], [0.0107, -0.0015], [0.0103, -0.002], [0.0103, -0.013], [0, -0.013]]);
    this.geos.push(caseGeo, hullGeo, headGeo);
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a04c, metalness: 1, roughness: 0.28, side: THREE.DoubleSide });
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x8e1f18, metalness: 0.05, roughness: 0.45, side: THREE.DoubleSide });
    this.mats.push(brassMat, hullMat);
    const nHull = Math.max(4, Math.floor(capacity / 4));
    this.brass = new THREE.InstancedMesh(caseGeo, brassMat, capacity);
    this.hull = new THREE.InstancedMesh(hullGeo, hullMat, nHull);
    this.hullHead = new THREE.InstancedMesh(headGeo, brassMat, nHull);
    for (const im of [this.brass, this.hull, this.hullHead]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.zero);
      im.castShadow = false;
      scene.add(im);
    }
    for (let i = 0; i < capacity + nHull; i++) {
      this.shells.push({
        active: false, shotgun: i >= capacity, slot: i >= capacity ? i - capacity : i,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spinAxis: new THREE.Vector3(1, 0, 0),
        spin: 0, scale: new THREE.Vector3(1, 1, 1), life: 0, ground: 0, bounces: 0, resting: false, kind: "rifle",
      });
    }
  }

  /**
   * Eject a casing. `orient` is the gun's world orientation (casing axis
   * starts along the bore); `groundY` is the floor height under the player.
   */
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, orient: THREE.Quaternion, kind: ShellKind, groundY: number) {
    const shotgun = kind === "shotgun";
    let s: Shell;
    if (shotgun) {
      s = this.shells[this.capacity + this.nextHull];
      this.nextHull = (this.nextHull + 1) % this.hull.count;
    } else {
      s = this.shells[this.nextBrass];
      this.nextBrass = (this.nextBrass + 1) % this.capacity;
    }
    s.active = true;
    s.kind = kind;
    s.pos.copy(pos);
    s.vel.copy(vel);
    s.quat.copy(orient);
    // Casings tumble end over end about the gun's vertical axis, plus some wobble.
    s.spinAxis.set(0.25 * (Math.random() - 0.5), 1, 0.4 * (Math.random() - 0.5)).normalize().applyQuaternion(orient);
    s.spin = (shotgun ? 14 : 26) + Math.random() * 14;
    if (shotgun) s.scale.set(1, 1, 1);
    else {
      const [r, l] = SCALE[kind];
      s.scale.set(r, r, l);
    }
    s.life = LIFE + Math.random() * 0.6;
    s.ground = groundY;
    s.bounces = 0;
    s.resting = false;
  }

  update(dt: number) {
    if (dt <= 0) return;
    let dirtyB = false;
    let dirtyH = false;
    for (const s of this.shells) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        this.write(s, true);
        if (s.shotgun) dirtyH = true;
        else dirtyB = true;
        continue;
      }
      if (!s.resting) {
        s.vel.y -= GRAVITY * dt;
        s.vel.multiplyScalar(1 - 0.25 * dt);
        s.pos.addScaledVector(s.vel, dt);
        this.q.setFromAxisAngle(s.spinAxis, s.spin * dt);
        s.quat.premultiply(this.q);
        const radius = s.shotgun ? 0.011 : 0.005 * s.scale.x;
        if (s.pos.y < s.ground + radius && s.vel.y < 0) {
          s.pos.y = s.ground + radius;
          const speed = -s.vel.y;
          if (s.bounces < 2 && speed > 0.6) this.onLand?.(s.pos, s.kind, speed);
          s.bounces++;
          s.vel.y = speed * (0.3 + Math.random() * 0.15);
          s.vel.x = s.vel.x * 0.55 + (Math.random() - 0.5) * 0.5;
          s.vel.z = s.vel.z * 0.55 + (Math.random() - 0.5) * 0.5;
          s.spin *= 0.5;
          this.tmp.set(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize();
          s.spinAxis.copy(this.tmp);
          if (s.vel.y < 0.35 || s.bounces > 4) {
            // Settle lying on its side, keep the current heading.
            s.resting = true;
            this.tmp.set(0, 0, 1).applyQuaternion(s.quat);
            const yaw = Math.atan2(this.tmp.x, this.tmp.z);
            s.quat.setFromEuler(this.euler.set(0, yaw, 0)).multiply(this.q.setFromAxisAngle(this.tmp.set(0, 0, 1), Math.random() * Math.PI * 2));
            s.pos.y = s.ground + radius;
          }
        }
      }
      // Sink out of sight during the last half second.
      if (s.life < 0.5 && s.resting) s.pos.y -= dt * 0.03;
      this.write(s, false);
      if (s.shotgun) dirtyH = true;
      else dirtyB = true;
    }
    if (dirtyB) this.brass.instanceMatrix.needsUpdate = true;
    if (dirtyH) {
      this.hull.instanceMatrix.needsUpdate = true;
      this.hullHead.instanceMatrix.needsUpdate = true;
    }
  }

  private write(s: Shell, hide: boolean) {
    if (hide) this.m.copy(this.zero);
    else this.m.compose(s.pos, s.quat, s.scale);
    if (s.shotgun) {
      this.hull.setMatrixAt(s.slot, this.m);
      this.hullHead.setMatrixAt(s.slot, this.m);
    } else this.brass.setMatrixAt(s.slot, this.m);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.brass.dispose();
    this.hull.dispose();
    this.hullHead.dispose();
  }
}

/** Lathe around Z from [radius, z] pairs; normals outward. */
function lathe(pts: [number, number][]) {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, -z)), 10);
  g.rotateX(-Math.PI / 2);
  return g;
}
