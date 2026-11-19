import * as THREE from "three";
import type { SurvivalLayout } from "../world/MapLoader";
import type { NavGrid } from "../ai/NavGrid";
import type { EnemyType } from "./config";
import { WAVES } from "./config";

/**
 * Chooses where enemies enter: staging points outside the compound, far from
 * the player and preferably off-screen; snipers take free ridge perches.
 */
export class EnemySpawner {
  private readonly tmp = new THREE.Vector3();
  private readonly perchBusy: boolean[];

  constructor(private readonly layout: SurvivalLayout, private readonly nav: NavGrid) {
    this.perchBusy = layout.perches.map(() => false);
  }

  freePerches() {
    this.perchBusy.fill(false);
  }
  releasePerch(i: number) {
    if (i >= 0) this.perchBusy[i] = false;
  }

  /** Writes the spawn position into `out`; returns perch index for snipers (or -1), or null if none available. */
  pick(type: EnemyType, playerPos: THREE.Vector3, viewDir: THREE.Vector3, out: THREE.Vector3): { perch: number; yaw: number } | null {
    if (type === "sniper") {
      const free: number[] = [];
      this.perchBusy.forEach((b, i) => !b && free.push(i));
      if (!free.length) return null;
      // Prefer perches the player isn't looking at.
      free.sort((a, b) => this.facing(this.layout.perches[a], playerPos, viewDir) - this.facing(this.layout.perches[b], playerPos, viewDir));
      const i = free[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * free.length)];
      const p = this.layout.perches[i];
      this.perchBusy[i] = true;
      out.set(p.x, p.y, p.z);
      return { perch: i, yaw: Math.atan2(-p.x, -p.z) };
    }
    let best = -1;
    let bestScore = -Infinity;
    this.layout.enemySpawns.forEach((s, i) => {
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (d < WAVES.minSpawnDistance) return;
      const behind = 1 - this.facing(s, playerPos, viewDir); // 0..2, higher = behind the view
      const score = behind * 10 + Math.random() * 12 - Math.abs(d - 45) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) best = Math.floor(Math.random() * this.layout.enemySpawns.length);
    const s = this.layout.enemySpawns[best];
    // Jitter so groups don't stack, snapped to walkable ground.
    const cell = this.nav.nearestWalkable(s.x + (Math.random() - 0.5) * 5, s.z + (Math.random() - 0.5) * 5);
    if (cell < 0) return null;
    out.set(this.nav.cx(cell), this.nav.floor[cell], this.nav.cz(cell));
    return { perch: -1, yaw: Math.atan2(-out.x, -out.z) };
  }

  private facing(p: { x: number; z: number }, from: THREE.Vector3, viewDir: THREE.Vector3) {
    this.tmp.set(p.x - from.x, 0, p.z - from.z).normalize();
    return this.tmp.x * viewDir.x + this.tmp.z * viewDir.z;
  }
}
