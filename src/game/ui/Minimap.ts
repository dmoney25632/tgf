import type { MapDef } from "../world/MapLoader";
import type { Bounds } from "../world/overview/rasterize";
import { overviewCanvas } from "../world/overview/canvas";
import { HUD_ACCENT, HUD_FG, HUD_MONO, HUD_SANS } from "./HUD";

/**
 * HUD minimap (top-left) and the full-screen tactical map. Both draw the
 * map overview rasterised from the level data (world/overview), plus live
 * markers: you, your squad / co-op teammates, armories and ammo, and, when
 * radar is on, hostiles and the direction of incoming squads.
 */

export type MapBlipKind = "ally" | "downed" | "enemy" | "elite" | "boss" | "heli";
export type MapBlip = { x: number; z: number; kind: MapBlipKind; yaw?: number; label?: string };
export type MapIncoming = { x: number; z: number; eta: number; label: string; heavy: boolean };

export type MinimapFrame = {
  x: number;
  z: number;
  /** Player yaw (forward = (−sin yaw, −cos yaw)). */
  yaw: number;
  blips: readonly MapBlip[];
  incoming: readonly MapIncoming[];
  radar: boolean;
  /** Armories open (between waves). */
  shopOnline: boolean;
  /** Full-map header, e.g. "WAVE 3 · 12 HOSTILES". */
  status: string;
};

/** Player preferences the engine keeps current (settings menu). */
export const mapPrefs = { rotate: true, radarAssist: false };
/** Read by the touch layer: show the tap-to-open map button over the minimap. */
export const minimapSignal = { on: false };

const MINI_CSS = `
.ih-minimap{position:absolute;left:20px;top:18px;width:184px;height:184px;pointer-events:none}
.ih-minimap canvas{position:absolute;inset:0;width:100%;height:100%}
.ih-minimap .ih-mm-tag{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%);display:flex;gap:8px;white-space:nowrap;font:700 9px/1 ${HUD_SANS};letter-spacing:.2em;opacity:.8}
.ih-minimap .ih-mm-radar{color:#ff7a5a}
.ih-touch .ih-minimap{left:calc(10px + var(--ih-l,0px));top:calc(8px + var(--ih-t,0px));width:100px;height:100px}
.ih-touch .ih-minimap .ih-mm-tag{display:none}
.ih-fullmap{position:absolute;inset:0;z-index:60;display:none;background:rgba(6,8,7,.94);color:${HUD_FG};font-family:${HUD_SANS};touch-action:none;user-select:none;-webkit-user-select:none}
.ih-fullmap.on{display:block}
.ih-fullmap canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
.ih-fullmap canvas.drag{cursor:grabbing}
.ih-fm-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:calc(14px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) 0 calc(18px + env(safe-area-inset-left,0px));pointer-events:none}
.ih-fm-title{font-size:20px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.ih-fm-status{margin-top:4px;font-size:11px;font-weight:600;letter-spacing:.2em;opacity:.78}
.ih-fm-btns{display:flex;flex-direction:column;gap:8px;pointer-events:auto}
.ih-fullmap button{width:44px;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(16,18,16,.82);color:${HUD_FG};font:700 18px/1 ${HUD_MONO};display:flex;align-items:center;justify-content:center;cursor:pointer}
.ih-fullmap button:hover{border-color:${HUD_ACCENT}}
.ih-fullmap button:active{transform:scale(.95)}
.ih-fm-close{font-size:13px!important;letter-spacing:.12em;width:auto!important;padding:0 14px}
.ih-fm-legend{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;gap:6px 16px;max-width:min(560px,70vw);font-size:10px;font-weight:600;letter-spacing:.16em;opacity:.85;pointer-events:none}
.ih-fm-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.ih-fm-hint{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));font-size:10px;letter-spacing:.16em;opacity:.55;pointer-events:none;text-align:right}
@media (max-height:480px){.ih-fm-title{font-size:15px}.ih-fullmap button{width:38px;height:38px}.ih-fm-legend{display:none}}
`;

const COL = {
  you: "#86c7ff",
  ally: "#86c7ff",
  downed: "#ffb46a",
  enemy: "#ff4a3a",
  elite: "#ff8a2a",
  boss: "#ff2a6a",
  heli: "#ffb46a",
  incoming: "#ffb03a",
  station: "#ffc845",
  crate: "#9be070",
};

