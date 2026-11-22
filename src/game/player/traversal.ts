import * as THREE from "three";
import type { CollisionWorld } from "../world/Collision";

/**
 * Mantle & vault: probe logic and the motion curve.
 *
 * Pure functions over the AABB collision world, so they run headless in
 * tests. The player controller asks `planTraversal` when jump is pressed
 * while pushing forward; a plan is a short scripted move (rise, cross the
 * lip, settle or drop) that has already been checked against the world
 * along its whole path, then `samplePlan` drives the feet along it.
 */
export const TRAVERSAL = {
  /** Lower ledges are a step-up or a plain jump. */
  minHeight: 0.5,
  /** Tallest obstacle you vault over (hands on top, legs swing across). */
  vaultMaxHeight: 1.15,
  /** Deepest obstacle (along the move) that still counts as vaultable. */
  vaultMaxDepth: 1.0,
  /** Tallest ledge you can pull yourself onto. */
  mantleMaxHeight: 1.9,
  /** How far beyond the collider a ledge face is still grabbed (m). */
  reach: 0.55,
  /** Feet clear the top by this much while crossing (m). */
  vaultClearance: 0.08,
  mantleClearance: 0.04,
  /** Collider while moving: tucked body, slimmer than standing. */
  tuckHeight: 1.0,
  tuckRadiusScale: 0.8,
  /** Durations (s): base + per metre of height. */
  vaultTime: 0.44,
  vaultTimePerM: 0.12,
  mantleTime: 0.36,
  mantleTimePerM: 0.18,
  /** A vault's scripted drop covers at most this much; the rest is a real fall (m). */
  vaultScriptedDrop: 0.3,
  /** Forward speed kept after a vault (m/s). */
  vaultExitSpeed: 4.4,
  /** Forward speed after a mantle (m/s). */
  mantleExitSpeed: 0.8,
  /** After a jump, running into a ledge still mantles for this long (s). */
  airWindow: 0.45,
  /** Airborne mantles need you not to be dropping faster than this (m/s). */
  airMinVy: -2.5,
  /**
   * Visual: how far the eye sinks from the finishing stance toward the tucked
   * body at the middle of the move (0..1), and the camera roll (deg).
   */
  vaultEyeTuck: 1.0,
  mantleEyeTuck: 0.55,
  vaultRoll: 4,
  mantleRoll: 2,
} as const;

export type TraversalKind = "vault" | "mantle";

export type TraversalPlan = {
  kind: TraversalKind;
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Obstacle top (world y). */
  top: number;
  /** Feet height while crossing the lip. */
  peakY: number;
  /** Phase times (0..1): forward motion starts, rise done, drop starts. */
  sLead: number;
  sRise: number;
  sDrop: number;
  duration: number;
  /** Not enough headroom to stand at the end: finish crouched. */
  crouchEnd: boolean;
  /**
   * The move ends in the air (vaults: the last bit of the drop is a real
   * fall, so the landing has weight); physics takes over with `exitVy`.
   */
  exitAirborne: boolean;
  /** Vertical speed handed to physics at the end (m/s, ≤ 0). */
  exitVy: number;
  dirX: number;
  dirZ: number;
};

export type TraversalBody = { radius: number; standHeight: number; crouchHeight: number; stepHeight: number };

/** Per-map limits so climbing can't leave the play space. */
export type ClimbRules = {
  /** Mantle / vault disabled entirely. */
  disabled?: boolean;
  /** |x| and |z| of the end point must stay within this (map half-size). */
  bound: number;
  /** End feet height may not exceed this (world y). */
  maxY: number;
};

export const OPEN_RULES: ClimbRules = { bound: Infinity, maxY: Infinity };

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => x * x * (3 - 2 * x);
/** Inverse of smoothstep on [0, 1]. */
const invSmooth = (y: number) => (y <= 0 ? 0 : y >= 1 ? 1 : 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3));

/** Feet position at phase s (0..1) of the plan. */
export function samplePlan(p: TraversalPlan, s: number, out: THREE.Vector3) {
  s = clamp01(s);
  const h = smooth(clamp01((s - p.sLead) / (1 - p.sLead)));
  out.x = p.start.x + (p.end.x - p.start.x) * h;
  out.z = p.start.z + (p.end.z - p.start.z) * h;
  if (s < p.sRise) {
    out.y = p.start.y + (p.peakY - p.start.y) * smooth(s / p.sRise);
  } else if (s < p.sDrop || p.sDrop >= 1) {
    out.y = p.peakY;
  } else {
    const k = (s - p.sDrop) / (1 - p.sDrop);
    out.y = p.peakY + (p.end.y - p.peakY) * k * k;
  }
  return out;
}

