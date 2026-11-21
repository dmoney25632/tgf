"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, LogOut, Pencil, Plus, Settings, Trophy, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEAPONS, PRIMARY_IDS, SECONDARY_IDS, type WeaponId } from "@/game/weapons/weapons";
import type { CharacterLook } from "@/game/character";
import { detectQuality } from "@/game/config";
import { mobileDefaultQuality } from "@/game/mobile/device";
import { loadSettings, saveSettings, type GameSettings } from "@/game/ui/Settings";
import { normalizeRoomCode } from "@/game/net/transport";
import { OperatorPreview } from "./operator-preview";
import { PAD_FOCUS_CSS, useGamepadNav, useInputDevice } from "./gamepad";
import { SettingsPanel, type SettingsTab } from "./settings-panel";
import { uiSound } from "./ui-sound";
import { ModePicker, describeMode, type ModeContext, type PlayMode } from "./mode-picker";

const sfxClick = () => uiSound("click");
const sfxHover = () => uiSound("hover");

export type LobbyMember = { id: string; name: string; role?: string; you?: boolean; host?: boolean; ready?: boolean };

export type LobbyPrimary = { label: string; sub?: string; disabled?: boolean; onClick: () => void; muted?: boolean };

/**
 * The one lobby screen: your squad in the middle, a mode card and a single
 * big Play / Ready button bottom-right, loadout and party bottom-left.
 * Used alone (solo party of one) and inside an online party (coop-app).
 */
