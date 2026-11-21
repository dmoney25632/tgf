import { OPERATORS, OPERATOR_IDS, type OperatorId } from "./survival/config";

/**
 * A player's saved character: class (operator perks + default loadout) and
 * appearance. Plain data so it can travel in presence payloads and live in
 * localStorage. Colours are 0xRRGGBB numbers.
 */
export type CharacterLook = {
  uniform: number;
  vest: number;
  helmet: number;
  accent: number;
  skin: number;
  /** Gear variant (headgear, sleeves, rig, facial hair): 0..GEAR.length-1. */
  gear: number;
};

export type Character = { operator: OperatorId; look: CharacterLook };

export const SKIN_TONES = [0xecc4a6, 0xdcaa88, 0xc99470, 0xb27c58, 0x96633f, 0x75472b, 0x56341f] as const;

export const UNIFORM_COLORS = [
  { name: "Olive", hex: 0x4d5240 },
  { name: "Khaki", hex: 0x6b5d45 },
  { name: "Slate", hex: 0x2f3a40 },
  { name: "Charcoal", hex: 0x3d3833 },
  { name: "Sand", hex: 0x8a7a5a },
  { name: "Forest", hex: 0x2f4030 },
  { name: "Navy", hex: 0x26304a },
  { name: "Black", hex: 0x1e1f22 },
] as const;

export const GEAR_COLORS = [
  { name: "Ranger", hex: 0x3a3f2e },
  { name: "Coyote", hex: 0x5a4c36 },
  { name: "Wolf", hex: 0x4a4d50 },
  { name: "Black", hex: 0x2a2826 },
  { name: "Tan", hex: 0x7a6a4a },
  { name: "Steel", hex: 0x26302f },
] as const;

export const ACCENT_COLORS = [
  { name: "Amber", hex: 0xe0a040 },
  { name: "Cyan", hex: 0x5ac8e8 },
  { name: "Lime", hex: 0x9be070 },
  { name: "Red", hex: 0xe85a40 },
  { name: "White", hex: 0xe8e8e8 },
  { name: "Violet", hex: 0xa070e0 },
] as const;

/** Names for Humanoid STD_LOOKS variants, in order. */
export const GEAR = ["Helmet + glasses", "Cap", "Goggles + shemagh", "Bareheaded", "Balaclava", "Helmet + shades"] as const;

export function defaultCharacter(operator: OperatorId = "ridge"): Character {
  const c = OPERATORS[operator].colors;
  return { operator, look: { uniform: c.sleeve, vest: c.vest, helmet: c.helmet, accent: c.accent, skin: SKIN_TONES[2], gear: 0 } };
}

const isColor = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xffffff;

/** Validates untrusted data (localStorage, another player's presence). */
export function sanitizeLook(raw: unknown, fallback: CharacterLook = defaultCharacter().look): CharacterLook {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof CharacterLook, unknown>>;
  const gear = Number(r.gear);
  return {
    uniform: isColor(r.uniform) ? r.uniform : fallback.uniform,
    vest: isColor(r.vest) ? r.vest : fallback.vest,
    helmet: isColor(r.helmet) ? r.helmet : fallback.helmet,
    accent: isColor(r.accent) ? r.accent : fallback.accent,
    skin: isColor(r.skin) ? r.skin : fallback.skin,
    gear: Number.isInteger(gear) && gear >= 0 && gear < GEAR.length ? gear : fallback.gear,
  };
}

export function sanitizeCharacter(raw: unknown): Character {
  const r = (raw && typeof raw === "object" ? raw : {}) as { operator?: unknown; look?: unknown };
  const operator = OPERATOR_IDS.includes(r.operator as OperatorId) ? (r.operator as OperatorId) : "ridge";
  return { operator, look: sanitizeLook(r.look, defaultCharacter(operator).look) };
}

/** Humanoid look for this character (full soldier: menu preview, teammates). */
export function humanoidLook(look: CharacterLook) {
  return { uniform: look.uniform, vest: look.vest, helmet: look.helmet, accent: look.accent, skin: look.skin, kit: "standard" as const, scale: 1, variant: look.gear };
}

/** First-person arms: gloves follow the vest, sleeves the uniform. */
export function viewmodelColors(look: CharacterLook): [glove: number, sleeve: number] {
  return [look.vest, look.uniform];
}

export const CHARACTER_KEY = "tgf.iron-horizon.character";

export function loadCharacter(): Character {
  try {
    const raw = window.localStorage.getItem(CHARACTER_KEY);
    return raw ? sanitizeCharacter(JSON.parse(raw)) : defaultCharacter();
  } catch {
    return defaultCharacter();
  }
}

export function saveCharacter(c: Character) {
  try {
    window.localStorage.setItem(CHARACTER_KEY, JSON.stringify(c));
  } catch {
    // Storage blocked: the character lasts for this visit only.
  }
}

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
