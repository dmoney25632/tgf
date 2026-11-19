import * as THREE from "three";
import { ASSET_BASE } from "../assets/manifest";

export type LoadSnapshot = {
  /** Items finished / requested so far. */
  loaded: number;
  total: number;
  /** Any load has been requested since tracking began. */
  started: boolean;
  /** ms since the last load started/finished. */
  idleMs: number;
};

/**
 * Observes real asset loading while the match boots, from two sources:
 *  - three's DefaultLoadingManager (loaders that use it: HDRI, glTF buffers…);
 *  - in-flight `fetch` requests under /assets (the AssetLoader fetches and
 *    decodes textures/models off-thread, bypassing the manager).
 * Both hooks are only active until dispose(), which restores the originals.
 */
export function trackAssetLoading() {
  const m = THREE.DefaultLoadingManager;
  const prev = { onStart: m.onStart, onProgress: m.onProgress, onLoad: m.onLoad, onError: m.onError };
  const s: LoadSnapshot = { loaded: 0, total: 0, started: false, idleMs: 0 };
  let mgrLoaded = 0, mgrTotal = 0, fetchLoaded = 0, fetchTotal = 0;
  let last = performance.now();
  const sync = () => {
    s.loaded = mgrLoaded + fetchLoaded;
    s.total = mgrTotal + fetchTotal;
    s.started = s.total > 0;
    last = performance.now();
  };

  m.onStart = (url, loaded, total) => {
    mgrLoaded = loaded;
    mgrTotal = total;
    sync();
    prev.onStart?.(url, loaded, total);
  };
  m.onProgress = (url, loaded, total) => {
    mgrLoaded = loaded;
    mgrTotal = total;
    sync();
    prev.onProgress?.(url, loaded, total);
  };
  m.onLoad = () => {
    mgrLoaded = mgrTotal;
    sync();
    prev.onLoad?.();
  };
  m.onError = (url) => {
    last = performance.now();
    prev.onError?.(url);
  };

  const origFetch = typeof window !== "undefined" ? window.fetch : null;
  let wrapped: typeof fetch | null = null;
  if (origFetch) {
    wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const p = origFetch.call(window, input, init);
      let path = url;
      try {
        path = new URL(url, location.href).pathname;
      } catch {
        // Unparseable: not one of ours.
      }
      if (!path.startsWith(`${ASSET_BASE}/`)) return p;
      fetchTotal++;
      sync();
      const done = () => {
        fetchLoaded++;
        sync();
      };
      p.then(done, done);
      return p;
    };
    window.fetch = wrapped;
  }

  return {
    snapshot(): LoadSnapshot {
      s.idleMs = performance.now() - last;
      return s;
    },
    dispose() {
      m.onStart = prev.onStart;
      m.onProgress = prev.onProgress;
      m.onLoad = prev.onLoad;
      m.onError = prev.onError;
      // Only restore if nobody wrapped fetch after us.
      if (origFetch && window.fetch === wrapped) window.fetch = origFetch;
    },
  };
}

export type LoadTracker = ReturnType<typeof trackAssetLoading>;