export function LobbyView({
  callsign,
  look,
  roleLine,
  members,
  maxPlayers,
  party,
  invite,
  mode,
  modeContext,
  modeLockedReason,
  onModeChange,
  onBriefing,
  worldUnavailable,
  primary,
  status,
  notice,
  loadout,
  onLoadout,
}: {
  callsign: string;
  look: CharacterLook;
  roleLine: string;
  /** Everyone in the party except you. */
  members: LobbyMember[];
  maxPlayers: number;
  /** In a party: its code (null for Main World), label and leave action. */
  party?: { label: string; code: string | null; inviteUrl?: string; onLeave: () => void } | null;
  /** Not in a party: start or join one. */
  invite?: { unavailable: string | null; onCreate: () => void; onJoin: (code: string) => void } | null;
  mode: PlayMode;
  modeContext: ModeContext;
  /** Non-null: the mode card is read-only (party member, Main World), with this reason. */
  modeLockedReason?: string | null;
  onModeChange?: (m: PlayMode) => void;
  onBriefing?: (missionId: string) => void;
  worldUnavailable?: string | null;
  primary: LobbyPrimary;
  /** Line under the play button (countdown, waiting for…). */
  status?: string | null;
  notice?: string | null;
  loadout: { primary: WeaponId; secondary: WeaponId };
  onLoadout: (patch: Partial<{ primary: WeaponId; secondary: WeaponId }>) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState<null | "loadout" | "invite" | "settings">(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlay = picker || sheet !== null;
  useGamepadNav(rootRef, { onStart: () => !primary.disabled && primary.onClick() }, !overlay);
  const m = describeMode(mode);
  const slots = Math.max(0, maxPlayers - 1 - members.length);

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-y-auto bg-black text-neutral-100">
      <style>{PAD_FOCUS_CSS}</style>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,255,255,.08),transparent_60%)]" />

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-5 pb-6 md:px-8">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-3">
          <p className="text-sm font-black tracking-[0.3em] uppercase">Iron Horizon</p>
          <nav className="flex items-center gap-1">
            <Link href="/credits" onClick={sfxClick} className="mr-2 hidden text-[11px] text-neutral-600 hover:text-neutral-300 sm:inline">
              Credits
            </Link>
            <Link href="/leaderboard" onClick={sfxClick} className={iconBtn} title="Leaderboard" aria-label="Leaderboard">
              <Trophy className="size-4" />
            </Link>
            <button type="button" onClick={() => (sfxClick(), setSheet("settings"))} className={iconBtn} title="Settings" aria-label="Settings">
              <Settings className="size-4" />
            </button>
            <Link href="/account" onClick={sfxClick} className={iconBtn} title="Account" aria-label="Account">
              <User className="size-4" />
            </Link>
          </nav>
        </header>

        {notice && <p className="mx-auto mt-4 w-full max-w-xl rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200">{notice}</p>}

        {/* Squad lineup: you in the middle, teammates / open slots beside you. */}
        <section className="mt-4 grid flex-1 grid-cols-1 items-center gap-4 md:grid-cols-[1fr_minmax(0,1.3fr)_1fr]" aria-label="Squad">
          <div className="order-2 grid grid-cols-3 gap-2 md:order-1 md:grid-cols-1 md:justify-items-end">
            {[0, 1, 2].slice(0, maxPlayers - 1).map((i) => (
              <Slot key={i} member={members[i]} open={!members[i] && i < members.length + slots} canInvite={!!invite} onInvite={() => (sfxClick(), setSheet("invite"))} />
            ))}
          </div>

          <div className="order-1 flex flex-col items-center md:order-2">
            <div className="relative aspect-[4/5] w-full max-w-[22rem] overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_50%_78%,rgba(255,255,255,.1),transparent_65%)]">
              <OperatorPreview look={look} />
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="text-center">
                <p className="text-2xl font-black tracking-tight">{callsign}</p>
                <p className="text-sm text-neutral-400">{roleLine}</p>
              </div>
              <Link href="/play/iron-horizon/character" onClick={sfxClick} className={cn(iconBtn, "border border-white/15")} title="Customize character" aria-label="Customize character">
                <Pencil className="size-3.5" />
              </Link>
            </div>
          </div>

          <div className="order-3 hidden md:block" />
        </section>

        {/* Bottom bar */}
        <footer className="mt-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onMouseEnter={sfxHover} onClick={() => (sfxClick(), setSheet("loadout"))} className={pillBtn}>
              <span className="font-mono text-[10px] tracking-[0.25em] text-neutral-500 uppercase">Loadout</span>
              <span className="font-semibold">
                {WEAPONS[loadout.primary].name} · {WEAPONS[loadout.secondary].name}
              </span>
            </button>
            {party ? (
              <>
                <span className={cn(pillBtn, "cursor-default")}>
                  <span className="font-mono text-[10px] tracking-[0.25em] text-neutral-500 uppercase">{party.label}</span>
                  {party.code && <span className="font-mono font-bold tracking-[0.25em]" data-testid="room-code">{party.code}</span>}
                </span>
                {party.inviteUrl && <CopyButton text={party.inviteUrl} />}
                <button type="button" onClick={() => (sfxClick(), party.onLeave())} className={cn(pillBtn, "text-neutral-400 hover:text-white")}>
                  <LogOut className="size-4" /> Leave
                </button>
              </>
            ) : invite ? (
              <button type="button" onMouseEnter={sfxHover} onClick={() => (sfxClick(), setSheet("invite"))} className={pillBtn}>
                <Plus className="size-4" /> Party up
              </button>
            ) : null}
          </div>

          <div className="grid w-full gap-2 md:w-[22rem]">
            <button
              type="button"
              onMouseEnter={sfxHover}
              disabled={!!modeLockedReason || !onModeChange}
              onClick={() => (sfxClick(), setPicker(true))}
              className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-left transition-colors enabled:hover:border-white/40 disabled:cursor-default"
              title={modeLockedReason ?? "Change mode"}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[10px] tracking-[0.25em] text-neutral-500 uppercase">Mode</span>
                <span className="block truncate text-lg leading-tight font-black">{m.title}</span>
                <span className="block truncate text-xs text-neutral-400">{m.detail}</span>
              </span>
              {!modeLockedReason && onModeChange && <ChevronRight className="size-5 shrink-0 text-neutral-400" />}
            </button>
            <button
              type="button"
              disabled={primary.disabled}
              onMouseEnter={sfxHover}
              onClick={() => {
                uiSound(primary.muted ? "click" : "deploy");
                primary.onClick();
              }}
              className={cn(
                "h-16 rounded-2xl text-2xl font-black tracking-[0.12em] uppercase transition-transform enabled:hover:scale-[1.015] disabled:cursor-not-allowed disabled:opacity-50",
                primary.muted ? "border border-white/30 bg-transparent text-white" : "bg-white text-black",
              )}
            >
              {primary.label}
            </button>
            {(status || primary.sub || modeLockedReason) && <p className="text-center text-xs text-neutral-400">{status ?? primary.sub ?? modeLockedReason}</p>}
          </div>
        </footer>
      </div>

      {picker && onModeChange && (
        <ModePicker
          value={mode}
          context={modeContext}
          worldUnavailable={worldUnavailable}
          onBriefing={onBriefing}
          onClose={() => setPicker(false)}
          onConfirm={(next) => {
            onModeChange(next);
            setPicker(false);
          }}
        />
      )}
      {sheet === "loadout" && <LoadoutSheet loadout={loadout} onChange={onLoadout} onClose={() => setSheet(null)} />}
      {sheet === "invite" && invite && (
        <InviteSheet
          {...invite}
          onClose={() => setSheet(null)}
          onCreate={() => {
            setSheet(null);
            invite.onCreate();
          }}
          onJoin={(c) => {
            setSheet(null);
            invite.onJoin(c);
          }}
        />
      )}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

