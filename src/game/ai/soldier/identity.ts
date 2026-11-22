/**
 * Who a motion-captured soldier is: which Rocketbox body, face, helmet and
 * vest parts he is assembled from, his skin tone, facial hair, headgear,
 * extra kit and build. Pure data + maths (no three.js), unit-tested.
 *
 * NPCs derive an identity from their agent id: the face walks a fixed
 * order (so consecutive ids never share a face) and everything else comes
 * from a hash of the id, so the same soldier always looks the same and a
 * squad of twenty reads as twenty people. Players (and teammates) derive
 * theirs from their saved look: gear variant + skin tone.
 */

export const AVATAR_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
export type Part = "body" | "head" | "helmet" | "equipment";

/** Static facts about each avatar (mirrors public/assets/characters/soldiers/soldiers.json). */
export const AVATARS: Record<AvatarId, { sex: "m" | "f"; cap: boolean; parts: readonly Part[]; tone: number; knees: boolean }> = {
  // Military_Male_01: dark skin, gloves, knee pads off.
  a: { sex: "m", cap: false, parts: ["body", "head", "helmet", "equipment"], tone: 0x42281d, knees: false },
  // Military_Male_03: light skin, rolled sleeves, knee pads.
  b: { sex: "m", cap: false, parts: ["body", "head", "helmet", "equipment"], tone: 0x9c6a4e, knees: true },
  // Military_Male_04: medium skin, knee pads.
  c: { sex: "m", cap: false, parts: ["body", "head", "helmet", "equipment"], tone: 0x80553b, knees: true },
  // Military_Male_02 / 05 / 06: field uniform with a patrol cap (part of the head mesh).
  d: { sex: "m", cap: true, parts: ["body", "head"], tone: 0x8d5c3d, knees: false },
  e: { sex: "m", cap: true, parts: ["body", "head"], tone: 0x97674b, knees: false },
  f: { sex: "m", cap: true, parts: ["body", "head"], tone: 0x42291d, knees: false },
  // Military_Female_01 / 02.
  g: { sex: "f", cap: false, parts: ["body", "head", "helmet", "equipment"], tone: 0xa07756, knees: true },
  h: { sex: "f", cap: false, parts: ["body", "head", "helmet", "equipment"], tone: 0x724d31, knees: true },
};

export type Kit = "standard" | "rusher" | "heavy" | "sniper" | "warden";
export type Headgear = "helmet" | "cap" | "boonie" | "bare";
export type Eyewear = "none" | "glasses" | "shades";
export type Pack = "none" | "hydration" | "assault";
export type Armour = "none" | "heavy" | "warden";

export type SoldierIdentity = {
  /** Uniform (and boots, hands) source. */
  body: AvatarId;
  /** Face source (same sex as the body). */
  head: AvatarId;
  /** Rocketbox helmet part source, or null (cap / boonie / bare head). */
  helmet: AvatarId | null;
  /** Rocketbox plate-carrier part source, or null (procedural chest rig or nothing). */
  vest: AvatarId | null;
  headgear: Headgear;
  balaclava: boolean;
  eyewear: Eyewear;
  goggles: boolean;
  shemagh: boolean;
  /** Light procedural chest rig (when there is no plate carrier). */
  chestRig: boolean;
  pack: Pack;
  radio: boolean;
  kneePads: boolean;
  /** Belt pouches / holster. */
  pouches: boolean;
  ghillie: boolean;
  armour: Armour;
  /** 0 clean shaven, ~0.45 stubble, 1 full beard. */
  beard: number;
  /** Skin tone (sRGB, one of the character SKIN_TONES scale) the face and hands are re-tinted to. */
  tone: number;
  /** Build: overall height scale, torso / shoulder width, limb thickness. */
  height: number;
  width: number;
  limbs: number;
};

/** Mirrors character.ts SKIN_TONES (light to deep). */
export const TONES = [0xecc4a6, 0xdcaa88, 0xc99470, 0xb27c58, 0x96633f, 0x75472b, 0x56341f] as const;
/** Photographed (shaded, averaged) skin reads darker than the albedo-ish palette tone. */
export const PHOTO_TO_TONE = 1 / 0.72;

const lum = (hex: number) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Index into TONES of the palette tone closest to an avatar's photographed skin. */
export function naturalToneIndex(id: AvatarId) {
  const l = lum(AVATARS[id].tone) * PHOTO_TO_TONE;
  let best = 0;
  for (let i = 1; i < TONES.length; i++) if (Math.abs(lum(TONES[i]) - l) < Math.abs(lum(TONES[best]) - l)) best = i;
  return best;
}

