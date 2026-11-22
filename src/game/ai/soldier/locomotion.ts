/**
 * Locomotion blend space for the motion-captured soldier (pure maths, no
 * three.js, so it is unit-tested). Clips are phase-synced: one normalised
 * gait phase drives every moving clip, advanced by ground speed over the
 * blended stride length, so feet stay planted whatever the blend.
 */

export type LocoClip = "idle" | "walk" | "jog" | "sprint" | "crouchIdle" | "crouchWalk";
export const LOCO_CLIPS: readonly LocoClip[] = ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk"];
export const MOVING: readonly LocoClip[] = ["walk", "jog", "sprint", "crouchWalk"];

/** Clip timing from soldiers.json: duration (s) and ground travelled per cycle (m). */
export type ClipInfo = { duration: number; stride: number };
export type LocoWeights = Record<LocoClip, number>;

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Speed bands (m/s). The walk clip (~0.9 m/s natural) is played up to ~1.9x
 * before handing over to the jog (~5 m/s natural); AI patrol speeds (1.7 to
 * 3.2 m/s) land in a walk/jog blend, run speeds (4 to 6.4 m/s) on the jog and
 * sprint.
 */
export const BANDS = { move: [0.12, 0.5], walkJog: [1.6, 3.6], jogSprint: [5.6, 7.2], crouchMove: [0.12, 0.45] } as const;

/** Blend weights for a ground speed and crouch amount (0..1). Always sums to 1. */
export function locoWeights(speed: number, crouch: number, out: LocoWeights): LocoWeights {
  const s = Math.abs(speed);
  const c = sat(crouch);
  const m = smooth(BANDS.move[0], BANDS.move[1], s);
  const j = smooth(BANDS.walkJog[0], BANDS.walkJog[1], s);
  const r = smooth(BANDS.jogSprint[0], BANDS.jogSprint[1], s);
  const stand = 1 - c;
  out.idle = stand * (1 - m);
  out.walk = stand * m * (1 - j);
  out.jog = stand * m * j * (1 - r);
  out.sprint = stand * m * j * r;
  const cm = smooth(BANDS.crouchMove[0], BANDS.crouchMove[1], s);
  out.crouchIdle = c * (1 - cm);
  out.crouchWalk = c * cm;
  return out;
}

/**
 * Metres per gait cycle for the current blend (the moving clips' strides
 * weighted by their share of the moving weight). Returns 0 when nothing moves.
 */
export function blendStride(w: LocoWeights, info: Record<LocoClip, ClipInfo>): number {
  let tot = 0, acc = 0;
  for (const k of MOVING) {
    tot += w[k];
    acc += w[k] * info[k].stride;
  }
  return tot > 1e-4 ? acc / tot : 0;
}

/** Advances the normalised gait phase (wraps to [0, 1)); negative speed plays it backwards. */
export function advancePhase(phase: number, dt: number, speed: number, stride: number): number {
  if (stride <= 1e-4) return phase;
  const p = phase + (dt * speed) / stride;
  return p - Math.floor(p);
}

/**
 * Lower-body yaw toward the travel direction. alpha: travel direction in the
 * body frame (0 = forward, +pi/2 = to the soldier's left). Moving backwards
 * keeps the hips square and plays the gait in reverse (dir = -1). Strafes
 * turn the hips up to `max` rad, the torso counter-rotates.
 */
export function hipYaw(alpha: number, max = 1.05): { yaw: number; dir: 1 | -1 } {
  let a = alpha;
  let dir: 1 | -1 = 1;
  if (Math.abs(a) > Math.PI / 2 + 0.15) {
    a = a - Math.sign(a) * Math.PI;
    dir = -1;
  }
  return { yaw: Math.max(-max, Math.min(max, a)), dir };
}
