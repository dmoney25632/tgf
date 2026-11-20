"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, type WeaponId } from "@/game/weapons/weapons";
import { DIFFICULTY, OPERATORS, OPERATOR_IDS, type DifficultyId, type OperatorId } from "@/game/survival/config";
import { CAMPAIGN } from "@/game/missions/campaign";
import type { MissionDef, ObjectiveKind } from "@/game/missions/types";
import { MAPS } from "@/game/world/maps/registry";
import { PAD_FOCUS_CSS, useGamepadNav } from "@/components/game/gamepad";

export type MissionPick = {
  mission: string;
  operator: OperatorId;
  primary: WeaponId;
  secondary: WeaponId;
  difficulty: DifficultyId;
  squad: number;
};

export type MissionRecords = Record<string, { grade: string; score: number }>;

const KIND_LABEL: Record<ObjectiveKind, string> = {
  reach: "Move",
  defend: "Defend",
  destroy: "Demolish",
  escort: "Rescue",
  eliminate: "Eliminate",
  extract: "Extract",
};

const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-md border px-3 py-1.5 text-sm transition-colors",
      active ? "border-white/70 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/25",
    )}
  >
    {children}
  </button>
);

const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">{children}</p>;

function MissionCard({ m, active, record, onPick }: { m: MissionDef; active: boolean; record?: { grade: string; score: number }; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-colors",
        active ? "border-white/60 bg-white/[0.07]" : "border-white/10 bg-white/[0.02] hover:border-white/25",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.25em] text-white/80 uppercase">
          Mission {m.index} · {m.codename}
        </span>
        {record && (
          <span className="rounded border border-white/30 px-1.5 font-mono text-xs text-white/90" title={`Best score ${record.score.toLocaleString("en-US")}`}>
            {record.grade}
          </span>
        )}
      </div>
      <div className="mt-1 text-xl font-black tracking-tight">{m.title}</div>
      <div className="mt-0.5 text-xs text-neutral-400">
        {m.location} · {m.time}
      </div>
    </button>
  );
}

/** Campaign screen: pick a mission, operator, loadout, difficulty and squad. */
export function MissionSelect({
  callsign,
  initial,
  records,
  onDeploy,
}: {
  callsign: string;
  initial: MissionPick;
  records: MissionRecords;
  onDeploy: (p: MissionPick) => void;
}) {
  const [p, setP] = useState<MissionPick>(initial);
  const set = (patch: Partial<MissionPick>) => setP((x) => ({ ...x, ...patch }));
  const m = CAMPAIGN.find((x) => x.id === p.mission) ?? CAMPAIGN[0];
  const mapName = MAPS.find((x) => x.id === m.mapId)?.name ?? m.mapId;
  const rootRef = useRef<HTMLDivElement>(null);
  useGamepadNav(rootRef, { onStart: () => onDeploy({ ...p, mission: m.id }) });
  const pickOperator = (id: OperatorId) => set({ operator: id, primary: OPERATORS[id].primary, secondary: OPERATORS[id].secondary });

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,.07)_0%,transparent_60%)] text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <p className="font-mono text-[11px] tracking-[0.3em] text-white/80 uppercase">Iron Horizon · Campaign · Sarrow Basin</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">Meridian Response Group</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Team <span className="text-white/90">Vantage</span>, operator <span className="text-white/90">{callsign}</span>. Three operations against the Ashen Front. Play solo with
          AI squadmates Kestrel and Halden; checkpoints at every objective.
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {CAMPAIGN.map((x) => (
              <MissionCard key={x.id} m={x} active={x.id === m.id} record={records[x.id]} onPick={() => set({ mission: x.id })} />
            ))}
          </div>

          <section className="rounded-xl border border-white/10 bg-black/30 p-5">
            <p className="font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">
              {mapName} · par {Math.floor(m.par / 60)}:{String(m.par % 60).padStart(2, "0")}
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">{m.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">{m.briefing}</p>

            <ol className="mt-4 grid gap-1.5 text-sm">
              {m.objectives.map((o, i) => (
                <li key={i} className="flex gap-3 rounded border border-white/5 bg-white/[0.02] px-3 py-1.5">
                  <span className="w-20 shrink-0 font-mono text-[11px] tracking-widest text-white/80 uppercase">
                    {i + 1}. {KIND_LABEL[o.kind]}
                  </span>
                  <span className="text-neutral-300">{o.title.charAt(0) + o.title.slice(1).toLowerCase()}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Operator</Label>
                <div className="flex flex-wrap gap-1.5">
                  {OPERATOR_IDS.map((id) => (
                    <Pill key={id} active={p.operator === id} onClick={() => pickOperator(id)}>
                      {OPERATORS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <Label>Difficulty</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(DIFFICULTY) as DifficultyId[]).map((id) => (
                    <Pill key={id} active={p.difficulty === id} onClick={() => set({ difficulty: id })}>
                      {DIFFICULTY[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <Label>Primary</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIMARY_IDS.map((id) => (
                    <Pill key={id} active={p.primary === id} onClick={() => set({ primary: id })}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <Label>Sidearm</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SECONDARY_IDS.map((id) => (
                    <Pill key={id} active={p.secondary === id} onClick={() => set({ secondary: id })}>
                      {WEAPONS[id].name}
                    </Pill>
                  ))}
                </div>
              </div>
              <div>
                <Label>AI squad</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 1, 2].map((n) => (
                    <Pill key={n} active={p.squad === n} onClick={() => set({ squad: n })}>
                      {n === 0 ? "Solo" : n === 1 ? "Kestrel" : "Kestrel + Halden"}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                data-nav-default
                onClick={() => onDeploy({ ...p, mission: m.id })}
                className={cn(buttonVariants({ size: "lg" }), "h-12 flex-1 text-base font-bold tracking-wide")}
              >
                Deploy — {m.title}
              </button>
              <Link href="/play/iron-horizon" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12")}>
                Survival
              </Link>
              <Link href="/play/iron-horizon" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-12")}>
                Lobby
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
