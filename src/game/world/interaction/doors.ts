import * as THREE from "three";
import type { CollisionWorld, DynamicHooks } from "../Collision";

/**
 * Interactive hinged doors.
 *
 * Maps declare doors as data (`MapDef.doors`): a hinge point, the closed
 * leaf direction, size and swing. Each door owns a few moving AABBs in the
 * collision world (the leaf split into short segments so a half-open leaf
 * stays tight), a visual leaf on a pivot, and an open/closed target it eases
 * toward. The player toggles the door under the crosshair; AI pushes closed
 * doors open when it walks into them; the nav grid keeps the open leaf's
 * footprint off paths (the doorway itself stays walkable). In co-op the
 * host owns door state and clients predict their own toggles.
 *
 * Visual leaf: a box placeholder from `defaultDoorLeaf`. The Blender kit
 * can swap in its own leaf with `setDoorLeafFactory` (before the map
 * loads) or `DoorSystem.setLeaf` (after a glTF streams in). A leaf is built
 * in pivot space: hinge at the origin, leaf along +X (0..w), up +Y (0..h),
 * thickness centred on Z.
 */

export type MapDoor = {
  /** Stable id for debugging / the kit (index order is what the net uses). */
  id?: string;
  /** Hinge axis position (world) and the floor height under it. */
  x: number;
  z: number;
  y?: number;
  /** Closed-leaf direction from the hinge, as a three.js yaw (local +X → (cos, −sin)). */
  yaw: number;
  w: number;
  h: number;
  /** Leaf thickness (default 0.05 m). */
  t?: number;
  /** Signed open angle (radians, + = counter-clockwise seen from above). */
  swing: number;
  /** Starts open. */
  open?: boolean;
  /** Never opens (barricaded). */
  locked?: boolean;
  /** AI may push it open (default true). */
  aiOpens?: boolean;
  /** Leaf tint for the placeholder (sRGB hex). */
  color?: number;
  /** Style hint passed to a kit leaf factory ("plank", "panel", "barn"...). */
  style?: string;
};

export type DoorLeafFactory = (door: Readonly<MapDoor>) => THREE.Object3D;

export const DOOR = {
  /** Seconds for a full swing. */
  swingTime: 0.55,
  /** Interact reach from the eye (m). */
  reach: 2.4,
  /** Without a ray hit: within this distance and facing the door still counts (touch). */
  nearReach: 1.4,
  /** AI pushes a closed door open from this far beyond the leaf half-width (m). */
  aiReach: 1.3,
  /** Co-op client: ignore host state for a door this long after toggling it ourselves (s). */
  predictHold: 1.2,
  defaultThickness: 0.05,
} as const;

let leafFactory: DoorLeafFactory | null = null;
/** Kit hook: build every door leaf from now on with `f` (null = placeholder box). */
export function setDoorLeafFactory(f: DoorLeafFactory | null) {
  leafFactory = f;
}

/** Placeholder leaf: a timber slab with a dark handle. */
export function defaultDoorLeaf(d: Readonly<MapDoor>): THREE.Object3D {
  const t = d.t ?? DOOR.defaultThickness;
  const g = new THREE.Group();
  g.name = "doorLeaf";
  const mat = new THREE.MeshStandardMaterial({ color: d.color ?? 0x6a4a30, roughness: 0.85 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(d.w - 0.025, d.h - 0.03, t), mat);
  slab.position.set(0.02 + (d.w - 0.025) / 2, (d.h - 0.03) / 2 + 0.02, 0);
  slab.castShadow = slab.receiveShadow = true;
  slab.userData.surface = "wood";
  g.add(slab);
  const hmat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.4, metalness: 0.8 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, t + 0.08), hmat);
  handle.position.set(d.w - 0.12, 1.02, 0);
  g.add(handle);
  return g;
}

/** Leaf segments per door (short pieces keep a half-open leaf's AABBs tight). */
export function segmentCount(w: number) {
  return Math.max(2, Math.ceil(w / 0.4));
}

/**
 * World AABBs of a leaf at `angle` (radians added to the closed yaw), written
 * into `out` (one per segment). Pure: shared by the door system and tests.
 */
