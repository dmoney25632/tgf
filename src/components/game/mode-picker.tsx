"use client";

import { useEffect, useState } from "react";
import { Crosshair, Flag, Globe, Shield, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DIFFICULTY, type DifficultyId, type WaveTarget } from "@/game/survival/config";
import { MAPS, SURVIVAL_MAPS, getMap } from "@/game/world/maps/registry";
import { ALL_MISSIONS, getMission } from "@/game/missions/campaign";
import { OPERATIONS } from "@/game/missions/operations";
import { COOP_MAPS, coopMission } from "@/game/net/ids";
import { uiSound } from "./ui-sound";
import { MapOverview, MapPicker, type MapChoice } from "./map-picker";

const choice = (id: string): MapChoice | null => {
  const e = MAPS.find((m) => m.id === id);
  return e ? { id: e.id, name: e.name, blurb: e.blurb, def: e.def } : null;
};

/** What the lobby's Play button starts. */
export type PlayMode =
  | { kind: "survival"; map: string; difficulty: DifficultyId; waveTarget: WaveTarget; squad: number }
  | { kind: "mission"; missionId: string; difficulty: DifficultyId; squad: number }
  | { kind: "world" }
  | { kind: "range" };

/** Solo can play everything; a party plays Survival or a co-op mission together. */
export type ModeContext = "solo" | "party";

/** Standalone operations first, then the campaign. */
const MISSIONS = [...OPERATIONS, ...ALL_MISSIONS.filter((m) => !OPERATIONS.includes(m))];

const mapName = (id: string) => SURVIVAL_MAPS.find((m) => m.id === id)?.name ?? COOP_MAPS.find((m) => m.id === id)?.name ?? id;

/** Short label for the mode card: "Survival", "Morro Azul · Veteran · 10 waves". */
export function describeMode(m: PlayMode): { title: string; detail: string } {
  switch (m.kind) {
    case "survival":
      return { title: "Survival", detail: `${mapName(m.map)} · ${DIFFICULTY[m.difficulty].name} · ${m.waveTarget === 0 ? "Endless" : `${m.waveTarget} waves`}` };
    case "mission": {
      const def = getMission(m.missionId);
      return { title: def?.title ?? "Mission", detail: `Mission · ${DIFFICULTY[m.difficulty].name}${def ? ` · ${def.location}` : ""}` };
    }
    case "world":
      return { title: "Main World", detail: "Public survival squad · players online" };
    case "range":
      return { title: "Firing Range", detail: "Practice · targets out to 70 m" };
  }
}

const TABS = [
  { kind: "survival", label: "Survival", blurb: "Hold out against waves.", icon: Shield },
  { kind: "mission", label: "Missions", blurb: "Story operations with stars.", icon: Flag },
  { kind: "world", label: "Main World", blurb: "Public squad, players online.", icon: Globe },
  { kind: "range", label: "Firing Range", blurb: "Warm up, no enemies.", icon: Crosshair },
] as const;

