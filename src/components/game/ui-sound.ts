"use client";

/**
 * Tiny synthesized UI sounds for the menus (no audio files): a soft tick on
 * hover, a crisp click on select, a low rising sting on deploy. Follows the
 * saved master volume and stays silent until the first user gesture (browser
 * autoplay rules).
 */
type Kind = "hover" | "click" | "select" | "deploy" | "error";

let ctx: AudioContext | null = null;
let lastHover = 0;

function volume() {
  try {
    const raw = window.localStorage.getItem("tgf.iron-horizon.settings");
    const v = raw ? (JSON.parse(raw) as { volume?: number }).volume : undefined;
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function tone(a: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function uiSound(kind: Kind) {
  const v = volume();
  if (v <= 0) return;
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (kind === "hover") {
    if (now - lastHover < 0.06) return;
    lastHover = now;
  }
  const out = a.createGain();
  out.gain.value = v * 0.5;
  out.connect(a.destination);
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
      tone(a, out, "sawtooth", 70, 140, now, 0.55, 0.16);
      tone(a, out, "sine", 220, 440, now + 0.05, 0.5, 0.12);
      tone(a, out, "triangle", 1760, 1760, now + 0.42, 0.18, 0.08);
      break;
    case "error":
      tone(a, out, "square", 220, 160, now, 0.16, 0.08);
      break;
  }
  window.setTimeout(() => out.disconnect(), 900);
}
