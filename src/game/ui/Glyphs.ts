import { ACTIONS, DEFAULT_BINDINGS, keyLabel, type ActionId, type Bindings } from "./Settings";

/**
 * Button prompt glyphs as self-contained inline HTML/SVG (original, plain
 * shapes: keycaps, a mouse, round face buttons with letters or simple
 * geometric symbols, bumper/trigger tabs, a d-pad cross). Used by the DOM HUD
 * and, via dangerouslySetInnerHTML, by the React menus.
 */

export type GlyphDevice = "kbm" | "pad";
export type GlyphLayout = "xbox" | "ps";
export type PadButtonName =
  | "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "L3" | "R3" | "LS" | "RS"
  | "UP" | "DOWN" | "LEFT" | "RIGHT" | "MENU" | "VIEW";

/** Shared prompt context. The engine updates it; HUDs re-render when `version` changes. */
export const glyphContext: { device: GlyphDevice; layout: GlyphLayout; bindings: Bindings; version: number } = {
  device: "kbm",
  layout: "xbox",
  bindings: DEFAULT_BINDINGS,
  version: 0,
};

/** Default gamepad mapping (see Input.poll). */
export const PAD_ACTIONS: Record<ActionId, PadButtonName> = {
  forward: "LS",
  back: "LS",
  left: "LS",
  right: "LS",
  jump: "A",
  sprint: "L3",
  crouch: "B",
  crouchHold: "B",
  fire: "RT",
  ads: "LT",
  reload: "X",
  interact: "X",
  melee: "R3",
  grenade: "RB",
  swap: "Y",
  scoreboard: "UP",
  readyUp: "DOWN",
};

const FG = "#eef0ea";
const BG = "rgba(10,12,10,.62)";
const box = (w: number, h: number, inner: string, title = "") =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:inline-block;vertical-align:-0.28em;overflow:visible" role="img" aria-label="${title}">${inner}</svg>`;

function face(letter: string, layout: GlyphLayout, s: number) {
  const r = s / 2 - 1;
  const c = s / 2;
  let mark: string;
  if (layout === "ps") {
    const k = r * 0.48;
    if (letter === "A") mark = `<path d="M${c - k} ${c - k}L${c + k} ${c + k}M${c + k} ${c - k}L${c - k} ${c + k}" stroke="${FG}" stroke-width="1.6" stroke-linecap="round"/>`;
    else if (letter === "B") mark = `<circle cx="${c}" cy="${c}" r="${k}" fill="none" stroke="${FG}" stroke-width="1.5"/>`;
    else if (letter === "X") mark = `<rect x="${c - k}" y="${c - k}" width="${2 * k}" height="${2 * k}" fill="none" stroke="${FG}" stroke-width="1.5"/>`;
    else mark = `<path d="M${c} ${c - k * 1.1}L${c + k} ${c + k * 0.75}H${c - k}Z" fill="none" stroke="${FG}" stroke-width="1.5" stroke-linejoin="round"/>`;
  } else {
    mark = `<text x="${c}" y="${c + s * 0.19}" text-anchor="middle" font-size="${s * 0.56}" font-weight="700" font-family="var(--font-geist-sans),system-ui,sans-serif" fill="${FG}">${letter}</text>`;
  }
  return box(s, s, `<circle cx="${c}" cy="${c}" r="${r}" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>${mark}`, letter);
}

function tab(label: string, s: number, trigger: boolean) {
  const w = Math.round(s * 1.5);
  const shape = trigger
    ? `<path d="M1.5 ${s - 1.5}V${s * 0.42}Q1.5 1.5 ${w / 2} 1.5Q${w - 1.5} 1.5 ${w - 1.5} ${s * 0.42}V${s - 1.5}Z" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>`
    : `<rect x="1" y="${s * 0.18}" width="${w - 2}" height="${s * 0.68}" rx="${s * 0.3}" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>`;
  return box(w, s, `${shape}<text x="${w / 2}" y="${s * 0.7}" text-anchor="middle" font-size="${s * 0.42}" font-weight="700" font-family="var(--font-geist-sans),system-ui,sans-serif" fill="${FG}">${label}</text>`, label);
}

