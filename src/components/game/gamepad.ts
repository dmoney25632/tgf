"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { PAD, padLayoutFromId, type InputDevice, type PadLayout } from "@/game/core/Input";

/**
 * Gamepad support for the React menus (lobby, pause, settings, armory,
 * summary). One shared rAF poller feeds:
 *  - useInputDevice(): which device the player last touched (for glyphs);
 *  - useGamepadNav(): spatial focus navigation for the top-most open menu.
 * The poller only runs while something is subscribed, and only edges that
 * happen after a menu opens reach it (a held button never "clicks").
 */

export type DeviceSnapshot = { device: InputDevice; layout: PadLayout; connected: boolean };

export type NavOptions = {
  onBack?: () => void;
  onStart?: () => void;
  onTab?: (dir: -1 | 1) => void;
  onX?: () => void;
  onY?: () => void;
};

type Dir = "up" | "down" | "left" | "right";
type NavEntry = { ref: RefObject<HTMLElement | null>; opts: RefObject<NavOptions> };

const SERVER_SNAP: DeviceSnapshot = { device: "kbm", layout: "xbox", connected: false };
let snap: DeviceSnapshot = SERVER_SNAP;
const listeners = new Set<() => void>();
const navStack: NavEntry[] = [];
let raf = 0;
let prevMask = -1;
let heldDir: Dir | null = null;
let nextRepeat = 0;
let domBound = false;

function setSnap(next: Partial<DeviceSnapshot>) {
  const s = { ...snap, ...next };
  if (s.device === snap.device && s.layout === snap.layout && s.connected === snap.connected) return;
  snap = s;
  listeners.forEach((l) => l());
}

function pickPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  let gp: Gamepad | null = null;
  for (const p of pads) if (p && p.connected && (p.mapping === "standard" || !gp)) gp = p;
  return gp;
}

function maskOf(gp: Gamepad) {
  let m = 0;
  for (let i = 0; i < Math.min(17, gp.buttons.length); i++) {
    const b = gp.buttons[i];
    if (b && (b.pressed || b.value > 0.5)) m |= 1 << i;
  }
  return m;
}

function stickDir(gp: Gamepad): Dir | null {
  const x = gp.axes[0] ?? 0, y = gp.axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < 0.55) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
}

function tick(now: number) {
  raf = requestAnimationFrame(tick);
  const gp = pickPad();
  if (!gp) {
    if (snap.connected) setSnap({ connected: false });
    prevMask = -1;
    heldDir = null;
    return;
  }
  const mask = maskOf(gp);
  const dir = (mask & (1 << PAD.UP) ? "up" : mask & (1 << PAD.DOWN) ? "down" : mask & (1 << PAD.LEFT) ? "left" : mask & (1 << PAD.RIGHT) ? "right" : null) ?? stickDir(gp);
  const first = prevMask < 0;
  const edge = first ? 0 : mask & ~prevMask;
  prevMask = mask;
  const layout = padLayoutFromId(gp.id);
  if (!snap.connected || snap.layout !== layout) setSnap({ connected: true, layout });
  if (edge || (dir && !first && dir !== heldDir)) setSnap({ device: "pad" });

  const top = navStack[navStack.length - 1];
  // Directions: fire on press, then auto-repeat while held.
  let fireDir: Dir | null = null;
  if (first) heldDir = dir;
  else if (dir !== heldDir) {
    heldDir = dir;
    if (dir) {
      fireDir = dir;
      nextRepeat = now + 380;
    }
  } else if (dir && now >= nextRepeat) {
    fireDir = dir;
    nextRepeat = now + 95;
  }
  if (!top || (!edge && !fireDir)) return;
  const root = top.ref.current;
  const o = top.opts.current;
  if (!root) return;
  if (fireDir) navigate(root, fireDir);
  const hit = (b: number) => (edge & (1 << b)) !== 0;
  if (hit(PAD.A)) activate(root);
  if (hit(PAD.B)) o.onBack?.();
  if (hit(PAD.MENU)) (o.onStart ?? o.onBack)?.();
  if (hit(PAD.X)) o.onX?.();
  if (hit(PAD.Y)) o.onY?.();
  if (hit(PAD.LB)) o.onTab?.(-1);
  if (hit(PAD.RB)) o.onTab?.(1);
}

function onDomKbm(e: Event) {
  if (e.type === "mousemove") {
    const m = e as MouseEvent;
    if (Math.abs(m.movementX) + Math.abs(m.movementY) < 6) return;
  }
  if (snap.device !== "kbm") setSnap({ device: "kbm" });
  if (e.type !== "keydown") clearPadFocus();
}

