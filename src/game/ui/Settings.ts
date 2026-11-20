import { CAMERA, type QualityName } from "../config";

/**
 * Player-facing settings: what the settings menu edits, what the engine reads
 * and what is persisted in localStorage. Pure data + helpers (no DOM, no
 * three.js), so the React shell can import it without pulling in the engine.
 */

/** Rebindable actions. `code` is the canonical (default) key the game logic reads. */
export const ACTIONS = [
  { id: "forward", label: "Move forward", code: "KeyW" },
  { id: "back", label: "Move back", code: "KeyS" },
  { id: "left", label: "Strafe left", code: "KeyA" },
  { id: "right", label: "Strafe right", code: "KeyD" },
  { id: "jump", label: "Jump / mantle", code: "Space" },
  { id: "sprint", label: "Sprint", code: "ShiftLeft" },
  { id: "crouch", label: "Crouch / slide (toggle)", code: "KeyC" },
  { id: "crouchHold", label: "Crouch (hold)", code: "ControlLeft" },
  { id: "fire", label: "Fire", code: "Mouse0" },
  { id: "ads", label: "Aim down sights", code: "Mouse2" },
  { id: "reload", label: "Reload", code: "KeyR" },
  { id: "interact", label: "Interact / revive", code: "KeyF" },
  { id: "melee", label: "Knife", code: "KeyV" },
  { id: "grenade", label: "Frag grenade", code: "KeyG" },
  { id: "swap", label: "Switch weapon", code: "KeyQ" },
  { id: "scoreboard", label: "Scoreboard", code: "Tab" },
  { id: "readyUp", label: "Ready up", code: "KeyN" },
] as const;

export type ActionId = (typeof ACTIONS)[number]["id"];
export type Bindings = Record<ActionId, string>;

export const DEFAULT_BINDINGS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.code])) as Bindings;

export type PadCurve = "standard" | "linear" | "dynamic";

export type GameSettings = {
  // Graphics
  quality: QualityName;
  /** Horizontal-ish world FOV in degrees (vertical FOV, like CAMERA.fov). */
  fov: number;
  showFps: boolean;
  /** Drop to a lighter preset by itself when frames stay slow. */
  autoQuality: boolean;
  // Audio
  volume: number;
  /** Weapons, footsteps, impacts, explosions (0..1). */
  effectsVolume: number;
  /** Hit markers, cash, wave cues (0..1). */
  uiVolume: number;
  // Mouse
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  /** Extra multiplier while aiming. */
  adsSensitivity: number;
  /** Vertical look speed relative to horizontal (1 = same). */
  verticalRatio: number;
  invertY: boolean;
  /** Ask for unaccelerated (raw) pointer-lock movement. Off = OS pointer feel. */
  rawInput: boolean;
  // Controller
  padSensitivity: number;
  padAdsSensitivity: number;
  padInvertY: boolean;
  padCurve: PadCurve;
  /** Inner stick deadzone, 0..1 of the stick radius. */
  padDeadzone: number;
  aimAssist: boolean;
  vibration: boolean;
  // Keyboard
  bindings: Bindings;
};

export const FOV_RANGE = [70, 110] as const;

