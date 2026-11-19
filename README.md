# TGF

A platform for original browser-based first-person games. The first title is **Iron Horizon**, a grounded modern military FPS (original names, maps and weapons throughout).

## Stack

- **Site:** Next.js 16 (App Router, Cache Components) + TypeScript + Tailwind v4 + shadcn/ui
- **Auth / DB:** Supabase (email/password + GitHub OAuth, Postgres with RLS)
- **Game:** Three.js, lazily loaded on `/play/[gameId]` so it never ships with the rest of the site

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL + publishable key
npm run dev
```

Without Supabase keys the app runs in **offline dev mode**: auth is skipped, you're a local guest, and the dashboard and game are still reachable. That makes it easy to work on the game alone.

### Checks

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # headless smoke tests (tests/*.test.ts, Node's built-in runner)
npm run build       # production build
```

### Performance and assets

```bash
npm run analyze          # after a build: initial JS per route, fails if three.js leaks into one
npm run assets:optimize  # macOS: re-encode new JPEGs + write 512px Low variants (idempotent)
npm run assets:ktx2      # KTX2 textures + meshopt geometry; needs gltfpack and KTX-Software (toktx),
                         # which are not installed by this repo. Dry run unless given -- --write
```

Budgets, caching and security headers, adaptive quality, and how to profile are covered in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

The tests run the game's pure TypeScript modules (wave rules, vitals, economy, navigation on Dustfall Outpost) directly in Node, with no browser or WebGL needed.

### Supabase setup

1. Create a project at supabase.com and copy the URL and publishable (anon) key into `.env.local`.
2. Apply the schema in `supabase/migrations/` (`supabase db push`, or paste it into the SQL editor).
3. Under **Auth → URL Configuration**, add `http://localhost:3000/auth/callback` as a redirect URL.
4. Optional: enable the GitHub provider under **Auth → Providers**.

## Iron Horizon modes

- **Survival** (Dustfall Outpost): wave-based co-op defense with two AI squadmates. Each wave is followed by an intermission where the armories (buy stations) and ammo crates come online. You win by clearing the target wave (10, 15, 20) or play endless; the match is lost if the whole team is down at once.
  - Waves 1–3: Riflemen.
  - Waves 4–6: adds Breachers (shotgun rushers) and Juggernauts (armored).
  - Waves 7–9: adds Marksmen (snipers on the corner perches, laser telegraph before firing).
  - Wave 10+: The Warden mini-boss every 5 waves, plus elites (red armbands and helmet stripe): about 25–55% of riflemen, Breachers and Juggernauts, with 1.6× health, more damage and accuracy, and a bigger bounty.
- **Firing Range** (Kestrel Yard): pop-up targets and steel plates for tuning your aim.

The lobby picks the operator (Assault / Support / Recon / Heavy), primary and secondary, difficulty, wave target, squad size and start wave.

## Layout

```
src/
  app/
    page.tsx                 landing
    (auth)/login, signup     auth pages + server actions
    auth/callback, signout   Supabase code exchange / sign-out
    dashboard/               game selection (protected)
    play/[gameId]/           fullscreen game host (protected) + saveMatch server action
  proxy.ts                   session refresh + auth redirects (Next 16's "middleware")
  lib/
    games.ts                 game registry rendered by the dashboard
    supabase/                server and proxy clients
  components/game/           lobby, operator preview, shop overlay, match summary, game host
  game/                      Iron Horizon engine (framework-free TypeScript)
    config.ts                movement / look / camera / shake / quality tuning
    core/Engine.ts           loop: input → look → 120 Hz physics → camera → weapons → grenades → mode → fx → HUD → render
    core/GameMode.ts         GameMode interface; RangeMode and SurvivalGameMode plug into the engine
    player/PlayerController  accel/brake, air momentum, coyote, jump buffer, slide, step-up, downed crawl
    weapons/                 7 guns + knife (weapons.ts), WeaponSystem, viewmodels, GrenadeSystem
    ai/                      NavGrid (A* + cover points), Agent, AgentManager (staggered 5 Hz thinking), Humanoid models
    survival/                SurvivalGameMode, WaveManager, EnemySpawner, ShopSystem, PlayerLoadout, PlayerState, config
    effects/                 pooled particles, tracers, decals, explosions; camera shake
    render/RenderPipeline    quality presets, shadows, bloom, GTAO, grading, MSAA/FXAA
    world/                   MapLoader, Collision (AABB + raycast/LOS), maps/kestrelYard, maps/dustfallOutpost
    targets/TargetRange      pop-up targets + ringing steel plates
    ui/                      HUD (crosshair, ammo, hitmarkers, scoreboard, F3 debug) + SurvivalHUD (wave, team, money, damage numbers)
    audio/Sfx.ts             procedural Web Audio: gunshots, reverb, spatial enemy fire, explosions, UI cues
supabase/migrations/         profiles, player_stats, matches, loadouts + record_match()
tests/                       headless smoke tests + a tiny loader so Node can run the TS sources
```

All survival tuning (enemy stats, wave composition, economy, difficulty, perks, operators) lives in `src/game/survival/config.ts`.

## Controls

WASD move · Shift sprint · C crouch (toggle) / Ctrl (hold) · C while sprinting slides · Space jump · LMB fire · RMB aim · R reload · V knife · G frag · 1-2/Q/wheel swap · F interact / revive / armory · N ready up · Tab scoreboard · F3 debug · Esc pause

## Roadmap

1. ✅ Next.js + Supabase auth, protected dashboard
2. ✅ Game selection UI
3. ✅ FPS movement and feel pass
4. ✅ Hitscan shooting, recoil, ADS, 7 weapons + knife + grenades
5. ✅ Maps: Kestrel Yard (range), Dustfall Outpost (survival)
6. ✅ AI soldiers with navigation, cover, flinch and imperfect aim
7. ✅ Survival mode: waves, shop, operators, perks, squadmates, revives, end summary, stats via `record_match()`
8. ⬜ Team Deathmatch vs bots
9. ⬜ Touch controls
10. ⬜ Multiplayer networking (real co-op)
