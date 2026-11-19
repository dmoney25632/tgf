import * as THREE from "three";
import { CAMERA, LOOK, QUALITY, SIM, type QualityName } from "../config";
import { Input } from "./Input";
import { damp } from "./Spring";
import { PlayerController, type CameraOffsets, type MoveIntent } from "../player/PlayerController";
import { WeaponSystem } from "../weapons/WeaponSystem";
import { WeaponViewmodel, type ViewmodelState } from "../weapons/WeaponViewmodel";
import { GrenadeSystem } from "../weapons/GrenadeSystem";
import { DEFAULT_LOADOUT, WEAPONS, type WeaponDef, type WeaponId } from "../weapons/weapons";
import { loadMap, type LoadedMap, type MapDef } from "../world/MapLoader";
import { KESTREL_YARD } from "../world/maps/kestrelYard";
import { DUSTFALL_OUTPOST } from "../world/maps/dustfallOutpost";
import { getMap } from "../world/maps/registry";
import { EffectsPool } from "../effects/EffectsPool";
import { CameraShake } from "../effects/CameraShake";
import { RenderPipeline } from "../render/RenderPipeline";
import { HUD, type HitKind } from "../ui/HUD";
import { Sfx } from "../audio/Sfx";
import type { EngineContext, EngineEvent, GameMode } from "./GameMode";
import { RangeMode } from "./RangeMode";
import { SurvivalGameMode, type SurvivalConfig } from "../survival/SurvivalGameMode";

export type GameSettings = {
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Extra multiplier while aiming. */
  adsSensitivity: number;
  quality: QualityName;
  volume: number;
};

export type EngineOptions = {
  mode?: "range" | "survival";
  survival?: SurvivalConfig;
  map?: MapDef;
  /** Map by registry id (world/maps/registry.ts); `map` wins when both are set. */
  mapId?: string;
  loadout?: WeaponId[];
  callsign?: string;
  settings?: Partial<GameSettings>;
  /** Pointer lock changes (React shows/hides the pause menu). */
  onLockChange?: (locked: boolean) => void;
  onEvent?: (e: EngineEvent) => void;
};

/**
 * Iron Horizon engine: owns the loop and the shared FPS core; a GameMode
 * (firing range, survival) layers rules, targets, AI and UI on top.
 *
 * Frame order:
 *   input → mouse look → fixed-step movement (120 Hz) → camera (interpolated)
 *   → weapons + grenades (fire from the fresh aim) → mode (AI, waves)
 *   → viewmodel/effects/audio → HUD → render
 */
