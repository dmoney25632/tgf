"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Crosshair, Flag, Globe, Lock, Pencil, Settings, Trophy, User } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, type WeaponId } from "@/game/weapons/weapons";
import { DIFFICULTY, OPERATORS, type DifficultyId, type OperatorId, type WaveTarget } from "@/game/survival/config";
import type { Character, CharacterLook } from "@/game/character";
import { detectQuality } from "@/game/config";
import { mobileDefaultQuality } from "@/game/mobile/device";
import { loadSettings, saveSettings, type GameSettings } from "@/game/ui/Settings";
import { OperatorPreview } from "./operator-preview";
import { prefetchGameEngine } from "./prefetch-engine";
import { SURVIVAL_MAPS } from "@/game/world/maps/registry";
import { PAD_FOCUS_CSS, useGamepadNav, useInputDevice } from "./gamepad";
import { SettingsPanel, type SettingsTab } from "./settings-panel";
import { uiSound } from "./ui-sound";
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
  /** Saved character appearance (character page). */
  look?: CharacterLook;
};

export const DEFAULT_CHOICE: LobbyChoice = {
  mode: "survival",
  operator: "ridge",
  primary: "m4a1",
  secondary: "m9",
  difficulty: "regular",
  waveTarget: 10,
  squad: 2,
  startWave: 1,
};

const sfxClick = () => uiSound("click");
const sfxHover = () => uiSound("hover");

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

const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("mb-2 font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase", className)}>{children}</p>
);

const Chip = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
  <button
    type="button"
    title={title}
    onMouseEnter={sfxHover}
    onClick={() => {
      sfxClick();
      onClick();
    }}
    className={cn(
      "rounded-full border px-3 py-1 text-sm transition-colors",
      active ? "border-white bg-white text-black" : "border-white/10 text-neutral-300 hover:border-white/35",
    )}
  >
    {children}
  </button>
);

