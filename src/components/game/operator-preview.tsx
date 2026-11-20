"use client";

import { useEffect, useRef } from "react";
import type { OperatorDef } from "@/game/survival/config";

/** Small turntable render of an operator (lazy-loads Three.js). */
export function OperatorPreview({ operator }: { operator: OperatorDef }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    Promise.all([import("three"), import("@/game/ai/Humanoid")]).then(([THREE, { Humanoid }]) => {
      if (disposed) return;
      const w = host.clientWidth || 240;
      const h = host.clientHeight || 280;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 20);
      camera.position.set(0, 1.25, 4.3);
      camera.lookAt(0, 0.95, 0);
      scene.add(new THREE.HemisphereLight(0xe8eef8, 0x5a4a38, 1.4));
      const key = new THREE.DirectionalLight(0xffe2c0, 2.6);
      key.position.set(2, 3, 2);
      const rim = new THREE.DirectionalLight(0x8ab0ff, 1.4);
      rim.position.set(-2, 2, -2);
      scene.add(key, rim);

      const c = operator.colors;
      const heavy = operator.role === "Heavy";
      const dummy = { name: operator.name, applyDamage: () => ({ damage: 0, killed: false, counts: false }) };
      const model = new Humanoid(dummy, {
        uniform: c.sleeve, vest: c.vest, helmet: c.helmet, skin: 0xb08a6a, accent: c.accent,
        kit: heavy ? "heavy" : operator.role === "Recon" ? "sniper" : "standard", scale: 1,
      });
      scene.add(model.root);

      let raf = 0;
      let last = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        model.root.rotation.y += dt * 0.6;
        model.update(dt, 0, false, 0.05, true);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);
      cleanup = () => {
        cancelAnimationFrame(raf);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(() => {
      // No WebGL (or the chunk failed to load): the preview is decorative, leave it empty.
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [operator]);

  // Rendered in colour, shown in black and white to match the menu style.
  // Decorative: losing its GPU context must not trigger the game's recover prompt.
  return <div ref={ref} data-webgl-optional className="h-full w-full contrast-125 grayscale" />;
}
