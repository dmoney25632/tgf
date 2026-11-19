import * as THREE from "three";
import { escapeHtml } from "./HUD";

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement) => {
  const e = css(document.createElement("div"), s);
  parent?.appendChild(e);
  return e;
};

export type TeamRow = { name: string; health: number; max: number; status: string; you?: boolean };
export type SurvivalHudFrame = {
  wave: number;
  waveTarget: number;
  phase: string;
  remaining: number;
  timer: number;
  money: number;
  team: TeamRow[];
  prompt: string;
  /** Hold-progress for the prompt (0..1, -1 hidden). */
  promptProgress: number;
  downed: boolean;
  bleed: number;
  bleedMax: number;
  reviveProgress: number;
  downedHint: string;
  boss: { name: string; frac: number } | null;
};

const NUM_POOL = 28;

/**
 * Survival overlay (DOM): wave/timer header, team panel, money with pop-ups,
 * interaction prompts, downed screen, boss bar, banners and pooled
 * floating damage numbers. Diff-checked like the base HUD.
 */
export class SurvivalHUD {
  private readonly root: HTMLDivElement;
  private readonly waveTitle: HTMLDivElement;
  private readonly waveSub: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private readonly bannerWrap: HTMLDivElement;
  private readonly team: HTMLDivElement;
  private readonly money: HTMLDivElement;
  private readonly moneyPops: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLDivElement;
  private readonly promptBar: HTMLDivElement;
  private readonly promptFill: HTMLDivElement;
  private readonly downed: HTMLDivElement;
  private readonly downedBleed: HTMLDivElement;
  private readonly downedRevive: HTMLDivElement;
  private readonly downedHint: HTMLDivElement;
  private readonly boss: HTMLDivElement;
  private readonly bossName: HTMLDivElement;
  private readonly bossFill: HTMLDivElement;
  private readonly nums: { el: HTMLDivElement; pos: THREE.Vector3; t: number; vy: number; active: boolean }[] = [];
  private nextNum = 0;
  private bannerTimer = 0;
  private readonly last: Record<string, unknown> = {};
  private readonly v = new THREE.Vector3();
  private pops: { el: HTMLDivElement; t: number }[] = [];

  constructor(container: HTMLElement) {
    this.root = div("position:absolute;inset:0;pointer-events:none;user-select:none;color:#f2efe6;font-family:var(--font-geist-mono),ui-monospace,monospace;text-shadow:0 1px 2px rgba(0,0,0,.7);", container);

    const head = div("position:absolute;left:50%;top:14px;transform:translateX(-50%);text-align:center;", this.root);
    this.waveTitle = div("font-size:22px;font-weight:800;letter-spacing:.32em;", head);
    this.waveSub = div("font-size:12px;letter-spacing:.22em;opacity:.8;margin-top:2px;", head);

    this.boss = div("position:absolute;left:50%;top:70px;transform:translateX(-50%);width:420px;display:none;", this.root);
    this.bossName = div("font-size:11px;letter-spacing:.3em;color:#ff7a5a;text-align:center;margin-bottom:4px;", this.boss);
    const bb = div("height:7px;background:rgba(0,0,0,.55);border:1px solid rgba(255,120,90,.45);", this.boss);
    this.bossFill = div("height:100%;width:100%;background:linear-gradient(90deg,#b8261a,#ff5a3a);transition:width 100ms;", bb);

    this.bannerWrap = div("position:absolute;left:50%;top:26%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity 250ms;", this.root);
    this.banner = div("font-size:44px;font-weight:900;letter-spacing:.3em;", this.bannerWrap);
    this.bannerSub = div("font-size:14px;letter-spacing:.24em;opacity:.85;margin-top:6px;", this.bannerWrap);

    this.team = div("position:absolute;left:24px;top:24px;display:flex;flex-direction:column;gap:6px;width:200px;font-size:11px;letter-spacing:.12em;", this.root);

    const m = div("position:absolute;right:24px;top:40px;text-align:right;", this.root);
    this.money = div("font-size:26px;font-weight:800;color:#9be070;font-variant-numeric:tabular-nums;", m);
    this.moneyPops = div("display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:13px;color:#c8f0a0;margin-top:2px;", m);

    this.prompt = div("position:absolute;left:50%;top:calc(50% + 90px);transform:translateX(-50%);text-align:center;display:none;", this.root);
    this.promptText = div("font-size:14px;letter-spacing:.18em;padding:6px 12px;background:rgba(0,0,0,.45);border-radius:4px;", this.prompt);
    this.promptBar = div("height:3px;margin-top:6px;background:rgba(0,0,0,.5);display:none;", this.prompt);
    this.promptFill = div("height:100%;width:0;background:#9be070;", this.promptBar);

    this.downed = div("position:absolute;inset:0;display:none;background:radial-gradient(ellipse at center,rgba(60,0,0,.15) 30%,rgba(90,0,0,.7) 100%);", this.root);
    const dc = div("position:absolute;left:50%;top:30%;transform:translateX(-50%);text-align:center;width:360px;", this.downed);
    div("font-size:40px;font-weight:900;letter-spacing:.4em;color:#ff5a4a;", dc).textContent = "DOWNED";
    const bleedBar = div("height:6px;margin-top:14px;background:rgba(0,0,0,.6);", dc);
    this.downedBleed = div("height:100%;width:100%;background:#ff5a4a;", bleedBar);
    const revBar = div("height:6px;margin-top:6px;background:rgba(0,0,0,.6);", dc);
    this.downedRevive = div("height:100%;width:0;background:#9be070;", revBar);
    this.downedHint = div("font-size:13px;letter-spacing:.18em;margin-top:12px;opacity:.9;", dc);

    for (let i = 0; i < NUM_POOL; i++) {
      const el = div("position:absolute;left:0;top:0;font-size:15px;font-weight:800;display:none;will-change:transform;", this.root);
      this.nums.push({ el, pos: new THREE.Vector3(), t: 0, vy: 0, active: false });
    }
  }

