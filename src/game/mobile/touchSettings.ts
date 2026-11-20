/**
 * Touch-control preferences, stored per device (separately from the main
 * game settings, which a phone shares with nothing). Live: the controls and
 * the pause-menu panel subscribe, so changes apply mid-match.
 */
export type TouchSettings = {
  /** Look speed multiplier. */
  sensitivity: number;
  /** Look speed while aiming down sights (multiplier on the above). */
  adsSensitivity: number;
  /** On-screen button size multiplier. */
  buttonScale: number;
  /** Idle button opacity (pressed buttons are always bright). */
  opacity: number;
  /** Mirror the layout: stick on the right, buttons and look on the left. */
  leftHanded: boolean;
  /** Extra fire button on the stick side. */
  leftFire: boolean;
};

export const DEFAULT_TOUCH_SETTINGS: TouchSettings = {
  sensitivity: 1,
  adsSensitivity: 0.6,
  buttonScale: 1,
  opacity: 0.55,
  leftHanded: false,
  leftFire: true,
};

export const TOUCH_LIMITS = {
  sensitivity: [0.2, 3],
  adsSensitivity: [0.2, 1.5],
  buttonScale: [0.7, 1.3],
  opacity: [0.15, 1],
} as const;

const KEY = "tgf.iron-horizon.touch";

function num(v: unknown, [lo, hi]: readonly [number, number], fallback: number) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function sanitizeTouchSettings(raw: unknown): TouchSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof TouchSettings, unknown>>;
  const d = DEFAULT_TOUCH_SETTINGS;
  return {
    sensitivity: num(r.sensitivity, TOUCH_LIMITS.sensitivity, d.sensitivity),
    adsSensitivity: num(r.adsSensitivity, TOUCH_LIMITS.adsSensitivity, d.adsSensitivity),
    buttonScale: num(r.buttonScale, TOUCH_LIMITS.buttonScale, d.buttonScale),
    opacity: num(r.opacity, TOUCH_LIMITS.opacity, d.opacity),
    leftHanded: typeof r.leftHanded === "boolean" ? r.leftHanded : d.leftHanded,
    leftFire: typeof r.leftFire === "boolean" ? r.leftFire : d.leftFire,
  };
}

let current: TouchSettings | null = null;
const listeners = new Set<(s: TouchSettings) => void>();

export function getTouchSettings(): TouchSettings {
  if (current) return current;
  let raw: unknown = null;
  try {
    raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
  } catch {
    // Storage blocked or corrupt: defaults.
  }
  current = sanitizeTouchSettings(raw);
  return current;
}

export function setTouchSettings(patch: Partial<TouchSettings>) {
  current = sanitizeTouchSettings({ ...getTouchSettings(), ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted (private mode); still applies for this session.
  }
  for (const l of listeners) l(current);
  return current;
}

export function subscribeTouchSettings(fn: (s: TouchSettings) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
