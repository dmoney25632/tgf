import * as THREE from "three";
import { MOVEMENT } from "../config";
import { damp } from "../core/Spring";
import type { Input } from "../core/Input";
import type { HitboxUserData, HitPart, Hittable } from "../core/types";
import type { PlayerController } from "../player/PlayerController";
import type { Surface } from "../effects/EffectsPool";
import { BUTT_STROKE, damageAt, KNIFE, MELEE, WEAPONS, type FireMode, type WeaponDef } from "./weapons";

const DEG = Math.PI / 180;
const STAGES_TACTICAL: readonly [number, ReloadStage][] = [[0.25, "magOut"], [0.6, "magIn"]];
const STAGES_EMPTY: readonly [number, ReloadStage][] = [[0.25, "magOut"], [0.6, "magIn"], [0.82, "bolt"]];
const MELEE_FAN = [0, -0.14, 0.14, -0.28, 0.28];
/** Pause between bursts (s), on top of the cyclic rate. */
const BURST_GAP = 0.14;
/** Damage kept after passing through a body. */
const PEN_KEEP = 0.7;

export type Slot = { def: WeaponDef; ammo: number; reserve: number; mode: FireMode };
export type ReloadStage = "start" | "magOut" | "magIn" | "bolt" | "shell" | "done";
/** quick: knife slash (V with sidearm / knife) · butt: rifle-butt stroke (V with a long gun) · slash / stab: equipped knife. */
export type MeleeKind = "quick" | "butt" | "slash" | "stab";

type MeleeSpec = { name: string; damage: number; range: number; duration: number; hitDelay: number; knife: boolean };
const MELEE_SPECS: Record<MeleeKind, MeleeSpec> = {
  quick: { name: MELEE.name, damage: MELEE.damage, range: MELEE.range, duration: MELEE.cooldown, hitDelay: MELEE.hitDelay, knife: true },
  butt: { name: BUTT_STROKE.name, damage: BUTT_STROKE.damage, range: BUTT_STROKE.range, duration: BUTT_STROKE.cooldown, hitDelay: BUTT_STROKE.hitDelay, knife: false },
  slash: { name: MELEE.name, damage: KNIFE.slash.damage, range: KNIFE.slash.range, duration: KNIFE.slash.duration, hitDelay: KNIFE.slash.hitDelay, knife: true },
  stab: { name: MELEE.name, damage: KNIFE.stab.damage, range: KNIFE.stab.range, duration: KNIFE.stab.duration, hitDelay: KNIFE.stab.hitDelay, knife: true },
};

/** True for kill-feed / medal sources that came from a melee attack. */
export const isMeleeName = (name: string) => name === MELEE.name || name === BUTT_STROKE.name;

/** Multipliers from operators and perks. 1 = no change. */
export type WeaponModifiers = {
  reloadSpeed: number;
  adsSpeed: number;
  recoil: number;
  headshotDamage: number;
  damage: number;
  reserve: number;
};

export type WeaponHooks = {
  onFire(def: WeaponDef, hitPoint: THREE.Vector3 | null): void;
  /** `material` = the hit world mesh's userData.material (refines concrete → brick / plaster etc.). */
  onImpact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface, distance: number, material?: string): void;
  /** shotId groups pellets of one trigger pull (for rewards). */
  onHit(part: HitPart, damage: number, killed: boolean, name: string, source: string, shotId: number, point: THREE.Vector3): void;
  onDryFire(): void;
  onReload(stage: ReloadStage, def: WeaponDef): void;
  onSwap(def: WeaponDef): void;
  onAdsStart(): void;
  /** Melee swing resolved: `hit` = struck something (body or wall). */
  onMelee(hit: boolean, kind?: MeleeKind, backstab?: boolean, flesh?: boolean): void;
  /** Melee swing started (whoosh). */
  onMeleeStart?(kind: MeleeKind): void;
  onFireMode?(mode: FireMode, def: WeaponDef): void;
  /** Carried weapons changed (viewmodel preloads their models). */
  onLoadout?(defs: WeaponDef[]): void;
};

export type WeaponStats = { shotsFired: number; shotsHit: number; kills: number; headshots: number; damage: number };

