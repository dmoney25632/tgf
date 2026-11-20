/**
 * Weapon data. All names are original to Iron Horizon.
 * Angles in degrees, times in seconds, damage per bullet/pellet.
 *
 * Feel knobs, roughly in order of impact:
 *   recoil.pattern / kickScale  — how the gun climbs
 *   recoil.recovery             — how fast aim settles after you stop firing
 *   spread.*                    — hip-fire cone and sustained-fire bloom
 *   viewKick / shake            — how hard each shot *looks* and *feels*
 */
export type WeaponClass = "Assault Rifle" | "SMG" | "Shotgun" | "Marksman" | "Sniper Rifle" | "LMG" | "Sidearm" | "Hand Cannon";
export type ViewModelKind = "rifle" | "smg" | "shotgun" | "dmr" | "lmg" | "pistol" | "revolver";

export type WeaponDef = {
  id: string;
  name: string;
  kind: WeaponClass;
  slot: "primary" | "secondary";
  /** Survival shop price. */
  price: number;
  auto: boolean;
  rpm: number;
  /** Damage per projectile; shotguns fire `pellets` projectiles. */
  damage: number;
  pellets: number;
  headMultiplier: number;
  limbMultiplier: number;
  falloffStart: number;
  falloffEnd: number;
  minDamage: number;
  range: number;
  magSize: number;
  reserveAmmo: number;
  reloadTime: number;
  reloadEmptyTime: number;
  /** Shotgun-style: reloadTime is per shell, interruptible by firing. */
  shellReload?: boolean;
  adsTime: number;
  adsFov: number;
  /** Optic: hides the viewmodel near full ADS and shows a reticle overlay. */
  scope?: boolean;
  /** Pump / bolt cycle after each shot (sound + animation). */
  cycleAction?: boolean;
  /** Movement speed multiplier while this is equipped. */
  mobility: number;
  sprintOutTime: number;
  swapTime: number;
  spread: { hip: number; ads: number; move: number; air: number; perShot: number; max: number; recovery: number };
  recoil: {
    /** [pitchUp, yawRight] per shot (deg). Loops over the last third. */
    pattern: [number, number][];
    jitterPitch: number;
    jitterYaw: number;
    kickScale: number;
    adsScale: number;
    /** How fast the camera snaps to the kick (1/s). */
    snap: number;
    /** Aim recovery toward rest after you stop firing (1/s). */
    recovery: number;
    recoveryDelay: number;
  };
  viewKick: { back: number; up: number; side: number; roll: number };
  shake: number;
  sound: { crack: number; body: number; thump: number; tail: number; volume: number; pitch: number };
  model: ViewModelKind;
};

const AR_PATTERN: [number, number][] = [
  [0.9, 0.05], [0.85, 0.1], [0.8, 0.15], [0.75, 0.2], [0.7, 0.15],
  [0.65, 0.05], [0.6, -0.1], [0.6, -0.2], [0.55, -0.15], [0.55, 0.05],
  [0.5, 0.2], [0.5, 0.25], [0.5, 0.1], [0.5, -0.1], [0.5, -0.2],
];
const SMG_PATTERN: [number, number][] = [
  [0.55, -0.1], [0.5, 0.15], [0.5, -0.2], [0.45, 0.25], [0.45, -0.25],
  [0.4, 0.3], [0.4, -0.3], [0.4, 0.25], [0.4, -0.2], [0.4, 0.3],
];
const LMG_PATTERN: [number, number][] = [
  [1.1, 0.1], [1.0, 0.2], [0.9, 0.25], [0.7, 0.15], [0.55, -0.05],
  [0.45, -0.2], [0.4, -0.25], [0.4, -0.1], [0.4, 0.1], [0.4, 0.2], [0.4, 0.05], [0.4, -0.15],
];

