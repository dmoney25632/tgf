"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapDef } from "@/game/world/MapLoader";
import { cachedOverviewUrl, overviewUrl } from "@/game/world/overview/canvas";
import { spawnSectors } from "@/game/survival/waves";
import { uiSound } from "./ui-sound";

const THUMB = 320;

/** Renders one overview at a time after paint so opening the picker never stalls. */
const queue: (() => void)[] = [];
let pumping = false;
function schedule(job: () => void) {
  queue.push(job);
  if (pumping) return;
  pumping = true;
  const next = () => {
    const j = queue.shift();
    if (!j) {
      pumping = false;
      return;
    }
    j();
    setTimeout(next, 16);
  };
  setTimeout(next, 30);
}

/** Top-down overview of a map, generated from its data on first use and cached for the session. */
export function useMapOverview(def: MapDef | undefined, size = THUMB) {
  // Bumped when a render finishes; the URL itself lives in the module cache.
  const [, setReady] = useState(0);
  const url = def ? cachedOverviewUrl(def, size) : null;
  useEffect(() => {
    if (!def || cachedOverviewUrl(def, size)) return;
    let live = true;
    schedule(() => {
      if (!live) return;
      try {
        overviewUrl(def, size);
        setReady((n) => n + 1);
      } catch {
        // Canvas unavailable: the card keeps its placeholder.
      }
    });
    return () => {
      live = false;
    };
  }, [def, size]);
  return url;
}

export function MapOverview({ def, className, size = THUMB }: { def: MapDef | undefined; className?: string; size?: number }) {
  const url = useMapOverview(def, size);
  return (
    <div className={cn("relative overflow-hidden bg-neutral-900", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated data URL, not a static asset
        <img src={url} alt={def ? `Overview of ${def.name}` : ""} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,.06),transparent_70%)]" />
      )}
    </div>
  );
}

export type MapChoice = { id: string; name: string; blurb: string; def: MapDef };

/** Facts for the card: size, armories, directions enemies come from. */
function facts(def: MapDef) {
  const s = def.survival;
  const out: string[] = [];
  const span = s ? Math.round(s.inner * 2) : def.size;
  out.push(`${span} m ${s ? "compound" : "area"}`);
  if (s) {
    out.push(`${s.buyStations.length} armor${s.buyStations.length === 1 ? "y" : "ies"}`);
    out.push(`${spawnSectors(s.enemySpawns).length} approaches`);
    if (s.perches.length) out.push(`${s.perches.length} sniper perches`);
  }
  return out;
}

/**
 * Lobby map select: a card per map with its overview (rendered from the map
 * data), name, mode and a short description of what to expect.
 */
export function MapPicker({ maps, value, mode, onChange }: { maps: MapChoice[]; value: string; mode: string; onChange: (id: string) => void }) {
  const sel = maps.find((m) => m.id === value) ?? maps[0];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Map">
        {maps.map((m) => {
          const on = m.id === sel?.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                uiSound("click");
                onChange(m.id);
              }}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-[border-color,transform] duration-150",
                on ? "border-white ring-1 ring-white" : "border-white/10 hover:-translate-y-0.5 hover:border-white/35",
              )}
            >
              <MapOverview def={m.def} className="aspect-[4/3] w-full" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] text-neutral-200 uppercase backdrop-blur-sm">{mode}</span>
              {on && (
                <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-white text-black">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 px-2.5 pb-2">
                <span className="block text-sm font-bold leading-tight text-white drop-shadow">{m.name}</span>
                <span className="block truncate text-[11px] text-neutral-300">{facts(m.def).slice(0, 2).join(" · ")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <MapOverview def={sel.def} className="hidden size-24 shrink-0 rounded-lg sm:block" />
          <div className="min-w-0">
            <p className="text-sm font-bold">
              {sel.name} <span className="ml-1 font-mono text-[10px] font-normal tracking-[0.2em] text-neutral-500 uppercase">{mode}</span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">{sel.blurb}</p>
            <p className="mt-1.5 font-mono text-[10px] tracking-[0.16em] text-neutral-500 uppercase">{facts(sel.def).join(" · ")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
