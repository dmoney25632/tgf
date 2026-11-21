import type { ShellKind } from "../effects/Shells";

/**
 * Weapon data: real-world military firearms by their real designations.
 * Angles in degrees, times in seconds, distances in metres, damage per
 * bullet/pellet. Calibre, cyclic rate, magazine, muzzle velocity, fire modes
 * and reload choreography follow the real guns; damage, falloff and recoil
 * are tuned for play (see tests/balance.test.ts).
 *
 * Feel knobs, roughly in order of impact:
 *   recoil.pattern / kickScale  — how the gun climbs
 *   recoil.recovery             — how fast aim settles after you stop firing
 *   spread.*                    — hip-fire cone and sustained-fire bloom
 *   viewKick / shake            — how hard each shot *looks* and *feels*
 */
export type WeaponClass = "Assault Rifle" | "Battle Rifle" | "SMG" | "Shotgun" | "Marksman" | "Sniper Rifle" | "LMG" | "Sidearm" | "Hand Cannon" | "Melee";

/** First-person model keys (one procedural model per real gun). */
export type ViewModelKind =
  | "m4a1" | "m16a4" | "hk416" | "akm" | "scarl" | "g36" | "aug"
  | "mp5" | "uzi" | "p90"
  | "m249" | "pkm"
  | "r870" | "m1014"
  | "svd" | "m24" | "m82"
  | "m9" | "g17" | "m1911" | "sw629"
  | "knife"
  | "mp5sd" | "mk23";

/** Third-person silhouette family (soldiers / teammates). */
export type ThirdPersonKind = "carbine" | "ak" | "bullpup" | "smg" | "p90" | "lmg" | "pkm" | "shotgun" | "bolt" | "svd" | "m82" | "pistol";

export type FireMode = "auto" | "burst" | "semi";
/** mildot: Leupold-style duplex (M24, M82) · pso: PSO-1 chevrons + rangefinder (SVD) · g36: 3× ring + post · aug: Swarovski 1.5× ring. */
export type OpticKind = "mildot" | "pso" | "g36" | "aug";

export type WeaponDef = {
  id: string;
  name: string;
  kind: WeaponClass;
  slot: "primary" | "secondary" | "melee";
  /** Manufacturer / origin line for the armory. */
  maker: string;
  calibre: string;
  /** Muzzle velocity, m/s (drives falloff ranges and tracer speed). */
  muzzleVelocity: number;
  /** Survival shop price. */
  price: number;
  /** Selectable fire modes; the first is the default. */
  modes: FireMode[];
  /** Rounds per burst (burst mode). */
  burst?: number;
  /** True when the default fire mode is full auto. */
  auto: boolean;
  /** Cyclic rate (semi / bolt guns: the fastest you can realistically fire). */
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
  /** Extra bodies a round passes through (full-power rifle / .50 BMG). */
  penetration: number;
  magSize: number;
  reserveAmmo: number;
  /** Tactical reload (round still chambered). */
  reloadTime: number;
  /** Empty reload: mag swap plus bolt release / charging handle / slide. */
  reloadEmptyTime: number;
  /** Shell / round-by-round loading: reloadTime is per round, interruptible by firing. */
  shellReload?: boolean;
  adsTime: number;
  adsFov: number;
  /** Optic: hides the viewmodel near full ADS and shows a reticle overlay. */
  scope?: boolean;
  /** Reticle drawn by the scope overlay. */
  optic?: OpticKind;
  /** Manual action after each shot: pump (shotgun) or bolt (rifle). */
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
  /** Ejected casing (null: revolver / melee). */
  shell: ShellKind | null;
  model: ViewModelKind;
  tp: ThirdPersonKind;
  /** Suppressed: guards only hear it up close (see missions/stealth/detection.ts NOISE). */
  suppressed?: boolean;
};

// ---------------------------------------------------------------------------
// Recoil patterns
// ---------------------------------------------------------------------------

/**
 * Deterministic climb: vertical kick eases from `up` to `settle` over the
 * first ~60% of the mag, horizontal is a steady `drift` plus a sway of
 * `sway` at `freq` rad/shot (the "S" most automatics draw on a wall).
 */
function climb(n: number, up: number, settle: number, drift: number, sway: number, freq: number, phase = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, i / (n * 0.6));
    const p = up + (settle - up) * t * t * (3 - 2 * t);
    const y = drift * Math.min(1, i / 4) + sway * Math.sin(i * freq + phase) * Math.min(1, i / 3);
    out.push([+p.toFixed(3), +y.toFixed(3)]);
  }
  return out;
}

const single = (pitch: number, yaw: number): [number, number][] => [[pitch, yaw]];

// ---------------------------------------------------------------------------
// Class templates
// ---------------------------------------------------------------------------

