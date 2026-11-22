"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import type { SurvivalGameMode } from "@/game/survival/SurvivalGameMode";
import type { ShopCategory, ShopItem, ShopView } from "@/game/survival/ShopSystem";
import { PAD_FOCUS_CSS, useGamepadNav, viaFromEvent, type DeviceSnapshot } from "./gamepad";
import { Hint, PadGlyph } from "./glyph";

type Tab = ShopCategory | "loadout";

const TABS: { id: Tab; label: string }[] = [
  { id: "loadout", label: "Loadout" },
  { id: "upgrade", label: "Upgrades" },
  { id: "equipment", label: "Equipment" },
  { id: "perk", label: "Perks" },
  { id: "squad", label: "Squad" },
];

/**
 * Short viewports (landscape phones): tighter padding and a slimmer header
 * so the header, tabs and footer leave room for the scrolling cards
 * (the `[@media(max-height:540px)]:` classes below).
 */

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
            <div className="h-full rounded bg-white/80" style={{ width: `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function Pips({ tier, max }: { tier: number; max: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Tier ${tier} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-5 rounded-sm", i < tier ? "bg-white/90" : "bg-white/15")} />
      ))}
    </div>
  );
}

function UpgradeCard({ it, funds, onBuy }: { it: ShopItem; funds: number; onBuy: (id: string) => void }) {
  const u = it.upgrade!;
  const maxed = it.status === "maxed";
  const disabled = maxed || funds < it.price;
  return (
    <div className={cn("flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-3", "[@media(max-height:540px)]:p-2.5")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{it.name}</span>
        <span className="font-mono text-[10px] text-neutral-500">
          Tier {u.tier}/{u.max}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-400">{it.desc}</p>
      <div className="mt-2">
        <Pips tier={u.tier} max={u.max} />
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-neutral-200 tabular-nums">{u.effect}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onBuy(it.id)}
        className={cn(buttonVariants({ size: "sm", variant: disabled ? "outline" : "default" }), "mt-2.5")}
      >
        {maxed ? "Maxed" : `Upgrade · ${money(it.price)}`}
      </button>
    </div>
  );
}

/**
 * Between-wave armory. The engine is paused (pointer unlocked) while open.
 * Gamepad: d-pad/stick to move, A buy, LB/RB tabs, B back to the fight, Y ready up.
 *
 * Layout: the panel is capped to the safe-area viewport; the header (money,
 * tabs) and footer (resume buttons) stay put and only the cards scroll.
 */
export function ShopOverlay({ mode, dev, onResume }: { mode: SurvivalGameMode; dev: DeviceSnapshot; onResume: (ready: boolean, via?: "pad") => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ShopView>(() => mode.shopView());
  const [tab, setTabState] = useState<Tab>("loadout");
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

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
  const upgradeGroups = (["primary", "secondary"] as const).map((slot) => {
    const list = view.items.filter((i) => i.category === "upgrade" && i.upgrade?.slot === slot);
    return { slot, weapon: list[0]?.upgrade?.weapon ?? "", list };
  });

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20 flex animate-in justify-center bg-black/60 backdrop-blur-sm duration-200 fade-in"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)",
        paddingLeft: "max(env(safe-area-inset-left, 0px), 12px)",
        paddingRight: "max(env(safe-area-inset-right, 0px), 12px)",
      }}
    >
      <style>{PAD_FOCUS_CSS}</style>
      <div
        data-armory-panel=""
        className="flex max-h-full w-full max-w-4xl animate-in flex-col self-center overflow-hidden rounded-xl border border-white/10 bg-neutral-950/95 text-neutral-100 duration-300 zoom-in-[0.98]"
      >
        <div className={cn("shrink-0 border-b border-white/10 px-4 pt-4 pb-3 md:px-6 md:pt-5", "[@media(max-height:540px)]:px-3 [@media(max-height:540px)]:pt-2 [@media(max-height:540px)]:pb-2")}>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("truncate font-mono text-[10px] tracking-[0.2em] text-white/80 uppercase sm:text-[11px] sm:tracking-[0.3em]", "[@media(max-height:540px)]:text-[10px]")}>
                Armory · {mode.waves.wave > 0 ? `Wave ${mode.waves.wave} cleared` : "Pre-deployment"}
              </p>
              <h2 className={cn("truncate text-lg font-black sm:text-2xl", "[@media(max-height:540px)]:hidden")}>Resupply &amp; Loadout</h2>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn("font-mono text-2xl font-black text-white/90 tabular-nums sm:text-3xl", "[@media(max-height:540px)]:text-xl")}>{money(view.money)}</div>
              <div className={cn("hidden text-xs text-neutral-500 sm:block", "[@media(max-height:540px)]:hidden")}>Next wave in {Math.ceil(mode.waves.timer)}s (paused while shopping)</div>
            </div>
          </div>

          <div className={cn("-mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5", "[@media(max-height:540px)]:mt-2")}>
            {dev.device === "pad" && <PadGlyph btn="LB" layout={dev.layout} className="mr-1 shrink-0" />}
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-sm whitespace-nowrap",
                  "[@media(max-height:540px)]:py-1",
                  tab === t.id ? "border-white/70 bg-white/15 text-white" : "border-white/10 text-neutral-300 hover:border-white/25",
                )}
              >
                {t.label}
              </button>
            ))}
            {dev.device === "pad" && <PadGlyph btn="RB" layout={dev.layout} className="ml-1 shrink-0" />}
          </div>
        </div>

        <div ref={scrollRef} data-armory-scroll="" className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-6 md:py-4", "[@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-2")}>
          {tab === "upgrade" ? (
            <div className="grid gap-4">
              <p className="text-xs text-neutral-400">
                Upgrades stay with the gun for the rest of the run. Swap to another gun and they are kept for when you buy it back.
              </p>
              {upgradeGroups.map((g) => (
                <section key={g.slot}>
                  <h3 className="mb-2 text-[11px] tracking-[0.2em] text-neutral-500 uppercase">
                    {g.slot} · <span className="text-neutral-200">{g.weapon}</span>
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {g.list.map((it) => (
                      <UpgradeCard key={it.id} it={it} funds={view.money} onBuy={buy} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => {
                const afford = view.money >= it.price;
                const equipped = it.status === "equipped";
                const disabled = !equipped && (it.status !== "available" || !afford);
                const label = equipped ? "Equipped · Upgrade" : it.status === "owned" ? "Owned" : it.status === "maxed" ? "Full" : `Buy · ${money(it.price)}`;
                return (
                  <div
                    key={it.id}
                    className={cn("flex flex-col rounded-lg border p-3", "[@media(max-height:540px)]:p-2.5", equipped ? "border-white/50 bg-white/5" : "border-white/10 bg-white/[0.02]")}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{it.name}</span>
                      <span className="flex items-baseline gap-2">
                        {it.upgrades ? <span className="font-mono text-[10px] text-white/80">+{it.upgrades} UPG</span> : null}
                        {it.kind && <span className="text-[10px] tracking-wider text-neutral-500 uppercase">{it.kind}</span>}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-400">{it.desc}</p>
                    {it.stats && <Bars s={it.stats} />}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => (equipped ? setTab("upgrade") : buy(it.id))}
                      className={cn(buttonVariants({ size: "sm", variant: disabled || equipped ? "outline" : "default" }), "mt-3")}
                    >
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={cn("shrink-0 border-t border-white/10 px-4 py-3 md:px-6", "[@media(max-height:540px)]:px-3 [@media(max-height:540px)]:py-2")}>
          {toast && <p className={cn("mb-2 truncate text-sm", "[@media(max-height:540px)]:mb-1 [@media(max-height:540px)]:text-xs", toast.ok ? "text-white" : "text-red-400")}>{toast.text}</p>}
          <div className="flex items-center gap-2">
            <button type="button" onClick={(e) => onResume(false, viaFromEvent(e))} className={cn(buttonVariants({ size: "lg" }), "h-11 min-w-0 flex-1 gap-2", "[@media(max-height:540px)]:h-9")}>
              Back to the fight {dev.device === "pad" ? <PadGlyph btn="B" layout={dev.layout} /> : <span className="font-mono text-xs opacity-60">[F]</span>}
            </button>
            <button
              type="button"
              onClick={(e) => onResume(true, viaFromEvent(e))}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 min-w-0 flex-1 gap-2", "[@media(max-height:540px)]:h-9")}
            >
              Ready up<span className="hidden sm:inline"> — start next wave</span>{" "}
              {dev.device === "pad" ? <PadGlyph btn="Y" layout={dev.layout} /> : <span className="font-mono text-xs opacity-60">[N]</span>}
            </button>
          </div>
          {dev.device === "pad" && (
            <div className={cn("mt-2 flex flex-wrap gap-x-5 gap-y-1", "[@media(max-height:540px)]:hidden")}>
              <Hint dev={dev} pad="A" label="Buy" />
              <Hint dev={dev} pad="B" label="Back" />
              <Hint dev={dev} pad="Y" label="Ready up" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
