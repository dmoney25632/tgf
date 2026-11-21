import * as THREE from "three";
import type { QualityPreset } from "../config";
import { MATERIAL_TEXTURES, TEXTURE_SETS, type MaterialName } from "../assets/manifest";
import { isPreFlipped, loadCompressedTextureSet, loadTextureSet, type TextureSetImages } from "../assets/AssetLoader";
import { textureUploads } from "./GpuWarmup";
import { grimePixels, makeDataTexture, proceduralPixels, type ProceduralKind } from "./ProceduralTextures";

export type { MaterialName };

type MaterialDef = {
  procedural: ProceduralKind;
  /** Metres covered by one texture repeat (geometry UVs are in metres). */
  tile: number;
  roughness: number;
  metalness: number;
  normalScale: number;
  /** Ground-splash / streak grime strength (0 = none). */
  grime: number;
  /** Colour shown while the photo texture streams in (sRGB). */
  placeholder: number;
};

const DEFS: Record<MaterialName, MaterialDef> = {
  concrete: { procedural: "concrete", tile: 3, roughness: 1, metalness: 0, normalScale: 1, grime: 0.55, placeholder: 0x8c8b84 },
  concrete_dirty: { procedural: "concrete", tile: 3.5, roughness: 1, metalness: 0, normalScale: 1, grime: 0.6, placeholder: 0x7d7c75 },
  brick: { procedural: "brick", tile: 2.2, roughness: 1, metalness: 0, normalScale: 1.2, grime: 0.55, placeholder: 0x7a4c3a },
  metal_corrugated: { procedural: "corrugated", tile: 2.4, roughness: 1, metalness: 0.3, normalScale: 1.4, grime: 0.45, placeholder: 0x6c6f68 },
  metal_painted: { procedural: "rust", tile: 2.2, roughness: 1, metalness: 0.25, normalScale: 0.8, grime: 0.45, placeholder: 0x8a8a84 },
  metal_rust: { procedural: "rust", tile: 1.4, roughness: 1, metalness: 0.35, normalScale: 1, grime: 0.3, placeholder: 0x7a5a40 },
  metal_dark: { procedural: "metal", tile: 1.5, roughness: 1, metalness: 0.55, normalScale: 0.6, grime: 0.35, placeholder: 0x505254 },
  wood: { procedural: "wood", tile: 1.6, roughness: 1, metalness: 0, normalScale: 1, grime: 0.5, placeholder: 0x5a5046 },
  sandbag: { procedural: "canvas", tile: 0.7, roughness: 1, metalness: 0, normalScale: 1, grime: 0.6, placeholder: 0x9a8d74 },
  canvas: { procedural: "canvas", tile: 1.4, roughness: 1, metalness: 0, normalScale: 0.8, grime: 0.3, placeholder: 0x8a8670 },
  gravel: { procedural: "gravel", tile: 3, roughness: 1, metalness: 0, normalScale: 1, grime: 0, placeholder: 0x7f7666 },
  ground: { procedural: "ground", tile: 4, roughness: 1, metalness: 0, normalScale: 1, grime: 0, placeholder: 0x5c5236 },
  rock: { procedural: "rock", tile: 3.2, roughness: 1, metalness: 0, normalScale: 1.2, grime: 0.3, placeholder: 0x77736a },
  bark: { procedural: "bark", tile: 1.2, roughness: 1, metalness: 0, normalScale: 1.2, grime: 0.2, placeholder: 0x3e3428 },
  plain: { procedural: "plain", tile: 2, roughness: 0.85, metalness: 0, normalScale: 0.3, grime: 0, placeholder: 0x808080 },
};

export type TextureSlot = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
  ao: THREE.Texture | null;
  /** True once real files (not placeholder/procedural) are bound. */
  photo: boolean;
};

const WHITE = new Uint8Array([255, 255, 255, 255]);

/** A loaded map: an image source, or a KTX2 template texture to clone. */
type SetSource = THREE.TextureSource<unknown> | THREE.CompressedTexture;

