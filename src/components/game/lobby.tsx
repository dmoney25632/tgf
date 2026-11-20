"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, type WeaponId } from "@/game/weapons/weapons";
import { DIFFICULTY, OPERATORS, OPERATOR_IDS, type DifficultyId, type OperatorId, type WaveTarget } from "@/game/survival/config";
import { detectQuality } from "@/game/config";
import { mobileDefaultQuality } from "@/game/mobile/device";
import { loadSettings, saveSettings, type GameSettings } from "@/game/ui/Settings";
import { OperatorPreview } from "./operator-preview";
import { prefetchGameEngine } from "./prefetch-engine";
import { SURVIVAL_MAPS } from "@/game/world/maps/registry";
import { PAD_FOCUS_CSS, useGamepadNav, useInputDevice } from "./gamepad";
import { PadGlyph } from "./glyph";
import { SettingsPanel, type SettingsTab } from "./settings-panel";
import { uiSound } from "./ui-sound";
import { normalizeRoomCode } from "@/game/net/transport";
import { getLobbyData, type BoardRow, type LobbyData } from "@/app/play/[gameId]/lobby-data";

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

/** Backdrop art per map (monochrome with a hint of each map's palette). */
const MAP_ART: Record<string, string> = {
  "dustfall-outpost": "radial-gradient(ellipse at 75% 20%, rgba(220,226,232,.35), transparent 60%), linear-gradient(160deg, #3a3d40, #121314 70%)",
  "cinder-flats": "radial-gradient(ellipse at 80% 15%, rgba(255,196,120,.38), transparent 55%), linear-gradient(160deg, #5a4026, #140e09 75%)",
  "saltpan-gantry": "radial-gradient(ellipse at 70% 10%, rgba(255,232,180,.42), transparent 55%), linear-gradient(165deg, #7a6440, #1a140c 75%)",
  brennhollow: "radial-gradient(ellipse at 25% 15%, rgba(200,222,190,.32), transparent 55%), linear-gradient(160deg, #3c4a38, #0f130e 75%)",
};
const artFor = (id: string) => MAP_ART[id] ?? "linear-gradient(160deg,#333,#0b0b0b)";

const sfxClick = () => uiSound("click");
const sfxHover = () => uiSound("hover");

const Pill = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
  <button
    type="button"
    title={title}
    onMouseEnter={sfxHover}
    onClick={() => {
      sfxClick();
      onClick();
    }}
    className={cn(
      "rounded-md border px-3 py-1.5 text-sm transition-all duration-150",
      active ? "border-white/80 bg-white text-black shadow-[0_0_18px_rgba(255,255,255,.25)]" : "border-white/10 bg-white/[0.04] text-neutral-300 hover:border-white/35 hover:bg-white/[0.08]",
    )}
  >
    {children}
  </button>
);

const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("mb-2 font-mono text-[11px] tracking-[0.28em] text-neutral-500 uppercase", className)}>{children}</p>
);

