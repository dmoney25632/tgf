/**
 * Stealth detection math: pure, engine-free and unit-tested
 * (tests/stealthDetection.test.ts).
 *
 * Each guard keeps a 0 … 1 awareness gauge per player. Every think tick the
 * gauge fills by `visionRate()` × dt while the guard can see that player,
 * and decays slowly once it can't. Crossing `DETECT.suspicious` makes the
 * guard suspicious (it stops and turns to look, then investigates); reaching
 * 1 means the guard has *identified* an intruder and starts raising the
 * alarm (see StealthDirector).
 *
 * What a guard can see depends on:
 *  - Light at the player: moonlight is dim; lamps, searchlight pools, truck
 *    headlights and guards' torches raise it. Light scales the guard's
 *    effective sight range between `darkRange` (pitch dark) and full.
 *  - Distance (falls off towards the effective range) and angle (a sharp
 *    central cone, a wider peripheral band, nothing behind).
 *  - Stance and speed: crouching and standing still shrink your profile,
 *    sprinting makes you obvious.
 *  - Concealment: tall grass and reeds hide a crouched player almost
 *    entirely; bushes likewise. (There is no prone stance in Iron Horizon:
 *    crouching in grass plays that role.)
 *  - The guard's state: suspicious and alerted guards look harder (longer range).
 *  - Line of sight (checked by the caller against the collision world).
 *
 * Hearing is separate: noises have a radius (`NOISE`), halved-ish through
 * walls; a guard inside the radius turns towards it and investigates.
 */

export type Awareness = 0 | 1 | 2; // calm, suspicious, alerted

export const DETECT = {
  /** Sight range (m) in full light, calm guard. */
  range: 34,
  /** Half-angle (rad) of the whole vision cone; `focus` is the sharp centre. */
  fov: 1.05,
  focus: 0.45,
  /** Weight at the edge of the cone (peripheral vision). */
  peripheral: 0.35,
  /** Effective range fraction in pitch darkness (moonless). */
  darkRange: 0.3,
  /** Profile multipliers. */
  crouch: 0.55,
  still: 0.55,
  walk: 1,
  run: 1.6,
  /** Speed (m/s) at or below which you count as still, and at or above which as running. */
  stillSpeed: 0.4,
  runSpeed: 5,
  /** Inside this (m) an upright, moving player is felt even from behind (crouch-walking stays silent). */
  closeSense: 1.6,
  /** Gauge fill per second at point-blank, full weight. */
  fill: 1.6,
  /** Gauge decay per second, after `grace` seconds unseen. */
  decay: 0.18,
  grace: 2.5,
  /** Gauge thresholds. */
  suspicious: 0.3,
  detected: 1,
  /** Sight range multipliers when suspicious / alerted. */
  alertRange: [1, 1.2, 1.45] as const,
  /** Concealment: crouched in full cover × (1 − crouchHide); upright × (1 − standHide). */
  crouchHide: 0.8,
  standHide: 0.3,
};

/** Detection speed per difficulty. Recruit is forgiving; Veteran is sharper (and also fails on detection). */
export const DIFFICULTY_FILL: Record<string, number> = { recruit: 0.75, regular: 1, veteran: 1.2 };

export type Observer = {
  x: number; y: number; z: number;
  /** Agent yaw: facing direction is (sin yaw, cos yaw). */
  yaw: number;
  awareness: Awareness;
};

export type Subject = {
  x: number; y: number; z: number;
  crouching: boolean;
  /** Horizontal speed (m/s). */
  speed: number;
  /** 0 … 1 at the subject's position (tall grass, bush). */
  concealment: number;
  /** 0 … 1 light at the subject. */
  light: number;
};

