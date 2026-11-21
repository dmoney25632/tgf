import * as THREE from "three";
import { escapeHtml, HUD_ACCENT, HUD_FG, HUD_MONO, HUD_SANS } from "../ui/HUD";

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement, cls = "") => {
  const e = css(document.createElement("div"), s);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

const SUB_LINES = 3;
const SUB_TIME = 5.5;

/**
 * Mission-only overlay that sits beside the shared HUD + SurvivalHUD (which
 * still draws the team list, prompts, downed screen, boss bar, banners and
 * damage numbers): the objective panel, radio subtitles with speaker names
 * and a projected waypoint marker. Writes to the DOM only when values change.
 *
 * `attach(survivalHudRoot)` swaps the survival wave counter / money for the
 * objective panel so the top-left column reads: objective, then team.
 */
export class MissionHUD {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly step: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private lClock = "";
  private readonly fill: HTMLDivElement;
  private readonly subs: { el: HTMLDivElement; t: number }[] = [];
  private nextSub = 0;
  private readonly mark: HTMLDivElement;
  private readonly markLabel: HTMLDivElement;
  private readonly markDist: HTMLDivElement;
  private readonly v = new THREE.Vector3();

  private lStep = "";
  private lTitle = "";
  private lDetail = "";
  private lStatus = "";
  private lFill = -2;
  private lMark = false;
  private lMarkLabel = "";
  private lDist = -1;
  private lX = -1;
  private lY = -1;

  constructor(container: HTMLElement) {
    this.root = div("position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden;", container, "ih-hud");
    this.root.style.cssText += `color:${HUD_FG};font-family:${HUD_SANS};text-shadow:0 1px 2px rgba(0,0,0,.6);`;

    this.panel = div("width:260px;margin-bottom:4px;", this.root);
    this.step = div(`opacity:.7;color:${HUD_ACCENT};`, this.panel, "ih-cap");
    this.title = div("font-size:15px;font-weight:800;letter-spacing:.08em;margin-top:3px;line-height:1.25;", this.panel);
    this.detail = div("font-size:11px;line-height:1.4;opacity:.78;margin-top:4px;", this.panel);
    this.status = div(`font:600 12px/1.2 ${HUD_MONO};letter-spacing:.1em;margin-top:6px;min-height:14px;`, this.panel);
    this.bar = div("height:3px;margin-top:5px;background:rgba(0,0,0,.45);overflow:hidden;display:none;", this.panel);
    this.fill = div(`height:100%;width:100%;background:${HUD_ACCENT};transform-origin:left;transform:scaleX(0);`, this.bar);
    this.clockEl = div(`font:600 11px/1.2 ${HUD_MONO};letter-spacing:.08em;margin-top:6px;opacity:.75;display:none;`, this.panel);

    // Subtitles: bottom centre, above the weapon / health rows.
    const sw = div("position:absolute;left:50%;bottom:118px;transform:translateX(-50%);width:min(720px,86vw);display:flex;flex-direction:column;align-items:center;gap:4px;", this.root);
    for (let i = 0; i < SUB_LINES; i++) {
      const el = div("display:none;padding:5px 12px;background:rgba(8,10,8,.62);font-size:14px;line-height:1.35;text-align:center;border-radius:2px;", sw);
      this.subs.push({ el, t: 0 });
    }

    // Waypoint.
    this.mark = div("position:absolute;left:0;top:0;width:60px;display:none;text-align:center;will-change:transform;", this.root);
    div(`width:12px;height:12px;margin:0 auto;transform:rotate(45deg);border:2px solid ${HUD_ACCENT};box-shadow:0 0 6px rgba(0,0,0,.5);`, this.mark);
    this.markLabel = div(`font-size:10px;font-weight:700;letter-spacing:.16em;margin-top:5px;color:${HUD_ACCENT};white-space:nowrap;`, this.mark);
    this.markDist = div(`font:600 11px/1 ${HUD_MONO};margin-top:2px;white-space:nowrap;`, this.mark);
  }

  /** Put the objective panel at the top of the survival HUD's left column and hide wave / money. */
  attach(survivalRoot: Element | null) {
    const col = survivalRoot?.children[0] as HTMLElement | undefined;
    if (!col) {
      css(this.panel, this.panel.style.cssText + "position:absolute;left:26px;top:20px;");
      return;
    }
    for (let i = 0; i < 3 && i < col.children.length; i++) (col.children[i] as HTMLElement).style.display = "none";
    col.prepend(this.panel);
    const money = survivalRoot!.children[3] as HTMLElement | undefined;
    if (money) money.style.display = "none";
  }

  objective(step: string, title: string, detail: string) {
    if (step !== this.lStep) this.step.textContent = this.lStep = step;
    if (title !== this.lTitle) {
      this.title.textContent = this.lTitle = title;
      this.title.animate?.([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "ease-out" });
    }
    if (detail !== this.lDetail) this.detail.textContent = this.lDetail = detail;
  }

  /** Status line under the objective (timer, hostiles left) and an optional 0..1 bar (-1 hides). */
  progress(status: string, frac: number) {
    if (status !== this.lStatus) this.status.innerHTML = this.lStatus = status;
    const q = frac < 0 ? -1 : Math.round(frac * 200) / 200;
    if (q !== this.lFill) {
      if ((q < 0) !== (this.lFill < 0) || this.lFill === -2) this.bar.style.display = q < 0 ? "none" : "block";
      this.lFill = q;
      if (q >= 0) this.fill.style.transform = `scaleX(${q})`;
    }
  }

  /** Run clock / star target line under the objective (empty hides). */
  clock(text: string) {
    if (text === this.lClock) return;
    if (!text !== !this.lClock) this.clockEl.style.display = text ? "block" : "none";
    this.clockEl.innerHTML = this.lClock = text;
  }

  radio(speaker: string, text: string) {
    const s = this.subs[this.nextSub];
    this.nextSub = (this.nextSub + 1) % SUB_LINES;
    s.el.innerHTML = `<span style="color:${HUD_ACCENT};font-weight:800;letter-spacing:.12em;font-size:11px;margin-right:8px">${escapeHtml(speaker)}</span>${escapeHtml(text)}`;
    s.el.style.display = "block";
    s.el.parentElement?.appendChild(s.el); // newest at the bottom
    s.t = SUB_TIME + text.length * 0.025;
    s.el.animate?.([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
  }

  /**
   * Waypoint at a world point (null hides). Off-screen / behind the camera the
   * marker clamps to the screen edge.
   */
  frame(dt: number, camera: THREE.Camera, w: number, h: number, at: THREE.Vector3 | null, label: string, from: THREE.Vector3) {
    for (const s of this.subs) {
      if (s.t <= 0) continue;
      s.t -= dt;
      if (s.t <= 0) s.el.style.display = "none";
    }
    const on = at !== null;
    if (on !== this.lMark) {
      this.lMark = on;
      this.mark.style.display = on ? "block" : "none";
    }
    if (!at) return;
    if (label !== this.lMarkLabel) this.markLabel.textContent = this.lMarkLabel = label;
    const d = Math.round(Math.hypot(at.x - from.x, at.z - from.z));
    if (d !== this.lDist) {
      this.lDist = d;
      this.markDist.textContent = `${d} m`;
    }
    const v = this.v.copy(at).project(camera);
    let x = v.x, y = v.y;
    if (v.z > 1) {
      // Behind: mirror and push to the bottom edge.
      x = -x;
      y = -1;
    }
    const m = 0.92;
    const k = Math.max(Math.abs(x) / m, Math.abs(y) / m, 1);
    x /= k;
    y /= k;
    const px = Math.round(((x + 1) / 2) * w - 30);
    const py = Math.round(((1 - y) / 2) * h - 10);
    if (px !== this.lX || py !== this.lY) {
      this.lX = px;
      this.lY = py;
      this.mark.style.transform = `translate(${px}px,${py}px)`;
    }
  }

  dispose() {
    this.panel.remove();
    this.root.remove();
  }
}