type Spec = Omit<WeaponDef, "auto" | "id" | "penetration" | "spread" | "recoil" | "viewKick" | "sound" | "sprintOutTime" | "swapTime" | "headMultiplier" | "limbMultiplier" | "pellets"> & {
  penetration?: number;
  pellets?: number;
  headMultiplier?: number;
  limbMultiplier?: number;
  sprintOutTime?: number;
  swapTime?: number;
  spread: Partial<WeaponDef["spread"]>;
  recoil: Partial<WeaponDef["recoil"]> & { pattern: [number, number][] };
  viewKick: WeaponDef["viewKick"];
  sound: Partial<WeaponDef["sound"]>;
};

const SPREAD: Record<WeaponClass, WeaponDef["spread"]> = {
  "Assault Rifle": { hip: 2.4, ads: 0.08, move: 2.4, air: 3.5, perShot: 0.22, max: 2.2, recovery: 6 },
  "Battle Rifle": { hip: 2.6, ads: 0.07, move: 2.6, air: 3.8, perShot: 0.3, max: 2.4, recovery: 5.5 },
  SMG: { hip: 1.7, ads: 0.35, move: 1.4, air: 2.2, perShot: 0.16, max: 2.6, recovery: 8 },
  LMG: { hip: 3.2, ads: 0.15, move: 3, air: 4, perShot: 0.12, max: 2.4, recovery: 4 },
  Shotgun: { hip: 4.6, ads: 3.4, move: 1.0, air: 1.5, perShot: 0, max: 0, recovery: 10 },
  Marksman: { hip: 2.6, ads: 0.03, move: 2.4, air: 4, perShot: 0.6, max: 2, recovery: 6 },
  "Sniper Rifle": { hip: 3.2, ads: 0, move: 2.6, air: 4.5, perShot: 0.5, max: 2, recovery: 6 },
  Sidearm: { hip: 1.4, ads: 0.12, move: 1.2, air: 2, perShot: 0.6, max: 2, recovery: 7 },
  "Hand Cannon": { hip: 1.8, ads: 0.1, move: 1.6, air: 2.4, perShot: 1.2, max: 2.4, recovery: 5 },
  Melee: { hip: 0, ads: 0, move: 0, air: 0, perShot: 0, max: 0, recovery: 10 },
};

const RECOIL: Record<WeaponClass, Omit<WeaponDef["recoil"], "pattern">> = {
  "Assault Rifle": { jitterPitch: 0.12, jitterYaw: 0.14, kickScale: 1, adsScale: 0.72, snap: 38, recovery: 7, recoveryDelay: 0.08 },
  "Battle Rifle": { jitterPitch: 0.16, jitterYaw: 0.18, kickScale: 1, adsScale: 0.74, snap: 34, recovery: 6.5, recoveryDelay: 0.09 },
  SMG: { jitterPitch: 0.15, jitterYaw: 0.22, kickScale: 0.85, adsScale: 0.8, snap: 44, recovery: 9, recoveryDelay: 0.06 },
  LMG: { jitterPitch: 0.18, jitterYaw: 0.25, kickScale: 0.95, adsScale: 0.7, snap: 34, recovery: 6, recoveryDelay: 0.1 },
  Shotgun: { jitterPitch: 0.5, jitterYaw: 0.6, kickScale: 1, adsScale: 0.85, snap: 26, recovery: 6, recoveryDelay: 0.1 },
  Marksman: { jitterPitch: 0.3, jitterYaw: 0.35, kickScale: 1, adsScale: 0.75, snap: 30, recovery: 6.5, recoveryDelay: 0.08 },
  "Sniper Rifle": { jitterPitch: 0.35, jitterYaw: 0.4, kickScale: 1, adsScale: 0.75, snap: 30, recovery: 6, recoveryDelay: 0.08 },
  Sidearm: { jitterPitch: 0.3, jitterYaw: 0.35, kickScale: 1, adsScale: 0.8, snap: 30, recovery: 8, recoveryDelay: 0.05 },
  "Hand Cannon": { jitterPitch: 0.5, jitterYaw: 0.6, kickScale: 1, adsScale: 0.8, snap: 24, recovery: 5, recoveryDelay: 0.08 },
  Melee: { jitterPitch: 0, jitterYaw: 0, kickScale: 0, adsScale: 1, snap: 30, recovery: 8, recoveryDelay: 0.05 },
};

const HANDLING: Record<WeaponClass, { sprintOutTime: number; swapTime: number; head: number; limb: number }> = {
  "Assault Rifle": { sprintOutTime: 0.2, swapTime: 0.42, head: 1.5, limb: 0.9 },
  "Battle Rifle": { sprintOutTime: 0.23, swapTime: 0.46, head: 1.5, limb: 0.9 },
  SMG: { sprintOutTime: 0.12, swapTime: 0.34, head: 1.35, limb: 0.9 },
  LMG: { sprintOutTime: 0.32, swapTime: 0.6, head: 1.4, limb: 0.9 },
  Shotgun: { sprintOutTime: 0.15, swapTime: 0.4, head: 1.25, limb: 0.9 },
  Marksman: { sprintOutTime: 0.22, swapTime: 0.46, head: 2, limb: 0.9 },
  "Sniper Rifle": { sprintOutTime: 0.24, swapTime: 0.5, head: 2.5, limb: 1 },
  Sidearm: { sprintOutTime: 0.08, swapTime: 0.26, head: 1.6, limb: 0.9 },
  "Hand Cannon": { sprintOutTime: 0.12, swapTime: 0.3, head: 1.75, limb: 0.85 },
  Melee: { sprintOutTime: 0.05, swapTime: 0.22, head: 1, limb: 1 },
};