export function leafBoxes(d: Readonly<MapDoor>, angle: number, out: THREE.Box3[]) {
  const n = out.length;
  const t = (d.t ?? DOOR.defaultThickness) / 2;
  const th = d.yaw + angle;
  const c = Math.cos(th), s = Math.sin(th);
  const y0 = (d.y ?? 0) + 0.02, y1 = (d.y ?? 0) + d.h;
  // Full length on the latch side: a pair of leaves meets without a sight gap.
  const u0 = 0.02, u1 = d.w;
  for (let i = 0; i < n; i++) {
    const a = u0 + ((u1 - u0) * i) / n, b = u0 + ((u1 - u0) * (i + 1)) / n;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const u of [a, b]) for (const v of [-t, t]) {
      // Rotation about +Y: local (u, v) → (u c + v s, −u s + v c).
      const x = d.x + u * c + v * s, z = d.z - u * s + v * c;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    out[i].min.set(x0, y0, z0);
    out[i].max.set(x1, y1, z1);
  }
  return out;
}

/** Door centre (world x, z) at `angle`. */
export function leafCentre(d: Readonly<MapDoor>, angle: number, out: { x: number; z: number }) {
  const th = d.yaw + angle;
  out.x = d.x + (d.w / 2) * Math.cos(th);
  out.z = d.z - (d.w / 2) * Math.sin(th);
  return out;
}

const ease = (x: number) => x * x * (3 - 2 * x);

type Door = {
  def: MapDoor;
  /** 0 closed … 1 open (eased into the angle). */
  amount: number;
  target: 0 | 1;
  handles: number[];
  boxes: THREE.Box3[];
  /** Footprint of the open leaf (nav blocker). */
  openBox: THREE.Box3;
  pivot: THREE.Group;
  leaf: THREE.Object3D;
  /** performance-free clock (s) until which host state is ignored (client prediction). */
  predictUntil: number;
};

/** What a door swing must not pass through: the local player. */
export type DoorBody = { feet: THREE.Vector3; radius: number; height: number };

export type DoorToggleSource = "local" | "ai" | "remote";

const _scratch = [new THREE.Box3()];
const _c = { x: 0, z: 0 };

