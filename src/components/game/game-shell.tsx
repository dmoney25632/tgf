"use client";

import { useEffect, useState } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/** Give the cursor back so the recovery buttons are clickable. */
function releaseInput() {
  if (document.pointerLockElement) document.exitPointerLock();
}

function Panel({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <div role="alertdialog" aria-labelledby="game-shell-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-neutral-950 p-6 text-center shadow-2xl">
        <p className="font-mono text-xs tracking-[0.3em] text-red-400/80 uppercase">{eyebrow}</p>
        <h2 id="game-shell-title" className="mt-2 text-xl font-bold text-white">
          {title}
        </h2>
        <p className="mt-2 text-sm text-neutral-400">{body}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>
      </div>
    </div>
  );
}

const reload = () => window.location.reload();

function GameCrash(_props: object, { error, reset }: ErrorInfo) {
  useEffect(() => {
    releaseInput();
    console.error(error);
  }, [error]);
  return (
    <Panel eyebrow="Signal lost" title="The game hit an error" body="Something broke inside the match screen. Try again, or reload to get back to the lobby (your loadout picks are kept).">
      <button type="button" onClick={() => reset()} className={buttonVariants()}>
        Try again
      </button>
      <button type="button" onClick={reload} className={cn(buttonVariants({ variant: "outline" }))}>
        Reload
      </button>
    </Panel>
  );
}

/**
 * Error boundary around the game host (lobby, party room, match). A render
 * error shows a recover panel instead of tearing down the whole page.
 */
export const GameErrorBoundary = catchError(GameCrash);

/** How long to wait for the browser to hand the GPU context back. */
const RESTORE_WAIT_MS = 4000;

/**
 * Watches for the browser dropping a WebGL context (GPU reset, driver
 * update, too many contexts, device sleep). Three.js asks for the context
 * back; if it returns the match carries on, otherwise the player gets a
 * reload prompt instead of a frozen black screen. Canvases inside
 * `[data-webgl-optional]` (decorative previews) are ignored.
 */
export function WebGLContextGuard() {
  const [state, setState] = useState<"ok" | "lost" | "failed">("ok");

  useEffect(() => {
    let timer = 0;
    const lost = new Set<HTMLCanvasElement>();
    const onLost = (e: Event) => {
      const canvas = e.target;
      if (!(canvas instanceof HTMLCanvasElement)) return;
      // Renderers release their context on purpose when they unmount
      // (forceContextLoss, then remove the canvas). Only a canvas that is
      // still on the page a moment later was lost for real.
      window.setTimeout(() => {
        if (!canvas.isConnected || canvas.closest("[data-webgl-optional]")) return;
        lost.add(canvas);
        releaseInput();
        setState("lost");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setState((s) => (s === "lost" ? "failed" : s)), RESTORE_WAIT_MS);
      }, 100);
    };
    const onRestored = (e: Event) => {
      if (!(e.target instanceof HTMLCanvasElement) || !lost.delete(e.target) || lost.size) return;
      window.clearTimeout(timer);
      setState("ok");
    };
    // These events don't bubble; listening in the capture phase catches every canvas.
    document.addEventListener("webglcontextlost", onLost, true);
    document.addEventListener("webglcontextrestored", onRestored, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("webglcontextlost", onLost, true);
      document.removeEventListener("webglcontextrestored", onRestored, true);
    };
  }, []);

  if (state === "ok") return null;
  if (state === "lost") {
    return (
      <Panel eyebrow="Graphics paused" title="Reconnecting to the GPU" body="The browser reset the graphics context. Waiting for it to come back…">
        <button type="button" onClick={reload} className={cn(buttonVariants({ variant: "outline" }))}>
          Reload now
        </button>
      </Panel>
    );
  }
  return (
    <Panel
      eyebrow="Graphics lost"
      title="The 3D view stopped responding"
      body="The browser didn't restore the graphics context. Reload to get back in; your loadout picks are kept. If this keeps happening, close other 3D tabs or update your graphics driver."
    >
      <button type="button" onClick={reload} className={buttonVariants()}>
        Reload
      </button>
    </Panel>
  );
}
