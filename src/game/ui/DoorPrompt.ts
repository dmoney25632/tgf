import { formatPrompt, glyphContext } from "./Glyphs";

/**
 * "[F] OPEN DOOR" under the crosshair while a door is in reach. Sits where
 * the survival / mission prompts go and only shows when none of those is up.
 * Diff-checked: idle frames write nothing.
 */
export class DoorPrompt {
  private readonly el: HTMLDivElement;
  private last = "";
  private glyphVersion = -1;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ih-panel";
    this.el.style.cssText =
      "position:absolute;left:50%;top:calc(50% + 96px);transform:translateX(-50%);display:none;align-items:center;justify-content:center;gap:7px;" +
      "font-size:13px;font-weight:600;letter-spacing:.14em;padding:6px 16px;white-space:nowrap;pointer-events:none;z-index:5;";
    container.appendChild(this.el);
  }

  /** `text` = "" hides it. */
  set(text: string) {
    if (text === this.last && glyphContext.version === this.glyphVersion) return;
    this.glyphVersion = glyphContext.version;
    this.last = text;
    this.el.style.display = text ? "flex" : "none";
    if (text) this.el.innerHTML = formatPrompt(text, glyphContext, 18);
  }

  dispose() {
    this.el.remove();
  }
}
