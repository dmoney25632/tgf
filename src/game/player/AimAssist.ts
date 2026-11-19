import * as THREE from "three";
import { LOOK } from "../config";
import type { HitboxUserData } from "../core/types";
import type { CollisionWorld } from "../world/Collision";
import type { PlayerController } from "./PlayerController";

const DEG = Math.PI / 180;
const A = LOOK.aimAssist;

/**
 * Light, honest gamepad aim assist:
 *  - slowdown: the right stick turns slower while the crosshair is over a
 *    visible target (helps you stay on it; never moves the view by itself);
 *  - ADS snap: starting to aim near a visible target nudges part of the way
 *    toward its centre mass over ~0.1 s (capped at a few degrees).
 * No rotational tracking, no headshot bias, nothing through walls.
 */
export class AimAssist {
  /** Stick-speed multiplier for this frame (1 = no assist). */
  slow = 1;
  private prevAds = 0;
  private snapT = 0;
  private snapYaw = 0;
  private snapPitch = 0;
  private readonly p = new THREE.Vector3();
  private readonly best = new THREE.Vector3();

  reset() {
    this.slow = 1;
    this.snapT = 0;
    this.prevAds = 0;
  }

  /**
   * `targets`: the weapon's raycast hitboxes (only "body" parts are used).
   * Returns the stick slowdown multiplier.
   */
  update(dt: number, targets: readonly THREE.Object3D[], eye: THREE.Vector3, player: PlayerController, ads: number, world: CollisionWorld) {
    const cp = Math.cos(player.pitch);
    const fx = -Math.sin(player.yaw) * cp, fy = Math.sin(player.pitch), fz = -Math.cos(player.yaw) * cp;

    let bestRatio = Infinity;
    let bestDist = 0;
    for (let i = 0; i < targets.length; i++) {
      const o = targets[i] as THREE.Mesh;
      const ud = o.userData as HitboxUserData | undefined;
      if (!ud || ud.part !== "body") continue;
      const g = o.geometry;
      if (g) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        this.p.copy(g.boundingSphere!.center).applyMatrix4(o.matrixWorld);
      } else {
        this.p.setFromMatrixPosition(o.matrixWorld);
      }
      const dx = this.p.x - eye.x, dy = this.p.y - eye.y, dz = this.p.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.5 || dist > A.range) continue;
      const cos = (dx * fx + dy * fy + dz * fz) / dist;
      if (cos < 0.9) continue; // > ~25° off-axis: never relevant
      const angle = Math.acos(Math.min(1, cos));
      const zone = THREE.MathUtils.clamp(Math.atan(A.width / dist), A.minAngleDeg * DEG, A.maxAngleDeg * DEG);
      const ratio = angle / zone;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestDist = dist;
        this.best.copy(this.p);
      }
    }

    // One line-of-sight test per frame, for the best candidate only.
    const visible = bestRatio < A.snapZone && world.lineOfSight(eye, this.best);
    if (!visible) bestRatio = Infinity;

    // Slowdown: strongest dead-centre, fading out at the zone edge.
    this.slow = bestRatio < 1 ? THREE.MathUtils.lerp(A.slowdown, 1, bestRatio * bestRatio) : 1;

    // ADS snap on the frame aiming begins.
    if (this.prevAds <= 0 && ads > 0 && bestRatio < A.snapZone) {
      const dx = this.best.x - eye.x, dy = this.best.y - eye.y, dz = this.best.z - eye.z;
      const yawT = Math.atan2(-dx, -dz);
      const pitchT = Math.asin(THREE.MathUtils.clamp(dy / bestDist, -1, 1));
      let dYaw = yawT - player.yaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      let dPitch = pitchT - player.pitch;
      const mag = Math.hypot(dYaw, dPitch) * A.snapStrength;
      const cap = A.snapMaxDeg * DEG;
      const k = mag > cap ? (cap / mag) * A.snapStrength : A.snapStrength;
      dYaw *= k;
      dPitch *= k;
      this.snapYaw = dYaw;
      this.snapPitch = dPitch;
      this.snapT = A.snapTime;
    }
    this.prevAds = ads;

    if (this.snapT > 0) {
      const f = Math.min(1, dt / this.snapT);
      const y = this.snapYaw * f, p = this.snapPitch * f;
      player.yaw += y;
      player.pitch = THREE.MathUtils.clamp(player.pitch + p, -player.maxPitch, player.maxPitch);
      this.snapYaw -= y;
      this.snapPitch -= p;
      this.snapT -= dt;
    }
    return this.slow;
  }
}
