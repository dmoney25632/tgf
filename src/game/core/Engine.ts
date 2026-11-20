import * as THREE from "three";
import { CAMERA, LOOK, QUALITY, SIM } from "../config";
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
import { MissionGameMode } from "../missions/MissionGameMode";
import { getMission } from "../missions/campaign";
import type { MissionConfig } from "../missions/types";
import { EffectsPool } from "../effects/EffectsPool";
import { CameraShake } from "../effects/CameraShake";
import { RenderPipeline } from "../render/RenderPipeline";
import { HUD, type HitKind, type HudFrame } from "../ui/HUD";
import { sanitizeSettings, saveSettings, type GameSettings } from "../ui/Settings";
import { glyphContext } from "../ui/Glyphs";
import { hudSignals } from "../ui/SurvivalHUD";
import { AimAssist } from "../player/AimAssist";
import { MobileLayer } from "../mobile/MobileLayer";
import { Sfx } from "../audio/Sfx";
import type { EngineContext, EngineEvent, GameMode } from "./GameMode";
import { RangeMode } from "./RangeMode";
import { BackgroundTicker } from "./BackgroundTicker";
import { SurvivalGameMode, type SurvivalConfig } from "../survival/SurvivalGameMode";

export type { GameSettings };

export type EngineOptions = {
  mode?: "range" | "survival" | "mission";
  survival?: SurvivalConfig;
  mission?: MissionConfig;
  map?: MapDef;
  /** Map by registry id (world/maps/registry.ts); `map` wins when both are set. */
  mapId?: string;
  loadout?: WeaponId[];
  callsign?: string;
  settings?: Partial<GameSettings>;
  /** Engaged (pointer lock or gamepad session) changes: React shows/hides the pause menu. */
  onLockChange?: (locked: boolean) => void;
  /** The browser refused pointer lock (React shows "click to resume"). */
  onLockError?: () => void;
  onEvent?: (e: EngineEvent) => void;
  /** The engine changed a setting itself (auto quality): React mirrors and persists it. */
  onSettingsChange?: (s: GameSettings) => void;
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
  private readonly aimAssist = new AimAssist();
  private readonly assistList: THREE.Object3D[] = [];
  private readonly mobile: MobileLayer;
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
  private slowTime = 0;
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
  private readonly bufSize = new THREE.Vector2();
  private readonly debugInfo: Record<string, string | number> = {};
  private readonly hudFrame: HudFrame = {
    spreadDeg: 0, fovDeg: 0, viewportH: 1, crosshairHide: 0, ammo: 0, reserve: 0, magSize: 1, weaponName: "", weaponKind: "",
    slot: 0, slots: [], reload: -1, health: 0, maxHealth: 1, armor: 0, grenades: -1, scope: 0, yaw: 0,
  };
  /** Cached container size (read only on resize, never per frame). */
  private viewW = 1;
  private viewH = 1;
  private resolutionVersion = -1;

  constructor(private readonly container: HTMLElement, private readonly opts: EngineOptions = {}) {
    this.callsign = opts.callsign ?? "Recruit";
    this.settings = sanitizeSettings(opts.settings);
    const survival = opts.mode === "survival";

    const preset = QUALITY[this.settings.quality];
    const picked = opts.map ?? getMap(opts.mission ? getMission(opts.mission.missionId)?.mapId : opts.mapId);
    const mapDef = picked && (!survival || picked.survival) ? picked : survival ? DUSTFALL_OUTPOST : KESTREL_YARD;
    this.map = loadMap(this.scene, mapDef, preset);
    this.viewmodel = new WeaponViewmodel(null);
    this.viewmodel.setSun(this.map.sun ?? null);
    this.pipeline = new RenderPipeline(container, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera, this.map.sun);
    this.viewmodel.scene.environment = this.pipeline.envMap;

    this.input = new Input(this.pipeline.canvas);
    this.input.configure(this.settings);
    this.input.requestLock = () => this.lock();
    this.input.interactContext = () => hudSignals.interact;
    this.input.onEngageChange = (engaged) => {
      if (engaged) this.accumulator = 0;
      else this.aimAssist.reset();
      this.opts.onLockChange?.(engaged);
    };
    this.input.onDeviceChange = () => this.syncGlyphs();
    // [mobile] Touch controls, rotate/fullscreen, context-loss overlay (inert on desktop).
    this.mobile = new MobileLayer(container, this.input, this.pipeline.canvas, { settings: () => this.settings, ads: () => this.weapons?.adsAmount ?? 0, assist: () => this.aimAssist.slow });
    this.effects = new EffectsPool(this.scene, preset.maxDecals, preset.maxParticles);
    this.effects.onShellLand = (at, kind, speed) => this.sfx.shellDrop(at, kind, speed);
    this.player = new PlayerController(this.camera, this.map.collision);
    this.hud = new HUD(container);
    this.hud.onHurt = (amount) => this.input.rumble(Math.min(1, amount / 45), 0.35, 140);
    this.hud.setFpsVisible(this.settings.showFps);
    this.syncGlyphs();

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
        this.input.rumble(killed ? 0.35 : 0, killed ? 0.5 : 0.22, killed ? 110 : 45);
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
      unlock: () => this.input.disengage(),
      spawnPoint: (out) => {
        const s = this.map.def.spawns[0];
        out.set(s.x, s.y ?? 0, s.z);
        return { yaw: s.yaw };
      },
    };
    this.respawn();
    this.mode =
      survival && opts.survival ? new SurvivalGameMode(ctx, opts.survival) : opts.mode === "mission" && opts.mission ? new MissionGameMode(ctx, opts.mission) : new RangeMode(ctx);
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;

    this.pipeline.setQuality(preset);
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMix(this.settings.effectsVolume, this.settings.uiVolume);

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
    this.lastTime = this.lastRafAt = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.onVisibility();
  }

  /**
   * Enter play. Mouse: must be called from a user gesture (click/key).
   * `via: "pad"` starts a gamepad session instead (no pointer lock needed;
   * gamepad presses can't request it); falls back to pointer lock without a pad.
   */
  lock(via?: "pad") {
    this.sfx.resume();
    const canvas = this.pipeline.canvas;
    // A stale engine (mid-remount) has a detached canvas: locking it rejects
    // with WrongDocumentError, so don't try.
    if (this.disposed || !canvas.isConnected) return;
    if (via === "pad" && this.input.engagePad()) return;
    if (this.mobile.engage()) return; // touch device: on-screen controls instead of pointer lock
    type LockResult = Promise<void> | undefined;
    const fail = () => (this.opts.onLockError ? this.opts.onLockError() : this.opts.onLockChange?.(false));
    try {
      // Raw input is opt-in: on macOS especially, unaccelerated deltas feel far
      // slower and heavier than the desktop pointer people are used to.
      const p = (this.settings.rawInput ? canvas.requestPointerLock({ unadjustedMovement: true }) : canvas.requestPointerLock()) as unknown as LockResult;
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

  get mission(): MissionGameMode | null {
    return this.mode instanceof MissionGameMode ? this.mode : null;
  }

  /** Range only: back to the start line with full ammo. */
  respawn() {
    if (this.mode instanceof SurvivalGameMode || this.mode instanceof MissionGameMode) return;
    const s = this.map.def.spawns[0];
    this.player.spawn(this.tmpA.set(s.x, s.y ?? 0, s.z), s.yaw);
    this.weapons.resetAmmo();
    this.grenades.reset();
    this.crouchToggle = false;
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;
  }

  /** Leave play (pause). */
  unlock() {
    this.input.disengage();
  }

  get mapName() {
    return this.map.def.name;
  }

  applySettings(next: Partial<GameSettings>) {
    const prevQuality = this.settings.quality;
    const prevBindings = this.settings.bindings;
    const prevRaw = this.settings.rawInput;
    Object.assign(this.settings, sanitizeSettings({ ...this.settings, ...next }));
    if (!next.bindings) this.settings.bindings = prevBindings;
    this.input.configure(this.settings);
    this.hud.setFpsVisible(this.settings.showFps);
    if (this.settings.bindings !== prevBindings) this.syncGlyphs();
    if (next.quality && next.quality !== prevQuality) {
      const q = QUALITY[next.quality];
      this.pipeline.setQuality(q);
      this.map.setQuality(q);
      this.effects.setLimits(q.maxDecals, q.maxParticles);
      this.resize();
    }
    if (next.volume !== undefined) this.sfx.setVolume(next.volume);
    if (next.effectsVolume !== undefined || next.uiVolume !== undefined) this.sfx.setMix(this.settings.effectsVolume, this.settings.uiVolume);
    // Switch raw/accelerated movement right away if the pointer is locked.
    if (this.settings.rawInput !== prevRaw && document.pointerLockElement === this.pipeline.canvas) this.lock();
    if (next.quality || next.autoQuality !== undefined) this.slowTime = 0;
  }

  /**
   * Auto quality: when frames stay slow even after dynamic resolution has
   * done what it can, step down one preset (never back up by itself, so it
   * can't oscillate). Runs on the 0.5 s fps sample.
   */
  private governQuality(fps: number, sample: number) {
    const s = this.settings;
    if (!s.autoQuality || s.quality === "low" || this.sessionTime < 6 || document.hidden) {
      this.slowTime = 0;
      return;
    }
    const pl = this.pipeline;
    const q = QUALITY[s.quality];
    const floored = pl.resolutionScale <= q.minResolutionScale + 0.01 || (pl.gpuMs > 0 && pl.gpuMs < q.targetFrameMs * 0.55);
    if (fps < 50 && floored) this.slowTime += sample;
    else this.slowTime = Math.max(0, this.slowTime - sample * 2);
    if (this.slowTime < 4) return;
    this.slowTime = -6; // let the new preset settle before judging again
    const quality = s.quality === "high" ? "medium" : "low";
    this.applySettings({ quality });
    saveSettings(this.settings);
    this.opts.onSettingsChange?.({ ...this.settings });
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private skyVis = 1;
  private sunVis = 1;
  private skyPatchIn = 0;
  private readonly sunDir = new THREE.Vector3();

  /**
   * Indoors / in shade: drives the viewmodel's sky fill and sun key from the
   * camera's position (roof volumes + a ray toward the sun), and keeps sky
   * occlusion patched into materials that load later (props, enemies).
   */
  private updateLightOcclusion(dt: number) {
    const p = this.camera.position;
    const sun = this.map.sun;
    this.sunDir.subVectors(sun.position, sun.target.position).normalize();
    const d = this.sunDir;
    const sunTarget = this.map.collision.raycast(p.x, p.y, p.z, d.x || 1e-6, d.y || 1e-6, d.z || 1e-6, 150) === Infinity ? 1 : 0;
    const skyTarget = this.map.sky.visibilityAt(p);
    const k = 1 - Math.exp(-dt * 6);
    this.sunVis += (sunTarget - this.sunVis) * k;
    this.skyVis += (skyTarget - this.skyVis) * k;
    this.viewmodel.setOcclusion(this.skyVis, this.sunVis);
    if ((this.skyPatchIn -= dt) <= 0) {
      this.skyPatchIn = 1;
      this.map.sky.patchScene(this.scene);
    }
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.lastRafAt = performance.now();
    this.frame(now, true);
  };

  /**
   * [coop] Hidden tab / occluded window in an online match: rAF stops, so a
   * worker timer keeps the simulation + net sync running (no rendering) —
   * the host's world doesn't freeze for everyone and clients don't time
   * out. It idles while rAF is delivering frames.
   */
  private lastRafAt = 0;
  private readonly bgTicker = new BackgroundTicker(() => {
    if (this.disposed) return;
    const now = performance.now();
    if (!document.hidden && now - this.lastRafAt < 250) return;
    this.frame(now, false);
  });
  private onVisibility = () => {
    if (this.opts.survival?.net !== undefined && !this.disposed) this.bgTicker.start();
    else this.bgTicker.stop();
  };

  private frame(now: number, visible: boolean) {
    // (rAF timestamps are vsync-aligned and may trail performance.now(): never go negative.)
    const dt = Math.min(Math.max(0, now - this.lastTime) / 1000, 0.1);
    this.lastTime = Math.max(this.lastTime, now);
    const t0 = performance.now();

    const input = this.input;
    input.poll(dt);
    input.watchdog();
    const playing = input.locked;
    let alpha = 1;

    if (playing) {
      this.sessionTime += dt;
      this.handleHotkeys();

      // Mouse look every frame (lowest latency), scaled down while aiming.
      input.consumeMouseDelta(this.mouse);
      const ads = this.weapons.adsAmount;
      const s = this.settings;
      const sens = LOOK.baseSensitivity * s.sensitivity * THREE.MathUtils.lerp(1, LOOK.adsSensitivityMultiplier * s.adsSensitivity, ads);
      this.player.look(this.mouse.x, (s.invertY ? -this.mouse.y : this.mouse.y) * s.verticalRatio, sens);
      this.padLook(dt, ads);

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

    // [coop] An online match never pauses: the host keeps simulating and clients keep syncing behind menus.
    const live = playing || this.opts.survival?.net !== undefined;
    this.mode.update(live ? dt : 0, playing);

    this.updateFov(dt);
    this.handleMoveEvents();
    this.updateViewmodel(dt);
    this.effects.update(live ? dt : 0);

    this.camera.getWorldDirection(this.forward);
    this.sfx.setListener(this.camera.position, this.forward);

    this.updateHud(dt, playing);
    input.endFrame();

    if (!visible) return;
    this.updateLightOcclusion(dt);
    this.pipeline.render(dt);
    // Dynamic resolution changed the drawing buffer: keep pixel-sized effects in step.
    if (this.pipeline.resolutionVersion !== this.resolutionVersion) {
      this.resolutionVersion = this.pipeline.resolutionVersion;
      this.effects.setViewportHeight(this.viewH * this.pipeline.pixelRatio);
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private handleHotkeys() {
    const input = this.input;
    if (input.pressed("F3") || input.pressed("Backquote")) this.hud.toggleDebug();
  }

  private buildIntent() {
    const input = this.input;
    const it = this.intent;
    const clamp = THREE.MathUtils.clamp;
    it.forward = clamp((input.isDown("KeyW") ? 1 : 0) - (input.isDown("KeyS") ? 1 : 0) + input.moveY, -1, 1);
    it.strafe = clamp((input.isDown("KeyD") ? 1 : 0) - (input.isDown("KeyA") ? 1 : 0) + input.moveX, -1, 1);
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
    // Aiming or firing always breaks sprint (wantsAds() is false mid-sprint, so test the button).
    it.blockSprint = input.isDown("Mouse0") || input.isDown("Mouse2") || this.grenades.throwProgress >= 0;
  }

  /** Right-stick look (curve/accel in Input) with gamepad-only aim assist. */
  private padLook(dt: number, ads: number) {
    const input = this.input;
    const s = this.settings;
    let slow = 1;
    if (s.aimAssist && input.device !== "kbm") {
      const list = this.assistList;
      list.length = 0;
      this.mode.collectTargets(list);
      slow = this.aimAssist.update(dt, list, this.camera.position, this.player, ads, this.map.collision);
    }
    if (input.lookX === 0 && input.lookY === 0) return;
    const P = LOOK.pad;
    const rate = s.padSensitivity * THREE.MathUtils.lerp(1, P.adsMultiplier * s.padAdsSensitivity, ads) * slow * dt;
    this.player.look(input.lookX * P.yawSpeed * rate, (s.padInvertY ? -1 : 1) * input.lookY * P.pitchSpeed * rate, 1);
  }

  /** Push device / layout / bindings to the HUD glyphs. */
  private syncGlyphs() {
    glyphContext.device = this.input.device;
    glyphContext.layout = this.input.padLayout;
    glyphContext.bindings = this.settings.bindings;
    glyphContext.version++;
  }

  private updateFov(dt: number) {
    const def = this.weapons.active.def;
    const a = this.weapons.adsAmount;
    const ease = a * a * (3 - 2 * a);
    const base = this.settings.fov + this.player.fovOffset;
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
    this.input.rumble(Math.min(1, def.shake * 1.8), Math.min(1, def.shake * 3), def.pellets > 1 ? 110 : 60);
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
    const near = Math.max(0, 1 - dist / 36);
    this.shake.add(0.6 * near);
    if (near > 0) this.input.rumble(near, near * 0.8, 200 + near * 250);
    this.mode.onExplosion(at);
  }

  private updateHud(dt: number, playing: boolean) {
    const w = this.weapons.active;
    const ads = this.weapons.adsAmount;
    const v = this.mode.vitals();
    const f = this.hudFrame;
    f.spreadDeg = this.weapons.spread;
    f.fovDeg = this.camera.fov;
    f.viewportH = this.viewH;
    f.crosshairHide = Math.max(ads, this.player.sprintBlend, this.weapons.lowered, this.weapons.meleeProgress >= 0 || this.grenades.throwProgress >= 0 ? 1 : 0);
    f.ammo = w.ammo;
    f.reserve = this.weapons.unlimited(w) ? -1 : w.reserve;
    f.magSize = w.def.magSize;
    f.weaponName = w.def.name;
    f.weaponKind = w.def.kind;
    f.slot = this.weapons.current;
    f.slots = this.weapons.slots;
    f.reload = this.weapons.reloadProgress;
    f.health = v.health;
    f.maxHealth = v.maxHealth;
    f.armor = v.armor;
    f.grenades = this.grenades.count >= 50 ? -1 : this.grenades.count;
    f.scope = w.def.scope ? ads : 0;
    f.yaw = this.player.yaw;
    this.hud.frame(f, dt);
    this.hud.setScoreboard(playing && this.input.isDown("Tab"), this.callsign, this.weapons.stats, this.sessionTime, this.map.def.name);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.hud.setFps(this.fps);
      if (playing) this.governQuality(this.fps, this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (this.hud.debugVisible) {
      const p = this.player;
      const d = this.debugInfo;
      const pl = this.pipeline;
      const info = pl.info;
      const r = info.render;
      const gpu = pl.gpuMs;
      d.fps = `${this.fps}  (${this.frameMs.toFixed(2)} ms cpu${gpu > 0 ? `, ${gpu.toFixed(2)} ms gpu` : ""})`;
      d.quality = this.settings.quality;
      d["draw calls"] = `${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k  pts ${r.points}  lines ${r.lines}`;
      const buf = pl.renderer.getDrawingBufferSize(this.bufSize);
      d.resolution = `${buf.x}x${buf.y}  scale ${(pl.resolutionScale * 100).toFixed(0)}%  dpr ${pl.pixelRatio.toFixed(2)}`;
      d["gpu memory"] = `geo ${info.memory.geometries}  tex ${info.memory.textures}  programs ${info.programs?.length ?? 0}`;
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
    this.viewW = w;
    this.viewH = h;
    this.pipeline.setSize(w, h);
    this.hud.setVignette(!this.pipeline.postVignette);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(w / h);
    this.effects.setViewportHeight(h * this.pipeline.renderer.getPixelRatio());
  }

  private onLockError = () => (this.opts.onLockError ? this.opts.onLockError() : this.opts.onLockChange?.(false));
  /** Guards against Ctrl+W (crouch + forward) closing the tab mid-fight. */
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.input.locked) e.preventDefault();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.bgTicker.dispose();
    if (document.pointerLockElement === this.pipeline.canvas) document.exitPointerLock();
    document.removeEventListener("pointerlockerror", this.onLockError);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.resizeObserver.disconnect();
    this.mobile.dispose();
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