const Chip = ({ active, onClick, children, title, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={() => {
      uiSound("click");
      onClick();
    }}
    className={cn(
      "rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
      active ? "border-white bg-white text-black" : "border-white/15 text-neutral-200 enabled:hover:border-white/40",
    )}
  >
    {children}
  </button>
);

const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-2 font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{children}</p>;

/**
 * Full-screen mode select. Pick a tab (Survival / Missions / Main World /
 * Range), tune it, Confirm. In a party only modes the squad can play
 * together are offered.
 */
export function ModePicker({
  value,
  context,
  onConfirm,
  onClose,
  onBriefing,
  worldUnavailable,
}: {
  value: PlayMode;
  context: ModeContext;
  onConfirm: (m: PlayMode) => void;
  onClose: () => void;
  /** Solo: open a mission's full briefing screen. */
  onBriefing?: (missionId: string) => void;
  /** Why Main World can't be picked (signed out), or null. */
  worldUnavailable?: string | null;
}) {
  const party = context === "party";
  const maps = (party ? COOP_MAPS.map((m) => m.id) : SURVIVAL_MAPS.map((m) => m.id)).map(choice).filter((m): m is MapChoice => m !== null);
  const missions = party ? MISSIONS.filter((m) => coopMission(m.id)) : MISSIONS;

  // Per-tab drafts so switching tabs keeps each tab's picks.
  const [tab, setTab] = useState<PlayMode["kind"]>(value.kind);
  const base = value.kind === "survival" || value.kind === "mission" ? value : null;
  const [surv, setSurv] = useState<Extract<PlayMode, { kind: "survival" }>>(
    value.kind === "survival" && maps.some((m) => m.id === value.map)
      ? value
      : { kind: "survival", map: maps[0]?.id ?? "dustfall-outpost", difficulty: base?.difficulty ?? "regular", waveTarget: 10, squad: base?.squad ?? 2 },
  );
  const [miss, setMiss] = useState<Extract<PlayMode, { kind: "mission" }>>(
    value.kind === "mission" && missions.some((m) => m.id === value.missionId)
      ? value
      : { kind: "mission", missionId: missions[0]?.id ?? "iron-crossing", difficulty: base?.difficulty ?? "regular", squad: base?.squad ?? 2 },
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const tabs = TABS.filter((t) => !party || t.kind === "survival" || t.kind === "mission");
  const current: PlayMode = tab === "survival" ? surv : tab === "mission" ? miss : { kind: tab };
  const blocked = tab === "world" && !!worldUnavailable;
  const mdef = getMission(miss.missionId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Choose a mode"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl [@media(max-height:520px)]:overflow-y-auto border border-white/15 bg-neutral-950 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-xl font-black tracking-tight">Choose a mode</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-4">
          {tabs.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => {
                uiSound("click");
                setTab(t.kind);
              }}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition-colors",
                tab === t.kind ? "border-white bg-white text-black" : "border-white/10 text-neutral-200 hover:border-white/30",
              )}
            >
              <t.icon className="size-5" />
              <span className="text-sm font-bold">{t.label}</span>
              <span className={cn("text-xs", tab === t.kind ? "text-black/60" : "text-neutral-500")}>{t.blurb}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [@media(max-height:520px)]:flex-none [@media(max-height:520px)]:overflow-visible">
          {tab === "survival" && (
            <div className="grid gap-5">
              <div>
                <Label>Map</Label>
                <MapPicker maps={maps} value={surv.map} mode={party ? "Co-op survival" : "Survival"} onChange={(id) => setSurv((s) => ({ ...s, map: id }))} />
              </div>
              <DifficultyRow value={surv.difficulty} onChange={(d) => setSurv((s) => ({ ...s, difficulty: d }))} />
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <Label>Waves</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {([10, 20, 0] as WaveTarget[]).map((n) => (
                      <Chip key={n} active={surv.waveTarget === n} onClick={() => setSurv((s) => ({ ...s, waveTarget: n }))}>
                        {n === 0 ? "Endless" : n}
                      </Chip>
                    ))}
                  </div>
                </div>
                {!party && (
                  <div>
                    <Label>AI squadmates</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {[0, 1, 2].map((n) => (
                        <Chip key={n} active={surv.squad === n} onClick={() => setSurv((s) => ({ ...s, squad: n }))}>
                          {n === 0 ? "None" : `+${n}`}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "mission" && (
            <div className="grid gap-5">
              <div className="grid gap-2">
                {missions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      uiSound("click");
                      setMiss((s) => ({ ...s, missionId: m.id }));
                    }}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      miss.missionId === m.id ? "border-white bg-white/10" : "border-white/10 hover:border-white/30",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-bold">{m.title}</span>
                      <span className="shrink-0 font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">{m.stealth ? "Stealth" : m.codename}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-neutral-400">{m.location}</span>
                  </button>
                ))}
                {party && <p className="text-xs text-neutral-500">Escort missions are solo only.</p>}
              </div>
              <DifficultyRow value={miss.difficulty} onChange={(d) => setMiss((s) => ({ ...s, difficulty: d }))} />
              {mdef && (
                <div className="flex gap-3">
                  <MapOverview def={getMap(mdef.mapId)} className="hidden size-28 shrink-0 rounded-lg border border-white/10 sm:block" />
                  <p className="text-sm leading-relaxed text-neutral-400">{mdef.briefing}</p>
                </div>
              )}
              {!party && onBriefing && (
                <button type="button" onClick={() => onBriefing(miss.missionId)} className="justify-self-start text-sm text-neutral-300 underline-offset-4 hover:text-white hover:underline">
                  Full briefing, intel map and fastest times →
                </button>
              )}
            </div>
          )}

          {tab === "world" && (
            <p className="text-sm leading-relaxed text-neutral-300">
              {worldUnavailable ?? "Matchmakes you into a public Survival squad of up to 4 players on a random map. The squad deploys when it fills or the countdown ends."}
            </p>
          )}
          {tab === "range" && <p className="text-sm leading-relaxed text-neutral-300">Pop-up targets and steel plates out to 70 m. Try weapons and sights with no pressure.</p>}
        </div>

        <div className="border-t border-white/10 px-5 py-4">
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              uiSound("select");
              onConfirm(current);
            }}
            className="h-12 w-full rounded-xl bg-white text-base font-black tracking-wide text-black transition-transform enabled:hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm · {describeMode(current).title}
          </button>
        </div>
      </div>
    </div>
  );
}

function DifficultyRow({ value, onChange }: { value: DifficultyId; onChange: (d: DifficultyId) => void }) {
  return (
    <div>
      <Label>Difficulty</Label>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
          <Chip key={d} active={value === d} onClick={() => onChange(d)} title={DIFFICULTY[d].desc}>
            {DIFFICULTY[d].name}
          </Chip>
        ))}
      </div>
    </div>
  );
}