function gun(id: string, s: Spec): WeaponDef {
  const h = HANDLING[s.kind];
  return {
    ...s,
    id,
    auto: s.modes[0] === "auto",
    pellets: s.pellets ?? 1,
    penetration: s.penetration ?? 0,
    headMultiplier: s.headMultiplier ?? h.head,
    limbMultiplier: s.limbMultiplier ?? h.limb,
    sprintOutTime: s.sprintOutTime ?? h.sprintOutTime,
    swapTime: s.swapTime ?? h.swapTime,
    spread: { ...SPREAD[s.kind], ...s.spread },
    recoil: { ...RECOIL[s.kind], ...s.recoil },
    sound: { crack: 1, body: 1, thump: 1, tail: 1, volume: 1, pitch: 1, ...s.sound },
  };
}

// ---------------------------------------------------------------------------
// The armory
// ---------------------------------------------------------------------------
// KEY ORDER IS THE WIRE FORMAT (net/ids.ts). Append new guns at the end.
// The first seven keys took over the slots of the original invented guns
// (vk7, hornet, breacher, longreach, anvil, marrow9, ruin50) in order.

export const WEAPONS = {
  m4a1: gun("m4a1", {
    name: "M4A1", kind: "Assault Rifle", slot: "primary", maker: "Colt · USA", calibre: "5.56×45mm NATO", muzzleVelocity: 880, price: 1200,
    modes: ["auto", "semi"], rpm: 800, damage: 30, falloffStart: 30, falloffEnd: 60, minDamage: 21, range: 320,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.1, reloadEmptyTime: 2.6, adsTime: 0.24, adsFov: 56, mobility: 1,
    spread: {}, recoil: { pattern: climb(15, 0.86, 0.5, 0.08, 0.16, 0.9) },
    viewKick: { back: 0.045, up: 0.05, side: 0.015, roll: 0.02 }, shake: 0.16,
    sound: {}, shell: "rifle", model: "m4a1", tp: "carbine",
  }),
  mp5: gun("mp5", {
    name: "MP5A3", kind: "SMG", slot: "primary", maker: "Heckler & Koch · Germany", calibre: "9×19mm Parabellum", muzzleVelocity: 400, price: 1000,
    modes: ["auto", "burst", "semi"], burst: 3, rpm: 800, damage: 25, falloffStart: 13, falloffEnd: 30, minDamage: 15, range: 150,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.0, reloadEmptyTime: 2.7, adsTime: 0.17, adsFov: 64, mobility: 1.06,
    spread: { hip: 1.6, ads: 0.3 }, recoil: { pattern: climb(12, 0.5, 0.38, 0.02, 0.2, 1.6), kickScale: 0.8 },
    viewKick: { back: 0.028, up: 0.028, side: 0.018, roll: 0.022 }, shake: 0.09,
    sound: { crack: 0.75, body: 0.7, thump: 0.55, tail: 0.65, volume: 0.84, pitch: 1.18 }, shell: "pistol", model: "mp5", tp: "smg",
  }),
  r870: gun("r870", {
    name: "Remington 870", kind: "Shotgun", slot: "primary", maker: "Remington · USA", calibre: "12 gauge 00 buck", muzzleVelocity: 400, price: 1100,
    modes: ["semi"], rpm: 72, damage: 19, pellets: 9, falloffStart: 7, falloffEnd: 20, minDamage: 5, range: 60,
    magSize: 7, reserveAmmo: 42, reloadTime: 0.5, reloadEmptyTime: 0.5, shellReload: true, cycleAction: true,
    adsTime: 0.2, adsFov: 66, mobility: 0.98,
    spread: {}, recoil: { pattern: single(3.4, 0.3) },
    viewKick: { back: 0.09, up: 0.16, side: 0.03, roll: 0.05 }, shake: 0.32,
    sound: { crack: 1.2, body: 1.4, thump: 1.6, tail: 1.4, volume: 1.15, pitch: 0.75 }, shell: "shotgun", model: "r870", tp: "shotgun",
  }),
  m24: gun("m24", {
    // Bolt action; one shot drops any regular enemy, anywhere on the body, at any range.
    name: "M24 SWS", kind: "Sniper Rifle", slot: "primary", maker: "Remington · USA", calibre: "7.62×51mm NATO", muzzleVelocity: 790, price: 1500,
    modes: ["semi"], rpm: 46, damage: 600, falloffStart: 400, falloffEnd: 600, minDamage: 600, range: 600, penetration: 1,
    magSize: 5, reserveAmmo: 40, reloadTime: 0.62, reloadEmptyTime: 0.62, shellReload: true, cycleAction: true,
    adsTime: 0.34, adsFov: 20, scope: true, optic: "mildot", mobility: 0.93,
    spread: {}, recoil: { pattern: single(2.8, 0.25) },
    viewKick: { back: 0.075, up: 0.1, side: 0.02, roll: 0.03 }, shake: 0.26,
    sound: { crack: 1.55, body: 1.15, thump: 1.2, tail: 1.6, volume: 1.15, pitch: 0.86 }, shell: "heavy", model: "m24", tp: "bolt",
  }),
  m249: gun("m249", {
    name: "M249 SAW", kind: "LMG", slot: "primary", maker: "FN Herstal · Belgium/USA", calibre: "5.56×45mm NATO (belt)", muzzleVelocity: 915, price: 1800,
    modes: ["auto"], rpm: 775, damage: 30, falloffStart: 35, falloffEnd: 70, minDamage: 23, range: 350,
    magSize: 100, reserveAmmo: 300, reloadTime: 5.6, reloadEmptyTime: 6.2, adsTime: 0.42, adsFov: 54, mobility: 0.87,
    spread: {}, recoil: { pattern: climb(14, 1.0, 0.42, 0.12, 0.22, 0.8), kickScale: 0.92 },
    viewKick: { back: 0.05, up: 0.04, side: 0.02, roll: 0.03 }, shake: 0.17,
    sound: { crack: 1.05, body: 1.15, thump: 1.2, tail: 1.2, volume: 1.05, pitch: 0.95 }, shell: "rifle", model: "m249", tp: "lmg",
  }),
  m9: gun("m9", {
    name: "Beretta M9", kind: "Sidearm", slot: "secondary", maker: "Beretta · Italy/USA", calibre: "9×19mm Parabellum", muzzleVelocity: 381, price: 400,
    modes: ["semi"], rpm: 420, damage: 36, falloffStart: 14, falloffEnd: 32, minDamage: 21, range: 150,
    magSize: 15, reserveAmmo: 90, reloadTime: 1.45, reloadEmptyTime: 1.8, adsTime: 0.14, adsFov: 68, mobility: 1.08,
    spread: {}, recoil: { pattern: single(1.9, 0.2) },
    viewKick: { back: 0.05, up: 0.12, side: 0.02, roll: 0.04 }, shake: 0.14,
    sound: { crack: 1.1, body: 0.6, thump: 0.5, tail: 0.6, volume: 0.9, pitch: 1.18 }, shell: "pistol", model: "m9", tp: "pistol",
  }),
  sw629: gun("sw629", {
    name: "S&W Model 629", kind: "Hand Cannon", slot: "secondary", maker: "Smith & Wesson · USA", calibre: ".44 Magnum", muzzleVelocity: 450, price: 900,
    modes: ["semi"], rpm: 150, damage: 72, falloffStart: 18, falloffEnd: 40, minDamage: 45, range: 160,
    magSize: 6, reserveAmmo: 36, reloadTime: 2.4, reloadEmptyTime: 2.4, adsTime: 0.18, adsFov: 62, mobility: 1.04,
    spread: {}, recoil: { pattern: single(4.2, 0.4) },
    viewKick: { back: 0.08, up: 0.26, side: 0.03, roll: 0.07 }, shake: 0.26,
    sound: { crack: 1.4, body: 1.3, thump: 1.4, tail: 1.5, volume: 1.15, pitch: 0.8 }, shell: null, model: "sw629", tp: "pistol",
  }),

  // ---- Appended (new wire ids) ---------------------------------------------
  akm: gun("akm", {
    name: "AKM", kind: "Assault Rifle", slot: "primary", maker: "Kalashnikov · USSR", calibre: "7.62×39mm", muzzleVelocity: 715, price: 1300,
    modes: ["auto", "semi"], rpm: 600, damage: 36, falloffStart: 26, falloffEnd: 52, minDamage: 25, range: 300, penetration: 1,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.4, reloadEmptyTime: 3.0, adsTime: 0.26, adsFov: 58, mobility: 0.99,
    spread: { perShot: 0.28, max: 2.6 }, recoil: { pattern: climb(16, 1.08, 0.62, 0.2, 0.32, 0.7), jitterYaw: 0.2, recovery: 6.5 },
    viewKick: { back: 0.052, up: 0.06, side: 0.02, roll: 0.026 }, shake: 0.19,
    sound: { crack: 1.05, body: 1.2, thump: 1.15, tail: 1.1, volume: 1.05, pitch: 0.9 }, shell: "x39", model: "akm", tp: "ak",
  }),
  m16a4: gun("m16a4", {
    name: "M16A4", kind: "Assault Rifle", slot: "primary", maker: "Colt / FN · USA", calibre: "5.56×45mm NATO", muzzleVelocity: 948, price: 1300,
    modes: ["burst", "semi"], burst: 3, rpm: 850, damage: 32, falloffStart: 40, falloffEnd: 75, minDamage: 24, range: 400,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.25, reloadEmptyTime: 2.75, adsTime: 0.27, adsFov: 54, mobility: 0.97,
    spread: { ads: 0.05 }, recoil: { pattern: climb(9, 0.92, 0.7, 0.05, 0.12, 1.1), recovery: 8 },
    viewKick: { back: 0.045, up: 0.05, side: 0.012, roll: 0.018 }, shake: 0.15,
    sound: { crack: 1.1, body: 1.0, thump: 0.95, tail: 1.1, volume: 1.02, pitch: 1.02 }, shell: "rifle", model: "m16a4", tp: "carbine",
  }),
  hk416: gun("hk416", {
    name: "HK416", kind: "Assault Rifle", slot: "primary", maker: "Heckler & Koch · Germany", calibre: "5.56×45mm NATO", muzzleVelocity: 850, price: 1600,
    modes: ["auto", "semi"], rpm: 850, damage: 30, falloffStart: 32, falloffEnd: 62, minDamage: 22, range: 320,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.15, reloadEmptyTime: 2.65, adsTime: 0.23, adsFov: 56, mobility: 1,
    spread: { perShot: 0.19 }, recoil: { pattern: climb(15, 0.76, 0.46, 0.05, 0.13, 1.0), recovery: 7.5 },
    viewKick: { back: 0.042, up: 0.046, side: 0.013, roll: 0.018 }, shake: 0.15,
    sound: { crack: 1, body: 1.02, thump: 1, tail: 1, volume: 1, pitch: 0.98 }, shell: "rifle", model: "hk416", tp: "carbine",
  }),
  scarl: gun("scarl", {
    name: "FN SCAR-L", kind: "Assault Rifle", slot: "primary", maker: "FN Herstal · Belgium", calibre: "5.56×45mm NATO", muzzleVelocity: 870, price: 1700,
    modes: ["auto", "semi"], rpm: 625, damage: 32, falloffStart: 34, falloffEnd: 65, minDamage: 23, range: 330,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.1, reloadEmptyTime: 2.55, adsTime: 0.24, adsFov: 54, mobility: 1,
    spread: { perShot: 0.18 }, recoil: { pattern: climb(15, 0.72, 0.44, -0.04, 0.12, 0.85), recovery: 8 },
    viewKick: { back: 0.044, up: 0.044, side: 0.012, roll: 0.016 }, shake: 0.15,
    sound: { crack: 1, body: 1.05, thump: 1.05, tail: 1.05, volume: 1, pitch: 0.96 }, shell: "rifle", model: "scarl", tp: "carbine",
  }),
  g36: gun("g36", {
    name: "G36", kind: "Assault Rifle", slot: "primary", maker: "Heckler & Koch · Germany", calibre: "5.56×45mm NATO", muzzleVelocity: 920, price: 1400,
    modes: ["auto", "burst", "semi"], burst: 2, rpm: 750, damage: 30, falloffStart: 34, falloffEnd: 66, minDamage: 22, range: 340,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.3, reloadEmptyTime: 2.8, adsTime: 0.27, adsFov: 40, scope: true, optic: "g36", mobility: 0.99,
    spread: { ads: 0.05 }, recoil: { pattern: climb(15, 0.8, 0.5, 0.1, 0.1, 0.9) },
    viewKick: { back: 0.044, up: 0.048, side: 0.014, roll: 0.018 }, shake: 0.15,
    sound: { crack: 1, body: 0.98, thump: 0.95, tail: 1, volume: 0.98, pitch: 1.03 }, shell: "rifle", model: "g36", tp: "carbine",
  }),
  aug: gun("aug", {
    name: "Steyr AUG A1", kind: "Assault Rifle", slot: "primary", maker: "Steyr Mannlicher · Austria", calibre: "5.56×45mm NATO", muzzleVelocity: 970, price: 1500,
    modes: ["auto", "semi"], rpm: 680, damage: 31, falloffStart: 36, falloffEnd: 70, minDamage: 23, range: 350,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.5, reloadEmptyTime: 3.05, adsTime: 0.25, adsFov: 50, scope: true, optic: "aug", mobility: 1.01,
    spread: { ads: 0.06 }, recoil: { pattern: climb(15, 0.78, 0.48, -0.06, 0.18, 0.95) },
    viewKick: { back: 0.04, up: 0.045, side: 0.014, roll: 0.02 }, shake: 0.15,
    sound: { crack: 1.02, body: 0.98, thump: 0.95, tail: 1.05, volume: 1, pitch: 1.04 }, shell: "rifle", model: "aug", tp: "bullpup",
  }),
  uzi: gun("uzi", {
    name: "Uzi", kind: "SMG", slot: "primary", maker: "IMI · Israel", calibre: "9×19mm Parabellum", muzzleVelocity: 400, price: 800,
    modes: ["auto", "semi"], rpm: 600, damage: 26, falloffStart: 11, falloffEnd: 26, minDamage: 15, range: 130,
    magSize: 32, reserveAmmo: 192, reloadTime: 1.9, reloadEmptyTime: 2.45, adsTime: 0.16, adsFov: 66, mobility: 1.07,
    spread: { hip: 1.5, ads: 0.4 }, recoil: { pattern: climb(12, 0.46, 0.36, -0.05, 0.25, 1.9), kickScale: 0.82 },
    viewKick: { back: 0.03, up: 0.026, side: 0.02, roll: 0.025 }, shake: 0.09,
    sound: { crack: 0.78, body: 0.75, thump: 0.62, tail: 0.68, volume: 0.86, pitch: 1.1 }, shell: "pistol", model: "uzi", tp: "smg",
  }),
  p90: gun("p90", {
    name: "FN P90", kind: "SMG", slot: "primary", maker: "FN Herstal · Belgium", calibre: "5.7×28mm", muzzleVelocity: 715, price: 1500,
    modes: ["auto", "semi"], rpm: 900, damage: 23, falloffStart: 16, falloffEnd: 36, minDamage: 15, range: 200, penetration: 1,
    magSize: 50, reserveAmmo: 250, reloadTime: 2.9, reloadEmptyTime: 3.4, adsTime: 0.19, adsFov: 62, mobility: 1.05,
    spread: { hip: 1.6, ads: 0.25, perShot: 0.12 }, recoil: { pattern: climb(14, 0.38, 0.29, 0, 0.14, 1.4), kickScale: 0.8 },
    viewKick: { back: 0.024, up: 0.022, side: 0.014, roll: 0.018 }, shake: 0.08,
    sound: { crack: 0.95, body: 0.7, thump: 0.6, tail: 0.75, volume: 0.88, pitch: 1.26 }, shell: "pdw", model: "p90", tp: "p90",
  }),
  pkm: gun("pkm", {
    name: "PKM", kind: "LMG", slot: "primary", maker: "Kalashnikov · USSR", calibre: "7.62×54mmR (belt)", muzzleVelocity: 825, price: 2000,
    modes: ["auto"], rpm: 650, damage: 38, falloffStart: 40, falloffEnd: 80, minDamage: 28, range: 400, penetration: 1,
    magSize: 100, reserveAmmo: 300, reloadTime: 6.2, reloadEmptyTime: 6.8, adsTime: 0.46, adsFov: 56, mobility: 0.84,
    spread: { hip: 3.4 }, recoil: { pattern: climb(14, 1.22, 0.56, 0.2, 0.3, 0.75), kickScale: 0.95, recovery: 5.5 },
    viewKick: { back: 0.056, up: 0.048, side: 0.024, roll: 0.034 }, shake: 0.21,
    sound: { crack: 1.15, body: 1.3, thump: 1.35, tail: 1.3, volume: 1.1, pitch: 0.84 }, shell: "heavy", model: "pkm", tp: "pkm",
  }),
  m1014: gun("m1014", {
    name: "Benelli M4 (M1014)", kind: "Shotgun", slot: "primary", maker: "Benelli · Italy", calibre: "12 gauge 00 buck", muzzleVelocity: 400, price: 1500,
    modes: ["semi"], rpm: 240, damage: 17, pellets: 9, falloffStart: 7, falloffEnd: 19, minDamage: 4, range: 55,
    magSize: 7, reserveAmmo: 42, reloadTime: 0.44, reloadEmptyTime: 0.44, shellReload: true,
    adsTime: 0.22, adsFov: 66, mobility: 0.97,
    spread: { hip: 4.8, ads: 3.6 }, recoil: { pattern: single(2.9, 0.35), recovery: 7 },
    viewKick: { back: 0.08, up: 0.13, side: 0.03, roll: 0.045 }, shake: 0.28,
    sound: { crack: 1.2, body: 1.35, thump: 1.5, tail: 1.35, volume: 1.12, pitch: 0.8 }, shell: "shotgun", model: "m1014", tp: "shotgun",
  }),
  svd: gun("svd", {
    name: "SVD Dragunov", kind: "Marksman", slot: "primary", maker: "Izhmash · USSR", calibre: "7.62×54mmR", muzzleVelocity: 830, price: 1600,
    modes: ["semi"], rpm: 260, damage: 130, falloffStart: 120, falloffEnd: 300, minDamage: 105, range: 500, penetration: 1,
    magSize: 10, reserveAmmo: 60, reloadTime: 2.6, reloadEmptyTime: 3.2, adsTime: 0.32, adsFov: 26, scope: true, optic: "pso", mobility: 0.95,
    spread: {}, recoil: { pattern: single(2.3, 0.3) },
    viewKick: { back: 0.065, up: 0.08, side: 0.02, roll: 0.03 }, shake: 0.22,
    sound: { crack: 1.35, body: 1.15, thump: 1.15, tail: 1.4, volume: 1.1, pitch: 0.88 }, shell: "heavy", model: "svd", tp: "svd",
  }),
  m82: gun("m82", {
    name: "Barrett M82A1", kind: "Sniper Rifle", slot: "primary", maker: "Barrett · USA", calibre: ".50 BMG", muzzleVelocity: 853, price: 2500,
    modes: ["semi"], rpm: 110, damage: 900, falloffStart: 600, falloffEnd: 800, minDamage: 900, range: 800, penetration: 3,
    magSize: 10, reserveAmmo: 40, reloadTime: 3.6, reloadEmptyTime: 4.4, adsTime: 0.5, adsFov: 16, scope: true, optic: "mildot", mobility: 0.82,
    swapTime: 0.62, sprintOutTime: 0.32,
    spread: { hip: 4, move: 3.2 }, recoil: { pattern: single(4.6, 0.5), snap: 22, recovery: 4.5 },
    viewKick: { back: 0.12, up: 0.14, side: 0.035, roll: 0.05 }, shake: 0.42,
    sound: { crack: 2, body: 1.6, thump: 2, tail: 1.9, volume: 1.3, pitch: 0.66 }, shell: "bmg", model: "m82", tp: "m82",
  }),
  m1911: gun("m1911", {
    name: "Colt M1911A1", kind: "Sidearm", slot: "secondary", maker: "Colt · USA", calibre: ".45 ACP", muzzleVelocity: 253, price: 550,
    modes: ["semi"], rpm: 380, damage: 46, falloffStart: 12, falloffEnd: 28, minDamage: 26, range: 120,
    magSize: 7, reserveAmmo: 56, reloadTime: 1.4, reloadEmptyTime: 1.75, adsTime: 0.14, adsFov: 68, mobility: 1.08,
    spread: { perShot: 0.75 }, recoil: { pattern: single(2.5, 0.25) },
    viewKick: { back: 0.058, up: 0.15, side: 0.022, roll: 0.045 }, shake: 0.16,
    sound: { crack: 1, body: 0.8, thump: 0.75, tail: 0.7, volume: 0.95, pitch: 0.98 }, shell: "acp", model: "m1911", tp: "pistol",
  }),
  g17: gun("g17", {
    name: "Glock 17", kind: "Sidearm", slot: "secondary", maker: "Glock · Austria", calibre: "9×19mm Parabellum", muzzleVelocity: 375, price: 450,
    modes: ["semi"], rpm: 450, damage: 34, falloffStart: 14, falloffEnd: 32, minDamage: 20, range: 150,
    magSize: 17, reserveAmmo: 102, reloadTime: 1.35, reloadEmptyTime: 1.7, adsTime: 0.13, adsFov: 68, mobility: 1.09,
    spread: { perShot: 0.55 }, recoil: { pattern: single(1.8, 0.22) },
    viewKick: { back: 0.048, up: 0.115, side: 0.02, roll: 0.04 }, shake: 0.13,
    sound: { crack: 1.12, body: 0.6, thump: 0.5, tail: 0.6, volume: 0.9, pitch: 1.2 }, shell: "pistol", model: "g17", tp: "pistol",
  }),
  knife: gun("knife", {
    name: "KA-BAR", kind: "Melee", slot: "melee", maker: "KA-BAR · USA", calibre: "7in clip-point blade", muzzleVelocity: 0, price: 0,
    modes: ["semi"], rpm: 140, damage: 0, falloffStart: 0, falloffEnd: 1, minDamage: 0, range: 0,
    magSize: 0, reserveAmmo: 0, reloadTime: 0, reloadEmptyTime: 0, adsTime: 0.2, adsFov: 70, mobility: 1.1,
    spread: {}, recoil: { pattern: single(0, 0) },
    viewKick: { back: 0, up: 0, side: 0, roll: 0 }, shake: 0,
    sound: {}, shell: null, model: "knife", tp: "pistol",
  }),
  // ---- Suppressed (appended after the knife: wire order) ------------------------------------
  mp5sd: gun("mp5sd", {
    // Integrally suppressed MP5: ported barrel inside the can bleeds the 9 mm down to subsonic.
    name: "MP5SD3", kind: "SMG", slot: "primary", maker: "Heckler & Koch · Germany", calibre: "9×19mm (subsonic)", muzzleVelocity: 285, price: 1300,
    modes: ["auto", "burst", "semi"], burst: 3, rpm: 700, damage: 23, falloffStart: 12, falloffEnd: 26, minDamage: 14, range: 110,
    magSize: 30, reserveAmmo: 180, reloadTime: 2.0, reloadEmptyTime: 2.7, adsTime: 0.19, adsFov: 64, mobility: 1.04,
    spread: { hip: 1.6, ads: 0.3 }, recoil: { pattern: climb(12, 0.42, 0.32, 0.02, 0.16, 1.6), kickScale: 0.7 },
    viewKick: { back: 0.022, up: 0.022, side: 0.014, roll: 0.018 }, shake: 0.06,
    sound: { crack: 0.12, body: 0.42, thump: 0.3, tail: 0.12, volume: 0.42, pitch: 1.35 }, shell: "pistol", model: "mp5sd", tp: "smg",
    suppressed: true,
  }),
  mk23: gun("mk23", {
    // Mk 23 Mod 0 with its threaded barrel and a screw-on can; subsonic .45.
    name: "Mk 23 Mod 0 (SD)", kind: "Sidearm", slot: "secondary", maker: "Heckler & Koch · Germany", calibre: ".45 ACP", muzzleVelocity: 260, price: 700,
    modes: ["semi"], rpm: 340, damage: 44, falloffStart: 12, falloffEnd: 26, minDamage: 25, range: 110,
    magSize: 12, reserveAmmo: 72, reloadTime: 1.45, reloadEmptyTime: 1.85, adsTime: 0.16, adsFov: 68, mobility: 1.06,
    spread: { perShot: 0.6 }, recoil: { pattern: single(2.1, 0.2) },
    viewKick: { back: 0.05, up: 0.12, side: 0.018, roll: 0.035 }, shake: 0.1,
    sound: { crack: 0.15, body: 0.45, thump: 0.35, tail: 0.12, volume: 0.45, pitch: 1.25 }, shell: "acp", model: "mk23", tp: "pistol",
    suppressed: true,
  }),
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;
export type GunId = Exclude<WeaponId, "knife">;

const CLASS_ORDER: WeaponClass[] = ["Assault Rifle", "Battle Rifle", "SMG", "LMG", "Shotgun", "Marksman", "Sniper Rifle", "Sidearm", "Hand Cannon"];
const byClassThenPrice = (a: WeaponId, b: WeaponId) =>
  CLASS_ORDER.indexOf(WEAPONS[a].kind) - CLASS_ORDER.indexOf(WEAPONS[b].kind) || WEAPONS[a].price - WEAPONS[b].price;

/** Pickable primaries / secondaries, grouped by class (armory display order, not wire order). */
export const PRIMARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === "primary").sort(byClassThenPrice);
export const SECONDARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].slot === "secondary").sort(byClassThenPrice);