export class DoorSystem implements DynamicHooks {
  private readonly doors: Door[] = [];
  readonly root = new THREE.Group();
  /** Bumped whenever a door's target changes (the net layer watches it). */
  version = 0;
  /** False on co-op clients: toggles are predicted and sent to the host as requests. */
  authority = true;
  /** Client → host toggle requests: [doorIndex, open 0/1]. */
  readonly requests: [number, number][] = [];
  /** Sound / feedback hook: a door started moving. */
  onSwing?: (index: number, open: boolean, at: THREE.Vector3) => void;
  private clock = 0;
  private readonly blockers: THREE.Box3[] = [];
  private readonly scratch: THREE.Box3[] = [];
  private readonly agents: number[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownGeometries: THREE.BufferGeometry[] = [];

  /**
   * `raycastList` receives the leaf meshes so bullets stop on doors; the
   * system keeps them in sync when a leaf is swapped.
   */
  constructor(
    private readonly world: CollisionWorld,
    parent: THREE.Object3D,
    defs: readonly MapDoor[],
    private readonly raycastList: THREE.Object3D[] | null = null,
  ) {
    this.root.name = "doors";
    parent.add(this.root);
    for (const def of defs) {
      const n = segmentCount(def.w);
      const boxes = Array.from({ length: n }, () => new THREE.Box3());
      const amount = def.open ? 1 : 0;
      leafBoxes(def, def.swing * ease(amount), boxes);
      const handles = boxes.map((b) => world.addDynamic(b));
      const openSegs = Array.from({ length: n }, () => new THREE.Box3());
      leafBoxes(def, def.swing, openSegs);
      const openBox = new THREE.Box3();
      for (const b of openSegs) openBox.union(b);
      this.blockers.push(openBox);
      const pivot = new THREE.Group();
      pivot.position.set(def.x, def.y ?? 0, def.z);
      pivot.rotation.y = def.yaw + def.swing * ease(amount);
      this.root.add(pivot);
      const door: Door = { def, amount, target: def.open ? 1 : 0, handles, boxes, openBox, pivot, leaf: new THREE.Group(), predictUntil: 0 };
      this.doors.push(door);
      this.attachLeaf(door, (leafFactory ?? defaultDoorLeaf)(def), !leafFactory);
    }
    while (this.scratch.length < 8) this.scratch.push(new THREE.Box3());
    this.root.updateMatrixWorld(true);
    world.dynamic = this;
  }

  get count() {
    return this.doors.length;
  }

  def(i: number): Readonly<MapDoor> {
    return this.doors[i].def;
  }

  isOpen(i: number) {
    return this.doors[i].target === 1;
  }

  /** 0 closed … 1 open (animation progress). */
  amount(i: number) {
    return this.doors[i].amount;
  }

  /** Replace door `i`'s visual leaf (pivot space, see the module comment). */
  setLeaf(i: number, leaf: THREE.Object3D) {
    this.attachLeaf(this.doors[i], leaf, false);
  }

  private attachLeaf(door: Door, leaf: THREE.Object3D, own: boolean) {
    const old = door.leaf;
    if (this.raycastList) {
      old.traverse((o) => {
        const k = this.raycastList!.indexOf(o);
        if (k >= 0) this.raycastList!.splice(k, 1);
      });
    }
    door.pivot.remove(old);
    door.leaf = leaf;
    door.pivot.add(leaf);
    leaf.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.surface === undefined) m.userData.surface = "wood";
      if (own) {
        this.ownGeometries.push(m.geometry);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) if (!this.ownMaterials.includes(mt)) this.ownMaterials.push(mt);
      }
      this.raycastList?.push(m);
    });
    door.pivot.updateMatrixWorld(true);
  }

  /**
   * Door the player is aiming at (eye ray within reach, not behind a wall),
   * or one right in front of them; -1 for none.
   */
  focus(eye: THREE.Vector3, dir: THREE.Vector3): number {
    let best = -1;
    let bestT: number = DOOR.reach;
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.def.locked) continue;
      for (const b of d.boxes) {
        const t = slab(b, eye, dir, bestT);
        if (t < bestT) {
          bestT = t;
          best = i;
        }
      }
    }
    if (best >= 0) {
      // A wall between the eye and the leaf hides it (the world ray also sees the leaf itself).
      const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, bestT + 0.05);
      if (hit < bestT - 0.05) best = -1;
      return best;
    }
    // Near fallback (touch players don't aim at a leaf precisely).
    let bestD: number = DOOR.nearReach;
    const hx = Math.hypot(dir.x, dir.z) || 1;
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.def.locked || Math.abs(eye.y - (d.def.y ?? 0) - 1.2) > 1.4) continue;
      leafCentre(d.def, d.def.swing * ease(d.amount), _c);
      const dx = _c.x - eye.x, dz = _c.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestD || dist < 1e-3) continue;
      if ((dx * dir.x + dz * dir.z) / (dist * hx) < 0.55) continue;
      // Something solid before the leaf (the ray stops on the leaf itself at ~dist).
      if (this.world.raycast(eye.x, eye.y, eye.z, dx / dist, 0, dz / dist, dist) < dist - 0.3) continue;
      bestD = dist;
      best = i;
    }
    return best;
  }

  /** Flip door `i` (local player / AI on the host; prediction + request on clients). */
  toggle(i: number, by: DoorToggleSource = "local") {
    const d = this.doors[i];
    if (!d || d.def.locked) return;
    this.set(i, d.target === 0, by);
  }

  set(i: number, open: boolean, by: DoorToggleSource = "local") {
    const d = this.doors[i];
    if (!d || d.def.locked) return;
    const target = open ? 1 : 0;
    if (d.target === target) return;
    if (!this.authority && by === "local") {
      this.requests.push([i, target]);
      d.predictUntil = this.clock + DOOR.predictHold;
    }
    d.target = target;
    this.version++;
    if (this.onSwing) {
      leafCentre(d.def, d.def.swing * ease(d.amount), _c);
      this.onSwing(i, open, this.tmpV.set(_c.x, (d.def.y ?? 0) + 1.1, _c.z));
    }
  }

  /** Targets of every door (0/1), for the host's state broadcast. */
  states(out: number[] = []) {
    out.length = 0;
    for (const d of this.doors) out.push(d.target);
    return out;
  }

  /** Host state on a client (doors we just toggled keep our prediction for a moment). */
  applyStates(states: readonly unknown[]) {
    const n = Math.min(states.length, this.doors.length);
    for (let i = 0; i < n; i++) {
      const d = this.doors[i];
      if (this.clock < d.predictUntil) continue;
      const v = states[i] === 1 ? 1 : 0;
      if (d.target !== v) this.set(i, v === 1, "remote");
    }
  }

  /** Drains client toggle requests (net layer). */
  drainRequests() {
    return this.requests.splice(0);
  }

  // ---- DynamicHooks --------------------------------------------------------------

  agentNear(x: number, z: number, vx: number, vz: number) {
    if (this.agents.length < 128) this.agents.push(x, z);
    if (!this.authority) return;
    const sp = Math.hypot(vx, vz);
    if (sp < 0.3) return;
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.target === 1 || d.def.locked || d.def.aiOpens === false) continue;
      leafCentre(d.def, 0, _c);
      const dx = _c.x - x, dz = _c.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > d.def.w / 2 + DOOR.aiReach) continue;
      // Walking toward it (not just passing by along the wall).
      if ((dx * vx + dz * vz) / (Math.max(1e-3, dist) * sp) < 0.35 && dist > d.def.w / 2 + 0.2) continue;
      this.set(i, true, "ai");
    }
  }

  navBlockers() {
    return this.blockers;
  }

  // ---- Simulation ----------------------------------------------------------------

  /**
   * Eases every door toward its target. A swing that would pass through the
   * player holds until they step clear (so a door never shoves you through
   * a wall or traps you inside the leaf).
   */
  update(dt: number, body: DoorBody | null) {
    this.clock += dt;
    const step = dt / DOOR.swingTime;
    for (const d of this.doors) {
      if (d.amount === d.target) continue;
      const next = d.target > d.amount ? Math.min(1, d.amount + step) : Math.max(0, d.amount - step);
      const boxes = this.segScratch(d.boxes.length);
      leafBoxes(d.def, d.def.swing * ease(next), boxes);
      if (body && hitsBody(boxes, body)) continue;
      d.amount = next;
      for (let k = 0; k < boxes.length; k++) d.boxes[k].copy(boxes[k]);
      d.pivot.rotation.y = d.def.yaw + d.def.swing * ease(next);
      d.pivot.updateMatrixWorld(true);
    }
    this.agents.length = 0;
  }

  private segScratch(n: number) {
    while (this.scratch.length < n) this.scratch.push(new THREE.Box3());
    _scratch.length = 0;
    for (let i = 0; i < n; i++) _scratch.push(this.scratch[i]);
    return _scratch;
  }

  /** Recent AI body positions (x, z pairs) reported this frame (debug / tests). */
  get agentSamples(): readonly number[] {
    return this.agents;
  }

  dispose() {
    if (this.world.dynamic === this) this.world.dynamic = null;
    for (const d of this.doors) for (const h of d.handles) this.world.setDynamicEnabled(h, false);
    if (this.raycastList) {
      for (const d of this.doors) d.leaf.traverse((o) => {
        const k = this.raycastList!.indexOf(o);
        if (k >= 0) this.raycastList!.splice(k, 1);
      });
    }
    this.root.removeFromParent();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
  }
}

function hitsBody(boxes: readonly THREE.Box3[], b: DoorBody) {
  const f = b.feet, r = b.radius;
  for (const x of boxes) {
    if (f.x - r < x.max.x && f.x + r > x.min.x && f.z - r < x.max.z && f.z + r > x.min.z && f.y < x.max.y && f.y + b.height > x.min.y) return true;
  }
  return false;
}

/** Ray (origin o, unit dir) vs box: entry distance or Infinity beyond `max`. */
function slab(b: THREE.Box3, o: THREE.Vector3, d: THREE.Vector3, max: number) {
  const ix = 1 / (d.x || 1e-12), iy = 1 / (d.y || 1e-12), iz = 1 / (d.z || 1e-12);
  let t1 = (b.min.x - o.x) * ix, t2 = (b.max.x - o.x) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (b.min.y - o.y) * iy; t2 = (b.max.y - o.y) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (b.min.z - o.z) * iz; t2 = (b.max.z - o.z) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0) || tmin > max) return Infinity;
  return Math.max(tmin, 0);
}