/** Angle (rad) between the observer's facing and the direction to (x, z). */
export function bearingOff(o: Pick<Observer, "x" | "z" | "yaw">, x: number, z: number) {
  const dx = x - o.x, dz = z - o.z;
  const want = Math.atan2(dx, dz);
  let d = want - o.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** 1 in the focus cone, easing to `peripheral` at the edge, 0 outside. */
export function angleWeight(off: number) {
  if (off <= DETECT.focus) return 1;
  if (off >= DETECT.fov) return 0;
  const t = (off - DETECT.focus) / (DETECT.fov - DETECT.focus);
  return 1 + (DETECT.peripheral - 1) * t;
}

/** Effective sight range (m) for a given light level and awareness. */
export function effectiveRange(light: number, awareness: Awareness) {
  const l = Math.max(0, Math.min(1, light));
  return DETECT.range * (DETECT.darkRange + (1 - DETECT.darkRange) * l) * DETECT.alertRange[awareness];
}

/** Profile multiplier from stance, speed and concealment. */
export function profile(s: Pick<Subject, "crouching" | "speed" | "concealment">) {
  const stance = s.crouching ? DETECT.crouch : 1;
  let motion: number;
  if (s.speed <= DETECT.stillSpeed) motion = DETECT.still;
  else if (s.speed >= DETECT.runSpeed) motion = DETECT.run;
  else {
    const t = (s.speed - DETECT.stillSpeed) / (DETECT.runSpeed - DETECT.stillSpeed);
    motion = t < 0.35 ? DETECT.still + (DETECT.walk - DETECT.still) * (t / 0.35) : DETECT.walk + (DETECT.run - DETECT.walk) * ((t - 0.35) / 0.65);
  }
  const c = Math.max(0, Math.min(1, s.concealment));
  const hide = 1 - c * (s.crouching ? DETECT.crouchHide : DETECT.standHide);
  return stance * motion * hide;
}

/**
 * Gauge fill rate (per second, before the difficulty multiplier) for this
 * observer looking at this subject. `los` = clear line of sight.
 */
export function visionRate(o: Observer, s: Subject, los: boolean) {
  if (!los) return 0;
  const dx = s.x - o.x, dz = s.z - o.z, dy = s.y - o.y;
  const d = Math.hypot(dx, dz, dy * 0.5);
  // Close sense: a guard feels someone upright and moving right next to them, whatever the angle.
  if (d < DETECT.closeSense && !s.crouching && s.speed > DETECT.stillSpeed) return DETECT.fill * 2;
  const range = effectiveRange(s.light, o.awareness);
  if (d >= range) return 0;
  const aw = angleWeight(bearingOff(o, s.x, s.z));
  if (aw <= 0) return 0;
  const dw = Math.pow(1 - d / range, 1.2);
  return DETECT.fill * dw * aw * profile(s);
}

/** Advance a gauge by one tick. `unseen` = seconds since this guard last had any sight of the subject. */
export function stepGauge(g: number, rate: number, dt: number, unseen: number, difficulty: string) {
  if (rate > 0) return Math.min(1, g + rate * dt * (DIFFICULTY_FILL[difficulty] ?? 1));
  if (unseen < DETECT.grace) return g;
  return Math.max(0, g - DETECT.decay * dt);
}

/** Seconds a subject must stay in view for a calm guard to identify them (Infinity if never). */
export function secondsToDetect(o: Observer, s: Subject, difficulty = "regular") {
  const r = visionRate(o, s, true) * (DIFFICULTY_FILL[difficulty] ?? 1);
  return r > 0 ? DETECT.detected / r : Infinity;
}

// ---- Hearing ---------------------------------------------------------------------------------------------

/** Audible radius (m) of each kind of noise. */
export const NOISE = {
  gunshot: 70,
  suppressed: 7,
  sprint: 10,
  walk: 3.5,
  crouchWalk: 0,
  knife: 3,
  /** A body dropping / a takedown scuffle. */
  body: 5,
  explosion: 95,
  /** Through walls or floors the radius shrinks to this fraction. */
  occluded: 0.55,
};
export type NoiseKind = Exclude<keyof typeof NOISE, "occluded">;

/** Footstep noise kind for a moving player. */
export function stepNoise(speed: number, crouching: boolean, sprinting: boolean): NoiseKind | null {
  if (speed < 0.6) return null;
  if (crouching) return "crouchWalk";
  if (sprinting || speed >= DETECT.runSpeed) return "sprint";
  return "walk";
}

export function hears(listener: { x: number; z: number }, src: { x: number; z: number }, kind: NoiseKind, occluded: boolean) {
  const r = NOISE[kind] * (occluded ? NOISE.occluded : 1);
  return r > 0 && Math.hypot(listener.x - src.x, listener.z - src.z) <= r;
}

/** Does this noise raise the alarm outright (vs. an investigation)? */
export function alarming(kind: NoiseKind) {
  return kind === "gunshot" || kind === "explosion";
}

// ---- Light ------------------------------------------------------------------------------------------------

/** A cone light (truck headlight, guard's torch): apex, flat direction, reach and half-angle. */
export type ConeLight = { x: number; z: number; dx: number; dz: number; reach: number; halfAngle: number; strength: number };
/** A searchlight's lit ground spot. */
export type SpotLight = { x: number; z: number; radius: number };

export function coneLight(c: ConeLight, x: number, z: number) {
  const vx = x - c.x, vz = z - c.z;
  const d = Math.hypot(vx, vz);
  if (d > c.reach || d < 0.01) return d < 0.01 ? c.strength : 0;
  const cos = (vx * c.dx + vz * c.dz) / d;
  const edge = Math.cos(c.halfAngle);
  if (cos <= edge) return 0;
  const a = (cos - edge) / (1 - edge);
  return c.strength * Math.min(1, a * 2.5) * (1 - (d / c.reach) ** 2);
}

export function spotLight(s: SpotLight, x: number, z: number) {
  const d = Math.hypot(x - s.x, z - s.z);
  if (d >= s.radius * 1.3) return 0;
  return d <= s.radius ? 1 : 1 - (d - s.radius) / (s.radius * 0.3);
}

/** Total light at a point: base (static lamps + moon) plus moving lights, clamped to 1. */
export function lightAt(base: number, x: number, z: number, spots: readonly SpotLight[], cones: readonly ConeLight[]) {
  let l = base;
  for (const s of spots) l += spotLight(s, x, z);
  for (const c of cones) l += coneLight(c, x, z);
  return Math.min(1, l);
}
