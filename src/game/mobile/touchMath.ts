/**
 * Pure touch-control logic (no DOM): the floating move stick, finger→role
 * routing, look scaling, orientation and platform detection. Unit-tested in
 * tests/touchControls.test.ts.
 */

// ---------------------------------------------------------------------------
// Floating joystick
// ---------------------------------------------------------------------------

export type StickConfig = {
  /** Knob travel (CSS px) for full deflection. */
  radius: number;
  /** Inner deadzone as a fraction of the radius. */
  deadzone: number;
  /** Pushing past this fraction of the radius (roughly forward) sprints. */
  sprintAt: number;
  /** Dragging further than this × radius pulls the base along behind the thumb. */
  follow: number;
};

export const DEFAULT_STICK: StickConfig = { radius: 56, deadzone: 0.12, sprintAt: 1.05, follow: 1.6 };

/**
 * Floating stick: the base appears where the thumb lands; output is a move
 * vector (x = right, y = forward, −1..1) with a radial deadzone. Pushing to
 * the rim (and slightly beyond) while heading forward requests a sprint.
 */
export class FloatingStick {
  id = -1;
  /** Base (where the thumb landed) and knob position, CSS px. */
  ox = 0;
  oy = 0;
  kx = 0;
  ky = 0;
  /** Move output: x = strafe right, y = forward. */
  x = 0;
  y = 0;
  /** 0..1 deflection after the deadzone. */
  magnitude = 0;
  sprint = false;

  constructor(public cfg: StickConfig = DEFAULT_STICK) {}

  get active() {
    return this.id >= 0;
  }

  start(id: number, px: number, py: number) {
    this.id = id;
    this.ox = this.kx = px;
    this.oy = this.ky = py;
    this.x = this.y = this.magnitude = 0;
    this.sprint = false;
  }

  move(px: number, py: number) {
    const c = this.cfg;
    let dx = px - this.ox;
    let dy = py - this.oy;
    let d = Math.hypot(dx, dy);
    // Thumb wandered far off the base: drag the base so it stays under the thumb.
    const far = c.radius * c.follow;
    if (d > far) {
      const k = (d - far) / d;
      this.ox += dx * k;
      this.oy += dy * k;
      dx = px - this.ox;
      dy = py - this.oy;
      d = far;
    }
    const raw = d / c.radius; // may exceed 1 (overshoot = sprint intent)
    const clamped = Math.min(1, raw);
    this.kx = this.ox + (d > 0 ? (dx / d) * clamped * c.radius : 0);
    this.ky = this.oy + (d > 0 ? (dy / d) * clamped * c.radius : 0);
    if (raw <= c.deadzone || d === 0) {
      this.x = this.y = this.magnitude = 0;
      this.sprint = false;
      return;
    }
    const n = Math.min(1, (raw - c.deadzone) / (1 - c.deadzone));
    this.x = (dx / d) * n;
    this.y = (-dy / d) * n; // screen up = forward
    this.magnitude = n;
    this.sprint = isSprintPush(raw, this.x, this.y, c.sprintAt);
  }

  end() {
    this.id = -1;
    this.x = this.y = this.magnitude = 0;
    this.sprint = false;
  }
}

/** Sprint = pushed to/over the rim and heading mostly forward (within ~40°). */
export function isSprintPush(raw: number, x: number, y: number, sprintAt: number) {
  return raw >= sprintAt && y > 0 && y >= Math.abs(x) * 1.2;
}

// ---------------------------------------------------------------------------
// Finger routing
// ---------------------------------------------------------------------------

export type TouchRole = { kind: "stick" } | { kind: "look" } | { kind: "button"; id: string; look: boolean };

/** Which half of the screen a free touch (not on a button) belongs to. */
export function zoneFor(x: number, width: number, leftHanded: boolean): "stick" | "look" {
  const left = x < width * 0.5;
  return left !== leftHanded ? "stick" : "look";
}

/**
 * Tracks what each finger (pointerId) is doing. Multi-touch safe: every
 * finger keeps its role until it lifts; only one finger drives the stick (a
 * second one in the stick half becomes a look finger) and look deltas come
 * from the most recent look finger only, so two thumbs never fight.
 */
export class TouchTracker {
  private readonly roles = new Map<number, TouchRole>();
  private readonly last = new Map<number, { x: number; y: number }>();
  private lookOwner = -1;

