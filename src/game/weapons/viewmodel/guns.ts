import type { ViewModelKind } from "../weapons";
import { type Kit, suppressor } from "./parts";
import type { GunSpec } from "./common";
import { buildAR } from "./ar15";
import { buildAkm, buildAug, buildG36, buildScar } from "./rifles";
import { buildMp5, buildP90, buildUzi } from "./smgs";
import { buildM249, buildPkm } from "./heavy";
import { buildM1014, buildR870 } from "./shotguns";
import { buildM24, buildM82, buildSvd } from "./snipers";
import { buildPistol, buildSw629 } from "./pistols";
import { buildKnifeSpec } from "./melee";

export type { GunSpec, FlashStyle, ReloadStyle, ShellKind } from "./common";
export { buildGrenade, buildKnife, type GrenadeModel } from "./melee";

/**
 * Wraps a builder with a screw-on suppressor at its muzzle: the can is drawn
 * on the gun root, the muzzle (flash, tracers) moves to its front cap and the
 * flash shrinks to a faint pistol-style puff.
 */
function suppressed(kind: ViewModelKind, build: (k: Kit) => GunSpec, r: number, len: number): (k: Kit) => GunSpec {
  return (k) => {
    const g = build(k);
    k.b.into(g.root);
    const mz = g.muzzle.position;
    suppressor(k, mz.z + 0.004, mz.y, r, len);
    mz.z -= len - 0.004;
    g.flash = "pistol";
    g.flashScale *= 0.35;
    (g as { kind: ViewModelKind }).kind = kind;
    return g;
  };
}

/** First-person model builders, one per WeaponDef.model. Built lazily by the viewmodel. */
export const GUN_BUILDERS: Record<ViewModelKind, (k: Kit) => GunSpec> = {
  m4a1: (k) => buildAR(k, "m4a1"),
  m16a4: (k) => buildAR(k, "m16a4"),
  hk416: (k) => buildAR(k, "hk416"),
  akm: buildAkm,
  scarl: buildScar,
  g36: buildG36,
  aug: buildAug,
  mp5: buildMp5,
  uzi: buildUzi,
  p90: buildP90,
  m249: buildM249,
  pkm: buildPkm,
  r870: buildR870,
  m1014: buildM1014,
  svd: buildSvd,
  m24: buildM24,
  m82: buildM82,
  m9: (k) => buildPistol(k, "m9"),
  g17: (k) => buildPistol(k, "g17"),
  m1911: (k) => buildPistol(k, "m1911"),
  sw629: buildSw629,
  knife: buildKnifeSpec,
  mp5sd: suppressed("mp5sd", buildMp5, 0.021, 0.2),
  mk23: suppressed("mk23", (k) => buildPistol(k, "m1911"), 0.016, 0.15),
};