function stick(side: "L" | "R", click: boolean, s: number) {
  const c = s / 2;
  return box(
    s,
    s,
    `<circle cx="${c}" cy="${c}" r="${c - 1}" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>` +
      `<circle cx="${c}" cy="${c}" r="${c * 0.55}" fill="none" stroke="${FG}" stroke-width="1" opacity=".55"/>` +
      `<text x="${c}" y="${c + s * 0.17}" text-anchor="middle" font-size="${s * 0.46}" font-weight="700" font-family="var(--font-geist-sans),system-ui,sans-serif" fill="${FG}">${side}</text>` +
      (click ? `<path d="M${c} ${s + 1.5}v2.5" stroke="${FG}" stroke-width="1.4" stroke-linecap="round"/>` : ""),
    `${side}${click ? "3" : " stick"}`,
  );
}

function dpad(dir: "UP" | "DOWN" | "LEFT" | "RIGHT", s: number) {
  const a = s / 3;
  const arm = (x: number, y: number, on: boolean) => `<rect x="${x}" y="${y}" width="${a}" height="${a}" fill="${on ? FG : BG}" stroke="${FG}" stroke-width="1"/>`;
  return box(
    s,
    s,
    arm(a, 0, dir === "UP") + arm(a, 2 * a, dir === "DOWN") + arm(0, a, dir === "LEFT") + arm(2 * a, a, dir === "RIGHT") + `<rect x="${a}" y="${a}" width="${a}" height="${a}" fill="${BG}"/>`,
    `d-pad ${dir.toLowerCase()}`,
  );
}

function menuBtn(view: boolean, s: number) {
  const w = Math.round(s * 1.3);
  const inner = view
    ? `<rect x="${w * 0.3}" y="${s * 0.3}" width="${w * 0.28}" height="${s * 0.3}" fill="none" stroke="${FG}" stroke-width="1.1"/><rect x="${w * 0.42}" y="${s * 0.42}" width="${w * 0.28}" height="${s * 0.3}" fill="${FG}"/>`
    : `<path d="M${w * 0.32} ${s * 0.36}h${w * 0.36}M${w * 0.32} ${s * 0.5}h${w * 0.36}M${w * 0.32} ${s * 0.64}h${w * 0.36}" stroke="${FG}" stroke-width="1.3" stroke-linecap="round"/>`;
  return box(w, s, `<rect x="1" y="${s * 0.12}" width="${w - 2}" height="${s * 0.76}" rx="${s * 0.38}" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>${inner}`, view ? "view" : "menu");
}

export function padGlyph(btn: PadButtonName, layout: GlyphLayout = glyphContext.layout, size = 18): string {
  const ps = layout === "ps";
  switch (btn) {
    case "A":
    case "B":
    case "X":
    case "Y":
      return face(btn, layout, size);
    case "LB":
      return tab(ps ? "L1" : "LB", size, false);
    case "RB":
      return tab(ps ? "R1" : "RB", size, false);
    case "LT":
      return tab(ps ? "L2" : "LT", size, true);
    case "RT":
      return tab(ps ? "R2" : "RT", size, true);
    case "L3":
      return stick("L", true, size);
    case "R3":
      return stick("R", true, size);
    case "LS":
      return stick("L", false, size);
    case "RS":
      return stick("R", false, size);
    case "MENU":
      return menuBtn(false, size);
    case "VIEW":
      return menuBtn(true, size);
    default:
      return dpad(btn, size);
  }
}

