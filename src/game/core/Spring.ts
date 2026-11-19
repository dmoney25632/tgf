/**
 * Damped spring (semi-implicit Euler). Used for viewmodel kick so recoil
 * feels weighty: a sharp impulse that overshoots slightly and settles.
 */
export class Spring {
  value = 0;
  velocity = 0;

  /** stiffness ~ how fast it returns; damping ~ how much it wobbles. */
  constructor(public stiffness = 220, public damping = 18) {}

  impulse(v: number) {
    this.velocity += v;
  }

  update(dt: number) {
    const a = -this.stiffness * this.value - this.damping * this.velocity;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  reset() {
    this.value = this.velocity = 0;
  }
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number) {
  return 1 - Math.exp(-rate * dt);
}
