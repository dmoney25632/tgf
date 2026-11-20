import type { WeaponDef } from "../weapons/weapons";
import type { ReloadStage } from "../weapons/WeaponSystem";
import type { Surface } from "../effects/EffectsPool";

type V3 = { x: number; y: number; z: number };

/**
 * Procedural sound kit on the Web Audio API — no files to download.
 * Layers short filtered noise + oscillators into gunshots, hits, reloads,
 * footsteps and spatial impacts, with a shared reverb send for "space".
 * Must be resumed from a user gesture (the deploy click does it).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** Weapons, world, movement (dry + reverb). */
  private effects!: GainNode;
  /** Hit markers, cash, wave stingers, heartbeat. */
  private ui!: GainNode;
  private dry!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private lastImpact = 0;
  private lastShell = 0;
  private lastEnemyShot = 0;
  private enemyShotsThisWindow = 0;
  private lastWhizz = 0;
  volume = 0.8;
  effectsVolume = 1;
  uiVolume = 0.85;
  private hidden = false;

  resume() {
    if (!this.ctx) this.init();
    void this.ctx?.resume();
  }

  private init() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());

    // effects/ui buses → master → glue compressor → brick-wall limiter → out.
    // The compressor keeps full-auto punchy without pumping; the limiter
    // catches stacked explosions so nothing ever clips or crackles.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    comp.connect(limiter).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.effects = ctx.createGain();
    this.effects.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);
    this.applyGains();
    this.dry = ctx.createGain();
    this.dry.connect(this.effects);

    // Silence (and stop burning CPU) while the tab is in the background.
    document.addEventListener("visibilitychange", this.onVisibility);

    // Reverb: generated impulse response (outdoor yard slap + tail).
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(1.6, 2.8);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(conv).connect(this.effects);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyGains();
  }

  /** Per-bus levels (0..1): weapons/world and interface feedback. */
  setMix(effects: number, ui: number) {
    this.effectsVolume = effects;
    this.uiVolume = ui;
    this.applyGains();
  }

  private applyGains() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Short ramps so slider drags don't zipper.
    this.master.gain.setTargetAtTime(this.volume * this.volume * 0.75, t, 0.02);
    this.effects.gain.setTargetAtTime(this.effectsVolume, t, 0.02);
    this.ui.gain.setTargetAtTime(this.uiVolume, t, 0.02);
  }

  private onVisibility = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    this.hidden = document.hidden;
    if (this.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  };

  /** Keep the listener on the camera for spatial impacts. */
  setListener(pos: V3, fwd: V3) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------------------

  gunshot(def: WeaponDef) {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = def.sound;
    const t = ctx.currentTime;
    const v = p.volume * (0.92 + Math.random() * 0.16);
    const out = ctx.createGain();
    out.gain.value = v;
    out.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.9 * p.tail;
    out.connect(send).connect(this.reverbSend);

    // 1. Transient crack: very short bright noise.
    this.noiseBurst(out, t, { type: "highpass", freq: 2500 }, 0.9 * p.crack, 0.0015, 0.03);
    // 2. Body: lowpassed noise with a falling filter.
    const body = this.noiseBurst(out, t, { type: "lowpass", freq: 4200, to: 350, over: 0.16 }, 1.0 * p.body, 0.002, 0.16 + 0.06 * p.body);
    body.playbackRate.value = (0.85 + Math.random() * 0.25) * p.pitch;
    // 3. Thump: pitched-down sine.
    this.tone(out, t, "sine", 150 * p.pitch, 42 * p.pitch, 0.12, 0.9 * p.thump, 0.001, 0.16);
    // 4. Mechanical clack (action cycling).
    this.noiseBurst(out, t + 0.012, { type: "bandpass", freq: 3200 * p.pitch, q: 4 }, 0.25, 0.001, 0.035);
    // 5. Pump / bolt cycle for manual actions.
    if (def.cycleAction) this.pump(t + 0.2);
  }

  /** Shotgun pump: rack back + forward. */
  pump(at?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = at ?? ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 1500, q: 2 }, 0.45, 0.002, 0.06);
    this.noiseBurst(this.dry, t + 0.13, { type: "bandpass", freq: 2400, q: 3 }, 0.55, 0.001, 0.05);
    this.tone(this.dry, t + 0.13, "triangle", 420, 260, 0.04, 0.2, 0.0005, 0.06);
  }

  /** Distant/enemy gunfire, positional. Capped so a firefight doesn't saturate the mix. */
  enemyShot(at: V3, heavy: number, distance: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastEnemyShot > 0.05) this.enemyShotsThisWindow = 0;
    if (this.enemyShotsThisWindow >= 3) return;
    this.enemyShotsThisWindow++;
    this.lastEnemyShot = now;
    const panner = this.panner(at, 6, 1.0);
    const far = Math.min(1, distance / 60);
    const v = 0.55 * heavy;
    this.noiseBurst(panner, now, { type: "highpass", freq: 2200 }, 0.5 * v * (1 - far * 0.7), 0.0015, 0.025);
    this.noiseBurst(panner, now, { type: "lowpass", freq: 3200 - far * 2200, to: 300, over: 0.18 }, v, 0.002, 0.2);
    this.tone(panner, now, "sine", 130 / heavy, 40, 0.12, 0.6 * v, 0.001, 0.16);
  }

  /** Near-miss bullet crack flying past the listener. */
  whizz(at: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastWhizz < 0.07) return;
    this.lastWhizz = now;
    const p = this.panner(at, 1.5, 1.5);
    this.noiseBurst(p, now, { type: "bandpass", freq: 3500, to: 1200, over: 0.12, q: 2 }, 0.5, 0.004, 0.12);
    this.tone(p, now, "sine", 2400, 900, 0.1, 0.06, 0.002, 0.1);
  }

  /** Player got hit. */
  hurt(heavy: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "lowpass", freq: 700 }, heavy ? 0.7 : 0.45, 0.002, 0.12);
    this.tone(this.dry, t, "sine", 110, 55, 0.12, heavy ? 0.6 : 0.35, 0.002, 0.15);
  }

  explosion(at: V3, distance: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = this.panner(at, 10, 0.9);
    const close = 1 - Math.min(1, distance / 50);
    this.noiseBurst(p, now, { type: "lowpass", freq: 2200 + close * 3000, to: 120, over: 1.2 }, 1.6, 0.003, 1.3);
    this.tone(p, now, "sine", 80, 28, 0.6, 1.3, 0.002, 0.8);
    this.noiseBurst(p, now + 0.02, { type: "highpass", freq: 1800 }, 0.6 * close, 0.001, 0.06);
    // Debris patter.
    for (let i = 0; i < 4; i++) this.noiseBurst(p, now + 0.25 + Math.random() * 0.5, { type: "bandpass", freq: 1500 + Math.random() * 1500, q: 2 }, 0.12, 0.001, 0.04);
  }

  grenadeBounce(at: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(this.panner(at, 3, 1.2), ctx.currentTime, "triangle", 900, 700, 0.03, 0.2, 0.0005, 0.06);
  }

  grenadeThrow() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 4000, q: 6 }, 0.3, 0.0005, 0.02); // pin
    this.noiseBurst(this.dry, t + 0.25, { type: "bandpass", freq: 900, to: 400, over: 0.2, q: 0.8 }, 0.3, 0.02, 0.2); // whoosh
  }

  /** Knife swing; `hit` adds a meaty impact. */
  knife(hit: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 2500, to: 800, over: 0.15, q: 1.2 }, 0.35, 0.01, 0.15);
    if (hit) {
      this.noiseBurst(this.dry, t + 0.02, { type: "lowpass", freq: 900 }, 0.8, 0.001, 0.09);
      this.tone(this.dry, t + 0.02, "sine", 140, 60, 0.08, 0.5, 0.001, 0.1);
    }
  }

  // ---------------------------------------------------------------------------
  // Survival UI stingers
  // ---------------------------------------------------------------------------

  cash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(this.ui, t, "sine", 1320, 1320, 0.01, 0.12, 0.002, 0.09);
    this.tone(this.ui, t + 0.06, "sine", 1760, 1760, 0.01, 0.12, 0.002, 0.14);
  }

  denied() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(this.ui, ctx.currentTime, "square", 220, 180, 0.15, 0.12, 0.002, 0.18);
  }

  waveStart() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    // Low brass-ish swell: stacked saws through a closing lowpass.
    for (const f of [55, 82.5, 110]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(200, t);
      filt.frequency.linearRampToValueAtTime(1200, t + 0.5);
      filt.frequency.exponentialRampToValueAtTime(150, t + 2.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      osc.connect(filt).connect(g).connect(this.ui);
      osc.start(t);
      osc.stop(t + 2.5);
    }
    this.tone(this.ui, t, "sine", 60, 40, 1.5, 0.5, 0.01, 1.4);
  }

  waveClear() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(this.ui, t + i * 0.09, "triangle", f, f, 0.01, 0.16, 0.004, 0.5));
  }

  downed() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(this.ui, t, "sine", 220, 70, 1.2, 0.5, 0.01, 1.4);
    this.noiseBurst(this.ui, t, { type: "lowpass", freq: 300 }, 0.6, 0.01, 0.8);
  }

  heartbeat() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(this.ui, t, "sine", 60, 45, 0.08, 0.45, 0.005, 0.12);
    this.tone(this.ui, t + 0.18, "sine", 55, 40, 0.08, 0.3, 0.005, 0.12);
  }

  dryFire() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 4200, q: 6 }, 0.5, 0.0005, 0.02);
    this.tone(this.dry, t, "square", 1900, 1600, 0.015, 0.06, 0.0005, 0.02);
  }

  reload(stage: ReloadStage) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (stage) {
      case "start": // cloth / grip shift
        this.noiseBurst(this.dry, t, { type: "bandpass", freq: 900, q: 0.8 }, 0.18, 0.02, 0.12);
        break;
      case "magOut": // release click + slide out
        this.noiseBurst(this.dry, t, { type: "bandpass", freq: 3500, q: 5 }, 0.45, 0.0005, 0.025);
        this.noiseBurst(this.dry, t + 0.03, { type: "bandpass", freq: 1400, q: 1.2 }, 0.22, 0.01, 0.1);
        break;
      case "magIn": // insert scrape + seat clack
        this.noiseBurst(this.dry, t, { type: "bandpass", freq: 1800, q: 1.5 }, 0.2, 0.01, 0.07);
        this.noiseBurst(this.dry, t + 0.07, { type: "bandpass", freq: 2600, q: 3 }, 0.6, 0.0005, 0.04);
        this.tone(this.dry, t + 0.07, "triangle", 520, 300, 0.04, 0.25, 0.0005, 0.05);
        break;
      case "bolt": // charging handle back and forward
        this.noiseBurst(this.dry, t, { type: "bandpass", freq: 3000, q: 3 }, 0.45, 0.0005, 0.035);
        this.noiseBurst(this.dry, t + 0.09, { type: "bandpass", freq: 2200, q: 2.5 }, 0.65, 0.0005, 0.05);
        this.tone(this.dry, t + 0.09, "triangle", 700, 380, 0.05, 0.25, 0.0005, 0.06);
        break;
      case "shell": // shell push into the tube
        this.noiseBurst(this.dry, t, { type: "bandpass", freq: 1200, q: 2 }, 0.3, 0.002, 0.05);
        this.noiseBurst(this.dry, t + 0.05, { type: "bandpass", freq: 2600, q: 4 }, 0.4, 0.0005, 0.03);
        break;
      case "done":
        break;
    }
  }

  swap() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 1100, q: 0.7 }, 0.2, 0.02, 0.12);
    this.noiseBurst(this.dry, t + 0.1, { type: "bandpass", freq: 2800, q: 4 }, 0.3, 0.0005, 0.03);
  }

  adsIn() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(this.dry, ctx.currentTime, { type: "bandpass", freq: 700, q: 0.7 }, 0.1, 0.02, 0.09);
  }

  // ---------------------------------------------------------------------------
  // Hit confirmation
  // ---------------------------------------------------------------------------

  hit(kind: "body" | "head" | "kill" | "headkill") {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === "body") {
      this.tone(this.ui, t, "square", 1350, 1250, 0.03, 0.12, 0.0005, 0.035);
      this.noiseBurst(this.ui, t, { type: "bandpass", freq: 5000, q: 3 }, 0.18, 0.0005, 0.02);
    } else if (kind === "head") {
      // Bright metallic "tink".
      this.tone(this.ui, t, "sine", 2400, 2380, 0.18, 0.22, 0.0005, 0.2);
      this.tone(this.ui, t, "sine", 3620, 3600, 0.12, 0.12, 0.0005, 0.14);
      this.noiseBurst(this.ui, t, { type: "highpass", freq: 6000 }, 0.2, 0.0005, 0.015);
    } else {
      // Kill: low confirm thunk + tick (+ tink for headshot kills).
      this.tone(this.ui, t, "sine", 180, 70, 0.12, 0.5, 0.001, 0.14);
      this.tone(this.ui, t, "square", 1100, 900, 0.05, 0.12, 0.0005, 0.06);
      if (kind === "headkill") {
        this.tone(this.ui, t + 0.01, "sine", 2600, 2580, 0.25, 0.22, 0.0005, 0.28);
        this.tone(this.ui, t + 0.01, "sine", 3900, 3880, 0.18, 0.1, 0.0005, 0.2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------

  /** Positional bullet impact. Rate-limited so full-auto doesn't stack up. */
  impact(at: V3, surface: Surface) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastImpact < 0.03) return;
    this.lastImpact = now;
    const panner = this.panner(at);
    switch (surface) {
      case "steel":
        this.tone(panner, now, "sine", 1180, 1170, 0.5, 0.5, 0.0005, 0.6);
        this.tone(panner, now, "sine", 2830, 2810, 0.3, 0.25, 0.0005, 0.35);
        this.noiseBurst(panner, now, { type: "highpass", freq: 3000 }, 0.4, 0.0005, 0.03);
        break;
      case "metal":
        this.tone(panner, now, "triangle", 620, 560, 0.18, 0.3, 0.0005, 0.2);
        this.noiseBurst(panner, now, { type: "bandpass", freq: 2500, q: 2 }, 0.5, 0.0005, 0.06);
        break;
      case "wood":
        this.noiseBurst(panner, now, { type: "bandpass", freq: 700, q: 1.5 }, 0.8, 0.0005, 0.07);
        break;
      case "target":
        this.noiseBurst(panner, now, { type: "lowpass", freq: 900 }, 0.6, 0.0005, 0.06);
        break;
      default:
        this.noiseBurst(panner, now, { type: "bandpass", freq: surface === "sand" ? 500 : 1300, q: 1 }, 0.7, 0.0005, 0.06);
    }
  }

  /** Ejected brass / hull hitting the floor: short metallic tinkle (rate-limited). */
  shellDrop(at: V3, kind: "rifle" | "pistol" | "shotgun" | "magnum" | "heavy", speed: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastShell < 0.045) return;
    this.lastShell = now;
    const v = Math.min(1, speed / 4) * 0.16;
    const panner = this.panner(at, 1.5, 1.6);
    if (kind === "shotgun") {
      this.noiseBurst(panner, now, { type: "bandpass", freq: 900, q: 2 }, v * 1.4, 0.0005, 0.04);
      this.tone(panner, now, "triangle", 420, 400, 0.05, v * 0.6, 0.0005, 0.05);
      return;
    }
    const f = (kind === "pistol" ? 5200 : kind === "magnum" ? 3600 : 4300) * (0.92 + Math.random() * 0.16);
    this.tone(panner, now, "sine", f, f * 0.995, 0.12, v, 0.0005, 0.09 + Math.random() * 0.05);
    this.tone(panner, now, "sine", f * 1.52, f * 1.51, 0.08, v * 0.5, 0.0005, 0.06);
    this.noiseBurst(panner, now, { type: "highpass", freq: 5000 }, v * 0.6, 0.0003, 0.012);
  }

  footstep(speed: number, crouched: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.min(1, speed / 8) * (crouched ? 0.35 : 1);
    this.noiseBurst(this.dry, t, { type: "lowpass", freq: 600 + Math.random() * 300 }, 0.35 * v, 0.004, 0.07);
    this.noiseBurst(this.dry, t + 0.01, { type: "bandpass", freq: 2200, q: 1.5 }, 0.06 * v, 0.003, 0.05); // grit
  }

  jump() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(this.dry, ctx.currentTime, { type: "bandpass", freq: 800, q: 0.8 }, 0.15, 0.01, 0.1);
  }

  land(fallSpeed: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = Math.min(1, fallSpeed / 12);
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "lowpass", freq: 400 }, 0.5 * v + 0.1, 0.003, 0.12);
    this.tone(this.dry, t, "sine", 90, 50, 0.1, 0.4 * v, 0.002, 0.12);
  }

  slide() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.dry, t, { type: "bandpass", freq: 1600, to: 500, over: 0.6, q: 0.8 }, 0.3, 0.02, 0.6);
  }

  // ---------------------------------------------------------------------------
  // Building blocks
  // ---------------------------------------------------------------------------

  private panner(at: V3, ref = 4, rolloff = 1.2) {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(this.dry);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    p.connect(send).connect(this.reverbSend);
    return p;
  }

  private noiseBurst(
    dest: AudioNode,
    t: number,
    f: { type: BiquadFilterType; freq: number; q?: number; to?: number; over?: number },
    vol: number,
    attack: number,
    decay: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = f.type;
    filter.frequency.setValueAtTime(f.freq, t);
    if (f.to) filter.frequency.exponentialRampToValueAtTime(f.to, t + (f.over ?? decay));
    if (f.q) filter.Q.value = f.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(g).connect(dest);
    // Random offset so consecutive shots don't sound identical.
    src.start(t, Math.random() * 0.5, attack + decay + 0.05);
    return src;
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, from: number, to: number, glide: number, vol: number, attack: number, decay: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + glide);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Early slap at ~60ms then diffuse tail.
        const slap = i > ctx.sampleRate * 0.06 && i < ctx.sampleRate * 0.075 ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, decay) + slap);
      }
    }
    return buf;
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
  }
}