/** 0..1..0 bump over the move (camera dip / roll, weapon lowering). */
export function planBump(s: number) {
  return Math.sin(Math.PI * clamp01(s));
}

/**
 * Phase timing: forward motion waits `lead0`, the rise completes no earlier
 * than `riseMin` and no later than the body reaching the obstacle face, the
 * drop starts once the body has cleared the far side.
 */
function timing(plan: TraversalPlan, frontFrac: number, backFrac: number, lead0: number, riseMin: number) {
  const u = invSmooth(frontFrac);
  let lead = lead0;
  if (lead + (1 - lead) * u < riseMin) lead = Math.max(lead0, (riseMin - u) / Math.max(1e-3, 1 - u));
  plan.sLead = Math.min(0.85, lead);
  plan.sRise = plan.sLead + (1 - plan.sLead) * u;
  plan.sDrop = backFrac >= 1 ? 1 : Math.max(plan.sRise, plan.sLead + (1 - plan.sLead) * invSmooth(backFrac));
}

/** True when the whole path (and the final pose) is free of the world. */
export function planIsClear(world: CollisionWorld, p: TraversalPlan, body: TraversalBody) {
  const rt = body.radius * TRAVERSAL.tuckRadiusScale;
  const tuck = Math.min(TRAVERSAL.tuckHeight, body.crouchHeight);
  for (let i = 1; i <= 12; i++) {
    samplePlan(p, i / 12, _p);
    if (world.overlaps(_p, rt, tuck)) return false;
  }
  const endH = p.crouchEnd ? body.crouchHeight : body.standHeight;
  return !world.overlaps(p.end, body.radius, endH);
}

/** Distance (from the body centre, along dir) to the nearest obstacle face in reach, or Infinity. */
export function probeFace(world: CollisionWorld, feet: THREE.Vector3, dirX: number, dirZ: number, body: TraversalBody) {
  const max = body.radius * Math.SQRT2 + TRAVERSAL.reach;
  let face = Infinity;
  for (const h of [TRAVERSAL.minHeight + 0.02, 0.95, 1.4, TRAVERSAL.mantleMaxHeight - 0.05]) {
    // Side rays too, so a post or a narrow gap edge doesn't hide behind the centre ray.
    for (const side of [0, -0.6, 0.6]) {
      const ox = feet.x - dirZ * body.radius * side, oz = feet.z + dirX * body.radius * side;
      const t = world.raycast(ox, feet.y + h, oz, dirX, 0, dirZ, max);
      if (t < face) face = t;
    }
  }
  return face;
}

/**
 * Looks for a vault or mantle in front of the body. `groundY` is where the
 * feet last stood (airborne mantles measure height from there). Returns a
 * checked plan or null.
 */
export function planTraversal(
  world: CollisionWorld,
  feet: THREE.Vector3,
  dirX: number,
  dirZ: number,
  body: TraversalBody,
  rules: ClimbRules = OPEN_RULES,
  groundY = feet.y,
): TraversalPlan | null {
  if (rules.disabled) return null;
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-4) return null;
  dirX /= len;
  dirZ /= len;
  const face = probeFace(world, feet, dirX, dirZ, body);
  if (face === Infinity) return null;

  // Ledge top: a ray down just inside the face.
  const reachTop = groundY + TRAVERSAL.mantleMaxHeight + 0.05;
  const inset = 0.12;
  const px = feet.x + dirX * (face + inset), pz = feet.z + dirZ * (face + inset);
  const span = reachTop - (feet.y + TRAVERSAL.minHeight - 0.2);
  if (span <= 0) return null;
  const d = world.raycast(px, reachTop, pz, 0, -1, 0, span);
  // d = 0: the probe starts inside something (a wall taller than the reach).
  if (d === Infinity || d < 0.01) return null;
  const topBox = world.lastHit;
  if (topBox < 0 || world.isNoClimb(topBox)) return null; // moving pieces (doors) and flagged boxes
  const top = reachTop - d;
  const height = top - feet.y;
  if (height < TRAVERSAL.minHeight || top - groundY > TRAVERSAL.mantleMaxHeight) return null;

  if (height <= TRAVERSAL.vaultMaxHeight) {
    const v = planVault(world, feet, dirX, dirZ, body, rules, face, top);
    if (v) return v;
  }
  return planMantle(world, feet, dirX, dirZ, body, rules, face, top);
}

function inRules(rules: ClimbRules, p: THREE.Vector3) {
  return Math.abs(p.x) <= rules.bound && Math.abs(p.z) <= rules.bound && p.y <= rules.maxY + 1e-3;
}

