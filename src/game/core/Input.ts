/**
 * InputManager: keyboard + mouse state for the game loop.
 *
 * - isDown()/pressed() use KeyboardEvent.code ("KeyW") or "Mouse0"/"Mouse2".
 * - endFrame() clears edge-triggered state; call once per rendered frame.
 * - The click that acquires pointer lock never fires a shot, and a per-frame
 *   watchdog drops stuck buttons after alt-tab / lost mouseup.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  /** Mouse buttons are ignored until this time (ms) after acquiring lock. */
  private ignoreMouseUntil = 0;
  /** Last known physical button bitmask from MouseEvent.buttons. */
  private buttons = 0;
  locked = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    window.addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.releaseAll);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    target.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  /** True only on the frame the key/button went down. */
  pressed(code: string) {
    return this.pressedThisFrame.has(code);
  }

  consumeMouseDelta(out: { x: number; y: number }) {
    out.x = this.mouseDX;
    out.y = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Per-frame watchdog: never let a button stick down. */
  watchdog() {
    if (!this.locked || document.hidden || !document.hasFocus()) {
      if (this.down.size) this.releaseAll();
      return;
    }
    // If the OS says a button is up but we think it's down, trust the OS.
    if (this.down.has("Mouse0") && !(this.buttons & 1)) this.down.delete("Mouse0");
    if (this.down.has("Mouse2") && !(this.buttons & 2)) this.down.delete("Mouse2");
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("blur", this.releaseAll);
    document.removeEventListener("visibilitychange", this.releaseAll);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("wheel", this.onWheel);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("pointerlockchange", this.onLockChange);
  }

  private press(code: string) {
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.locked) return;
    // Keep game keys away from the browser (scrolling, find, etc.).
    if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("F") || e.ctrlKey) e.preventDefault();
    if (e.repeat) return;
    this.press(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private onMouseDown = (e: MouseEvent) => {
    this.buttons = e.buttons;
    if (!this.locked || performance.now() < this.ignoreMouseUntil) return;
    this.press(`Mouse${e.button}`);
  };
  private onMouseUp = (e: MouseEvent) => {
    this.buttons = e.buttons;
    this.down.delete(`Mouse${e.button}`);
  };
  private onMouseMove = (e: MouseEvent) => {
    this.buttons = e.buttons;
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY);
  };
  private onContextMenu = (e: Event) => e.preventDefault();
  private releaseAll = () => {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.buttons = 0;
  };
  private onLockChange = () => {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.target;
    this.mouseDX = this.mouseDY = 0;
    if (this.locked && !wasLocked) {
      // The click that grabbed the lock is still held; ignore it.
      this.ignoreMouseUntil = performance.now() + 150;
      this.releaseAll();
    }
    if (!this.locked) this.releaseAll();
  };
}
