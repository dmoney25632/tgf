# Performance

Budgets, how the game hits them, and how to measure. Asset licensing is covered in `docs/ASSET_SOURCES.md`.

## Budgets

| What | Budget | Measured (Nov 2026) |
| --- | --- | --- |
| Initial JS on `/`, `/login`, `/signup`, `/leaderboard`, `/account`, `/credits` | < 180 kB gzip, no Three.js | 156 kB (`/`), 171 kB (auth pages), 154 kB (`/leaderboard`), no Three.js |
| Initial JS on `/play/[gameId]` | < 180 kB gzip; Three.js and the engine load lazily | 298 kB (over budget: the co-op party UI and supabase-js, ~70 kB gzip, load with the lobby), plus an 82 kB gzip lazy Three.js chunk that the lobby prefetches when idle |
| First-match download, High/Medium | < 30 MB | about 29.5 MB (est. 47 MB before re-encoding) |
| First-match download, Low | < 15 MB | about 13.9 MB (est. 43 MB before 512 variants) |
| Frame time | Display refresh, up to 144 Hz. Adaptive quality aims for `1000 / min(refresh, 144)` ms × 1.2 | High at 1024×768: 2.1 ms CPU p50 (3.1 p95), 299 draw calls |
| Long frames after the first 3 s of a match | 0 frames > 50 ms | 0 |
| Draw calls | < 1,500 | about 300 on Dustfall Outpost, High |

Returning players download only the assets that changed: asset URLs carry a content hash (see Delivery).

## Delivery

- **Asset URLs.** `next.config.ts` hashes `public/assets` at build time and exposes the hash as `NEXT_PUBLIC_ASSET_VERSION`. `AssetLoader` requests `/assets/v/<hash>/…`, which a rewrite maps to `/assets/…` and serves with `Cache-Control: public, max-age=31536000, immutable`. Unversioned `/assets/…` URLs get a 1 hour cache with stale-while-revalidate. `_next/static` is already immutable (Next.js).
- **Pages.** Next.js sets page caching: static and PPR shells are cached at the edge, and dynamic or auth responses are not. Don't override `Cache-Control` for pages.
- **Security headers** (all routes): CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (gamepad and fullscreen for self; camera, microphone and geolocation off), `nosniff`, `Cross-Origin-Opener-Policy: same-origin` and HSTS.
  - `script-src` keeps `'unsafe-inline'` because statically prerendered pages carry Next's inline RSC payload. A nonce CSP would force every page to render dynamically (see `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
  - `'wasm-unsafe-eval'` is there for the Basis and meshopt WASM decoders. It does not allow JS `eval`.
  - Pointer lock is not a Permissions-Policy feature in Chrome (the header warns about it), so it isn't listed. It is allowed for top-level documents by default.
- **Content types** are set explicitly for `.gltf`, `.glb`, `.bin`, `.ktx2`, `.hdr` and `.wasm`. Vercel's compressed MIME list doesn't include binary glTF types, so expect `.bin` and `.glb` to be served uncompressed. Check a deploy:
  `curl -sI -H 'Accept-Encoding: br,gzip' https://<deploy>/assets/v/<hash>/models/rock_07/rock_07.bin | grep -i content-encoding`
  If nothing comes back, meshopt quantization still helps (2–4x), but the gzip-on-top gain is lost.

## Assets

- `npm run assets:optimize` (macOS `sips`, no npm deps) re-encodes JPEGs (q80; normals q85) and writes `<kind>_512.jpg` variants for texture sets. It is idempotent: a size ledger in `scripts/optimized-assets.txt` means that re-running it after new assets land only touches the new files. Run it whenever assets are added. `public/assets` went from 48 MB to 33 MB, and texture sets from 23.4 MB to 14.1 MB (3.2 MB for the 512 variants).
- The Low preset (`maxTextureSize <= 512`) requests the `_512` variants and falls back to the full file if a variant is missing.
- Images are decoded and resized off the main thread (`createImageBitmap`, pre-flipped, no colour conversion), with an `<img>` fallback.
- **KTX2 / meshopt.** `AssetLoader` loads glTFs that use `EXT_meshopt_compression` or `KHR_texture_basisu` and fetches the decoders only for those files. Encoding needs `gltfpack` and KTX-Software, which aren't installed here. `npm run assets:ktx2` does a dry run, and `npm run assets:ktx2 -- --write` re-packs the models and copies the Basis transcoder to `public/assets/basis/`. Moving texture sets to `.ktx2` also needs a manifest change and a KTX2 path in `Materials.ts`.
- The HDRI (2k `.hdr`, 4.4 MB) loads only on Medium and High.

## Runtime

- **No frame cap.** One render per `requestAnimationFrame`, and physics runs at a fixed 120 Hz with interpolation (`SIM` in `config.ts`). 120, 144 and 240 Hz panels run at their native rate.
- **Adaptive quality** (`ADAPTIVE` and `adaptivePreset` in `config.ts`, driven by `RenderPipeline`). The refresh rate is estimated from the shortest recent 30-frame average. If the smoothed frame time stays over budget for 2.5 s, quality drops one level:
  1. AO off
  2. Shadow map redrawn every 2nd frame
  3. Resolution ×0.85
  4. MSAA → FXAA
  5. Shadow map at half size
  6. Resolution ×0.7, bloom off, shadows every 3rd frame
  7. Resolution ×0.55

  After 10 s on budget it tries one level up, and the wait doubles each time an upgrade fails within 8 s. No step toggles a shader define, so stepping never recompiles materials. Choosing a preset in the menu resets the level.
- **Shader precompile.** `renderer.compileAsync` runs on both scenes when the match loads, including hidden pooled effects. After that, `GpuWarmup` compiles materials it hasn't seen yet (6 per tick, about every 10 frames) while the scene is "warm": the first 15 s, after a quality change, and when objects are added to the scene root.
- **Texture uploads.** Photo texture sets swap in only after `renderer.initTexture` has uploaded them. The upload queue runs at 3 ms per frame (at least 1 texture), and other not-yet-uploaded scene textures (glTF props) are pre-uploaded the same way. Nothing in `src/game/render` allocates per frame. Scans run only while the scene is warm.
- **Canvas MSAA** is off when the starting preset uses post-processing, because the composer does its own MSAA or FXAA. Switching to Low mid-session then has no AA until a reload.

## How to measure

1. **Bundles:** `npm run build && npm run analyze`. This prints initial JS per route and fails if Three.js reaches an initial bundle.
2. **Production server:** `npm run build && npx next start -p 3306`, then open `/play/iron-horizon`.
3. **In game:** press F3. The `render` line shows fps, frame time against the budget and the estimated refresh rate, the adaptive level, the pixel ratio, compiled programs, GPU textures and uploads. `draw calls` covers every pass of a frame.
4. **Hitches:** from the DevTools console, before deploying:
   `new PerformanceObserver(l => l.getEntries().forEach(e => console.log(e.duration|0))).observe({type: 'long-animation-frame'})`
   Engine construction during the first 3 s still shows about 650 ms (map build and procedural textures in `world/`). After that there should be nothing.
5. **Network:** DevTools Network, filtered to `/assets/v/`. Check the transfer total and confirm a reload serves everything from cache.
6. **Headers:** `curl -sI http://localhost:3306/ | grep -iE 'content-security|permissions|strict'`.
