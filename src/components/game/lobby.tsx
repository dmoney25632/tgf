"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, type WeaponId } from "@/game/weapons/weapons";
import { DIFFICULTY, OPERATORS, OPERATOR_IDS, type DifficultyId, type OperatorId, type WaveTarget } from "@/game/survival/config";
import { OperatorPreview } from "./operator-preview";
import { SURVIVAL_MAPS } from "@/game/world/maps/registry";
import { PAD_FOCUS_CSS, useGamepadNav, useInputDevice } from "./gamepad";
import { PadGlyph } from "./glyph";
import { normalizeRoomCode } from "@/game/net/transport";

export type LobbyChoice = {
  mode: "survival" | "range";
  operator: OperatorId;
  primary: WeaponId;
  secondary: WeaponId;
  difficulty: DifficultyId;
  waveTarget: WaveTarget;
  squad: number;
  startWave: number;
  /** Survival map id (world/maps/registry). */
  map?: string;
  /** Story mission id (game/missions/campaign); set by the missions screen. */
  mission?: string;
};

export const DEFAULT_CHOICE: LobbyChoice = {
  mode: "survival",
  operator: "ridge",
  primary: "vk7",
  secondary: "marrow9",
  difficulty: "regular",
  waveTarget: 10,
  squad: 2,
  startWave: 1,
};

