"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { QUALITY, type QualityName } from "@/game/config";
import { ACTIONS, DEFAULT_SETTINGS, FOV_RANGE, rebind, type ActionId, type GameSettings, type PadCurve } from "@/game/ui/Settings";
import { PAD_ACTIONS } from "@/game/ui/Glyphs";
import { radialDeadzone } from "@/game/core/Input";
import type { DeviceSnapshot } from "./gamepad";
import { KeyGlyph, PadGlyph } from "./glyph";

export const SETTINGS_TABS = [
  { id: "graphics", label: "Graphics" },
  { id: "mouse", label: "Mouse" },
  { id: "controller", label: "Controller" },
  { id: "audio", label: "Audio" },
  { id: "keys", label: "Keybinds" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

type Props = {
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
  dev: DeviceSnapshot;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
};

/** Full settings menu (tabs + rows). Persistence lives with the caller. */
export function SettingsPanel({ settings: s, onChange, dev, tab, onTab }: Props) {
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-white/10 pb-2">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-semibold tracking-[0.18em] uppercase transition-colors",
              tab === t.id ? "bg-white/15 text-white" : "text-neutral-400 hover:text-neutral-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="mt-3 grid animate-in gap-1 duration-200 fade-in slide-in-from-right-2">
        {tab === "graphics" && (
          <>
            <ChoiceRow
              label="Quality preset"
              value={s.quality}
              options={(Object.keys(QUALITY) as QualityName[]).map((q) => [q, QUALITY[q].label])}
              onChange={(q) => onChange({ quality: q })}
              hint="Resolution, shadows, post-processing, foliage and effects budget."
            />
            <SliderRow label="Field of view" value={s.fov} min={FOV_RANGE[0]} max={FOV_RANGE[1]} step={1} format={(v) => `${v}°`} onChange={(v) => onChange({ fov: v })} />
            <ToggleRow label="FPS counter" value={s.showFps} onChange={(v) => onChange({ showFps: v })} />
          </>
        )}

        {tab === "mouse" && (
          <>
            <SliderRow label="Sensitivity" value={s.sensitivity} min={0.1} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => onChange({ sensitivity: v })} />
            <SliderRow label="ADS multiplier" value={s.adsSensitivity} min={0.2} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ adsSensitivity: v })} />
            <ToggleRow label="Invert vertical" value={s.invertY} onChange={(v) => onChange({ invertY: v })} />
            <p className="mt-2 rounded border border-white/5 bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-neutral-400">
              <span className="font-semibold text-neutral-200">Raw input:</span> the game asks the browser for unaccelerated mouse movement where supported (Chrome,
              Edge). Elsewhere your OS pointer acceleration applies — turn it off for 1:1 aim.
            </p>
          </>
        )}

        {tab === "controller" && (
          <>
            <SliderRow label="Look sensitivity" value={s.padSensitivity} min={0.2} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => onChange({ padSensitivity: v })} />
            <SliderRow label="ADS multiplier" value={s.padAdsSensitivity} min={0.2} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ padAdsSensitivity: v })} />
            <ChoiceRow
              label="Response curve"
              value={s.padCurve}
              options={[
                ["standard", "Standard"],
                ["linear", "Linear"],
                ["dynamic", "Dynamic"],
              ]}
              onChange={(v) => onChange({ padCurve: v as PadCurve })}
              hint="Standard: precise near centre. Linear: 1:1. Dynamic: very fine centre, fast rim."
            />
            <SliderRow label="Stick deadzone" value={s.padDeadzone} min={0.02} max={0.35} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ padDeadzone: v })} />
            <StickTester deadzone={s.padDeadzone} connected={dev.connected} />
            <ToggleRow label="Invert vertical" value={s.padInvertY} onChange={(v) => onChange({ padInvertY: v })} />
            <ToggleRow label="Aim assist" value={s.aimAssist} onChange={(v) => onChange({ aimAssist: v })} hint="Light: slows the stick over visible targets and nudges toward them when you aim. Controller only." />
            <ToggleRow label="Vibration" value={s.vibration} onChange={(v) => onChange({ vibration: v })} extra={<RumbleTest enabled={s.vibration && dev.connected} />} />
            <PadMap dev={dev} />
          </>
        )}

        {tab === "audio" && (
          <SliderRow label="Master volume" value={s.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ volume: v })} />
        )}

        {tab === "keys" && <Keybinds settings={s} onChange={onChange} />}
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1 rounded px-2 py-2 transition-colors hover:bg-white/[0.03] sm:grid-cols-[160px_1fr]">
      <div>
        <div className="text-sm text-neutral-200">{label}</div>
        {hint && <div className="text-[11px] leading-snug text-neutral-500">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-3">{children}</div>
    </div>
  );
}

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Row label={props.label}>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-6 min-w-0 flex-1 accent-white"
      />
      <span className="w-14 text-right font-mono text-sm text-neutral-200 tabular-nums">{props.format(props.value)}</span>
    </Row>
  );
}

function ToggleRow({ label, value, onChange, hint, extra }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; extra?: React.ReactNode }) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors", value ? "border-white/60 bg-white/30" : "border-white/15 bg-white/5")}
      >
        <span className={cn("absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full transition-transform duration-150", value ? "translate-x-5 bg-white" : "bg-neutral-400")} />
      </button>
      <span className="text-xs font-semibold tracking-[0.18em] text-neutral-400 uppercase">{value ? "On" : "Off"}</span>
      {extra}
    </Row>
  );
}

