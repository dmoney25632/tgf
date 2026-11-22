import * as THREE from "three";
import type { SurvivalLayout } from "../world/MapLoader";
import type { NavGrid } from "../ai/NavGrid";
import type { EnemyType } from "./config";
import { WAVES } from "./config";
import { bearingOf, spawnSectors, type SpawnSector } from "./waves";

/**
 * Chooses where enemies enter: staging points outside the compound, far from
 * the player and preferably off-screen; snipers take free ridge perches.
 */
export class EnemySpawner {
  private readonly tmp = new THREE.Vector3();
  private readonly perchBusy: boolean[];
  /** Spawn points grouped by compass direction (squads enter from one sector). */
  readonly sectors: SpawnSector[];

  constructor(private readonly layout: SurvivalLayout, private readonly nav: NavGrid) {
    this.perchBusy = layout.perches.map(() => false);
    this.sectors = spawnSectors(layout.enemySpawns);
  }

  /** Where a sector's squads gather (mean of its spawn points). */
  sectorCentre(sector: number, out: { x: number; z: number }) {
    const s = this.sectors[sector];
    out.x = 0;
    out.z = 0;
    if (!s) return out;
    for (const i of s.points) {
      out.x += this.layout.enemySpawns[i].x;
      out.z += this.layout.enemySpawns[i].z;
    }
    out.x /= s.points.length;
    out.z /= s.points.length;
    return out;
  }

  /**
   * Spawn for a squad member entering from `sector`: one of that sector's
   * points (not right next to the player), jittered onto walkable ground.
   * Marksmen take a free perch, preferring ones on the squad's side.
   * Falls back to the general pick when the sector is unusable.
   */
  pickInSector(type: EnemyType, sector: number, playerPos: THREE.Vector3, viewDir: THREE.Vector3, out: THREE.Vector3): { perch: number; yaw: number } | null {
    const sec = this.sectors[sector];
    if (!sec) return this.pick(type, playerPos, viewDir, out);
    if (type === "sniper") {
      let best = -1;
      let bestD = Infinity;
      this.layout.perches.forEach((p, i) => {
        if (this.perchBusy[i]) return;
        const d = Math.abs(Math.atan2(Math.sin(bearingOf(p.x, p.z) - sec.bearing), Math.cos(bearingOf(p.x, p.z) - sec.bearing)));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return null;
      const p = this.layout.perches[best];
      this.perchBusy[best] = true;
      out.set(p.x, p.y, p.z);
      return { perch: best, yaw: Math.atan2(-p.x, -p.z) };
    }
    const ok = sec.points.filter((i) => {
      const s = this.layout.enemySpawns[i];
      return Math.hypot(s.x - playerPos.x, s.z - playerPos.z) >= WAVES.minSpawnDistance;
    });
    if (!ok.length) return this.pick(type, playerPos, viewDir, out);
    const s = this.layout.enemySpawns[ok[Math.floor(Math.random() * ok.length)]];
    const cell = this.nav.nearestWalkable(s.x + (Math.random() - 0.5) * 6, s.z + (Math.random() - 0.5) * 6);
    if (cell < 0) return this.pick(type, playerPos, viewDir, out);
    out.set(this.nav.cx(cell), this.nav.floor[cell], this.nav.cz(cell));
    return { perch: -1, yaw: Math.atan2(-out.x, -out.z) };
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
