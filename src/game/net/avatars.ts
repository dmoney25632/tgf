import * as THREE from "three";
import type { HitPart, HitResult, Hittable } from "../core/types";
import { Humanoid } from "../ai/Humanoid";
import { ENEMIES, OPERATORS, type EnemyDef, type EnemyType, type OperatorId } from "../survival/config";
import { humanoidLook, sanitizeLook } from "../character";
import { InterpBuffer } from "./interpolation";
import { NET, STATE_DEAD } from "./protocol";

const NO_HIT: Hittable = {
  name: "teammate",
  applyDamage: (): HitResult => ({ damage: 0, killed: false, counts: false }),
};

/** Camera yaw (0 looks down −Z) → Humanoid facing (0 faces +Z). */
const modelYaw = (cameraYaw: number) => cameraYaw + Math.PI;

/** Floating callsign above a teammate: constant screen size, visible through walls. */
class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement("canvas");
  private readonly tex: THREE.CanvasTexture;
  private text = "";

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(0.16, 0.04, 1);
    this.sprite.renderOrder = 999;
    this.sprite.frustumCulled = false;
  }

  set(name: string, status: string, color: string) {
    const text = `${name}|${status}|${color}`;
    if (text === this.text) return;
    this.text = text;
    const g = this.canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 256, 64);
    g.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,0.75)";
    const label = status ? `${name} · ${status}` : name;
    g.strokeText(label, 128, 32);
    g.fillStyle = color;
    g.fillText(label, 128, 32);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    (this.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

/** A teammate's body: full Humanoid soldier in their operator colours, plus a name tag. */
export class RemoteAvatar {
  readonly model: Humanoid;
  readonly buffer = new InterpBuffer(5, 48, [3]);
  private readonly tag = new NameTag();
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private readonly sampleOut = [0, 0, 0, 0, 0];
  private readonly prev = new THREE.Vector3();
  private speed = 0;
  private wasDead = false;
  visible = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly name: string,
    operator: OperatorId,
    look?: unknown,
  ) {
    const c = OPERATORS[operator]?.colors ?? OPERATORS.ridge.colors;
    this.model = new Humanoid(
      NO_HIT,
      look ? humanoidLook(sanitizeLook(look)) : { uniform: c.sleeve, vest: c.vest, helmet: c.helmet, accent: c.accent, skin: 0xb08a6a, kit: "standard", scale: 1 },
    );
    this.model.root.visible = false;
    this.tag.sprite.position.set(0, 2.15, 0);
    this.model.root.add(this.tag.sprite);
    scene.add(this.model.root);
  }

  /**
   * renderTime is in the sender's clock. crouched/downed/dead from their latest
   * state + host vitals.
   */
  update(dt: number, renderTime: number, s: { crouched: boolean; downed: boolean; dead: boolean; connected: boolean; status: string }) {
    const r = this.model.root;
    const have = this.buffer.sample(renderTime, this.sampleOut, NET.MAX_EXTRAPOLATE_MS);
    this.visible = have && s.connected;
    r.visible = this.visible;
    if (!this.visible) return;
    const o = this.sampleOut;
    this.position.set(o[0], o[1], o[2]);
    this.yaw = o[3];
    this.pitch = o[4];
    if (dt > 0) {
      const v = Math.hypot(this.position.x - this.prev.x, this.position.z - this.prev.z) / dt;
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 10);
    }
    this.prev.copy(this.position);

    if (s.dead && !this.wasDead) this.model.die(false);
    if (!s.dead && this.wasDead) this.model.revive();
    this.wasDead = s.dead;

    if (this.model.dying) {
      this.model.update(dt, 0, false, 0, false);
      r.position.x = this.position.x;
      r.position.z = this.position.z;
    } else {
      this.model.update(dt, s.downed ? 0 : this.speed, s.crouched, this.pitch, !s.downed, s.downed);
      r.position.copy(this.position);
      r.rotation.y = modelYaw(this.yaw);
    }
    this.tag.set(this.name, s.status, s.downed || s.dead ? "#ff8a6a" : "#9be0ff");
  }

  /** World muzzle + aim direction for a teammate's shot. */
  muzzle(out: THREE.Vector3) {
    return this.model.muzzle.getWorldPosition(out);
  }
  aimDir(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.tag.dispose();
  }
}

/**
 * Client-side stand-in for a host enemy. Its hitboxes take the local
 * player's bullets: damage is predicted locally (flinch, hitmarker, kill
 * marker) and queued as a hit claim for the host to validate.
 */