function mouseGlyph(button: number, s: number) {
  const w = Math.round(s * 0.78);
  const h = s;
  const half = (left: boolean) =>
    left
      ? `<path d="M${w / 2} 1.5V${h * 0.42}H1.5V${h * 0.38}Q1.5 1.5 ${w / 2} 1.5Z" fill="${FG}"/>`
      : `<path d="M${w / 2} 1.5V${h * 0.42}H${w - 1.5}V${h * 0.38}Q${w - 1.5} 1.5 ${w / 2} 1.5Z" fill="${FG}"/>`;
  const fill = button === 0 ? half(true) : button === 2 ? half(false) : button === 1 ? `<rect x="${w / 2 - 1.5}" y="${h * 0.12}" width="3" height="${h * 0.22}" rx="1.5" fill="${FG}"/>` : "";
  const extra = button > 2 ? `<text x="${w / 2}" y="${h * 0.8}" text-anchor="middle" font-size="${s * 0.36}" font-weight="700" font-family="var(--font-geist-sans),system-ui,sans-serif" fill="${FG}">${button + 1}</text>` : "";
  return box(
    w,
    h,
    `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${w / 2 - 1.5}" fill="${BG}" stroke="${FG}" stroke-width="1.3"/>${fill}<path d="M${w / 2} 1.5V${h * 0.42}M1.5 ${h * 0.42}H${w - 1.5}" stroke="${FG}" stroke-width="1"/>${extra}`,
    keyLabel(`Mouse${button}`),
  );
}

/** Keycap (or mouse) glyph for a KeyboardEvent.code / "MouseN". */
export function keyGlyph(code: string, size = 18): string {
  const m = /^Mouse(\d)$/.exec(code);
  if (m) return mouseGlyph(Number(m[1]), size);
  const label = keyLabel(code);
  const wide = label.length > 1;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:${size}px;height:${size}px;padding:0 ${wide ? 5 : 0}px;box-sizing:border-box;border:1.3px solid ${FG};border-bottom-width:2.5px;border-radius:4px;background:${BG};color:${FG};font:700 ${Math.round(size * (wide ? 0.5 : 0.6))}px/1 var(--font-geist-sans),system-ui,sans-serif;letter-spacing:0;text-transform:uppercase;vertical-align:-0.28em;text-shadow:none">${escapeGlyphText(label)}</span>`;
}

/** Glyph for an action on the current (or given) device. */
export function actionGlyph(action: ActionId, ctx: Pick<typeof glyphContext, "device" | "layout" | "bindings"> = glyphContext, size = 18): string {
  return ctx.device === "pad" ? padGlyph(PAD_ACTIONS[action], ctx.layout, size) : keyGlyph(ctx.bindings[action] ?? DEFAULT_BINDINGS[action], size);
}

const TOKEN_CODES: Record<string, string> = { TAB: "Tab", SPACE: "Space", SHIFT: "ShiftLeft", CTRL: "ControlLeft", LMB: "Mouse0", RMB: "Mouse2" };
const ACTION_BY_CODE = new Map<string, ActionId>(ACTIONS.map((a) => [a.code, a.id]));

/**
 * Escapes `text` and turns "[F]"-style tokens (written against the default
 * keyboard layout) into glyphs for the player's device and bindings.
 */
export function formatPrompt(text: string, ctx: Pick<typeof glyphContext, "device" | "layout" | "bindings"> = glyphContext, size = 18): string {
  const safe = escapeGlyphText(text);
  return safe.replace(/\[([A-Z0-9]{1,5})\]/g, (whole, t: string, offset: number) => {
    const code = TOKEN_CODES[t] ?? (/^[A-Z]$/.test(t) ? `Key${t}` : /^[0-9]$/.test(t) ? `Digit${t}` : "");
    const action = ACTION_BY_CODE.get(code);
    // On a pad, interact shares X with reload and needs a short hold.
    if (action === "interact" && ctx.device === "pad" && !/HOLD\s*$/i.test(safe.slice(0, offset))) return `HOLD ${actionGlyph(action, ctx, size)}`;
    if (action) return actionGlyph(action, ctx, size);
    return code ? keyGlyph(code, size) : whole;
  });
}

function escapeGlyphText(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