  get size() {
    return this.roles.size;
  }

  roleOf(id: number) {
    return this.roles.get(id);
  }

  hasStick() {
    for (const r of this.roles.values()) if (r.kind === "stick") return true;
    return false;
  }

  /** A finger on a button whose id matches (e.g. is FIRE held by anyone?). */
  holding(buttonId: string) {
    for (const r of this.roles.values()) if (r.kind === "button" && r.id === buttonId) return true;
    return false;
  }

  /**
   * Assign a new finger. `button` = the on-screen button under it (if any),
   * `lookButton` = whether dragging that button also aims (fire buttons).
   */
  down(id: number, x: number, y: number, zone: "stick" | "look", button?: string, lookButton = false): TouchRole {
    let role: TouchRole;
    if (button) role = { kind: "button", id: button, look: lookButton };
    else if (zone === "stick" && !this.hasStick()) role = { kind: "stick" };
    else role = { kind: "look" };
    this.roles.set(id, role);
    this.last.set(id, { x, y });
    if (role.kind === "look" || (role.kind === "button" && role.look)) this.lookOwner = id;
    return role;
  }

  /** Movement of a finger; returns the look delta it contributes (0,0 if none). */
  move(id: number, x: number, y: number, out: { x: number; y: number }) {
    out.x = out.y = 0;
    const role = this.roles.get(id);
    const prev = this.last.get(id);
    if (!role || !prev) return out;
    const looks = role.kind === "look" || (role.kind === "button" && role.look);
    if (looks) {
      if (this.lookOwner < 0 || !this.roles.has(this.lookOwner)) this.lookOwner = id;
      if (this.lookOwner === id) {
        out.x = x - prev.x;
        out.y = y - prev.y;
      }
    }
    prev.x = x;
    prev.y = y;
    return out;
  }

  up(id: number): TouchRole | undefined {
    const role = this.roles.get(id);
    this.roles.delete(id);
    this.last.delete(id);
    if (this.lookOwner === id) {
      this.lookOwner = -1;
      // Hand look to another finger that can aim, if one is still down.
      for (const [other, r] of this.roles) if (r.kind === "look" || (r.kind === "button" && r.look)) this.lookOwner = other;
    }
    return role;
  }

  clear() {
    this.roles.clear();
    this.last.clear();
    this.lookOwner = -1;
  }
}

// ---------------------------------------------------------------------------
// Look scaling
// ---------------------------------------------------------------------------

/** Touch look speed at sensitivity 1: radians per CSS px of finger travel (~180° per 500 px). */
export const TOUCH_RAD_PER_PX = 0.0063;

/**
 * Convert a finger delta (CSS px) into the mouse-delta units the engine
 * consumes, so touch keeps its own sensitivity (and ADS scale) no matter what
 * the mouse is set to. `mouseRadPerUnit` is what the engine applies per mouse
 * unit right now (base × sensitivity × its ADS factor).
 */
export function touchToMouseUnits(px: number, touchSens: number, touchAdsSens: number, ads: number, mouseRadPerUnit: number) {
  if (mouseRadPerUnit <= 0) return 0;
  const a = Math.max(0, Math.min(1, ads));
  const rad = px * TOUCH_RAD_PER_PX * touchSens * (1 + (touchAdsSens - 1) * a);
  return rad / mouseRadPerUnit;
}

// ---------------------------------------------------------------------------
// Orientation / platform
// ---------------------------------------------------------------------------

export type Orientation = "portrait" | "landscape";

export function orientationOf(width: number, height: number): Orientation {
  return height > width ? "portrait" : "landscape";
}

/** The "rotate your phone" overlay: touch devices held upright, small enough to be a phone. */
export function needsRotate(touch: boolean, width: number, height: number) {
  return touch && orientationOf(width, height) === "portrait" && Math.min(width, height) < 600;
}

export type Platform = { ios: boolean; android: boolean; touch: boolean };

/** UA-based platform sniffing (iPadOS reports a Mac UA with touch points). */
export function platformFrom(ua: string, maxTouchPoints: number, coarse: boolean): Platform {
  const ipadOs = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || ipadOs;
  const android = /Android/.test(ua);
  const touch = ios || android || (coarse && maxTouchPoints > 0);
  return { ios, android, touch };
}