const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <section className={cn("rounded-2xl border border-white/10 bg-black/55 p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,.9)] backdrop-blur-md", className)}>{children}</section>
);

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-neutral-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-white/85 transition-[width] duration-300" style={{ width: `${Math.round(Math.max(0.04, Math.min(1, value)) * 100)}%` }} />
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
      <Label>{title}</Label>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Pill key={id} active={value === id} onClick={() => onChange(id)}>
            {WEAPONS[id].name}
          </Pill>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
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
    <Panel className="border-white/20 bg-gradient-to-br from-white/[0.08] to-black/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-white/70">Squad up</Label>
          <h3 className="text-xl font-black tracking-tight">Play with friends</h3>
          <p className="mt-1 text-sm text-neutral-400">Create a party and share the code, or jump into a friend&apos;s. Everyone waits together until the host launches.</p>
        </div>
        <span className="hidden rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] text-neutral-300 uppercase sm:inline">2–4 players</span>
      </div>
      {notice && <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{notice}</p>}
      {party.unavailable ? (
        <p className="mt-3 text-xs text-neutral-500">{party.unavailable}</p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr]">
          <button
            type="button"
            onMouseEnter={sfxHover}
            onClick={() => {
              uiSound("select");
              party.onCreate(choice);
            }}
            className={cn(buttonVariants({ size: "lg" }), "h-11 font-bold")}
          >
            Create party
          </button>
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = normalizeRoomCode(code);
              if (!n) {
                uiSound("error");
                return setErr("Party codes are 5 letters/digits, like K7QX2.");
              }
              setErr(null);
              uiSound("select");
              party.onJoin(n, choice);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={7}
              placeholder="CODE"
              aria-label="Party code"
              className="h-11 w-full min-w-0 flex-1 rounded-md border border-white/15 bg-black/50 px-3 font-mono text-lg tracking-[0.3em] uppercase outline-none focus:border-white/60"
            />
            <button type="submit" onMouseEnter={sfxHover} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11")}>
              Join
            </button>
          </form>
          {err && <p className="text-xs text-red-300 sm:col-span-2">{err}</p>}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------
// World leaderboard, service record, goals
// ---------------------------------------------------------------------------------

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-US");
const MEDAL = ["text-yellow-200", "text-neutral-200", "text-orange-300"];

function useLobbyData() {
  const [data, setData] = useState<LobbyData | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    getLobbyData()
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);
  return { data, loading, refresh };
}

function WorldBoard({ data, loading, refresh, callsign }: { data: LobbyData | null; loading: boolean; refresh: () => void; callsign: string }) {
  const [tab, setTab] = useState<"waves" | "kills">("waves");
  const rows = (tab === "waves" ? data?.waves : data?.kills) ?? [];
  const value = (r: BoardRow) => (tab === "waves" ? `W${r.best_wave}` : fmt(r.kills));
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="mb-1">World leaderboard</Label>
          <p className="text-xs text-neutral-500">{data?.players ? `${fmt(data.players)} operators ranked` : "Top operators worldwide"}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            sfxClick();
            refresh();
          }}
          title="Refresh"
          className={cn("rounded-md border border-white/10 px-2 py-1 font-mono text-xs text-neutral-400 hover:border-white/30 hover:text-white", loading && "animate-pulse")}
        >
          ↻
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1 text-xs">
        {(["waves", "kills"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onMouseEnter={sfxHover}
            onClick={() => {
              sfxClick();
              setTab(t);
            }}
            className={cn("rounded-md py-1.5 font-semibold tracking-wide transition-colors", tab === t ? "bg-white text-black" : "text-neutral-400 hover:text-white")}
          >
            {t === "waves" ? "Furthest wave" : "Most kills"}
          </button>
        ))}
      </div>
      <ol className="mt-3 grid gap-1">
        {rows.length === 0 && <li className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-xs text-neutral-500">{loading ? "Loading…" : "No runs yet — be the first on the board."}</li>}
        {rows.map((r, i) => {
          const you = r.callsign === callsign;
          return (
            <li
              key={r.callsign}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                you ? "bg-white/15 ring-1 ring-white/40" : i < 3 ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
              )}
            >
              <span className={cn("w-5 font-mono text-xs tabular-nums", MEDAL[i] ?? "text-neutral-500")}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {r.callsign}
                {you && <span className="ml-1.5 text-[10px] font-normal text-neutral-400">YOU</span>}
              </span>
              <span className="font-mono text-sm font-bold tabular-nums">{value(r)}</span>
            </li>
          );
        })}
      </ol>
      <Link href={tab === "waves" ? "/leaderboard" : "/leaderboard?tab=lifetime"} onClick={sfxClick} className="mt-3 block text-center text-xs text-neutral-400 underline-offset-4 hover:text-white hover:underline">
        Full leaderboard & lifetime stats →
      </Link>
    </Panel>
  );
}

function nextMilestone(v: number, steps: number[]) {
  for (const s of steps) if (v < s) return s;
  const last = steps[steps.length - 1];
  return Math.ceil((v + 1) / last) * last;
}

function Goal({ title, detail, value, target }: { title: string; detail: string; value: number; target: number }) {
  const pct = Math.max(0, Math.min(1, target > 0 ? value / target : 1));
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="font-mono text-[11px] text-neutral-400 tabular-nums">
          {fmt(Math.min(value, target))}/{fmt(target)}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">{detail}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-gradient-to-r from-white/60 to-white transition-[width] duration-500" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  );
}