/**
 * Gunplay logic: fire timing and fire modes (auto / burst / semi), hitscan
 * with penetration (incl. shotgun pellets), damage, recoil, spread/bloom,
 * ADS, reload (mag or round-by-round), swap, and melee (knife, rifle butt,
 * lunge, backstab). Visuals live in WeaponViewmodel / EffectsPool.
 */
const SLOT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"];

export class WeaponSystem {
  readonly stats: WeaponStats = { shotsFired: 0, shotsHit: 0, kills: 0, headshots: 0, damage: 0 };
  slots: Slot[] = [];
  current = 0;
  readonly mods: WeaponModifiers = { reloadSpeed: 1, adsSpeed: 1, recoil: 1, headshotDamage: 1, damage: 1, reserve: 1 };
  /** Set while in menus / reviving: no firing, no ADS. */
  disabled = false;
  /** When >= 0, swapping is locked to this slot (downed = sidearm only). */
  lockSlot = -1;

  adsAmount = 0;
  spread = 0;
  bloom = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  /** 0..1 progress of the current melee swing, or -1. */
  meleeProgress = -1;
  /** Which swing `meleeProgress` belongs to. */
  meleeKind: MeleeKind = "quick";

  private recoilTargetPitch = 0;
  private recoilTargetYaw = 0;
  private shotIndex = 0;
  private sinceShot = 10;
  private fireCooldown = 0;
  private semiBuffer = 0;
  private burstLeft = 0;
  private sprintOut = 0;
  private reloadTime = 0;
  private reloadDuration = 0;
  private reloadEmpty = false;
  private reloadStageIdx = 0;
  private shellMode = false;
  private swapTime = 0;
  private swapDuration = 0;
  private swapTo = -1;
  /** Raycast targets for the current shot (refreshed per trigger pull / knife swing). */
  private targets: THREE.Object3D[] = [];
  private wasAds = false;
  private shotCounter = 0;
  private meleeTime = 0;
  private meleeCooldown = 0;
  private meleeApplied = false;
  private readonly struck = new Set<Hittable>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  private readonly aimDir = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly lastHitPoint = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(
    defs: WeaponDef[],
    private readonly player: PlayerController,
    private readonly getTargets: () => THREE.Object3D[],
    private readonly hooks: WeaponHooks,
  ) {
    this.setLoadout(defs);
  }

  get active() {
    return this.slots[this.current];
  }
  get reloading() {
    return this.reloadDuration > 0;
  }
  get reloadProgress() {
    if (this.reloadDuration <= 0) return -1;
    // Shell reloads show progress toward a full tube.
    if (this.shellMode) return this.active.ammo / this.active.def.magSize;
    return this.reloadTime / this.reloadDuration;
  }
  get reloadIsEmpty() {
    return this.reloadEmpty;
  }
  get shellReloading() {
    return this.shellMode && this.reloadDuration > 0;
  }
  get lowered() {
    if (this.swapDuration <= 0) return 0;
    const t = this.swapTime / this.swapDuration;
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  }
  get swapping() {
    return this.swapDuration > 0;
  }
  /** Seconds since the last shot (viewmodel uses it for pump/bolt cycling). */
  get timeSinceShot() {
    return this.sinceShot;
  }
  get fireMode() {
    return this.active.mode;
  }
  /** The knife is in hand (slot 3). */
  get knifeOut() {
    return this.active.def.slot === "melee";
  }

  /**
   * Replace the carried weapons (the knife is always carried as the last
   * slot). Keeps ammo and fire mode for weapons you already had.
   */
  setLoadout(defs: WeaponDef[]) {
    const all = defs.some((d) => d.slot === "melee") ? defs : [...defs, WEAPONS.knife];
    const old = new Map(this.slots.map((s) => [s.def.id, s]));
    this.slots = all.map((def) => old.get(def.id) ?? { def, ammo: def.magSize, reserve: Math.round(def.reserveAmmo * this.mods.reserve), mode: def.modes[0] });
    this.current = Math.min(this.current, this.slots.length - 1);
    this.cancelReload();
    this.swapDuration = 0;
    this.adsAmount = 0;
    this.burstLeft = 0;
    this.hooks.onLoadout?.(this.slots.map((x) => x.def));
  }

