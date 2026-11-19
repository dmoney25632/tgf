import type { Dressing } from "./common";
import { dustfall } from "./dustfall";
import { kestrel } from "./kestrel";
import { cinderFlats } from "./cinderFlats";

export type { Dressing, DressingKit, DressingPlan } from "./common";

/** Map set-dressings by MapDef.dressing id. */
export const DRESSINGS: Record<string, Dressing> = {
  dustfall,
  kestrel,
  cinderFlats,
};

/** Flat gravel ground, no foliage — for maps without a dressing. */
export const defaultDressing: Dressing = () => ({
  terrain: {
    height: () => 0,
    splat: (_x, _z, o) => {
      o.gravel = 1;
      o.ground = 0;
      o.mud = 0;
    },
    inner: 60,
    outer: 400,
  },
  foliage: { grass: () => 0, grassBounds: 0, trees: [], bushes: [] },
});
