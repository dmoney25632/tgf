import * as THREE from "three";
import { Spring } from "../core/Spring";
import type { HitPart, Hittable } from "../core/types";
import type { EnemyDef } from "../survival/config";

type Kit = EnemyDef["kit"];
export type HumanoidLook = { uniform: number; vest: number; helmet: number; skin: number; accent: number; kit: Kit; scale: number };

// Shared across every humanoid: geometry by size, materials by color.
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function box(w: number, h: number, d: number, oy = 0) {
  const k = `${w}|${h}|${d}|${oy}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d).translate(0, oy, 0);
    geoCache.set(k, g);
  }
  return g;
}
function mat(color: number, rough = 0.85, metal = 0.05, emissive = 0) {
  const k = `${color}|${rough}|${metal}|${emissive}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: emissive ? 2 : 0 });
    matCache.set(k, m);
  }
  return m;
}
export function disposeHumanoidCache() {
  geoCache.forEach((g) => g.dispose());
  matCache.forEach((m) => m.dispose());
  geoCache.clear();
  matCache.clear();
}

/**
 * Low-poly soldier built from boxes (~14 meshes), animated procedurally:
 * walk cycle, crouch, aim pitch, hit flinch (springs) and a death fall.
 * Faces +Z. Every mesh is a hitbox tagged with head / body / legs.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly hitboxes: THREE.Mesh[] = [];
  readonly muzzle = new THREE.Object3D();

  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly foreR = new THREE.Group();
  private readonly foreL = new THREE.Group();
  private readonly thighR = new THREE.Group();
  private readonly thighL = new THREE.Group();
  private readonly shinR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  readonly gun = new THREE.Group();

  private readonly flinchX = new Spring(140, 11);
  private readonly flinchZ = new Spring(140, 11);
  private readonly headSnap = new Spring(220, 12);
  private phase = Math.random() * 10;
  private crouch = 0;
  private death = -1;
  private deathDir = 1;
  private deathSide = 0;
  private recoil = 0;
  readonly scale: number;
  private readonly eliteMarks: THREE.Mesh[] = [];

  constructor(owner: Hittable, look: HumanoidLook) {
    this.scale = look.scale;
    const uni = mat(look.uniform);
    const vest = mat(look.vest, 0.75);
    const helm = mat(look.helmet, 0.6, 0.2);
    const skin = mat(look.skin, 0.7);
    const dark = mat(0x18191b, 0.5, 0.6);
    const accent = mat(look.accent, 0.4, 0.1, look.accent);
    const boot = mat(0x1e1c1a, 0.8);
    const heavy = look.kit === "heavy" || look.kit === "warden";

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, part: HitPart | null, shadow = false, armor = false) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      parent.add(mesh);
      if (part) {
        mesh.userData = { hittable: owner, part, surface: armor ? "armor" : "flesh" };
        this.hitboxes.push(mesh);
      }
      return mesh;
    };

    // ---- Skeleton -----------------------------------------------------------
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    this.hips.add(this.spine, this.thighR, this.thighL);
    this.thighR.position.set(-0.11, -0.02, 0);
    this.thighL.position.set(0.11, -0.02, 0);
    this.thighR.add(this.shinR);
    this.thighL.add(this.shinL);
    this.shinR.position.y = -0.45;
    this.shinL.position.y = -0.45;
    this.spine.add(this.neck, this.armR, this.armL);
    this.neck.position.y = 0.58;
    this.armR.position.set(-0.24, 0.5, 0);
    this.armL.position.set(0.24, 0.5, 0);
    this.armR.add(this.foreR);
    this.armL.add(this.foreL);
    this.foreR.position.y = -0.28;
    this.foreL.position.y = -0.28;

    // ---- Meshes -------------------------------------------------------------
    const w = heavy ? 1.18 : 1;
    add(this.hips, box(0.34 * w, 0.18, 0.22), uni, 0, 0, 0, "body");
    add(this.spine, box(0.4 * w, 0.52, 0.24), uni, 0, 0.3, 0, "body", true);
    add(this.spine, box(0.44 * w, 0.36, 0.3), vest, 0, 0.34, 0.01, "body", false, heavy);
    if (heavy) {
      add(this.spine, box(0.3, 0.26, 0.06), dark, 0, 0.36, 0.17, "body", false, true); // chest plate
      add(this.armR, box(0.2, 0.12, 0.2), vest, -0.02, 0.02, 0, "body", false, true); // pauldrons
      add(this.armL, box(0.2, 0.12, 0.2), vest, 0.02, 0.02, 0, "body", false, true);
    } else {
      add(this.spine, box(0.3, 0.12, 0.08), vest, 0, 0.2, 0.17, "body"); // pouches
    }
    if (look.kit === "sniper") add(this.spine, box(0.5, 0.3, 0.34), mat(0x5d5a3c, 1), 0, 0.5, -0.02, "body"); // ghillie shawl
    if (look.kit === "rusher") add(this.spine, box(0.3, 0.32, 0.14), dark, 0, 0.32, -0.18, "body"); // charge pack

    add(this.neck, box(0.22, 0.25, 0.24, 0.11), skin, 0, 0, 0, "head");
    add(this.neck, box(0.26, heavy ? 0.16 : 0.12, 0.28, 0.21), helm, 0, 0, -0.01, "head", true, heavy);
    if (heavy) add(this.neck, box(0.2, 0.09, 0.04), accent, 0, 0.12, 0.13, "head", false, true); // glowing visor
    else if (look.kit === "rusher") add(this.neck, box(0.23, 0.12, 0.06), dark, 0, 0.08, 0.11, "head"); // gas mask
    else add(this.neck, box(0.2, 0.05, 0.03), dark, 0, 0.14, 0.12, "head"); // goggles

    add(this.armR, box(0.12 * w, 0.3, 0.12 * w, -0.13), uni, 0, 0, 0, "body");
    add(this.armL, box(0.12 * w, 0.3, 0.12 * w, -0.13), uni, 0, 0, 0, "body");
    add(this.foreR, box(0.1 * w, 0.28, 0.1 * w, -0.12), uni, 0, 0, 0, "body");
    add(this.foreL, box(0.1 * w, 0.28, 0.1 * w, -0.12), uni, 0, 0, 0, "body");

    add(this.thighR, box(0.15 * w, 0.46, 0.17, -0.22), uni, 0, 0, 0, "legs", true);
    add(this.thighL, box(0.15 * w, 0.46, 0.17, -0.22), uni, 0, 0, 0, "legs", true);
    add(this.shinR, box(0.13 * w, 0.46, 0.15, -0.22), uni, 0, 0, 0, "legs");
    add(this.shinL, box(0.13 * w, 0.46, 0.15, -0.22), uni, 0, 0, 0, "legs");
    add(this.shinR, box(0.14 * w, 0.1, 0.26), boot, 0, -0.45, 0.04, "legs");
    add(this.shinL, box(0.14 * w, 0.1, 0.26), boot, 0, -0.45, 0.04, "legs");

    // ---- Weapon (held at the shoulder, pointing forward) -----------------------
    const gunLen = look.kit === "sniper" ? 1.05 : look.kit === "rusher" ? 0.7 : heavy ? 0.95 : 0.78;
    const gunThick = heavy ? 0.12 : 0.08;
    const g1 = new THREE.Mesh(box(0.06, gunThick, gunLen, 0), dark);
    g1.position.z = gunLen * 0.35;
    const g2 = new THREE.Mesh(box(0.05, 0.14, 0.06), dark);
    g2.position.set(0, -0.08, 0.1);
    this.gun.add(g1, g2);
    if (look.kit === "sniper") {
      const scope = new THREE.Mesh(box(0.05, 0.05, 0.22), dark);
      scope.position.set(0, 0.07, 0.25);
      this.gun.add(scope);
    }
    this.muzzle.position.z = gunLen * 0.85;
    this.gun.add(this.muzzle);
    this.gun.position.set(-0.13, 0.42, 0.22);
    this.spine.add(this.gun);

    // ---- Elite markings (hidden unless this soldier spawns as an elite) -------
    const eliteMat = mat(0xff3b2f, 0.4, 0.1, 0xff3b2f);
    this.eliteMarks.push(
      add(this.armL, box(0.135 * w, 0.07, 0.135 * w), eliteMat, 0, -0.08, 0, null), // armband
      add(this.armR, box(0.135 * w, 0.07, 0.135 * w), eliteMat, 0, -0.08, 0, null),
      add(this.neck, box(0.06, 0.035, 0.3), eliteMat, 0, heavy ? 0.17 : 0.13, -0.01, null), // helmet stripe
    );
    this.setElite(false);

    this.root.scale.setScalar(look.scale);
  }

  /** Toggle the red elite markings (pooled models are reused for both). */
  setElite(on: boolean) {
    for (const m of this.eliteMarks) m.visible = on;
  }

  /** Visual hit reaction. dir: hit direction in the model's local frame sign. */
  flinch(head: boolean, strength: number, fromBehind: boolean) {
    const s = Math.min(1, strength);
    this.flinchX.impulse((fromBehind ? 1 : -1) * 5 * s);
    this.flinchZ.impulse((Math.random() - 0.5) * 6 * s);
    if (head) this.headSnap.impulse(-9 * s);
  }

  fire() {
    this.recoil = 1;
  }

  die(fromBehind: boolean) {
    this.death = 0;
    this.deathDir = fromBehind ? 1 : -1;
    this.deathSide = (Math.random() - 0.5) * 0.8;
  }

  revive() {
    this.death = -1;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.root.position.y = 0;
  }

  get dying() {
    return this.death >= 0;
  }

  /**
   * speed: m/s along the ground. crouched: 0..1 target. aimPitch: radians
   * (positive = up). downed: lies on the side, crawling.
   */
  update(dt: number, speed: number, crouched: boolean, aimPitch: number, aiming: boolean, downed = false) {
    const fx = this.flinchX.update(dt);
    const fz = this.flinchZ.update(dt);
    const hs = this.headSnap.update(dt);
    this.recoil = Math.max(0, this.recoil - dt * 12);

    if (this.death >= 0) {
      this.death += dt;
      const t = Math.min(1, this.death / 0.65);
      const e = t * t;
      this.root.rotation.x = this.deathDir * e * 1.5;
      this.root.rotation.z = this.deathSide * e;
      this.hips.position.y = 0.95 - e * 0.55;
      this.spine.rotation.x = this.deathDir * e * 0.3;
      this.armR.rotation.x = -e * 1.2;
      this.armL.rotation.x = -e * 0.6;
      this.armL.rotation.z = e * 0.6;
      this.thighR.rotation.x = e * 0.3;
      this.shinR.rotation.x = e * 0.4;
      this.neck.rotation.x = this.deathDir * e * 0.4;
      // Sink after lying still.
      if (this.death > 3) this.root.position.y = -Math.min(1, (this.death - 3) / 1.4) * 0.6;
      return;
    }

    if (downed) {
      this.hips.position.y = 0.25;
      this.root.rotation.z = 1.3;
      this.spine.rotation.x = -0.2;
      this.phase += dt * speed * 3;
      this.armR.rotation.x = -1.2 + Math.sin(this.phase) * 0.4;
      this.armL.rotation.x = -1.2 - Math.sin(this.phase) * 0.4;
      return;
    }
    this.root.rotation.z = 0;

    this.crouch += ((crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const c = this.crouch;

    // Walk cycle: phase advances with distance travelled.
    const moving = Math.min(1, speed / 2);
    this.phase += dt * speed * 2.6;
    const swing = Math.sin(this.phase) * 0.65 * moving;
    const lift = Math.max(0, Math.cos(this.phase)) * 0.5 * moving;
    const liftL = Math.max(0, -Math.cos(this.phase)) * 0.5 * moving;

    this.hips.position.y = 0.95 - c * 0.38 + Math.abs(Math.cos(this.phase)) * 0.03 * moving;
    this.thighR.rotation.x = -swing - c * 1.1;
    this.thighL.rotation.x = swing - c * 1.1;
    this.shinR.rotation.x = lift + c * 1.7;
    this.shinL.rotation.x = liftL + c * 1.7;

    // Upper body: lean into the run, aim pitch, flinch.
    const lean = Math.min(1, speed / 6) * 0.18;
    this.spine.rotation.x = lean + c * 0.15 + fx * 0.12;
    this.spine.rotation.z = fz * 0.1;
    this.spine.rotation.y = 0;
    this.neck.rotation.x = -aimPitch * 0.5 + hs * 0.1;

    // Arms: hold the weapon at the shoulder; aim pitch raises it.
    const ap = THREE.MathUtils.clamp(aimPitch, -0.8, 0.8);
    const ready = aiming ? 1 : 0.6;
    this.armR.rotation.set(-1.2 * ready - ap - this.recoil * 0.12, 0, -0.15);
    this.foreR.rotation.set(-0.5, 0, 0);
    this.armL.rotation.set(-1.35 * ready - ap - this.recoil * 0.12, -0.5, 0.2);
    this.foreL.rotation.set(-0.35, 0, 0);
    this.gun.rotation.x = -ap * ready - (1 - ready) * 0.5 - this.recoil * 0.1;
    this.gun.position.z = 0.22 - this.recoil * 0.04;
  }
}
