import type { WeaponStats } from "../weapons/WeaponSystem";
import { actionGlyph, glyphContext } from "./Glyphs";
import { TOUCH_HUD_STYLE } from "../mobile/hudStyle";

export type HitKind = "body" | "head" | "kill" | "headkill";

export type HudFrame = {
  spreadDeg: number;
  fovDeg: number;
  viewportH: number;
  /** 0..1, crosshair fades as this rises (ADS / sprint). */
  crosshairHide: number;
  ammo: number;
  reserve: number;
  magSize: number;
  weaponName: string;
  weaponKind: string;
  slot: number;
  /** Carried weapons (only `def.name` is read; diffed per index). */
  slots: readonly { def: { name: string } }[];
  reload: number;
  health: number;
  maxHealth: number;
  armor: number;
  /** Grenades carried, or -1 to hide. */
  grenades: number;
  /** M84 / M18 carried (optional: hidden when undefined). */
  flashbangs?: number;
  smokes?: number;
  /** Frag cook 0..1 of the fuse while held, else -1. */
  cook?: number;
  /** Fire-mode label ("AUTO", "3-RND", "SEMI"), "" for single-mode guns. */
  fireMode?: string;
  /** Flashbang white-out 0..1. */
  flash?: number;
  /** Reticle style for the scope overlay. */
  optic?: "mildot" | "pso" | "g36" | "aug";
  /** 0..1 scope overlay (scoped weapon ADS). */
  scope: number;
  /** Player yaw (rad): compass + damage indicators. */
  yaw: number;
};

