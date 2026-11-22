import * as THREE from "three";

/**
 * Pooled dynamic lights for short flashes (muzzle flashes, explosions,
 * sparks): a fixed number of shadowless point lights per preset, so the
 * light count never changes mid-match (no shader recompiles). A flash takes
 * a free light, or steals the one with the least light left; intensity
 * falls off as (1 - t)^2 over its duration, with a little flicker.
 *
 *   import { flashLight } from "../render/FlashLights";
 *   flashLight(muzzleWorldPos, 0xffa850, 9, 50);          // rifle shot
 *   flashLight(blastPos, 0xff9a40, 90, 320, 28);          // grenade
 *
 * Intensity is three's point-light intensity (candela, as EffectsPool uses).
 * Safe to call with no map loaded (no-op). Positions are copied.
 */

type Slot = { start: number; ms: number; peak: number; flicker: number };

export class FlashLightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly slots: Slot[] = [];
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, count: number) {
    this.group.name = "flash-lights";
    scene.add(this.group);
    this.setCount(count);
  }

  /** Pool size (changing it recompiles lit materials: call on preset change only). */
  setCount(count: number) {
    count = Math.max(0, Math.min(4, Math.round(count)));
    while (this.lights.length > count) {
      const l = this.lights.pop()!;
      this.slots.pop();
      this.group.remove(l);
      l.dispose();
    }
    while (this.lights.length < count) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.slots.push({ start: 0, ms: 0, peak: 0, flicker: 1 });
      this.group.add(l);
    }
  }

  /** Light left in a slot at `now` (0 = free). */
  private remaining(s: Slot, now: number) {
    if (s.ms <= 0) return 0;
    const t = (now - s.start) / s.ms;
    return t >= 1 ? 0 : s.peak * (1 - t) * (1 - t);
  }

  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, ms: number, distance = 10) {
    const n = this.lights.length;
    if (!n || intensity <= 0 || ms <= 0) return false;
    const now = performance.now();
    let best = 0, bestLeft = Infinity;
    for (let i = 0; i < n; i++) {
      const left = this.remaining(this.slots[i], now);
      if (left < bestLeft) {
        bestLeft = left;
        best = i;
      }
    }
    // Don't let a pistol shot steal a fresh explosion's light.
    if (bestLeft > intensity * 1.5) return false;
    const l = this.lights[best];
    const s = this.slots[best];
    l.position.set(x, y, z);
    l.color.set(color);
    l.distance = distance;
    l.updateMatrixWorld();
    s.start = now;
    s.ms = ms;
    s.peak = intensity;
    l.intensity = intensity;
    return true;
  }

  /** Per frame (any number of calls per frame is fine: time based). */
  update(now = performance.now()) {
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.slots[i];
      const left = this.remaining(s, now);
      if (left <= 0) {
        s.ms = 0;
        this.lights[i].intensity = 0;
        continue;
      }
      // Fire flickers; ~20 Hz noise keeps big flashes alive without strobing.
      s.flicker = 0.88 + 0.24 * Math.abs(Math.sin(now * 0.061 + i * 1.7));
      this.lights[i].intensity = left * s.flicker;
    }
  }

  dispose() {
    this.setCount(0);
    this.group.removeFromParent();
  }
}

let pool: FlashLightPool | null = null;

/** Creates the pool for a scene (MapLoader does this per map). */
export function installFlashLights(scene: THREE.Scene, count: number) {
  pool?.dispose();
  pool = new FlashLightPool(scene, count);
  return pool;
}

/** Removes the pool (only if `p` is still the installed one). */
export function uninstallFlashLights(p: FlashLightPool) {
  if (pool !== p) return;
  pool.dispose();
  pool = null;
}

/**
 * Lights nearby surfaces for `ms` milliseconds. Returns false when no light
 * was free (or none exist on this preset).
 */
export function flashLight(position: { x: number; y: number; z: number }, color: THREE.ColorRepresentation, intensity: number, ms: number, distance = 10) {
  return pool ? pool.flash(position.x, position.y, position.z, color, intensity, ms, distance) : false;
}
