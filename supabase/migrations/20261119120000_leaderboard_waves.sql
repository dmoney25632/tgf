-- Survival leaderboard: furthest wave + richer lifetime stats.
--
-- matches gains the wave reached, headshots and score; player_stats keeps the
-- best wave / best score plus lifetime waves cleared and headshots. Still
-- written only through record_match() (security definer, user id from the
-- JWT); the new parameters default to 0 so older clients keep working.

-- 1. Columns ----------------------------------------------------------------------
alter table public.matches
  add column if not exists wave      integer not null default 0 check (wave between 0 and 1000),
  add column if not exists headshots integer not null default 0 check (headshots between 0 and 500),
  add column if not exists score     integer not null default 0 check (score between 0 and 10000000);

alter table public.player_stats
  add column if not exists best_wave     integer not null default 0,
  add column if not exists waves_cleared integer not null default 0,
  add column if not exists headshots     integer not null default 0,
  add column if not exists best_score    integer not null default 0,
  add column if not exists best_wave_at  timestamptz;

-- 2. record_match with the new fields -------------------------------------------------
drop function if exists public.record_match(text, text, text, int, int, int, int, boolean);

create function public.record_match(
  p_game_id text, p_mode text, p_map text,
  p_kills int, p_deaths int, p_shots_fired int, p_shots_hit int, p_won boolean,
  p_wave int default 0, p_headshots int default 0, p_score int default 0
) returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  w int := greatest(0, least(coalesce(p_wave, 0), 1000));
  hs int := greatest(0, least(coalesce(p_headshots, 0), p_kills));
  sc int := greatest(0, least(coalesce(p_score, 0), 10000000));
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_shots_hit > p_shots_fired then raise exception 'invalid stats' using errcode = '22023'; end if;
  if exists (
    select 1 from public.matches m
    where m.user_id = uid and m.played_at > now() - interval '10 seconds'
  ) then
    raise exception 'too many matches, slow down' using errcode = '54000';
  end if;

  insert into public.matches (user_id, game_id, mode, map, kills, deaths, shots_fired, shots_hit, won, wave, headshots, score)
  values (uid, p_game_id, p_mode, p_map, p_kills, p_deaths, p_shots_fired, p_shots_hit, p_won, w, hs, sc);

  insert into public.player_stats as s
    (user_id, game_id, kills, deaths, shots_fired, shots_hit, matches, wins, best_wave, waves_cleared, headshots, best_score, best_wave_at)
  values
    (uid, p_game_id, p_kills, p_deaths, p_shots_fired, p_shots_hit, 1, p_won::int, w, w, hs, sc, case when w > 0 then now() end)
  on conflict (user_id, game_id) do update set
    kills = s.kills + excluded.kills,
    deaths = s.deaths + excluded.deaths,
    shots_fired = s.shots_fired + excluded.shots_fired,
    shots_hit = s.shots_hit + excluded.shots_hit,
    matches = s.matches + 1,
    wins = s.wins + excluded.wins,
    waves_cleared = s.waves_cleared + excluded.waves_cleared,
    headshots = s.headshots + excluded.headshots,
    best_score = greatest(s.best_score, excluded.best_score),
    best_wave_at = case when excluded.best_wave > s.best_wave then now() else s.best_wave_at end,
    best_wave = greatest(s.best_wave, excluded.best_wave),
    updated_at = now();
end;
$$;

revoke execute on function public.record_match(text, text, text, int, int, int, int, boolean, int, int, int) from public, anon;
grant execute on function public.record_match(text, text, text, int, int, int, int, boolean, int, int, int) to authenticated;

-- 3. Public leaderboard (callsign + aggregates only; no ids, no emails) -----------------
drop view if exists public.leaderboard;
drop function if exists public.leaderboard_rows();

create function public.leaderboard_rows()
returns table (
  game_id       text,
  callsign      text,
  matches       integer,
  wins          integer,
  kills         integer,
  deaths        integer,
  accuracy      numeric,
  best_wave     integer,
  waves_cleared integer,
  headshots     integer,
  best_score    integer,
  best_wave_at  timestamptz
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
              else 0 end as accuracy,
         s.best_wave,
         s.waves_cleared,
         s.headshots,
         s.best_score,
         s.best_wave_at
  from public.player_stats s
  join public.profiles p on p.id = s.user_id
  where s.matches > 0;
$$;

revoke execute on function public.leaderboard_rows() from public;
grant execute on function public.leaderboard_rows() to anon, authenticated;

create view public.leaderboard
with (security_invoker = true) as
  select * from public.leaderboard_rows();

revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

comment on view public.leaderboard is
  'Public per-game leaderboard: callsign + aggregate stats only (best wave, kills, accuracy, ...).';
