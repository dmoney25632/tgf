import type { QualityName } from "../config";
import { platformFrom, type Platform } from "./touchMath";

/**
 * Browser-side device checks for mobile play. Safe to import anywhere (no
 * three.js); every function returns the desktop answer during SSR.
 *
 * `?touch=1` / `?touch=0` on the URL forces touch controls on/off for this
 * tab (testing on a touchscreen laptop, or opting out on a tablet with a
 * keyboard).
 */

const FORCE_KEY = "tgf.touch.force";

let cached: Platform | null = null;

export function platform(): Platform {
  if (cached) return cached;
  if (typeof navigator === "undefined" || typeof window === "undefined") return { ios: false, android: false, touch: false };
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  cached = platformFrom(navigator.userAgent, navigator.maxTouchPoints ?? 0, coarse);
  return cached;
}

/** Use on-screen touch controls instead of pointer lock. */
export function touchControlsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("touch");
    if (q === "1" || q === "0") window.sessionStorage.setItem(FORCE_KEY, q);
    const forced = window.sessionStorage.getItem(FORCE_KEY);
    if (forced === "1") return true;
    if (forced === "0") return false;
  } catch {
    // sessionStorage blocked: fall through to detection.
  }
  return platform().touch;
}

/** Launched from the home screen (iOS) or as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
  return mm("(display-mode: fullscreen)") || mm("(display-mode: standalone)") || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Default quality preset for a phone/tablet (null on desktop: use the
 * desktop detection). Presets are re-tuned for mobile GPUs (mobileQuality.ts),
 * so "medium" here is a phone-sized medium. Recent iPhones and Android
 * flagships get it; older or low-memory devices start on low. Auto quality
 * steps down further if frames stay slow.
 */
export function mobileDefaultQuality(): QualityName | null {
  if (!touchControlsEnabled()) return null;
  const p = platform();
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (p.ios) {
    // Safari hides memory and caps cores at a fixed value; iOS 16.4+ devices
    // (A13 and newer) report 4+ logical cores via hardwareConcurrency.
    return cores >= 4 ? "medium" : "low";
  }
  if ((memory ?? 4) >= 6 && cores >= 8) return "medium";
  return "low";
}