/** 1×1 sRGB texture of a hex colour (hex values are already sRGB-encoded). */
function solidTexture(hex: number) {
  const data = new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function flatTexture(bytes: Uint8Array) {
  const t = new THREE.DataTexture(bytes, 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Per-map weathering shared by every grime-patched material (process-wide,
 * like SkyOcclusion's uniforms: materials are patched once, each map writes
 * its own values on load). Upward faces and the splash zone at the foot of
 * walls pick up the colour: moss and lichen in green maps, dust in dry ones.
 */
export const WORLD_WEATHER = {
  weatherColor: { value: new THREE.Color(0xa89878) },
  weatherAmount: { value: 0.35 },
};

export type WeatherDef = { color: number; amount: number };

export function setWorldWeather(w: Partial<WeatherDef> | undefined) {
  WORLD_WEATHER.weatherColor.value.setHex(w?.color ?? 0xa89878);
  WORLD_WEATHER.weatherAmount.value = w?.amount ?? 0.35;
}

/**
 * Weathering GLSL (inside main, after map_fragment): needs a world position,
 * a noise texture and the world-space face normal. Defines float gW.
 */
const weatherGlsl = (world: string, noise: string, normal: string, strength: string) => /* glsl */ `
        // Weathering: patchy on upward faces, creeping up from the ground on walls.
        vec4 gWA = texture2D(${noise}, ${world}.xz * 0.037 + vec2(${world}.y * 0.021));
        vec4 gWC = texture2D(${noise}, ${world}.xz * 0.21 + ${world}.y * 0.13);
        float gPatch = smoothstep(0.46, 0.72, gWA.g * 0.3 + gWC.r * 0.7);
        // Crevices (dark mortar lines, seams; linear albedo) fill first.
        float gCrev = 1.0 - smoothstep(0.012, 0.07, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
        float gTop = smoothstep(0.6, 0.92, ${normal}.y);
        float gFoot = (1.0 - abs(${normal}.y)) * (1.0 - smoothstep(0.0, 0.4 + gWC.b * 1.1, ${world}.y));
        float gW = clamp(weatherAmount * max(gPatch, gCrev * 0.85) * (gTop * 0.9 + gFoot * 0.8) * ${strength}, 0.0, 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, weatherColor * mix(0.72, 1.18, gWC.g), gW);`;

let sharedNoise: THREE.DataTexture | null = null;
/** Process-wide grime/noise texture for materials outside a MaterialLibrary (never disposed; 256²). */
function weatherNoise() {
  return (sharedNoise ??= makeDataTexture(grimePixels(256), 256, false, 2));
}

/**
 * Adds the map's weathering (moss / dust, see WORLD_WEATHER) to any lit
 * standard material that isn't built by the MaterialLibrary, e.g. a map's
 * own procedural stone. `strength` scales it for this material (setts < walls).
 */
export function applyWeathering(m: THREE.MeshStandardMaterial, strength = 1) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  const uniforms = { weatherNoiseMap: { value: weatherNoise() }, weatherStrength: { value: strength } };
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms, WORLD_WEATHER);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWxWorld;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWxWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D weatherNoiseMap;\nuniform float weatherStrength;\nuniform vec3 weatherColor;\nuniform float weatherAmount;\nvarying vec3 vWxWorld;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec3 gWN = normalize(cross(dFdx(vWxWorld), dFdy(vWxWorld)));${weatherGlsl("vWxWorld", "weatherNoiseMap", "gWN", "weatherStrength")}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, gW);");
  };
  m.customProgramCacheKey = () => `${prevKey()}|weather`;
}

/**
 * Shared world-space grime used by every structural material: macro albedo
 * variation (breaks up tiling), dirt splash near the ground, and vertical
 * rain streaks on walls. Needs only the world position, which it derives
 * from the view-space position so instancing/skinning stay correct.
 */
