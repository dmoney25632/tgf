import { WEAPONS, type WeaponDef } from "../weapons/weapons";
import type { ReloadStage } from "../weapons/WeaponSystem";
import type { Surface } from "../effects/EffectsPool";
import { VoiceAllocator, arrivalDelay, dbToGain, distanceCutoff, distanceGain, softClipCurve, type VoiceRule } from "./voices";

type V3 = { x: number; y: number; z: number };

/**
 * Small scheduling lookahead (s). Events placed exactly at `currentTime` are
 * already in the past for the render thread, so their attack ramps get
 * skipped and the sound starts at full level mid-envelope: a click. 5 ms is
 * under one display frame and lets every envelope play as written.
 */
const LOOK = 0.005;

/**
 * Makeup gain the DynamicsCompressorNode adds on its own (spec: (1/g)^0.6),
 * measured in Chromium for the exact settings below. Trimmed straight back
 * out so quiet sounds pass at unity and only loud peaks are compressed.
 */
const GLUE = { threshold: -14, knee: 10, ratio: 2.5, attack: 0.006, release: 0.22, makeupDb: 3.27 };
const LIMIT = { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.25, makeupDb: 1.71 };

/**
 * Overall level into the glue compressor. Measured in Chromium at volume 0.8:
 * a single rifle shot peaks near -7 dBFS, full-auto plus 8 enemies, grenades
 * and hit spam near -4 dBFS with ~3 dB of glue compression, so the limiter
 * only touches point-blank explosions.
 */
const MASTER_TRIM = 1.4;

/** Bank renders are peak-normalised; live fallback synthesis lands near this. */
const LIVE_NORM = 0.45;
/** Foley/world one-shots relative to gunfire. */
const FOLEY = 0.75;

const RULES: Record<string, VoiceRule> = {
  gun: { max: 4, minInterval: 0.02, priority: 3, steal: "oldest" },
  pump: { max: 2, minInterval: 0.05, priority: 2, steal: "oldest" },
  enemy: { max: 6, minInterval: 0.03, priority: 1.2, steal: "quietest" },
  whizz: { max: 2, minInterval: 0.07, priority: 1.5, steal: "oldest" },
  explosion: { max: 3, minInterval: 0.05, priority: 4, steal: "quietest" },
  impact: { max: 5, minInterval: 0.03, priority: 0.8, steal: "oldest" },
  shell: { max: 4, minInterval: 0.045, priority: 0.3, steal: "oldest" },
  hit: { max: 2, minInterval: 0.045, priority: 3, steal: "oldest" },
  kill: { max: 2, minInterval: 0.06, priority: 3.5, steal: "oldest" },
  hurt: { max: 2, minInterval: 0.09, priority: 2.5, steal: "oldest" },
  foley: { max: 6, minInterval: 0.015, priority: 1.5, steal: "oldest" },
  step: { max: 3, minInterval: 0.07, priority: 0.6, steal: "oldest" },
  move: { max: 3, minInterval: 0.05, priority: 0.8, steal: "oldest" },
  bounce: { max: 3, minInterval: 0.04, priority: 0.8, steal: "oldest" },
  ui: { max: 6, minInterval: 0.03, priority: 3, steal: "oldest" },
  sting: { max: 2, minInterval: 0.25, priority: 3, steal: "oldest" },
};
const GLOBAL_VOICES = 40;

type NoiseFilter = { type: BiquadFilterType; freq: number; q?: number; to?: number; over?: number };

type Voice = {
  id: number;
  out: GainNode | null;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  pending: number;
  dead: boolean;
};

type Route =
  | { bus: "dry" | "ui"; send?: number }
  | { pos: V3; dist: number; ref: number; rolloff: number; send: number };

/**
 * Builds short envelopes of filtered noise / oscillators into `dest`, on any
 * BaseAudioContext (live or offline). Every envelope starts and ends at
 * exactly 0 gain with ramps, and every source is stopped after its envelope.
 */
