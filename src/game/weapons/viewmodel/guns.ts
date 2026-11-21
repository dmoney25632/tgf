import type { ViewModelKind } from "../weapons";
import type { Kit } from "./parts";
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
};
