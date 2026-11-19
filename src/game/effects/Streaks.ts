import * as THREE from "three";

/**
 * Camera-facing, velocity-stretched quads in one instanced draw call.
 * Used for spark streaks (physics mode) and bullet tracers (manual mode).
 * Each streak is a soft ribbon from tail → head; a minimum angular width
 * keeps distant streaks at ~1.5 px so they still read.
 */
export class StreakSystem {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly head: Float32Array;
  private readonly tail: Float32Array;
  private readonly color: Float32Array;
  private readonly width: Float32Array;
  // Physics state.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly rgb: Float32Array;
  private readonly w0: Float32Array;
  private readonly stretch: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private next = 0;
  cap: number;
  /** Optional ground plane: physics streaks bounce off it. */
  groundY = -Infinity;

  constructor(readonly capacity: number, opts: { tailFade?: number; core?: number } = {}) {
    const n = capacity;
    this.cap = n;
    this.head = new Float32Array(n * 3);
    this.tail = new Float32Array(n * 3);
    this.color = new Float32Array(n * 4);
    this.width = new Float32Array(n);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.rgb = new Float32Array(n * 3);
    this.w0 = new Float32Array(n);
    this.stretch = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);

    // Quad: x ∈ {0 tail, 1 head}, y ∈ {-1, 1} across.
    const quad = new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(quad, 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (a: Float32Array, s: number) => new THREE.InstancedBufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aHead", inst(this.head, 3));
    this.geometry.setAttribute("aTail", inst(this.tail, 3));
    this.geometry.setAttribute("aColor", inst(this.color, 4));
    this.geometry.setAttribute("aWidth", inst(this.width, 1));
    this.geometry.instanceCount = n;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { minAngle: { value: 0.002 }, tailFade: { value: opts.tailFade ?? 0 }, core: { value: opts.core ?? 0.6 } },
      vertexShader: /* glsl */ `
        attribute vec3 aHead;
        attribute vec3 aTail;
        attribute vec4 aColor;
        attribute float aWidth;
        uniform float minAngle;
        varying vec2 vQuad;
        varying vec4 vColor;
        void main() {
          vec4 h = modelViewMatrix * vec4(aHead, 1.0);
          vec4 t = modelViewMatrix * vec4(aTail, 1.0);
          vec3 axis = h.xyz - t.xyz;
          float L = length(axis);
          vec3 dir = L > 1e-6 ? axis / L : vec3(0.0, 1.0, 0.0);
          vec4 p = mix(t, h, position.x);
          vec3 side = cross(dir, normalize(p.xyz));
          float sl = length(side);
          side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
          float w = aWidth > 0.0 ? max(aWidth, -p.z * minAngle) : 0.0;
          p.xyz += side * position.y * w * 0.5;
          p.xyz += dir * (position.x * 2.0 - 1.0) * w * 0.5;
          vQuad = position.xy;
          vColor = aColor;
          // Thin streaks lose brightness instead of width (no aliasing shimmer).
          vColor.a *= aWidth > 0.0 ? clamp(aWidth / w, 0.35, 1.0) : 0.0;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform float tailFade;
        uniform float core;
        varying vec2 vQuad;
        varying vec4 vColor;
        void main() {
          float across = 1.0 - vQuad.y * vQuad.y;
          float along = mix(1.0 - tailFade, 1.0, vQuad.x);
          float a = across * across * along * vColor.a;
          vec3 c = vColor.rgb * (1.0 + core * across * across * across);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  setViewportHeight(h: number) {
    // ~1.4 px at a 80° vertical FOV.
    this.material.uniforms.minAngle.value = (1.4 * 2 * Math.tan((40 * Math.PI) / 180)) / Math.max(1, h);
  }

  /** Physics streak (spark): tail trails the head by velocity × stretch seconds. */
  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    r: number, g: number, b: number, life: number, width: number, stretch: number, gravity: number, drag: number,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.rgb[i3] = r; this.rgb[i3 + 1] = g; this.rgb[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.w0[i] = width;
    this.stretch[i] = stretch;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  /** Manual streak (tracer): set explicitly every frame. */
  set(i: number, hx: number, hy: number, hz: number, tx: number, ty: number, tz: number, r: number, g: number, b: number, a: number, width: number) {
    const i3 = i * 3;
    this.head[i3] = hx; this.head[i3 + 1] = hy; this.head[i3 + 2] = hz;
    this.tail[i3] = tx; this.tail[i3 + 1] = ty; this.tail[i3 + 2] = tz;
    const i4 = i * 4;
    this.color[i4] = r; this.color[i4 + 1] = g; this.color[i4 + 2] = b; this.color[i4 + 3] = a;
    this.width[i] = width;
  }

  hide(i: number) {
    this.width[i] = 0;
    this.color[i * 4 + 3] = 0;
  }

  /** Advance physics streaks (skip for manual-only systems). */
  simulate(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.width[i] !== 0) this.hide(i);
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.gravity[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < this.groundY && this.vel[i3 + 1] < 0) {
        this.pos[i3 + 1] = this.groundY;
        this.vel[i3 + 1] *= -0.35;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const fade = (1 - t) * (1 - t * 0.5);
      // Sparks cool from white-hot toward orange as they die.
      const cool = 1 - t * 0.6;
      const s = this.stretch[i];
      this.set(
        i,
        this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2],
        this.pos[i3] - this.vel[i3] * s, this.pos[i3 + 1] - this.vel[i3 + 1] * s, this.pos[i3 + 2] - this.vel[i3 + 2] * s,
        this.rgb[i3], this.rgb[i3 + 1] * cool, this.rgb[i3 + 2] * cool * cool, fade, this.w0[i],
      );
    }
    this.flush();
  }

  flush() {
    const a = this.geometry.attributes;
    a.aHead.needsUpdate = true;
    a.aTail.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aWidth.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
