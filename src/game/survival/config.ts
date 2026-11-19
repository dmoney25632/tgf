import type { WeaponId } from "../weapons/weapons";
import type { WeaponModifiers } from "../weapons/WeaponSystem";

/**
 * Survival-mode data. Everything here is original to Iron Horizon and is
 * plain config so balance passes never touch logic.
 */

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export type OperatorId = "ridge" | "mason" | "wren" | "bastion";

export type OperatorDef = {
  id: OperatorId;
  name: string;
  role: "Assault" | "Support" | "Recon" | "Heavy";
  blurb: string;
  traits: string[];
  primary: WeaponId;
  secondary: WeaponId;
  /** Look: glove, sleeve/uniform, vest, helmet, accent (hex). */
  colors: { glove: number; sleeve: number; vest: number; helmet: number; accent: number };
  maxHealth: number;
  startArmor: number;
  speed: number;
  grenades: number;
  /** Shop ammo price multiplier. */
  ammoDiscount: number;
  mods: Partial<WeaponModifiers>;
};

export const OPERATORS: Record<OperatorId, OperatorDef> = {
  ridge: {
    id: "ridge", name: "Ridge", role: "Assault",
    blurb: "Front-line rifleman. Fast hands, quick to the sights, always carries an extra frag.",
    traits: ["+20% ADS speed", "+1 frag grenade", "Starts with the VK-7"],
    primary: "vk7", secondary: "marrow9",
    colors: { glove: 0x2b2a26, sleeve: 0x4d5240, vest: 0x3a3f2e, helmet: 0x4a4f3a, accent: 0xe0a040 },
    maxHealth: 100, startArmor: 0, speed: 1, grenades: 3, ammoDiscount: 1,
    mods: { adsSpeed: 1.2 },
  },
  mason: {
    id: "mason", name: "Mason", role: "Support",
    blurb: "Keeps the team fed. Carries more ammunition and buys resupply at a discount.",
    traits: ["+25% reserve ammo", "Ammo resupply −50%", "Starts with the Anvil LMG"],
    primary: "anvil", secondary: "marrow9",
    colors: { glove: 0x34302a, sleeve: 0x6b5d45, vest: 0x5a4c36, helmet: 0x6b5d45, accent: 0x5ac8e8 },
    maxHealth: 100, startArmor: 0, speed: 0.98, grenades: 2, ammoDiscount: 0.5,
    mods: { reserve: 1.25 },
  },
  wren: {
    id: "wren", name: "Wren", role: "Recon",
    blurb: "Long-range specialist. Hits harder on the head and moves lighter on her feet.",
    traits: ["+25% headshot damage", "+6% move speed", "Starts with the Longreach DMR"],
    primary: "longreach", secondary: "ruin50",
    colors: { glove: 0x1e2226, sleeve: 0x2f3a40, vest: 0x26302f, helmet: 0x2f3a40, accent: 0x9be070 },
    maxHealth: 100, startArmor: 0, speed: 1.06, grenades: 2, ammoDiscount: 1,
    mods: { headshotDamage: 1.25 },
  },
  bastion: {
    id: "bastion", name: "Bastion", role: "Heavy",
    blurb: "Walking cover. Starts armored, soaks hits, and clears rooms up close.",
    traits: ["+25 max health", "Starts with 100 armor", "−6% move speed", "Starts with the Breacher 12"],
    primary: "breacher", secondary: "ruin50",
    colors: { glove: 0x2a2624, sleeve: 0x3d3833, vest: 0x2a2826, helmet: 0x3d3833, accent: 0xe85a40 },
    maxHealth: 125, startArmor: 100, speed: 0.94, grenades: 2, ammoDiscount: 1,
    mods: {},
  },
};

export const OPERATOR_IDS = Object.keys(OPERATORS) as OperatorId[];

// ---------------------------------------------------------------------------
// Perks (one-time purchases that last the match)
// ---------------------------------------------------------------------------

export type PerkId = "quickdraw" | "deadeye" | "ironhide" | "secondwind" | "fasthands";
export type PerkDef = { id: PerkId; name: string; price: number; desc: string; mods?: Partial<WeaponModifiers>; maxHealth?: number };

