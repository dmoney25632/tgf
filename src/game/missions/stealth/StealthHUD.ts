import * as THREE from "three";
import { HUD_FG, HUD_MONO, HUD_SANS } from "../../ui/HUD";
import type { StealthStatus } from "../types";

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement) => {
  const e = css(document.createElement("div"), s);
  parent?.appendChild(e);
  return e;
};

/** One guard awareness marker: world position (head height), gauge 0–1, mode code (see StealthDirector MODE_CODE). */
export type StealthMarker = { x: number; y: number; z: number; pct: number; mode: number };

export type StealthView = {
  status: StealthStatus;
  /** Seconds left on the alarm / search (−1 hides). */
  timer: number;
  cue: string;
  /** 0–1 how visible the local player is right now. */
  visibility: number;
  markers: StealthMarker[];
};

const MAX_MARKERS = 14;
const STATUS: Record<StealthStatus, { label: string; color: string; bg: string }> = {
  hidden: { label: "HIDDEN", color: "#9fd6a8", bg: "rgba(20,40,28,.55)" },
  suspicious: { label: "SUSPICIOUS", color: "#ffc845", bg: "rgba(60,46,10,.6)" },
  alert: { label: "ALERT", color: "#ff5a4a", bg: "rgba(70,14,10,.66)" },
};

/**
 * Stealth overlay: the status badge (HIDDEN / SUSPICIOUS / ALERT with the
 * alarm or search countdown and a cue line), the player's visibility meter
 * and a marker over every guard that has noticed something: a ring that
 * fills with its awareness, "?" while suspicious or searching, "!" when it's
 * calling it in. Off-screen markers clamp to the screen edge with an arrow.
 * DOM writes only when values change.
 */
export class StealthHUD {
  private readonly root: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly cueEl: HTMLDivElement;
  private readonly meter: HTMLDivElement;
  private readonly meterFill: HTMLDivElement;
  private readonly marks: { el: HTMLDivElement; ring: HTMLDivElement; glyph: HTMLDivElement; arrow: HTMLDivElement; on: boolean; key: string; pos: string }[] = [];
  private readonly v = new THREE.Vector3();
  private lStatus: StealthStatus | "" = "";
  private lTimer = "";
  private lCue = "";
  private lVis = -1;

  constructor(container: HTMLElement) {
    this.root = div(`position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden;color:${HUD_FG};font-family:${HUD_SANS};text-shadow:0 1px 2px rgba(0,0,0,.6);`, container);
    this.root.className = "ih-hud";
    this.badge = div("position:absolute;left:50%;top:18px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;", this.root);
    const row = div("display:flex;align-items:center;gap:8px;padding:5px 12px;border-radius:2px;", this.badge);
    this.label = div("font-size:13px;font-weight:800;letter-spacing:.22em;", row);
    this.timer = div(`font:600 12px/1 ${HUD_MONO};opacity:.85;`, row);
    this.cueEl = div("font-size:10px;font-weight:700;letter-spacing:.16em;opacity:.9;min-height:12px;", this.badge);
    this.meter = div("width:150px;height:4px;background:rgba(0,0,0,.45);overflow:hidden;border-radius:2px;", this.badge);
    this.meterFill = div("height:100%;width:100%;transform-origin:left;transform:scaleX(0);background:#c8d0c0;", this.meter);
    div("font-size:9px;letter-spacing:.2em;opacity:.55;", this.badge).textContent = "VISIBILITY";
    (row as HTMLDivElement).dataset.row = "1";
    for (let i = 0; i < MAX_MARKERS; i++) {
      const el = div("position:absolute;left:0;top:0;width:30px;height:30px;display:none;will-change:transform;", this.root);
      const ring = div("position:absolute;inset:0;border-radius:50%;", el);
      div("position:absolute;inset:4px;border-radius:50%;background:rgba(8,10,8,.7);", el);
      const glyph = div("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;", el);
      const arrow = div("position:absolute;left:50%;top:50%;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:9px solid #ffc845;display:none;transform-origin:50% 50%;", el);
      this.marks.push({ el, ring, glyph, arrow, on: false, key: "", pos: "" });
    }
  }

  frame(view: StealthView, camera: THREE.Camera, w: number, h: number) {
    if (view.status !== this.lStatus) {
      const st = STATUS[view.status];
      this.lStatus = view.status;
      this.label.textContent = st.label;
      this.label.style.color = st.color;
      (this.label.parentElement as HTMLDivElement).style.background = st.bg;
      this.label.animate?.([{ transform: "scale(1.25)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    }
    const t = view.timer >= 0 ? `${Math.ceil(view.timer)}s` : "";
    if (t !== this.lTimer) this.timer.textContent = this.lTimer = t;
    if (view.cue !== this.lCue) {
      this.cueEl.textContent = this.lCue = view.cue;
      this.cueEl.style.color = view.status === "alert" ? "#ff8a7a" : "#ffd88a";
    }
    const vis = Math.round(view.visibility * 40) / 40;
    if (vis !== this.lVis) {
      this.lVis = vis;
      this.meterFill.style.transform = `scaleX(${vis})`;
      this.meterFill.style.background = vis > 0.6 ? "#ff9a6a" : vis > 0.3 ? "#e8d080" : "#9fb4a0";
    }
    // ---- Guard markers ------------------------------------------------------------------------------
    for (let i = 0; i < MAX_MARKERS; i++) {
      const m = this.marks[i];
      const d = view.markers[i];
      if (!d) {
        if (m.on) {
          m.on = false;
          m.el.style.display = "none";
        }
        continue;
      }
      if (!m.on) {
        m.on = true;
        m.el.style.display = "block";
      }
      const calling = d.mode === 4;
      const color = calling || d.pct >= 0.95 ? "#ff5a4a" : d.pct >= 0.3 || d.mode > 0 ? "#ffc845" : "#e8e4d8";
      const pct = Math.round(Math.max(d.pct, calling ? 1 : 0) * 20) * 5;
      const glyph = calling ? "!" : d.mode > 0 || d.pct >= 0.3 ? "?" : "";
      const key = `${pct}|${color}|${glyph}`;
      if (key !== m.key) {
        m.key = key;
        m.ring.style.background = `conic-gradient(${color} ${pct}%, rgba(255,255,255,.12) ${pct}% 100%)`;
        m.glyph.textContent = glyph;
        m.glyph.style.color = color;
        m.arrow.style.borderBottomColor = color;
      }
      const v = this.v.set(d.x, d.y, d.z).project(camera);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) {
        x = -x;
        y = -y;
      }
      const edge = 0.9;
      const off = behind || Math.abs(x) > edge || Math.abs(y) > edge;
      if (off) {
        const k = Math.max(Math.abs(x), Math.abs(y), 1e-3) / edge;
        x /= k;
        y /= k;
      }
      const px = Math.round(((x + 1) / 2) * w - 15);
      const py = Math.round(((1 - y) / 2) * h - 15);
      const ang = off ? Math.atan2(x, y) : 0;
      const pos = `${px},${py},${off ? Math.round(ang * 20) : 99}`;
      if (pos !== m.pos) {
        m.pos = pos;
        m.el.style.transform = `translate(${px}px,${py}px)`;
        m.arrow.style.display = off ? "block" : "none";
        if (off) m.arrow.style.transform = `translate(-50%,-50%) rotate(${ang}rad) translateY(-21px)`;
      }
    }
  }

  dispose() {
    this.root.remove();
  }
}