function grimeHook(uniforms: { grimeMap: { value: THREE.Texture }; grimeAmount: { value: number }; grimeColor: { value: THREE.Color } }) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, WORLD_WEATHER);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrimeWorld;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvGrimeWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D grimeMap;\nuniform float grimeAmount;\nuniform vec3 grimeColor;\nuniform vec3 weatherColor;\nuniform float weatherAmount;\nvarying vec3 vGrimeWorld;",
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        vec3 gN = normalize(cross(dFdx(vGrimeWorld), dFdy(vGrimeWorld)));
        float gVert = 1.0 - abs(gN.y);
        vec4 gA = texture2D(grimeMap, vGrimeWorld.xz * 0.037 + vec2(vGrimeWorld.y * 0.021));
        vec4 gB = texture2D(grimeMap, vec2((vGrimeWorld.x + vGrimeWorld.z) * 0.35, vGrimeWorld.y * 0.045));
        diffuseColor.rgb *= mix(0.8, 1.12, gA.r);
        float gSplash = clamp((1.0 - smoothstep(0.0, 0.8 + gA.b * 0.7, vGrimeWorld.y)) * grimeAmount * (0.45 + gB.g), 0.0, 0.85);
        float gStreak = gVert * smoothstep(0.55, 0.85, gB.g) * grimeAmount * 0.35;
        diffuseColor.rgb = mix(diffuseColor.rgb, grimeColor, gSplash);
        diffuseColor.rgb *= 1.0 - gStreak;
        ${weatherGlsl("vGrimeWorld", "grimeMap", "gN", "(0.55 + grimeAmount)")}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, max(gSplash, gW));",
      );
  };
}

/**
 * Named PBR materials for the world. Each starts with either a procedural
 * texture set or (when the manifest lists photo textures) a 1×1 placeholder,
 * then swaps in the photo maps when they finish loading — without changing
 * shader defines, so nothing recompiles. Geometry UVs are in metres; each
 * material's texture repeat converts that to its tile size.
 */
export class MaterialLibrary {
  private readonly slots = new Map<MaterialName, TextureSlot>();
  private readonly materials = new Map<MaterialName, THREE.MeshStandardMaterial>();
  private readonly listeners = new Set<() => void>();
  private readonly sources = new Map<string, Promise<Partial<Record<string, SetSource>> | null>>();
  private readonly owned: { dispose(): void }[] = [];
  readonly grimeTexture: THREE.DataTexture;
  private disposed = false;

  constructor(private readonly quality: QualityPreset) {
    this.grimeTexture = makeDataTexture(grimePixels(256), 256, false, 2);
    this.owned.push(this.grimeTexture);
  }

  tile(name: MaterialName) {
    return DEFS[name].tile;
  }

  /** Called whenever photo textures replace placeholders. */
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private makeProcedural(name: MaterialName) {
    const def = DEFS[name];
    const size = this.quality.proceduralTextureSize;
    const px = proceduralPixels(def.procedural, size);
    const a = this.quality.anisotropy;
    return {
      albedo: makeDataTexture(px.albedo, size, true, a),
      normal: makeDataTexture(px.normal, size, false, a),
      rough: makeDataTexture(px.rough, size, false, a),
    };
  }

  private setRepeat(slot: TextureSlot, tile: number) {
    for (const t of [slot.albedo, slot.normal, slot.rough, slot.ao]) t?.repeat.set(1 / tile, 1 / tile);
  }

  /** Texture maps for a material (created + streamed on first use). */
  textures(name: MaterialName): TextureSlot {
    let slot = this.slots.get(name);
    if (slot) return slot;
    const def = DEFS[name];
    const setId = MATERIAL_TEXTURES[name];
    const entry = setId ? TEXTURE_SETS[setId] : undefined;
    if (setId && entry && typeof window !== "undefined") {
      slot = {
        albedo: solidTexture(def.placeholder),
        normal: flatTexture(new Uint8Array([128, 128, 255, 255])),
        rough: flatTexture(new Uint8Array([255, 230, 0, 255])),
        ao: entry.maps.includes("ao") ? flatTexture(WHITE) : null,
        photo: false,
      };
      this.stream(name, setId);
    } else {
      slot = { ...this.makeProcedural(name), ao: null, photo: false };
    }
    this.setRepeat(slot, def.tile);
    this.slots.set(name, slot);
    return slot;
  }

  private loadSources(setId: string) {
    let p = this.sources.get(setId);
    if (!p) {
      const max = this.quality.maxTextureSize;
      // GPU-compressed copies when supported, else the JPEGs.
      p = loadCompressedTextureSet(setId, max).then(async (ktx) => {
        if (ktx) return ktx;
        const imgs: TextureSetImages | null = await loadTextureSet(setId, max);
        if (!imgs) return null;
        const out: Partial<Record<string, THREE.TextureSource<unknown>>> = {};
        for (const [k, img] of Object.entries(imgs)) if (img) out[k] = new THREE.TextureSource(img);
        return out;
      });
      this.sources.set(setId, p);
    }
    return p;
  }

