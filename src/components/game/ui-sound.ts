"use client";

/**
 * Tiny synthesized UI sounds for the menus (no audio files): a soft tick on
 * hover, a crisp click on select, a low rising sting on deploy. Follows the
 * saved master volume and stays silent until the first user gesture (browser
 * autoplay rules).
 *
 * One shared AudioContext and one output bus for the whole lobby. Every tone
 * ramps from and back to exactly 0, is scheduled a few ms ahead (so attacks
 * aren't skipped), and disconnects itself when it ends. The context suspends
 * after a few idle seconds or when the tab is hidden, so it costs nothing in
 * the background.
 */
type Kind = "hover" | "click" | "select" | "deploy" | "error";

const LOOK = 0.005;
const IDLE_SUSPEND_MS = 4000;

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let lastHover = 0;
let lastKind: Kind | null = null;
let lastAt = 0;
let idleTimer = 0;
let voices = 0;

function volume() {
  try {
    const raw = window.localStorage.getItem("tgf.iron-horizon.settings");
    const s = raw ? (JSON.parse(raw) as { volume?: number; uiVolume?: number }) : {};
    const v = typeof s.volume === "number" && Number.isFinite(s.volume) ? Math.max(0, Math.min(1, s.volume)) : 0.8;
    const ui = typeof s.uiVolume === "number" && Number.isFinite(s.uiVolume) ? Math.max(0, Math.min(1, s.uiVolume)) : 1;
    return v * v * ui;
  } catch {
    return 0.64;
  }
}

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC({ latencyHint: "interactive" });
    } catch {
      ctx = new AC();
    }
    bus = ctx.createGain();
    bus.gain.value = 0;
    // Gentle safety so stacked clicks can never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    bus.connect(comp).connect(ctx.destination);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && ctx?.state === "running") void ctx.suspend().catch(() => {});
    });
  }
  if (ctx.state === "suspended" && !document.hidden) void ctx.resume().catch(() => {});
  return ctx;
}

function scheduleIdleSuspend() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (ctx && voices === 0 && ctx.state === "running") void ctx.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

function tone(a: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const attack = Math.max(0.002, Math.min(0.01, dur * 0.2));
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(peak * 0.001, t0 + dur);
  g.gain.linearRampToValueAtTime(0, t0 + dur + 0.01);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  voices++;
  o.onended = () => {
    o.disconnect();
    g.disconnect();
    voices--;
    if (voices === 0) scheduleIdleSuspend();
  };
}

export function uiSound(kind: Kind) {
  const v = volume();
  if (v <= 0) return;
  const a = audio();
  if (!a || !bus || a.state === "closed") return;
  const now = a.currentTime + LOOK;
  if (kind === "hover") {
    if (now - lastHover < 0.06) return;
    lastHover = now;
  } else if (kind === lastKind && now - lastAt < 0.04) {
    return; // double-fired handlers: one sound
  }
  lastKind = kind;
  lastAt = now;
  bus.gain.setTargetAtTime(v * 0.6, a.currentTime, 0.01);
  const out = bus;
  switch (kind) {
    case "hover":
      tone(a, out, "sine", 2400, 2100, now, 0.035, 0.05);
      break;
    case "click":
      tone(a, out, "triangle", 1500, 700, now, 0.06, 0.18);
      break;
    case "select":
      tone(a, out, "triangle", 880, 880, now, 0.07, 0.14);
      tone(a, out, "triangle", 1320, 1320, now + 0.06, 0.09, 0.12);
      break;
    case "deploy":
      tone(a, out, "sawtooth", 70, 140, now, 0.55, 0.14);
      tone(a, out, "sine", 220, 440, now + 0.05, 0.5, 0.12);
      tone(a, out, "triangle", 1760, 1760, now + 0.42, 0.18, 0.08);
      break;
    case "error":
      tone(a, out, "square", 220, 160, now, 0.16, 0.07);
      break;
  }
}