/** Firing-range loadout. */
export const DEFAULT_LOADOUT: WeaponId[] = ["m4a1", "mp5", "m9"];

/** Saved loadouts from before the real-world armory: old id → its successor. */
export const LEGACY_WEAPON_IDS: Record<string, WeaponId> = {
  vk7: "m4a1",
  hornet: "mp5",
  breacher: "r870",
  longreach: "m24",
  anvil: "m249",
  marrow9: "m9",
  ruin50: "sw629",
};

/**
 * Any stored / received weapon id → a valid id for `slot` (legacy ids map
 * to their successor; unknown ids fall back to `fallback`).
 */
export function resolveWeaponId(raw: unknown, slot: "primary" | "secondary", fallback: WeaponId): WeaponId {
  if (typeof raw !== "string") return fallback;
  const id = (raw in WEAPONS ? raw : LEGACY_WEAPON_IDS[raw]) as WeaponId | undefined;
  return id && WEAPONS[id].slot === slot ? id : fallback;
}

/**
 * Melee. Quick melee (V) is a knife slash with sidearms / the knife, and a
 * rifle-butt stroke with long guns. The equipped knife (slot 3) slashes on
 * fire and stabs on aim; a stab or slash from behind is a backstab.
 */
export const MELEE = { name: "KA-BAR", damage: 150, range: 2.3, cooldown: 0.55, hitDelay: 0.09, maxDamage: 400 } as const;
export const BUTT_STROKE = { name: "Rifle Butt", damage: 95, range: 2.0, cooldown: 0.72, hitDelay: 0.17 } as const;
export const KNIFE = {
  slash: { damage: 110, range: 2.4, duration: 0.46, hitDelay: 0.12 },
  stab: { damage: 190, range: 2.1, duration: 0.78, hitDelay: 0.3 },
  /** Damage of any knife hit from behind (bosses survive it). */
  backstab: 400,
  /** Lunge: snap toward an enemy under the crosshair within this range. */
  lungeRange: 4.2,
  lungeSpeed: 9,
} as const;

