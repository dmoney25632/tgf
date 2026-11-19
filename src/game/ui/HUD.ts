import type { WeaponStats } from "../weapons/WeaponSystem";

export type HitKind = "body" | "head" | "kill" | "headkill";

export type HudFrame = {
  spreadDeg: number;
  fovDeg: number;
  viewportH: number;
  /** 0..1, crosshair fades as this rises (ADS / sprint). */
  crosshairHide: number;
  ammo: number;
  reserve: number;
  magSize: number;
  weaponName: string;
  weaponKind: string;
  slot: number;
  slotNames: string[];
  reload: number;
  health: number;
  maxHealth: number;
  armor: number;
  /** Grenades carried, or -1 to hide. */
  grenades: number;
  /** 0..1 scope overlay (scoped weapon ADS). */
  scope: number;
};

export type DebugInfo = Record<string, string | number>;

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement) => {
  const e = css(document.createElement("div"), s);
  parent?.appendChild(e);
  return e;
};

/**
 * In-game HUD in plain DOM (cheaper than React at 60+ fps). Every setter
 * diff-checks before touching the DOM, so idle frames do no layout work.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly hairs: HTMLDivElement[] = [];
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly reserve: HTMLDivElement;
  private readonly pips: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly slots: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly reloadBar: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly medal: HTMLDivElement;
  private readonly scoreboard: HTMLDivElement;
  private readonly debug: HTMLPreElement;
  private readonly fps: HTMLDivElement;
  private readonly armorFill: HTMLDivElement;
  private readonly grenadeEl: HTMLDivElement;
  private readonly scopeEl: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;
  private readonly lowHpEl: HTMLDivElement;
  private readonly indicators: { el: HTMLDivElement; t: number; angle: number }[] = [];
  private hurtLevel = 0;
  /** Scoreboard title (mode name). */
  modeLabel = "FIRING RANGE";
  private hitTimer = 0;
  private crossFlash = 0;
  private medalTimer = 0;
  private readonly last: Record<string, unknown> = {};
  private readonly feedItems: { el: HTMLDivElement; t: number }[] = [];
  debugVisible = false;

  constructor(container: HTMLElement) {
    this.root = div(
      "position:absolute;inset:0;pointer-events:none;user-select:none;color:#f2efe6;font-family:var(--font-geist-mono),ui-monospace,monospace;text-shadow:0 1px 2px rgba(0,0,0,.65);",
      container,
    );
    // Vignette (cheap, works on every quality preset).
    div("position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.38) 100%);", this.root);
    this.lowHpEl = div("position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 35%,rgba(120,0,0,.55) 100%);", this.root);
    this.hurtEl = div("position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(200,20,10,.5) 100%);", this.root);

    // Scope: black surround, thin reticle, slight lens tint.
    this.scopeEl = div("position:absolute;inset:0;opacity:0;display:none;", this.root);
    this.scopeEl.innerHTML =
      '<div style="position:absolute;inset:0;background:radial-gradient(circle at center,rgba(20,40,60,.08) 0,rgba(20,40,60,.08) 33vmin,#000 33.4vmin)"></div>' +
      '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(0,0,0,.85)"></div>' +
      '<div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(0,0,0,.85)"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#e83a2a;box-shadow:0 0 4px #e83a2a"></div>' +
      '<div style="position:absolute;left:calc(50% - 3px);top:calc(50% + 6vmin);width:7px;height:1px;background:#000"></div>' +
      '<div style="position:absolute;left:calc(50% - 3px);top:calc(50% + 12vmin);width:7px;height:1px;background:#000"></div>';

    // ---- Crosshair ----------------------------------------------------------
    this.crosshair = div("position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity 80ms linear;", this.root);
    for (let i = 0; i < 4; i++) {
      const v = i < 2;
      this.hairs.push(div(`position:absolute;background:currentColor;box-shadow:0 0 0 1px rgba(0,0,0,.45);${v ? "width:2px;height:10px;left:-1px;" : "width:10px;height:2px;top:-1px;"}`, this.crosshair));
    }
    div("position:absolute;width:2px;height:2px;left:-1px;top:-1px;background:currentColor;box-shadow:0 0 0 1px rgba(0,0,0,.45);", this.crosshair);

    this.hitmarker = div("position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;opacity:0;", this.root);
    this.hitmarker.innerHTML =
      '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" style="filter:drop-shadow(0 0 1px #000)"><path d="M3 3l7 7M25 3l-7 7M3 25l7-7M25 25l-7-7"/></svg>';

    this.reloadBar = div("position:absolute;left:50%;top:calc(50% + 34px);width:64px;height:3px;margin-left:-32px;background:rgba(0,0,0,.45);opacity:0;", this.root);
    this.reloadFill = div("height:100%;width:0;background:#f2efe6;", this.reloadBar);

    this.medal = div("position:absolute;left:50%;top:calc(50% + 70px);transform:translateX(-50%);font-size:15px;font-weight:700;letter-spacing:.18em;opacity:0;transition:opacity 120ms;", this.root);

    // ---- Bottom-left: health ----------------------------------------------
    const hp = div("position:absolute;left:28px;bottom:26px;width:220px;", this.root);
    this.healthText = div("font-size:13px;letter-spacing:.2em;margin-bottom:6px;", hp);
    const bar = div("height:6px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15);", hp);
    this.healthFill = div("height:100%;width:100%;background:linear-gradient(90deg,#e8e2cc,#ffffff);transition:width 120ms;", bar);
    const abar = div("height:4px;margin-top:3px;background:rgba(0,0,0,.35);", hp);
    this.armorFill = div("height:100%;width:0;background:linear-gradient(90deg,#5aa0e8,#9ccaff);transition:width 120ms;", abar);

    // ---- Bottom-right: weapon ----------------------------------------------
    const wb = div("position:absolute;right:28px;bottom:22px;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px;", this.root);
    this.status = div("font-size:12px;letter-spacing:.24em;color:#f0b44a;height:16px;", wb);
    this.slots = div("display:flex;gap:10px;font-size:11px;letter-spacing:.12em;margin-bottom:4px;", wb);
    this.weaponName = div("font-size:13px;letter-spacing:.2em;text-transform:uppercase;opacity:.85;", wb);
    const ammoRow = div("display:flex;align-items:baseline;gap:8px;", wb);
    this.ammo = div("font-size:44px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;", ammoRow);
    this.reserve = div("font-size:18px;opacity:.6;font-variant-numeric:tabular-nums;", ammoRow);
    this.pips = div("display:flex;gap:2px;height:8px;margin-top:4px;", wb);
    this.grenadeEl = div("font-size:12px;letter-spacing:.18em;margin-top:6px;opacity:.85;", wb);

    // ---- Top-right: killfeed -------------------------------------------------
    this.feed = div("position:absolute;right:20px;top:44px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:13px;", this.root);
    this.fps = div("position:absolute;right:12px;top:10px;font-size:11px;opacity:.55;", this.root);

    // ---- Scoreboard (Tab) ---------------------------------------------------
    this.scoreboard = div(
      "position:absolute;left:50%;top:18%;transform:translateX(-50%);min-width:420px;padding:18px 22px;background:rgba(12,13,11,.82);border:1px solid rgba(255,255,255,.12);border-radius:10px;display:none;text-shadow:none;font-size:13px;",
      this.root,
    );

    // ---- Debug (F3) ---------------------------------------------------------
    this.debug = document.createElement("pre");
    css(this.debug, "position:absolute;left:12px;top:12px;margin:0;padding:10px 12px;background:rgba(0,0,0,.6);font-size:11px;line-height:1.45;display:none;text-shadow:none;border-radius:6px;");
    this.root.appendChild(this.debug);
  }

  frame(f: HudFrame, dt: number) {
    // Crosshair gap = projected spread cone + a little extra on hit flash.
    const px = Math.round((Math.tan((f.spreadDeg * Math.PI) / 180) / Math.tan((f.fovDeg * Math.PI) / 360)) * (f.viewportH / 2)) + 5;
    const opacity = Math.max(0, 1 - f.crosshairHide * 1.8).toFixed(2);
    this.crossFlash = Math.max(0, this.crossFlash - dt);
    const color = this.crossFlash > 0 ? "#ff5a4a" : "#f2efe6";
    const key = `${px}|${opacity}|${color}`;
    const scoped = f.scope > 0.9;
    if (this.last.scoped !== scoped) {
      this.last.scoped = scoped;
      this.scopeEl.style.display = scoped ? "block" : "none";
      this.scopeEl.style.opacity = scoped ? "1" : "0";
      this.crosshair.style.visibility = scoped ? "hidden" : "visible";
    }
    if (this.last.cross !== key) {
      this.last.cross = key;
      this.crosshair.style.opacity = opacity;
      this.crosshair.style.color = color;
      const [u, d, l, r] = this.hairs;
      u.style.top = `${-px - 10}px`;
      d.style.top = `${px}px`;
      l.style.left = `${-px - 10}px`;
      r.style.left = `${px}px`;
    }

    // Hitmarker pop: scale from 1.35 → 1 while fading.
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      const t = Math.max(0, this.hitTimer) / 0.22;
      this.hitmarker.style.opacity = String(Math.min(1, t * 1.6));
      this.hitmarker.style.transform = `scale(${1 + t * 0.35})`;
    }

    if (this.medalTimer > 0) {
      this.medalTimer -= dt;
      if (this.medalTimer <= 0) this.medal.style.opacity = "0";
    }

    // Ammo.
    if (this.last.ammo !== f.ammo || this.last.mag !== f.magSize) {
      this.last.ammo = f.ammo;
      this.last.mag = f.magSize;
      this.ammo.textContent = String(f.ammo);
      this.ammo.style.color = f.ammo <= Math.ceil(f.magSize * 0.25) ? "#ff6a4a" : "";
      this.renderPips(f.ammo, f.magSize);
    }
    if (this.last.reserve !== f.reserve) {
      this.last.reserve = f.reserve;
      this.reserve.textContent = `/ ${f.reserve}`;
    }
    if (this.last.weapon !== f.weaponName) {
      this.last.weapon = f.weaponName;
      this.weaponName.textContent = `${f.weaponName} · ${f.weaponKind}`;
    }
    const slotKey = `${f.slot}|${f.slotNames.join()}`;
    if (this.last.slots !== slotKey) {
      this.last.slots = slotKey;
      this.slots.innerHTML = f.slotNames
        .map((n, i) => `<span style="opacity:${i === f.slot ? 1 : 0.4};${i === f.slot ? "color:#f0b44a" : ""}">${i + 1} ${n}</span>`)
        .join("");
    }

    const status = f.reload >= 0 ? "RELOADING" : f.ammo === 0 ? (f.reserve ? "PRESS R TO RELOAD" : "NO AMMO") : f.ammo <= Math.ceil(f.magSize * 0.2) ? "LOW AMMO" : "";
    if (this.last.status !== status) {
      this.last.status = status;
      this.status.textContent = status;
    }
    const reloadPct = f.reload >= 0 ? Math.round(f.reload * 100) : -1;
    if (this.last.reload !== reloadPct) {
      this.last.reload = reloadPct;
      this.reloadBar.style.opacity = reloadPct >= 0 ? "1" : "0";
      if (reloadPct >= 0) this.reloadFill.style.width = `${reloadPct}%`;
    }

    const hpKey = `${Math.round(f.health)}|${f.maxHealth}|${Math.round(f.armor)}`;
    if (this.last.health !== hpKey) {
      this.last.health = hpKey;
      const frac = Math.max(0, f.health / f.maxHealth);
      this.healthFill.style.width = `${frac * 100}%`;
      this.healthFill.style.background = frac < 0.35 ? "linear-gradient(90deg,#c43a2a,#ff6a4a)" : "linear-gradient(90deg,#e8e2cc,#ffffff)";
      this.armorFill.style.width = `${Math.min(100, (f.armor / 150) * 100)}%`;
      this.healthText.textContent = `HEALTH ${Math.max(0, Math.round(f.health))}${f.armor > 0 ? `   ARMOR ${Math.round(f.armor)}` : ""}`;
      this.lowHpEl.style.opacity = frac < 0.4 ? String(((0.4 - frac) / 0.4).toFixed(2)) : "0";
    }
    if (this.last.grenades !== f.grenades) {
      this.last.grenades = f.grenades;
      this.grenadeEl.textContent = f.grenades >= 0 ? `FRAG ×${f.grenades}  [G]` : "";
    }

    // Hurt flash + damage direction arcs.
    if (this.hurtLevel > 0) {
      this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.8);
      this.hurtEl.style.opacity = this.hurtLevel.toFixed(2);
    }
    for (const ind of this.indicators) {
      if (ind.t <= 0) continue;
      ind.t -= dt;
      ind.el.style.opacity = Math.max(0, Math.min(1, ind.t / 0.6)).toFixed(2);
    }

    // Killfeed fade-out.
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const it = this.feedItems[i];
      it.t -= dt;
      if (it.t < 0.5) it.el.style.opacity = String(Math.max(0, it.t / 0.5));
      if (it.t <= 0) {
        it.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
  }

  private renderPips(ammo: number, mag: number) {
    const n = Math.min(mag, 40);
    let html = "";
    for (let i = 0; i < n; i++) {
      const on = i < Math.round((ammo / mag) * n);
      html += `<span style="width:3px;height:8px;background:${on ? "#f2efe6" : "rgba(255,255,255,.18)"}"></span>`;
    }
    this.pips.innerHTML = html;
  }

  /** Player took damage. `angle` = direction to the source relative to view (rad, 0 = ahead). */
  hurt(amount: number, angle: number | null) {
    this.hurtLevel = Math.min(1, this.hurtLevel + amount / 45);
    if (angle === null) return;
    let ind = this.indicators.find((i) => i.t > 0 && Math.abs(i.angle - angle) < 0.35);
    if (!ind) ind = this.indicators.find((i) => i.t <= 0);
    if (!ind) {
      if (this.indicators.length >= 8) return;
      const el = div("position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;", this.root);
      el.innerHTML = '<div style="position:absolute;left:-46px;top:-150px;width:92px;height:24px;background:radial-gradient(ellipse at 50% 100%,rgba(255,60,40,.95),rgba(255,40,20,0) 70%);border-top:3px solid rgba(255,70,50,.9);border-radius:50% 50% 0 0/100% 100% 0 0"></div>';
      ind = { el, t: 0, angle };
      this.indicators.push(ind);
    }
    ind.angle = angle;
    ind.t = 1.4;
    ind.el.style.transform = `rotate(${angle}rad)`;
  }

  /** Update an indicator's rotation as the player turns (called by the mode). */
  get indicatorCount() {
    return this.indicators.length;
  }

  hit(kind: HitKind, medal?: string | null) {
    this.hitTimer = 0.22;
    const kill = kind === "kill" || kind === "headkill";
    this.hitmarker.style.color = kill ? "#ff4636" : kind === "head" ? "#ffc845" : "#ffffff";
    this.hitmarker.style.width = this.hitmarker.style.height = kill ? "34px" : "28px";
    this.hitmarker.style.margin = kill ? "-17px 0 0 -17px" : "-14px 0 0 -14px";
    this.crossFlash = 0.08;
    if (kill && medal !== null) this.showMedal(medal ?? (kind === "headkill" ? "HEADSHOT  +150" : "ELIMINATED  +100"), kind === "headkill" ? "#ffc845" : "#f2efe6");
  }

  showMedal(text: string, color: string) {
    this.medal.textContent = text;
    this.medal.style.color = color;
    this.medal.style.opacity = "1";
    this.medalTimer = 1.1;
  }

  killfeed(killer: string, weapon: string, victim: string, headshot: boolean) {
    const el = div("padding:3px 9px;background:rgba(0,0,0,.45);border-radius:3px;white-space:nowrap;", this.feed);
    el.innerHTML = `<span style="color:#7fc4ff">${escapeHtml(killer)}</span> <span style="opacity:.7">[${escapeHtml(weapon)}]</span>${headshot ? ' <span style="color:#ffc845">⌖</span>' : ""} <span style="color:#ff8a6a">${escapeHtml(victim)}</span>`;
    this.feedItems.push({ el, t: 5 });
    if (this.feedItems.length > 6) {
      const old = this.feedItems.shift()!;
      old.el.remove();
    }
  }

  setScoreboard(visible: boolean, callsign: string, stats: WeaponStats, seconds: number, mapName: string) {
    this.scoreboard.style.display = visible ? "block" : "none";
    if (!visible) return;
    const acc = stats.shotsFired ? ((stats.shotsHit / stats.shotsFired) * 100).toFixed(1) : "0.0";
    const hs = stats.shotsHit ? Math.round((stats.headshots / stats.shotsHit) * 100) : 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    const key = `${callsign}|${stats.kills}|${stats.shotsFired}|${stats.shotsHit}|${mins}:${secs}`;
    if (this.last.board === key) return;
    this.last.board = key;
    const row = (k: string, v: string | number) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="opacity:.6">${k}</span><span>${v}</span></div>`;
    this.scoreboard.innerHTML =
      `<div style="display:flex;justify-content:space-between;margin-bottom:10px;letter-spacing:.2em;font-size:11px;opacity:.7"><span>${escapeHtml(mapName.toUpperCase())} · ${escapeHtml(this.modeLabel)}</span><span>${mins}:${secs}</span></div>` +
      `<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#7fc4ff">${escapeHtml(callsign)}</div>` +
      row("Eliminations", stats.kills) +
      row("Score", stats.kills * 100 + stats.headshots * 50) +
      row("Accuracy", `${acc}%`) +
      row("Headshot rate", `${hs}%`) +
      row("Damage dealt", Math.round(stats.damage)) +
      row("Shots fired / hit", `${stats.shotsFired} / ${stats.shotsHit}`);
  }

  setFps(fps: number) {
    if (this.last.fps === fps) return;
    this.last.fps = fps;
    this.fps.textContent = `${fps} FPS`;
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debug.style.display = this.debugVisible ? "block" : "none";
  }

  setDebug(info: DebugInfo) {
    if (!this.debugVisible) return;
    let s = "";
    for (const k in info) s += `${k.padEnd(14)} ${info[k]}\n`;
    this.debug.textContent = s;
  }

  dispose() {
    this.root.remove();
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
