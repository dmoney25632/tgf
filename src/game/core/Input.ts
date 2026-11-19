import { LOOK } from "../config";
import { buildRemap, DEFAULT_BINDINGS, type Bindings, type PadCurve } from "../ui/Settings";

export type InputDevice = "kbm" | "pad";
export type PadLayout = "xbox" | "ps";

/** W3C "standard" gamepad mapping button indices. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

export type InputConfig = {
  bindings: Bindings;
  padDeadzone: number;
  padCurve: PadCurve;
  vibration: boolean;
};

/** Sony pads report their vendor id (054c) or a product name in Gamepad.id. */
export function padLayoutFromId(id: string): PadLayout {
  // (Not "Wireless Controller": Xbox pads use that name too; the vendor id covers Sony.)
  return /054c|playstation|dualsense|dualshock/i.test(id) ? "ps" : "xbox";
}

/**
 * Radial deadzone with rescale: no dead cross, no lost diagonal, full
 * deflection reachable. Writes into `out` and returns the magnitude 0..1.
 */
export function radialDeadzone(x: number, y: number, inner: number, outer: number, out: { x: number; y: number }) {
  const m = Math.hypot(x, y);
  if (m <= inner || m === 0) {
    out.x = out.y = 0;
    return 0;
  }
  const n = Math.min(1, (m - inner) / Math.max(1e-3, 1 - inner - outer));
  out.x = (x / m) * n;
  out.y = (y / m) * n;
  return n;
}

/** Look response curve on stick magnitude (0..1 → 0..1). */
export function lookCurve(n: number, curve: PadCurve) {
  if (curve === "linear") return n;
  if (curve === "dynamic") return 0.22 * n + 0.78 * n * n * n * n;
  return n * n; // standard: precise near centre, full speed at the rim
}

/**
 * InputManager: keyboard, mouse and gamepad state for the game loop.
 *
 * Game code reads *canonical* codes ("KeyR", "Mouse0", …: the default
 * bindings). Rebinding remaps physical keys onto those codes, and the gamepad
 * drives the same codes plus analog move/look axes, so weapons, modes and the
 * engine need no device-specific logic.
 *
 * - isDown()/pressed() use canonical codes; endFrame() clears edges.
 * - poll() reads the gamepad once per frame (call before reading input).
 * - "Engaged" (`locked`) = pointer lock OR a gamepad session. A gamepad can
 *   play without pointer lock (gamepad presses can't request it).
 * - The click/button that engages never fires, and a per-frame watchdog drops
 *   stuck buttons after alt-tab / lost mouseup.
 */
export class Input {
  private readonly keyDown = new Set<string>();
  private readonly padDown = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private remap = buildRemap(DEFAULT_BINDINGS);
  /** What the left/right mouse buttons currently mean (for the watchdog). */
  private mouse0: string | null = "Mouse0";
  private mouse2: string | null = "Mouse2";
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  /** Mouse buttons are ignored until this time (ms) after acquiring lock. */
  private ignoreMouseUntil = 0;
  /** Last known physical button bitmask from MouseEvent.buttons. */
  private buttons = 0;
  private mouseTravel = 0;

  pointerLocked = false;
  padEngaged = false;
  /** Last device the player actually used (drives HUD glyphs + aim assist). */
  device: InputDevice = "kbm";
  padLayout: PadLayout = "xbox";
  padConnected = false;

  /** Analog move (x = right, y = forward), −1..1 after deadzone. */
  moveX = 0;
  moveY = 0;
  /** Curved + accelerated look (−1..1, yaw may exceed 1 with turn boost). */
  lookX = 0;
  lookY = 0;

  onEngageChange?: (engaged: boolean) => void;
  onDeviceChange?: (device: InputDevice, layout: PadLayout) => void;
  /** Called on a click while pad-engaged without pointer lock (switch to mouse). */
  requestLock?: () => void;
  /** True when an interaction prompt is up: the pad's X becomes tap = reload, hold = interact. */
  interactContext: () => boolean = () => false;

