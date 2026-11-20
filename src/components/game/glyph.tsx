"use client";

import { keyGlyph, padGlyph, type PadButtonName } from "@/game/ui/Glyphs";
import type { DeviceSnapshot } from "./gamepad";
import { cn } from "@/lib/utils";

/** Static, generated SVG/HTML from Glyphs.ts (no user content). */
function Raw({ html, className }: { html: string; className?: string }) {
  return <span aria-hidden className={cn("inline-flex shrink-0 items-center leading-none", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PadGlyph({ btn, layout, size = 18, className }: { btn: PadButtonName; layout: DeviceSnapshot["layout"]; size?: number; className?: string }) {
  return <Raw html={padGlyph(btn, layout, size)} className={className} />;
}

export function KeyGlyph({ code, size = 18, className }: { code: string; size?: number; className?: string }) {
  return <Raw html={keyGlyph(code, size)} className={className} />;
}

/** Footer hint: a glyph for the current device + a label. Keyboard hint is optional. */
export function Hint({ dev, pad, keyCode, label }: { dev: DeviceSnapshot; pad: PadButtonName; keyCode?: string; label: string }) {
  if (dev.device !== "pad" && !keyCode) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-neutral-300 uppercase">
      {dev.device === "pad" ? <PadGlyph btn={pad} layout={dev.layout} /> : <KeyGlyph code={keyCode!} />}
      {label}
    </span>
  );
}
