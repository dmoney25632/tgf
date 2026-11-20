"use client";

let requested = false;

/**
 * Warms the game engine chunk (the bulk of the Three.js game code) while the
 * player is still in the lobby, so Deploy only waits on map assets. Runs once,
 * when the browser is idle; the lobby itself never blocks on it.
 */
export function prefetchGameEngine() {
  if (requested || typeof window === "undefined") return;
  requested = true;
  const load = () => {
    Promise.all([import("@/game/core/Engine"), import("@/game/ui/LoadProgress")]).catch(() => {
      // Offline or a failed chunk: GameView retries the import on Deploy.
      requested = false;
    });
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(load, { timeout: 4000 });
  else window.setTimeout(load, 1500);
}
