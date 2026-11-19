import * as THREE from "three";

export type LoadSnapshot = {
  /** Items finished / requested so far through three's DefaultLoadingManager. */
  loaded: number;
  total: number;
  /** Any load has been requested since tracking began. */
  started: boolean;
  /** ms since the last load started/finished. */
  idleMs: number;
};

/**
 * Observes real asset loading (textures, glTF models, the HDRI) by hooking
 * three's DefaultLoadingManager, which every loader uses unless given its
 * own. Chains any handlers already installed and restores them on dispose.
 */
export function trackAssetLoading() {
  const m = THREE.DefaultLoadingManager;
  const prev = { onStart: m.onStart, onProgress: m.onProgress, onLoad: m.onLoad, onError: m.onError };
  const s: LoadSnapshot = { loaded: 0, total: 0, started: false, idleMs: 0 };
  let last = performance.now();

  m.onStart = (url, loaded, total) => {
    s.started = true;
    s.loaded = loaded;
    s.total = total;
    last = performance.now();
    prev.onStart?.(url, loaded, total);
  };
  m.onProgress = (url, loaded, total) => {
    s.started = true;
    s.loaded = loaded;
    s.total = total;
    last = performance.now();
    prev.onProgress?.(url, loaded, total);
  };
  m.onLoad = () => {
    s.loaded = s.total;
    last = performance.now();
    prev.onLoad?.();
  };
  m.onError = (url) => {
    last = performance.now();
    prev.onError?.(url);
  };

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
    },
  };
}

export type LoadTracker = ReturnType<typeof trackAssetLoading>;
