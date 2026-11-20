import * as THREE from "three";
import { escapeHtml, HUD_ACCENT, HUD_FG, HUD_MONO, HUD_SANS } from "./HUD";
import { formatPrompt, glyphContext } from "./Glyphs";

const css = <T extends HTMLElement>(e: T, s: string): T => ((e.style.cssText = s), e);
const div = (s = "", parent?: HTMLElement, cls = "") => {
  const e = css(document.createElement("div"), s);
  if (cls) e.className = cls;
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

/**
 * What the HUD is currently asking of the player. Read by the engine so the
 * gamepad's X knows whether a tap reloads or a hold interacts.
 */
export const hudSignals = { interact: false, /** Between waves: "[N] READY" is on offer (touch shows a READY button). */ ready: false };

const NUM_POOL = 28;
const TEAM_MAX = 4;

type RowEl = { root: HTMLDivElement; name: HTMLSpanElement; status: HTMLSpanElement; fill: HTMLDivElement; n: string; hp: number; s: string; you: boolean };

/**
 * Survival overlay (DOM): wave panel, team panel, money with pop-ups,
 * interaction prompts (device-aware glyphs), downed screen, boss bar,
 * animated banners and pooled floating damage numbers. Diff-checked like the
 * base HUD: idle frames write nothing.
 */
export class SurvivalHUD {
  private readonly root: HTMLDivElement;
  private readonly waveLabel: HTMLDivElement;
  private readonly waveNum: HTMLSpanElement;
  private readonly waveOf: HTMLSpanElement;
  private readonly waveSub: HTMLDivElement;
  private readonly bannerWrap: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerLine: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private readonly rows: RowEl[] = [];
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
  private pops = 0;
  private readonly v = new THREE.Vector3();

  // Last-written values.
  private lWave = -1;
  private lTarget = -1;
  private lPhase = "";
  private lRemaining = -1;
  private lTimer = -1;
  private lGlyphVer = -1;
  private lBossOn = false;
  private lBossName = "";
  private lBossFrac = -1;
  private lMoney = -1;
  private lPrompt = "";
  private lPP = -2;
  private lDowned = false;
  private lHint = "";
  private lBleed = -1;
  private lRevive = -1;

  constructor(container: HTMLElement) {
    hudSignals.interact = false;
    hudSignals.ready = false;
    this.root = div("position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden;", container, "ih-hud");
    this.root.style.cssText += `color:${HUD_FG};font-family:${HUD_SANS};text-shadow:0 1px 2px rgba(0,0,0,.6);`;

    // ---- Top-left: wave + team ----------------------------------------------------
    const tl = div("position:absolute;left:26px;top:20px;width:210px;", this.root, "ih-s-wave");
    this.waveLabel = div("opacity:.7;", tl, "ih-cap");
    this.waveLabel.textContent = "Wave";
    const wn = div("display:flex;align-items:baseline;gap:6px;line-height:1;margin-top:2px;", tl);
    this.waveNum = document.createElement("span");
    css(this.waveNum, `font:700 40px/1 ${HUD_MONO};font-variant-numeric:tabular-nums;color:${HUD_FG};display:inline-block;`);
    this.waveOf = document.createElement("span");
    css(this.waveOf, `font:600 15px/1 ${HUD_MONO};opacity:.55;`);
    wn.append(this.waveNum, this.waveOf);
    this.waveSub = div("font-size:11px;font-weight:600;letter-spacing:.16em;margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:18px;", tl);
    const team = div("display:flex;flex-direction:column;gap:7px;margin-top:16px;font-size:11px;letter-spacing:.08em;", tl);
    for (let i = 0; i < TEAM_MAX; i++) {
      const root = div("display:none;", team);
      const head = div("display:flex;justify-content:space-between;gap:8px;", root);
      const name = document.createElement("span");
      const status = document.createElement("span");
      status.style.cssText = "color:#ff7a5a;font-weight:700;letter-spacing:.14em;font-size:10px;";
      head.append(name, status);
      const bar = div("height:3px;margin-top:3px;background:rgba(0,0,0,.45);overflow:hidden;", root);
      const fill = div("height:100%;width:100%;transform-origin:left;transition:transform 140ms,background-color 200ms;", bar);
      this.rows.push({ root, name, status, fill, n: "", hp: -1, s: "~", you: false });
    }

    // ---- Top centre (under the compass): boss bar ---------------------------------
    this.boss = div("position:absolute;left:50%;top:66px;transform:translateX(-50%);width:min(440px,70vw);display:none;", this.root, "ih-s-boss");
    this.bossName = div("color:#ff8a6a;text-align:center;margin-bottom:5px;", this.boss, "ih-cap");
    const bb = div("height:5px;background:rgba(0,0,0,.55);box-shadow:0 0 0 1px rgba(255,120,90,.35);overflow:hidden;", this.boss);
    this.bossFill = div("height:100%;width:100%;background:linear-gradient(90deg,#b8261a,#ff5a3a);transform-origin:left;transition:transform 120ms;", bb);

    // ---- Banner ---------------------------------------------------------------------
    this.bannerWrap = div("position:absolute;left:50%;top:24%;transform:translateX(-50%);text-align:center;opacity:0;white-space:nowrap;", this.root);
    this.banner = div("font-size:clamp(28px,4.6vw,46px);font-weight:800;letter-spacing:.3em;margin-right:-.3em;", this.bannerWrap);
    this.bannerLine = div(`height:2px;margin:10px auto 0;width:min(360px,60vw);background:linear-gradient(90deg,transparent,${HUD_ACCENT},transparent);`, this.bannerWrap);
    this.bannerSub = div("font-size:12px;font-weight:600;letter-spacing:.26em;opacity:.88;margin-top:10px;", this.bannerWrap);

    // ---- Bottom-left (above health): money -----------------------------------------
    const m = div("position:absolute;left:28px;bottom:78px;", this.root, "ih-s-money");
    this.moneyPops = div("display:flex;flex-direction:column;align-items:flex-start;gap:1px;font-size:12px;font-weight:600;color:#c8f0a0;margin-bottom:3px;", m);
    this.money = div("font-size:24px;font-weight:700;color:#a6e57a;", m, "ih-num");

    // ---- Prompt ---------------------------------------------------------------------
    this.prompt = div("position:absolute;left:50%;top:calc(50% + 96px);transform:translateX(-50%);text-align:center;display:none;", this.root, "ih-s-prompt");
    this.promptText = div("display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px;font-weight:600;letter-spacing:.14em;padding:6px 16px;white-space:nowrap;", this.prompt, "ih-panel");
    this.promptBar = div("height:2px;margin:6px auto 0;width:160px;background:rgba(0,0,0,.5);display:none;overflow:hidden;", this.prompt);
    this.promptFill = div("height:100%;width:100%;background:#9be070;transform-origin:left;transform:scaleX(0);", this.promptBar);

    // ---- Downed -----------------------------------------------------------------------
    this.downed = div("position:absolute;inset:0;display:none;background:radial-gradient(ellipse at center,rgba(60,0,0,.12) 30%,rgba(90,0,0,.66) 100%);", this.root);
    const dc = div("position:absolute;left:50%;top:30%;transform:translateX(-50%);text-align:center;width:min(380px,86vw);", this.downed);
    div("font-size:38px;font-weight:800;letter-spacing:.42em;margin-right:-.42em;color:#ff5a4a;", dc).textContent = "DOWNED";
    const bleedBar = div("height:4px;margin-top:14px;background:rgba(0,0,0,.6);overflow:hidden;", dc);
    this.downedBleed = div("height:100%;width:100%;background:#ff5a4a;transform-origin:left;", bleedBar);
    const revBar = div("height:4px;margin-top:5px;background:rgba(0,0,0,.6);overflow:hidden;", dc);
    this.downedRevive = div("height:100%;width:100%;background:#9be070;transform-origin:left;transform:scaleX(0);", revBar);
    this.downedHint = div("display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;font-size:12px;font-weight:600;letter-spacing:.16em;margin-top:12px;opacity:.92;", dc);

    for (let i = 0; i < NUM_POOL; i++) {
      const el = div(`position:absolute;left:0;top:0;font:800 15px/1 ${HUD_MONO};display:none;will-change:transform;`, this.root);
      this.nums.push({ el, pos: new THREE.Vector3(), t: 0, vy: 0, active: false });
    }
  }

  frame(f: SurvivalHudFrame, dt: number, camera: THREE.Camera, w: number, h: number) {
    const gv = glyphContext.version;
    const glyphs = gv !== this.lGlyphVer;
    this.lGlyphVer = gv;

    // ---- Wave panel -------------------------------------------------------------
    const pre = f.phase === "prematch";
    if (this.lWave !== f.wave || this.lTarget !== f.waveTarget || this.lPhase !== f.phase) {
      const waveChanged = this.lWave !== f.wave && this.lWave >= 0;
      this.lWave = f.wave;
      this.lTarget = f.waveTarget;
      this.waveNum.textContent = pre ? "—" : String(f.wave);
      this.waveOf.textContent = f.waveTarget && !pre ? `/ ${f.waveTarget}` : "";
      this.waveLabel.textContent = pre ? "Stand by" : "Wave";
      if (waveChanged)
        this.waveNum.animate?.([{ transform: "scale(1.5)", color: HUD_ACCENT }, { transform: "scale(1)", color: HUD_FG }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    const timer = Math.ceil(f.timer);
    const intermission = f.phase === "intermission" || pre;
    hudSignals.ready = intermission;
    if (this.lPhase !== f.phase || (f.phase === "combat" && this.lRemaining !== f.remaining) || (intermission && (this.lTimer !== timer || glyphs))) {
      this.lPhase = f.phase;
      this.lRemaining = f.remaining;
      this.lTimer = timer;
      let html = "";
      if (f.phase === "combat") html = `<span><span class="ih-num" style="font-size:13px">${f.remaining}</span> HOSTILE${f.remaining === 1 ? "" : "S"} LEFT</span>`;
      else if (intermission) {
        const mm = Math.floor(timer / 60), ss = String(timer % 60).padStart(2, "0");
        html = `<span>NEXT <span class="ih-num" style="font-size:13px;color:${HUD_ACCENT}">${mm}:${ss}</span></span><span style="opacity:.8;display:inline-flex;align-items:center;gap:5px">${formatPrompt("[N] READY", glyphContext, 16)}</span>`;
      } else if (f.phase === "victory") html = `<span style="color:#9be070">OUTPOST HELD</span>`;
      else if (f.phase === "defeat") html = `<span style="color:#ff5a4a">TEAM WIPED</span>`;
      this.waveSub.innerHTML = html;
    }

    // ---- Boss -------------------------------------------------------------------
    const bossOn = f.boss !== null;
    if (bossOn !== this.lBossOn) {
      this.lBossOn = bossOn;
      this.boss.style.display = bossOn ? "block" : "none";
      if (bossOn) this.boss.animate?.([{ opacity: 0, transform: "translate(-50%,-8px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 260, easing: "ease-out" });
    }
    if (f.boss) {
      if (f.boss.name !== this.lBossName) this.bossName.textContent = this.lBossName = f.boss.name;
      const q = Math.round(f.boss.frac * 400) / 400;
      if (q !== this.lBossFrac) {
        this.lBossFrac = q;
        this.bossFill.style.transform = `scaleX(${q})`;
      }
    }

    // ---- Money ------------------------------------------------------------------
    if (this.lMoney !== f.money) {
      this.lMoney = f.money;
      this.money.textContent = `$${f.money.toLocaleString("en-US")}`;
    }

    // ---- Team -------------------------------------------------------------------
    for (let i = 0; i < TEAM_MAX; i++) {
      const r = this.rows[i];
      const t = f.team[i];
      if (!t) {
        if (r.n !== "") {
          r.n = "";
          r.root.style.display = "none";
        }
        continue;
      }
      if (r.n !== t.name || r.you !== !!t.you) {
        if (r.n === "") r.root.style.display = "block";
        r.n = t.name;
        r.you = !!t.you;
        r.name.textContent = t.name;
        r.name.style.color = t.you ? "#86c7ff" : HUD_FG;
        r.name.style.fontWeight = t.you ? "700" : "500";
        r.hp = -1;
      }
      const hp = Math.round(t.health);
      if (r.hp !== hp || r.s !== t.status) {
        r.hp = hp;
        r.s = t.status;
        r.status.textContent = t.status;
        const frac = Math.max(0, Math.min(1, t.health / t.max));
        r.fill.style.transform = `scaleX(${frac.toFixed(3)})`;
        r.fill.style.backgroundColor = t.status ? "#ff5a4a" : frac < 0.35 ? "#ff8a5a" : t.you ? "#86c7ff" : "#e8e2cc";
      }
    }

    // ---- Prompt -------------------------------------------------------------------
    if (this.lPrompt !== f.prompt || (glyphs && f.prompt)) {
      const appear = !this.lPrompt && !!f.prompt;
      this.lPrompt = f.prompt;
      hudSignals.interact = f.prompt.includes("[F]") || (f.downed && f.downedHint.includes("[F]"));
      this.prompt.style.display = f.prompt ? "block" : "none";
      this.promptText.innerHTML = f.prompt ? formatPrompt(f.prompt, glyphContext, 18) : "";
      if (appear) this.prompt.animate?.([{ opacity: 0, transform: "translate(-50%,6px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 160, easing: "ease-out" });
    }
    const pp = f.promptProgress >= 0 ? Math.round(f.promptProgress * 200) : -1;
    if (this.lPP !== pp) {
      if ((this.lPP < 0) !== (pp < 0)) this.promptBar.style.display = pp >= 0 ? "block" : "none";
      this.lPP = pp;
      if (pp >= 0) this.promptFill.style.transform = `scaleX(${(pp / 200).toFixed(3)})`;
    }

    // ---- Downed -------------------------------------------------------------------
    if (this.lDowned !== f.downed) {
      this.lDowned = f.downed;
      this.downed.style.display = f.downed ? "block" : "none";
      hudSignals.interact = f.prompt.includes("[F]") || (f.downed && f.downedHint.includes("[F]"));
      if (f.downed) this.downed.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: "ease-out" });
    }
    if (f.downed) {
      const b = Math.round(Math.max(0, f.bleed / f.bleedMax) * 300) / 300;
      if (b !== this.lBleed) {
        this.lBleed = b;
        this.downedBleed.style.transform = `scaleX(${b.toFixed(3)})`;
      }
      const rv = Math.round(f.reviveProgress * 300) / 300;
      if (rv !== this.lRevive) {
        this.lRevive = rv;
        this.downedRevive.style.transform = `scaleX(${rv.toFixed(3)})`;
      }
      if (this.lHint !== f.downedHint || glyphs) {
        this.lHint = f.downedHint;
        hudSignals.interact = f.prompt.includes("[F]") || f.downedHint.includes("[F]");
        this.downedHint.innerHTML = formatPrompt(f.downedHint, glyphContext, 16);
      }
    }

    // ---- Damage numbers -------------------------------------------------------
    for (let i = 0; i < NUM_POOL; i++) {
      const n = this.nums[i];
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
      n.el.style.opacity = Math.min(1, n.t / 0.35).toFixed(2);
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
    if (this.pops >= 5) this.moneyPops.firstElementChild?.remove();
    else this.pops++;
    const el = div("white-space:nowrap;display:flex;gap:8px;", this.moneyPops);
    el.innerHTML = `<span class="ih-num">+$${amount}</span>${reason ? `<span style="opacity:.75;font-size:10px;letter-spacing:.2em">${escapeHtml(reason)}</span>` : ""}`;
    const anim = el.animate?.(
      [
        { opacity: 0, transform: "translateX(-10px)" },
        { opacity: 1, transform: "none", offset: 0.1 },
        { opacity: 1, transform: "none", offset: 0.75 },
        { opacity: 0, transform: "translateY(-6px)" },
      ],
      { duration: 1700, easing: "ease-out", fill: "forwards" },
    );
    const done = () => {
      if (el.isConnected) {
        el.remove();
        this.pops = Math.max(0, this.pops - 1);
      }
    };
    if (anim) anim.onfinish = done;
    else setTimeout(done, 1700);
    this.money.animate?.([{ transform: "scale(1.12)", color: "#e4ffcf" }, { transform: "scale(1)", color: "#a6e57a" }], { duration: 300, easing: "ease-out" });
  }

  showBanner(title: string, sub: string, seconds = 2.6, color = HUD_FG) {
    this.banner.textContent = title;
    this.banner.style.color = color;
    this.bannerSub.textContent = sub;
    this.bannerSub.style.display = sub ? "block" : "none";
    const d = Math.max(800, seconds * 1000);
    const inT = Math.min(0.3, 320 / d);
    const outT = 1 - Math.min(0.3, 420 / d);
    this.bannerWrap.getAnimations?.().forEach((a) => a.cancel());
    this.bannerWrap.animate?.(
      [
        { opacity: 0, transform: "translate(-50%,12px) scale(1.04)" },
        { opacity: 1, transform: "translate(-50%,0) scale(1)", offset: inT },
        { opacity: 1, transform: "translate(-50%,0) scale(1)", offset: outT },
        { opacity: 0, transform: "translate(-50%,-8px) scale(.99)" },
      ],
      { duration: d, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" },
    );
    this.banner.animate?.([{ letterSpacing: ".6em", filter: "blur(5px)" }, { letterSpacing: ".3em", filter: "blur(0px)" }], { duration: 560, easing: "cubic-bezier(.16,.84,.24,1)" });
    this.bannerLine.animate?.([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 620, delay: 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
    this.bannerSub.animate?.([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 0.88, transform: "none" }], { duration: 380, delay: 220, easing: "ease-out", fill: "backwards" });
  }

  dispose() {
    hudSignals.interact = false;
    hudSignals.ready = false;
    this.root.remove();
  }
}