  frame(f: SurvivalHudFrame, dt: number, camera: THREE.Camera, w: number, h: number) {
    // ---- Header ---------------------------------------------------------------
    const target = f.waveTarget ? ` / ${f.waveTarget}` : "";
    const title = f.phase === "prematch" ? "STAND BY" : `WAVE ${f.wave}${target}`;
    let sub = "";
    if (f.phase === "combat") sub = `${f.remaining} HOSTILE${f.remaining === 1 ? "" : "S"} REMAINING`;
    else if (f.phase === "intermission" || f.phase === "prematch") sub = `NEXT WAVE IN ${Math.ceil(f.timer)}s  ·  [N] READY UP`;
    else if (f.phase === "victory") sub = "OUTPOST HELD";
    else if (f.phase === "defeat") sub = "TEAM WIPED";
    if (this.last.title !== title) this.waveTitle.textContent = (this.last.title = title) as string;
    if (this.last.sub !== sub) this.waveSub.textContent = (this.last.sub = sub) as string;

    // ---- Boss -----------------------------------------------------------------
    const bossKey = f.boss ? `${f.boss.name}|${Math.round(f.boss.frac * 200)}` : "";
    if (this.last.boss !== bossKey) {
      this.last.boss = bossKey;
      this.boss.style.display = f.boss ? "block" : "none";
      if (f.boss) {
        this.bossName.textContent = f.boss.name.toUpperCase();
        this.bossFill.style.width = `${f.boss.frac * 100}%`;
      }
    }

    // ---- Money ----------------------------------------------------------------
    if (this.last.money !== f.money) {
      this.last.money = f.money;
      this.money.textContent = `$${f.money.toLocaleString("en-US")}`;
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t -= dt;
      p.el.style.opacity = String(Math.max(0, Math.min(1, p.t / 0.4)));
      if (p.t <= 0) {
        p.el.remove();
        this.pops.splice(i, 1);
      }
    }

    // ---- Team -----------------------------------------------------------------
    const teamKey = f.team.map((t) => `${t.name}${Math.round(t.health)}${t.status}`).join("|");
    if (this.last.team !== teamKey) {
      this.last.team = teamKey;
      this.team.innerHTML = f.team
        .map((t) => {
          const frac = Math.max(0, t.health / t.max);
          const color = t.status ? "#ff5a4a" : frac < 0.35 ? "#ff8a5a" : t.you ? "#7fc4ff" : "#e8e2cc";
          return `<div><div style="display:flex;justify-content:space-between"><span style="color:${t.you ? "#7fc4ff" : "#f2efe6"}">${escapeHtml(t.name)}</span><span style="color:#ff7a5a">${escapeHtml(t.status)}</span></div><div style="height:4px;margin-top:3px;background:rgba(0,0,0,.5)"><div style="height:100%;width:${frac * 100}%;background:${color}"></div></div></div>`;
        })
        .join("");
    }

    // ---- Prompt ---------------------------------------------------------------
    if (this.last.prompt !== f.prompt) {
      this.last.prompt = f.prompt;
      this.prompt.style.display = f.prompt ? "block" : "none";
      this.promptText.textContent = f.prompt;
    }
    const pp = f.promptProgress >= 0 ? Math.round(f.promptProgress * 100) : -1;
    if (this.last.pp !== pp) {
      this.last.pp = pp;
      this.promptBar.style.display = pp >= 0 ? "block" : "none";
      if (pp >= 0) this.promptFill.style.width = `${pp}%`;
    }

    // ---- Downed ---------------------------------------------------------------
    if (this.last.downed !== f.downed) {
      this.last.downed = f.downed;
      this.downed.style.display = f.downed ? "block" : "none";
    }
    if (f.downed) {
      this.downedBleed.style.width = `${Math.max(0, f.bleed / f.bleedMax) * 100}%`;
      this.downedRevive.style.width = `${f.reviveProgress * 100}%`;
      if (this.last.hint !== f.downedHint) this.downedHint.textContent = (this.last.hint = f.downedHint) as string;
    }

    // ---- Banner ---------------------------------------------------------------
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerWrap.style.opacity = "0";
    }