class Layers {
  readonly ctx: BaseAudioContext;
  readonly dest: AudioNode;
  private readonly noiseBuf: AudioBuffer;
  /** Called for every node created (sources flagged) so live voices can clean up. */
  private readonly onNode: ((node: AudioNode, source: AudioScheduledSourceNode | null) => void) | null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, noiseBuf: AudioBuffer, onNode: Layers["onNode"] = null) {
    this.ctx = ctx;
    this.dest = dest;
    this.noiseBuf = noiseBuf;
    this.onNode = onNode;
  }

  private add(source: AudioScheduledSourceNode, ...rest: AudioNode[]) {
    if (!this.onNode) return;
    this.onNode(source, source);
    for (const n of rest) this.onNode(n, null);
  }

  rand() {
    return Math.random();
  }

  private env(g: AudioParam, t: number, vol: number, attack: number, decay: number) {
    const peak = Math.max(vol, 0.0002);
    const end = t + attack + decay;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(peak * 0.001, end);
    g.linearRampToValueAtTime(0, end + 0.01);
    return end + 0.02;
  }

  noise(t: number, f: NoiseFilter, vol: number, attack: number, decay: number, rate = 1) {
    const ctx = this.ctx;
    attack = Math.max(attack, 0.0008);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    const nyq = ctx.sampleRate * 0.45;
    filter.type = f.type;
    filter.frequency.setValueAtTime(Math.min(f.freq, nyq), t);
    if (f.to) filter.frequency.exponentialRampToValueAtTime(Math.min(f.to, nyq), t + (f.over ?? decay));
    if (f.q) filter.Q.value = f.q;
    const g = ctx.createGain();
    g.gain.value = 0;
    const stop = this.env(g.gain, t, vol, attack, decay);
    src.connect(filter).connect(g).connect(this.dest);
    src.start(t, this.rand() * this.noiseBuf.duration);
    src.stop(stop);
    this.add(src, filter, g);
    return stop;
  }

  tone(t: number, type: OscillatorType, from: number, to: number, glide: number, vol: number, attack: number, decay: number) {
    const ctx = this.ctx;
    attack = Math.max(attack, 0.0015);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + glide);
    const g = ctx.createGain();
    g.gain.value = 0;
    const stop = this.env(g.gain, t, vol, attack, decay);
    osc.connect(g).connect(this.dest);
    osc.start(t);
    osc.stop(stop);
    this.add(osc, g);
    return stop;
  }

  /** Sustained filtered oscillator swell (wave stinger). */
  swell(t: number, type: OscillatorType, freq: number, cut: [number, number, number], peak: number, rise: number, total: number) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(cut[0], t);
    filt.frequency.linearRampToValueAtTime(cut[1], t + rise);
    filt.frequency.exponentialRampToValueAtTime(cut[2], t + total);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rise);
    g.gain.exponentialRampToValueAtTime(peak * 0.001, t + total);
    g.gain.linearRampToValueAtTime(0, t + total + 0.02);
    osc.connect(filt).connect(g).connect(this.dest);
    osc.start(t);
    osc.stop(t + total + 0.04);
    this.add(osc, filt, g);
    return t + total + 0.04;
  }

  /** One-shot of a pre-rendered buffer. */
  buffer(t: number, buf: AudioBuffer, rate: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(this.dest);
    src.start(t);
    this.add(src);
    return t + buf.duration / rate;
  }
}

// ---------------------------------------------------------------------------
// Synthesis recipes (run live, or offline into the sample banks)
// ---------------------------------------------------------------------------

/**
 * Gunshot = transient crack + falling-filter blast body + sub thump +
 * mechanical action + outdoor tail, shaped per weapon class.
 */
function synthGunshot(L: Layers, t: number, def: WeaponDef) {
  const p = def.sound;
  const k = def.kind;
  const sniper = k === "Sniper Rifle" || k === "Marksman";
  const shotgun = k === "Shotgun";
  const smg = k === "SMG";
  const pistol = k === "Sidearm";
  const cannon = k === "Hand Cannon";
  const heavy = shotgun || cannon || k === "LMG";
  const short = smg ? 0.72 : pistol ? 0.8 : 1;
  const pitch = p.pitch * (0.97 + L.rand() * 0.06);

  // 1. Transient: muzzle-blast crack. Sub-millisecond ramp: snaps, no click.
  L.noise(t, { type: "highpass", freq: 1800 * pitch }, 0.75 * p.crack, 0.0008, 0.022 * short);
  L.noise(t, { type: "bandpass", freq: 3600 * pitch, q: 0.9 }, 0.4 * p.crack, 0.0008, 0.012);
  if (sniper) {
    // Supersonic round: a hard, very short N-wave snap ahead of the blast,
    // then a whip-crack sweep. This is what makes the sniper read at once.
    L.noise(t, { type: "highpass", freq: 3200 }, 1.2, 0.0006, 0.007);
    L.tone(t, "triangle", 2100, 520, 0.018, 0.32, 0.0008, 0.022);
    L.noise(t + 0.004, { type: "bandpass", freq: 2400, q: 1.4 }, 0.6, 0.0008, 0.02);
  }

  // 2. Body: the blast, lowpassed noise whose cutoff collapses = punch.
  L.noise(
    t,
    { type: "lowpass", freq: 5200 * pitch, to: 240, over: (shotgun ? 0.16 : 0.1) * short, q: 0.9 },
    p.body,
    0.0015,
    (0.1 + 0.07 * p.body) * short,
    pitch,
  );

  // 3. Sub thump: pitch-dropping sine you feel more than hear.
  L.tone(t, "sine", 155 * pitch, 44 * pitch, 0.08, 0.8 * p.thump, 0.0025, 0.13 * short + (heavy ? 0.05 : 0));
  if (heavy) L.tone(t + 0.002, "triangle", 92 * pitch, 36, 0.1, 0.3 * p.thump, 0.003, 0.15);

  // 4. Action: bolt carrier / slide clack right behind the blast.
  if (!shotgun && !sniper) {
    L.noise(t + 0.012, { type: "bandpass", freq: 3000 * pitch, q: 3.5 }, 0.16, 0.0008, 0.028);
    L.tone(t + 0.012, "triangle", 1250 * pitch, 900 * pitch, 0.02, 0.05, 0.0015, 0.025);
  }

  // 5. Tail: low outdoor rumble, plus a terrain slap for the big calibres.
  L.noise(t + 0.008, { type: "lowpass", freq: 1400, to: 220, over: 0.45, q: 0.7 }, 0.16 * p.tail, 0.02, (0.28 + 0.24 * p.tail) * short);
  if (sniper || cannon || shotgun) {
    L.noise(t + 0.11 + L.rand() * 0.04, { type: "bandpass", freq: 900, to: 380, over: 0.4, q: 0.6 }, 0.12 * p.tail, 0.012, 0.42);
  }
  if (sniper) L.noise(t + 0.28 + L.rand() * 0.08, { type: "lowpass", freq: 700, to: 180, over: 0.6 }, 0.08 * p.tail, 0.04, 0.6);
}