type View = { cx: number; cz: number; zoom: number };

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly radarTag: HTMLSpanElement;
  private readonly style: HTMLStyleElement;
  private readonly map: HTMLCanvasElement;
  private readonly bounds: Bounds;
  private readonly full: HTMLDivElement;
  private readonly fullCanvas: HTMLCanvasElement;
  private readonly fg: CanvasRenderingContext2D;
  private readonly fullStatus: HTMLDivElement;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private view: View = { cx: 0, cz: 0, zoom: 1 };
  private viewFit = 1;
  private pinch = 0;
  private last: MinimapFrame | null = null;
  private time = 0;
  private dpr = 1;
  private size = 0;
  private lRadar = false;
  private lStatus = "";
  /** Smoothed heading for the rotating minimap (no snapping on yaw wrap). */
  private yawS = 0;
  isOpen = false;

  /** `onToggle(open)`: the mode releases / re-captures the pointer. */
  constructor(
    container: HTMLElement,
    private readonly def: MapDef,
    private readonly onToggle: (open: boolean, via?: "pad") => void,
  ) {
    minimapSignal.on = true;
    this.style = document.createElement("style");
    this.style.textContent = MINI_CSS;
    container.appendChild(this.style);
    const { canvas: map, img } = overviewCanvas(def, 6);
    this.map = map;
    this.bounds = img.bounds;

    this.root = document.createElement("div");
    this.root.className = "ih-minimap";
    this.canvas = document.createElement("canvas");
    this.g = this.canvas.getContext("2d")!;
    const tag = document.createElement("div");
    tag.className = "ih-mm-tag";
    this.radarTag = document.createElement("span");
    this.radarTag.className = "ih-mm-radar";
    this.radarTag.textContent = "RADAR";
    this.radarTag.style.display = "none";
    const key = document.createElement("span");
    key.className = "ih-mm-key";
    key.textContent = "[M] MAP";
    tag.append(this.radarTag, key);
    this.root.append(this.canvas, tag);
    // Survival HUD's top-left panel sits under the map (see TOUCH_HUD_STYLE for touch).
    (container.querySelector(".ih-hud") ?? container).appendChild(this.root);

    // ---- Full-screen map ----
    this.full = document.createElement("div");
    this.full.className = "ih-fullmap";
    this.full.setAttribute("role", "dialog");
    this.full.setAttribute("aria-label", `${def.name} map`);
    this.fullCanvas = document.createElement("canvas");
    this.fg = this.fullCanvas.getContext("2d")!;
    const top = document.createElement("div");
    top.className = "ih-fm-top";
    const head = document.createElement("div");
    const title = document.createElement("div");
    title.className = "ih-fm-title";
    title.textContent = def.name;
    this.fullStatus = document.createElement("div");
    this.fullStatus.className = "ih-fm-status";
    head.append(title, this.fullStatus);
    const btns = document.createElement("div");
    btns.className = "ih-fm-btns";
    const button = (label: string, aria: string, fn: () => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      if (cls) b.className = cls;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      btns.appendChild(b);
      return b;
    };
    button("CLOSE ✕", "Close map", () => this.close(), "ih-fm-close");
    button("+", "Zoom in", () => this.zoomBy(1.4));
    button("−", "Zoom out", () => this.zoomBy(1 / 1.4));
    button("◎", "Centre on me", () => this.recenter());
    top.append(head, btns);
    const legend = document.createElement("div");
    legend.className = "ih-fm-legend";
    const item = (c: string, t: string) => `<span><i style="background:${c}"></i>${t}</span>`;
    legend.innerHTML =
      item(COL.you, "YOU") + item(COL.ally, "SQUAD") + item(COL.enemy, "HOSTILE (RADAR)") + item(COL.incoming, "INCOMING") + item(COL.station, "ARMORY") + item(COL.crate, "AMMO");
    const hint = document.createElement("div");
    hint.className = "ih-fm-hint";
    hint.innerHTML = "DRAG TO PAN · SCROLL / PINCH TO ZOOM<br>[M] OR [ESC] TO CLOSE";
    this.full.append(this.fullCanvas, top, legend, hint);
    container.appendChild(this.full);

    const c = this.fullCanvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("dblclick", (e) => this.zoomAt(e.offsetX, e.offsetY, 1.6));
    this.full.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------------------

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.padPrev = 0xff;
    this.full.classList.add("on");
    window.addEventListener("keydown", this.onKey, true);
    this.fitView();
    if (this.last) this.view = { cx: this.last.x, cz: this.last.z, zoom: this.viewFit };
    this.onToggle(true);
  }

  /** `notify = false`: close without telling the mode (match over, disposal). */
  close(notify = true, via?: "pad") {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.full.classList.remove("on");
    window.removeEventListener("keydown", this.onKey, true);
    this.pointers.clear();
    if (notify) this.onToggle(false, via);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  frame(f: MinimapFrame, dt: number) {
    this.last = f;
    if (this.isOpen) this.pollPad(dt);
    this.time += dt;
    if (f.radar !== this.lRadar) {
      this.lRadar = f.radar;
      this.radarTag.style.display = f.radar ? "inline" : "none";
    }
    this.drawMini(f, dt);
    if (this.isOpen) {
      if (f.status !== this.lStatus) this.fullStatus.textContent = this.lStatus = f.status;
      this.drawFull(f);
    }
  }

  dispose() {
    this.close(false);
    minimapSignal.on = false;
    this.root.remove();
    this.full.remove();
    this.style.remove();
  }

  // ---- Minimap ---------------------------------------------------------------

  private fitCanvas(c: HTMLCanvasElement, w: number, h: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    return dpr;
  }

  private drawMini(f: MinimapFrame, dt: number) {
    const size = this.root.clientWidth || 184;
    if (size !== this.size) this.size = size;
    this.dpr = this.fitCanvas(this.canvas, size, size);
    const g = this.g;
    const S = size * this.dpr;
    const r = S / 2;
    // ~42 m view radius on desktop; a touch more zoomed-out on the small touch map.
    const range = size < 140 ? 48 : 42;
    const k = (r - 4 * this.dpr) / range;

    // Ease the heading so the rotating map glides (shortest way round).
    let d = f.yaw - this.yawS;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yawS += d * Math.min(1, dt * 18 || 1);
    const rot = mapPrefs.rotate ? this.yawS : 0;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 1.5 * this.dpr, 0, Math.PI * 2);
    g.fillStyle = "rgba(8,10,9,.82)";
    g.fill();
    g.clip();

    g.translate(r, r);
    g.rotate(rot);
    g.scale(k, k);
    g.translate(-f.x, -f.z);
    this.drawWorld(g, f, k, range * 1.5);
    g.restore();

    // Off-map allies / incoming squads pinned to the rim.
    g.save();
    g.translate(r, r);
    const rim = r - 7 * this.dpr;
    for (const b of f.blips) {
      if (b.kind !== "ally" && b.kind !== "downed") continue;
      const [sx, sy] = this.project(b.x - f.x, b.z - f.z, rot, k);
      if (Math.hypot(sx, sy) <= rim) continue;
      const a = Math.atan2(sy, sx);
      this.dot(g, Math.cos(a) * rim, Math.sin(a) * rim, 3.2 * this.dpr, b.kind === "downed" ? COL.downed : COL.ally, 0.9);
    }
    if (f.radar) {
      for (const inc of f.incoming) {
        const [sx, sy] = this.project(inc.x - f.x, inc.z - f.z, rot, k);
        const a = Math.atan2(sy, sx);
        if (Math.hypot(sx, sy) <= rim - 6 * this.dpr) continue;
        this.chevron(g, Math.cos(a) * (rim - 2 * this.dpr), Math.sin(a) * (rim - 2 * this.dpr), a, 7 * this.dpr, inc.heavy ? COL.boss : COL.incoming, 0.55 + 0.45 * Math.abs(Math.sin(this.time * 5)));
      }
    }
    // North marker on the rim when the map turns.
    if (mapPrefs.rotate) {
      const [nx, ny] = this.project(0, -1, rot, 1);
      const nl = Math.hypot(nx, ny) || 1;
      const px = (nx / nl) * (r - 9 * this.dpr), py = (ny / nl) * (r - 9 * this.dpr);
      g.font = `700 ${10 * this.dpr}px ${HUD_SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(0,0,0,.6)";
      g.beginPath();
      g.arc(px, py, 7 * this.dpr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = HUD_ACCENT;
      g.fillText("N", px, py + 0.5 * this.dpr);
    }
    // You: always at the centre.
    this.arrow(g, 0, 0, mapPrefs.rotate ? 0 : -f.yaw, 7 * this.dpr, COL.you);
    g.restore();

    // Ring.
    g.beginPath();
    g.arc(r, r, r - 1.5 * this.dpr, 0, Math.PI * 2);
    g.lineWidth = 1.5 * this.dpr;
    g.strokeStyle = f.radar ? "rgba(255,122,90,.55)" : "rgba(238,240,234,.35)";
    g.stroke();
    if (f.radar) {
      // Radar sweep.
      const a = (this.time * 1.6) % (Math.PI * 2);
      const grad = g.createConicGradient?.(a - 0.6, r, r);
      if (grad) {
        grad.addColorStop(0, "rgba(255,90,60,0)");
        grad.addColorStop(0.09, "rgba(255,90,60,.16)");
        grad.addColorStop(0.1, "rgba(255,90,60,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(r, r, r - 2 * this.dpr, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** World offset → minimap screen offset (rotation `rot`, scale k). */
  private project(dx: number, dz: number, rot: number, k: number): [number, number] {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [(dx * c - dz * s) * k, (dx * s + dz * c) * k];
  }

  /**
   * Draws the map image and markers in world units (the caller has set up
   * world → screen). `k` = screen px per metre; `rot` = map rotation so
   * icons can stay upright.
   */
  private drawWorld(g: CanvasRenderingContext2D, f: MinimapFrame, k: number, cull: number) {
    const b = this.bounds;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 0.95;
    g.drawImage(this.map, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    g.globalAlpha = 1;
    const px = 1 / k; // one screen pixel in metres
    const dpr = this.dpr;
    const near = (x: number, z: number) => Math.abs(x - f.x) < cull && Math.abs(z - f.z) < cull;

    // Compound boundary.
    const s = this.def.survival;
    if (s && s.inner < 200) {
      g.setLineDash([4 * px * dpr, 4 * px * dpr]);
      g.strokeStyle = "rgba(240,180,74,.35)";
      g.lineWidth = 1.2 * px * dpr;
      g.strokeRect(-s.inner, -s.inner, s.inner * 2, s.inner * 2);
      g.setLineDash([]);
    }
    if (s) {
      for (const st of s.buyStations) if (near(st.x, st.z)) this.icon(g, st.x, st.z, "$", f.shopOnline ? COL.station : "rgba(255,200,69,.45)");
      for (const c of s.ammoCrates) if (near(c.x, c.z)) this.square(g, c.x, c.z, 3.2 * px * dpr, COL.crate);
    }

    // Incoming squads: pulsing rings where they will appear.
    if (f.radar) {
      for (const inc of f.incoming) {
        if (!near(inc.x, inc.z)) continue;
        const pulse = (this.time * 1.4) % 1;
        g.beginPath();
        g.arc(inc.x, inc.z, (4 + pulse * 7) * px * dpr * 1.6, 0, Math.PI * 2);
        g.strokeStyle = inc.heavy ? COL.boss : COL.incoming;
        g.globalAlpha = 1 - pulse;
        g.lineWidth = 1.6 * px * dpr;
        g.stroke();
        g.globalAlpha = 1;
        this.dot(g, inc.x, inc.z, 3 * px * dpr, inc.heavy ? COL.boss : COL.incoming, 0.9);
      }
    }

    for (const bl of f.blips) {
      if (!near(bl.x, bl.z)) continue;
      const col = COL[bl.kind];
      const r = (bl.kind === "boss" ? 4.6 : bl.kind === "heli" ? 4.2 : bl.kind === "ally" || bl.kind === "downed" ? 3.6 : 3) * px * dpr;
      if (bl.kind === "ally" && bl.yaw !== undefined) this.arrow(g, bl.x, bl.z, -bl.yaw, 5.5 * px * dpr, col);
      else if (bl.kind === "heli") this.diamond(g, bl.x, bl.z, r, col);
      else this.dot(g, bl.x, bl.z, r, col, 1);
    }
  }

  private dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, a: number) {
    g.globalAlpha = a;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = c;
    g.fill();
    g.lineWidth = r * 0.35;
    g.strokeStyle = "rgba(0,0,0,.65)";
    g.stroke();
    g.globalAlpha = 1;
  }

  private square(g: CanvasRenderingContext2D, x: number, y: number, h: number, c: string) {
    g.fillStyle = c;
    g.fillRect(x - h, y - h, h * 2, h * 2);
    g.strokeStyle = "rgba(0,0,0,.6)";
    g.lineWidth = h * 0.35;
    g.strokeRect(x - h, y - h, h * 2, h * 2);
  }

  private diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = c;
    g.fill();
  }

  /** Upright text icon at a world point. */
  private icon(g: CanvasRenderingContext2D, x: number, y: number, t: string, c: string) {
    // Drawn in screen space: Chrome rasterises tiny fonts under a big scale at a minimum size.
    const p = g.getTransform().transformPoint(new DOMPoint(x, y));
    g.save();
    g.setTransform(1, 0, 0, 1, p.x, p.y);
    const s = this.dpr;
    g.beginPath();
    g.arc(0, 0, 6 * s, 0, Math.PI * 2);
    g.fillStyle = "rgba(10,12,10,.8)";
    g.fill();
    g.lineWidth = 1.2 * s;
    g.strokeStyle = c;
    g.stroke();
    g.fillStyle = c;
    g.font = `800 ${8 * s}px ${HUD_SANS}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(t, 0, 0.5 * s);
    g.restore();
  }

  /** Arrow pointing along screen angle `a` (0 = up). */
  private arrow(g: CanvasRenderingContext2D, x: number, y: number, a: number, s: number, c: string) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.72, s * 0.78);
    g.lineTo(0, s * 0.38);
    g.lineTo(-s * 0.72, s * 0.78);
    g.closePath();
    g.fillStyle = c;
    g.fill();
    g.lineWidth = s * 0.22;
    g.strokeStyle = "rgba(0,0,0,.7)";
    g.stroke();
    g.restore();
  }

  /** Chevron at (x, y) pointing outwards along angle `a` (radians, screen). */
  private chevron(g: CanvasRenderingContext2D, x: number, y: number, a: number, s: number, c: string, alpha: number) {
    g.save();
    g.translate(x, y);
    g.rotate(a + Math.PI / 2);
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s, s * 0.5);
    g.lineTo(0, 0);
    g.lineTo(-s, s * 0.5);
    g.closePath();
    g.fillStyle = c;
    g.fill();
    g.restore();
  }

  // ---- Full map ----------------------------------------------------------------

  private fitView() {
    const w = this.full.clientWidth || window.innerWidth, h = this.full.clientHeight || window.innerHeight;
    const b = this.bounds;
    this.viewFit = Math.min((w - 40) / (b.maxX - b.minX), (h - 120) / (b.maxZ - b.minZ));
    this.view = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, zoom: this.viewFit };
  }

  private clampView() {
    const v = this.view;
    v.zoom = Math.min(this.viewFit * 8, Math.max(this.viewFit * 0.8, v.zoom));
    const b = this.bounds;
    v.cx = Math.min(b.maxX, Math.max(b.minX, v.cx));
    v.cz = Math.min(b.maxZ, Math.max(b.minZ, v.cz));
  }

  private zoomBy(f: number) {
    this.view.zoom *= f;
    this.clampView();
  }

  private zoomAt(sx: number, sy: number, f: number) {
    const w = this.fullCanvas.clientWidth, h = this.fullCanvas.clientHeight;
    const v = this.view;
    // Keep the world point under the cursor fixed.
    const wx = v.cx + (sx - w / 2) / v.zoom, wz = v.cz + (sy - h / 2) / v.zoom;
    v.zoom *= f;
    this.clampView();
    v.cx = wx - (sx - w / 2) / v.zoom;
    v.cz = wz - (sy - h / 2) / v.zoom;
    this.clampView();
  }

  private recenter() {
    if (!this.last) return;
    this.view.cx = this.last.x;
    this.view.cz = this.last.z;
    this.view.zoom = Math.max(this.view.zoom, this.viewFit * 2.2);
    this.clampView();
  }

  private drawFull(f: MinimapFrame) {
    const w = this.full.clientWidth, h = this.full.clientHeight;
    if (!w || !h) return;
    const dpr = this.fitCanvas(this.fullCanvas, w, h);
    this.dpr = dpr;
    const g = this.fg;
    const v = this.view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w * dpr, h * dpr);
    g.save();
    const k = v.zoom * dpr;
    g.translate((w / 2) * dpr, (h / 2) * dpr);
    g.scale(k, k);
    g.translate(-v.cx, -v.cz);
    // Border around the mapped area.
    const b = this.bounds;
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = 18 * dpr;
    g.fillStyle = "#000";
    g.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    g.shadowBlur = 0;
    this.drawWorld(g, f, k, 1e6);
    // Grid every 10 m, labelled every 50 m.
    g.strokeStyle = "rgba(255,255,255,.05)";
    g.lineWidth = 1 / v.zoom;
    g.beginPath();
    for (let x = Math.ceil(b.minX / 10) * 10; x <= b.maxX; x += 10) {
      g.moveTo(x, b.minZ);
      g.lineTo(x, b.maxZ);
    }
    for (let z = Math.ceil(b.minZ / 10) * 10; z <= b.maxZ; z += 10) {
      g.moveTo(b.minX, z);
      g.lineTo(b.maxX, z);
    }
    g.stroke();
    // You, with a view cone.
    g.save();
    g.translate(f.x, f.z);
    g.rotate(-f.yaw);
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 26);
    cone.addColorStop(0, "rgba(134,199,255,.35)");
    cone.addColorStop(1, "rgba(134,199,255,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 26, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    g.closePath();
    g.fill();
    g.restore();
    this.arrow(g, f.x, f.z, -f.yaw, (9 * dpr) / k, COL.you);
    // Labels in screen space (see icon()).
    const m = g.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = `700 ${10 * dpr}px ${HUD_SANS}`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    for (const bl of f.blips) {
      if (!bl.label || (bl.kind !== "ally" && bl.kind !== "downed")) continue;
      const p = m.transformPoint(new DOMPoint(bl.x, bl.z));
      g.fillStyle = "rgba(0,0,0,.7)";
      g.fillText(bl.label.toUpperCase(), p.x + dpr, p.y - 8 * dpr + dpr);
      g.fillStyle = bl.kind === "downed" ? COL.downed : COL.ally;
      g.fillText(bl.label.toUpperCase(), p.x, p.y - 8 * dpr);
    }
    // Incoming labels.
    if (f.radar) {
      g.textBaseline = "top";
      for (const inc of f.incoming) {
        const t = `${inc.label}${inc.eta > 0.5 ? ` · ${Math.ceil(inc.eta)}s` : ""}`;
        const p = m.transformPoint(new DOMPoint(inc.x, inc.z));
        g.fillStyle = inc.heavy ? COL.boss : COL.incoming;
        g.fillText(t, p.x, p.y + 10 * dpr);
      }
    }
    g.restore();
  }

  private padPrev = 0;
  /** Gamepad on the open map: left stick pans, triggers zoom, View / B close. */
  private pollPad(dt: number) {
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    const gp = pads ? Array.from(pads).find((p) => p?.connected) : null;
    if (!gp) return;
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const mask = (btn(8) ? 1 : 0) | (btn(1) ? 2 : 0);
    const edge = mask & ~this.padPrev;
    this.padPrev = mask;
    if (edge) {
      this.close(true, "pad");
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const v = this.view;
    v.cx += (dz(gp.axes[0] ?? 0) * 320 * dt) / v.zoom;
    v.cz += (dz(gp.axes[1] ?? 0) * 320 * dt) / v.zoom;
    const zoom = (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0);
    if (zoom) v.zoom *= Math.exp(zoom * dt * 2);
    this.clampView();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "KeyM" || e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.close();
    }
  };

  private onDown = (e: PointerEvent) => {
    this.fullCanvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.fullCanvas.classList.add("drag");
    if (this.pointers.size === 2) this.pinch = this.pinchDist();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const v = this.view;
    if (this.pointers.size === 1) {
      v.cx -= (e.offsetX - p.x) / v.zoom;
      v.cz -= (e.offsetY - p.y) / v.zoom;
      p.x = e.offsetX;
      p.y = e.offsetY;
      this.clampView();
      return;
    }
    p.x = e.offsetX;
    p.y = e.offsetY;
    const d = this.pinchDist();
    if (this.pinch > 0 && d > 0) {
      const pts = [...this.pointers.values()];
      this.zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / this.pinch);
    }
    this.pinch = d;
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (!this.pointers.size) this.fullCanvas.classList.remove("drag");
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
  };

  private pinchDist() {
    const pts = [...this.pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