    // ---- Damage numbers -------------------------------------------------------
    for (const n of this.nums) {
      if (!n.active) continue;
      n.t -= dt;
      n.pos.y += n.vy * dt;
      n.vy = Math.max(0.3, n.vy - dt * 3);
      if (n.t <= 0) {
        n.active = false;
        n.el.style.display = "none";
        continue;
      }
      this.v.copy(n.pos).project(camera);
      if (this.v.z > 1) {
        n.el.style.display = "none";
        continue;
      }
      n.el.style.display = "block";
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      n.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${(0.8 + Math.min(n.t, 0.2) * 1.5).toFixed(2)})`;
      n.el.style.opacity = String(Math.min(1, n.t / 0.35).toFixed(2));
    }
  }

  damageNumber(at: THREE.Vector3, amount: number, kind: "body" | "head" | "kill" | "armor") {
    const n = this.nums[this.nextNum];
    this.nextNum = (this.nextNum + 1) % NUM_POOL;
    n.active = true;
    n.t = 0.85;
    n.vy = 1.4;
    n.pos.copy(at);
    n.pos.x += (Math.random() - 0.5) * 0.3;
    n.pos.y += 0.15;
    n.el.textContent = String(Math.max(1, Math.round(amount)));
    n.el.style.color = kind === "head" ? "#ffc845" : kind === "kill" ? "#ff5a4a" : kind === "armor" ? "#9cc8ff" : "#ffffff";
    n.el.style.fontSize = kind === "head" || kind === "kill" ? "18px" : "14px";
  }

  moneyPop(amount: number, reason: string) {
    if (amount <= 0) return;
    const el = div("white-space:nowrap;", this.moneyPops);
    el.textContent = `+$${amount}${reason ? `  ${reason}` : ""}`;
    this.pops.push({ el, t: 1.6 });
    if (this.pops.length > 5) this.pops.shift()!.el.remove();
  }

  showBanner(title: string, sub: string, seconds = 2.6, color = "#f2efe6") {
    this.banner.textContent = title;
    this.banner.style.color = color;
    this.bannerSub.textContent = sub;
    this.bannerWrap.style.opacity = "1";
    this.bannerTimer = seconds;
  }

  dispose() {
    this.root.remove();
  }
}
