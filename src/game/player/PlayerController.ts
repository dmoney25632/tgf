import * as THREE from "three";
import { CAMERA, HEAD_BOB, LOOK, MOVEMENT, SLIDE } from "../config";
import type { CollisionWorld } from "../world/Collision";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** Per-frame movement intent, built from input by the engine. */
export type MoveIntent = {
  /** -1..1, +1 = forward. */
  forward: number;
  /** -1..1, +1 = right. */
  strafe: number;
  sprint: boolean;
  /** Crouch currently wanted (toggle state OR hold key). */
  crouch: boolean;
  /** Crouch key went down this frame (used to trigger slides). */
  crouchPressed: boolean;
  jumpPressed: boolean;
  /** 0..1 aim-down-sights amount from the weapon system. */
  ads: number;
  /** Firing cancels sprint. */
  blockSprint: boolean;
};

/** Events the audio/HUD layers react to. Read and cleared by the engine. */
export type MoveEvents = { jumped: boolean; landed: number; footstep: number; slideStarted: boolean };

export type CameraOffsets = {
  /** Weapon recoil added to aim (radians). */
  recoilPitch: number;
  recoilYaw: number;
  /** Visual-only shake (radians / meters). */
  shakePitch: number;
  shakeYaw: number;
  shakeRoll: number;
  shakeX: number;
  shakeY: number;
};

/**
 * First-person movement on a fixed timestep:
 * snappy ground accel/braking, momentum-preserving air control, coyote time,
 * jump buffering, sprint, crouch, slide, auto step-up and AABB collision.
 * Rendering interpolates between physics steps for smooth camera motion.
 */
export class PlayerController {
  /** Feet position (physics). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  crouching = false;
  sliding = false;
  sprinting = false;
  /** Horizontal speed, for spread / bob / HUD. */
  speed = 0;
  /** 0..1 smoothed sprint amount (viewmodel pose, FOV). */
  sprintBlend = 0;
  slideBlend = 0;
  readonly events: MoveEvents = { jumped: false, landed: 0, footstep: 0, slideStarted: false };
  /** Operator / weapon / perk speed multiplier. */
  speedMultiplier = 1;
  /** Downed: crawl only, camera near the floor. */
  downed = false;

  private readonly prevPosition = new THREE.Vector3();
  private height: number = MOVEMENT.standHeight;
  private eyeHeight: number = MOVEMENT.standHeight - MOVEMENT.eyeOffset;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpedSinceGrounded = false;
  private slideTimer = 0;
  private slideCooldown = 0;
  private readonly slideDir = new THREE.Vector3();
  private stepOffset = 0;
  private landKick = 0;
  /** Distance walked on the ground (drives bob + viewmodel bob). */
  bobDistance = 0;
  /** 0..~1.6 bob strength this frame. */
  bobAmount = 0;
  private lastStepIndex = 0;
  private fovBoost = 0;
  private roll = 0;