function planVault(world: CollisionWorld, feet: THREE.Vector3, dirX: number, dirZ: number, body: TraversalBody, rules: ClimbRules, face: number, top: number): TraversalPlan | null {
  const r = body.radius;
  const rt = r * TRAVERSAL.tuckRadiusScale;
  const probeY = top + 0.3;
  // March across the top until it drops away (the far side).
  let back = -1;
  const step = 0.08;
  for (let k = 1; k * step <= TRAVERSAL.vaultMaxDepth + step; k++) {
    const dist = face + k * step;
    const d = world.raycast(feet.x + dirX * dist, probeY, feet.z + dirZ * dist, 0, -1, 0, probeY - feet.y + 3);
    if (d < 0.01) return null; // a taller part sticks up: not a clean vault
    const y = probeY - d;
    if (d === Infinity || y < top - 0.2) {
      back = dist;
      break;
    }
  }
  if (back < 0 || back - face > TRAVERSAL.vaultMaxDepth) return null;
  const landDist = back + r + 0.3;
  const lx = feet.x + dirX * landDist, lz = feet.z + dirZ * landDist;
  const gd = world.raycast(lx, probeY, lz, 0, -1, 0, probeY - feet.y + 3);
  if (gd < 0.01) return null;
  const ground = gd === Infinity ? -Infinity : probeY - gd;
  if (ground > feet.y + body.stepHeight) return null; // far side is higher: that's a mantle
  const peakY = top + TRAVERSAL.vaultClearance;
  // Script only the start of the drop; gravity finishes it.
  const endY = Math.max(ground, peakY - TRAVERSAL.vaultScriptedDrop);
  const exitAirborne = endY > ground + 0.01;
  const end = new THREE.Vector3(lx, endY, lz);
  if (!inRules(rules, end)) return null;
  // Somewhere to land (standing) under the end point.
  if (Number.isFinite(ground) && world.overlaps(_q.set(lx, ground, lz), r, body.standHeight)) return null;
  const height = top - feet.y;
  const plan: TraversalPlan = {
    kind: "vault", start: feet.clone(), end, top, peakY, sLead: 0, sRise: 0, sDrop: 1,
    duration: TRAVERSAL.vaultTime + TRAVERSAL.vaultTimePerM * height,
    crouchEnd: false, exitAirborne, exitVy: 0, dirX, dirZ,
  };
  const L = landDist;
  timing(plan, Math.max(0, (face - rt - 0.02) / L), Math.min(1, (back + rt + 0.04) / L), 0.08, 0.38);
  // Speed at the end of the scripted (ease-in) drop: physics continues from it.
  const dropT = (1 - plan.sDrop) * plan.duration;
  plan.exitVy = dropT > 1e-3 ? (-2 * (peakY - endY)) / dropT : 0;
  if (!planIsClear(world, plan, body)) return null;
  return plan;
}

function planMantle(world: CollisionWorld, feet: THREE.Vector3, dirX: number, dirZ: number, body: TraversalBody, rules: ClimbRules, face: number, top: number): TraversalPlan | null {
  const r = body.radius;
  const rt = r * TRAVERSAL.tuckRadiusScale;
  // Something to stand on a little past the lip (not a railing or a wall cap edge).
  _q.set(feet.x + dirX * (face + 0.22), top - 0.04, feet.z + dirZ * (face + 0.22));
  if (!world.overlaps(_q, 0.05, 0.035)) return null;
  const endDist = face + r + 0.08;
  const end = new THREE.Vector3(feet.x + dirX * endDist, top, feet.z + dirZ * endDist);
  if (!inRules(rules, end)) return null;
  // Is the top we stand on still climbable (a different box can sit under the end point)?
  const ed = world.raycast(end.x, top + 0.05, end.z, 0, -1, 0, 0.2);
  if (ed !== Infinity && world.lastHit >= 0 && world.isNoClimb(world.lastHit)) return null;
  let crouchEnd = false;
  if (world.overlaps(end, r, body.standHeight)) {
    if (world.overlaps(end, r, body.crouchHeight)) return null;
    crouchEnd = true;
  }
  const height = top - feet.y;
  const plan: TraversalPlan = {
    kind: "mantle", start: feet.clone(), end, top, peakY: top + TRAVERSAL.mantleClearance, sLead: 0, sRise: 0, sDrop: 1,
    duration: TRAVERSAL.mantleTime + TRAVERSAL.mantleTimePerM * height,
    crouchEnd, exitAirborne: false, exitVy: 0, dirX, dirZ,
  };
  timing(plan, Math.max(0, (face - rt - 0.02) / endDist), 1, 0.3, 0.42 + 0.06 * Math.max(0, height - 1));
  plan.sDrop = Math.max(plan.sRise, 0.78);
  if (!planIsClear(world, plan, body)) return null;
  return plan;
}
