import { composeWave, type EnemyType } from "./config";

/**
 * Wave structure for Survival. A wave is a timeline of squads: each squad is
 * a small group with a role (rifle team, breacher rush, heavy team,
 * marksmen, boss escort) that enters together from one compass sector.
 * Squads arrive on a schedule with breathers in between, consecutive squads
 * come from different directions, later waves bring pincers, every fifth
 * wave is a boss wave and the third of every five is a timed holdout.
 *
 * Pure data + math (no three.js) so the schedule is unit-testable.
 */

export type WaveKind = "standard" | "holdout" | "boss";
export type SquadRole = "rifle" | "rush" | "heavy" | "marksman" | "boss";

export type SquadPlan = {
  /** Seconds after the wave opens. */
  at: number;
  role: SquadRole;
  members: EnemyType[];
  /** Index into the map's spawn sectors. */
  sector: number;
};

export type WavePlan = {
  wave: number;
  kind: WaveKind;
  /** Short name for the banner ("BREACHER RUSH"). */
  title: string;
  squads: SquadPlan[];
  total: number;
  /** Holdout: survive this long; squads not yet in when it ends are called off. */
  hold: number;
};

export type WaveOptions = {
  /** Difficulty count multiplier (DIFFICULTY[id].count). */
  countMul: number;
  /** Fighters on the player side: humans + squad bots (1 = solo, no bots). */
  team: number;
  /** Number of spawn sectors on the map (≥ 1). */
  sectors: number;
  /** Deterministic randomness for tests; Math.random otherwise. */
  rng?: () => number;
};

export const SQUAD_LABEL: Record<SquadRole, string> = {
  rifle: "Rifle team",
  rush: "Breacher rush",
  heavy: "Heavy team",
  marksman: "Marksmen",
  boss: "Boss",
};

/** Pacing knobs (seconds). */
export const PACING = {
  firstSquad: 2.5,
  /** Gap between squads at wave 1 and the floor it shrinks to. */
  gapStart: 15,
  gapMin: 7,
  gapPerWave: 0.55,
  /** Extra pause after every `breatherEvery` squads. */
  breatherEvery: 3,
  breather: 9,
  /** Pincers (two squads at once from opposite sides) from this wave. */
  pincerFrom: 6,
  /** Squad sizes. */
  squadMin: 3,
  squadMax: 6,
  /** Holdout timer: base + per wave. */
  holdBase: 70,
  holdPerWave: 2,
  /** Warning shown this long before a squad arrives. */
  warn: 6,
  /** If the field drops to this many enemies (per team member) the next squad is pulled in. */
  pullInAlive: 1,
  pullInTo: 4,
};

export function waveKind(wave: number): WaveKind {
  if (wave >= 5 && wave % 5 === 0) return "boss";
  if (wave >= 3 && wave % 5 === 3) return "holdout";
  return "standard";
}

/** Total enemies in a wave for a team size (solo = 1) and difficulty. */
export function waveTotal(wave: number, countMul: number, team: number) {
  const c = composeWave(wave, countMul, Math.max(0, team - 1) / 0.35 * 0.45);
  return Object.values(c).reduce((a, b) => a + b, 0);
}

const shuffle = <T>(a: T[], rng: () => number) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Plan a wave. Enemy counts follow `composeWave` (so balance stays in
 * config.ts); this decides who travels together, from where, and when.
 */