/** Generic enemy rifle report (distance filtering is applied at playback). */
function synthEnemyShot(L: Layers, t: number) {
  L.noise(t, { type: "highpass", freq: 2000 }, 0.42, 0.0008, 0.02);
  L.noise(t, { type: "lowpass", freq: 3800, to: 280, over: 0.15, q: 0.8 }, 1, 0.0015, 0.17, 0.9 + L.rand() * 0.2);
  L.tone(t, "sine", 135, 42, 0.1, 0.6, 0.0025, 0.15);
  L.noise(t + 0.015, { type: "lowpass", freq: 1100, to: 200, over: 0.4, q: 0.7 }, 0.16, 0.02, 0.36);
}

function synthExplosion(L: Layers, t: number) {
  L.noise(t, { type: "highpass", freq: 1500 }, 0.5, 0.0008, 0.05);
  L.noise(t, { type: "lowpass", freq: 5000, to: 110, over: 1.0, q: 0.7 }, 1, 0.004, 1.15);
  L.tone(t, "sine", 78, 26, 0.55, 0.9, 0.004, 0.9);
  L.tone(t, "triangle", 52, 24, 0.6, 0.35, 0.006, 0.8);
  L.noise(t + 0.05, { type: "lowpass", freq: 600, to: 90, over: 1.4 }, 0.32, 0.08, 1.4);
  for (let i = 0; i < 6; i++) {
    L.noise(t + 0.25 + L.rand() * 0.75, { type: "bandpass", freq: 1200 + L.rand() * 2000, q: 2 }, 0.06 + L.rand() * 0.06, 0.001, 0.04);
  }
}