function ServiceRecord({ data, callsign }: { data: LobbyData | null; callsign: string }) {
  const me = data?.me;
  const best = me?.best_wave ?? 0;
  const waveGoal = nextMilestone(best, [5, 10, 15, 20, 25, 30, 40, 50]);
  const stat = (label: string, v: string) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">{label}</p>
      <p className="text-lg font-black tabular-nums">{v}</p>
    </div>
  );
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="mb-1">Service record</Label>
          <p className="truncate text-xl font-black tracking-tight">{callsign}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <span className="rounded-md border border-white/20 bg-white/[0.06] px-2 py-1 text-center">
            <span className="block font-mono text-[9px] tracking-[0.2em] text-neutral-400 uppercase">Wave rank</span>
            <span className="text-sm font-black">{data?.waveRank ? `#${data.waveRank}` : "—"}</span>
          </span>
          <span className="rounded-md border border-white/20 bg-white/[0.06] px-2 py-1 text-center">
            <span className="block font-mono text-[9px] tracking-[0.2em] text-neutral-400 uppercase">Kill rank</span>
            <span className="text-sm font-black">{data?.killRank ? `#${data.killRank}` : "—"}</span>
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {stat("Best wave", best ? String(best) : "—")}
        {stat("Kills", fmt(me?.kills ?? 0))}
        {stat("K/D", me ? (me.kills / Math.max(1, me.deaths)).toFixed(2) : "—")}
        {stat("Accuracy", me ? `${Number(me.accuracy).toFixed(0)}%` : "—")}
        {stat("Headshots", fmt(me?.headshots ?? 0))}
        {stat("Matches", fmt(me?.matches ?? 0))}
      </div>
      <Label className="mt-5">Next goals</Label>
      <div className="grid gap-2">
        <Goal title={`Survive to wave ${waveGoal}`} detail={best ? `Your best is wave ${best}.` : "Clear your first waves in Survival."} value={best} target={waveGoal} />
        {data?.nextUp ? (
          <Goal
            title={`Pass ${data.nextUp.callsign}`}
            detail={`Reach wave ${data.nextUp.best_wave + 1} to climb to #${Math.max(1, (data.waveRank ?? data.players + 1) - 1)}.`}
            value={best}
            target={data.nextUp.best_wave + 1}
          />
        ) : best > 0 ? (
          <Goal title="Hold #1" detail="You lead the world. Push further to stay out of reach." value={1} target={1} />
        ) : null}
        <Goal title="Marksman" detail="Lifetime headshots" value={me?.headshots ?? 0} target={nextMilestone(me?.headshots ?? 0, [25, 100, 250, 500, 1000])} />
        <Goal title="Centurion" detail="Lifetime kills" value={me?.kills ?? 0} target={nextMilestone(me?.kills ?? 0, [100, 500, 1000, 2500, 5000])} />
      </div>
    </Panel>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const dev = useInputDevice();
  const [tab, setTab] = useState<SettingsTab>("mouse");
  const [s, setS] = useState<GameSettings>(() => loadSettings(mobileDefaultQuality() ?? detectQuality()));
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950/95 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black">Settings</h2>
          <button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Done
          </button>
        </div>
        <SettingsPanel
          settings={s}
          dev={dev}
          tab={tab}
          onTab={(t) => {
            sfxClick();
            setTab(t);
          }}
          onChange={(patch) => {
            setS((prev) => {
              const next = { ...prev, ...patch };
              saveSettings(next);
              return next;
            });
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------------

/** Home screen after sign-in: mode, map, party, operator + loadout, world leaderboard, goals. */
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const set = (patch: Partial<LobbyChoice>) => setC((p) => ({ ...p, ...patch }));
  const op = OPERATORS[c.operator];
  const survival = c.mode === "survival";
  const map = SURVIVAL_MAPS.find((m) => m.id === c.map) ?? SURVIVAL_MAPS[0];
  const board = useLobbyData();

  const rootRef = useRef<HTMLDivElement>(null);
  const dev = useInputDevice();
  const deploy = () => {
    uiSound("deploy");
    onDeploy(c);
  };
  useGamepadNav(rootRef, { onStart: deploy }, !settingsOpen);
  useEffect(() => prefetchGameEngine(), []);

  const pickOperator = (id: OperatorId) => set({ operator: id, primary: OPERATORS[id].primary, secondary: OPERATORS[id].secondary });
  const summary = survival
    ? `${map.name} · ${DIFFICULTY[c.difficulty].name} · ${c.waveTarget === 0 ? "Endless" : `${c.waveTarget} waves`}${c.squad ? ` · +${c.squad} bots` : " · Solo"}`
    : "Kestrel Yard · Free practice";

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      {/* Atmosphere: the selected map's palette washes the background. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 opacity-60 transition-[background] duration-700" style={{ background: survival ? artFor(map.id) : artFor("dustfall-outpost") }} />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 bg-[linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.85)_55%,#000)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className="relative mx-auto max-w-7xl px-4 pt-5 pb-32 md:px-8">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md border border-white/30 bg-white/10 font-mono text-xs font-black tracking-tighter">IH</span>
            <div>
              <p className="text-lg leading-none font-black tracking-[0.18em] uppercase">Iron Horizon</p>
              <p className="mt-1 font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">Operator {callsign}</p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5">
            <Link href="/leaderboard" onClick={sfxClick} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Leaderboard
            </Link>
            <Link href="/account" onClick={sfxClick} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Account
            </Link>
            <button
              type="button"
              onMouseEnter={sfxHover}
              onClick={() => {
                sfxClick();
                setSettingsOpen(true);
              }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Settings
            </button>
          </nav>
        </header>

        {/* Mode select */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["survival", "Survival", "Hold the line against escalating waves. Solo with AI squadmates or in a party of up to four. Every wave you clear counts toward the world leaderboard."],
              ["range", "Firing Range", "Dial in your sensitivity and zero every weapon on pop-up targets and steel out to 70 m. No pressure, no timer."],
            ] as const
          ).map(([id, title, text]) => {
            const active = c.mode === id;
            return (
              <button
                key={id}
                type="button"
                onMouseEnter={sfxHover}
                onClick={() => {
                  uiSound("select");
                  set({ mode: id });
                }}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200",
                  active ? "border-white/80 bg-white/[0.12] shadow-[0_0_40px_-10px_rgba(255,255,255,.35)]" : "border-white/10 bg-black/50 hover:border-white/35 hover:bg-white/[0.06]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] tracking-[0.3em] text-neutral-400 uppercase">{id === "survival" ? "Ranked · Co-op" : "Training"}</span>
                  <span className={cn("h-2.5 w-2.5 rounded-full transition-colors", active ? "bg-white shadow-[0_0_10px_white]" : "bg-white/15")} />
                </div>
                <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">{title}</h2>
                <p className="mt-1.5 max-w-md text-sm text-neutral-400">{text}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          {/* Left: setup */}
          <div className="grid min-w-0 gap-6">
            {survival && (
              <Panel>
                <Label>Choose your battlefield</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SURVIVAL_MAPS.map((m) => {
                    const active = map.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onMouseEnter={sfxHover}
                        onClick={() => {
                          uiSound("select");
                          set({ map: m.id });
                        }}
                        className={cn(
                          "group relative min-h-36 overflow-hidden rounded-xl border p-4 text-left transition-all duration-200",
                          active ? "border-white/80 ring-1 ring-white/50" : "border-white/10 hover:border-white/40",
                        )}
                      >
                        <div aria-hidden className="absolute inset-0 transition-transform duration-500 group-hover:scale-105" style={{ background: artFor(m.id) }} />
                        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                        <div className="relative flex h-full flex-col justify-end">
                          {active && <span className="mb-auto self-start rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-black uppercase">Selected</span>}
                          <p className="mt-6 text-lg font-black tracking-tight">{m.name}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-300">{m.blurb}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label>Difficulty</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
                        <Pill key={d} active={c.difficulty === d} onClick={() => set({ difficulty: d })} title={DIFFICULTY[d].desc}>
                          {DIFFICULTY[d].name}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Waves</Label>
                    <div className="flex gap-1.5">
                      {([10, 20, 0] as WaveTarget[]).map((n) => (
                        <Pill key={n} active={c.waveTarget === n} onClick={() => set({ waveTarget: n })}>
                          {n === 0 ? "Endless" : n}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Squad bots</Label>
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((n) => (
                        <Pill key={n} active={c.squad === n} onClick={() => set({ squad: n })}>
                          {n === 0 ? "Solo" : `+${n}`}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Start wave</Label>
                    <div className="flex gap-1.5">
                      {[1, 4, 7, 10].map((n) => (
                        <Pill key={n} active={c.startWave === n} onClick={() => set({ startWave: n })} title={n > 1 ? "Skips ahead; starting money scales up" : undefined}>
                          {n}
                        </Pill>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-neutral-500">{DIFFICULTY[c.difficulty].desc}</p>
              </Panel>
            )}

            {survival && party && <PartyPanel party={party} choice={c} notice={notice} />}

            <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
              <Panel>
                <Label>Operator</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {OPERATOR_IDS.map((id) => {
                    const o = OPERATORS[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onMouseEnter={sfxHover}
                        onClick={() => {
                          uiSound("select");
                          pickOperator(id);
                        }}
                        className={cn(
                          "rounded-lg border p-2.5 text-left transition-all",
                          c.operator === id ? "border-white/80 bg-white/[0.14]" : "border-white/10 bg-white/[0.03] hover:border-white/30",
                        )}
                      >
                        <div className={cn("mb-1.5 h-1 w-8 rounded transition-colors", c.operator === id ? "bg-white" : "bg-white/30")} />
                        <div className="font-bold">{o.name}</div>
                        <div className="text-xs text-neutral-400">{o.role}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
                  <div className="h-64 overflow-hidden rounded-lg border border-white/5 bg-[radial-gradient(circle_at_50%_70%,rgba(255,255,255,.1),transparent_70%)]">
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
                      {(
                        [
                          ["Health", op.maxHealth],
                          ["Armor", op.startArmor],
                          ["Speed", `${Math.round(op.speed * 100)}%`],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="rounded border border-white/10 py-2">
                          <dt className="text-neutral-500">{k}</dt>
                          <dd className="text-lg font-bold">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              </Panel>

              <Panel className="grid content-start gap-5">
                <WeaponPicker title="Primary" ids={PRIMARY_IDS} value={c.primary} onChange={(id) => set({ primary: id })} />
                <WeaponPicker title="Secondary" ids={SECONDARY_IDS} value={c.secondary} onChange={(id) => set({ secondary: id })} />
                {survival && <p className="-mt-2 text-xs text-neutral-500">Your sidearm has unlimited reserve ammo in Survival. Ammo crates resupply everything — free between waves, paid mid-wave.</p>}
              </Panel>
            </div>
          </div>

          {/* Right: world + you */}
          <aside className="grid content-start gap-6">
            <ServiceRecord data={board.data} callsign={callsign} />
            <WorldBoard data={board.data} loading={board.loading} refresh={board.refresh} callsign={callsign} />
            <Link href="/credits" onClick={sfxClick} className="justify-self-center text-xs text-neutral-500 underline-offset-4 hover:text-white hover:underline">
              Credits and licenses
            </Link>
          </aside>
        </div>
      </div>

      {/* Deploy bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{survival ? "Survival" : "Firing Range"}</p>
            <p className="truncate text-sm font-semibold">
              {summary} · {op.name} · {WEAPONS[c.primary].name} / {WEAPONS[c.secondary].name}
            </p>
          </div>
          <button
            type="button"
            onMouseEnter={sfxHover}
            onClick={deploy}
            className={cn(buttonVariants({ size: "lg" }), "h-12 min-w-48 gap-2 text-base font-black tracking-[0.2em] uppercase shadow-[0_0_30px_-6px_rgba(255,255,255,.6)]")}
          >
            {survival && party ? "Play solo" : "Deploy"} {dev.device === "pad" && <PadGlyph btn="MENU" layout={dev.layout} />}
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