/** Hand grenades. `GRENADE` is the frag (kept for existing callers). */
export type GrenadeType = "frag" | "flash" | "smoke";
export const GRENADE = {
  name: "M67 Frag",
  /** Fuse after the spoon flies (M67: 4–5.5 s; shortened for pace). */
  fuse: 3.6,
  throwSpeed: 17,
  /** Lethal radius (fragments still sting a little past it). */
  radius: 7.5,
  maxDamage: 230,
  /** Fraction of damage the thrower takes. */
  selfDamage: 0.4,
  maxCarry: 4,
  startCount: 2,
  cooldown: 0.8,
} as const;
export const FLASHBANG = { name: "M84 Stun", fuse: 1.6, throwSpeed: 16, radius: 14, blind: 4.2, maxCarry: 2, startCount: 1 } as const;
export const SMOKE = { name: "M18 Smoke", fuse: 1.4, throwSpeed: 15, radius: 5.2, duration: 22, maxCarry: 2, startCount: 1 } as const;

export function damageAt(def: WeaponDef, distance: number) {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.minDamage;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage + (def.minDamage - def.damage) * t;
}

/** Fire-mode label for the HUD. */
export function fireModeLabel(def: WeaponDef, mode: FireMode) {
  if (def.slot === "melee") return "";
  if (def.cycleAction) return def.shellReload && def.pellets > 1 ? "PUMP" : "BOLT";
  return mode === "burst" ? `${def.burst ?? 3}-RND` : mode === "auto" ? "AUTO" : "SEMI";
}
