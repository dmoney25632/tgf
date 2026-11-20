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

Without Supabase keys the app runs in **offline dev mode**: auth is skipped, you're a local guest, and the lobby and game are still reachable. That makes it easy to work on the game alone.

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

Without these steps the site still runs in **guest mode** (solo play only). Accounts unlock co-op and saved stats.

**1. Create the project (free tier is fine)**

- supabase.com → New project. Save the database password somewhere safe (a password manager).
- **Project Settings → API**: copy the Project URL and the **publishable** key (`sb_publishable_…`; the legacy `anon` key also works) into `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
- **Connect** button → connection strings: put the **transaction pooler** URI (port 6543) in `DATABASE_URL` and the **session pooler** (port 5432) or direct URI in `DIRECT_URL`. These are for the CLI only.
- Never put the `service_role` / secret key in this app or in any `NEXT_PUBLIC_` variable. Nothing here needs it.

**2. Run the migrations** (in order: `init`, `auth_profiles_rls`, `realtime_coop_channels`)

- With the CLI: `npx supabase login`, `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`. Or skip linking with `npx supabase db push --db-url "$DIRECT_URL"`.
- Or without the CLI: paste each file in `supabase/migrations/` into **SQL Editor** and run them oldest first.
- Check: **Database → Tables** shows `profiles`, `player_stats`, `matches`, `loadouts`, each with RLS enabled, and **Advisors → Security** has no errors.

**3. Turn on email confirmation**

- **Authentication → Sign In / Providers → Email**: Email enabled, **Confirm email** ON, minimum password length 8.

**4. URLs** (**Authentication → URL Configuration**)

- **Site URL**: your production domain, e.g. `https://your-app.vercel.app` (use `http://localhost:3000` until you deploy).
- **Redirect URLs**: `http://localhost:3000/**` and `https://your-app.vercel.app/**` (add `https://*-<your-team>.vercel.app/**` for preview deploys).

**5. Email templates** (**Authentication → Emails → Templates**)

The SSR confirm route (`/auth/confirm`) verifies a `token_hash`, so the links must use `{{ .TokenHash }}` instead of the default `{{ .ConfirmationURL }}`. Ready-made bodies are in `supabase/templates/`:

| Template | Link |
| --- | --- |
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` |
| Change email address | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change` |

`{{ .SiteURL }}` is the Site URL from step 4, so email links always open on that domain. To test sign-up locally, set Site URL to `http://localhost:3000` temporarily.

**6. SMTP (recommended before real players)**

The built-in email sender on the free tier is for testing only: it sends just a few emails per hour, and sometimes only to your team's addresses. Sign-ups past that fail with "Too many attempts". For real use, add a custom SMTP provider under **Authentication → Emails → SMTP Settings** (Resend, Postmark, Amazon SES, and others have free tiers), then raise the email rate limit under **Authentication → Rate Limits**.

**7. Realtime for co-op**

The `realtime_coop_channels` migration adds RLS policies on `realtime.messages`: any **signed-in** user may send and receive **Broadcast** and **Presence** on private channels whose topic starts with `coop:` (e.g. `coop:K7QX2`). Anonymous users and other topics are denied. Clients must join with `supabase.channel("coop:" + code, { config: { private: true } })`, using the browser client from `src/lib/supabase/client.ts`. Then, under **Realtime → Settings**, turn **off** "Allow public access" so that only private (authorized) channels work.

**8. Vercel** (**Project → Settings → Environment Variables**)

| Variable | Value | Environments |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `_ANON_KEY`) | publishable key | Production, Preview, Development |
| `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` | Production (leave unset for Preview, which then uses the request origin) |
| `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS` | optional, e.g. `github` | as needed |

Do **not** add `DATABASE_URL` / `DIRECT_URL` to Vercel: the app never connects to Postgres directly. Redeploy after changing variables, since `NEXT_PUBLIC_` values are baked in at build time.

