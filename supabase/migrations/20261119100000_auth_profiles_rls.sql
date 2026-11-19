-- Accounts hardening: least-privilege grants, own-row RLS everywhere, a safer
-- sign-up trigger, and a public leaderboard that exposes only safe columns.
-- Runs after 20261119000000_init.sql. Safe to apply to a fresh project.

-- 1. Table privileges ----------------------------------------------------------
-- Supabase grants ALL on new public tables to anon and authenticated. RLS is
-- the real gate, but strip what no client ever needs as defence in depth.
revoke all on table public.profiles, public.player_stats, public.matches, public.loadouts from anon;

-- profiles: rows are created by the trigger, never by clients, and the only
-- user-editable column is callsign.
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (callsign) on table public.profiles to authenticated;

-- player_stats / matches: written only through record_match() (security definer).
revoke insert, update, delete, truncate, references, trigger on table public.player_stats from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.matches from authenticated;
grant select on table public.player_stats, public.matches to authenticated;

-- loadouts: users manage their own rows (policy below), nothing else.
revoke truncate, references, trigger on table public.loadouts from authenticated;

-- 2. Profiles --------------------------------------------------------------------
-- Callsigns are unique regardless of case ("Ghost" and "ghost" collide).
create unique index if not exists profiles_callsign_lower_key on public.profiles (lower(callsign));

-- Users read only their own profile. Other players' callsigns are public only
-- through the leaderboard (and co-op presence payloads).
drop policy if exists "Profiles are readable by signed-in users" on public.profiles;
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

-- (The "Users update their own profile" policy from init stays; together with
-- the column grant above it allows changing your own callsign only.)

-- Creates the profile row for every new auth user. Runs as the table owner so
-- it can insert despite RLS; search_path is pinned to avoid hijacking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted   text := new.raw_user_meta_data ->> 'callsign';
  fallback text := 'Op-' || substr(replace(new.id::text, '-', ''), 1, 8);
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_-]{3,16}$'
     or exists (select 1 from public.profiles p where lower(p.callsign) = lower(wanted)) then
    wanted := fallback;
  end if;

  begin
    insert into public.profiles (id, callsign) values (new.id, wanted);
  exception when unique_violation then
    -- Lost a race for the same callsign: never block sign-up over it.
    insert into public.profiles (id, callsign) values (new.id, fallback)
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Lets the sign-up form say "callsign taken" before creating the account.
-- Callsigns are already public via the leaderboard, so this leaks nothing new.
create or replace function public.is_callsign_available(p_callsign text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select p_callsign ~ '^[A-Za-z0-9_-]{3,16}$'
     and not exists (select 1 from public.profiles p where lower(p.callsign) = lower(p_callsign));
$$;

revoke execute on function public.is_callsign_available(text) from public;
grant execute on function public.is_callsign_available(text) to anon, authenticated;

-- 3. Stats -----------------------------------------------------------------------
drop policy if exists "Stats are readable by signed-in users" on public.player_stats;
create policy "Users read their own stats"
  on public.player_stats for select to authenticated
  using ((select auth.uid()) = user_id);

alter table public.matches
  add constraint matches_game_id_len check (char_length(game_id) between 1 and 64),
  add constraint matches_mode_len    check (char_length(mode) between 1 and 32),
  add constraint matches_map_len     check (char_length(map) between 1 and 64),
  add constraint matches_hits_le_shots check (shots_hit <= shots_fired);

-- Same contract as init (the server action in src/app/play/[gameId]/actions.ts
-- calls it with these exact parameters), plus a basic flood guard.
create or replace function public.record_match(
  p_game_id text, p_mode text, p_map text,
  p_kills int, p_deaths int, p_shots_fired int, p_shots_hit int, p_won boolean
) returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_shots_hit > p_shots_fired then raise exception 'invalid stats' using errcode = '22023'; end if;
  if exists (
    select 1 from public.matches m
    where m.user_id = uid and m.played_at > now() - interval '10 seconds'
  ) then
    raise exception 'too many matches, slow down' using errcode = '54000';
  end if;

  insert into public.matches (user_id, game_id, mode, map, kills, deaths, shots_fired, shots_hit, won)
  values (uid, p_game_id, p_mode, p_map, p_kills, p_deaths, p_shots_fired, p_shots_hit, p_won);

  insert into public.player_stats as s (user_id, game_id, kills, deaths, shots_fired, shots_hit, matches, wins)
  values (uid, p_game_id, p_kills, p_deaths, p_shots_fired, p_shots_hit, 1, p_won::int)
  on conflict (user_id, game_id) do update set
    kills = s.kills + excluded.kills,
    deaths = s.deaths + excluded.deaths,
    shots_fired = s.shots_fired + excluded.shots_fired,
    shots_hit = s.shots_hit + excluded.shots_hit,
    matches = s.matches + 1,
    wins = s.wins + excluded.wins,
    updated_at = now();
end;
$$;

revoke execute on function public.record_match(text, text, text, int, int, int, int, boolean) from public, anon;
grant execute on function public.record_match(text, text, text, int, int, int, int, boolean) to authenticated;

-- 4. Public leaderboard ------------------------------------------------------------
-- player_stats is own-rows only, so the leaderboard reads it through a
-- security definer function that returns ONLY safe columns (no user ids, no
-- emails). The view itself is security_invoker, so it never bypasses RLS on
-- its own and the Supabase linter stays quiet.
create or replace function public.leaderboard_rows()
returns table (
  game_id  text,
  callsign text,
  matches  integer,
  wins     integer,
  kills    integer,
  deaths   integer,
  accuracy numeric
)
language sql
stable
security definer set search_path = ''
as $$
  select s.game_id,
         p.callsign,
         s.matches,
         s.wins,
         s.kills,
         s.deaths,
         case when s.shots_fired > 0
              then round(100.0 * s.shots_hit / s.shots_fired, 1)
              else 0 end as accuracy
  from public.player_stats s
  join public.profiles p on p.id = s.user_id
  where s.matches > 0;
$$;

revoke execute on function public.leaderboard_rows() from public;
grant execute on function public.leaderboard_rows() to anon, authenticated;

create or replace view public.leaderboard
with (security_invoker = true) as
  select * from public.leaderboard_rows();

revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

comment on view public.leaderboard is
  'Public per-game leaderboard: callsign + aggregate stats only. Query with .order(''kills'', { ascending: false }).';