  private cfg: InputConfig = { bindings: DEFAULT_BINDINGS, padDeadzone: 0.12, padCurve: "standard", vibration: true };
  private gp: Gamepad | null = null;
  private padIndex = -1;
  private padId = "";
  private prevMask = 0;
  /** Buttons held when engaging: ignored until released. */
  private ignoreMask = 0;
  private xHeld = -1;
  private xReloaded = false;
  private sprintLatch = false;
  private rimTime = 0;
  private lastRumble = 0;
  private lastRumbleStrength = 0;
  private wasEngaged = false;
  private readonly stick = { x: 0, y: 0 };

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    window.addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    target.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  /** Engaged = playing (pointer locked or gamepad session). */
  get locked() {
    return this.pointerLocked || this.padEngaged;
  }

  configure(cfg: InputConfig) {
    const rebound = cfg.bindings !== this.cfg.bindings;
    this.cfg = { bindings: cfg.bindings, padDeadzone: cfg.padDeadzone, padCurve: cfg.padCurve, vibration: cfg.vibration };
    if (rebound) {
      this.remap = buildRemap(cfg.bindings);
      this.mouse0 = this.virtual("Mouse0");
      this.mouse2 = this.virtual("Mouse2");
      this.keyDown.clear();
    }
  }

  isDown(code: string) {
    return this.keyDown.has(code) || this.padDown.has(code);
  }

  /** True only on the frame the key/button went down. */
  pressed(code: string) {
    return this.pressedThisFrame.has(code);
  }