/**
 * Procedural sound kit on the Web Audio API — no files to download.
 *
 * Signal flow: voices → effects/ui buses → master (volume) → glue compressor
 * → limiter → soft clipper → visibility gate → speakers. Effects voices also
 * send into one shared reverb (filtered, pre-delayed convolution).
 *
 * Crackle-proofing: every envelope ramps from and back to 0; sounds are
 * scheduled a hair ahead of `currentTime`; a voice allocator caps and steals
 * per category and globally (stolen voices fade over 25 ms, never cut);
 * finished voices disconnect their nodes; gunshots/explosions/enemy fire are
 * pre-rendered into small sample banks so full-auto is one buffer source per
 * shot instead of a dozen nodes; gain staging leaves headroom so the limiter
 * only catches rare stacked peaks.
 *
 * Must be resumed from a user gesture (the deploy click does it).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private disposed = false;
  private master!: GainNode;
  private gate!: GainNode;
  /** Weapons, world, movement (dry + reverb). */
  private effects!: GainNode;
  /** Hit markers, cash, wave stingers, heartbeat. */
  private ui!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private readonly voices = new VoiceAllocator<Voice>(RULES, GLOBAL_VOICES);
  private readonly gunBank = new Map<string, AudioBuffer[]>();
  private readonly gunRendering = new Set<string>();
  private enemyBank: AudioBuffer[] = [];
  private explosionBank: AudioBuffer[] = [];
  private lastPick = new Map<string, number>();
  private lastGunAt = -1;
  private listenerKey = "";
  private readonly listenerPos = { x: 0, y: 0, z: 0 };
  private suspendTimer = 0;
  volume = 0.8;
  effectsVolume = 1;
  uiVolume = 0.85;
  private hidden = false;

  resume() {
    if (this.disposed) return;
    if (!this.ctx) this.init();
    if (this.ctx && !this.hidden && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  }

  private init() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ latencyHint: "interactive" });
    } catch {
      ctx = new Ctx();
    }
    this.ctx = ctx;
    this.hidden = document.hidden;

    const glue = this.compressor(GLUE);
    const glueTrim = ctx.createGain();
    glueTrim.gain.value = dbToGain(-GLUE.makeupDb);
    const limiter = this.compressor(LIMIT);
    const limTrim = ctx.createGain();
    limTrim.gain.value = dbToGain(-LIMIT.makeupDb);
    // Last-resort safety: transparent below -1.4 dBFS, can never exceed 0 dBFS.
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = "2x";
    this.gate = ctx.createGain();
    this.gate.gain.value = this.hidden ? 0 : 1;
    glue.connect(glueTrim).connect(limiter).connect(limTrim).connect(clip).connect(this.gate).connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(glue);
    this.effects = ctx.createGain();
    this.effects.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);
    this.dry = ctx.createGain();
    this.dry.connect(this.effects);
    this.applyGains();

    // Reverb: band-limited and pre-delayed so it adds space without hiss
    // (an unfiltered white-noise tail was a big part of the "static").
    this.reverbIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4500;
    const pre = ctx.createDelay(0.1);
    pre.delayTime.value = 0.018;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(ctx, 1.4, 1.25);
    const ret = ctx.createGain();
    ret.gain.value = 0.35;
    this.reverbIn.connect(hp).connect(lp).connect(pre).connect(conv).connect(ret).connect(this.effects);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    document.addEventListener("visibilitychange", this.onVisibility);
    for (const ev of GESTURES) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });

    void this.renderBanks();
  }

  private compressor(c: typeof GLUE) {
    const k = this.ctx!.createDynamicsCompressor();
    k.threshold.value = c.threshold;
    k.knee.value = c.knee;
    k.ratio.value = c.ratio;
    k.attack.value = c.attack;
    k.release.value = c.release;
    return k;
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
    // Short smoothing so slider drags don't zipper.
    this.master.gain.setTargetAtTime(this.volume * this.volume * MASTER_TRIM, t, 0.02);
    this.effects.gain.setTargetAtTime(this.effectsVolume, t, 0.02);
    this.ui.gain.setTargetAtTime(this.uiVolume, t, 0.02);
  }

  /** Fade out, then suspend, in the background; resume + fade in on return. */
  private onVisibility = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    this.hidden = document.hidden;
    const t = ctx.currentTime;
    window.clearTimeout(this.suspendTimer);
    if (this.hidden) {
      this.gate.gain.cancelScheduledValues(t);
      this.gate.gain.setTargetAtTime(0, t, 0.01);
      this.suspendTimer = window.setTimeout(() => {
        if (this.hidden && this.ctx === ctx) void ctx.suspend().catch(() => {});
      }, 80);
    } else {
      void ctx
        .resume()
        .catch(() => {})
        .then(() => {
          if (this.ctx !== ctx || this.hidden) return;
          const now = ctx.currentTime;
          this.gate.gain.cancelScheduledValues(now);
          this.gate.gain.setTargetAtTime(1, now, 0.02);
        });
    }
  };

  /** Browsers may start (or re-suspend) the context: any gesture unlocks it. */
  private onGesture = () => {
    const ctx = this.ctx;
    if (ctx && !this.hidden && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
  };

  /** Keep the listener on the camera for spatial sounds. */
  setListener(pos: V3, fwd: V3) {
    const ctx = this.ctx;
    if (!ctx || this.hidden) return;
    const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)},${fwd.x.toFixed(3)},${fwd.y.toFixed(3)},${fwd.z.toFixed(3)}`;
    if (key === this.listenerKey) return;
    this.listenerKey = key;
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Voices
  // ---------------------------------------------------------------------------

  /** Context time to schedule "now" at, or null when nothing should play. */
  private now() {
    const ctx = this.ctx;
    if (!ctx || this.hidden || ctx.state !== "running") return null;
    return ctx.currentTime + LOOK;
  }

  /**
   * Claim a voice and wire its output: dry/ui bus, or spatial (distance
   * lowpass → equal-power panner → dry) with a reverb send. `rank` is how
   * audible it is (for stealing); defaults to `level`.
   */
  private voice(cat: string, at: number, dur: number, level: number, route: Route, rank = level): Layers | null {
    const ctx = this.ctx!;
    const v: Voice = { id: 0, out: null, nodes: [], sources: [], pending: 0, dead: false };
    const grant = this.voices.request(cat, at, at + dur, rank, v);
    if (!grant) return null;
    v.id = grant.id;
    for (const s of grant.stolen) this.fade(s);

    const out = ctx.createGain();
    out.gain.value = level;
    v.out = out;
    v.nodes.push(out);
    let send = 0;
    if ("bus" in route) {
      out.connect(route.bus === "ui" ? this.ui : this.dry);
      send = route.send ?? 0;
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.5;
      lp.frequency.value = distanceCutoff(route.dist);
      const p = ctx.createPanner();
      p.panningModel = "equalpower";
      p.distanceModel = "inverse";
      p.refDistance = route.ref;
      p.rolloffFactor = route.rolloff;
      p.maxDistance = 10000;
      if (p.positionX) {
        p.positionX.value = route.pos.x;
        p.positionY.value = route.pos.y;
        p.positionZ.value = route.pos.z;
      } else {
        p.setPosition(route.pos.x, route.pos.y, route.pos.z);
      }
      out.connect(lp).connect(p).connect(this.dry);
      v.nodes.push(lp, p);
      // Reverb falls off slower than the direct sound: distant = roomier.
      send = route.send * Math.sqrt(distanceGain(route.dist, route.ref, route.rolloff));
    }
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      out.connect(s).connect(this.reverbIn);
      v.nodes.push(s);
    }

    // Every node the caller layers in is tracked; when the last source ends
    // the whole voice disconnects (no orphaned nodes piling up per shot).
    return new Layers(ctx, out, this.noise, (node, source) => {
      v.nodes.push(node);
      if (!source) return;
      v.sources.push(source);
      v.pending++;
      source.onended = () => {
        if (--v.pending <= 0) this.free(v);
      };
    });
  }

  /** Stolen: 25 ms fade (never a hard cut), then stop. */
  private fade(v: Voice) {
    const ctx = this.ctx;
    if (!ctx || v.dead || !v.out) return;
    v.dead = true;
    const now = ctx.currentTime;
    const g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.025);
    for (const s of v.sources) {
      try {
        s.stop(now + 0.03);
      } catch {
        // Already stopped: the fade alone silences it.
      }
    }
  }

  private free(v: Voice) {
    v.dead = true;
    for (const n of v.nodes) n.disconnect();
    v.nodes.length = 0;
    v.sources.length = 0;
    v.out = null;
    this.voices.release(v.id);
  }

  private pick(key: string, bank: AudioBuffer[]) {
    if (!bank.length) return null;
    const prev = this.lastPick.get(key) ?? -1;
    let i = Math.floor(Math.random() * bank.length);
    if (i === prev && bank.length > 1) i = (i + 1) % bank.length;
    this.lastPick.set(key, i);
    return bank[i];
  }

  // ---------------------------------------------------------------------------
  // Sample banks (rendered offline once per context)
  // ---------------------------------------------------------------------------

  private async renderBanks() {
    const ctx = this.ctx;
    if (!ctx || typeof OfflineAudioContext === "undefined") return;
    try {
      this.enemyBank = await this.renderBank(ctx, 4, 0.75, (L, t) => synthEnemyShot(L, t));
      for (const def of Object.values(WEAPONS) as WeaponDef[]) await this.ensureGunBank(def);
      this.explosionBank = await this.renderBank(ctx, 3, 2.4, (L, t) => synthExplosion(L, t));
    } catch {
      // Offline rendering unavailable: live synthesis keeps working.
    }
  }

  private async ensureGunBank(def: WeaponDef) {
    const ctx = this.ctx;
    if (!ctx || this.gunBank.has(def.id) || this.gunRendering.has(def.id)) return;
    this.gunRendering.add(def.id);
    try {
      const bank = await this.renderBank(ctx, 4, 1.4, (L, t) => synthGunshot(L, t, def));
      if (this.ctx === ctx && bank.length) this.gunBank.set(def.id, bank);
    } finally {
      this.gunRendering.delete(def.id);
    }
  }

  /** Render `n` variants, peak-normalise the set to 1, trim silence. */
  private async renderBank(ctx: AudioContext, n: number, slot: number, synth: (L: Layers, t: number) => void) {
    const sr = ctx.sampleRate;
    const slotLen = Math.ceil(slot * sr);
    const off = new OfflineAudioContext(1, slotLen * n, sr);
    const L = new Layers(off, off.destination, this.noise);
    for (let i = 0; i < n; i++) synth(L, i * slot + 0.001);
    const rendered = await off.startRendering();
    if (this.ctx !== ctx) return [];
    const data = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak < 1e-6) return [];
    const norm = 1 / peak;
    const floor = peak * 0.0004;
    const out: AudioBuffer[] = [];
    for (let i = 0; i < n; i++) {
      const start = i * slotLen;
      let len = slotLen;
      while (len > 1 && Math.abs(data[start + len - 1]) < floor) len--;
      len = Math.min(slotLen, len + Math.ceil(0.005 * sr));
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const fade = Math.ceil(0.004 * sr);
      for (let j = 0; j < len; j++) {
        const tail = len - j < fade ? (len - j) / fade : 1;
        d[j] = data[start + j] * norm * tail;
      }
      out.push(buf);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------------------

  gunshot(def: WeaponDef) {
    const now = this.now();
    if (now === null) return;
    // Two shots in one frame (fixed-step catch-up) get spaced out like the
    // real cadence instead of stacking into one doubled, clipping blast.
    const spacing = (0.75 * 60) / Math.max(60, def.rpm);
    const at = Math.max(now, this.lastGunAt + spacing);
    if (at - now > 0.1) return;
    const p = def.sound;
    const level = 0.7 * p.volume * (0.94 + Math.random() * 0.12);
    const route: Route = { bus: "dry", send: 0.45 * p.tail };
    const buf = this.pick(def.id, this.gunBank.get(def.id) ?? []);
    if (buf) {
      const rate = 0.97 + Math.random() * 0.06;
      this.voice("gun", at, buf.duration / rate, level, route)?.buffer(at, buf, rate);
    } else {
      void this.ensureGunBank(def);
      const L = this.voice("gun", at, 1.2, level * LIVE_NORM, route);
      if (L) synthGunshot(L, at, def);
    }
    this.lastGunAt = at;
    if (def.cycleAction) this.pump(at + 0.2);
  }

  /** Shotgun pump / bolt: rack back + forward. */
  pump(at?: number) {
    const now = this.now();
    if (now === null) return;
    const t = Math.max(now, at ?? now);
    const L = this.voice("pump", t, 0.3, FOLEY, { bus: "dry", send: 0.15 });
    if (!L) return;
    L.noise(t, { type: "bandpass", freq: 1500, q: 2 }, 0.45, 0.002, 0.06);
    L.noise(t + 0.13, { type: "bandpass", freq: 2400, q: 3 }, 0.55, 0.001, 0.05);
    L.tone(t + 0.13, "triangle", 420, 260, 0.04, 0.2, 0.0015, 0.06);
  }

  /** Distant/enemy gunfire: positional, air-filtered, arrives at the speed of sound. */
  enemyShot(at: V3, heavy: number, distance: number) {
    const now = this.now();
    if (now === null) return;
    const level = 0.42 * heavy;
    const audible = level * distanceGain(distance, 6, 1);
    if (audible < 0.004) return;
    const t = now + arrivalDelay(distance);
    const route: Route = { pos: at, dist: distance, ref: 6, rolloff: 1, send: 0.55 };
    const buf = this.pick("enemy", this.enemyBank);
    const rate = (0.95 + Math.random() * 0.1) / Math.pow(Math.max(0.5, heavy), 0.3);
    if (buf) {
      this.voice("enemy", t, buf.duration / rate, level, route, audible)?.buffer(t, buf, rate);
    } else {
      const L = this.voice("enemy", t, 0.6, level * LIVE_NORM, route, audible);
      if (L) synthEnemyShot(L, t);
    }
  }

  /** Near-miss bullet crack flying past the listener. */
  whizz(at: V3) {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("whizz", now, 0.2, FOLEY, { pos: at, dist: 1.5, ref: 1.5, rolloff: 1.5, send: 0.1 });
    if (!L) return;
    L.noise(now, { type: "bandpass", freq: 3500, to: 1200, over: 0.12, q: 2 }, 0.5, 0.004, 0.12);
    L.tone(now, "sine", 2400, 900, 0.1, 0.06, 0.002, 0.1);
  }

  /** Player got hit. */
  hurt(heavy: boolean) {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("hurt", now, 0.25, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "lowpass", freq: 700 }, heavy ? 0.7 : 0.45, 0.002, 0.12);
    L.tone(now, "sine", 110, 55, 0.12, heavy ? 0.6 : 0.35, 0.002, 0.15);
  }

  explosion(at: V3, distance: number) {
    const now = this.now();
    if (now === null) return;
    const level = 1.4;
    const audible = level * distanceGain(distance, 10, 0.9);
    const t = now + arrivalDelay(distance);
    const route: Route = { pos: at, dist: distance, ref: 10, rolloff: 0.9, send: 0.7 };
    const buf = this.pick("explosion", this.explosionBank);
    if (buf) {
      this.voice("explosion", t, buf.duration, level, route, audible)?.buffer(t, buf, 0.96 + Math.random() * 0.08);
    } else {
      const L = this.voice("explosion", t, 2.2, level * LIVE_NORM, route, audible);
      if (L) synthExplosion(L, t);
    }
  }

  grenadeBounce(at: V3) {
    const now = this.now();
    if (now === null) return;
    this.voice("bounce", now, 0.12, FOLEY, { pos: at, dist: 3, ref: 3, rolloff: 1.2, send: 0.3 })?.tone(now, "triangle", 900, 700, 0.03, 0.2, 0.0015, 0.06);
  }

  grenadeThrow() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("foley", now, 0.5, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "bandpass", freq: 4000, q: 6 }, 0.3, 0.0008, 0.02); // pin
    L.noise(now + 0.25, { type: "bandpass", freq: 900, to: 400, over: 0.2, q: 0.8 }, 0.3, 0.02, 0.2); // whoosh
  }

  /** Knife swing; `hit` adds a meaty impact. */
  knife(hit: boolean) {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("foley", now, 0.25, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "bandpass", freq: 2500, to: 800, over: 0.15, q: 1.2 }, 0.35, 0.01, 0.15);
    if (hit) {
      L.noise(now + 0.02, { type: "lowpass", freq: 900 }, 0.8, 0.001, 0.09);
      L.tone(now + 0.02, "sine", 140, 60, 0.08, 0.5, 0.002, 0.1);
    }
  }

  // ---------------------------------------------------------------------------
  // Survival UI stingers
  // ---------------------------------------------------------------------------

  cash() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("ui", now, 0.3, 1, { bus: "ui" });
    if (!L) return;
    L.tone(now, "sine", 1320, 1320, 0.01, 0.12, 0.002, 0.09);
    L.tone(now + 0.06, "sine", 1760, 1760, 0.01, 0.12, 0.002, 0.14);
  }

  denied() {
    const now = this.now();
    if (now === null) return;
    this.voice("ui", now, 0.25, 1, { bus: "ui" })?.tone(now, "square", 220, 180, 0.15, 0.1, 0.003, 0.18);
  }

  waveStart() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("sting", now, 2.6, 1, { bus: "ui" });
    if (!L) return;
    // Low brass-ish swell: stacked saws through a closing lowpass.
    for (const f of [55, 82.5, 110]) L.swell(now, "sawtooth", f, [200, 1200, 150], 0.1, 0.4, 2.4);
    L.tone(now, "sine", 60, 40, 1.5, 0.45, 0.01, 1.4);
  }

  waveClear() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("sting", now, 0.9, 1, { bus: "ui" });
    if (!L) return;
    [523, 659, 784, 1046].forEach((f, i) => L.tone(now + i * 0.09, "triangle", f, f, 0.01, 0.15, 0.004, 0.5));
  }

  downed() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("sting", now, 1.5, 1, { bus: "ui" });
    if (!L) return;
    L.tone(now, "sine", 220, 70, 1.2, 0.5, 0.01, 1.4);
    L.noise(now, { type: "lowpass", freq: 300 }, 0.6, 0.01, 0.8);
  }

  heartbeat() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("ui", now, 0.4, 1, { bus: "ui" });
    if (!L) return;
    L.tone(now, "sine", 60, 45, 0.08, 0.45, 0.005, 0.12);
    L.tone(now + 0.18, "sine", 55, 40, 0.08, 0.3, 0.005, 0.12);
  }

  dryFire() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("foley", now, 0.08, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "bandpass", freq: 4200, q: 6 }, 0.5, 0.0008, 0.02);
    L.tone(now, "square", 1900, 1600, 0.015, 0.05, 0.0015, 0.02);
  }

  reload(stage: ReloadStage) {
    if (stage === "done") return;
    const now = this.now();
    if (now === null) return;
    const L = this.voice("foley", now, 0.2, FOLEY, { bus: "dry", send: 0.08 });
    if (!L) return;
    const t = now;
    switch (stage) {
      case "start": // cloth / grip shift
        L.noise(t, { type: "bandpass", freq: 900, q: 0.8 }, 0.18, 0.02, 0.12);
        break;
      case "magOut": // release click + slide out
        L.noise(t, { type: "bandpass", freq: 3500, q: 5 }, 0.45, 0.0008, 0.025);
        L.noise(t + 0.03, { type: "bandpass", freq: 1400, q: 1.2 }, 0.22, 0.01, 0.1);
        break;
      case "magIn": // insert scrape + seat clack
        L.noise(t, { type: "bandpass", freq: 1800, q: 1.5 }, 0.2, 0.01, 0.07);
        L.noise(t + 0.07, { type: "bandpass", freq: 2600, q: 3 }, 0.6, 0.0008, 0.04);
        L.tone(t + 0.07, "triangle", 520, 300, 0.04, 0.25, 0.0015, 0.05);
        break;
      case "bolt": // charging handle back and forward
        L.noise(t, { type: "bandpass", freq: 3000, q: 3 }, 0.45, 0.0008, 0.035);
        L.noise(t + 0.09, { type: "bandpass", freq: 2200, q: 2.5 }, 0.65, 0.0008, 0.05);
        L.tone(t + 0.09, "triangle", 700, 380, 0.05, 0.25, 0.0015, 0.06);
        break;
      case "shell": // shell push into the tube
        L.noise(t, { type: "bandpass", freq: 1200, q: 2 }, 0.3, 0.002, 0.05);
        L.noise(t + 0.05, { type: "bandpass", freq: 2600, q: 4 }, 0.4, 0.0008, 0.03);
        break;
    }
  }

  swap() {
    const now = this.now();
    if (now === null) return;
    const L = this.voice("foley", now, 0.2, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "bandpass", freq: 1100, q: 0.7 }, 0.2, 0.02, 0.12);
    L.noise(now + 0.1, { type: "bandpass", freq: 2800, q: 4 }, 0.3, 0.0008, 0.03);
  }

  adsIn() {
    const now = this.now();
    if (now === null) return;
    this.voice("foley", now, 0.12, FOLEY, { bus: "dry" })?.noise(now, { type: "bandpass", freq: 700, q: 0.7 }, 0.1, 0.02, 0.09);
  }

  // ---------------------------------------------------------------------------
  // Hit confirmation
  // ---------------------------------------------------------------------------

  /** Throttled: nine shotgun pellets landing in one frame play one marker. */
  hit(kind: "body" | "head" | "kill" | "headkill") {
    const now = this.now();
    if (now === null) return;
    const killed = kind === "kill" || kind === "headkill";
    const L = this.voice(killed ? "kill" : "hit", now, 0.3, 1, { bus: "ui" }, kind === "head" ? 1.2 : 1);
    if (!L) return;
    const t = now;
    if (kind === "body") {
      L.tone(t, "square", 1350, 1250, 0.03, 0.1, 0.0015, 0.035);
      L.noise(t, { type: "bandpass", freq: 5000, q: 3 }, 0.18, 0.0008, 0.02);
    } else if (kind === "head") {
      // Bright metallic "tink".
      L.tone(t, "sine", 2400, 2380, 0.18, 0.22, 0.0015, 0.2);
      L.tone(t, "sine", 3620, 3600, 0.12, 0.12, 0.0015, 0.14);
      L.noise(t, { type: "highpass", freq: 6000 }, 0.2, 0.0008, 0.015);
    } else {
      // Kill: low confirm thunk + tick (+ tink for headshot kills).
      L.tone(t, "sine", 180, 70, 0.12, 0.5, 0.002, 0.14);
      L.tone(t, "square", 1100, 900, 0.05, 0.1, 0.0015, 0.06);
      if (kind === "headkill") {
        L.tone(t + 0.01, "sine", 2600, 2580, 0.25, 0.22, 0.0015, 0.28);
        L.tone(t + 0.01, "sine", 3900, 3880, 0.18, 0.1, 0.0015, 0.2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------

  /** Positional bullet impact (voice-limited so full-auto doesn't stack up). */
  impact(at: V3, surface: Surface) {
    const now = this.now();
    if (now === null) return;
    const dist = this.distanceTo(at);
    const audible = FOLEY * distanceGain(dist, 4, 1.2);
    if (audible < 0.004) return;
    const L = this.voice("impact", now, surface === "steel" ? 0.7 : 0.25, FOLEY, { pos: at, dist, ref: 4, rolloff: 1.2, send: 0.35 }, audible);
    if (!L) return;
    switch (surface) {
      case "steel":
        L.tone(now, "sine", 1180, 1170, 0.5, 0.45, 0.0015, 0.6);
        L.tone(now, "sine", 2830, 2810, 0.3, 0.22, 0.0015, 0.35);
        L.noise(now, { type: "highpass", freq: 3000 }, 0.4, 0.0008, 0.03);
        break;
      case "metal":
        L.tone(now, "triangle", 620, 560, 0.18, 0.3, 0.0015, 0.2);
        L.noise(now, { type: "bandpass", freq: 2500, q: 2 }, 0.5, 0.0008, 0.06);
        break;
      case "wood":
        L.noise(now, { type: "bandpass", freq: 700, q: 1.5 }, 0.8, 0.0008, 0.07);
        break;
      case "target":
        L.noise(now, { type: "lowpass", freq: 900 }, 0.6, 0.0008, 0.06);
        break;
      default:
        L.noise(now, { type: "bandpass", freq: surface === "sand" ? 500 : 1300, q: 1 }, 0.7, 0.0008, 0.06);
    }
  }

  /** Ejected brass / hull hitting the floor: short metallic tinkle. */
  shellDrop(at: V3, kind: "rifle" | "pistol" | "shotgun" | "magnum" | "heavy", speed: number) {
    const now = this.now();
    if (now === null) return;
    const v = Math.min(1, speed / 4) * 0.16;
    if (v < 0.01) return;
    const dist = this.distanceTo(at);
    const L = this.voice("shell", now, 0.2, FOLEY, { pos: at, dist, ref: 1.5, rolloff: 1.6, send: 0.1 }, v * distanceGain(dist, 1.5, 1.6));
    if (!L) return;
    if (kind === "shotgun") {
      L.noise(now, { type: "bandpass", freq: 900, q: 2 }, v * 1.4, 0.0008, 0.04);
      L.tone(now, "triangle", 420, 400, 0.05, v * 0.6, 0.0015, 0.05);
      return;
    }
    const f = (kind === "pistol" ? 5200 : kind === "magnum" ? 3600 : 4300) * (0.92 + Math.random() * 0.16);
    L.tone(now, "sine", f, f * 0.995, 0.12, v, 0.0015, 0.09 + Math.random() * 0.05);
    L.tone(now, "sine", f * 1.52, f * 1.51, 0.08, v * 0.5, 0.0015, 0.06);
    L.noise(now, { type: "highpass", freq: 5000 }, v * 0.6, 0.0008, 0.012);
  }

  footstep(speed: number, crouched: boolean) {
    const now = this.now();
    if (now === null) return;
    const v = Math.min(1, speed / 8) * (crouched ? 0.35 : 1);
    if (v < 0.02) return;
    const L = this.voice("step", now, 0.12, FOLEY, { bus: "dry" }, v);
    if (!L) return;
    L.noise(now, { type: "lowpass", freq: 600 + Math.random() * 300 }, 0.35 * v, 0.004, 0.07);
    L.noise(now + 0.01, { type: "bandpass", freq: 2200, q: 1.5 }, 0.06 * v, 0.003, 0.05); // grit
  }

  jump() {
    const now = this.now();
    if (now === null) return;
    this.voice("move", now, 0.15, FOLEY, { bus: "dry" })?.noise(now, { type: "bandpass", freq: 800, q: 0.8 }, 0.15, 0.01, 0.1);
  }

  land(fallSpeed: number) {
    const now = this.now();
    if (now === null) return;
    const v = Math.min(1, fallSpeed / 12);
    const L = this.voice("move", now, 0.18, FOLEY, { bus: "dry" });
    if (!L) return;
    L.noise(now, { type: "lowpass", freq: 400 }, 0.5 * v + 0.1, 0.003, 0.12);
    if (v > 0.05) L.tone(now, "sine", 90, 50, 0.1, 0.4 * v, 0.003, 0.12);
  }

  slide() {
    const now = this.now();
    if (now === null) return;
    this.voice("move", now, 0.7, FOLEY, { bus: "dry" })?.noise(now, { type: "bandpass", freq: 1600, to: 500, over: 0.6, q: 0.8 }, 0.3, 0.02, 0.6);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private distanceTo(at: V3) {
    const l = this.listenerPos;
    const dx = at.x - l.x;
    const dy = at.y - l.y;
    const dz = at.z - l.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Generated stereo impulse: a few early reflections (yard slap) then a
   * diffuse tail whose brightness decays faster than its level, like air
   * and terrain absorbing highs. Fades in and out at exactly 0.
   */
  private makeImpulse(ctx: AudioContext, seconds: number, rt60: number) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const fadeOut = Math.floor(sr * 0.08);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp((-t * 6.91) / rt60);
        const onset = Math.min(1, t / 0.012);
        const fc = 1200 + 7800 * Math.exp(-t / 0.35);
        const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        lp += a * (Math.random() * 2 - 1 - lp);
        const out = len - i < fadeOut ? (len - i) / fadeOut : 1;
        d[i] = lp * env * onset * out;
      }
      for (let k = 0; k < 7; k++) {
        const at = Math.floor(sr * (0.011 + Math.random() * 0.075));
        const amp = 0.5 * (1 - k / 8) * (Math.random() < 0.5 ? -1 : 1);
        for (let j = 0; j < 32 && at + j < len; j++) d[at + j] += amp * Math.exp(-j / 6) * (0.6 + Math.random() * 0.4);
      }
    }
    return buf;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.suspendTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const ev of GESTURES) window.removeEventListener(ev, this.onGesture, { capture: true });
    this.voices.clear();
    this.gunBank.clear();
    this.enemyBank = [];
    this.explosionBank = [];
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }
}

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