export class GameEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  private readonly pipeline: RenderPipeline;
  private readonly input: Input;
  private readonly map: LoadedMap;
  private readonly player: PlayerController;
  private readonly weapons: WeaponSystem;
  private readonly grenades: GrenadeSystem;
  private readonly viewmodel: WeaponViewmodel;
  private readonly effects: EffectsPool;
  private readonly shake = new CameraShake();
  private readonly hud: HUD;
  private readonly sfx = new Sfx();
  private readonly resizeObserver: ResizeObserver;
  readonly settings: GameSettings;
  readonly mode: GameMode;
  private readonly callsign: string;

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private sessionTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private frameMs = 0;
  private disposed = false;
  private crouchToggle = false;
  private lastYaw = 0;
  private lastPitch = 0;

  // Reused per-frame objects (no allocations in the loop).
  private readonly mouse = { x: 0, y: 0 };
  private readonly intent: MoveIntent = { forward: 0, strafe: 0, sprint: false, crouch: false, crouchPressed: false, jumpPressed: false, ads: 0, blockSprint: false };
  private readonly offsets: CameraOffsets = { recoilPitch: 0, recoilYaw: 0, shakePitch: 0, shakeYaw: 0, shakeRoll: 0, shakeX: 0, shakeY: 0 };
  private readonly vmState: ViewmodelState = {
    ads: 0, sprint: 0, slide: 0, bobDistance: 0, bobAmount: 0, yawDelta: 0, pitchDelta: 0, reload: -1, reloadEmpty: false,
    lowered: 0, grounded: true, melee: -1, throwing: -1, sinceShot: 9, shellReload: false, empty: false,
  };
  private readonly raycastList: THREE.Object3D[] = [];
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly debugInfo: Record<string, string | number> = {};

  constructor(private readonly container: HTMLElement, private readonly opts: EngineOptions = {}) {
    this.callsign = opts.callsign ?? "Recruit";
    this.settings = { sensitivity: 1, adsSensitivity: 1, quality: "medium", volume: 0.8, ...opts.settings };
    const survival = opts.mode === "survival";

    const preset = QUALITY[this.settings.quality];
    const picked = opts.map ?? getMap(opts.mapId);
    const mapDef = picked && (!survival || picked.survival) ? picked : survival ? DUSTFALL_OUTPOST : KESTREL_YARD;
    this.map = loadMap(this.scene, mapDef, preset);
    this.viewmodel = new WeaponViewmodel(null);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera, this.map.sun);
    this.viewmodel.scene.environment = this.pipeline.envMap;

    this.input = new Input(this.pipeline.canvas);
    this.effects = new EffectsPool(this.scene, preset.maxDecals, preset.maxParticles);
    this.effects.onShellLand = (at, kind, speed) => this.sfx.shellDrop(at, kind, speed);
    this.player = new PlayerController(this.camera, this.map.collision);
    this.hud = new HUD(container);

    const defs: WeaponDef[] = (opts.loadout ?? DEFAULT_LOADOUT).map((id) => WEAPONS[id]);
    this.weapons = new WeaponSystem(defs, this.player, () => this.collectRaycastTargets(), {
      onFire: (def, hitPoint) => this.onFire(def, hitPoint),
      onImpact: (point, normal, surface) => {
        this.effects.impact(point, normal, surface);
        if (surface !== "flesh") this.sfx.impact(point, surface);
      },
      onHit: (part, dmg, killed, name, source, shotId, point) => {
        const kind: HitKind = killed ? (part === "head" ? "headkill" : "kill") : part === "head" ? "head" : "body";
        const medal = this.mode.onWeaponHit(part, dmg, killed, name, source, shotId, point);
        this.hud.hit(kind, medal);
        this.sfx.hit(kind);
        if (killed) this.shake.add(0.08);
      },
      onDryFire: () => this.sfx.dryFire(),
      onReload: (stage, def) => {
        this.sfx.reload(stage);
        if (stage === "bolt" && def.cycleAction) this.sfx.pump();
      },
      onSwap: (def) => {
        this.viewmodel.setWeapon(def);
        this.sfx.swap();
      },
      onAdsStart: () => this.sfx.adsIn(),
      onMelee: (hit) => {
        this.sfx.knife(hit);
        if (hit) this.shake.add(0.06);
      },
    });
    this.viewmodel.setWeapon(defs[0]);

    this.grenades = new GrenadeSystem(this.scene, this.map.collision, {
      onThrow: () => this.sfx.grenadeThrow(),
      onBounce: (at) => this.sfx.grenadeBounce(at),
      onExplode: (at) => this.onExplosion(at),
    });

    const ctx: EngineContext = {
      scene: this.scene,
      camera: this.camera,
      container,
      input: this.input,
      map: this.map,
      player: this.player,
      weapons: this.weapons,
      grenades: this.grenades,
      viewmodel: this.viewmodel,
      effects: this.effects,
      shake: this.shake,
      hud: this.hud,
      sfx: this.sfx,
      callsign: this.callsign,
      quality: this.settings.quality,
      emit: (e) => this.opts.onEvent?.(e),
      unlock: () => {
        if (document.pointerLockElement === this.pipeline.canvas) document.exitPointerLock();
      },
      spawnPoint: (out) => {
        const s = this.map.def.spawns[0];
        out.set(s.x, s.y ?? 0, s.z);
        return { yaw: s.yaw };
      },
    };
    this.respawn();
    this.mode = survival && opts.survival ? new SurvivalGameMode(ctx, opts.survival) : new RangeMode(ctx);
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;

    this.pipeline.setQuality(preset);
    this.sfx.setVolume(this.settings.volume);

    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("pointerlockerror", this.onLockError);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Public API (used by the React host)
  // ---------------------------------------------------------------------------

  start() {
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Must be called from a user gesture (click). */
  lock() {
    this.sfx.resume();
    const canvas = this.pipeline.canvas;
    // A stale engine (mid-remount) has a detached canvas: locking it rejects
    // with WrongDocumentError, so don't try.
    if (this.disposed || !canvas.isConnected) return;
    type LockResult = Promise<void> | undefined;
    const fail = () => this.opts.onLockChange?.(false);
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true }) as unknown as LockResult;
      p?.catch?.(() => {
        // Some platforms reject unadjustedMovement; retry with plain lock.
        if (!canvas.isConnected) return fail();
        try {
          (canvas.requestPointerLock() as unknown as LockResult)?.catch?.(fail);
        } catch {
          fail();
        }
      });
    } catch {
      fail();
    }
  }

  get survival(): SurvivalGameMode | null {
    return this.mode instanceof SurvivalGameMode ? this.mode : null;
  }

  /** Range only: back to the start line with full ammo. */
  respawn() {
    if (this.mode instanceof SurvivalGameMode) return;
    const s = this.map.def.spawns[0];
    this.player.spawn(this.tmpA.set(s.x, s.y ?? 0, s.z), s.yaw);
    this.weapons.resetAmmo();
    this.grenades.reset();
    this.crouchToggle = false;
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;
  }

  applySettings(next: Partial<GameSettings>) {
    const prevQuality = this.settings.quality;
    Object.assign(this.settings, next);
    if (next.quality && next.quality !== prevQuality) {
      const q = QUALITY[next.quality];
      this.pipeline.setQuality(q);
      this.map.setQuality(q);
      this.effects.setLimits(q.maxDecals, q.maxParticles);
      this.resize();
    }
    if (next.volume !== undefined) this.sfx.setVolume(next.volume);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    const t0 = performance.now();

    const input = this.input;
    input.watchdog();
    const playing = input.locked;
    let alpha = 1;

    if (playing) {
      this.sessionTime += dt;
      this.handleHotkeys();

      // Mouse look every frame (lowest latency), scaled down while aiming.
      input.consumeMouseDelta(this.mouse);
      const ads = this.weapons.adsAmount;
      const sens = LOOK.baseSensitivity * this.settings.sensitivity * THREE.MathUtils.lerp(1, LOOK.adsSensitivityMultiplier * this.settings.adsSensitivity, ads);
      this.player.look(this.mouse.x, this.mouse.y, sens);

      this.buildIntent();
      this.player.frameInput(dt, this.intent);

      // Fixed-step physics.
      const h = 1 / SIM.hz;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= h && steps < SIM.maxStepsPerFrame) {
        this.player.fixedStep(h, this.intent);
        this.accumulator -= h;
        steps++;
      }
      if (steps === SIM.maxStepsPerFrame) this.accumulator = 0;
      alpha = this.accumulator / h;
      if (this.player.position.y < -20) {
        const s = this.map.def.spawns[0];
        this.player.spawn(this.tmpA.set(s.x, s.y ?? 0, s.z), s.yaw);
      }
    }

    // Camera: recoil from the weapon + shake.
    this.shake.update(dt, this.offsets);
    this.offsets.recoilPitch = this.weapons.recoilPitch;
    this.offsets.recoilYaw = this.weapons.recoilYaw;
    this.player.updateCamera(dt, alpha, this.weapons.adsAmount, this.offsets);

    if (playing) {
      // Grenade wind-up blocks the gun; the gun blocks the throw.
      const throwing = this.grenades.throwProgress >= 0;
      if (input.pressed("KeyG") && !this.weapons.reloading && this.weapons.meleeProgress < 0 && !this.player.sprinting) this.grenades.tryThrow();
      const wasDisabled = this.weapons.disabled;
      if (throwing) this.weapons.disabled = true;
      this.weapons.update(dt, input, this.camera.position);
      this.weapons.disabled = wasDisabled;
      this.grenades.update(dt, this.camera.position, this.player.yaw, this.player.pitch, this.player.velocity);
    }

    this.mode.update(playing ? dt : 0, playing);

    this.updateFov(dt);
    this.handleMoveEvents();
    this.updateViewmodel(dt);
    this.effects.update(playing ? dt : 0);

    this.camera.getWorldDirection(this.forward);
    this.sfx.setListener(this.camera.position, this.forward);

    this.updateHud(dt, playing);
    input.endFrame();

    this.pipeline.render();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  private handleHotkeys() {
    const input = this.input;
    if (input.pressed("F3") || input.pressed("Backquote")) this.hud.toggleDebug();
  }

  private buildIntent() {
    const input = this.input;
    const it = this.intent;
    it.forward = (input.isDown("KeyW") ? 1 : 0) - (input.isDown("KeyS") ? 1 : 0);
    it.strafe = (input.isDown("KeyD") ? 1 : 0) - (input.isDown("KeyA") ? 1 : 0);
    it.sprint = input.isDown("ShiftLeft") || input.isDown("ShiftRight");
    it.jumpPressed = input.pressed("Space");

    // Crouch: C toggles, Ctrl holds. Sprinting or jumping clears the toggle.
    const crouchKeyPressed = input.pressed("KeyC") || input.pressed("ControlLeft");
    if (input.pressed("KeyC")) this.crouchToggle = !this.crouchToggle;
    if ((input.pressed("ShiftLeft") || it.jumpPressed) && !this.player.sliding) this.crouchToggle = false;
    if (this.player.sprinting && input.pressed("KeyC")) this.crouchToggle = true; // slide → stay low
    it.crouch = this.crouchToggle || input.isDown("ControlLeft");
    it.crouchPressed = crouchKeyPressed;

    it.ads = this.weapons.adsAmount;
    it.blockSprint = input.isDown("Mouse0") || this.weapons.wantsAds(input) || this.grenades.throwProgress >= 0;
  }

  private updateFov(dt: number) {
    const def = this.weapons.active.def;
    const a = this.weapons.adsAmount;
    const ease = a * a * (3 - 2 * a);
    const base = CAMERA.fov + this.player.fovOffset;
    const target = THREE.MathUtils.lerp(base, def.adsFov, ease);
    const fov = this.camera.fov + (target - this.camera.fov) * damp(30, dt);
    if (Math.abs(this.camera.fov - fov) > 0.005) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private handleMoveEvents() {
    const e = this.player.events;
    if (e.footstep) this.sfx.footstep(e.footstep, this.player.crouching);
    if (e.jumped) this.sfx.jump();
    if (e.landed > 2) {
      this.sfx.land(e.landed);
      this.viewmodel.landImpact(e.landed);
      if (e.landed > 7) this.shake.add(Math.min(0.25, e.landed * 0.02));
    }
    if (e.slideStarted) this.sfx.slide();
    e.footstep = 0;
    e.jumped = false;
    e.landed = 0;
    e.slideStarted = false;
  }

  private updateViewmodel(dt: number) {
    const s = this.vmState;
    const p = this.player;
    s.ads = this.weapons.adsAmount;
    s.sprint = p.sprintBlend;
    s.slide = p.slideBlend;
    s.bobDistance = p.bobDistance;
    s.bobAmount = p.bobAmount;
    s.yawDelta = p.yaw - this.lastYaw;
    s.pitchDelta = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    s.reload = this.weapons.reloadProgress;
    s.reloadEmpty = this.weapons.reloadIsEmpty;
    s.lowered = this.weapons.lowered;
    s.grounded = p.grounded;
    s.melee = this.weapons.meleeProgress;
    s.throwing = this.grenades.throwProgress;
    s.sinceShot = this.weapons.timeSinceShot;
    s.shellReload = this.weapons.shellReloading;
    s.empty = this.weapons.active.ammo === 0;
    this.viewmodel.update(dt, s);
    this.viewmodel.drainShells(this.camera, this.effects, p.position.y, p.velocity);
  }

  private onFire(def: WeaponDef, hitPoint: THREE.Vector3 | null) {
    this.viewmodel.kick(def, this.weapons.adsAmount);
    this.shake.add(def.shake * (1 - this.weapons.adsAmount * 0.4));
    this.sfx.gunshot(def);

    // Muzzle position in world space for the light + tracer.
    this.viewmodel.pivot.updateMatrixWorld(true);
    this.viewmodel.muzzleWorld(this.camera, this.tmpA);
    this.camera.getWorldDirection(this.forward);
    this.effects.muzzleFlash(this.tmpA, this.forward, def.shake / 0.16);
    if (hitPoint) this.effects.tracer(this.tmpA, hitPoint);
    else this.effects.tracer(this.tmpA, this.tmpB.copy(this.camera.position).addScaledVector(this.forward, 200));
  }

  private onExplosion(at: THREE.Vector3) {
    this.effects.explosion(at);
    const dist = at.distanceTo(this.camera.position);
    this.sfx.explosion(at, dist);
    this.shake.add(Math.max(0, 0.6 * (1 - dist / 36)));
    this.mode.onExplosion(at);
  }

  private updateHud(dt: number, playing: boolean) {
    const w = this.weapons.active;
    const ads = this.weapons.adsAmount;
    const v = this.mode.vitals();
    this.hud.frame(
      {
        spreadDeg: this.weapons.spread,
        fovDeg: this.camera.fov,
        viewportH: this.container.clientHeight,
        crosshairHide: Math.max(ads, this.player.sprintBlend, this.weapons.lowered, this.weapons.meleeProgress >= 0 || this.grenades.throwProgress >= 0 ? 1 : 0),
        ammo: w.ammo,
        reserve: w.reserve,
        magSize: w.def.magSize,
        weaponName: w.def.name,
        weaponKind: w.def.kind,
        slot: this.weapons.current,
        slotNames: this.weapons.slots.map((s) => s.def.name.split(" ")[0]),
        reload: this.weapons.reloadProgress,
        health: v.health,
        maxHealth: v.maxHealth,
        armor: v.armor,
        grenades: this.grenades.count >= 50 ? -1 : this.grenades.count,
        scope: w.def.scope ? ads : 0,
      },
      dt,
    );
    this.hud.setScoreboard(playing && this.input.isDown("Tab"), this.callsign, this.weapons.stats, this.sessionTime, this.map.def.name);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.hud.setFps(this.fps);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (this.hud.debugVisible) {
      const p = this.player;
      const d = this.debugInfo;
      const r = this.pipeline.info.render;
      d.fps = `${this.fps}  (${this.frameMs.toFixed(2)} ms cpu)`;
      d.quality = this.settings.quality;
      d["draw calls"] = `${r.calls}  tris ${r.triangles}`;
      d.position = `${p.position.x.toFixed(2)} ${p.position.y.toFixed(2)} ${p.position.z.toFixed(2)}`;
      d.velocity = `${p.velocity.x.toFixed(2)} ${p.velocity.y.toFixed(2)} ${p.velocity.z.toFixed(2)}`;
      d.speed = `${p.speed.toFixed(2)} m/s`;
      d.state = [p.grounded ? "grounded" : "air", p.sprinting && "sprint", p.crouching && "crouch", p.sliding && "slide", p.downed && "downed"].filter(Boolean).join(" ");
      d["look"] = `yaw ${(p.yaw * 57.3).toFixed(1)}  pitch ${(p.pitch * 57.3).toFixed(1)}`;
      d.fov = this.camera.fov.toFixed(1);
      d.weapon = `${w.def.name} ${w.def.rpm}rpm ${w.def.damage}×${w.def.pellets}dmg`;
      d.ads = ads.toFixed(2);
      d.spread = `${this.weapons.spread.toFixed(2)}°  bloom ${this.weapons.bloom.toFixed(2)}`;
      d.recoil = `${(this.weapons.recoilPitch * 57.3).toFixed(2)}° / ${(this.weapons.recoilYaw * 57.3).toFixed(2)}°`;
      this.mode.debug(d);
      this.hud.setDebug(d);
    }
  }

  private collectRaycastTargets() {
    const list = this.raycastList;
    list.length = 0;
    this.mode.collectTargets(list);
    const meshes = this.map.meshes;
    for (let i = 0; i < meshes.length; i++) list.push(meshes[i]);
    return list;
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(w / h);
    this.effects.setViewportHeight(h * this.pipeline.renderer.getPixelRatio());
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.pipeline.canvas;
    if (locked) this.accumulator = 0;
    this.opts.onLockChange?.(locked);
  };
  private onLockError = () => this.opts.onLockChange?.(false);
  /** Guards against Ctrl+W (crouch + forward) closing the tab mid-fight. */
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.input.locked) e.preventDefault();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (document.pointerLockElement === this.pipeline.canvas) document.exitPointerLock();
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("pointerlockerror", this.onLockError);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.mode.dispose();
    this.viewmodel.dispose();
    this.grenades.dispose();
    this.effects.dispose();
    this.map.dispose();
    this.hud.dispose();
    this.sfx.dispose();
    this.pipeline.dispose();
  }
}