export function planWave(wave: number, opts: WaveOptions): WavePlan {
  const rng = opts.rng ?? Math.random;
  const kind = waveKind(wave);
  // composeWave sizes by squad bots (×0.35 each); co-op humans count a bit more.
  const extra = Math.max(0, opts.team - 1);
  const comp = composeWave(wave, opts.countMul, (extra * 0.45) / 0.35);
  // Wave 5 has no Warden yet: its boss squad is a Juggernaut pair.
  if (kind === "boss" && comp.warden === 0) {
    const want = 2 - comp.armored;
    if (want > 0) {
      comp.armored += want;
      comp.rifleman = Math.max(0, comp.rifleman - want);
    }
  }
  const pool = { ...comp };
  const take = (t: EnemyType, n: number) => {
    const k = Math.max(0, Math.min(pool[t], n));
    pool[t] -= k;
    return Array<EnemyType>(k).fill(t);
  };
  const squads: Omit<SquadPlan, "at" | "sector">[] = [];
  const size = () => PACING.squadMin + Math.floor(rng() * (Math.min(PACING.squadMax, PACING.squadMin + 1 + Math.floor(wave / 4)) - PACING.squadMin + 1));

  // Boss squad: the Warden (or the Juggernaut pair) with two escorts.
  if (kind === "boss") {
    const members = comp.warden > 0 ? [...take("warden", 1), ...take("armored", 2)] : take("armored", 2);
    members.push(...take("rifleman", 2));
    squads.push({ role: "boss", members });
  }
  // Marksmen pairs.
  while (pool.sniper > 0) squads.push({ role: "marksman", members: take("sniper", Math.min(2, pool.sniper)) });
  // Extra wardens (wave 20+) lead heavy teams.
  while (pool.warden > 0) squads.push({ role: "boss", members: [...take("warden", 1), ...take("rifleman", 2)] });
  // Heavy teams: one or two Juggernauts with a rifle escort.
  while (pool.armored > 0) {
    const n = pool.armored >= 3 && wave >= 12 ? 2 : 1;
    squads.push({ role: "heavy", members: [...take("armored", n), ...take("rifleman", 2)] });
  }
  // Breacher rushes.
  while (pool.rusher > 0) {
    const n = Math.min(pool.rusher, Math.max(2, size()));
    const members = take("rusher", n);
    if (pool.rusher === 1) members.push(...take("rusher", 1));
    squads.push({ role: "rush", members });
  }
  // Rifle teams take the rest (a small remainder joins the last team).
  while (pool.rifleman > 0) {
    let n = Math.min(pool.rifleman, size());
    if (pool.rifleman - n > 0 && pool.rifleman - n < 2) n = pool.rifleman;
    squads.push({ role: "rifle", members: take("rifleman", n) });
  }

  // Order: open with a rifle team, keep the boss to about a third of the way
  // in, spread heavies and rushes through the rest.
  const openers = squads.filter((s) => s.role === "rifle");
  const rest = shuffle(squads.filter((s) => s.role !== "rifle" && s.role !== "boss"), rng);
  const order: typeof squads = [];
  if (openers.length) order.push(openers.shift()!);
  const mixed = shuffle([...openers, ...rest], rng);
  // Avoid two rushes or two heavy teams back to back where possible.
  for (let i = 1; i < mixed.length; i++) {
    if (mixed[i].role !== "rifle" && mixed[i].role === mixed[i - 1].role) {
      const j = mixed.findIndex((s, k) => k > i && s.role !== mixed[i].role);
      if (j > 0) [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
    }
  }
  order.push(...mixed);
  const boss = squads.find((s) => s.role === "boss" && s.members.includes("warden")) ?? squads.find((s) => s.role === "boss" && kind === "boss");
  for (const b of squads.filter((s) => s.role === "boss")) {
    if (order.includes(b)) continue;
    const at = b === boss ? Math.max(1, Math.round(order.length * 0.35)) : order.length;
    order.splice(Math.min(at, order.length), 0, b);
  }

  // Timing.
  const pace = 1 / Math.sqrt(Math.max(0.5, opts.countMul));
  const holdout = kind === "holdout";
  const gap = Math.max(PACING.gapMin, PACING.gapStart - wave * PACING.gapPerWave) * pace * (holdout ? 0.62 : 1) * (opts.team > 1 ? 0.88 : 1);
  const sectors = Math.max(1, opts.sectors);
  const out: SquadPlan[] = [];
  let t = PACING.firstSquad;
  let lastSector = -1;
  for (let i = 0; i < order.length; i++) {
    // Pincer: this squad lands with the previous one, from the other side.
    const pincer = i > 1 && out[i - 2].at !== out[i - 1].at && wave >= PACING.pincerFrom && sectors > 2 && order[i].role !== "boss" && out[i - 1].role !== "boss" && rng() < 0.22 + Math.min(0.2, (wave - PACING.pincerFrom) * 0.02);
    let sector: number;
    if (pincer) {
      t = out[i - 1].at;
      sector = (out[i - 1].sector + Math.floor(sectors / 2)) % sectors;
    } else {
      if (i > 0) {
        t += gap * (0.85 + rng() * 0.3) + (order[i - 1].members.length - 3) * 0.6;
        if (i % PACING.breatherEvery === 0) t += PACING.breather * (holdout ? 0.4 : 1);
      }
      sector = Math.floor(rng() * sectors);
      if (sectors > 1 && sector === lastSector) sector = (sector + 1 + Math.floor(rng() * (sectors - 1))) % sectors;
    }
    lastSector = sector;
    out.push({ ...order[i], at: Math.round(t * 10) / 10, sector });
  }
  const total = out.reduce((n, s) => n + s.members.length, 0);
  const hold = holdout ? PACING.holdBase + PACING.holdPerWave * wave : 0;
  return { wave, kind, title: waveTitle(kind, out, wave), squads: out, total, hold };
}

function waveTitle(kind: WaveKind, squads: SquadPlan[], wave: number) {
  if (kind === "boss") return squads.some((s) => s.members.includes("warden")) ? "The Warden" : "Iron Pair";
  if (kind === "holdout") return "Holdout";
  if (wave <= 1) return "Probing attack";
  const count = (r: SquadRole) => squads.filter((s) => s.role === r).reduce((n, s) => n + s.members.length, 0);
  const all = squads.reduce((n, s) => n + s.members.length, 0) || 1;
  if (count("rush") / all >= 0.3) return "Breacher rush";
  if (count("heavy") / all >= 0.35) return "Heavy push";
  if (count("marksman") >= 3) return "Overwatch";
  return squads.length >= 6 ? "Full assault" : "Assault";
}

/** Compass words for a bearing in radians (0 = north, clockwise). */
export function compassWord(bearing: number) {
  const names = ["NORTH", "NORTH-EAST", "EAST", "SOUTH-EAST", "SOUTH", "SOUTH-WEST", "WEST", "NORTH-WEST"];
  const k = Math.round(((bearing % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 4)) % 8;
  return names[k];
}

/** Bearing (0 = north = −z, clockwise) of a point seen from the origin. */
export const bearingOf = (x: number, z: number) => Math.atan2(x, -z);

export type SpawnSector = { bearing: number; label: string; points: number[] };

/**
 * Groups a map's enemy spawn points into compass sectors (eight octants,
 * empty ones dropped), ordered clockwise from north so that `sector + n/2`
 * is roughly the opposite side.
 */
export function spawnSectors(points: { x: number; z: number }[]): SpawnSector[] {
  const buckets: number[][] = Array.from({ length: 8 }, () => []);
  points.forEach((p, i) => {
    const b = bearingOf(p.x, p.z);
    const k = Math.round(((b + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    buckets[k].push(i);
  });
  const out: SpawnSector[] = [];
  buckets.forEach((pts, k) => {
    if (!pts.length) return;
    let sx = 0, sz = 0;
    for (const i of pts) {
      sx += points[i].x;
      sz += points[i].z;
    }
    const bearing = bearingOf(sx / pts.length, sz / pts.length);
    out.push({ bearing, label: compassWord(k * (Math.PI / 4)), points: pts });
  });
  return out;
}