  /** Survival: the sidearm never runs dry (reserve stays full, HUD shows the infinity sign). */
  infiniteSecondary = false;

  /** True when this slot's reserve is unlimited. */
  unlimited(slot: Slot) {
    return (this.infiniteSecondary && slot.def.slot === "secondary") || slot.def.slot === "melee";
  }

  /** Refill reserves (fraction of max) and top up magazines. */
  refillAmmo(fraction = 1) {
    for (const s of this.slots) {
      const max = Math.round(s.def.reserveAmmo * this.mods.reserve);
      s.reserve = Math.min(max, s.reserve + Math.ceil(max * fraction));
      if (fraction >= 1) s.ammo = s.def.magSize;
    }
  }

  resetAmmo() {
    for (const s of this.slots) {
      s.ammo = s.def.magSize;
      s.reserve = Math.round(s.def.reserveAmmo * this.mods.reserve);
    }
    this.cancelReload();
  }

  /** Aim intent this frame (read before the player step so movement slows). */
  wantsAds(input: Input) {
    return input.isDown("Mouse2") && !this.knifeOut && !this.swapping && !this.player.sprinting && !this.disabled && this.meleeProgress < 0;
  }

  update(dt: number, input: Input, eye: THREE.Vector3) {
    const slot = this.active;
    const def = slot.def;
    this.sinceShot += dt;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

    if (this.disabled) {
      this.adsAmount = Math.max(0, this.adsAmount - dt * 4);
      this.cancelReload();
      this.burstLeft = 0;
      // Don't leave a knife swing or swap frozen mid-way (its hit would land later).
      this.meleeProgress = -1;
      if (this.swapDuration > 0) {
        if (this.swapTo >= 0 && this.swapTo !== this.current) {
          this.current = this.swapTo;
          this.hooks.onSwap(this.active.def);
        }
        this.swapDuration = 0;
      }
      this.settleRecoil(dt, def);
      return;
    }

    // ---- Melee: V (quick), or fire / aim with the knife out --------------------
    if (this.meleeCooldown <= 0 && !this.swapping) {
      let kind: MeleeKind | null = null;
      if (input.pressed("KeyV")) kind = this.knifeOut ? "slash" : def.slot === "primary" ? "butt" : "quick";
      else if (this.knifeOut && input.isDown("Mouse0")) kind = "slash";
      else if (this.knifeOut && input.pressed("Mouse2")) kind = "stab";
      if (kind) this.startMelee(kind, eye);
    }
    if (this.meleeProgress >= 0) {
      const m = MELEE_SPECS[this.meleeKind];
      this.meleeTime += dt;
      this.meleeProgress = this.meleeTime / m.duration;
      if (!this.meleeApplied && this.meleeTime >= m.hitDelay) {
        this.meleeApplied = true;
        this.doMelee(eye, m);
      }
      if (this.meleeProgress >= 1) this.meleeProgress = -1;
    }

    // ---- Fire mode (B) ------------------------------------------------------
    if (input.pressed("KeyB") && def.modes.length > 1 && !this.knifeOut) {
      slot.mode = def.modes[(def.modes.indexOf(slot.mode) + 1) % def.modes.length];
      this.burstLeft = 0;
      this.hooks.onFireMode?.(slot.mode, def);
    }

    // ---- Swap -------------------------------------------------------------
    const wheel = input.consumeWheel();
    for (let i = 0; i < this.slots.length; i++) if (input.pressed(SLOT_KEYS[i])) this.requestSwap(i);
    if (wheel !== 0) this.requestSwap((this.current + (wheel > 0 ? 1 : this.slots.length - 1)) % this.slots.length);
    // Q toggles between the two guns (the knife is on 3 / the wheel).
    if (input.pressed("KeyQ")) this.requestSwap(this.current === 0 ? 1 : 0);
    if (this.swapDuration > 0) {
      const before = this.swapTime / this.swapDuration;
      this.swapTime += dt;
      const after = this.swapTime / this.swapDuration;
      if (before < 0.5 && after >= 0.5) {
        this.current = this.swapTo;
        this.hooks.onSwap(this.active.def);
      }
      if (after >= 1) this.swapDuration = 0;
    }

    // ---- Reload -----------------------------------------------------------
    if (this.reloadDuration > 0) this.tickReload(dt);
    else if (input.pressed("KeyR") && slot.ammo < def.magSize && slot.reserve > 0 && !this.swapping && this.meleeProgress < 0) this.startReload();

    // ---- ADS --------------------------------------------------------------
    const wantAds = this.wantsAds(input) && !(this.reloading && !this.shellMode);
    const adsRate = (dt / def.adsTime) * this.mods.adsSpeed;
    this.adsAmount = THREE.MathUtils.clamp(this.adsAmount + (wantAds ? adsRate : -adsRate * 1.25), 0, 1);
    if (wantAds && !this.wasAds) this.hooks.onAdsStart();
    this.wasAds = wantAds;

    // ---- Sprint-out delay -------------------------------------------------
    if (this.player.sprinting) this.sprintOut = def.sprintOutTime;
    else this.sprintOut = Math.max(0, this.sprintOut - dt);

    // ---- Spread -----------------------------------------------------------
    const s = def.spread;
    if (this.sinceShot > 60 / def.rpm + 0.02) this.bloom = Math.max(0, this.bloom - s.recovery * dt);
    const ads = this.adsAmount;
    const moveFrac = Math.min(this.player.speed / MOVEMENT.sprintSpeed, 1);
    this.spread =
      THREE.MathUtils.lerp(s.hip, s.ads, ads) +
      s.move * moveFrac * (1 - ads * 0.8) +
      (this.player.grounded ? 0 : s.air * (1 - ads * 0.5)) +
      (this.player.sliding ? s.move * 0.5 : 0) +
      this.bloom * (1 - ads * 0.6);

    // ---- Fire -------------------------------------------------------------
    this.fireCooldown -= dt;
    if (input.pressed("Mouse0")) this.semiBuffer = 0.12;
    else this.semiBuffer = Math.max(0, this.semiBuffer - dt);
    const mode = slot.mode;
    if (this.knifeOut) {
      this.semiBuffer = 0;
    } else if (mode === "burst" && this.semiBuffer > 0 && this.burstLeft === 0 && this.fireCooldown <= 0) {
      this.burstLeft = Math.min(def.burst ?? 3, Math.max(1, slot.ammo));
      this.semiBuffer = 0;
    }
    const trigger = this.knifeOut ? false : mode === "auto" ? input.isDown("Mouse0") : mode === "burst" ? this.burstLeft > 0 || (slot.ammo <= 0 && input.pressed("Mouse0")) : this.semiBuffer > 0;

    // Shotguns / bolt guns can interrupt a round-by-round reload by firing.
    if (trigger && this.shellMode && this.reloading && slot.ammo > 0) this.cancelReload();

    const ready = !this.reloading && !this.swapping && this.sprintOut <= 0 && !this.player.sprinting && this.meleeProgress < 0;
    if (trigger && ready) {
      if (slot.ammo <= 0) {
        this.burstLeft = 0;
        if (input.pressed("Mouse0")) {
          this.hooks.onDryFire();
          if (slot.reserve > 0) this.startReload();
        }
      } else {
        let guard = 0;
        while (this.fireCooldown <= 0 && slot.ammo > 0 && guard++ < 4) {
          this.fire(eye);
          this.fireCooldown += 60 / def.rpm;
          if (mode === "burst") {
            this.burstLeft = Math.max(0, this.burstLeft - 1);
            if (this.burstLeft === 0 || slot.ammo === 0) {
              this.burstLeft = 0;
              this.fireCooldown += BURST_GAP;
              break;
            }
          } else if (mode === "semi") {
            this.semiBuffer = 0;
            break;
          }
        }
      }
    } else if (!ready) this.burstLeft = 0;
    if (this.fireCooldown < 0) this.fireCooldown = 0;
    if (!input.isDown("Mouse0") && this.burstLeft === 0 && this.sinceShot > 0.25) this.shotIndex = 0;

    this.settleRecoil(dt, def);
  }