function ChoiceRow<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex flex-wrap gap-1">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn(
              "min-w-20 rounded border px-3 py-1.5 text-xs font-semibold tracking-[0.14em] uppercase transition-colors",
              value === id ? "border-white/70 bg-white/15 text-white" : "border-white/10 text-neutral-300 hover:border-white/25",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </Row>
  );
}

/** Live view of both sticks against the deadzone (direct DOM writes, no re-render). */
function StickTester({ deadzone, connected }: { deadzone: number; connected: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!connected) return;
    let raf = 0;
    const out = { x: 0, y: 0 };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const gp = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected);
      const dots = box.current?.querySelectorAll<HTMLElement>("[data-dot]");
      if (!gp || !dots) return;
      dots.forEach((el, i) => {
        const x = gp.axes[i * 2] ?? 0, y = gp.axes[i * 2 + 1] ?? 0;
        const live = radialDeadzone(x, y, deadzone, 0.04, out) > 0;
        el.style.transform = `translate(${(x * 26).toFixed(1)}px,${(y * 26).toFixed(1)}px)`;
        el.style.background = live ? "#ffffff" : "#737373";
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [connected, deadzone]);
  if (!connected) return <p className="px-2 text-[11px] text-neutral-500">Connect a controller (and press a button) to test the sticks.</p>;
  return (
    <div ref={box} className="flex items-center gap-6 px-2 pt-1 pb-4" data-nav-skip>
      {["MOVE", "LOOK"].map((label) => (
        <div key={label} className="relative grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-black/30">
          <div className="absolute rounded-full border border-dashed border-white/50" style={{ width: `${deadzone * 64}px`, height: `${deadzone * 64}px` }} />
          <span data-dot className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
          <span className="absolute -bottom-4 text-[9px] tracking-[0.2em] text-neutral-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

function RumbleTest({ enabled }: { enabled: boolean }) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => {
        const gp = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | undefined;
        gp?.vibrationActuator?.playEffect?.("dual-rumble", { duration: 260, strongMagnitude: 0.7, weakMagnitude: 0.5 })?.catch(() => {});
      }}
      className="ml-auto rounded border border-white/10 px-2.5 py-1 text-[11px] tracking-[0.14em] text-neutral-300 uppercase hover:border-white/25 disabled:opacity-40"
    >
      Test
    </button>
  );
}

const PAD_ROWS: [ActionId, string][] = [
  ["fire", "Fire"],
  ["ads", "Aim"],
  ["grenade", "Frag (either bumper)"],
  ["jump", "Jump"],
  ["crouch", "Crouch · slide while sprinting"],
  ["reload", "Reload · hold to interact"],
  ["swap", "Switch weapon"],
  ["sprint", "Sprint"],
  ["melee", "Knife"],
  ["scoreboard", "Scoreboard (or View)"],
  ["readyUp", "Ready up"],
];

function PadMap({ dev }: { dev: DeviceSnapshot }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 rounded border border-white/5 bg-white/[0.02] px-3 py-3 text-xs sm:grid-cols-2">
      <div className="col-span-full mb-1 text-[10px] font-semibold tracking-[0.24em] text-neutral-500 uppercase">Controller layout</div>
      <PadRow dev={dev} btn="LS" label="Move" />
      <PadRow dev={dev} btn="RS" label="Look" />
      {PAD_ROWS.map(([a, label]) => (
        <PadRow key={a} dev={dev} btn={PAD_ACTIONS[a]} label={label} />
      ))}
      <PadRow dev={dev} btn="MENU" label="Pause" />
    </div>
  );
}

function PadRow({ dev, btn, label }: { dev: DeviceSnapshot; btn: Parameters<typeof PadGlyph>[0]["btn"]; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-neutral-300">
      <span className="flex w-8 justify-center">
        <PadGlyph btn={btn} layout={dev.layout} />
      </span>
      {label}
    </div>
  );
}

function Keybinds({ settings, onChange }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void }) {
  const [capturing, setCapturing] = useState<ActionId | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const assign = (code: string) => {
      onChange({ bindings: rebind(settings.bindings, capturing, code) });
      setCapturing(null);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") setCapturing(null);
      else if (e.code) assign(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      assign(`Mouse${e.button}`);
    };
    const noMenu = (e: Event) => e.preventDefault();
    // Next tick, so the click that started capturing isn't captured itself.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouse, true);
    }, 0);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", noMenu, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("contextmenu", noMenu, true);
    };
  }, [capturing, onChange, settings.bindings]);

  return (
    <div className="grid gap-0.5">
      <p className="mb-1 px-2 text-[11px] text-neutral-500">Select an action, then press a key or mouse button. Esc cancels. Taken keys swap.</p>
      {ACTIONS.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-white/[0.03]">
          <span className="text-sm text-neutral-200">{a.label}</span>
          <button
            type="button"
            onClick={() => setCapturing(a.id)}
            className={cn(
              "flex h-8 min-w-24 items-center justify-center gap-2 rounded border px-3 text-xs transition-colors",
              capturing === a.id ? "animate-pulse border-white/70 bg-white/15 text-white" : "border-white/10 hover:border-white/25",
            )}
          >
            {capturing === a.id ? "Press a key…" : <KeyGlyph code={settings.bindings[a.id]} />}
          </button>
        </div>
      ))}
      <div className="mt-2 flex justify-end px-2">
        <button
          type="button"
          onClick={() => onChange({ bindings: DEFAULT_SETTINGS.bindings })}
          className="rounded border border-white/10 px-3 py-1.5 text-[11px] tracking-[0.16em] text-neutral-300 uppercase hover:border-white/25"
        >
          Reset keybinds
        </button>
      </div>
    </div>
  );
}
