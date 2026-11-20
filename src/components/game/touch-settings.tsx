"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_TOUCH_SETTINGS, getTouchSettings, setTouchSettings, subscribeTouchSettings, TOUCH_LIMITS, type TouchSettings } from "@/game/mobile/touchSettings";

const serverSnap = () => DEFAULT_TOUCH_SETTINGS;

/** Touch-control preferences (pause menu on phones/tablets). Applies live. */
export function TouchSettingsPanel() {
  const s = useSyncExternalStore(subscribeTouchSettings, getTouchSettings, serverSnap);
  const slider = (key: keyof typeof TOUCH_LIMITS, label: string, step: number, fmt: (v: number) => string) => {
    const [min, max] = TOUCH_LIMITS[key];
    const v = s[key];
    return (
      <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-2">
        <span className="text-sm text-neutral-200">{label}</span>
        <span className="font-mono text-xs text-neutral-400 tabular-nums">{fmt(v)}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => setTouchSettings({ [key]: Number(e.target.value) } as Partial<TouchSettings>)}
          className="col-span-2 h-8 w-full accent-white"
        />
      </label>
    );
  };
  const toggle = (key: "leftHanded" | "leftFire", label: string, hint: string) => (
    <label className="flex items-center justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm text-neutral-200">{label}</span>
        <span className="block text-xs text-neutral-500">{hint}</span>
      </span>
      <input type="checkbox" checked={s[key]} onChange={(e) => setTouchSettings({ [key]: e.target.checked })} className="size-6 shrink-0 accent-white" />
    </label>
  );
  return (
    <div className="animate-in duration-200 fade-in">
      <p className="font-mono text-[10px] tracking-[0.3em] text-neutral-500 uppercase">Touch controls</p>
      <div className="mt-2 divide-y divide-white/5">
        {slider("sensitivity", "Look sensitivity", 0.05, (v) => v.toFixed(2))}
        {slider("adsSensitivity", "Aiming sensitivity", 0.05, (v) => `${Math.round(v * 100)}%`)}
        {slider("buttonScale", "Button size", 0.05, (v) => `${Math.round(v * 100)}%`)}
        {slider("opacity", "Button opacity", 0.05, (v) => `${Math.round(v * 100)}%`)}
        {toggle("leftHanded", "Left-handed layout", "Stick on the right, buttons and look on the left.")}
        {toggle("leftFire", "Second fire button", "A fire button on the stick side too.")}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        Left thumb: the stick appears where you touch; push to the edge to sprint. Right thumb: drag anywhere to look, or hold FIRE and drag to aim
        while shooting. AIM toggles aim-down-sights. Aim assist (Settings → Controller) also helps on touch.
      </p>
    </div>
  );
}