**Optional: OAuth.** Enable a provider under **Authentication → Sign In / Providers** (callback URL shown there), then list it in `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS`. Only `github`, `google` and `discord` are accepted. OAuth users get a generated `Op-xxxxxxxx` callsign that they can change on `/account`.

**What the schema guarantees**

- `profiles` (id → `auth.users`, unique case-insensitive callsign `^[A-Za-z0-9_-]{3,16}$`, created_at) is created by a `SECURITY DEFINER` trigger on sign-up. Users can read only their own row and update only `callsign`.
- `matches` and `player_stats` can be read only by their owner, and are written only through `record_match()`, which takes the user id from the JWT. It has a 10-second flood guard.
- `leaderboard` view is public (anon and authenticated) and exposes only callsign, game and aggregate totals: no user ids or emails.
- RLS is on for every table. The app uses only the publishable key.

**Auth routes:** `/signup` → email → `/auth/confirm` → lobby (`/dashboard` in the email template redirects there); `/login`; `/forgot-password` → email → `/auth/confirm` → `/reset-password`; `/check-email` (resend confirmation); `/account` (callsign, stats, change password); `POST /auth/signout`; `/auth/callback` (OAuth).

## Iron Horizon modes

- **Survival** (Dustfall Outpost): wave-based co-op defense with two AI squadmates. Each wave is followed by an intermission where the armories (buy stations) and ammo crates come online. You win by clearing the target wave (10, 15, 20) or play endless; the match is lost if the whole team is down at once.
  - Waves 1–3: Riflemen.
  - Waves 4–6: adds Breachers (shotgun rushers) and Juggernauts (armored).
  - Waves 7–9: adds Marksmen (snipers on the corner perches, laser telegraph before firing).
  - Wave 10+: The Warden mini-boss every 5 waves, plus elites (red armbands and helmet stripe): about 25–55% of riflemen, Breachers and Juggernauts, with 1.6× health, more damage and accuracy, and a bigger bounty.
- **Firing Range** (Kestrel Yard): pop-up targets and steel plates for tuning your aim.

The lobby picks the operator (Assault / Support / Recon / Heavy), primary and secondary, difficulty, wave target, squad size and start wave.

## Architecture

The site is a thin Next.js shell around a framework-free game engine. Code only flows one way: `src/app` and `src/components` may import `src/game`, never the reverse, and nothing outside `/play` imports Three.js.

| Module | Path | What lives there |
| --- | --- | --- |
| App shell | `src/app/`, `src/components/`, `src/lib/` | Routes, auth, lobby UI and overlays. `play/[gameId]` is the only route that loads game code. |
| Game engine | `src/game/core/` | `Engine.ts` (the loop: input → look → 120 Hz physics → camera → weapons → mode → fx → HUD → render), `GameMode` (interface each mode implements), `RangeMode`, input. |
| Render | `src/game/render/` | `RenderPipeline` (quality presets, shadows, bloom, AO, grading, AA), materials, sky/atmosphere, GPU warm-up. |
| World and maps | `src/game/world/` | `MapLoader` builds a `MapDef` into meshes + collision; `maps/` holds map data and `registry.ts`; `dressing/` adds terrain, foliage and props per map; `architecture/` holds reusable building kits. |
| Survival | `src/game/survival/` | `SurvivalGameMode`, waves, spawner, shop, loadouts. All tuning (enemies, waves, economy, difficulty, operators, perks) is in `config.ts`. |
| Net | `src/game/net/` | Co-op: transport interface with a Supabase Realtime and a same-browser loopback implementation, protocol/codec, interpolation, host-side hit validation. |
| Audio | `src/game/audio/` | Procedural Web Audio effects and voices (no audio files). |
| Weapons, AI, player | `src/game/weapons/`, `src/game/ai/`, `src/game/player/` | Weapon stats + viewmodels, AI soldiers and navigation, the movement controller. |
| HUD and settings | `src/game/ui/` | DOM HUDs drawn by the engine, settings model + persistence, load progress tracking. |