/** One loadout slot: weapon chips plus a single quiet stat line for the pick. */
function WeaponRow({ label, ids, value, onChange }: { label: string; ids: WeaponId[]; value: WeaponId; onChange: (id: WeaponId) => void }) {
  const d = WEAPONS[value];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <Label className="mb-0">{label}</Label>
        <span className="min-w-0 truncate text-[11px] text-neutral-500">
          {d.kind} · {d.rpm} rpm · {d.magSize} rds
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Chip key={id} active={value === id} onClick={() => onChange(id)}>
            {WEAPONS[id].name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Online hooks: Main World matchmaking and private lobbies (create / join by code). */
export type PartyActions = {
  /** null = available; otherwise why online play is unavailable. */
  unavailable: string | null;
  onWorld: (c: LobbyChoice) => void;
  onCreate: (c: LobbyChoice) => void;
  onJoin: (code: string, c: LobbyChoice) => void;
};

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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950 p-5" onClick={(e) => e.stopPropagation()}>
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

const iconBtn = "grid h-9 w-9 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-white";

/**
 * Home screen after sign-in. Deliberately minimal: your character, your
 * loadout, and three ways to play (Main World, a private lobby, or solo).
 */
export function Lobby({
  callsign,
  character,
  initial,
  onDeploy,
  party,
  notice,
  onMissions,
}: {
  callsign: string;
  character: Character;
  initial: LobbyChoice;
  onDeploy: (c: LobbyChoice) => void;
  party: PartyActions;
  notice?: string | null;
  /** Opens the missions screen (entry hook; see iron-horizon-client.tsx). */
  onMissions?: () => void;
}) {
  const [c, setC] = useState<LobbyChoice>(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soloOpen, setSoloOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const set = (patch: Partial<LobbyChoice>) => setC((p) => ({ ...p, ...patch }));
  const op = OPERATORS[character.operator];
  const map = SURVIVAL_MAPS.find((m) => m.id === c.map) ?? SURVIVAL_MAPS[0];
  const online = !party.unavailable;

  const rootRef = useRef<HTMLDivElement>(null);
  const deploySolo = (mode: LobbyChoice["mode"] = "survival") => {
    uiSound("deploy");
    onDeploy({ ...c, mode });
  };
  useGamepadNav(rootRef, { onStart: () => (online ? party.onWorld(c) : deploySolo()) }, !settingsOpen);
  useEffect(() => prefetchGameEngine(), []);

  const joinCode = (e: React.FormEvent) => {
    e.preventDefault();
    const n = normalizeRoomCode(code);
    if (!n) {
      uiSound("error");
      return setCodeErr("Codes are 5 letters/digits, like K7QX2.");
    }
    setCodeErr(null);
    uiSound("select");
    party.onJoin(n, c);
  };

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto bg-black text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,.07),transparent_60%)]" />

      <div className="relative mx-auto max-w-5xl px-4 pt-5 pb-12 md:px-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <p className="text-sm font-black tracking-[0.3em] uppercase">Iron Horizon</p>
          <nav className="flex items-center gap-1">
            <Link href="/leaderboard" onClick={sfxClick} className={iconBtn} title="Leaderboard" aria-label="Leaderboard">
              <Trophy className="size-4" />
            </Link>
            <button
              type="button"
              onClick={() => {
                sfxClick();
                setSettingsOpen(true);
              }}
              className={iconBtn}
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="size-4" />
            </button>
            <Link href="/account" onClick={sfxClick} className={iconBtn} title="Account" aria-label="Account">
              <User className="size-4" />
            </Link>
          </nav>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-12 [&>*]:min-w-0">
          {/* Character */}
          <div className="flex flex-col">
            <div className="relative aspect-[4/5] w-full max-w-sm self-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_75%,rgba(255,255,255,.09),transparent_65%)] md:max-w-none">
              <OperatorPreview look={character.look} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-2xl font-black tracking-tight">{callsign}</p>
                <p className="text-sm text-neutral-400">
                  {op.role} · {op.traits[0]}
                </p>
              </div>
              <Link
                href="/play/iron-horizon/character"
                onClick={sfxClick}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1.5 rounded-full")}
              >
                <Pencil className="size-3.5" /> Customize
              </Link>
            </div>
          </div>

          {/* Loadout + play */}
          <div className="grid min-w-0 grid-cols-1 content-start gap-8">
            <section className="grid min-w-0 gap-5">
              <WeaponRow label="Primary" ids={PRIMARY_IDS} value={c.primary} onChange={(id) => set({ primary: id })} />
              <WeaponRow label="Sidearm" ids={SECONDARY_IDS} value={c.secondary} onChange={(id) => set({ secondary: id })} />
            </section>

            <section className="grid min-w-0 grid-cols-1 gap-2.5">
              <Label className="mb-0.5">Play</Label>
              {notice && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{notice}</p>}

              {/* Main World */}
              <button
                type="button"
                disabled={!online}
                onMouseEnter={sfxHover}
                onClick={() => {
                  uiSound("select");
                  party.onWorld(c);
                }}
                className="group flex items-center gap-4 rounded-2xl bg-white px-5 py-4 text-left text-black transition-transform enabled:hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Globe className="size-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg leading-tight font-black">Main World</span>
                  <span className="block text-sm text-black/60">Drop into a public survival squad with players online.</span>
                </span>
                <span className="font-mono text-xs font-bold tracking-widest">PLAY</span>
              </button>

              {/* Missions */}
              {onMissions && (
                <button
                  type="button"
                  onMouseEnter={sfxHover}
                  onClick={() => {
                    uiSound("select");
                    onMissions();
                  }}
                  className="flex items-center gap-4 rounded-2xl border border-white/10 px-5 py-4 text-left transition-colors hover:border-white/30"
                >
                  <Flag className="size-5 shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-tight font-bold">Missions</span>
                    <span className="block text-sm text-neutral-500">Story operations, solo or co-op. Stars and fastest times.</span>
                  </span>
                  <span className="font-mono text-xs font-bold tracking-widest text-neutral-400">BRIEF</span>
                </button>
              )}

              {/* Private lobby */}
              <div className="rounded-2xl border border-white/10 px-5 py-4">
                <div className="flex items-center gap-4">
                  <Lock className="size-5 shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <p className="leading-tight font-bold">Private lobby</p>
                    <p className="text-sm text-neutral-500">Invite friends with a code. Up to 4 players.</p>
                  </div>
                  <button
                    type="button"
                    disabled={!online}
                    onMouseEnter={sfxHover}
                    onClick={() => {
                      uiSound("select");
                      party.onCreate(c);
                    }}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 rounded-full")}
                  >
                    Create
                  </button>
                </div>
                {online && (
                  <form onSubmit={joinCode} className="mt-3 flex gap-2 pl-9">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={7}
                      placeholder="ENTER CODE"
                      aria-label="Lobby code"
                      autoCapitalize="characters"
                      autoComplete="off"
                      className="h-9 min-w-0 flex-1 rounded-full border border-white/10 bg-transparent px-4 font-mono text-sm tracking-[0.25em] uppercase outline-none placeholder:text-neutral-600 focus:border-white/50"
                    />
                    <button type="submit" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full")}>
                      Join
                    </button>
                  </form>
                )}
                {codeErr && <p className="mt-2 pl-9 text-xs text-red-300">{codeErr}</p>}
              </div>
              {party.unavailable && <p className="text-xs text-neutral-500">{party.unavailable}</p>}

              {/* Solo */}
              <div className="rounded-2xl border border-white/10 px-5 py-4">
                <div className="flex items-center gap-4">
                  <Crosshair className="size-5 shrink-0 text-neutral-400" />
                  <button
                    type="button"
                    onClick={() => {
                      sfxClick();
                      setSoloOpen((o) => !o);
                    }}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={soloOpen}
                  >
                    <span className="flex items-center gap-1.5 leading-tight font-bold">
                      Solo <ChevronDown className={cn("size-4 text-neutral-500 transition-transform", soloOpen && "rotate-180")} />
                    </span>
                    <span className="block truncate text-sm text-neutral-500">
                      {map.name} · {DIFFICULTY[c.difficulty].name} · {c.waveTarget === 0 ? "Endless" : `${c.waveTarget} waves`} · {c.squad ? `+${c.squad} bots` : "no bots"}
                    </span>
                  </button>
                  <button type="button" onMouseEnter={sfxHover} onClick={() => deploySolo()} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 rounded-full")}>
                    Deploy
                  </button>
                </div>
                {soloOpen && (
                  <div className="mt-4 grid gap-4 pl-9">
                    <div>
                      <Label>Map</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {SURVIVAL_MAPS.map((m) => (
                          <Chip key={m.id} active={map.id === m.id} onClick={() => set({ map: m.id })} title={m.blurb}>
                            {m.name}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <Label>Difficulty</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(DIFFICULTY) as DifficultyId[]).map((d) => (
                            <Chip key={d} active={c.difficulty === d} onClick={() => set({ difficulty: d })} title={DIFFICULTY[d].desc}>
                              {DIFFICULTY[d].name}
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Waves</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {([10, 20, 0] as WaveTarget[]).map((n) => (
                            <Chip key={n} active={c.waveTarget === n} onClick={() => set({ waveTarget: n })}>
                              {n === 0 ? "Endless" : n}
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Bots</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {[0, 1, 2].map((n) => (
                            <Chip key={n} active={c.squad === n} onClick={() => set({ squad: n })}>
                              {n === 0 ? "None" : `+${n}`}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => deploySolo("range")}
                className="justify-self-start px-1 text-xs text-neutral-500 underline-offset-4 hover:text-white hover:underline"
              >
                Warm up on the practice range →
              </button>
            </section>
          </div>
        </div>

        <footer className="mt-12 text-center">
          <Link href="/credits" onClick={sfxClick} className="text-[11px] text-neutral-600 underline-offset-4 hover:text-neutral-300 hover:underline">
            Credits and licenses
          </Link>
        </footer>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