  consumeMouseDelta(out: { x: number; y: number }) {
    out.x = this.mouseDX;
    out.y = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Start a gamepad session without pointer lock. False if no pad is connected. */
  engagePad() {
    this.readPad();
    if (!this.gp) return false;
    this.ignoreMask = this.maskOf(this.gp);
    this.prevMask = this.ignoreMask;
    this.xHeld = -1;
    this.sprintLatch = false;
    this.padEngaged = true;
    this.setDevice("pad");
    this.releaseAll();
    this.emitEngage();
    return true;
  }

  /** Leave play (pause/menus): drops the gamepad session and the pointer lock. */
  disengage() {
    this.padEngaged = false;
    this.releaseAll();
    if (this.pointerLocked && document.pointerLockElement) document.exitPointerLock();
    else this.emitEngage();
  }

  /**
   * Gamepad haptics (no-op unless the pad is the active device and vibration
   * is on). Weaker requests within 45 ms of a stronger one are dropped.
   */
  rumble(strong: number, weak: number, ms: number) {
    if (!this.cfg.vibration || this.device !== "pad" || !this.locked) return;
    const act = (this.gp as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
    if (!act?.playEffect) return;
    const now = performance.now();
    const s = Math.max(strong, weak);
    if (now - this.lastRumble < 45 && s < this.lastRumbleStrength) return;
    this.lastRumble = now;
    this.lastRumbleStrength = s;
    try {
      act.playEffect("dual-rumble", { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
    } catch {
      // Haptics unsupported on this pad/browser.
    }
  }

  /** Read the gamepad and translate it into canonical codes + axes. Once per frame. */
  poll(dt: number) {
    this.readPad();
    const gp = this.gp;
    if (!gp) {
      if (this.padDown.size) this.padDown.clear();
      this.moveX = this.moveY = this.lookX = this.lookY = 0;
      if (this.padEngaged && !this.pointerLocked) this.disengage(); // unplugged mid-game → pause
      else this.padEngaged = false;
      return;
    }
    const mask = this.maskOf(gp);
    const edge = mask & ~this.prevMask;
    this.prevMask = mask;
    this.ignoreMask &= mask; // released buttons stop being ignored

    const ax = gp.axes;
    const activeStick = Math.abs(ax[0] ?? 0) > 0.5 || Math.abs(ax[1] ?? 0) > 0.5 || Math.abs(ax[2] ?? 0) > 0.5 || Math.abs(ax[3] ?? 0) > 0.5;
    if (edge || activeStick) this.setDevice("pad");

    if (!this.locked) {
      if (this.padDown.size) this.padDown.clear();
      this.moveX = this.moveY = this.lookX = this.lookY = 0;
      this.sprintLatch = false;
      return;
    }

    const live = mask & ~this.ignoreMask;
    const down = (b: number) => (live & (1 << b)) !== 0;
    const tapped = (b: number) => (edge & ~this.ignoreMask & (1 << b)) !== 0;

    // Sticks.
    const P = LOOK.pad;
    radialDeadzone(ax[0] ?? 0, ax[1] ?? 0, this.cfg.padDeadzone, P.outerDeadzone, this.stick);
    this.moveX = this.stick.x;
    this.moveY = -this.stick.y;
    const n = radialDeadzone(ax[2] ?? 0, ax[3] ?? 0, this.cfg.padDeadzone, P.outerDeadzone, this.stick);
    const c = n > 0 ? lookCurve(n, this.cfg.padCurve) / n : 0;
    // Turn boost: the stick parked at the rim ramps yaw speed up.
    this.rimTime = n >= P.boostEdge ? this.rimTime + dt : 0;
    const r = clamp01((this.rimTime - P.boostDelay) / P.boostRamp);
    const boost = 1 + (P.boost - 1) * r * r * (3 - 2 * r);
    this.lookX = this.stick.x * c * boost;
    this.lookY = this.stick.y * c;

    // Buttons → canonical codes.
    const fire = (gp.buttons[PAD.RT]?.value ?? 0) > P.fireThreshold && !(this.ignoreMask & (1 << PAD.RT));
    const ads = (gp.buttons[PAD.LT]?.value ?? 0) > P.adsThreshold && !(this.ignoreMask & (1 << PAD.LT));
    this.setPad("Mouse0", fire);
    this.setPad("Mouse2", ads);
    this.setPad("Space", down(PAD.A));
    this.setPad("KeyC", down(PAD.B));
    this.setPad("KeyQ", down(PAD.Y));
    this.setPad("KeyG", down(PAD.RB) || down(PAD.LB));
    this.setPad("KeyV", down(PAD.R3));
    this.setPad("Tab", down(PAD.UP) || down(PAD.VIEW));
    this.setPad("KeyN", down(PAD.DOWN));

    // Sprint: click L3 to latch; stops when you stop pushing forward, aim or fire.
    if (tapped(PAD.L3)) this.sprintLatch = true;
    if (this.moveY < 0.3 || fire || ads) this.sprintLatch = false;
    this.setPad("ShiftLeft", this.sprintLatch);

    // X: reload on press; with an interaction prompt up, tap = reload, hold = interact.
    if (tapped(PAD.X)) {
      this.xHeld = 0;
      this.xReloaded = !this.interactContext();
      if (this.xReloaded) this.pressedThisFrame.add("KeyR");
    } else if (this.xHeld >= 0) {
      if (down(PAD.X)) this.xHeld += dt;
      else {
        if (!this.xReloaded && this.xHeld < P.holdTime) this.pressedThisFrame.add("KeyR");
        this.xHeld = -1;
      }
    }
    this.setPad("KeyF", this.xHeld >= P.holdTime && down(PAD.X));

    // Menu/Start pauses.
    if (tapped(PAD.MENU)) this.disengage();
  }

  /** Per-frame watchdog: never let a button stick down. */
  watchdog() {
    if (this.padEngaged && document.hidden) this.disengage();
    if (!this.locked || document.hidden || !document.hasFocus()) {
      if (this.keyDown.size) this.keyDown.clear();
      return;
    }
    // If the OS says a button is up but we think it's down, trust the OS.
    this.dropIfUp(this.mouse0, 1);
    this.dropIfUp(this.mouse2, 2);
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("blur", this.releaseAll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("wheel", this.onWheel);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.onEngageChange = this.onDeviceChange = this.requestLock = undefined;
  }

  // ---------------------------------------------------------------------------

  /** Physical code → canonical code, or null when swallowed by a rebind. */
  private virtual(code: string) {
    const v = this.remap.get(code);
    return v === undefined ? code : v;
  }

  private dropIfUp(code: string | null, bit: number) {
    if (code && !(this.buttons & bit)) this.keyDown.delete(code);
  }

  private press(code: string) {
    if (!this.isDown(code)) this.pressedThisFrame.add(code);
    this.keyDown.add(code);
  }

  private setPad(code: string, down: boolean) {
    if (down) {
      if (this.padDown.has(code)) return;
      if (!this.keyDown.has(code)) this.pressedThisFrame.add(code);
      this.padDown.add(code);
    } else if (this.padDown.size) {
      this.padDown.delete(code);
    }
  }

  private readPad() {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    let gp: Gamepad | null = null;
    if (pads) {
      const cur = this.padIndex >= 0 ? pads[this.padIndex] : null;
      if (cur && cur.connected) gp = cur;
      else {
        // Prefer a pad with the standard mapping; else anything connected.
        for (let i = 0; i < pads.length; i++) {
          const p = pads[i];
          if (p && p.connected && (p.mapping === "standard" || !gp)) gp = p;
        }
      }
    }
    this.gp = gp;
    this.padConnected = gp !== null;
    if (gp && (gp.index !== this.padIndex || gp.id !== this.padId)) {
      this.padIndex = gp.index;
      this.padId = gp.id;
      const layout = padLayoutFromId(gp.id);
      if (layout !== this.padLayout) {
        this.padLayout = layout;
        if (this.device === "pad") this.onDeviceChange?.(this.device, layout);
      }
    }
    if (!gp) this.padIndex = -1;
  }

  private maskOf(gp: Gamepad) {
    let m = 0;
    const b = gp.buttons;
    const n = Math.min(17, b.length);
    for (let i = 0; i < n; i++) {
      const btn = b[i];
      if (btn && (btn.pressed || btn.value > 0.5)) m |= 1 << i;
    }
    // Triggers count from their (lower) action thresholds.
    if ((b[PAD.RT]?.value ?? 0) > LOOK.pad.fireThreshold) m |= 1 << PAD.RT;
    if ((b[PAD.LT]?.value ?? 0) > LOOK.pad.adsThreshold) m |= 1 << PAD.LT;
    return m;
  }

  private setDevice(d: InputDevice) {
    if (this.device === d) return;
    this.device = d;
    this.onDeviceChange?.(d, this.padLayout);
  }

  private emitEngage() {
    const e = this.locked;
    if (e === this.wasEngaged) return;
    this.wasEngaged = e;
    this.onEngageChange?.(e);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.setDevice("kbm");
    if (e.code === "Escape" && this.padEngaged && !this.pointerLocked) {
      this.disengage();
      return;
    }
    if (!this.locked) return;
    // Keep game keys away from the browser (scrolling, find, etc.).
    if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("F") || e.ctrlKey) e.preventDefault();
    if (e.repeat) return;
    const v = this.virtual(e.code);
    if (v) this.press(v);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const v = this.virtual(e.code);
    if (v) this.keyDown.delete(v);
  };
  private onMouseDown = (e: MouseEvent) => {
    this.buttons = e.buttons;
    if (!this.pointerLocked) {
      // Clicking the game while playing on a pad hands control to the mouse.
      if (this.padEngaged && e.target === this.target) this.requestLock?.();
      return;
    }
    this.setDevice("kbm");
    if (performance.now() < this.ignoreMouseUntil) return;
    const v = this.virtual(`Mouse${e.button}`);
    if (v) this.press(v);
  };
  private onMouseUp = (e: MouseEvent) => {
    this.buttons = e.buttons;
    const v = this.virtual(`Mouse${e.button}`);
    if (v) this.keyDown.delete(v);
  };
  private onMouseMove = (e: MouseEvent) => {
    this.buttons = e.buttons;
    // Ignore sensor jitter so a resting mouse can't steal the HUD glyphs.
    this.mouseTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
    if (this.mouseTravel > 12) {
      this.mouseTravel = 0;
      this.setDevice("kbm");
    }
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY);
  };
  private onContextMenu = (e: Event) => e.preventDefault();
  private onVisibility = () => {
    this.releaseAll();
    if (document.hidden && this.padEngaged && !this.pointerLocked) this.disengage();
  };
  private releaseAll = () => {
    this.keyDown.clear();
    this.padDown.clear();
    this.pressedThisFrame.clear();
    this.buttons = 0;
    this.sprintLatch = false;
    this.xHeld = -1;
  };
  private onLockChange = () => {
    const was = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.target;
    this.mouseDX = this.mouseDY = 0;
    if (this.pointerLocked && !was) {
      // The click that grabbed the lock is still held; ignore it.
      this.ignoreMouseUntil = performance.now() + 150;
      this.releaseAll();
      this.setDevice("kbm");
    }
    if (!this.pointerLocked && was) {
      // Esc / alt-tab: pause, whatever device was in use.
      this.padEngaged = false;
      this.releaseAll();
    }
    this.emitEngage();
  };
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