```
src/
  app/
    page.tsx                 landing
    (auth)/                  login, signup, password reset, check-email + server actions
    auth/                    Supabase confirm, OAuth callback, sign-out route handlers
    play/[gameId]/           lobby + game host (protected), saveMatch and lobby-data server actions
    leaderboard/ account/    public board, profile and stats
    credits/                 asset attributions
    coop/dev/                dev-only split-screen co-op harness (404 in production)
  proxy.ts                   session refresh + auth redirects (Next 16's "middleware")
  components/
    game/                    lobby, loading screen, pause/shop/summary overlays, game host, game-shell (error boundary, WebGL context-loss prompt)
    coop/                    party room and co-op match host
    auth/ ui/                forms and shadcn primitives
  lib/
    games.ts                 games served under /play
    auth.ts                  getCurrentUser / requireUser (offline guest, unreachable Supabase)
    supabase/                server, proxy and browser clients, validation, config
  game/                      the engine (see the table above)
supabase/migrations/         schema, RLS, record_match(), leaderboard view
tests/                       headless tests of the pure game modules + auth rules (Node test runner)
```

Retired routes (`/dashboard`, `/coop`, `/missions`) are redirects in `next.config.ts`. The Missions game mode still exists in `src/game/missions/` (engine-supported, tested) but has no screen in the lobby.

### Loading

The play route ships the lobby only. The engine and Three.js are dynamic imports: the lobby warms them in idle time (`components/game/prefetch-engine.ts`), and `GameView` imports them on Deploy. The loading screen's bar follows real asset loads through `game/ui/LoadProgress.ts`. Game assets are requested from `/assets/v/<hash>/…` and cached as immutable (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)); `npm run analyze` fails the check if Three.js ever reaches an initial route bundle.

### Adding a map

1. Create `src/game/world/maps/<name>.ts` exporting a `MapDef` (boxes, spawns, and a `survival` layout with enemy spawns, sniper perches, buy stations and ammo crates if it is a Survival map).
2. Optional: a set-dressing in `src/game/world/dressing/<name>.ts`, registered in `dressing/index.ts` and referenced by `MapDef.dressing`.
3. Register it in `src/game/world/maps/registry.ts` (id, name, lobby blurb). Survival maps then show up in the lobby automatically; add it to `COOP_MAPS` in `src/game/net/ids.ts` for parties.
4. Add a test like `tests/brennhollow.test.ts` (spawns reachable on the nav grid, no stuck props).

### Adding a weapon

1. Add an entry to `WEAPONS` in `src/game/weapons/weapons.ts` (stats, slot, shop `price`, viewmodel `model` kind). Append it at the end: co-op sends weapons by index.
2. If it needs a new look, add a builder to `GUN_BUILDERS` in `src/game/weapons/viewmodel/guns.ts`.
3. It appears in the lobby and the armory by slot. Give it to an operator in `src/game/survival/config.ts` if it should be a default.

### Adding a game mode

Implement `GameMode` (`src/game/core/GameMode.ts`), construct it in `Engine.ts` for its mode id, and add the option to the lobby (`components/game/lobby.tsx`).

## Controls

WASD move · Shift sprint · C crouch (toggle) / Ctrl (hold) · C while sprinting slides · Space jump · LMB fire · RMB aim · R reload · V knife · G frag · 1-2/Q/wheel swap · F interact / revive / armory · N ready up · Tab scoreboard · F3 debug · Esc pause

## Roadmap

1. ✅ Next.js + Supabase auth, protected lobby
2. ✅ Game selection UI
3. ✅ FPS movement and feel pass
4. ✅ Hitscan shooting, recoil, ADS, 7 weapons + knife + grenades
5. ✅ Maps: Kestrel Yard (range), Dustfall Outpost (survival)
6. ✅ AI soldiers with navigation, cover, flinch and imperfect aim
7. ✅ Survival mode: waves, shop, operators, perks, squadmates, revives, end summary, stats via `record_match()`
8. ⬜ Team Deathmatch vs bots
9. ⬜ Touch controls
10. ⬜ Multiplayer networking (real co-op)
