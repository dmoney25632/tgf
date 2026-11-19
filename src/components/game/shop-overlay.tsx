"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { SurvivalGameMode } from "@/game/survival/SurvivalGameMode";
import type { ShopCategory, ShopItem, ShopView } from "@/game/survival/ShopSystem";
import { PAD_FOCUS_CSS, useGamepadNav, viaFromEvent, type DeviceSnapshot } from "./gamepad";
import { Hint, PadGlyph } from "./glyph";

const TABS: { id: ShopCategory | "loadout"; label: string }[] = [
  { id: "loadout", label: "Loadout" },
  { id: "equipment", label: "Equipment" },
  { id: "perk", label: "Perks" },
  { id: "squad", label: "Squad" },
];

function Bars({ s }: { s: NonNullable<ShopItem["stats"]> }) {
  const rows: [string, number][] = [
    ["DMG", s.damage],
    ["RPM", s.rate],
    ["RNG", s.range],
    ["CTRL", s.control],
    ["MOB", s.mobility],
  ];
  return (
    <div className="mt-2 grid gap-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-[10px]">
          <span className="w-8 text-neutral-500">{k}</span>
          <div className="h-1 flex-1 rounded bg-white/10">
            <div className="h-full rounded bg-amber-300/80" style={{ width: `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * Between-wave armory. The engine is paused (pointer unlocked) while open.
 * Gamepad: d-pad/stick to move, A buy, LB/RB tabs, B back to the fight, Y ready up.
 */
export function ShopOverlay({ mode, dev, onResume }: { mode: SurvivalGameMode; dev: DeviceSnapshot; onResume: (ready: boolean, via?: "pad") => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ShopView>(() => mode.shopView());
  const [tab, setTab] = useState<ShopCategory | "loadout">("loadout");
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const buy = useCallback(
    (id: string) => {
      const r = mode.buy(id);
      setToast({ text: r.message, ok: r.ok });
      setView(mode.shopView());
    },
    [mode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Holding the F that opened the armory must not instantly close it.
      if (e.repeat) return;
      if (e.code === "KeyF" || e.code === "KeyB") onResume(false);
      if (e.code === "KeyN") onResume(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResume]);

  useGamepadNav(rootRef, {
    onBack: () => onResume(false, "pad"),
    onStart: () => onResume(false, "pad"),
    onY: () => onResume(true, "pad"),
    onTab: (dir) => {
      const i = TABS.findIndex((t) => t.id === tab);
      setTab(TABS[(i + dir + TABS.length) % TABS.length].id);
    },
  });

  const items = view.items.filter((i) => (tab === "loadout" ? i.category === "primary" || i.category === "secondary" : i.category === tab));

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex animate-in items-center justify-center overflow-y-auto bg-black/60 px-4 py-6 backdrop-blur-sm duration-200 fade-in">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="w-full max-w-4xl animate-in rounded-xl border border-white/10 bg-neutral-950/95 p-5 text-neutral-100 duration-300 zoom-in-[0.98] md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-emerald-400/80 uppercase">
              Armory · {mode.waves.wave > 0 ? `Wave ${mode.waves.wave} cleared` : "Pre-deployment"}
            </p>
            <h2 className="text-2xl font-black">Resupply &amp; Loadout</h2>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl font-black text-lime-300 tabular-nums">{money(view.money)}</div>
            <div className="text-xs text-neutral-500">Next wave in {Math.ceil(mode.waves.timer)}s (paused while shopping)</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {dev.device === "pad" && <PadGlyph btn="LB" layout={dev.layout} className="mr-1" />}
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                tab === t.id ? "border-amber-400/70 bg-amber-400/15 text-amber-200" : "border-white/10 text-neutral-300 hover:border-white/25",
              )}
            >
              {t.label}
            </button>
          ))}
          {dev.device === "pad" && <PadGlyph btn="RB" layout={dev.layout} className="ml-1" />}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const afford = view.money >= it.price;
            const disabled = it.status !== "available" || !afford;
            const label =
              it.status === "equipped" ? "Equipped" : it.status === "owned" ? "Owned" : it.status === "maxed" ? "Full" : `Buy · ${money(it.price)}`;
            return (
              <div
                key={it.id}
                className={cn(
                  "flex flex-col rounded-lg border p-3",
                  it.status === "equipped" ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-white/[0.02]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{it.name}</span>
                  {it.kind && <span className="text-[10px] tracking-wider text-neutral-500 uppercase">{it.kind}</span>}
                </div>
                <p className="mt-0.5 text-xs text-neutral-400">{it.desc}</p>
                {it.stats && <Bars s={it.stats} />}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => buy(it.id)}
                  className={cn(buttonVariants({ size: "sm", variant: disabled ? "outline" : "default" }), "mt-3")}
                >
                  {label}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={(e) => onResume(false, viaFromEvent(e))} className={cn(buttonVariants({ size: "lg" }), "h-11 flex-1 gap-2")}>
            Back to the fight {dev.device === "pad" ? <PadGlyph btn="B" layout={dev.layout} /> : <span className="font-mono text-xs opacity-60">[F]</span>}
          </button>
          <button
            type="button"
            onClick={(e) => onResume(true, viaFromEvent(e))}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 flex-1 gap-2")}
          >
            Ready up — start next wave {dev.device === "pad" ? <PadGlyph btn="Y" layout={dev.layout} /> : <span className="font-mono text-xs opacity-60">[N]</span>}
          </button>
        </div>
        {dev.device === "pad" && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            <Hint dev={dev} pad="A" label="Buy" />
            <Hint dev={dev} pad="B" label="Back" />
            <Hint dev={dev} pad="Y" label="Ready up" />
          </div>
        )}
        {toast && <p className={cn("mt-3 text-sm", toast.ok ? "text-emerald-400" : "text-red-400")}>{toast.text}</p>}
      </div>
    </div>
  );
}
