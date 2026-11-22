"use client";

import { useEffect, useRef } from "react";
import { humanoidLook, type CharacterLook } from "@/game/character";

type Stage = { setLook: (look: CharacterLook) => void; dispose: () => void };

/**
 * Turntable render of the player's character (lazy-loads Three.js). One
 * renderer lives for the component's lifetime; changing the look swaps the
 * model in place so clicking through colours never churns GPU contexts.
 */
export function OperatorPreview({ look, className }: { look: CharacterLook; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const lookRef = useRef(look);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let disposed = false;

    Promise.all([import("three"), import("@/game/ai/Humanoid")])
      .then(([THREE, { Humanoid }]) => {
        if (disposed) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        host.appendChild(renderer.domElement);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
        camera.position.set(0, 1.2, 4.6);
        camera.lookAt(0, 0.95, 0);
        scene.add(new THREE.HemisphereLight(0xe8eef8, 0x5a4a38, 1.4));
        const key = new THREE.DirectionalLight(0xffe2c0, 2.6);
        key.position.set(2, 3, 2);
        const rim = new THREE.DirectionalLight(0x8ab0ff, 1.4);
        rim.position.set(-2, 2, -2);
        scene.add(key, rim);

        const resize = () => {
          const w = host.clientWidth || 240;
          const h = host.clientHeight || 280;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(host);

        const dummy = { name: "preview", applyDamage: () => ({ damage: 0, killed: false, counts: false }) };
        let model: InstanceType<typeof Humanoid> | null = null;
        // The turntable spins, not the soldier: his planted feet stay planted.
        const turntable = new THREE.Group();
        turntable.rotation.y = 0.5;
        scene.add(turntable);
        const setLook = (l: CharacterLook) => {
          if (model) turntable.remove(model.root);
          model = new Humanoid(dummy, humanoidLook(l));
          turntable.add(model.root);
        };
        setLook(lookRef.current);

        let raf = 0;
        let last = performance.now();
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          turntable.rotation.y += dt * 0.5;
          if (model) model.update(dt, 0, false, 0.05, true);
          renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(loop);
        stageRef.current = {
          setLook,
          dispose: () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
          },
        };
      })
      .catch(() => {
        // No WebGL (or the chunk failed to load): the preview is decorative, leave it empty.
      });

    return () => {
      disposed = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    lookRef.current = look;
    stageRef.current?.setLook(look);
  }, [look]);

  // Decorative: losing its GPU context must not trigger the game's recover prompt.
  return <div ref={ref} data-webgl-optional className={className ?? "h-full w-full"} />;
}