export const WEAPONS = {
  vk7: {
    id: "vk7", name: "VK-7 Carbine", kind: "Assault Rifle", slot: "primary", price: 1200,
    auto: true, rpm: 720, damage: 30, pellets: 1, headMultiplier: 1.5, limbMultiplier: 0.9,
    falloffStart: 28, falloffEnd: 55, minDamage: 22, range: 300,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.0, reloadEmptyTime: 2.5,
    adsTime: 0.24, adsFov: 56, mobility: 1, sprintOutTime: 0.2, swapTime: 0.42,
    spread: { hip: 2.4, ads: 0.08, move: 2.4, air: 3.5, perShot: 0.22, max: 2.2, recovery: 6 },
    recoil: { pattern: AR_PATTERN, jitterPitch: 0.12, jitterYaw: 0.14, kickScale: 1, adsScale: 0.72, snap: 38, recovery: 7, recoveryDelay: 0.08 },
    viewKick: { back: 0.045, up: 0.05, side: 0.015, roll: 0.02 }, shake: 0.16,
    sound: { crack: 1, body: 1, thump: 1, tail: 1, volume: 1, pitch: 1 }, model: "rifle",
  },
  hornet: {
    id: "hornet", name: "Hornet K9", kind: "SMG", slot: "primary", price: 1000,
    auto: true, rpm: 920, damage: 24, pellets: 1, headMultiplier: 1.35, limbMultiplier: 0.9,
    falloffStart: 12, falloffEnd: 30, minDamage: 15, range: 150,
    magSize: 32, reserveAmmo: 192, reloadTime: 1.7, reloadEmptyTime: 2.1,
    adsTime: 0.16, adsFov: 64, mobility: 1.06, sprintOutTime: 0.12, swapTime: 0.34,
    spread: { hip: 1.7, ads: 0.35, move: 1.4, air: 2.2, perShot: 0.16, max: 2.6, recovery: 8 },
    recoil: { pattern: SMG_PATTERN, jitterPitch: 0.15, jitterYaw: 0.22, kickScale: 0.85, adsScale: 0.8, snap: 44, recovery: 9, recoveryDelay: 0.06 },
    viewKick: { back: 0.03, up: 0.03, side: 0.02, roll: 0.025 }, shake: 0.1,
    sound: { crack: 0.8, body: 0.7, thump: 0.6, tail: 0.7, volume: 0.85, pitch: 1.15 }, model: "smg",
  },
  breacher: {
    id: "breacher", name: "Breacher 12", kind: "Shotgun", slot: "primary", price: 1100,
    auto: false, rpm: 72, damage: 19, pellets: 9, headMultiplier: 1.25, limbMultiplier: 0.9,
    falloffStart: 7, falloffEnd: 20, minDamage: 5, range: 60,
    magSize: 7, reserveAmmo: 42, reloadTime: 0.48, reloadEmptyTime: 0.48, shellReload: true,
    adsTime: 0.2, adsFov: 66, cycleAction: true, mobility: 0.98, sprintOutTime: 0.15, swapTime: 0.4,
    spread: { hip: 4.6, ads: 3.4, move: 1.0, air: 1.5, perShot: 0, max: 0, recovery: 10 },
    recoil: { pattern: [[3.4, 0.3]], jitterPitch: 0.5, jitterYaw: 0.6, kickScale: 1, adsScale: 0.85, snap: 26, recovery: 6, recoveryDelay: 0.1 },
    viewKick: { back: 0.09, up: 0.16, side: 0.03, roll: 0.05 }, shake: 0.32,
    sound: { crack: 1.2, body: 1.4, thump: 1.6, tail: 1.4, volume: 1.15, pitch: 0.75 }, model: "shotgun",
  },
  longreach: {
    // Sniper: one shot drops any regular enemy, anywhere on the body, at any range.
    id: "longreach", name: "Longreach SR", kind: "Sniper Rifle", slot: "primary", price: 1500,
    auto: false, rpm: 75, damage: 600, pellets: 1, headMultiplier: 2.5, limbMultiplier: 1,
    falloffStart: 400, falloffEnd: 500, minDamage: 600, range: 500,
    magSize: 6, reserveAmmo: 48, reloadTime: 2.2, reloadEmptyTime: 2.7,
    adsTime: 0.26, adsFov: 22, scope: true, mobility: 0.95, sprintOutTime: 0.22, swapTime: 0.45,
    spread: { hip: 2.6, ads: 0, move: 2.4, air: 4, perShot: 0.5, max: 2, recovery: 6 },
    recoil: { pattern: [[2.6, 0.2]], jitterPitch: 0.35, jitterYaw: 0.4, kickScale: 1, adsScale: 0.75, snap: 30, recovery: 6, recoveryDelay: 0.08 },
    viewKick: { back: 0.07, up: 0.09, side: 0.02, roll: 0.03 }, shake: 0.24,
    sound: { crack: 1.5, body: 1.1, thump: 1.2, tail: 1.6, volume: 1.15, pitch: 0.85 }, model: "dmr",
  },
  anvil: {
    id: "anvil", name: "Anvil LMG", kind: "LMG", slot: "primary", price: 1800,
    auto: true, rpm: 620, damage: 31, pellets: 1, headMultiplier: 1.4, limbMultiplier: 0.9,
    falloffStart: 35, falloffEnd: 70, minDamage: 24, range: 300,
    magSize: 100, reserveAmmo: 300, reloadTime: 4.8, reloadEmptyTime: 5.4,
    adsTime: 0.42, adsFov: 54, mobility: 0.87, sprintOutTime: 0.32, swapTime: 0.6,
    spread: { hip: 3.2, ads: 0.15, move: 3, air: 4, perShot: 0.12, max: 2.4, recovery: 4 },
    recoil: { pattern: LMG_PATTERN, jitterPitch: 0.18, jitterYaw: 0.25, kickScale: 0.95, adsScale: 0.7, snap: 34, recovery: 6, recoveryDelay: 0.1 },
    viewKick: { back: 0.05, up: 0.04, side: 0.02, roll: 0.03 }, shake: 0.18,
    sound: { crack: 1.1, body: 1.2, thump: 1.3, tail: 1.2, volume: 1.05, pitch: 0.9 }, model: "lmg",
  },
  marrow9: {
    id: "marrow9", name: "Marrow P9", kind: "Sidearm", slot: "secondary", price: 400,
    auto: false, rpm: 420, damage: 38, pellets: 1, headMultiplier: 1.6, limbMultiplier: 0.9,
    falloffStart: 14, falloffEnd: 32, minDamage: 22, range: 150,
    magSize: 13, reserveAmmo: 78, reloadTime: 1.35, reloadEmptyTime: 1.6,
    adsTime: 0.14, adsFov: 68, mobility: 1.08, sprintOutTime: 0.08, swapTime: 0.26,
    spread: { hip: 1.4, ads: 0.12, move: 1.2, air: 2, perShot: 0.6, max: 2, recovery: 7 },
    recoil: { pattern: [[1.9, 0.2]], jitterPitch: 0.3, jitterYaw: 0.35, kickScale: 1, adsScale: 0.8, snap: 30, recovery: 8, recoveryDelay: 0.05 },
    viewKick: { back: 0.05, up: 0.12, side: 0.02, roll: 0.04 }, shake: 0.14,
    sound: { crack: 1.1, body: 0.6, thump: 0.5, tail: 0.6, volume: 0.9, pitch: 1.2 }, model: "pistol",
  },
  ruin50: {
    id: "ruin50", name: "Ruin .50", kind: "Hand Cannon", slot: "secondary", price: 900,
    auto: false, rpm: 150, damage: 72, pellets: 1, headMultiplier: 1.75, limbMultiplier: 0.85,
    falloffStart: 18, falloffEnd: 40, minDamage: 45, range: 160,
    magSize: 6, reserveAmmo: 36, reloadTime: 2.2, reloadEmptyTime: 2.2,
    adsTime: 0.18, adsFov: 62, mobility: 1.04, sprintOutTime: 0.12, swapTime: 0.3,
    spread: { hip: 1.8, ads: 0.1, move: 1.6, air: 2.4, perShot: 1.2, max: 2.4, recovery: 5 },
    recoil: { pattern: [[4.2, 0.4]], jitterPitch: 0.5, jitterYaw: 0.6, kickScale: 1, adsScale: 0.8, snap: 24, recovery: 5, recoveryDelay: 0.08 },
    viewKick: { back: 0.08, up: 0.26, side: 0.03, roll: 0.07 }, shake: 0.26,
    sound: { crack: 1.4, body: 1.3, thump: 1.4, tail: 1.5, volume: 1.15, pitch: 0.8 }, model: "revolver",
  },
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

export const PRIMARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === "primary");
export const SECONDARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === "secondary");

/** Firing-range loadout: everything in rotation. */
export const DEFAULT_LOADOUT: WeaponId[] = ["vk7", "hornet", "marrow9"];

/** Quick melee (V) and frag grenades (G). */
export const MELEE = { name: "Combat Knife", damage: 150, range: 2.3, cooldown: 0.55, hitDelay: 0.09 } as const;
export const GRENADE = {
  name: "M7 Frag",
  fuse: 2.3,
  throwSpeed: 17,
  radius: 7,
  maxDamage: 220,
  /** Fraction of damage the thrower takes. */
  selfDamage: 0.4,
  maxCarry: 4,
  startCount: 2,
  cooldown: 0.8,
} as const;

export function damageAt(def: WeaponDef, distance: number) {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.minDamage;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage + (def.minDamage - def.damage) * t;
}
