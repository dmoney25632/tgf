"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Black-and-white particle field behind every menu screen (auth, dashboard,
 * missions, co-op lobby, loadout). Drifting specks, faint links between
 * neighbours, a soft wake around the cursor.
 *
 * Cheap on purpose: Canvas 2D, ~1 particle per 9k px² (max 170), and it
 * stops drawing while a match is running (the game canvas carries
 * data-engine) or the tab is hidden. Static frame for reduced motion.
 */
export function ParticleBackdrop() {
  const pathname = usePathname();
  if (pathname === "/") return null; // the landing page has its own particle scene
  return <ParticleField className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}

/**
 * The particle field itself. `overlay` keeps it running while a match canvas
 * exists (for screens drawn on top of the game, like the loading screen) and
 * sizes it to its parent instead of the window.
 */
export function ParticleField({ className, overlay = false }: { className?: string; overlay?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    type P = { x: number; y: number; vx: number; vy: number; r: number; a: number; ph: number };
    let ps: P[] = [];
    let w = 0, h = 0, dpr = 1;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = overlay ? canvas.parentElement!.getBoundingClientRect() : null;
      w = box ? box.width : window.innerWidth;
      h = box ? box.height : window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(170, Math.round((w * h) / 9000));
      while (ps.length < n) {
        ps.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 6,
          vy: -2 - Math.random() * 8,
          r: Math.random() < 0.12 ? 1.4 + Math.random() : 0.5 + Math.random() * 0.7,
          a: 0.15 + Math.random() * 0.55,
          ph: Math.random() * Math.PI * 2,
        });
      }
      ps = ps.slice(0, n);
    };
    resize();
    window.addEventListener("resize", resize);
    const onMove = (e: PointerEvent) => {
      const r = overlay ? canvas.getBoundingClientRect() : null;
      mouse.x = e.clientX - (r ? r.left : 0);
      mouse.y = e.clientY - (r ? r.top : 0);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    let engineCheck = 0;
    let engineOn = false;
    const LINK = 110;

    const draw = (now: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      for (const p of ps) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120 && d2 > 1) {
          const f = (1 - Math.sqrt(d2) / 120) * 40 * dt;
          p.x += (dx / Math.sqrt(d2)) * f;
          p.y += (dy / Math.sqrt(d2)) * f;
        }
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
      }
      // Links between near neighbours.
      ctx.lineWidth = 0.6;
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const k = 1 - Math.sqrt(d2) / LINK;
          ctx.strokeStyle = `rgba(255,255,255,${(k * k * 0.12).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (const p of ps) {
        const tw = 0.6 + 0.4 * Math.sin(t * 1.3 + p.ph);
        ctx.fillStyle = `rgba(255,255,255,${(p.a * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now > engineCheck) {
        engineCheck = now + 1000;
        engineOn = !overlay && !!document.querySelector("canvas[data-engine]");
      }
      if (document.hidden || engineOn) return;
      draw(now, dt);
    };
    if (reduced) draw(performance.now(), 0);
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [overlay]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
