import { SHAKE } from "../config";
import type { CameraOffsets } from "../player/PlayerController";

const DEG = Math.PI / 180;

/**
 * Trauma-based camera shake (shake = trauma²), driven by smooth
 * sum-of-sines noise so it feels like a jolt rather than jitter.
 */
export class CameraShake {
  private trauma = 0;
  private t = 0;
  private readonly seeds = [Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100];

  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Writes shake offsets into `out` (recoil fields untouched). */
  update(dt: number, out: CameraOffsets) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - SHAKE.decay * dt);
    const s = this.trauma * this.trauma;
    const f = SHAKE.frequency * this.t;
    const n = (i: number) => Math.sin(f + this.seeds[i]) * 0.6 + Math.sin(f * 2.3 + this.seeds[i] * 1.7) * 0.4;
    out.shakePitch = n(0) * SHAKE.maxPitch * DEG * s;
    out.shakeYaw = n(1) * SHAKE.maxYaw * DEG * s;
    out.shakeRoll = n(2) * SHAKE.maxRoll * DEG * s;
    out.shakeX = n(3) * SHAKE.maxOffset * s;
    out.shakeY = n(4) * SHAKE.maxOffset * s;
  }
}