  private stream(name: MaterialName, setId: string) {
    void this.loadSources(setId).then((src) => {
      if (this.disposed) return;
      const slot = this.slots.get(name);
      if (!slot) return;
      const mk = (s: SetSource | undefined, srgb: boolean) => {
        if (!s) return null;
        // KTX2: clone the cached template (shared source = one upload; encoded
        // pre-flipped). Images: wrap the shared source.
        const ktx = s instanceof THREE.CompressedTexture;
        const t = ktx ? s.clone() : new THREE.Texture();
        if (!ktx) {
          t.source = s;
          // ImageBitmaps arrive pre-flipped; WebGL ignores UNPACK_FLIP_Y for them.
          t.flipY = !isPreFlipped(s.data);
        }
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.quality.anisotropy;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
        return t;
      };
      let next: Omit<TextureSlot, "photo"> & { photo: boolean };
      if (!src || !src.albedo) {
        // Photo set failed: fall back to the procedural maps.
        const p = this.makeProcedural(name);
        next = { albedo: p.albedo, normal: p.normal, rough: p.rough, ao: slot.ao, photo: false };
      } else {
        const fallback = !src.normal || !src.roughness ? this.makeProcedural(name) : null;
        const albedo = mk(src.albedo, true)!;
        next = {
          albedo,
          normal: mk(src.normal, false) ?? fallback!.normal,
          rough: mk(src.roughness, false) ?? fallback!.rough,
          ao: slot.ao ? (mk(src.ao, false) ?? slot.ao) : null,
          photo: true,
        };
        if (fallback) fallback.albedo.dispose();
      }
      // Upload over the next frames (GpuWarmup drains the queue under a time
      // budget), then swap them in: the placeholder stays bound until then,
      // so a burst of arriving sets never stalls one frame.
      textureUploads.enqueue([next.albedo, next.normal, next.rough, next.ao], () => {
        if (this.disposed) {
          for (const t of [next.albedo, next.normal, next.rough, next.ao]) if (t && t !== slot.ao) t.dispose();
          return;
        }
        const old = [slot.albedo, slot.normal, slot.rough, slot.ao];
        Object.assign(slot, next);
        this.setRepeat(slot, DEFS[name].tile);
        const m = this.materials.get(name);
        if (m) this.bind(m, slot);
        for (const t of old) if (t && t !== slot.ao) t.dispose();
        for (const fn of this.listeners) fn();
      });
    });
  }

  private bind(m: THREE.MeshStandardMaterial, slot: TextureSlot) {
    m.map = slot.albedo;
    m.normalMap = slot.normal;
    m.roughnessMap = slot.rough;
    m.aoMap = slot.ao;
  }

  /** Shared material for a name (vertex colours carry per-object tint). */
  get(name: MaterialName): THREE.MeshStandardMaterial {
    let m = this.materials.get(name);
    if (m) return m;
    const def = DEFS[name];
    const slot = this.textures(name);
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: def.roughness,
      metalness: def.metalness,
      normalScale: new THREE.Vector2(def.normalScale, def.normalScale),
      aoMapIntensity: 0.9,
    });
    m.name = `ih-${name}`;
    this.bind(m, slot);
    if (def.grime > 0) {
      m.onBeforeCompile = grimeHook({
        grimeMap: { value: this.grimeTexture },
        grimeAmount: { value: def.grime },
        grimeColor: { value: new THREE.Color(0x3b3428) },
      });
      m.customProgramCacheKey = () => "ih-grime-v2";
    }
    this.materials.set(name, m);
    return m;
  }

  dispose() {
    this.disposed = true;
    for (const m of this.materials.values()) m.dispose();
    for (const s of this.slots.values()) for (const t of [s.albedo, s.normal, s.rough, s.ao]) t?.dispose();
    for (const d of this.owned) d.dispose();
    this.materials.clear();
    this.slots.clear();
    this.listeners.clear();
  }
}