const Pill = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cn(
      "rounded-md border px-3 py-1.5 text-sm transition-colors",
      active ? "border-white/70 bg-white/15 text-white" : "border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/25",
    )}
  >
    {children}
  </button>
);

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-neutral-500">{label}</span>
      <div className="h-1.5 flex-1 rounded bg-white/10">
        <div className="h-full rounded bg-white/80" style={{ width: `${Math.round(Math.max(0.04, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  );
}

export function weaponBars(id: WeaponId) {
  const d = WEAPONS[id];
  return [
    ["Damage", Math.min(1, (d.damage * d.pellets) / 160)],
    ["Fire rate", d.rpm / 950],
    ["Range", d.falloffEnd / 150],
    ["Control", 1 - (d.recoil.pattern[0][0] * d.recoil.kickScale) / 4.5],
    ["Mobility", (d.mobility - 0.8) / 0.3],
  ] as const;
}

function WeaponPicker({ ids, value, onChange, title }: { ids: WeaponId[]; value: WeaponId; onChange: (id: WeaponId) => void; title: string }) {
  const d = WEAPONS[value];
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Pill key={id} active={value === id} onClick={() => onChange(id)}>
            {WEAPONS[id].name}
          </Pill>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-semibold">{d.name}</span>
          <span className="text-xs text-neutral-500">
            {d.kind} · {d.rpm} RPM · {d.magSize} rds
          </span>
        </div>
        <div className="grid gap-1">
          {weaponBars(value).map(([k, v]) => (
            <StatBar key={k} label={k} value={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Online party hooks for Survival (create / join a squad of real players). */
export type PartyActions = {
  /** null = available; otherwise why parties are unavailable (shown instead of the buttons). */
  unavailable: string | null;
  onCreate: (c: LobbyChoice) => void;
  onJoin: (code: string, c: LobbyChoice) => void;
};

function PartyPanel({ party, choice, notice }: { party: PartyActions; choice: LobbyChoice; notice?: string | null }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-white/15 bg-white/[0.04] p-4">
      <p className="mb-1 font-mono text-[11px] tracking-[0.25em] text-neutral-400 uppercase">Play with friends</p>
      <p className="text-sm text-neutral-400">Create a party and share the code, or join a friend&apos;s party. Everyone waits in the party lobby until the host launches.</p>
      {notice && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{notice}</p>}
      {party.unavailable ? (
        <p className="mt-3 text-xs text-neutral-500">{party.unavailable}</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr]">
          <button type="button" onClick={() => party.onCreate(choice)} className={cn(buttonVariants({ size: "lg" }), "h-11 font-bold")}>
            Create party
          </button>
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = normalizeRoomCode(code);
              if (!n) return setErr("Party codes are 5 letters/digits, like K7QX2.");
              setErr(null);
              party.onJoin(n, choice);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={7}
              placeholder="CODE"
              aria-label="Party code"
              className="h-11 w-full min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-3 font-mono text-lg tracking-[0.3em] uppercase outline-none focus:border-white/60"
            />
            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11")}>
              Join
            </button>
          </form>
          {err && <p className="text-xs text-red-300 sm:col-span-2">{err}</p>}
        </div>
      )}
    </div>
  );
}

/** Pre-match lobby: mode, operator (3D preview), loadout, difficulty, squad, wave target. */
export function Lobby({
  callsign,
  initial,
  onDeploy,
  party,
  notice,
}: {
  callsign: string;
  initial: LobbyChoice;
  onDeploy: (c: LobbyChoice) => void;
  party?: PartyActions;
  notice?: string | null;
}) {
  const [c, setC] = useState<LobbyChoice>(initial);
  const set = (patch: Partial<LobbyChoice>) => setC((p) => ({ ...p, ...patch }));
  const op = OPERATORS[c.operator];
  const survival = c.mode === "survival";

  const rootRef = useRef<HTMLDivElement>(null);
  const dev = useInputDevice();
  useGamepadNav(rootRef, { onStart: () => onDeploy(c) });

  const pickOperator = (id: OperatorId) => set({ operator: id, primary: OPERATORS[id].primary, secondary: OPERATORS[id].secondary });

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,.07)_0%,transparent_60%)] text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/80 uppercase">Iron Horizon · Deployment</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">{survival ? `Survival — ${(SURVIVAL_MAPS.find((m) => m.id === c.map) ?? SURVIVAL_MAPS[0]).name}` : "Firing Range — Kestrel Yard"}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Operator <span className="text-white/90">{callsign}</span>.{" "}
              {survival ? "Hold the outpost against escalating waves. Buy gear at the armories between waves." : "Zero your weapons on pop-up targets and steel."}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Pill active={survival} onClick={() => set({ mode: "survival" })}>
              Survival
            </Pill>
            <Pill active={!survival} onClick={() => set({ mode: "range" })}>
              Firing Range
            </Pill>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Operator */}
          <section className="rounded-xl border border-white/10 bg-black/35 p-5">
            <p className="mb-3 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Operator</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OPERATOR_IDS.map((id) => {
                const o = OPERATORS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickOperator(id)}
                    className={cn(
                      "rounded-lg border p-2.5 text-left transition-colors",
                      c.operator === id ? "border-white/70 bg-white/10" : "border-white/10 bg-white/[0.03] hover:border-white/25",
                    )}
                  >
                    <div className="mb-1.5 h-1 w-8 rounded bg-white/70" />
                    <div className="font-bold">{o.name}</div>
                    <div className="text-xs text-neutral-400">{o.role}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-[220px_1fr]">
              <div className="h-72 overflow-hidden rounded-lg border border-white/5 bg-[radial-gradient(circle_at_50%_70%,rgba(255,255,255,.08),transparent_70%)]">
                <OperatorPreview operator={op} />
              </div>
              <div>
                <h2 className="text-2xl font-black">
                  {op.name} <span className="text-base font-medium text-neutral-400">· {op.role}</span>
                </h2>
                <p className="mt-1 text-sm text-neutral-300">{op.blurb}</p>
                <ul className="mt-3 grid gap-1 text-sm">
                  {op.traits.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-white">▸</span>
                      {t}
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded border border-white/10 py-2">
                    <dt className="text-neutral-500">Health</dt>
                    <dd className="text-lg font-bold">{op.maxHealth}</dd>
                  </div>
                  <div className="rounded border border-white/10 py-2">
                    <dt className="text-neutral-500">Armor</dt>
                    <dd className="text-lg font-bold">{op.startArmor}</dd>
                  </div>
                  <div className="rounded border border-white/10 py-2">
                    <dt className="text-neutral-500">Speed</dt>
                    <dd className="text-lg font-bold">{Math.round(op.speed * 100)}%</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          {/* Loadout + match */}
          <section className="grid gap-5 rounded-xl border border-white/10 bg-black/35 p-5">
            {survival && party && <PartyPanel party={party} choice={c} notice={notice} />}
            <WeaponPicker title="Primary" ids={PRIMARY_IDS} value={c.primary} onChange={(id) => set({ primary: id })} />
            <WeaponPicker title="Secondary" ids={SECONDARY_IDS} value={c.secondary} onChange={(id) => set({ secondary: id })} />
            {survival && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Map</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SURVIVAL_MAPS.map((m) => (
                      <Pill key={m.id} active={(c.map ?? SURVIVAL_MAPS[0].id) === m.id} onClick={() => set({ map: m.id })} title={m.blurb}>
                        {m.name}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500">{(SURVIVAL_MAPS.find((m) => m.id === c.map) ?? SURVIVAL_MAPS[0]).blurb}</p>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Difficulty</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
                      <Pill key={d} active={c.difficulty === d} onClick={() => set({ difficulty: d })} title={DIFFICULTY[d].desc}>
                        {DIFFICULTY[d].name}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500">{DIFFICULTY[c.difficulty].desc}</p>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Squad bots</p>
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((n) => (
                      <Pill key={n} active={c.squad === n} onClick={() => set({ squad: n })}>
                        {n === 0 ? "Solo" : `+${n}`}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-500">AI squadmates follow you, fight, and revive you.</p>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Waves</p>
                  <div className="flex gap-1.5">
                    {([10, 20, 0] as WaveTarget[]).map((n) => (
                      <Pill key={n} active={c.waveTarget === n} onClick={() => set({ waveTarget: n })}>
                        {n === 0 ? "Endless" : n}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">Starting wave</p>
                  <div className="flex gap-1.5">
                    {[1, 4, 7, 10].map((n) => (
                      <Pill key={n} active={c.startWave === n} onClick={() => set({ startWave: n })} title={n > 1 ? "Skips ahead; starting money scales up" : undefined}>
                        {n}
                      </Pill>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => onDeploy(c)} className={cn(buttonVariants({ size: "lg" }), "h-12 flex-1 gap-2 text-base font-bold tracking-wide")}>
                {survival && party ? "Play solo" : "Deploy"} {dev.device === "pad" && <PadGlyph btn="MENU" layout={dev.layout} />}
              </button>
              <Link href="/dashboard" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-12")}>
                Dashboard
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