  private settleRecoil(dt: number, def: WeaponDef) {
    const r = def.recoil;
    if (this.sinceShot > r.recoveryDelay) {
      const k = damp(r.recovery, dt);
      this.recoilTargetPitch -= this.recoilTargetPitch * k;
      this.recoilTargetYaw -= this.recoilTargetYaw * k;
    }
    const snap = damp(r.snap, dt);
    this.recoilPitch += (this.recoilTargetPitch - this.recoilPitch) * snap;
    this.recoilYaw += (this.recoilTargetYaw - this.recoilYaw) * snap;
  }

  /** Builds the aim basis (incl. recoil) into aimDir/right/up. */
  private aimBasis() {
    this.euler.set(
      THREE.MathUtils.clamp(this.player.pitch + this.recoilPitch, -this.player.maxPitch, this.player.maxPitch),
      this.player.yaw + this.recoilYaw,
      0,
    );
    this.aimDir.set(0, 0, -1).applyEuler(this.euler);
    this.right.set(1, 0, 0).applyEuler(this.euler);
    this.up.set(0, 1, 0).applyEuler(this.euler);
  }

  private fire(eye: THREE.Vector3) {
    const slot = this.active;
    const def = slot.def;
    slot.ammo--;
    this.stats.shotsFired++;
    this.sinceShot = 0;
    const shotId = ++this.shotCounter;
    this.aimBasis();
    this.origin.copy(eye);
    // One target list per trigger pull, not per pellet.
    this.targets = this.getTargets();

    let anyHitPoint = false;
    let countedHit = false;
    for (let p = 0; p < def.pellets; p++) {
      // Pellets spread uniformly in the cone; single bullets bias to center.
      const a = Math.random() * Math.PI * 2;
      const u = def.pellets > 1 ? Math.sqrt(Math.random()) : Math.random();
      const rad = Math.tan(this.spread * DEG) * Math.sqrt(u);
      this.dir.copy(this.aimDir).addScaledVector(this.right, Math.cos(a) * rad).addScaledVector(this.up, Math.sin(a) * rad).normalize();

      this.castAll(this.dir, def.range);
      // Walk the hits front to back: bodies take damage (full-power rounds
      // carry on through `penetration` of them), the first wall stops it.
      this.struck.clear();
      let passes = def.penetration;
      let keep = 1;
      for (const hit of this.hits) {
        const data = hit.object.userData as Partial<HitboxUserData> & { surface?: Surface };
        if (data.hittable && data.part) {
          if (this.struck.has(data.hittable)) continue;
          this.struck.add(data.hittable);
          anyHitPoint = true;
          this.lastHitPoint.copy(hit.point);
          let dmg = damageAt(def, hit.distance) * this.mods.damage * keep;
          if (data.part === "head") dmg *= def.headMultiplier * this.mods.headshotDamage;
          else if (data.part === "legs") dmg *= def.limbMultiplier;
          const res = data.hittable.applyDamage(dmg, data.part, this.origin);
          if (res.counts) {
            if (!countedHit) {
              this.stats.shotsHit++;
              countedHit = true;
            }
            this.stats.damage += res.damage;
            if (res.killed) {
              this.stats.kills++;
              if (data.part === "head") this.stats.headshots++;
            }
            this.hooks.onHit(data.part, res.damage, res.killed, data.hittable.name, def.name, shotId, hit.point);
          }
          if (def.pellets === 1 || p % 3 === 0) this.hooks.onImpact(hit.point, this.normalOf(hit, this.dir), data.surface ?? "flesh", hit.distance);
          if (passes-- <= 0) break;
          keep *= PEN_KEEP;
          continue;
        }
        anyHitPoint = true;
        this.lastHitPoint.copy(hit.point);
        // Fewer impact effects for pellets to keep particle counts sane.
        if (def.pellets === 1 || p % 3 === 0) this.hooks.onImpact(hit.point, this.normalOf(hit, this.dir), data.surface ?? "concrete", hit.distance, (data as { material?: string }).material);
        break;
      }
    }
    this.hooks.onFire(def, anyHitPoint ? this.lastHitPoint : null);

    // Recoil kick from the pattern (+ jitter), damped while aiming.
    const r = def.recoil;
    const pat = r.pattern;
    const loopStart = Math.floor((pat.length * 2) / 3);
    const idx = this.shotIndex < pat.length ? this.shotIndex : loopStart + ((this.shotIndex - pat.length) % Math.max(1, pat.length - loopStart));
    const [kp, ky] = pat[Math.min(idx, pat.length - 1)];
    const scale = r.kickScale * this.mods.recoil * THREE.MathUtils.lerp(1, r.adsScale, this.adsAmount);
    this.recoilTargetPitch += (kp + (Math.random() * 2 - 1) * r.jitterPitch) * scale * DEG;
    this.recoilTargetYaw -= (ky + (Math.random() * 2 - 1) * r.jitterYaw) * scale * DEG;
    this.shotIndex++;
    this.bloom = Math.min(def.spread.max, this.bloom + def.spread.perShot);

    if (slot.ammo === 0 && slot.reserve > 0 && this.burstLeft <= 1) this.startReload();
  }

