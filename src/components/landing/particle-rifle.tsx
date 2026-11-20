"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Landing hero: the game's VK-7 carbine as ~32k white particles floating in
 * black space. Particles assemble on load, drift and shimmer, part around the
 * cursor, and blow apart when the rifle is clicked (then we go to sign-in).
 *
 * Plain WebGL2 (no three.js) so the landing page stays tiny. The point cloud
 * is baked from the real viewmodel by scripts/gen-rifle-points.ts.
 */

const POINTS_URL = "/assets/landing/rifle-points.bin";
const DUST = 1800;
const FOV = (32 * Math.PI) / 180;
const CAM_Z = 3.4;

const VERT = /* glsl */ `#version 300 es
precision highp float;
in vec3 a_pos;
in vec3 a_nrm;
in float a_shade;
in vec4 a_rand;          // xyz: scatter direction, w: seed
uniform mat4 u_proj;
uniform mat4 u_model;
uniform float u_time;
uniform float u_assemble; // 0 -> 1 intro
uniform float u_burst;    // 0 -> 1 on click
uniform float u_hover;
uniform vec2 u_mouse;     // world xy on the z=0 plane
uniform float u_mouseOn;
uniform float u_size;
uniform float u_dust;     // 1 for the background dust pass
out float v_bright;
out float v_soft;

void main() {
  float seed = a_rand.w;
  vec3 dir = a_rand.xyz;
  vec3 p;
  float bright;

  if (u_dust > 0.5) {
    // Slow drifting specks in a deep box around the rifle.
    p = a_pos * vec3(4.2, 2.6, 2.4);
    p.y += mod(u_time * (0.015 + seed * 0.03) + seed * 10.0, 5.2) - 2.6 - a_pos.y * 2.6;
    p.x += sin(u_time * 0.1 + seed * 40.0) * 0.08;
    bright = 0.08 + 0.22 * seed * (0.6 + 0.4 * sin(u_time * (0.6 + seed) + seed * 50.0));
    bright *= u_assemble;
    vec4 clip = u_proj * vec4(p.x, p.y, p.z - ${CAM_Z.toFixed(2)}, 1.0);
    gl_Position = clip;
    gl_PointSize = u_size * (0.6 + seed * 1.1) / clip.w;
    v_bright = bright;
    v_soft = 1.0;
    return;
  }

  // Intro: fly in from a wide cloud, staggered by seed.
  float t = clamp(u_assemble * 1.6 - seed * 0.6, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  p = mix(dir * (2.4 + seed * 2.0), a_pos, t);

  // Living surface: tiny per-particle shimmer.
  p += dir * 0.0045 * sin(u_time * (1.4 + seed * 2.2) + seed * 80.0);

  vec4 world = u_model * vec4(p, 1.0);
  vec3 n = normalize(mat3(u_model) * a_nrm);

  // Cursor stirs the particles locally, like a hand through smoke; the
  // rifle's shape holds.
  vec2 d = world.xy - u_mouse;
  float r = length(d);
  float push = u_mouseOn * smoothstep(0.16, 0.0, r);
  float swirl = sin(u_time * 3.0 + seed * 40.0);
  world.xyz += (vec3(normalize(d + 1e-5) * 0.4, 0.0) + dir * (0.6 + 0.4 * swirl)) * push * 0.045;

  // Click: blow apart outward.
  float b = u_burst * u_burst;
  world.xyz += (dir * 2.6 + n * 0.6) * b * (0.6 + seed);

  // Studio light from upper left plus a cool rim.
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
  float diff = max(dot(n, L), 0.0);
  float rim = pow(1.0 - abs(n.z), 2.0) * 0.55;
  float tw = 0.85 + 0.15 * sin(u_time * (2.0 + seed * 3.0) + seed * 120.0);
  bright = (0.16 + 0.84 * a_shade) * (0.32 + 0.9 * diff + rim) * tw;
  bright *= mix(1.0, 1.35, u_hover) * (1.0 + push * 1.5);
  bright *= mix(0.25, 1.0, t) * (1.0 - b * 0.9);

  vec4 clip = u_proj * vec4(world.x, world.y, world.z - ${CAM_Z.toFixed(2)}, 1.0);
  gl_Position = clip;
  gl_PointSize = u_size * (0.85 + seed * 0.5) * (1.0 + b * 2.0) / clip.w;
  v_bright = bright;
  v_soft = 0.0;
}`;

const FRAG = /* glsl */ `#version 300 es
precision mediump float;
in float v_bright;
in float v_soft;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float core = smoothstep(1.0, mix(0.15, 0.0, v_soft), r);
  if (core <= 0.0) discard;
  float a = core * v_bright;
  o = vec4(vec3(a), a);
}`;