export const PERKS: Record<PerkId, PerkDef> = {
  quickdraw: { id: "quickdraw", name: "Quickdraw", price: 1500, desc: "+35% ADS speed", mods: { adsSpeed: 1.35 } },
  deadeye: { id: "deadeye", name: "Deadeye", price: 2000, desc: "−25% recoil, +15% headshot damage", mods: { recoil: 0.75, headshotDamage: 1.15 } },
  ironhide: { id: "ironhide", name: "Ironhide", price: 2500, desc: "+50 max health", maxHealth: 50 },
  secondwind: { id: "secondwind", name: "Second Wind", price: 1500, desc: "Self-revive once when downed (re-buy after use)" },
  fasthands: { id: "fasthands", name: "Fast Hands", price: 1500, desc: "+40% reload speed", mods: { reloadSpeed: 1.4 } },
};

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const PLAYER = {
  regenDelay: 4,
  regenRate: 40,
  maxArmor: 150,
  /** Armor absorbs this share of incoming damage. */
  armorAbsorb: 0.7,
  bleedOut: 30,
  reviveTime: 3,
  selfReviveTime: 4,
  reviveHealth: 40,
  /** Grace after a revive. */
  reviveInvuln: 1.5,
};

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const ECONOMY = {
  startMoney: 500,
  hit: 10,
  kill: 60,
  headshotBonus: 40,
  meleeKill: 130,
  waveBonusBase: 250,
  waveBonusPerWave: 50,
  /** Bots earn the team this share of a normal kill. */
  botKillShare: 0.5,
  prices: { ammo: 250, armor: 300, grenade: 200, botRevive: 500 },
  armorPlate: 50,
};

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export type DifficultyId = "recruit" | "regular" | "veteran";
export const DIFFICULTY: Record<DifficultyId, { name: string; enemyHealth: number; enemyDamage: number; accuracy: number; count: number; reward: number; desc: string }> = {
  recruit: { name: "Recruit", enemyHealth: 0.8, enemyDamage: 0.6, accuracy: 0.75, count: 0.85, reward: 1.1, desc: "Forgiving. Enemies hit less often and less hard." },
  regular: { name: "Regular", enemyHealth: 1, enemyDamage: 1, accuracy: 1, count: 1, reward: 1, desc: "The intended experience." },
  veteran: { name: "Veteran", enemyHealth: 1.25, enemyDamage: 1.4, accuracy: 1.2, count: 1.2, reward: 1.25, desc: "Accurate, durable enemies. Cover matters." },
};

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export type EnemyType = "rifleman" | "rusher" | "armored" | "sniper" | "warden";
export type AgentWeapon = {
  /** Damage per hit (before difficulty/wave scaling). Shotguns: whole blast at point blank. */
  damage: number;
  rpm: number;
  burst: [number, number];
  burstPause: [number, number];
  /** Base hit chance at 10 m against a still, standing target. */
  accuracy: number;
  range: number;
  /** Damage falls to this fraction at max range. */
  falloff: number;
  /** Loudness / tracer weight. */
  heavy: number;
};

export type EnemyDef = {
  type: EnemyType;
  name: string;
  health: number;
  /** Fraction of body damage taken (armor plating). Head always full. */
  bodyArmor: number;
  speed: number;
  runSpeed: number;
  /** Preferred engagement distance band. */
  range: [number, number];
  weapon: AgentWeapon;
  /** Chance to seek cover when flinching / between bursts. */
  coverBias: number;
  /** Seconds a hit stuns movement. 0 = never flinches. */
  flinch: number;
  reward: number;
  scale: number;
  colors: { uniform: number; vest: number; helmet: number; skin: number; accent: number };
  /** Visual kit: plates, visor, ghillie hood, etc. */
  kit: "standard" | "rusher" | "heavy" | "sniper" | "warden";
  /** Keeps firing at the last-seen position this many seconds after losing sight (suppression). */
  suppress?: number;
  /** Big hits knock it off balance (heavies). */
  stagger?: StaggerDef;
};