const iconBtn = "grid h-9 w-9 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-white";
const pillBtn = "inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-4 text-sm transition-colors hover:border-white/40";

function Slot({ member, open, canInvite, onInvite }: { member?: LobbyMember; open: boolean; canInvite: boolean; onInvite: () => void }) {
  if (member) {
    const ready = member.host || member.ready;
    return (
      <div className="w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-3 md:w-56">
        <p className="truncate font-bold">{member.name}</p>
        <p className="truncate text-xs text-neutral-500">{member.role}</p>
        <p className={cn("mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.15em] uppercase", ready ? "bg-white text-black" : "bg-white/10 text-neutral-400")}>
          {member.host ? "Leader" : ready ? (
            <>
              <Check className="size-3" /> Ready
            </>
          ) : (
            "Not ready"
          )}
        </p>
      </div>
    );
  }
  if (!open) return null;
  return (
    <button
      type="button"
      disabled={!canInvite}
      onClick={onInvite}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-6 text-sm text-neutral-500 transition-colors enabled:hover:border-white/40 enabled:hover:text-white disabled:cursor-default md:w-56"
    >
      <Plus className="size-4" /> {canInvite ? "Invite" : "Open"}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        sfxClick();
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }).catch(() => {});
      }}
      className={pillBtn}
      title={text}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />} {done ? "Copied" : "Invite link"}
    </button>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/15 bg-neutral-950 p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={() => (sfxClick(), onClick())}
    className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", active ? "border-white bg-white text-black" : "border-white/15 text-neutral-200 hover:border-white/40")}
  >
    {children}
  </button>
);

function LoadoutSheet({ loadout, onChange, onClose }: { loadout: { primary: WeaponId; secondary: WeaponId }; onChange: (p: Partial<{ primary: WeaponId; secondary: WeaponId }>) => void; onClose: () => void }) {
  const row = (label: string, ids: WeaponId[], value: WeaponId, key: "primary" | "secondary") => {
    const d = WEAPONS[value];
    return (
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{label}</p>
          <span className="truncate text-[11px] text-neutral-500">
            {d.kind} · {d.rpm} rpm · {d.magSize} rds
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <Chip key={id} active={value === id} onClick={() => onChange({ [key]: id })}>
              {WEAPONS[id].name}
            </Chip>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Sheet title="Loadout" onClose={onClose}>
      <div className="grid gap-6">
        {row("Primary", PRIMARY_IDS, loadout.primary, "primary")}
        {row("Sidearm", SECONDARY_IDS, loadout.secondary, "secondary")}
        <button type="button" onClick={onClose} className="h-11 rounded-xl bg-white font-bold text-black">
          Done
        </button>
      </div>
    </Sheet>
  );
}

function InviteSheet({ unavailable, onCreate, onJoin, onClose }: { unavailable: string | null; onCreate: () => void; onJoin: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet title="Party up" onClose={onClose}>
      {unavailable ? (
        <p className="text-sm text-neutral-300">{unavailable}</p>
      ) : (
        <div className="grid gap-5">
          <div>
            <p className="text-sm text-neutral-400">Start a party and share the code. Up to 4 players. You pick the mode, everyone readies up, you hit Play.</p>
            <button type="button" onClick={() => (uiSound("select"), onCreate())} className="mt-3 h-11 w-full rounded-xl bg-white font-bold text-black">
              Create party
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = normalizeRoomCode(code);
              if (!n) {
                uiSound("error");
                return setErr("Codes are 5 letters/digits, like K7QX2.");
              }
              uiSound("select");
              onJoin(n);
            }}
          >
            <p className="text-sm text-neutral-400">Got a code from a friend?</p>
            <div className="mt-3 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={7}
                placeholder="ENTER CODE"
                aria-label="Party code"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-transparent px-4 font-mono tracking-[0.3em] uppercase outline-none placeholder:text-neutral-600 focus:border-white/60"
              />
              <button type="submit" className="h-11 rounded-xl border border-white/30 px-5 font-bold hover:border-white/60">
                Join
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          </form>
        </div>
      )}
    </Sheet>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const dev = useInputDevice();
  const [tab, setTab] = useState<SettingsTab>("mouse");
  const [s, setS] = useState<GameSettings>(() => loadSettings(mobileDefaultQuality() ?? detectQuality()));
  return (
    <Sheet title="Settings" onClose={onClose}>
      <SettingsPanel
        settings={s}
        dev={dev}
        tab={tab}
        onTab={(t) => (sfxClick(), setTab(t))}
        onChange={(patch) =>
          setS((prev) => {
            const next = { ...prev, ...patch };
            saveSettings(next);
            return next;
          })
        }
      />
    </Sheet>
  );
}