/** Integer hash (lowbias32): decorrelated streams from one seed. */
export function hash32(x: number) {
  x = (x | 0) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic random stream for a seed (n-th draw in [0, 1)). */
function stream(seed: number) {
  let i = 0;
  return () => hash32(seed * 0x9e3779b1 + 0x632be5ab * ++i) / 4294967296;
}

const pick = <T>(r: number, list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

/**
 * Face order NPC ids walk through: never the same face twice in a row,
 * helmet heads twice as often as cap heads, one woman in six.
 */
export const FACE_ORDER: readonly AvatarId[] = ["b", "d", "a", "g", "c", "e", "a", "b", "f", "c", "h", "d"];

const HELMET_HEADS_M: readonly AvatarId[] = ["a", "b", "c"];
const CAP_HEADS: readonly AvatarId[] = ["d", "e", "f"];
const VESTS_M: readonly AvatarId[] = ["a", "b", "c"];
const BODIES_M: readonly AvatarId[] = ["a", "b", "c", "d", "e", "f"];
const FEMALE: readonly AvatarId[] = ["g", "h"];

function base(head: AvatarId): SoldierIdentity {
  return {
    body: head,
    head,
    helmet: AVATARS[head].cap ? null : head,
    vest: AVATARS[head].parts.includes("equipment") ? head : null,
    headgear: AVATARS[head].cap ? "cap" : "helmet",
    balaclava: false,
    eyewear: "none",
    goggles: false,
    shemagh: false,
    chestRig: false,
    pack: "none",
    radio: false,
    kneePads: false,
    pouches: false,
    ghillie: false,
    armour: "none",
    beard: 0,
    tone: TONES[naturalToneIndex(head)],
    height: 1,
    width: 1,
    limbs: 1,
  };
}

/** Same-sex donor list for a part. */
const pool = (female: boolean, male: readonly AvatarId[]) => (female ? FEMALE : male);

/** NPC identity from an agent id and kit. */
export function npcIdentity(seed: number, kit: Kit): SoldierIdentity {
  const r = stream(seed);
  const i = ((seed % FACE_ORDER.length) + FACE_ORDER.length) % FACE_ORDER.length;
  let head: AvatarId = FACE_ORDER[i];
  // Kits with a fixed silhouette take a matching face from the same walk.
  if (kit === "rusher" || kit === "heavy" || kit === "sniper") head = HELMET_HEADS_M[i % 3];
  if (kit === "warden") head = CAP_HEADS[i % 3];
  const female = AVATARS[head].sex === "f";
  const id = base(head);
  id.body = female ? pick(r(), FEMALE) : kit === "heavy" ? pick(r(), VESTS_M) : AVATARS[head].cap ? head : pick(r(), BODIES_M);
  if (r() < 0.45) id.body = female ? head : AVATARS[head].cap ? head : id.body;
  // Skin: the face's own tone or one step either way.
  const t0 = naturalToneIndex(head);
  id.tone = TONES[Math.max(0, Math.min(TONES.length - 1, t0 + pick(r(), [-1, 0, 0, 1])))];
  id.beard = female ? 0 : pick(r(), [0, 0, 0.45, 0.45, 0.7, 1]);
  id.height = female ? 1 : 0.975 + r() * 0.05;
  id.width = 0.96 + r() * 0.08;
  id.limbs = 0.96 + r() * 0.08;

  const capHead = AVATARS[head].cap;
  const hg = r();
  id.headgear = capHead ? "cap" : hg < 0.64 ? "helmet" : hg < 0.78 ? "bare" : hg < 0.88 ? "boonie" : "helmet";
  id.balaclava = !capHead && !female && hg >= 0.88;
  id.helmet = id.headgear === "helmet" ? pick(r(), pool(female, HELMET_HEADS_M)) : null;
  const v = r();
  id.vest = v < 0.72 ? pick(r(), pool(female, VESTS_M)) : null;
  id.chestRig = !id.vest && v < 0.93;
  id.pack = pick(r(), ["none", "none", "hydration", "assault"] as const);
  id.radio = r() < 0.5;
  id.kneePads = !AVATARS[id.body].knees && r() < 0.5;
  id.pouches = r() < 0.6;
  id.goggles = id.headgear === "helmet" && r() < 0.3;
  const e = r();
  id.eyewear = id.balaclava ? "none" : e < 0.18 ? "glasses" : e < 0.34 ? "shades" : "none";
  id.shemagh = !id.balaclava && r() < 0.14;

  switch (kit) {
    case "rusher": // breacher: bump helmet, balaclava, goggles, pads, no pack
      id.headgear = "helmet";
      id.helmet = pick(r(), HELMET_HEADS_M);
      id.balaclava = true;
      id.goggles = true;
      id.eyewear = "none";
      id.vest ??= pick(r(), VESTS_M);
      id.chestRig = false;
      id.kneePads = !AVATARS[id.body].knees;
      id.pack = "none";
      id.shemagh = false;
      break;
    case "heavy": // Juggernaut: the bolt-on plate (EOD helmet included) goes over a full kit
      id.headgear = "bare";
      id.helmet = null;
      id.balaclava = true;
      id.eyewear = "none";
      id.goggles = false;
      id.shemagh = false;
      id.vest = pick(r(), VESTS_M);
      id.chestRig = false;
      id.pack = "none";
      id.armour = "heavy";
      id.width = 1.1;
      id.limbs = 1.08;
      break;
    case "sniper": // marksman: boonie, ghillie, light rig
      id.headgear = "boonie";
      id.helmet = null;
      id.balaclava = false;
      id.goggles = false;
      id.eyewear = "none";
      id.vest = null;
      id.chestRig = true;
      id.ghillie = true;
      id.shemagh = true;
      id.pack = "none";
      break;
    case "warden": // officer: patrol cap, shades, plate carrier, plate armour
      id.headgear = "cap";
      id.helmet = null;
      id.vest = pick(r(), ["a", "c"] as const);
      id.chestRig = false;
      id.eyewear = "shades";
      id.goggles = false;
      id.shemagh = false;
      id.balaclava = false;
      id.radio = true;
      id.pack = "none";
      id.armour = "warden";
      id.width = 1.12;
      id.limbs = 1.08;
      break;
  }
  return fitHead(id);
}

/**
 * Military_Male_01's head carries goggles strapped where a helmet would be:
 * without a helmet they would float, so a bare / boonie head uses another
 * face of the same skeleton (re-tinted to the same skin tone).
 */
function fitHead(id: SoldierIdentity): SoldierIdentity {
  if (id.head === "a" && id.headgear !== "helmet" && id.armour !== "heavy") id.head = "c";
  return id;
}

/**
 * A player's (or teammate's) identity from their saved look. gear follows
 * character.ts GEAR: 0 helmet + glasses, 1 cap, 2 goggles + shemagh,
 * 3 bareheaded, 4 balaclava, 5 helmet + shades. The face is the avatar
 * whose skin is closest to the chosen tone, re-tinted to it exactly.
 */
export function playerIdentity(gear: number, skin: number): SoldierIdentity {
  const cap = gear === 1;
  const heads = cap ? CAP_HEADS : HELMET_HEADS_M;
  const l = lum(skin);
  let head = heads[0];
  for (const h of heads) if (Math.abs(lum(AVATARS[h].tone) * PHOTO_TO_TONE - l) < Math.abs(lum(AVATARS[head].tone) * PHOTO_TO_TONE - l)) head = h;
  const id = base(head);
  id.tone = skin;
  id.vest = cap ? "a" : head;
  id.radio = true;
  id.pouches = true;
  id.kneePads = !AVATARS[id.body].knees;
  id.beard = 0.45;
  switch (gear) {
    case 0:
      id.eyewear = "glasses";
      id.pack = "hydration";
      break;
    case 1:
      id.beard = 1;
      break;
    case 2:
      id.goggles = true;
      id.shemagh = true;
      id.pack = "assault";
      id.beard = 0;
      break;
    case 3:
      id.headgear = "bare";
      id.helmet = null;
      id.vest = null;
      id.chestRig = true;
      id.beard = 1;
      break;
    case 4:
      id.balaclava = true;
      id.goggles = true;
      id.pack = "hydration";
      break;
    default:
      id.eyewear = "shades";
      id.pack = "assault";
  }
  return fitHead(id);
}

/** Which avatar each part comes from (null: not drawn). */
export function partSources(id: SoldierIdentity): Record<Part, AvatarId | null> {
  return { body: id.body, head: id.head, helmet: id.helmet, equipment: id.vest };
}

/** Stable key of everything visible (tests: neighbours must differ). */
export function identityKey(id: SoldierIdentity) {
  return [id.body, id.head, id.helmet ?? "-", id.vest ?? "-", id.headgear, +id.balaclava, id.eyewear, +id.goggles, +id.shemagh, +id.chestRig, id.pack, +id.radio, +id.kneePads, +id.pouches, id.beard, id.tone.toString(16), id.armour].join("|");
}