/** See ai/heavy/Juggernaut.ts. Damage values are raw (before armour). */
export type StaggerDef = {
  /** A single hit at least this big staggers. */
  threshold: number;
  /** …or this much total inside `window` seconds. */
  burst: number;
  window: number;
  duration: number;
  /** Immune to another stagger for this long after one ends. */
  cooldown: number;
};

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  rifleman: {
    type: "rifleman", name: "Rifleman", health: 100, bodyArmor: 1, speed: 2.4, runSpeed: 4.4, range: [10, 26],
    weapon: { damage: 9, rpm: 480, burst: [3, 6], burstPause: [0.55, 1.2], accuracy: 0.45, range: 55, falloff: 0.6, heavy: 1 },
    coverBias: 0.65, flinch: 0.35, reward: 60, scale: 1,
    colors: { uniform: 0x6b6250, vest: 0x4a4434, helmet: 0x55503e, skin: 0xb08a6a, accent: 0xc0392b }, kit: "standard",
  },
  rusher: {
    type: "rusher", name: "Breacher", health: 85, bodyArmor: 1, speed: 3.2, runSpeed: 6.4, range: [0, 5],
    weapon: { damage: 26, rpm: 70, burst: [1, 1], burstPause: [0.9, 1.3], accuracy: 0.7, range: 16, falloff: 0.15, heavy: 1.4 },
    coverBias: 0, flinch: 0.25, reward: 75, scale: 0.97,
    colors: { uniform: 0x3a3634, vest: 0x2a2624, helmet: 0x2a2624, skin: 0xa07a5a, accent: 0xe8a33a }, kit: "rusher",
  },
  armored: {
    // Heavy LMG gunner in layered plate: slow, very tough, only the head takes full damage.
    type: "armored", name: "Juggernaut", health: 640, bodyArmor: 0.4, speed: 1.45, runSpeed: 2.0, range: [6, 24],
    weapon: { damage: 8, rpm: 720, burst: [16, 30], burstPause: [0.7, 1.25], accuracy: 0.3, range: 50, falloff: 0.6, heavy: 1.5 },
    coverBias: 0, flinch: 0, reward: 250, scale: 1.14,
    colors: { uniform: 0x3c3f42, vest: 0x2b2d30, helmet: 0x22252a, skin: 0x9a7a60, accent: 0xff5a2a }, kit: "heavy",
    suppress: 3.5,
    stagger: { threshold: 60, burst: 170, window: 1.1, duration: 0.95, cooldown: 2.6 },
  },
  sniper: {
    type: "sniper", name: "Marksman", health: 110, bodyArmor: 1, speed: 2.2, runSpeed: 3.6, range: [30, 90],
    weapon: { damage: 55, rpm: 20, burst: [1, 1], burstPause: [2.6, 3.6], accuracy: 0.85, range: 130, falloff: 0.9, heavy: 1.6 },
    coverBias: 0.3, flinch: 0.6, reward: 120, scale: 1,
    colors: { uniform: 0x6e6448, vest: 0x5a523a, helmet: 0x6e6448, skin: 0xb08a6a, accent: 0xff2a2a }, kit: "sniper",
  },
  warden: {
    type: "warden", name: "The Warden", health: 2600, bodyArmor: 0.55, speed: 1.9, runSpeed: 3.2, range: [5, 28],
    weapon: { damage: 8, rpm: 820, burst: [24, 40], burstPause: [1.4, 2.2], accuracy: 0.34, range: 55, falloff: 0.6, heavy: 1.7 },
    coverBias: 0, flinch: 0, reward: 1200, scale: 1.28,
    colors: { uniform: 0x2a2a2c, vest: 0x1a1a1c, helmet: 0x141416, skin: 0x8a6a50, accent: 0xff3a1a }, kit: "warden",
  },
};

/** Friendly squad bots. */
export const SQUAD = {
  names: ["Kestrel", "Halden"],
  health: 160,
  regenDelay: 5,
  regenRate: 25,
  speed: 2.8,
  runSpeed: 5.2,
  bleedOut: 40,
  weapon: { damage: 14, rpm: 520, burst: [3, 7], burstPause: [0.4, 0.8], accuracy: 0.55, range: 60, falloff: 0.7, heavy: 1 } as AgentWeapon,
};

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

export const WAVES = {
  intermission: 20,
  firstDelay: 6,
  /** Hard cap on enemies alive at once by quality (perf), and by wave (pacing). */
  maxAliveByQuality: { low: 12, medium: 20, high: 28 },
  aliveBase: 6,
  alivePerWave: 1.4,
  spawnInterval: [0.6, 1.6] as [number, number],
  minSpawnDistance: 22,
  /** Per-wave enemy health and damage growth. */
  healthPerWave: 0.07,
  damagePerWave: 0.045,
  accuracyPerWave: 0.012,
  /** Elites (wave 10+): rifleman / rusher / armored rolls with this chance, growing per wave. */
  elite: {
    fromWave: 10,
    chance: 0.25,
    chancePerWave: 0.025,
    maxChance: 0.55,
    health: 1.6,
    damage: 1.25,
    accuracy: 1.2,
    reward: 1.75,
  },
};

export type WaveTarget = 10 | 20 | 0; // 0 = endless

/** Wave composition. Returns how many of each type to send. */
export function composeWave(wave: number, countMul: number, squadSize: number): Record<EnemyType, number> {
  const team = 1 + squadSize * 0.35;
  const total = Math.round((5 + wave * 2.4) * countMul * team);
  const out: Record<EnemyType, number> = { rifleman: 0, rusher: 0, armored: 0, sniper: 0, warden: 0 };
  let rest = total;
  const take = (type: EnemyType, n: number) => {
    const k = Math.max(0, Math.min(rest, Math.round(n)));
    out[type] += k;
    rest -= k;
  };
  if (wave >= 10 && wave % 5 === 0) take("warden", 1 + Math.floor((wave - 10) / 10));
  if (wave >= 7) take("sniper", Math.min(4, 1 + Math.floor((wave - 7) / 2)));
  // Juggernauts: from wave 4, more on elite waves (10+) and two extra escorting each boss.
  const boss = wave >= 10 && wave % 5 === 0;
  if (wave >= 4) take("armored", Math.min(7, 1 + Math.floor((wave - 4) / 2) + (wave >= 10 ? 1 : 0) + (boss ? 2 : 0)));
  if (wave >= 4) take("rusher", total * (wave >= 7 ? 0.28 : 0.2));
  out.rifleman += rest;
  return out;
}