export const DEFAULT_SETTINGS: GameSettings = {
  quality: "medium",
  fov: CAMERA.fov,
  showFps: true,
  autoQuality: true,
  volume: 0.8,
  effectsVolume: 1,
  uiVolume: 0.85,
  sensitivity: 1,
  adsSensitivity: 1,
  verticalRatio: 1,
  invertY: false,
  rawInput: false,
  padSensitivity: 1,
  padAdsSensitivity: 1,
  padInvertY: false,
  padCurve: "standard",
  padDeadzone: 0.12,
  aimAssist: true,
  vibration: true,
  bindings: DEFAULT_BINDINGS,
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Fills gaps and clamps anything out of range (old or hand-edited storage). */
export function sanitizeSettings(raw: Partial<GameSettings> | null | undefined, fallbackQuality: QualityName = "medium"): GameSettings {
  const r = (raw ?? {}) as Partial<Record<keyof GameSettings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const quality = r.quality === "low" || r.quality === "medium" || r.quality === "high" ? r.quality : fallbackQuality;
  const curve = r.padCurve === "linear" || r.padCurve === "dynamic" || r.padCurve === "standard" ? r.padCurve : d.padCurve;
  const bindings = { ...DEFAULT_BINDINGS };
  if (r.bindings && typeof r.bindings === "object") {
    for (const a of ACTIONS) {
      const v = (r.bindings as Record<string, unknown>)[a.id];
      if (typeof v === "string" && v && v !== "Escape") bindings[a.id] = v;
    }
  }
  return {
    quality,
    fov: Math.round(clamp(r.fov, FOV_RANGE[0], FOV_RANGE[1], d.fov)),
    showFps: bool(r.showFps, d.showFps),
    autoQuality: bool(r.autoQuality, d.autoQuality),
    volume: clamp(r.volume, 0, 1, d.volume),
    effectsVolume: clamp(r.effectsVolume, 0, 1, d.effectsVolume),
    uiVolume: clamp(r.uiVolume, 0, 1, d.uiVolume),
    sensitivity: clamp(r.sensitivity, 0.1, 5, d.sensitivity),
    adsSensitivity: clamp(r.adsSensitivity, 0.2, 2, d.adsSensitivity),
    verticalRatio: clamp(r.verticalRatio, 0.5, 1.5, d.verticalRatio),
    invertY: bool(r.invertY, d.invertY),
    rawInput: bool(r.rawInput, d.rawInput),
    padSensitivity: clamp(r.padSensitivity, 0.2, 3, d.padSensitivity),
    padAdsSensitivity: clamp(r.padAdsSensitivity, 0.2, 2, d.padAdsSensitivity),
    padInvertY: bool(r.padInvertY, d.padInvertY),
    padCurve: curve,
    padDeadzone: clamp(r.padDeadzone, 0.02, 0.35, d.padDeadzone),
    aimAssist: bool(r.aimAssist, d.aimAssist),
    vibration: bool(r.vibration, d.vibration),
    bindings,
  };
}

/**
 * Assign `code` to `action`. If another action already used that code the two
 * swap, so no key is ever bound twice and nothing is left unbound.
 */
export function rebind(bindings: Bindings, action: ActionId, code: string): Bindings {
  const next = { ...bindings };
  const prev = next[action];
  for (const a of ACTIONS) if (a.id !== action && next[a.id] === code) next[a.id] = prev;
  next[action] = code;
  return next;
}

/**
 * Physical code → canonical code the game reads (null = swallowed because its
 * canonical meaning was rebound elsewhere). Codes not in the map pass through.
 */
export function buildRemap(bindings: Bindings): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const a of ACTIONS) if (bindings[a.id] !== a.code) map.set(a.code, null);
  for (const a of ACTIONS) map.set(bindings[a.id], a.code);
  return map;
}

const NAMED: Record<string, string> = {
  Mouse0: "LMB",
  Mouse1: "MMB",
  Mouse2: "RMB",
  Mouse3: "M4",
  Mouse4: "M5",
  Space: "Space",
  ShiftLeft: "Shift",
  ShiftRight: "R-Shift",
  ControlLeft: "Ctrl",
  ControlRight: "R-Ctrl",
  AltLeft: "Alt",
  AltRight: "R-Alt",
  MetaLeft: "Cmd",
  Tab: "Tab",
  CapsLock: "Caps",
  Enter: "Enter",
  Backspace: "Bksp",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Short keycap label for a KeyboardEvent.code / "MouseN". */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

const STORAGE_KEY = "tgf.iron-horizon.settings";

export function loadSettings(fallbackQuality: QualityName): GameSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? (JSON.parse(raw) as Partial<GameSettings>) : null, fallbackQuality);
  } catch {
    return sanitizeSettings(null, fallbackQuality);
  }
}

export function saveSettings(s: GameSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked (private mode etc.) — preferences just won't persist.
  }
}