  /** All hits along a ray, nearest first. */
  private castAll(dir: THREE.Vector3, far: number) {
    this.raycaster.set(this.origin, dir);
    this.raycaster.far = far;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.targets, false, this.hits);
    return this.hits;
  }

  /** Nearest hit; fills this.normal with the world-space surface normal. */
  private cast(dir: THREE.Vector3, far: number) {
    const hit = this.castAll(dir, far)[0];
    if (!hit) return null;
    this.normalOf(hit, dir);
    return hit;
  }

  private normalOf(hit: THREE.Intersection, dir: THREE.Vector3) {
    if (hit.face) this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    else this.normal.copy(dir).negate();
    return this.normal;
  }

  private startMelee(kind: MeleeKind, eye: THREE.Vector3) {
    const m = MELEE_SPECS[kind];
    this.cancelReload();
    this.burstLeft = 0;
    this.meleeKind = kind;
    this.meleeProgress = 0;
    this.meleeTime = 0;
    this.meleeApplied = false;
    this.meleeCooldown = m.duration;
    this.adsAmount = 0;
    this.hooks.onMeleeStart?.(kind);
    if (!m.knife) return;
    // Lunge: close the gap to an enemy under the crosshair.
    this.aimBasis();
    this.origin.copy(eye);
    this.targets = this.getTargets();
    const hit = this.cast(this.aimDir, KNIFE.lungeRange);
    const data = hit?.object.userData as Partial<HitboxUserData> | undefined;
    if (hit && data?.hittable && hit.distance > m.range * 0.7) {
      const time = Math.min(0.2, (hit.distance - m.range * 0.55) / KNIFE.lungeSpeed);
      if (time > 0.02) this.player.lunge(this.aimDir, KNIFE.lungeSpeed, time);
    }
  }

  private doMelee(eye: THREE.Vector3, m: MeleeSpec) {
    const kind = this.meleeKind;
    this.aimBasis();
    this.origin.copy(eye);
    this.targets = this.getTargets();
    for (const yawOff of MELEE_FAN) {
      this.dir.copy(this.aimDir).addScaledVector(this.right, yawOff).addScaledVector(this.up, -0.05).normalize();
      const hit = this.cast(this.dir, m.range);
      if (!hit) continue;
      const data = hit.object.userData as Partial<HitboxUserData> & { surface?: Surface };
      if (data.hittable && data.part) {
        const target = data.hittable;
        const backstab = m.knife && this.isBehind(target);
        let dmg = m.damage * this.mods.damage;
        if (backstab) dmg = Math.max(dmg, KNIFE.backstab * this.mods.damage);
        else if (!m.knife && this.isBehind(target)) dmg *= 1.5;
        if (data.part === "head" && !backstab) dmg *= 1.2;
        const res = target.applyDamage(dmg, data.part, this.origin, "melee");
        if (res.counts) {
          this.stats.damage += res.damage;
          if (res.killed) this.stats.kills++;
          this.hooks.onHit(data.part, res.damage, res.killed, target.name, m.name, ++this.shotCounter, hit.point);
        }
        this.hooks.onImpact(hit.point, this.normal, data.surface ?? "flesh", hit.distance);
        this.hooks.onMelee(true, kind, backstab, (data.surface ?? "flesh") === "flesh");
        return;
      }
      if (yawOff === 0) {
        this.hooks.onImpact(hit.point, this.normal, data.surface ?? "concrete", hit.distance);
        this.hooks.onMelee(true, kind, false, false);
        return;
      }
    }
    this.hooks.onMelee(false, kind, false, false);
  }

  /** Attacker stands in the target's rear arc (needs the target's facing). */
  private isBehind(t: Hittable) {
    if (!t.heading || !t.position) return false;
    const yaw = t.heading();
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dx = this.origin.x - t.position.x;
    const dz = this.origin.z - t.position.z;
    const len = Math.hypot(dx, dz) || 1;
    return (dx * fx + dz * fz) / len < -0.35;
  }

  /** Instantly switch to a slot (no animation), e.g. drawing the sidearm when downed. */
  forceSlot(index: number) {
    if (index < 0 || index >= this.slots.length) return;
    // Always kill an in-flight swap, or it could land on another slot later.
    this.swapDuration = 0;
    this.swapTo = -1;
    if (index === this.current) return;
    this.cancelReload();
    this.current = index;
    this.adsAmount = 0;
    this.burstLeft = 0;
    this.hooks.onSwap(this.active.def);
  }

  private requestSwap(index: number) {
    if (this.lockSlot >= 0 && index !== this.lockSlot) return;
    if (index === this.current || index < 0 || index >= this.slots.length) return;
    if (this.swapping) {
      if (this.swapTime / this.swapDuration < 0.5) this.swapTo = index;
      return;
    }
    this.cancelReload();
    this.swapTo = index;
    this.swapTime = 0;
    this.swapDuration = (this.active.def.swapTime + this.slots[index].def.swapTime) / 2;
    this.adsAmount = 0;
    this.shotIndex = 0;
    this.bloom = 0;
    this.burstLeft = 0;
  }

  private startReload() {
    const def = this.active.def;
    if (def.magSize <= 0) return;
    this.reloadEmpty = this.active.ammo === 0;
    this.shellMode = Boolean(def.shellReload);
    this.reloadTime = 0;
    this.reloadStageIdx = 0;
    this.burstLeft = 0;
    // Shell reloads: a short "start" plus one interval per shell.
    this.reloadDuration = this.shellMode ? (0.3 + def.reloadTime) / this.mods.reloadSpeed : (this.reloadEmpty ? def.reloadEmptyTime : def.reloadTime) / this.mods.reloadSpeed;
    if (!this.shellMode) this.adsAmount = Math.min(this.adsAmount, 0.25);
    else if (def.scope) this.adsAmount = 0;
    this.hooks.onReload("start", def);
  }

  private tickReload(dt: number) {
    const slot = this.active;
    const def = slot.def;
    this.reloadTime += dt;

    if (this.shellMode) {
      if (this.reloadTime >= this.reloadDuration) {
        if (slot.reserve > 0 && slot.ammo < def.magSize) {
          slot.ammo++;
          slot.reserve--;
          this.hooks.onReload("shell", def);
        }
        if (slot.ammo >= def.magSize || slot.reserve <= 0) {
          this.reloadDuration = 0;
          this.shellMode = false;
          this.hooks.onReload(this.reloadEmpty ? "bolt" : "done", def);
        } else {
          this.reloadTime = 0;
          this.reloadDuration = def.reloadTime / this.mods.reloadSpeed;
        }
      }
      return;
    }

    const t = this.reloadTime / this.reloadDuration;
    const stages = this.reloadEmpty ? STAGES_EMPTY : STAGES_TACTICAL;
    while (this.reloadStageIdx < stages.length && t >= stages[this.reloadStageIdx][0]) {
      this.hooks.onReload(stages[this.reloadStageIdx][1], def);
      this.reloadStageIdx++;
    }
    if (t >= 1) {
      const take = Math.min(def.magSize - slot.ammo, slot.reserve);
      slot.ammo += take;
      if (this.unlimited(slot)) slot.reserve = Math.round(def.reserveAmmo * this.mods.reserve);
      else slot.reserve -= take;
      this.reloadDuration = 0;
      this.hooks.onReload("done", def);
    }
  }

  private cancelReload() {
    this.reloadDuration = 0;
    this.reloadTime = 0;
    this.shellMode = false;
  }
}
