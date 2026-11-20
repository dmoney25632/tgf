"use client";

import { useEffect, useRef } from "react";

/**
 * Progress bar made of particles: a row of faint dots; as progress passes
 * each dot, a speck flies in from the scatter above and settles there. When
 * `ready`, the whole line breathes.
 */
export function ParticleProgress({ progress, ready, className }: { progress: number; ready: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const prog = useRef(progress);
  const rdy = useRef(ready);
  useEffect(() => {
    prog.current = progress;
    rdy.current = ready;
  }, [progress, ready]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1;
    type Slot = { x: number; on: number; sx: number; sy: number; ph: number };
    let slots: Slot[] = [];
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(24, Math.floor(w / 7));
      slots = Array.from({ length: n }, (_, i) => ({
        x: (i + 0.5) * (w / n),
        on: slots[i]?.on ?? 0,
        sx: (Math.random() - 0.5) * 160,
        sy: -20 - Math.random() * 70,
        ph: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const y = h - 3;
      ctx.clearRect(0, 0, w, h);
      const filled = prog.current * slots.length;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const target = i < filled ? 1 : 0;
        s.on += (target - s.on) * Math.min(1, dt * (reduced ? 60 : 5));
        // Empty slot.
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(s.x - 0.75, y - 0.75, 1.5, 1.5);
        if (s.on < 0.01) continue;
        // Speck flying from its scatter point into the slot (ease-out).
        const k = 1 - Math.pow(1 - s.on, 3);
        const px = s.x + s.sx * (1 - k);
        const py = y + s.sy * (1 - k);
        const breathe = rdy.current && !reduced ? 0.75 + 0.25 * Math.sin(t * 3 + i * 0.25) : 1;
        ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.75 * k * breathe).toFixed(3)})`;
        const r = 1 + k * 0.6;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        if (k < 0.98) {
          // Short trail while in flight.
          ctx.strokeStyle = `rgba(255,255,255,${(0.2 * (1 - k)).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - s.sx * 0.08, py - s.sy * 0.08);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