export class RemoteEnemy implements Hittable {
  readonly model: Humanoid;
  readonly def: EnemyDef;
  readonly buffer = new InterpBuffer(5, 32, [3]);
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 1;
  maxHealth = 1;
  state = 0;
  crouched = false;
  aiming = false;
  elite = false;
  target = 255;
  charge = 0;
  pendingShots = 0;
  shotTimer = 0;
  active = false;
  /** Locally predicted death (stop counting hits until the host confirms). */
  predictedDead = false;
  lastLocalHit = -1e9;
  laser: THREE.Mesh | null = null;
  private readonly sampleOut = [0, 0, 0, 0, 0];
  private readonly prev = new THREE.Vector3();
  private speed = 0;
  private dead = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly id: number,
    readonly type: EnemyType,
    private readonly claim: (e: RemoteEnemy, amount: number, part: HitPart, source: string) => void,
  ) {
    this.def = ENEMIES[type];
    this.model = new Humanoid(this, { ...this.def.colors, kit: this.def.kit, scale: this.def.scale });
    this.model.root.visible = false;
    scene.add(this.model.root);
  }

  get name() {
    return this.def.name;
  }

  get alive() {
    return this.active && !this.dead;
  }

  /** Local bullets / knife. Damage is a prediction; the host decides. */
  applyDamage(amount: number, part: HitPart, _from?: THREE.Vector3, source = ""): HitResult {
    if (!this.alive || this.predictedDead) return { damage: 0, killed: false, counts: false };
    const armor = part === "head" ? 1 : this.def.bodyArmor;
    const dmg = Math.min(this.health, amount * armor);
    this.health -= amount * armor;
    this.lastLocalHit = performance.now();
    const killed = this.health <= 0;
    if (killed) {
      this.health = 0;
      this.predictedDead = true;
    } else this.model.flinch(part === "head", amount / 40, false);
    this.claim(this, amount, part, source);
    return { damage: dmg, killed, counts: true };
  }

  /** Apply the host's authoritative state for this enemy. */
  apply(e: { state: number; health: number; maxHealth: number; elite: boolean; crouched: boolean; aiming: boolean; target: number; charge: number; shots: number }) {
    const wasActive = this.active;
    const nowDead = e.state === STATE_DEAD;
    if (!wasActive || (this.dead && !nowDead)) {
      // (Re)spawned from the host's pool.
      this.active = true;
      this.dead = false;
      this.predictedDead = false;
      this.buffer.clear();
      this.model.revive();
      this.model.root.visible = true;
    }
    if (e.elite !== this.elite || !wasActive) this.model.setElite(e.elite);
    this.elite = e.elite;
    if (nowDead && !this.dead) {
      this.dead = true;
      this.model.die(Math.random() < 0.5);
    }
    this.state = e.state;
    this.maxHealth = e.maxHealth;
    // Keep a fresh local prediction for a moment so hitmarkers don't flicker.
    if (performance.now() - this.lastLocalHit > 400) {
      this.health = e.health;
      if (e.health > 0 && this.predictedDead && !nowDead) this.predictedDead = false;
    } else this.health = Math.min(this.health, e.health);
    this.crouched = e.crouched;
    this.aiming = e.aiming;
    this.target = e.target;
    this.charge = e.charge;
    this.pendingShots += e.shots;
  }

  deactivate() {
    this.active = false;
    this.dead = false;
    this.pendingShots = 0;
    this.model.root.visible = false;
    if (this.laser) this.laser.visible = false;
  }

  update(dt: number, renderTime: number) {
    if (!this.active) return;
    const r = this.model.root;
    if (!this.buffer.sample(renderTime, this.sampleOut, NET.MAX_EXTRAPOLATE_MS)) return;
    const o = this.sampleOut;
    this.position.set(o[0], o[1], o[2]);
    this.yaw = o[3];
    this.pitch = o[4];
    if (dt > 0) {
      const v = Math.hypot(this.position.x - this.prev.x, this.position.z - this.prev.z) / dt;
      this.speed += (Math.min(v, 9) - this.speed) * Math.min(1, dt * 10);
    }
    this.prev.copy(this.position);
    if (this.dead) {
      this.model.update(dt, 0, false, 0, false);
      r.position.x = this.position.x;
      r.position.z = this.position.z;
      return;
    }
    this.model.update(dt, this.speed, this.crouched, this.pitch, this.aiming);
    r.position.copy(this.position);
    r.rotation.y = this.yaw;
  }

  aimPoint(out: THREE.Vector3) {
    return out.set(this.position.x, this.position.y + (this.crouched ? 0.85 : 1.25) * this.model.scale, this.position.z);
  }

  dispose() {
    this.scene.remove(this.model.root);
  }
}
