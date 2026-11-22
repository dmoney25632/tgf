import * as THREE from "three";

/**
 * Soft contact ("blob") shadows under characters and loose props: one
 * instanced draw of radial-gradient quads laid on the floor under each
 * tracked object. They ground soldiers on presets without shadow maps and
 * add the dark contact core real shadow maps blur away. Fixed pool size, so
 * no reallocation or recompiles.
 *
 *   const h = map.blobs.track(soldier.root, { radius: 0.45 });
 *   ...
 *   h.remove();
 *
 * The tracked object's world position is taken as its feet. The blob sits
 * on the floor below (map collision + terrain) and fades as the object
 * rises off it (jumps, falls) or is hidden / removed from the scene.
 */

export type BlobOptions = {
  /** Blob radius (m). */
  radius?: number;
  /** 0..1 darkness multiplier for this object. */
  strength?: number;
};

export type BlobHandle = { remove(): void; readonly object: THREE.Object3D };

type Entry = { object: THREE.Object3D; radius: number; strength: number; handle: BlobHandle };

const VERT = /* glsl */ `
attribute float aStrength;
varying vec2 vUv;
varying float vStrength;
void main() {
	vUv = uv;
	vStrength = aStrength;
	gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
}`;

const FRAG = /* glsl */ `
uniform float opacity;
varying vec2 vUv;
varying float vStrength;
void main() {
	float d = length( vUv * 2.0 - 1.0 );
	// Dark contact core with a long soft skirt.
	float a = ( 1.0 - smoothstep( 0.0, 1.0, d ) );
	a = a * a * ( 0.6 + 0.4 * ( 1.0 - smoothstep( 0.0, 0.45, d ) ) );
	gl_FragColor = vec4( 0.0, 0.0, 0.0, a * vStrength * opacity );
}`;

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _s = new THREE.Vector3();
const _sc = new THREE.Vector3();

export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly entries: Entry[] = [];
  private readonly strengthAttr: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    scene: THREE.Scene,
    private readonly max = 48,
    /** Floor height under (x, z) at or below maxY. */
    private readonly floorAt: (x: number, z: number, maxY: number) => number = () => 0,
  ) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.strengthAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.strengthAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aStrength", this.strengthAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { opacity: { value: 0.55 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    this.material.name = "blob-shadow";
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.name = "blob-shadows";
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  /** Overall darkness: softer where shadow maps already draw the real shadow. */
  setOpacity(v: number) {
    this.material.uniforms.opacity.value = v;
  }

  track(object: THREE.Object3D, opts: BlobOptions = {}): BlobHandle {
    const entry = {
      object,
      radius: opts.radius ?? 0.45,
      strength: opts.strength ?? 1,
    } as Entry;
    entry.handle = {
      object,
      remove: () => {
        const i = this.entries.indexOf(entry);
        if (i >= 0) this.entries.splice(i, 1);
      },
    };
    this.entries.push(entry);
    return entry.handle;
  }

  /** Per frame, after the tracked objects moved. Nearest to `camera` win when over capacity. */
  update(camera?: THREE.Camera) {
    let list = this.entries;
    if (list.length > this.max && camera) {
      const c = camera.position;
      list = list.slice().sort((a, b) => a.object.getWorldPosition(_p).distanceToSquared(c) - b.object.getWorldPosition(_s).distanceToSquared(c));
    }
    let n = 0;
    for (const e of list) {
      if (n >= this.max) break;
      if (!visible(e.object)) continue;
      e.object.getWorldPosition(_p);
      const floor = this.floorAt(_p.x, _p.z, _p.y + 0.3);
      const h = Math.max(0, _p.y - floor);
      const fade = 1 - THREE.MathUtils.smoothstep(h, 0.05, 1.6);
      if (fade <= 0.01) continue;
      const r = e.radius * (1 + h * 0.6) * 2;
      _m.compose(_s.set(_p.x, floor + 0.025, _p.z), _q, _sc.set(r, r, 1));
      this.mesh.setMatrixAt(n, _m);
      this.strengthAttr.setX(n, e.strength * fade);
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.strengthAttr.needsUpdate = true;
    }
  }

  dispose() {
    this.entries.length = 0;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/** Visible and attached to a scene (every ancestor visible). */
function visible(o: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  let root: THREE.Object3D = o;
  while (p) {
    if (!p.visible) return false;
    root = p;
    p = p.parent;
  }
  return (root as THREE.Scene).isScene === true;
}

/** The loaded map's blob pool (set by MapLoader), so gameplay code can ground characters without a map handle. */
let active: BlobShadows | null = null;
export function setActiveBlobs(b: BlobShadows | null) {
  active = b;
}
/** Clears the active pool if it is still `b` (a newer map may have replaced it). */
export function releaseActiveBlobs(b: BlobShadows) {
  if (active === b) active = null;
}
/** Tracks `object` on the current map's blob pool; no-op (null) when none is loaded. */
export function trackBlob(object: THREE.Object3D, opts?: BlobOptions): BlobHandle | null {
  return active?.track(object, opts) ?? null;
}
