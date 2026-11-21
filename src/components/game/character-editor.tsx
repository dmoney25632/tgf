"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { OPERATORS, OPERATOR_IDS } from "@/game/survival/config";
import {
  ACCENT_COLORS, GEAR, GEAR_COLORS, SKIN_TONES, UNIFORM_COLORS,
  defaultCharacter, hexCss, loadCharacter, saveCharacter,
  type Character, type CharacterLook,
} from "@/game/character";
import { OperatorPreview } from "./operator-preview";
import { uiSound } from "./ui-sound";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 className="mb-2.5 font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">{title}</h2>
    {children}
  </section>
);

function Swatches({ colors, value, onPick }: { colors: readonly { name: string; hex: number }[]; value: number; onPick: (hex: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.name}
          aria-label={c.name}
          aria-pressed={value === c.hex}
          onClick={() => {
            uiSound("click");
            onPick(c.hex);
          }}
          className={cn("h-8 w-8 rounded-full border-2 transition-transform hover:scale-110", value === c.hex ? "border-white" : "border-transparent ring-1 ring-white/15")}
          style={{ background: hexCss(c.hex) }}
        />
      ))}
    </div>
  );
}

/** Character page: class + appearance, saved locally and used by the lobby. */
export function CharacterEditor({ callsign, backHref }: { callsign: string; backHref: string }) {
  const router = useRouter();
  const [c, setC] = useState<Character | null>(null);
  const [saved, setSaved] = useState<string>("");

  useEffect(() => {
    queueMicrotask(() => {
      const loaded = loadCharacter();
      setC(loaded);
      setSaved(JSON.stringify(loaded));
    });
  }, []);

  if (!c) return <div className="fixed inset-0 bg-black" aria-busy="true" />;

  const dirty = JSON.stringify(c) !== saved;
  const setLook = (patch: Partial<CharacterLook>) => setC({ ...c, look: { ...c.look, ...patch } });
  const op = OPERATORS[c.operator];

  const save = () => {
    saveCharacter(c);
    uiSound("deploy");
    router.push(backHref);
  };

  return (
    <div className="min-h-dvh bg-black text-neutral-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-5 md:px-8">
        <Link href={backHref} onClick={() => uiSound("click")} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5 text-neutral-400")}>
          <ArrowLeft className="size-4" /> Lobby
        </Link>
        <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">Character</p>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 pt-4 pb-28 md:grid-cols-[1fr_1.1fr] md:px-8">
        <div className="relative aspect-[4/5] max-h-[70vh] w-full overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_75%,rgba(255,255,255,.10),transparent_65%)] md:sticky md:top-6">
          <OperatorPreview look={c.look} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
            <p className="text-2xl font-black tracking-tight">{callsign}</p>
            <p className="text-sm text-neutral-400">
              {op.name} · {op.role}
            </p>
          </div>
        </div>

        <div className="grid content-start gap-7">
          <Section title="Class">
            <div className="grid grid-cols-2 gap-2">
              {OPERATOR_IDS.map((id) => {
                const o = OPERATORS[id];
                const active = c.operator === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      uiSound("select");
                      setC({ ...c, operator: id });
                    }}
                    className={cn("rounded-xl border px-3 py-2.5 text-left transition-colors", active ? "border-white bg-white text-black" : "border-white/10 hover:border-white/30")}
                  >
                    <span className="block font-bold">{o.role}</span>
                    <span className={cn("block text-xs", active ? "text-black/60" : "text-neutral-500")}>{o.traits[0]}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-neutral-500">{op.traits.join(" · ")}</p>
          </Section>

          <Section title="Skin">
            <Swatches colors={SKIN_TONES.map((hex, i) => ({ name: `Tone ${i + 1}`, hex }))} value={c.look.skin} onPick={(skin) => setLook({ skin })} />
          </Section>

          <Section title="Headgear">
            <div className="flex flex-wrap gap-1.5">
              {GEAR.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    uiSound("click");
                    setLook({ gear: i });
                  }}
                  className={cn("rounded-full border px-3 py-1 text-sm transition-colors", c.look.gear === i ? "border-white bg-white text-black" : "border-white/10 text-neutral-300 hover:border-white/30")}
                >
                  {name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Uniform">
            <Swatches colors={UNIFORM_COLORS} value={c.look.uniform} onPick={(uniform) => setLook({ uniform })} />
          </Section>

          <Section title="Vest">
            <Swatches colors={GEAR_COLORS} value={c.look.vest} onPick={(vest) => setLook({ vest })} />
          </Section>

          <Section title="Helmet">
            <Swatches colors={[...GEAR_COLORS, ...UNIFORM_COLORS.slice(0, 4)]} value={c.look.helmet} onPick={(helmet) => setLook({ helmet })} />
          </Section>

          <Section title="Accent">
            <Swatches colors={ACCENT_COLORS} value={c.look.accent} onPick={(accent) => setLook({ accent })} />
          </Section>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 md:px-8">
          <button
            type="button"
            onClick={() => {
              uiSound("click");
              setC(defaultCharacter(c.operator));
            }}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5 text-neutral-400")}
          >
            <RotateCcw className="size-4" /> Reset
          </button>
          <div className="flex-1" />
          <button type="button" onClick={save} className={cn(buttonVariants({ size: "lg" }), "h-11 min-w-40 gap-2 font-bold")}>
            <Check className="size-4" /> {dirty ? "Save" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