export type DebugInfo = Record<string, string | number>;

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement, cls = "") => {
  const e = css(document.createElement("div"), s);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

export const HUD_FG = "#eef0ea";
export const HUD_ACCENT = "#f0b44a";
export const HUD_RED = "#ff4b3a";
export const HUD_GOLD = "#ffc845";
export const HUD_SANS = "var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif";
export const HUD_MONO = "var(--font-geist-mono),ui-monospace,monospace";

/** Shared HUD stylesheet (injected once per HUD root). */
const STYLE = `
.ih-hud{color:${HUD_FG};font-family:${HUD_SANS};text-shadow:0 1px 2px rgba(0,0,0,.55);-webkit-font-smoothing:antialiased}
.ih-hud .ih-num{font-family:${HUD_MONO};font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ih-hud .ih-cap{font-size:10px;font-weight:600;letter-spacing:.24em;text-transform:uppercase}
.ih-hud .ih-panel{background:linear-gradient(90deg,rgba(8,10,8,0),rgba(8,10,8,.42) 30%,rgba(8,10,8,.42) 70%,rgba(8,10,8,0))}
${TOUCH_HUD_STYLE}`;

const PPD = 3.4; // compass pixels per degree
const COMPASS_W = 340;

function buildCompassSvg() {
  // Strip from −180° to 540° so any heading has a full window either side.
  const from = -180, to = 540;
  const w = (to - from) * PPD;
  let s = `<svg width="${w}" height="26" viewBox="0 0 ${w} 26" style="position:absolute;left:0;top:0" aria-hidden="true">`;
  const names: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  for (let d = from; d <= to; d += 5) {
    const x = (d - from) * PPD;
    const n = ((d % 360) + 360) % 360;
    if (names[n] !== undefined) {
      const card = n % 90 === 0;
      s += `<text x="${x}" y="13" text-anchor="middle" font-size="${card ? 13 : 10}" font-weight="${card ? 700 : 600}" font-family="${HUD_SANS}" fill="${n === 0 ? HUD_ACCENT : HUD_FG}" opacity="${card ? 1 : 0.8}">${names[n]}</text>`;
      s += `<rect x="${x - 0.75}" y="17" width="1.5" height="7" fill="${HUD_FG}"/>`;
    } else if (n % 15 === 0) {
      s += `<text x="${x}" y="12" text-anchor="middle" font-size="9" font-family="${HUD_MONO}" fill="${HUD_FG}" opacity=".55">${n}</text>`;
      s += `<rect x="${x - 0.5}" y="18" width="1" height="5" fill="${HUD_FG}" opacity=".7"/>`;
    } else {
      s += `<rect x="${x - 0.5}" y="20" width="1" height="3" fill="${HUD_FG}" opacity=".4"/>`;
    }
  }
  return s + "</svg>";
}

const FLASH_SVG =
  '<svg width="9" height="15" viewBox="0 0 9 15" style="vertical-align:-2px" aria-hidden="true"><rect x=".8" y="3.4" width="7.4" height="11" rx="1.2" fill="currentColor"/><rect x="2.6" y=".8" width="3.8" height="2.6" rx=".5" fill="currentColor"/><g fill="rgba(0,0,0,.5)"><circle cx="3" cy="6.4" r=".9"/><circle cx="6" cy="6.4" r=".9"/><circle cx="3" cy="9.4" r=".9"/><circle cx="6" cy="9.4" r=".9"/><circle cx="3" cy="12.2" r=".9"/><circle cx="6" cy="12.2" r=".9"/></g></svg>';
const SMOKE_SVG =
  '<svg width="11" height="15" viewBox="0 0 11 15" style="vertical-align:-2px" aria-hidden="true"><rect x=".8" y="3.6" width="9.4" height="10.8" rx="1.4" fill="currentColor"/><rect x="3.6" y=".8" width="3.8" height="2.8" rx=".5" fill="currentColor"/><rect x=".8" y="3.6" width="9.4" height="2" fill="#d0503a"/></svg>';

/** Scope reticles (black surround + per-optic marks), drawn in vmin around the centre. */
function scopeHtml(optic: string) {
  const glass = '<div style="position:absolute;inset:0;background:radial-gradient(circle at center,rgba(20,40,60,.07) 0,rgba(20,40,60,.1) 31vmin,rgba(0,0,0,.6) 32.6vmin,#000 33.4vmin)"></div>';
  const at = (x: string, y: string, w: string, h: string, extra = "") => `<div style="position:absolute;left:calc(50% + ${x});top:calc(50% + ${y});width:${w};height:${h};${extra}"></div>`;
  const ink = "background:rgba(0,0,0,.88)";
  if (optic === "pso") {
    // PSO-1: illuminated chevrons, horizontal windage scale, stadia rangefinder curve.
    const glow = "border-color:#ff5a2a;filter:drop-shadow(0 0 2px #ff5a2a)";
    let h = glass;
    for (const [y, sz] of [[0, 2.2], [4.5, 1.6], [7.5, 1.6], [10.5, 1.6]] as const)
      h += `<div style="position:absolute;left:50%;top:calc(50% + ${y}vmin);width:${sz}vmin;height:${sz}vmin;transform:translate(-50%,0) rotate(45deg);border-left:2px solid;border-top:2px solid;${glow}"></div>`;
    h += at("-14vmin", "0px", "11vmin", "1px", ink) + at("3vmin", "0px", "11vmin", "1px", ink);
    for (let i = 1; i <= 10; i++) for (const sx of [-1, 1]) h += at(`${sx * (i * 1.4) - 0.1}vmin`, `${i % 5 === 0 ? -1.4 : -0.8}vmin`, "1px", `${i % 5 === 0 ? 1.4 : 0.8}vmin`, ink);
    h += `<svg style="position:absolute;left:calc(50% - 22vmin);top:calc(50% + 4vmin);width:14vmin;height:10vmin" viewBox="0 0 140 100"><path d="M2 8 L138 8 M10 90 C40 70 90 30 138 18" stroke="rgba(0,0,0,.85)" stroke-width="1.4" fill="none"/><text x="2" y="98" font-size="11" fill="rgba(0,0,0,.85)">2</text><text x="128" y="34" font-size="11" fill="rgba(0,0,0,.85)">10</text></svg>`;
    return h;
  }
  if (optic === "g36") {
    // G36 3.5× carry-handle optic: red ring + range ticks below.
    let h = glass + '<div style="position:absolute;left:50%;top:50%;width:5vmin;height:5vmin;margin:-2.5vmin;border:2px solid #e83a2a;border-radius:50%;box-shadow:0 0 5px #e83a2a"></div>';
    h += at("-0.5px", "2.6vmin", "1px", "14vmin", ink);
    for (let i = 1; i <= 4; i++) h += at(`${-(4 - i * 0.6)}vmin`, `${2.6 + i * 3}vmin`, `${(4 - i * 0.6) * 2}vmin`, "1px", ink);
    return h;
  }
  if (optic === "aug") {
    // AUG 1.5× Swarovski: a black ring with a centre dot.
    return glass + '<div style="position:absolute;left:50%;top:50%;width:9vmin;height:9vmin;margin:-4.5vmin;border:2.5px solid rgba(0,0,0,.88);border-radius:50%"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;border-radius:50%;background:rgba(0,0,0,.88)"></div>';
  }
  // Mil-dot: thin crosshair, heavy outer posts, dots every mil.
  let h = glass + at("-0.5px", "-33vmin", "1px", "66vmin", ink) + at("-33vmin", "-0.5px", "66vmin", "1px", ink);
  for (const [x, y, w, hh] of [["-33vmin", "-2px", "17vmin", "4px"], ["16vmin", "-2px", "17vmin", "4px"], ["-2px", "16vmin", "4px", "17vmin"], ["-2px", "-33vmin", "4px", "17vmin"]]) h += at(x, y, w, hh, ink);
  for (let i = 1; i <= 4; i++) for (const sx of [-1, 1]) {
    h += at(`calc(${sx * i * 3.4}vmin - 2.5px)`, "-2.5px", "5px", "5px", ink + ";border-radius:50%");
    h += at("-2.5px", `calc(${sx * i * 3.4}vmin - 2.5px)`, "5px", "5px", ink + ";border-radius:50%");
  }
  return h;
}

const GRENADE_SVG =
  '<svg width="12" height="15" viewBox="0 0 12 15" style="vertical-align:-2px" aria-hidden="true"><ellipse cx="6" cy="9" rx="5" ry="5.6" fill="currentColor"/><rect x="4" y="1.6" width="4" height="2.6" rx=".6" fill="currentColor"/><path d="M8 2.4q3 .2 3 3.6" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M2.6 9h6.8" stroke="rgba(0,0,0,.45)" stroke-width="1"/></svg>';

/**
 * In-game HUD in plain DOM (cheaper than React at 60+ fps). Every setter
 * diff-checks primitives before touching the DOM, so idle frames do no style
 * or layout work and allocate nothing; transient effects (feed, popups) use
 * the Web Animations API so nothing is ever read back from the DOM.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly hairs: HTMLDivElement[] = [];
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly hitKill: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly reserve: HTMLDivElement;
  private readonly magFill: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly slots: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly reloadBar: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly healthWrap: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthChip: HTMLDivElement;
  private readonly healthText: HTMLDivElement;
  private readonly armorFill: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly medal: HTMLDivElement;
  private readonly scoreboard: HTMLDivElement;
  private readonly debug: HTMLPreElement;
  private readonly fps: HTMLDivElement;
  private readonly grenadeEl: HTMLDivElement;
  private readonly scopeEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly cookEl: HTMLDivElement;
  private readonly cookFill: HTMLDivElement;
  private lOptic = "mildot";
  private lWhite = -1;
  private lCook = -2;
  private readonly hurtEl: HTMLDivElement;
  private readonly lowHpEl: HTMLDivElement;
  private readonly vignetteEl: HTMLDivElement;
  private readonly compassStrip: HTMLDivElement;
  private readonly compassDeg: HTMLDivElement;
  private readonly indicators: { el: HTMLDivElement; t: number; bearing: number; shown: number }[] = [];
  private readonly feedItems: { el: HTMLDivElement; t: number; fading: boolean }[] = [];
  /** Scoreboard title (mode name). */
  modeLabel = "FIRING RANGE";
  debugVisible = false;
  /** Haptics hook (wired by the engine). */
  onHurt?: (amount: number) => void;

  private hurtLevel = 0;
  private hitTimer = 0;
  private hitIsKill = false;
  private crossFlash = 0;
  private yaw = 0;

  // Last-written values (primitives only: diffing allocates nothing).
  private lPx = -1;
  private lOpacity = -1;
  private lFlash = false;
  private lScoped = false;
  private lAmmo = -1;
  private lMag = -1;
  private lReserve = -1;
  private lWeapon = "";
  private lSlot = -1;
  private readonly lSlotNames: string[] = [];
  private lStatus = "";
  private lGlyphVer = -1;
  private lReload = -2;
  private lHp = -1;
  private lMaxHp = -1;
  private lArmor = -1;
  private lLowHp = -1;
  private lHurt = -1;
  private lGrenades = -2;
  private lHeadingQ = -99999;
  private lHeadingDeg = -1;
  private lBoardVisible = false;
  private readonly lBoard = [-1, -1, -1, -1];
  private lFps = -1;
  private fpsVisible = true;

  constructor(container: HTMLElement) {
    this.root = div("position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden;", container, "ih-hud");
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.root.appendChild(style);

    // Edge vignette for presets without post-processing (the grade pass draws its own) + damage edges.
    this.vignetteEl = div("position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 58%,rgba(0,0,0,.32) 100%);", this.root);
    this.lowHpEl = div("position:absolute;inset:0;opacity:0;transition:opacity 260ms ease-out;background:radial-gradient(ellipse 75% 70% at center,transparent 52%,rgba(110,6,4,.42) 82%,rgba(70,0,0,.72) 100%);", this.root);
    this.hurtEl = div("position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 80% 75% at center,transparent 60%,rgba(190,24,12,.5) 100%);", this.root);

    // Scope: black surround, thin reticle, slight lens tint.
    this.scopeEl = div("position:absolute;inset:0;opacity:0;display:none;", this.root);
    this.scopeEl.innerHTML = scopeHtml("mildot");
    // Flashbang white-out (over everything but the menus).
    this.flashEl = div("position:absolute;inset:0;opacity:0;background:#fffdf4;pointer-events:none;", this.root);

    // ---- Crosshair ----------------------------------------------------------
    this.crosshair = div(`position:absolute;left:50%;top:50%;width:0;height:0;color:${HUD_FG};transition:opacity 90ms linear;`, this.root);
    for (let i = 0; i < 4; i++) {
      const v = i < 2;
      this.hairs.push(div(`position:absolute;background:currentColor;box-shadow:0 0 0 1px rgba(0,0,0,.4);${v ? "width:2px;height:9px;left:-1px;" : "width:9px;height:2px;top:-1px;"}`, this.crosshair));
    }
    div("position:absolute;width:2px;height:2px;left:-1px;top:-1px;background:currentColor;box-shadow:0 0 0 1px rgba(0,0,0,.4);", this.crosshair);

    // Hit markers: regular (4 short strokes) and kill (longer, heavier, red).
    this.hitmarker = div("position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;opacity:0;", this.root);
    this.hitmarker.innerHTML =
      '<svg viewBox="0 0 30 30" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" style="filter:drop-shadow(0 0 1px rgba(0,0,0,.9))"><path d="M5 5l6 6M25 5l-6 6M5 25l6-6M25 25l-6-6"/></svg>';
    this.hitKill = div(`position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;opacity:0;color:${HUD_RED};`, this.root);
    this.hitKill.innerHTML =
      '<svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.9))"><path d="M5 5l9.5 9.5M35 5l-9.5 9.5M5 35l9.5-9.5M35 35l-9.5-9.5"/></svg>';

    this.reloadBar = div("position:absolute;left:50%;top:calc(50% + 32px);width:56px;height:2px;margin-left:-28px;background:rgba(0,0,0,.45);opacity:0;transition:opacity 120ms;", this.root);
    this.reloadFill = div(`height:100%;width:100%;background:${HUD_FG};transform-origin:left;transform:scaleX(0);`, this.reloadBar);

    this.medal = div("position:absolute;left:50%;top:calc(50% + 58px);transform:translateX(-50%);text-align:center;white-space:nowrap;opacity:0;", this.root);

    // ---- Top centre: compass -----------------------------------------------
    const compass = div(
      `position:absolute;left:50%;top:12px;width:min(${COMPASS_W}px,56vw);height:26px;transform:translateX(-50%);overflow:hidden;` +
        "-webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent);",
      this.root,
      "ih-compass",
    );
    this.compassStrip = div("position:absolute;left:50%;top:0;height:26px;will-change:transform;", compass);
    this.compassStrip.innerHTML = buildCompassSvg();
    const marker = div("position:absolute;left:50%;top:36px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:1px;", this.root, "ih-compass-mark");
    div(`width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid ${HUD_ACCENT};`, marker);
    this.compassDeg = div("font-size:11px;font-weight:600;opacity:.85;", marker, "ih-num");

    // ---- Bottom-left: health -------------------------------------------------
    this.healthWrap = div("position:absolute;left:28px;bottom:28px;width:188px;transition:opacity 200ms;", this.root, "ih-health");
    const hpRow = div("display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px;", this.healthWrap);
    div("opacity:.7;", hpRow, "ih-cap").textContent = "Health";
    this.healthText = div("font-size:14px;font-weight:700;", hpRow, "ih-num");
    const bar = div("position:relative;height:4px;background:rgba(0,0,0,.45);box-shadow:0 0 0 1px rgba(255,255,255,.08);overflow:hidden;", this.healthWrap);
    this.healthChip = div("position:absolute;inset:0;background:#d8452f;transform-origin:left;transition:transform 420ms cubic-bezier(.3,0,.2,1) 280ms;", bar);
    this.healthFill = div(`position:absolute;inset:0;background:${HUD_FG};transform-origin:left;transition:transform 90ms linear,background-color 200ms;`, bar);
    const abar = div("height:2px;margin-top:3px;background:rgba(0,0,0,.35);overflow:hidden;", this.healthWrap);
    this.armorFill = div("height:100%;width:100%;background:#78b4f0;transform-origin:left;transform:scaleX(0);transition:transform 160ms;", abar);

    // ---- Bottom-right: weapon ----------------------------------------------
    const wb = div("position:absolute;right:30px;bottom:24px;display:flex;flex-direction:column;align-items:flex-end;gap:3px;", this.root, "ih-weapon");
    this.status = div(`font-size:11px;font-weight:700;letter-spacing:.2em;color:${HUD_ACCENT};min-height:18px;display:flex;align-items:center;gap:6px;transition:opacity 150ms;`, wb);
    this.slots = div("display:flex;gap:4px;margin-bottom:2px;", wb);
    this.weaponName = div("opacity:.85;font-size:11px;", wb, "ih-cap");
    const ammoRow = div("display:flex;align-items:flex-end;gap:9px;line-height:1;", wb);
    this.ammo = div("font-size:46px;font-weight:700;transition:color 150ms;", ammoRow, "ih-num");
    div("width:1.5px;height:30px;margin-bottom:6px;background:rgba(238,240,234,.35);transform:skewX(-14deg);", ammoRow);
    this.reserve = div("font-size:19px;font-weight:600;opacity:.62;margin-bottom:5px;", ammoRow, "ih-num");
    const mag = div("width:132px;height:3px;margin-top:4px;background:rgba(255,255,255,.14);overflow:hidden;", wb);
    this.magFill = div(`height:100%;width:100%;background:${HUD_FG};transform-origin:right;transition:transform 70ms linear;`, mag);
    this.grenadeEl = div("display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;font-weight:700;opacity:.92;", wb);
    // Frag cook timer (fills toward the fuse).
    this.cookEl = div("width:132px;height:3px;margin-top:5px;background:rgba(255,255,255,.14);overflow:hidden;opacity:0;transition:opacity 120ms;", wb);
    this.cookFill = div(`height:100%;width:100%;background:${HUD_ACCENT};transform-origin:left;transform:scaleX(0);`, this.cookEl);

    // ---- Top-right: killfeed -------------------------------------------------
    this.feed = div("position:absolute;right:22px;top:58px;display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:12px;", this.root, "ih-feed");
    this.fps = div("position:absolute;right:12px;top:10px;font-size:10px;opacity:.5;", this.root, "ih-num ih-fps");

    // ---- Scoreboard (Tab) ---------------------------------------------------
    this.scoreboard = div(
      "position:absolute;left:50%;top:16%;transform:translateX(-50%);min-width:min(440px,92vw);padding:18px 22px;background:rgba(10,12,10,.86);border:1px solid rgba(255,255,255,.1);border-top:2px solid " +
        HUD_ACCENT +
        ";border-radius:6px;display:none;text-shadow:none;font-size:13px;backdrop-filter:blur(6px);",
      this.root,
    );

    // ---- Debug (F3) ---------------------------------------------------------
    this.debug = document.createElement("pre");
    css(this.debug, `position:absolute;left:12px;top:12px;margin:0;padding:10px 12px;background:rgba(0,0,0,.6);font:11px/1.45 ${HUD_MONO};display:none;text-shadow:none;border-radius:6px;`);
    this.root.appendChild(this.debug);
  }

  /** DOM vignette only when the post-process grade doesn't draw one. */
  setVignette(on: boolean) {
    this.vignetteEl.style.display = on ? "block" : "none";
  }

  frame(f: HudFrame, dt: number) {
    this.yaw = f.yaw;
    const glyphVer = glyphContext.version;
    const glyphsChanged = glyphVer !== this.lGlyphVer;
    this.lGlyphVer = glyphVer;

    // ---- Crosshair: gap = projected spread cone ---------------------------------
    const px = Math.round((Math.tan((f.spreadDeg * Math.PI) / 180) / Math.tan((f.fovDeg * Math.PI) / 360)) * (f.viewportH / 2)) + 5;
    const opacity = Math.round(Math.max(0, 1 - f.crosshairHide * 1.8) * 50) / 50;
    this.crossFlash = Math.max(0, this.crossFlash - dt);
    const flash = this.crossFlash > 0;
    const scoped = f.scope > 0.9;
    const optic = f.optic ?? "mildot";
    if (this.lOptic !== optic) {
      this.lOptic = optic;
      this.scopeEl.innerHTML = scopeHtml(optic);
    }
    const white = Math.round(Math.min(1, f.flash ?? 0) * 40) / 40;
    if (this.lWhite !== white) {
      this.lWhite = white;
      this.flashEl.style.opacity = String(white);
    }
    if (this.lScoped !== scoped) {
      this.lScoped = scoped;
      this.scopeEl.style.display = scoped ? "block" : "none";
      this.scopeEl.style.opacity = scoped ? "1" : "0";
      this.crosshair.style.visibility = scoped ? "hidden" : "visible";
    }
    if (this.lOpacity !== opacity) {
      this.lOpacity = opacity;
      this.crosshair.style.opacity = String(opacity);
    }
    if (this.lFlash !== flash) {
      this.lFlash = flash;
      this.crosshair.style.color = flash ? HUD_RED : HUD_FG;
    }
    if (this.lPx !== px) {
      this.lPx = px;
      const [u, d, l, r] = this.hairs;
      u.style.top = `${-px - 9}px`;
      d.style.top = `${px}px`;
      l.style.left = `${-px - 9}px`;
      r.style.left = `${px}px`;
    }

    // ---- Hit marker pop: scale from 1.4 → 1 while fading ---------------------
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      const t = Math.max(0, this.hitTimer) / (this.hitIsKill ? 0.34 : 0.2);
      const el = this.hitIsKill ? this.hitKill : this.hitmarker;
      el.style.opacity = String(Math.min(1, t * 1.7));
      el.style.transform = `scale(${1 + t * t * 0.4})`;
    }

    // ---- Compass --------------------------------------------------------------
    let heading = (-f.yaw * 180) / Math.PI;
    heading = ((heading % 360) + 360) % 360;
    const hq = Math.round(heading * 5);
    if (hq !== this.lHeadingQ) {
      this.lHeadingQ = hq;
      this.compassStrip.style.transform = `translate3d(${(-(hq / 5 + 180) * PPD).toFixed(1)}px,0,0)`;
      const deg = Math.round(heading) % 360;
      if (deg !== this.lHeadingDeg) {
        this.lHeadingDeg = deg;
        this.compassDeg.textContent = String(deg).padStart(3, "0");
      }
    }

    // ---- Ammo -----------------------------------------------------------------
    if (this.lAmmo !== f.ammo || this.lMag !== f.magSize) {
      this.lAmmo = f.ammo;
      this.lMag = f.magSize;
      const melee = f.magSize <= 0;
      this.ammo.textContent = melee ? "—" : String(f.ammo);
      this.ammo.style.color = melee ? "" : f.ammo === 0 ? HUD_RED : f.ammo <= Math.ceil(f.magSize * 0.25) ? "#ff8a5a" : "";
      this.magFill.style.transform = `scaleX(${melee ? 1 : Math.max(0, Math.min(1, f.ammo / f.magSize)).toFixed(3)})`;
    }
    if (this.lReserve !== f.reserve) {
      this.lReserve = f.reserve;
      this.reserve.textContent = f.magSize <= 0 ? "" : f.reserve < 0 ? "∞" : String(f.reserve);
    }
    const wKey = `${f.weaponName}|${f.fireMode ?? ""}`;
    if (this.lWeapon !== wKey) {
      this.lWeapon = wKey;
      this.weaponName.textContent = `${f.weaponName}  ·  ${f.weaponKind}${f.fireMode ? `  ·  ${f.fireMode}` : ""}`;
    }
    this.updateSlots(f);

    const status = f.magSize <= 0 ? "" : f.reload >= 0 ? "reloading" : f.ammo === 0 ? (f.reserve ? "reload" : "empty") : f.ammo <= Math.ceil(f.magSize * 0.2) ? "low" : "";
    if (this.lStatus !== status || (glyphsChanged && status === "reload")) {
      this.lStatus = status;
      this.status.innerHTML =
        status === "reloading" ? "RELOADING" : status === "reload" ? `${actionGlyph("reload", glyphContext, 16)}<span>RELOAD</span>` : status === "empty" ? `<span style="color:${HUD_RED}">NO AMMO</span>` : status === "low" ? "LOW AMMO" : "";
    }
    const reloadQ = f.reload >= 0 ? Math.round(f.reload * 200) : -1;
    if (this.lReload !== reloadQ) {
      if ((this.lReload < 0) !== (reloadQ < 0)) this.reloadBar.style.opacity = reloadQ >= 0 ? "1" : "0";
      this.lReload = reloadQ;
      if (reloadQ >= 0) this.reloadFill.style.transform = `scaleX(${(reloadQ / 200).toFixed(3)})`;
    }

    // ---- Health ---------------------------------------------------------------
    const hp = Math.max(0, Math.round(f.health));
    const armor = Math.round(f.armor);
    if (this.lHp !== hp || this.lMaxHp !== f.maxHealth || this.lArmor !== armor) {
      const frac = Math.max(0, Math.min(1, f.health / f.maxHealth));
      const scale = `scaleX(${frac.toFixed(3)})`;
      this.healthFill.style.transform = scale;
      // The red "chip" trails damage, but snaps up with healing.
      this.healthChip.style.transitionDuration = hp >= this.lHp ? "0ms" : "420ms";
      this.healthChip.style.transform = scale;
      this.healthFill.style.backgroundColor = frac < 0.35 ? "#ff6a4a" : HUD_FG;
      this.armorFill.style.transform = `scaleX(${Math.min(1, f.armor / 150).toFixed(3)})`;
      this.healthText.textContent = armor > 0 ? `${hp} · ${armor}` : String(hp);
      this.lHp = hp;
      this.lMaxHp = f.maxHealth;
      this.lArmor = armor;
      const low = frac < 0.45 ? Math.round(((0.45 - frac) / 0.45) * 40) / 40 : 0;
      if (low !== this.lLowHp) {
        this.lLowHp = low;
        this.lowHpEl.style.opacity = String(low);
      }
    }
    const gKey = f.grenades * 10000 + (f.flashbangs ?? -1) * 100 + (f.smokes ?? -1);
    if (this.lGrenades !== gKey || glyphsChanged) {
      this.lGrenades = gKey;
      const item = (action: "grenade" | "flashbang" | "smoke", svg: string, n: number) =>
        `<span style="display:inline-flex;align-items:center;gap:4px">${actionGlyph(action, glyphContext, 16)}<span style="display:inline-flex;align-items:center;gap:4px;${n === 0 ? "opacity:.4" : ""}">${svg}<span class="ih-num">×${n}</span></span></span>`;
      this.grenadeEl.innerHTML = f.grenades >= 0
        ? item("grenade", GRENADE_SVG, f.grenades) + (f.flashbangs !== undefined ? item("flashbang", FLASH_SVG, f.flashbangs) : "") + (f.smokes !== undefined ? item("smoke", SMOKE_SVG, f.smokes) : "")
        : "";
    }
    const cook = f.cook !== undefined && f.cook >= 0 ? Math.round(f.cook * 60) / 60 : -1;
    if (this.lCook !== cook) {
      if ((this.lCook < 0) !== (cook < 0)) this.cookEl.style.opacity = cook >= 0 ? "1" : "0";
      this.lCook = cook;
      if (cook >= 0) {
        this.cookFill.style.transform = `scaleX(${cook.toFixed(3)})`;
        this.cookFill.style.backgroundColor = cook > 0.7 ? HUD_RED : HUD_ACCENT;
      }
    }

    // ---- Hurt flash + damage direction arcs --------------------------------------
    if (this.hurtLevel > 0) {
      this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.6);
      const q = Math.round(this.hurtLevel * 50) / 50;
      if (q !== this.lHurt) {
        this.lHurt = q;
        this.hurtEl.style.opacity = String(q);
      }
    }
    for (let i = 0; i < this.indicators.length; i++) {
      const ind = this.indicators[i];
      if (ind.t <= 0) continue;
      ind.t -= dt;
      const o = Math.round(Math.max(0, Math.min(1, ind.t / 0.6)) * 40) / 40;
      if (o !== ind.shown) {
        ind.shown = o;
        ind.el.style.opacity = String(o);
      }
      // Indicators stay pinned to the world direction as you turn.
      if (o > 0) ind.el.style.transform = `rotate(${(this.yaw - ind.bearing).toFixed(3)}rad)`;
    }

    // ---- Killfeed fade-out -------------------------------------------------------
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const it = this.feedItems[i];
      it.t -= dt;
      if (it.t < 0.4 && !it.fading) {
        it.fading = true;
        it.el.style.transition = "opacity 380ms ease-in,transform 380ms ease-in";
        it.el.style.opacity = "0";
        it.el.style.transform = "translateX(10px)";
      }
      if (it.t <= 0) {
        it.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
  }

  private updateSlots(f: HudFrame) {
    let changed = this.lSlot !== f.slot || this.lSlotNames.length !== f.slots.length;
    if (!changed) for (let i = 0; i < f.slots.length; i++) if (this.lSlotNames[i] !== f.slots[i].def.name) changed = true;
    if (!changed) return;
    this.lSlot = f.slot;
    this.lSlotNames.length = f.slots.length;
    let html = "";
    for (let i = 0; i < f.slots.length; i++) {
      const name = f.slots[i].def.name;
      this.lSlotNames[i] = name;
      const on = i === f.slot;
      html += `<span style="display:inline-block;width:${on ? 22 : 12}px;height:3px;background:${on ? HUD_ACCENT : "rgba(238,240,234,.35)"};transition:width 160ms" title="${escapeHtml(name)}"></span>`;
    }
    this.slots.innerHTML = html;
  }

  /** Player took damage. `angle` = direction to the source relative to view (rad, 0 = ahead, + = right). */
  hurt(amount: number, angle: number | null) {
    this.hurtLevel = Math.min(0.85, this.hurtLevel + amount / 50);
    this.onHurt?.(amount);
    if (angle === null) return;
    const bearing = this.yaw - angle;
    let ind: (typeof this.indicators)[number] | undefined;
    for (const i of this.indicators) {
      const d = Math.atan2(Math.sin(i.bearing - bearing), Math.cos(i.bearing - bearing));
      if (i.t > 0 && Math.abs(d) < 0.35) ind = i;
    }
    if (!ind) ind = this.indicators.find((i) => i.t <= 0);
    if (!ind) {
      if (this.indicators.length >= 8) return;
      const el = div("position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;", this.root);
      el.innerHTML =
        '<div style="position:absolute;left:-52px;top:-168px;width:104px;height:26px;background:radial-gradient(ellipse at 50% 100%,rgba(255,64,40,.85),rgba(255,40,20,0) 70%);border-top:2.5px solid rgba(255,86,60,.95);border-radius:50% 50% 0 0/100% 100% 0 0;filter:drop-shadow(0 0 3px rgba(0,0,0,.6))"></div>';
      ind = { el, t: 0, bearing, shown: -1 };
      this.indicators.push(ind);
    }
    ind.bearing = bearing;
    ind.t = 1.5;
    ind.el.style.transform = `rotate(${angle.toFixed(3)}rad)`;
  }

  /** Update an indicator's rotation as the player turns (called by the mode). */
  get indicatorCount() {
    return this.indicators.length;
  }

  hit(kind: HitKind, medal?: string | null) {
    const kill = kind === "kill" || kind === "headkill";
    if (kill) {
      this.hitmarker.style.opacity = "0";
      this.hitKill.style.color = kind === "headkill" ? HUD_GOLD : HUD_RED;
      this.hitTimer = 0.34;
    } else {
      if (this.hitIsKill && this.hitTimer > 0) this.hitKill.style.opacity = "0";
      this.hitmarker.style.color = kind === "head" ? HUD_GOLD : "#ffffff";
      this.hitTimer = 0.2;
    }
    this.hitIsKill = kill;
    this.crossFlash = 0.07;
    if (kill && medal !== null) {
      if (medal) this.showMedal(medal, kind === "headkill" ? HUD_GOLD : HUD_FG);
      else this.showMedal(kind === "headkill" ? "HEADSHOT" : "ELIMINATED", kind === "headkill" ? HUD_GOLD : HUD_FG, kind === "headkill" ? 150 : 100);
    }
  }

  /** Score popup under the crosshair. */
  showMedal(text: string, color: string, points = 0) {
    this.medal.innerHTML =
      (points ? `<div class="ih-num" style="font-size:20px;font-weight:700;color:${HUD_FG}">+${points}</div>` : "") +
      `<div style="font-size:11px;font-weight:700;letter-spacing:.28em;color:${color}">${escapeHtml(text)}</div>`;
    this.medal.getAnimations?.().forEach((a) => a.cancel());
    this.medal.animate?.(
      [
        { opacity: 0, transform: "translate(-50%,8px) scale(.92)" },
        { opacity: 1, transform: "translate(-50%,0) scale(1.06)", offset: 0.12 },
        { opacity: 1, transform: "translate(-50%,0) scale(1)", offset: 0.22 },
        { opacity: 1, transform: "translate(-50%,0) scale(1)", offset: 0.8 },
        { opacity: 0, transform: "translate(-50%,-8px) scale(1)" },
      ],
      { duration: 1250, easing: "ease-out", fill: "forwards" },
    );
  }

  killfeed(killer: string, weapon: string, victim: string, headshot: boolean) {
    const el = div("display:flex;align-items:center;gap:7px;padding:3px 10px 3px 12px;white-space:nowrap;", this.feed, "ih-panel");
    el.innerHTML =
      `<span style="color:#86c7ff;font-weight:600">${escapeHtml(killer)}</span>` +
      (weapon ? `<span class="ih-cap" style="opacity:.6;font-size:9px">${escapeHtml(weapon)}</span>` : `<span style="opacity:.5">—</span>`) +
      (headshot ? `<span style="color:${HUD_GOLD};font-size:9px;font-weight:700;letter-spacing:.14em">HS</span>` : "") +
      `<span style="color:#ff8a6a;font-weight:600">${escapeHtml(victim)}</span>`;
    el.animate?.([{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
    this.feedItems.push({ el, t: 5, fading: false });
    if (this.feedItems.length > 5) this.feedItems.shift()!.el.remove();
  }

  setScoreboard(visible: boolean, callsign: string, stats: WeaponStats, seconds: number, mapName: string) {
    if (visible !== this.lBoardVisible) {
      this.lBoardVisible = visible;
      this.scoreboard.style.display = visible ? "block" : "none";
      if (visible) this.scoreboard.animate?.([{ opacity: 0, transform: "translate(-50%,-6px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 140, easing: "ease-out" });
    }
    if (!visible) return;
    const secs = Math.floor(seconds);
    const b = this.lBoard;
    if (b[0] === secs && b[1] === stats.kills && b[2] === stats.shotsFired && b[3] === stats.shotsHit) return;
    b[0] = secs;
    b[1] = stats.kills;
    b[2] = stats.shotsFired;
    b[3] = stats.shotsHit;
    const acc = stats.shotsFired ? ((stats.shotsHit / stats.shotsFired) * 100).toFixed(1) : "0.0";
    const hs = stats.shotsHit ? Math.round((stats.headshots / stats.shotsHit) * 100) : 0;
    const mins = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, "0");
    const row = (k: string, v: string | number) =>
      `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="opacity:.6">${k}</span><span class="ih-num">${v}</span></div>`;
    this.scoreboard.innerHTML =
      `<div class="ih-cap" style="display:flex;justify-content:space-between;margin-bottom:12px;opacity:.75"><span>${escapeHtml(mapName)} · ${escapeHtml(this.modeLabel)}</span><span class="ih-num">${mins}:${ss}</span></div>` +
      `<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#86c7ff">${escapeHtml(callsign)}</div>` +
      row("Eliminations", stats.kills) +
      row("Score", stats.kills * 100 + stats.headshots * 50) +
      row("Accuracy", `${acc}%`) +
      row("Headshot rate", `${hs}%`) +
      row("Damage dealt", Math.round(stats.damage)) +
      row("Shots fired / hit", `${stats.shotsFired} / ${stats.shotsHit}`);
  }

  setFps(fps: number) {
    if (this.lFps === fps) return;
    this.lFps = fps;
    if (this.fpsVisible) this.fps.textContent = `${fps} FPS`;
  }

  setFpsVisible(v: boolean) {
    if (this.fpsVisible === v) return;
    this.fpsVisible = v;
    this.fps.style.display = v ? "block" : "none";
    this.lFps = -1;
  }

  /** Re-render glyph prompts on the next frame (device / bindings changed). */
  refreshPrompts() {
    this.lGlyphVer = -1;
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debug.style.display = this.debugVisible ? "block" : "none";
  }

  setDebug(info: DebugInfo) {
    if (!this.debugVisible) return;
    let s = "";
    for (const k in info) s += `${k.padEnd(14)} ${info[k]}\n`;
    this.debug.textContent = s;
  }

  dispose() {
    this.root.remove();
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

