/**
 * On-screen button layout for landscape touch play (right-handed; the
 * left-handed layout mirrors it). Offsets are CSS px from the bottom corner
 * on the button side (or from the top for `top` buttons) before the
 * button-size multiplier and the safe-area insets are applied. The cluster
 * hugs the bottom-right corner and stays outside the centre of the screen
 * so the crosshair area is always clear.
 */
export type TouchButtonDef = {
  id: string;
  /** Canonical input code it holds while pressed (null = handled specially). */
  code: string | null;
  label: string;
  size: number;
  /** Horizontal offset from the button-side edge (px). */
  x: number;
  /** Vertical offset from the bottom edge (or the top edge when `top`). */
  y: number;
  top?: boolean;
  /** Anchored on the stick side instead of the button side. */
  stickSide?: boolean;
  /** Dragging this button also aims (fire buttons). */
  look?: boolean;
  /** Tap toggles instead of hold (aim down sights). */
  toggle?: boolean;
  /** Only shown while the HUD offers it (survival prompts / ready-up). */
  context?: "interact" | "ready";
  /** Horizontally centred (contextual pills); `x` is then ignored. */
  center?: boolean;
};

export const TOUCH_BUTTONS: readonly TouchButtonDef[] = [
  { id: "fire", code: "Mouse0", label: "FIRE", size: 80, x: 30, y: 102, look: true },
  { id: "ads", code: "Mouse2", label: "AIM", size: 60, x: 134, y: 64, toggle: true },
  { id: "jump", code: "Space", label: "JUMP", size: 58, x: 20, y: 22 },
  { id: "crouch", code: "KeyC", label: "CROUCH", size: 54, x: 94, y: 6 },
  { id: "reload", code: "KeyR", label: "RELOAD", size: 50, x: 126, y: 156 },
  { id: "swap", code: "KeyQ", label: "SWAP", size: 50, x: 40, y: 204 },
  { id: "grenade", code: "KeyG", label: "FRAG", size: 46, x: 186, y: 146 },
  { id: "melee", code: "KeyV", label: "KNIFE", size: 44, x: 204, y: 24 },
  { id: "use", code: "KeyF", label: "USE", size: 50, x: 150, y: 236 },
  { id: "fire2", code: "Mouse0", label: "FIRE", size: 58, x: 30, y: 176, stickSide: true, look: true },
  { id: "pause", code: null, label: "PAUSE", size: 40, x: 10, y: 8, top: true },
  { id: "score", code: "Tab", label: "SCORE", size: 40, x: 56, y: 8, top: true },
  { id: "usePill", code: "KeyF", label: "TAP TO USE", size: 46, x: 0, y: 0, center: true, context: "interact" },
  { id: "ready", code: "KeyN", label: "READY", size: 40, x: 0, y: 64, top: true, center: true, context: "ready" },
];

/** Ids the left-fire setting can hide. */
export const OPTIONAL_BUTTONS = { leftFire: "fire2" } as const;

/** Rect of a button in a w×h viewport (CSS px, no insets) — for tests and hit checks. */
export function buttonRect(b: TouchButtonDef, w: number, h: number, scale: number, leftHanded: boolean) {
  const s = b.size * scale;
  const onRight = (b.stickSide ? false : true) !== leftHanded;
  const left = b.center ? (w - s * 2.4) / 2 : onRight ? w - b.x * scale - s : b.x * scale;
  const width = b.center ? s * 2.4 : s;
  const top = b.top ? b.y * scale : b.center && !b.top ? h / 2 + 92 : h - b.y * scale - s;
  return { left, top, width, height: s };
}