  // Scratch objects (no allocations in the loop).
  private readonly wish = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly stepTry = new THREE.Vector3();
  private readonly renderPos = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly world: CollisionWorld,
  ) {
    camera.rotation.order = "YXZ";
  }

  get maxPitch() {
    return Math.PI / 2 - LOOK.poleMargin;
  }

  /** Extra FOV from sprint/slide, smoothed. */
  get fovOffset() {
    return this.fovBoost;
  }

  get eyePosition() {
    return this.renderPos;
  }

  /** Current collider height (AI aims at the chest from this). */
  get colliderHeight() {
    return this.height;
  }

  spawn(pos: THREE.Vector3, yaw: number) {
    this.position.copy(pos);
    this.prevPosition.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouching = this.sliding = this.sprinting = false;
    this.downed = false;
    this.height = MOVEMENT.standHeight;
    this.eyeHeight = MOVEMENT.standHeight - MOVEMENT.eyeOffset;
    this.stepOffset = this.landKick = 0;
  }

  /** Mouse look, applied every rendered frame for minimum latency. */
  look(dx: number, dy: number, radiansPerPixel: number) {
    this.yaw -= dx * radiansPerPixel;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * radiansPerPixel, -this.maxPitch, this.maxPitch);
  }

  /** Inputs that must not be lost between fixed steps. */
  frameInput(dt: number, intent: MoveIntent) {
    if (intent.jumpPressed) this.jumpBuffer = MOVEMENT.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // Slide: crouch pressed while sprinting fast on the ground.
    if (
      intent.crouchPressed && this.grounded && !this.sliding && this.slideCooldown <= 0 &&
      (this.sprinting || this.speed > SLIDE.minStartSpeed) && this.speed > SLIDE.minStartSpeed * 0.8
    ) {
      this.startSlide();
    }
  }

  /** One physics step of length h seconds. */
  fixedStep(h: number, intent: MoveIntent) {
    this.prevPosition.copy(this.position);
    this.slideCooldown = Math.max(0, this.slideCooldown - h);

    // ---- Stance -----------------------------------------------------------
    const headroomToStand = !this.world.overlaps(this.position, MOVEMENT.radius, MOVEMENT.standHeight);
    if (this.sliding) {
      this.slideTimer -= h;
      const slideSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.slideTimer <= 0 || slideSpeed < SLIDE.endSpeed || !this.grounded) this.endSlide();
    }
    if (this.downed && this.sliding) this.endSlide();
    // Analog sticks: sprint needs a mostly-forward push (keyboard forward is 1).
    const sprintRequested = intent.sprint && intent.forward > 0.3 && intent.ads < 0.3 && !intent.blockSprint && !this.downed;
    if (!this.sliding) {
      if (intent.crouch) this.crouching = true;
      else if (this.crouching && headroomToStand) this.crouching = false;
      // Sprinting out of a crouch stands you up (if there's room).
      if (sprintRequested && this.crouching && headroomToStand && !intent.crouch) this.crouching = false;
    }
    this.sprinting = sprintRequested && !this.crouching && !this.sliding && this.grounded;

    // ---- Wish direction ---------------------------------------------------
    // Keyboard diagonals normalise to 1; a partly-deflected stick keeps its
    // magnitude so it walks proportionally slower (analog movement).
    this.wish.set(intent.strafe, 0, -intent.forward);
    const wishLenSq = this.wish.lengthSq();
    const hasInput = wishLenSq > 1e-4;
    if (hasInput) {
      if (wishLenSq > 1) this.wish.normalize();
      this.wish.applyAxisAngle(UP, this.yaw);
    }

    let targetSpeed: number = this.downed ? 1.1 : this.crouching ? MOVEMENT.crouchSpeed : this.sprinting ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;
    targetSpeed *= THREE.MathUtils.lerp(1, MOVEMENT.adsSpeedMultiplier, intent.ads) * this.speedMultiplier;

    // ---- Jump (buffered + coyote) — before ground friction so a jump keeps all momentum
    if (this.grounded) {
      this.coyote = MOVEMENT.coyoteTime;
      this.jumpedSinceGrounded = false;
    } else {
      this.coyote = Math.max(0, this.coyote - h);
    }
    if (this.downed) this.jumpBuffer = 0;
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.jumpedSinceGrounded) {
      if (this.crouching && !this.sliding) {
        // Jump while crouched = stand up first.
        if (headroomToStand) this.crouching = false;
        this.jumpBuffer = 0;
      } else {
        if (this.sliding) this.endSlide(); // slide-jump keeps the momentum
        this.velocity.y = MOVEMENT.jumpVelocity;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpedSinceGrounded = true;
        this.events.jumped = true;
      }
    }

    // ---- Horizontal velocity ---------------------------------------------
    if (this.sliding) {
      // Low friction along the slide, slight steering.
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      const newSp = Math.max(0, sp - SLIDE.friction * h);
      if (sp > 0) {
        this.velocity.x *= newSp / sp;
        this.velocity.z *= newSp / sp;
      }
      if (hasInput) {
        const steer = MOVEMENT.groundAccel * SLIDE.steer * h;
        this.velocity.x += this.wish.x * steer;
        this.velocity.z += this.wish.z * steer;
        const sp2 = Math.hypot(this.velocity.x, this.velocity.z);
        if (sp2 > newSp && sp2 > 0) {
          this.velocity.x *= newSp / sp2;
          this.velocity.z *= newSp / sp2;
        }
      }
    } else if (this.grounded) {
      // Accelerate straight toward the target velocity: crisp starts and stops.
      const tx = this.wish.x * targetSpeed;
      const tz = this.wish.z * targetSpeed;
      const dx = tx - this.velocity.x;
      const dz = tz - this.velocity.z;
      const dLen = Math.hypot(dx, dz);
      const rate = hasInput ? MOVEMENT.groundAccel : MOVEMENT.groundDecel;
      const maxDelta = rate * h;
      if (dLen <= maxDelta) {
        this.velocity.x = tx;
        this.velocity.z = tz;
      } else {
        this.velocity.x += (dx / dLen) * maxDelta;
        this.velocity.z += (dz / dLen) * maxDelta;
      }
    } else if (hasInput) {
      // Air: only add speed along the wish direction up to airMaxSpeed, so
      // jump momentum is preserved but you can still adjust a little.
      const current = this.velocity.x * this.wish.x + this.velocity.z * this.wish.z;
      const add = MOVEMENT.airMaxSpeed - current;
      if (add > 0) {
        const accel = Math.min(add, MOVEMENT.airAccel * h);
        this.velocity.x += this.wish.x * accel;
        this.velocity.z += this.wish.z * accel;
      }
    }

    // ---- Gravity ----------------------------------------------------------
    const g = this.velocity.y < 0 ? MOVEMENT.gravity * MOVEMENT.fallGravityMultiplier : MOVEMENT.gravity;
    this.velocity.y -= g * h;

    // ---- Collider height --------------------------------------------------
    this.height = this.downed ? 0.7 : this.sliding ? MOVEMENT.slideHeight : this.crouching ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;

    // ---- Integrate + collide ---------------------------------------------
    const wasGrounded = this.grounded;
    const fallSpeed = this.velocity.y;
    this.start.copy(this.position);
    const dx = this.velocity.x * h;
    const dz = this.velocity.z * h;
    const hitX = this.world.moveAxis(this.position, "x", dx, MOVEMENT.radius, this.height);
    const hitZ = this.world.moveAxis(this.position, "z", dz, MOVEMENT.radius, this.height);

    // Step-up: if blocked horizontally while on the ground, try the same move
    // from stepHeight higher and settle down onto the ledge.
    if ((hitX || hitZ) && wasGrounded) this.tryStepUp(dx, dz, hitX, hitZ);
    else {
      if (hitX) this.velocity.x = 0;
      if (hitZ) this.velocity.z = 0;
    }

    this.grounded = false;
    if (this.world.moveAxis(this.position, "y", this.velocity.y * h, MOVEMENT.radius, this.height)) {
      if (this.velocity.y < 0) this.grounded = true;
      this.velocity.y = 0;
    } else if (wasGrounded && this.velocity.y <= 0) {
      // Snap down small drops (stairs) so we don't "bounce" off each step.
      this.stepTry.copy(this.position);
      if (this.world.moveAxis(this.stepTry, "y", -MOVEMENT.stepHeight, MOVEMENT.radius, this.height)) {
        const drop = this.position.y - this.stepTry.y;
        this.position.y = this.stepTry.y;
        this.prevPosition.y -= drop;
        this.stepOffset += drop;
        this.grounded = true;
        this.velocity.y = 0;
      }
    }

    if (!wasGrounded && this.grounded) {
      this.events.landed = Math.max(this.events.landed, -fallSpeed);
      if (fallSpeed < -4) this.landKick = Math.min(HEAD_BOB.landKickMax, -fallSpeed * HEAD_BOB.landKickPerSpeed);
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  private tryStepUp(dx: number, dz: number, hitX: boolean, hitZ: boolean) {
    const r = MOVEMENT.radius;
    const s = this.stepTry.copy(this.start);
    // Up (abort if a ceiling is in the way), across, then back down.
    const ceiling = this.world.moveAxis(s, "y", MOVEMENT.stepHeight, r, this.height);
    if (!ceiling) {
      this.world.moveAxis(s, "x", dx, r, this.height);
      this.world.moveAxis(s, "z", dz, r, this.height);
      const landed = this.world.moveAxis(s, "y", -MOVEMENT.stepHeight - 0.01, r, this.height);
      const stepDist = Math.hypot(s.x - this.start.x, s.z - this.start.z);
      const flatDist = Math.hypot(this.position.x - this.start.x, this.position.z - this.start.z);
      const rise = s.y - this.start.y;
      if (landed && stepDist > flatDist + 1e-4 && rise > 0.01 && rise <= MOVEMENT.stepHeight + 0.01) {
        this.position.copy(s);
        this.prevPosition.y += rise;
        this.stepOffset -= rise; // camera starts low and eases up
        return;
      }
    }
    // Genuine wall: kill velocity into it.
    if (hitX) this.velocity.x = 0;
    if (hitZ) this.velocity.z = 0;
  }

  private startSlide() {
    this.sliding = true;
    this.crouching = true;
    this.slideTimer = SLIDE.duration;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this.slideDir.set(this.velocity.x / sp, 0, this.velocity.z / sp);
    const boost = Math.max(sp, SLIDE.boostSpeed);
    this.velocity.x = this.slideDir.x * boost;
    this.velocity.z = this.slideDir.z * boost;
    this.events.slideStarted = true;
  }

  private endSlide() {
    this.sliding = false;
    this.slideCooldown = SLIDE.cooldown;
    // Stay crouched after a slide; standing happens via sprint/jump/crouch key.
  }

  /**
   * Places the camera for rendering. alpha = interpolation factor between the
   * last two physics steps.
   */
  updateCamera(dt: number, alpha: number, ads: number, o: CameraOffsets) {
    const k = (rate: number) => Math.min(1, rate * dt);

    // Smoothed state used by visuals.
    this.sprintBlend += ((this.sprinting ? 1 : 0) - this.sprintBlend) * k(10);
    this.slideBlend += ((this.sliding ? 1 : 0) - this.slideBlend) * k(12);
    const targetFov = CAMERA.sprintFovBoost * this.sprintBlend * Math.min(1, this.speed / MOVEMENT.sprintSpeed) + CAMERA.slideFovBoost * this.slideBlend;
    this.fovBoost += (targetFov - this.fovBoost) * k(CAMERA.fovLerp);

    const targetEye = this.height - MOVEMENT.eyeOffset;
    this.eyeHeight += (targetEye - this.eyeHeight) * k(MOVEMENT.crouchLerp);
    this.stepOffset -= this.stepOffset * k(MOVEMENT.stepSmoothing);
    this.landKick -= this.landKick * k(9);

    // Head bob: distance-driven so it matches footfalls at any speed.
    const bobScale = (this.grounded && !this.sliding ? Math.min(this.speed / MOVEMENT.walkSpeed, 1.6) : 0) *
      THREE.MathUtils.lerp(1, HEAD_BOB.adsMultiplier, ads) *
      (this.sprinting ? HEAD_BOB.sprintMultiplier : 1);
    this.bobAmount = bobScale;
    if (this.grounded && !this.sliding) this.bobDistance += this.speed * dt;
    const phase = this.bobDistance * HEAD_BOB.frequency * Math.PI * 2;
    const bobY = -Math.abs(Math.sin(phase)) * HEAD_BOB.vertical * bobScale;
    const bobX = Math.cos(phase) * HEAD_BOB.lateral * bobScale;

    // Footstep event at each bob trough (two per cycle).
    const stepIndex = Math.floor(phase / Math.PI);
    if (stepIndex !== this.lastStepIndex) {
      this.lastStepIndex = stepIndex;
      if (this.grounded && !this.sliding && this.speed > 1.5) this.events.footstep = this.speed;
    }

    // Slide roll.
    const targetRoll = this.slideBlend * SLIDE.tilt * DEG + (this.downed ? 0.18 : 0);
    this.roll += (targetRoll - this.roll) * k(10);

    this.renderPos.lerpVectors(this.prevPosition, this.position, alpha);
    this.renderPos.y += this.eyeHeight + this.stepOffset - this.landKick + bobY + o.shakeY;

    const cam = this.camera;
    cam.rotation.set(
      THREE.MathUtils.clamp(this.pitch + o.recoilPitch, -this.maxPitch, this.maxPitch) + o.shakePitch,
      this.yaw + o.recoilYaw + o.shakeYaw,
      this.roll + o.shakeRoll,
    );
    cam.position.copy(this.renderPos);
    cam.translateX(bobX + o.shakeX);
  }

}
