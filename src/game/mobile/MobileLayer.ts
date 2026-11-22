import { LOOK, QUALITY } from "../config";
import type { Input } from "../core/Input";
import type { GameSettings } from "../ui/Settings";
import { hudSignals } from "../ui/SurvivalHUD";
import { minimapSignal } from "../ui/Minimap";
import { isStandalone, platform, touchControlsEnabled } from "./device";
import { OPTIONAL_BUTTONS, TOUCH_BUTTONS, type TouchButtonDef } from "./layout";
import { tuneQualityForMobile } from "./mobileQuality";
import { FloatingStick, needsRotate, TouchTracker, touchToMouseUnits, zoneFor } from "./touchMath";
import { getTouchSettings, subscribeTouchSettings, type TouchSettings } from "./touchSettings";

// Phones get mobile-tuned presets before the engine reads one (this module is
// imported by the engine, so it evaluates first).
if (typeof window !== "undefined" && touchControlsEnabled()) tuneQualityForMobile(QUALITY);

export type MobileHost = {
  settings: () => GameSettings;
  /** 0..1 aim-down-sights amount. */
  ads: () => number;
  /** Aim-assist look slowdown (1 = none). */
  assist: () => number;
};

const IOS_HINT_KEY = "tgf.iron-horizon.iosHint";