function retain() {
  if (typeof window === "undefined") return;
  if (!domBound) {
    domBound = true;
    window.addEventListener("keydown", onDomKbm, true);
    window.addEventListener("mousedown", onDomKbm, true);
    window.addEventListener("mousemove", onDomKbm, { passive: true });
  }
  if (!raf) {
    prevMask = -1;
    raf = requestAnimationFrame(tick);
  }
}

function release() {
  if (listeners.size || navStack.length) return;
  cancelAnimationFrame(raf);
  raf = 0;
  if (domBound) {
    domBound = false;
    window.removeEventListener("keydown", onDomKbm, true);
    window.removeEventListener("mousedown", onDomKbm, true);
    window.removeEventListener("mousemove", onDomKbm);
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  retain();
  return () => {
    listeners.delete(l);
    release();
  };
}

/** Last-used input device + connected pad layout (re-renders on change). */
export function useInputDevice(): DeviceSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => SERVER_SNAP,
  );
}

/**
 * Gamepad navigation inside `ref` while `active`: d-pad / left stick move
 * focus spatially (sliders take left/right), A clicks, B/Start/LB/RB/X/Y call
 * the handlers. The most recently activated menu wins.
 */
export function useGamepadNav(ref: RefObject<HTMLElement | null>, opts: NavOptions, active = true) {
  const optsRef = useRef<NavOptions>(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  useEffect(() => {
    if (!active) return;
    const entry: NavEntry = { ref, opts: optsRef };
    navStack.push(entry);
    retain();
    return () => {
      const i = navStack.indexOf(entry);
      if (i >= 0) navStack.splice(i, 1);
      release();
    };
  }, [ref, active]);
}

// ---------------------------------------------------------------------------
// Spatial navigation
// ---------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [data-nav]:not([aria-disabled="true"])';

function candidates(root: HTMLElement) {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if (el.closest("[data-nav-skip]")) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(el);
  });
  return out;
}

let padFocused: HTMLElement | null = null;

function clearPadFocus() {
  if (padFocused) delete padFocused.dataset.padFocus;
  padFocused = null;
}

function focusEl(el: HTMLElement) {
  clearPadFocus();
  el.dataset.padFocus = "";
  padFocused = el;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function currentIn(root: HTMLElement) {
  const a = document.activeElement as HTMLElement | null;
  return a && a !== root && root.contains(a) ? a : null;
}

function navigate(root: HTMLElement, dir: Dir) {
  const cur = currentIn(root);
  const list = candidates(root);
  if (!list.length) return;
  if (!cur) {
    focusEl(root.querySelector<HTMLElement>("[data-nav-default]") ?? list[0]);
    return;
  }
  // Sliders: left/right change the value.
  if (cur instanceof HTMLInputElement && cur.type === "range" && (dir === "left" || dir === "right")) {
    nudgeRange(cur, dir === "right" ? 1 : -1);
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let primary: number, cross: number;
    if (dir === "down") {
      primary = b.top - a.bottom;
      cross = Math.abs(bx - ax);
      if (by <= ay + 2) continue;
    } else if (dir === "up") {
      primary = a.top - b.bottom;
      cross = Math.abs(bx - ax);
      if (by >= ay - 2) continue;
    } else if (dir === "right") {
      primary = b.left - a.right;
      cross = Math.abs(by - ay);
      if (bx <= ax + 2) continue;
    } else {
      primary = a.left - b.right;
      cross = Math.abs(by - ay);
      if (bx >= ax - 2) continue;
    }
    const score = Math.max(0, primary) + cross * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusEl(best);
}

function nudgeRange(el: HTMLInputElement, sign: 1 | -1) {
  const step = Number(el.step) || 1;
  const min = el.min === "" ? 0 : Number(el.min);
  const max = el.max === "" ? 100 : Number(el.max);
  const v = Math.min(max, Math.max(min, Math.round((Number(el.value) + sign * step) / step) * step));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, String(Number(v.toFixed(4))));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function activate(root: HTMLElement) {
  const cur = currentIn(root);
  if (!cur) {
    // Nothing focused yet: A presses the menu's default action, else focuses the first item.
    const def = root.querySelector<HTMLElement>("[data-nav-default]");
    const first = def ?? candidates(root)[0];
    if (first) focusEl(first);
    if (def) def.click();
    return;
  }
  if (cur instanceof HTMLInputElement && cur.type === "range") return;
  cur.click();
}

/** Global focus ring for pad-focused elements (render once inside a menu). */
export const PAD_FOCUS_CSS =
  "[data-pad-focus]{outline:2px solid #fff!important;outline-offset:2px;box-shadow:0 0 0 4px rgba(255,255,255,.16)!important}";

/** Clicks dispatched by gamepad navigation are untrusted (`isTrusted === false`): they can't take pointer lock. */
export function viaFromEvent(e: { nativeEvent: Event }): "pad" | undefined {
  return e.nativeEvent.isTrusted ? undefined : "pad";
}