function perspective(fov: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

/** Column-major R = Rz(roll) * Ry(yaw) * Rx(pitch), then uniform scale + translate. */
function model(yaw: number, pitch: number, roll: number, s: number, ty: number) {
  const [cy, sy, cx, sx, cz, sz] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  // Ry * Rx
  const a = [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx];
  // Rz * (Ry * Rx), stored as columns
  const m = new Float32Array(16);
  for (let col = 0; col < 3; col++) {
    const x = a[col * 3], y = a[col * 3 + 1], z = a[col * 3 + 2];
    m[col * 4] = (cz * x - sz * y) * s;
    m[col * 4 + 1] = (sz * x + cz * y) * s;
    m[col * 4 + 2] = z * s;
  }
  m[13] = ty;
  m[15] = 1;
  return m;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
  return sh;
}

export function ParticleRifle({ href = "/login" }: { href?: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const goRef = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) {
      setFailed(true);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let disposed = false;
    const hintTimer = window.setTimeout(() => {
      setTouch(window.matchMedia("(pointer: coarse)").matches);
      setHint(true);
    }, 3200);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      proj: U("u_proj"), model: U("u_model"), time: U("u_time"), assemble: U("u_assemble"), burst: U("u_burst"),
      hover: U("u_hover"), mouse: U("u_mouse"), mouseOn: U("u_mouseOn"), size: U("u_size"), dust: U("u_dust"),
    };
    const A = (n: string) => gl.getAttribLocation(prog, n);

    const rand = (n: number) => {
      const r = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        // Uniform direction on a sphere + seed.
        const z = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        r.set([s * Math.cos(th), s * Math.sin(th), z, Math.random()], i * 4);
      }
      return r;
    };

    // ---- Dust VAO (positions in [-0.5, 0.5]^3, normals/shade unused)
    const dustVao = gl.createVertexArray()!;
    gl.bindVertexArray(dustVao);
    const dustPos = new Float32Array(DUST * 3).map(() => Math.random() - 0.5);
    const buf = (data: ArrayBufferView, loc: number, size: number, type: number, norm: boolean, stride = 0, offset = 0) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, type, norm, stride, offset);
      }
      return b;
    };
    const buffers: WebGLBuffer[] = [];
    buffers.push(buf(dustPos, A("a_pos"), 3, gl.FLOAT, false));
    buffers.push(buf(rand(DUST), A("a_rand"), 4, gl.FLOAT, false));
    gl.vertexAttrib3f(A("a_nrm"), 0, 0, 1);
    gl.vertexAttrib1f(A("a_shade"), 0);

    // ---- Rifle VAO, filled once the point cloud arrives
    const rifleVao = gl.createVertexArray()!;
    let rifleCount = 0;
    let loadedAt = 0;
    fetch(POINTS_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => {
        if (disposed) return;
        rifleCount = Math.floor(ab.byteLength / 10);
        gl.bindVertexArray(rifleVao);
        const b = gl.createBuffer()!;
        buffers.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, ab, gl.STATIC_DRAW);
        const lp = A("a_pos"), ln = A("a_nrm"), ls = A("a_shade");
        gl.enableVertexAttribArray(lp);
        gl.vertexAttribPointer(lp, 3, gl.SHORT, true, 10, 0);
        gl.enableVertexAttribArray(ln);
        gl.vertexAttribPointer(ln, 3, gl.BYTE, true, 10, 6);
        gl.enableVertexAttribArray(ls);
        gl.vertexAttribPointer(ls, 1, gl.UNSIGNED_BYTE, true, 10, 9);
        buffers.push(buf(rand(rifleCount), A("a_rand"), 4, gl.FLOAT, false));
        loadedAt = performance.now();
      })
      .catch(() => !disposed && setFailed(true));

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // ---- Sizing
    let w = 0, h = 0, dpr = 1, scale = 1, halfW = 1, halfH = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      const aspect = w / Math.max(1, h);
      gl.uniformMatrix4fv(u.proj, false, perspective(FOV, aspect, 0.1, 30));
      halfH = Math.tan(FOV / 2) * CAM_Z;
      halfW = halfH * aspect;
      // Rifle (2 units long) spans ~78% of the width, capped by height on wide screens.
      scale = Math.min((halfW * 2 * 0.78) / 2, (halfH * 2 * 1.25) / 2);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ---- Pointer
    const mouse = { x: 0, y: 0, on: 0, target: 0 };
    let hover = 0;
    let hoverTarget = 0;
    const toWorld = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (((cx - rect.left) / rect.width) * 2 - 1) * halfW, y: -(((cy - rect.top) / rect.height) * 2 - 1) * halfH };
    };
    /** Rough hit test: inside the rifle's silhouette band. */
    const onRifle = (x: number, y: number) => Math.abs(x) < scale * 0.98 && Math.abs(y - floatY) < scale * 0.3;
    let floatY = 0;
    const onMove = (e: PointerEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.target = e.pointerType === "mouse" ? 1 : 0;
      hoverTarget = rifleCount && onRifle(p.x, p.y) ? 1 : 0;
      setHovering(hoverTarget === 1);
    };
    const onLeave = () => {
      mouse.target = 0;
      hoverTarget = 0;
      setHovering(false);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    // ---- Click -> burst -> navigate
    let burstAt = 0;
    const go = () => {
      if (burstAt || !rifleCount) return;
      burstAt = performance.now();
      window.setTimeout(() => router.push(href), reduced ? 0 : 650);
    };
    goRef.current = go;
    const onClick = (e: MouseEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      if (onRifle(p.x, p.y)) go();
    };
    canvas.addEventListener("click", onClick);

    // ---- Loop
    const t0 = performance.now();
    let last = t0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduced ? 0 : (now - t0) / 1000;
      const assemble = loadedAt ? Math.min(1, (now - loadedAt) / (reduced ? 1 : 2600)) : 0;
      const burst = burstAt ? Math.min(1, (now - burstAt) / 700) : 0;
      mouse.on += (mouse.target - mouse.on) * Math.min(1, dt * 6);
      hover += (hoverTarget - hover) * Math.min(1, dt * 5);

      // Float: slow bob + lazy turn, a little tilt toward the cursor.
      floatY = Math.sin(t * 0.7) * 0.05 * scale;
      const yaw = -Math.PI / 2 + Math.sin(t * 0.23) * 0.42 + (mouse.on * mouse.x) / (halfW * 6);
      const pitch = Math.sin(t * 0.31) * 0.06 - (mouse.on * (mouse.y - floatY)) / (halfH * 10);
      const roll = Math.sin(t * 0.17) * 0.05;

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.burst, burst);
      gl.uniform1f(u.hover, hover);
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.uniform1f(u.mouseOn, mouse.on);

      // Dust
      gl.uniform1f(u.dust, 1);
      gl.uniform1f(u.assemble, Math.min(1, (now - t0) / 1500));
      gl.uniform1f(u.size, 3.2 * dpr * (h / 900 + 0.4));
      gl.bindVertexArray(dustVao);
      gl.drawArrays(gl.POINTS, 0, DUST);

      if (rifleCount) {
        gl.uniform1f(u.dust, 0);
        gl.uniform1f(u.assemble, assemble);
        gl.uniformMatrix4fv(u.model, false, model(yaw, pitch, roll, scale, floatY));
        // Point size follows the rifle's on-screen length, so a phone-sized rifle
        // doesn't pile its 32k additive points into a white blob.
        const rifleCss = (scale / halfW) * w;
        gl.uniform1f(u.size, 2.3 * dpr * Math.max(0.4, Math.min(1.6, rifleCss / 800)) * CAM_Z);
        gl.bindVertexArray(rifleVao);
        gl.drawArrays(gl.POINTS, 0, rifleCount);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(hintTimer);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      for (const b of buffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(dustVao);
      gl.deleteVertexArray(rifleVao);
      gl.deleteProgram(prog);
    };
  }, [router, href]);

  return (
    <div className="fixed inset-0 bg-black">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-manipulation"
        style={{ cursor: hovering ? "pointer" : "default" }}
        aria-hidden
      />
      {/* Keyboard / screen-reader path to the same action. */}
      <button
        type="button"
        onClick={() => (failed ? router.push(href) : goRef.current())}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-8 focus:left-1/2 focus:-translate-x-1/2 focus:rounded-full focus:border focus:border-white/40 focus:px-5 focus:py-2 focus:font-mono focus:text-xs focus:tracking-[0.3em] focus:text-white focus:uppercase"
      >
        Enter — sign in
      </button>
      <p
        className={`pointer-events-none absolute inset-x-0 bottom-10 text-center font-mono text-[10px] tracking-[0.5em] text-white/40 uppercase transition-opacity duration-[1500ms] ${hint && !failed ? "opacity-100" : "opacity-0"}`}
      >
        {hovering ? "Enter" : touch ? "Tap the rifle" : "Click the rifle"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={() => router.push(href)}
          className="absolute inset-0 m-auto h-12 w-48 rounded-full border border-white/30 font-mono text-xs tracking-[0.4em] text-white uppercase"
        >
          Enter
        </button>
      )}
    </div>
  );
}