const ICONS: Record<string, string> = {
  fire: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/>',
  ads: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  jump: '<path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  crouch: '<path d="M5 8l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M17.5 3v4.5H13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  grenade: '<ellipse cx="12" cy="14" rx="6" ry="6.5" fill="currentColor"/><rect x="9.5" y="4" width="5" height="3.4" rx="1" fill="currentColor"/><path d="M14.5 5q4 .3 4 4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  melee: '<path d="M4 20l3-3M7 17l10-12 2 2-12 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/>',
  score: '<path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
ICONS.fire2 = ICONS.fire;

const LAYER_CSS = `
.ih-touch{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.ih-tl{position:absolute;inset:0;z-index:15;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;display:none;
  --tb:1;--to:.55;--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px);
  font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;color:#eef0ea}
.ih-tl.on{display:block}
.ih-tb{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;box-sizing:border-box;border-radius:50%;
  border:1.5px solid rgba(238,240,234,.55);background:rgba(12,14,12,.38);opacity:var(--to);touch-action:none;
  transition:opacity 90ms,background-color 90ms,transform 90ms;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.ih-tb svg{width:42%;height:42%;pointer-events:none}
.ih-tb span{font-size:8px;font-weight:700;letter-spacing:.14em;pointer-events:none;opacity:.85}
.ih-tb.down{opacity:1;background:rgba(240,180,74,.38);transform:scale(.94)}
.ih-tb.lit{opacity:1;border-color:#f0b44a;box-shadow:0 0 0 2px rgba(240,180,74,.35)}
.ih-tb.pill{border-radius:999px;flex-direction:row;gap:8px;opacity:1;border-color:#9be070;background:rgba(20,40,14,.55)}
.ih-tb.pill span{font-size:11px;letter-spacing:.2em}
.ih-tb.hide{display:none}
.ih-tb[data-id=map]{background:transparent;border-color:transparent;justify-content:flex-end;padding-bottom:2px;-webkit-backdrop-filter:none;backdrop-filter:none;opacity:1}
.ih-tb[data-id=map] span{font-size:7px;opacity:.7;transform:translateY(12px)}
.ih-tb[data-id=map].down{background:rgba(240,180,74,.18);transform:none}
.ih-tb[data-id=fire],.ih-tb[data-id=fire2]{border-color:rgba(255,120,90,.75)}
.ih-ts{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;opacity:0;transition:opacity 120ms}
.ih-ts.on{opacity:1}
.ih-ts .b{position:absolute;border-radius:50%;border:1.5px solid rgba(238,240,234,.5);background:rgba(12,14,12,.22)}
.ih-ts .k{position:absolute;border-radius:50%;background:rgba(238,240,234,.55);box-shadow:0 0 0 1px rgba(0,0,0,.3)}
.ih-ts.sprint .k{background:#f0b44a}
.ih-tg{position:absolute;bottom:calc(36px + var(--sb));width:112px;height:112px;border-radius:50%;border:1.5px dashed rgba(238,240,234,.25);pointer-events:none;
  display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(238,240,234,.45)}
.ih-ov{position:absolute;inset:0;z-index:70;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;
  background:#050605;color:#eef0ea;font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;touch-action:none}
.ih-ov.on{display:flex}
.ih-ov h2{margin:0;font-size:18px;font-weight:800;letter-spacing:.24em;text-transform:uppercase}
.ih-ov p{margin:0;max-width:300px;font-size:13px;line-height:1.5;color:#a3a6a0}
.ih-ov button{margin-top:6px;padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;font:700 12px/1 inherit;letter-spacing:.2em;text-transform:uppercase}
.ih-ov .ph{width:46px;height:78px;border:2.5px solid #eef0ea;border-radius:9px;animation:ih-rot 1.8s ease-in-out infinite}
@keyframes ih-rot{0%,25%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}
.ih-hint{position:absolute;left:50%;top:calc(10px + var(--st));transform:translateX(-50%);z-index:71;display:none;align-items:center;gap:10px;max-width:min(520px,92vw);
  padding:9px 12px 9px 14px;border-radius:10px;background:rgba(10,12,10,.9);border:1px solid rgba(255,255,255,.14);color:#eef0ea;
  font:500 12px/1.4 var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;pointer-events:auto}
.ih-hint.on{display:flex}
.ih-hint b{color:#f0b44a}
.ih-hint button{flex:none;width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-size:15px;line-height:1}
html.ih-playing,html.ih-playing body{overscroll-behavior:none;overflow:hidden}
`;

/**
 * Mobile glue for one engine: on touch devices, the on-screen controls
 * (floating move stick, drag-to-look, buttons) feeding the existing Input
 * as canonical codes, plus full screen / landscape lock on start, a
 * "rotate your phone" overlay, the iOS "Add to Home Screen" hint and
 * gesture suppression. On every device: a WebGL context-loss overlay.
 */
export class MobileLayer {
  readonly touch: boolean;
  private readonly root: HTMLDivElement | null = null;
  private readonly rotateEl: HTMLDivElement | null = null;
  private readonly hintEl: HTMLDivElement | null = null;
  private readonly lostEl: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly stickEl: HTMLDivElement | null = null;
  private readonly stickBase: HTMLDivElement | null = null;
  private readonly stickKnob: HTMLDivElement | null = null;
  private readonly ghost: HTMLDivElement | null = null;
  private readonly buttons = new Map<string, { el: HTMLDivElement; def: TouchButtonDef }>();
  private readonly tracker = new TouchTracker();
  private readonly stick = new FloatingStick();
  private readonly delta = { x: 0, y: 0 };
  private readonly unsub: () => void = () => {};
  private ts: TouchSettings;
  private raf = 0;
  private adsOn = false;
  private sprinting = false;
  private wasEngaged = false;
  private wasFullscreen = false;
  /** Paused by turning the phone upright: resume when it's landscape again. */
  private resumeOnLandscape = false;
  private lastInteract = false;
  private lastReady = false;
  private lastMap = false;
  private rotateShown = false;
  private lostTimer = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly input: Input,
    private readonly canvas: HTMLCanvasElement,
    private readonly host: MobileHost,
  ) {
    this.touch = touchControlsEnabled();
    this.ts = getTouchSettings();

    this.styleEl = document.createElement("style");
    this.styleEl.textContent = LAYER_CSS;
    container.appendChild(this.styleEl);

    // Context loss (any device): pause and say so; three.js restores the context itself.
    this.lostEl = this.overlay("Graphics paused", "The device reclaimed the graphics context (low memory or the app was in the background). Restoring…");
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);

    if (!this.touch) return;

    container.classList.add("ih-touch");
    document.documentElement.classList.add("ih-playing");

    const root = document.createElement("div");
    root.className = "ih-tl";
    this.root = root;
    container.appendChild(root);

    this.ghost = document.createElement("div");
    this.ghost.className = "ih-tg";
    this.ghost.textContent = "MOVE";
    root.appendChild(this.ghost);

    this.stickEl = document.createElement("div");
    this.stickEl.className = "ih-ts";
    this.stickBase = document.createElement("div");
    this.stickBase.className = "b";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "k";
    this.stickEl.append(this.stickBase, this.stickKnob);
    root.appendChild(this.stickEl);

    for (const def of TOUCH_BUTTONS) {
      const el = document.createElement("div");
      el.className = "ih-tb" + (def.center ? " pill" : "") + (def.context ? " hide" : "");
      el.dataset.id = def.id;
      el.innerHTML = (ICONS[def.id] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[def.id]}</svg>` : "") + `<span>${def.label}</span>`;
      root.appendChild(el);
      this.buttons.set(def.id, { el, def });
    }

    this.rotateEl = this.overlay("Rotate your phone", "Iron Horizon plays in landscape. Turn your phone sideways to continue.", true);
    this.hintEl = document.createElement("div");
    this.hintEl.className = "ih-hint";
    this.hintEl.innerHTML =
      '<span>For true full screen on iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>, then launch Iron Horizon from your home screen.</span><button type="button" aria-label="Dismiss">×</button>';
    this.hintEl.querySelector("button")!.addEventListener("click", () => this.hideHint());
    container.appendChild(this.hintEl);

    this.applySettings();
    this.unsub = subscribeTouchSettings((s) => {
      this.ts = s;
      this.applySettings();
    });

    root.addEventListener("pointerdown", this.onDown);
    root.addEventListener("pointermove", this.onMove);
    root.addEventListener("pointerup", this.onUp);
    root.addEventListener("pointercancel", this.onUp);
    root.addEventListener("lostpointercapture", this.onUp);
    root.addEventListener("contextmenu", prevent);
    // No pinch-zoom, double-tap zoom, pull-to-refresh or rubber-banding inside the game.
    container.addEventListener("touchstart", this.onTouchGuard, { passive: false });
    container.addEventListener("touchmove", this.onTouchGuard, { passive: false });
    container.addEventListener("dblclick", prevent);
    document.addEventListener("gesturestart", prevent);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    document.addEventListener("fullscreenchange", this.onFullscreen);
    document.addEventListener("webkitfullscreenchange", this.onFullscreen);
    this.onResize();
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Called by Engine.lock() from the deploy/resume tap. On touch devices this
   * replaces pointer lock: go full screen + landscape (Android), then start
   * the touch session. Returns false on desktop.
   */
  engage(): boolean {
    if (!this.touch || this.disposed) return false;
    void this.enterFullscreen();
    if (needsRotate(true, window.innerWidth, window.innerHeight)) {
      // Can't play upright: start as soon as the phone turns (Android's lock may do it for us).
      this.resumeOnLandscape = true;
      this.showRotate(true);
      return true;
    }
    this.input.engageTouch();
    this.maybeShowHint();
    return true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.lostTimer);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.unsub();
    if (this.touch) {
      const root = this.root!;
      root.removeEventListener("pointerdown", this.onDown);
      root.removeEventListener("pointermove", this.onMove);
      root.removeEventListener("pointerup", this.onUp);
      root.removeEventListener("pointercancel", this.onUp);
      root.removeEventListener("lostpointercapture", this.onUp);
      root.removeEventListener("contextmenu", prevent);
      this.container.removeEventListener("touchstart", this.onTouchGuard);
      this.container.removeEventListener("touchmove", this.onTouchGuard);
      this.container.removeEventListener("dblclick", prevent);
      document.removeEventListener("gesturestart", prevent);
      window.removeEventListener("resize", this.onResize);
      window.removeEventListener("orientationchange", this.onResize);
      document.removeEventListener("fullscreenchange", this.onFullscreen);
      document.removeEventListener("webkitfullscreenchange", this.onFullscreen);
      this.container.classList.remove("ih-touch");
      document.documentElement.classList.remove("ih-playing");
      root.remove();
      this.rotateEl?.remove();
      this.hintEl?.remove();
      try {
        screen.orientation?.unlock?.();
      } catch {
        // Not locked / unsupported.
      }
    }
    this.lostEl.remove();
    this.styleEl.remove();
  }

  // ---------------------------------------------------------------------------

  private overlay(title: string, text: string, phone = false) {
    const el = document.createElement("div");
    el.className = "ih-ov";
    el.setAttribute("role", "alert");
    el.innerHTML = (phone ? '<div class="ph" aria-hidden="true"></div>' : "") + `<h2>${title}</h2><p>${text}</p>`;
    this.container.appendChild(el);
    return el;
  }

  private async enterFullscreen() {
    const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (!document.fullscreenElement) {
        if (de.requestFullscreen) await de.requestFullscreen({ navigationUI: "hide" });
        else de.webkitRequestFullscreen?.();
      }
    } catch {
      // iPhone Safari has no element full screen (Add to Home Screen instead); others may refuse.
    }
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o?.lock?.("landscape");
    } catch {
      // Orientation lock needs full screen and isn't available everywhere.
    }
  }

  private maybeShowHint() {
    const p = platform();
    if (!p.ios || isStandalone() || !this.hintEl) return;
    try {
      if (window.localStorage.getItem(IOS_HINT_KEY)) return;
      window.localStorage.setItem(IOS_HINT_KEY, "1");
    } catch {
      return;
    }
    this.hintEl.classList.add("on");
    window.setTimeout(() => this.hideHint(), 9000);
  }

  private hideHint() {
    this.hintEl?.classList.remove("on");
  }

  private showRotate(on: boolean) {
    if (this.rotateShown === on) return;
    this.rotateShown = on;
    this.rotateEl?.classList.toggle("on", on);
  }

  private applySettings() {
    const s = this.ts;
    const root = this.root;
    if (!root) return;
    root.style.setProperty("--tb", String(s.buttonScale));
    root.style.setProperty("--to", String(s.opacity));
    const k = s.buttonScale;
    for (const { el, def } of this.buttons.values()) {
      const size = def.size * k;
      const st = el.style;
      if (def.center) {
        st.width = `${Math.round(size * 2.6)}px`;
        st.height = `${Math.round(size)}px`;
        st.left = "50%";
        st.right = "";
        st.marginLeft = `${-Math.round(size * 1.3)}px`;
        if (def.top) {
          st.top = `calc(${def.y}px + var(--st))`;
          st.bottom = "";
        } else {
          st.top = "calc(50% + 92px)";
          st.bottom = "";
        }
        continue;
      }
      if (def.fixed) {
        st.width = st.height = `${def.size}px`;
        st.left = `calc(${def.x}px + var(--sl))`;
        st.right = "";
        st.top = `calc(${def.y}px + var(--st))`;
        st.bottom = "";
        continue;
      }
      st.width = st.height = `${Math.round(size)}px`;
      const onRight = !def.stickSide !== s.leftHanded;
      const x = `calc(${Math.round(def.x * k)}px + ${onRight ? "var(--sr)" : "var(--sl)"})`;
      st.left = onRight ? "" : x;
      st.right = onRight ? x : "";
      const y = `calc(${Math.round(def.y * k)}px + ${def.top ? "var(--st)" : "var(--sb)"})`;
      st.top = def.top ? y : "";
      st.bottom = def.top ? "" : y;
    }
    this.buttons.get(OPTIONAL_BUTTONS.leftFire)?.el.classList.toggle("hide", !s.leftFire);
    if (this.ghost) {
      this.ghost.style.left = s.leftHanded ? "" : "calc(64px + var(--sl))";
      this.ghost.style.right = s.leftHanded ? "calc(64px + var(--sr))" : "";
    }
    const r = this.stick.cfg.radius;
    if (this.stickBase && this.stickKnob) {
      Object.assign(this.stickBase.style, { width: `${r * 2}px`, height: `${r * 2}px`, left: `${-r}px`, top: `${-r}px` });
      const kr = r * 0.45;
      Object.assign(this.stickKnob.style, { width: `${kr * 2}px`, height: `${kr * 2}px`, left: `${-kr}px`, top: `${-kr}px` });
    }
  }

  /** Per-frame upkeep: session start/stop, contextual buttons, stick → move axes. */
  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const engaged = this.input.touchEngaged;
    if (engaged !== this.wasEngaged) {
      this.wasEngaged = engaged;
      this.root?.classList.toggle("on", engaged);
      if (!engaged) this.resetFingers();
    }
    if (!engaged) return;
    const interact = hudSignals.interact || hudSignals.door;
    if (interact !== this.lastInteract) {
      this.lastInteract = interact;
      this.buttons.get("usePill")?.el.classList.toggle("hide", !interact);
      this.buttons.get("use")?.el.classList.toggle("lit", interact);
    }
    const ready = hudSignals.ready;
    if (ready !== this.lastReady) {
      this.lastReady = ready;
      this.buttons.get("ready")?.el.classList.toggle("hide", !ready);
    }
    if (minimapSignal.on !== this.lastMap) {
      this.lastMap = minimapSignal.on;
      this.buttons.get("map")?.el.classList.toggle("hide", !minimapSignal.on);
    }
    // The game may drop aim (weapon swap, sprint): keep the toggle honest.
    if (this.adsOn && !this.input.isDown("Mouse2")) this.setAds(false);
    this.input.touchMoveX = this.stick.x;
    this.input.touchMoveY = this.stick.y;
  };

  private resetFingers() {
    this.tracker.clear();
    this.stick.end();
    this.input.touchMoveX = this.input.touchMoveY = 0;
    this.adsOn = false;
    this.sprinting = false;
    this.stickEl?.classList.remove("on", "sprint");
    this.ghost?.classList.remove("hide");
    for (const { el } of this.buttons.values()) el.classList.remove("down");
  }

  private setAds(on: boolean) {
    this.adsOn = on;
    this.input.setTouch("Mouse2", on);
    this.buttons.get("ads")?.el.classList.toggle("down", on);
  }

  private onTouchGuard = (e: TouchEvent) => {
    // Let menus (React overlays above the canvas) and our own buttons (hint, reload) work; block gestures over the game itself.
    const t = e.target as Node;
    if (this.hintEl?.contains(t) || this.lostEl.contains(t)) return;
    if (this.input.touchEngaged || t === this.canvas || this.root?.contains(t)) {
      if (e.cancelable) e.preventDefault();
    }
  };

  private onDown = (e: PointerEvent) => {
    if (!this.input.touchEngaged) return;
    e.preventDefault();
    try {
      this.root!.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic / already-released pointer.
    }
    const btnEl = (e.target as HTMLElement | null)?.closest?.(".ih-tb") as HTMLDivElement | null;
    const b = btnEl ? this.buttons.get(btnEl.dataset.id ?? "") : undefined;
    const zone = zoneFor(e.clientX, window.innerWidth, this.ts.leftHanded);
    const role = this.tracker.down(e.pointerId, e.clientX, e.clientY, zone, b?.def.id, !!b?.def.look);
    if (role.kind === "stick") {
      this.stick.start(e.pointerId, e.clientX, e.clientY);
      this.drawStick();
      this.stickEl?.classList.add("on");
      this.ghost?.classList.add("hide");
      return;
    }
    if (role.kind !== "button" || !b) return;
    const def = b.def;
    if (def.id === "pause") {
      this.input.disengage();
      return;
    }
    if (def.toggle) {
      this.setAds(!this.adsOn);
      return;
    }
    b.el.classList.add("down");
    if (def.code) this.input.setTouch(def.code, true);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.input.touchEngaged) return;
    const role = this.tracker.roleOf(e.pointerId);
    if (!role) return;
    if (role.kind === "stick" && this.stick.id === e.pointerId) {
      this.stick.move(e.clientX, e.clientY);
      this.drawStick();
      this.updateSprint();
      this.tracker.move(e.pointerId, e.clientX, e.clientY, this.delta);
      return;
    }
    const d = this.tracker.move(e.pointerId, e.clientX, e.clientY, this.delta);
    if (d.x === 0 && d.y === 0) return;
    const s = this.host.settings();
    const ads = this.host.ads();
    const engineRad = LOOK.baseSensitivity * s.sensitivity * (1 + (LOOK.adsSensitivityMultiplier * s.adsSensitivity - 1) * ads);
    const slow = s.aimAssist ? this.host.assist() : 1;
    const ux = touchToMouseUnits(d.x, this.ts.sensitivity, this.ts.adsSensitivity, ads, engineRad) * slow;
    const uy = touchToMouseUnits(d.y, this.ts.sensitivity, this.ts.adsSensitivity, ads, engineRad) * slow;
    this.input.touchLook(ux, uy);
  };

  private onUp = (e: PointerEvent) => {
    const role = this.tracker.up(e.pointerId);
    if (!role) return;
    if (role.kind === "stick") {
      this.stick.end();
      this.input.touchMoveX = this.input.touchMoveY = 0;
      this.stickEl?.classList.remove("on", "sprint");
      this.ghost?.classList.remove("hide");
      this.updateSprint();
      return;
    }
    if (role.kind !== "button") return;
    const b = this.buttons.get(role.id);
    if (!b || !b.def.code || b.def.toggle) return;
    // Two buttons can share a code (both FIRE buttons): release only when none is held.
    const stillHeld = [...this.buttons.values()].some((o) => o.def.code === b.def.code && this.tracker.holding(o.def.id));
    if (!this.tracker.holding(role.id)) b.el.classList.remove("down");
    if (!stillHeld) this.input.setTouch(b.def.code, false);
  };

  private updateSprint() {
    const sprint = this.stick.active && this.stick.sprint;
    if (sprint === this.sprinting) return;
    this.sprinting = sprint;
    this.stickEl?.classList.toggle("sprint", sprint);
    if (sprint && this.adsOn) this.setAds(false); // sprinting drops aim
    this.input.setTouch("ShiftLeft", sprint);
  }

  private drawStick() {
    const s = this.stick;
    this.stickBase!.style.transform = `translate3d(${s.ox}px,${s.oy}px,0)`;
    this.stickKnob!.style.transform = `translate3d(${s.kx}px,${s.ky}px,0)`;
  }

  private onResize = () => {
    const rotate = needsRotate(true, window.innerWidth, window.innerHeight);
    this.showRotate(rotate);
    if (rotate && this.input.touchEngaged) {
      // Held upright mid-game: pause, pick up again when it turns back.
      this.resumeOnLandscape = true;
      this.input.disengage();
    } else if (!rotate && this.resumeOnLandscape) {
      this.resumeOnLandscape = false;
      if (!this.disposed && this.canvas.isConnected) {
        this.input.engageTouch();
        this.maybeShowHint();
      }
    }
  };

  private onFullscreen = () => {
    const fs = !!(document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    // Android back gesture leaves full screen: treat it like Esc on desktop (pause).
    if (this.wasFullscreen && !fs && this.input.touchEngaged) this.input.disengage();
    this.wasFullscreen = fs;
  };

  private onContextLost = (e: Event) => {
    e.preventDefault(); // allow restoration
    this.input.disengage();
    this.lostEl.classList.add("on");
    window.clearTimeout(this.lostTimer);
    this.lostTimer = window.setTimeout(() => {
      // Still gone after a while: offer a reload rather than a dead screen.
      if (!this.lostEl.classList.contains("on") || this.lostEl.querySelector("button")) return;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Reload game";
      b.addEventListener("click", () => window.location.reload());
      this.lostEl.appendChild(b);
    }, 5000);
  };

  private onContextRestored = () => {
    window.clearTimeout(this.lostTimer);
    this.lostEl.classList.remove("on");
    this.lostEl.querySelector("button")?.remove();
  };
}

function prevent(e: Event) {
  if (e.cancelable) e.preventDefault();
}
