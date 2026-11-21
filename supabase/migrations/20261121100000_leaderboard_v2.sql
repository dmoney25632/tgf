-- Leaderboard v2: furthest Survival wave per difficulty + fuller career stats.
-- Runs after 20261121000000_mission_runs.sql.
--
--   * matches records difficulty, duration, squad size, melee / grenade kills
--     and damage dealt (all default so older clients keep working);
--   * survival_bests keeps each player's furthest wave per difficulty;
--   * player_stats gains lifetime melee / grenade kills, damage, play time,
--     most kills in one match;
--   * record_match() is still the only writer (security definer, user id from
--     the JWT); survival_board() / leaderboard expose callsigns + aggregates only.

-- 1. Columns ------------------------------------------------------------------------
alter table public.matches
  add column if not exists difficulty    text,
  add column if not exists seconds       integer not null default 0,
  add column if not exists squad_size    smallint not null default 1,
  add column if not exists melee_kills   integer not null default 0,
  add column if not exists grenade_kills integer not null default 0,
  add column if not exists damage_dealt  integer not null default 0;

alter table public.matches drop constraint if exists matches_difficulty_ok;
alter table public.matches add constraint matches_difficulty_ok
  check (difficulty is null or difficulty in ('recruit', 'regular', 'veteran'));
alter table public.matches drop constraint if exists matches_v2_ranges_ok;
alter table public.matches add constraint matches_v2_ranges_ok check (
  seconds between 0 and 86400 and squad_size between 1 and 4
  and melee_kills between 0 and 500 and grenade_kills between 0 and 500
  and damage_dealt between 0 and 10000000
);

alter table public.player_stats
  add column if not exists melee_kills      integer not null default 0,
  add column if not exists grenade_kills    integer not null default 0,
  add column if not exists damage_dealt     bigint  not null default 0,
  add column if not exists playtime_seconds bigint  not null default 0,
  add column if not exists best_kills       integer not null default 0;

-- 2. Furthest wave per difficulty ------------------------------------------------------
create table if not exists public.survival_bests (
  user_id      uuid not null references auth.users (id) on delete cascade,
  game_id      text not null,
  difficulty   text not null check (difficulty in ('recruit', 'regular', 'veteran')),
  best_wave    integer not null default 0,
  best_score   integer not null default 0,
  best_kills   integer not null default 0,
  runs         integer not null default 0,
  best_wave_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, game_id, difficulty)
);

create index if not exists survival_bests_board_idx
  on public.survival_bests (game_id, difficulty, best_wave desc, best_wave_at);

alter table public.survival_bests enable row level security;
revoke all on table public.survival_bests from anon;
revoke insert, update, delete, truncate, references, trigger on table public.survival_bests from authenticated;
grant select on table public.survival_bests to authenticated;

drop policy if exists "Users read their own survival bests" on public.survival_bests;
create policy "Users read their own survival bests"
  on public.survival_bests for select to authenticated
  using ((select auth.uid()) = user_id);

-- 3. record_match with the new fields ----------------------------------------------------
drop function if exists public.record_match(text, text, text, int, int, int, int, boolean, int, int, int);

create function public.record_match(
  p_game_id text, p_mode text, p_map text,
  p_kills int, p_deaths int, p_shots_fired int, p_shots_hit int, p_won boolean,
  p_wave int default 0, p_headshots int default 0, p_score int default 0,
  p_difficulty text default null, p_seconds int default 0, p_squad int default 1,
  p_melee_kills int default 0, p_grenade_kills int default 0, p_damage int default 0
) returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  w   int := greatest(0, least(coalesce(p_wave, 0), 1000));
  hs  int := greatest(0, least(coalesce(p_headshots, 0), p_kills));
  sc  int := greatest(0, least(coalesce(p_score, 0), 10000000));
  sec int := greatest(0, least(coalesce(p_seconds, 0), 86400));
  sq  int := greatest(1, least(coalesce(p_squad, 1), 4));
  mk  int := greatest(0, least(coalesce(p_melee_kills, 0), p_kills));
  gk  int := greatest(0, least(coalesce(p_grenade_kills, 0), p_kills - mk));
  dmg int := greatest(0, least(coalesce(p_damage, 0), 10000000));
  diff text := case when p_difficulty in ('recruit', 'regular', 'veteran') then p_difficulty end;
  survival boolean := p_mode in ('survival', 'survival-coop');
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kills < 0 or p_deaths < 0 or p_shots_fired < 0 or p_shots_hit < 0 then
    raise exception 'invalid stats' using errcode = '22023';
  end if;
  if p_shots_hit > p_shots_fired then raise exception 'invalid stats' using errcode = '22023'; end if;
  if exists (
    select 1 from public.matches m
    where m.user_id = uid and m.played_at > now() - interval '10 seconds'
  ) then
    raise exception 'too many matches, slow down' using errcode = '54000';
  end if;
  -- Only Survival runs carry a wave.
  if not survival then w := 0; sc := 0; end if;

  insert into public.matches
    (user_id, game_id, mode, map, kills, deaths, shots_fired, shots_hit, won, wave, headshots, score,
     difficulty, seconds, squad_size, melee_kills, grenade_kills, damage_dealt)
  values
    (uid, p_game_id, p_mode, p_map, p_kills, p_deaths, p_shots_fired, p_shots_hit, p_won, w, hs, sc,
     diff, sec, sq, mk, gk, dmg);

  insert into public.player_stats as s
    (user_id, game_id, kills, deaths, shots_fired, shots_hit, matches, wins, best_wave, waves_cleared, headshots,
     best_score, best_wave_at, melee_kills, grenade_kills, damage_dealt, playtime_seconds, best_kills)
  values
    (uid, p_game_id, p_kills, p_deaths, p_shots_fired, p_shots_hit, 1, p_won::int, w, w, hs,
     sc, case when w > 0 then now() end, mk, gk, dmg, sec, p_kills)
  on conflict (user_id, game_id) do update set
    kills            = s.kills + excluded.kills,
    deaths           = s.deaths + excluded.deaths,
    shots_fired      = s.shots_fired + excluded.shots_fired,
    shots_hit        = s.shots_hit + excluded.shots_hit,
    matches          = s.matches + 1,
    wins             = s.wins + excluded.wins,
    waves_cleared    = s.waves_cleared + excluded.waves_cleared,
    headshots        = s.headshots + excluded.headshots,
    best_score       = greatest(s.best_score, excluded.best_score),
    best_wave_at     = case when excluded.best_wave > s.best_wave then now() else s.best_wave_at end,
    best_wave        = greatest(s.best_wave, excluded.best_wave),
    melee_kills      = s.melee_kills + excluded.melee_kills,
    grenade_kills    = s.grenade_kills + excluded.grenade_kills,
    damage_dealt     = s.damage_dealt + excluded.damage_dealt,
    playtime_seconds = s.playtime_seconds + excluded.playtime_seconds,
    best_kills       = greatest(s.best_kills, excluded.best_kills),
    updated_at       = now();

  if survival and diff is not null then
    insert into public.survival_bests as b
      (user_id, game_id, difficulty, best_wave, best_score, best_kills, runs, best_wave_at)
    values
      (uid, p_game_id, diff, w, sc, p_kills, 1, case when w > 0 then now() end)
    on conflict (user_id, game_id, difficulty) do update set
      best_wave_at = case when excluded.best_wave > b.best_wave then now() else b.best_wave_at end,
      best_wave    = greatest(b.best_wave, excluded.best_wave),
      best_score   = greatest(b.best_score, excluded.best_score),
      best_kills   = greatest(b.best_kills, excluded.best_kills),
      runs         = b.runs + 1,
      updated_at   = now();
  end if;
end;
$$;

revoke execute on function public.record_match(text, text, text, int, int, int, int, boolean, int, int, int, text, int, int, int, int, int) from public, anon;
grant execute on function public.record_match(text, text, text, int, int, int, int, boolean, int, int, int, text, int, int, int, int, int) to authenticated;

-- 4. Public survival board per difficulty -------------------------------------------------
create or replace function public.survival_board(p_game_id text, p_difficulty text, p_limit int default 100)
returns table (
  callsign     text,
  best_wave    integer,
  best_score   integer,
  best_kills   integer,
  runs         integer,
  best_wave_at timestamptz
)
language sql
stable
security definer set search_path = ''
as $$
  select p.callsign, b.best_wave, b.best_score, b.best_kills, b.runs, b.best_wave_at
  from public.survival_bests b
  join public.profiles p on p.id = b.user_id
  where b.game_id = p_game_id and b.difficulty = p_difficulty and b.best_wave > 0
  order by b.best_wave desc, b.best_wave_at asc nulls last, b.best_score desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke execute on function public.survival_board(text, text, int) from public;
grant execute on function public.survival_board(text, text, int) to anon, authenticated;

-- 5. Career leaderboard (callsign + aggregates only; no ids, no emails) ----------------------
drop view if exists public.leaderboard;
drop function if exists public.leaderboard_rows();

create function public.leaderboard_rows()
returns table (
  game_id          text,
  callsign         text,
  matches          integer,
  wins             integer,
  kills            integer,
  deaths           integer,
  kd               numeric,
  accuracy         numeric,
  best_wave        integer,
  waves_cleared    integer,
  headshots        integer,
  best_score       integer,
  best_wave_at     timestamptz,
  melee_kills      integer,
  grenade_kills    integer,
  damage_dealt     bigint,
  playtime_seconds bigint,
  best_kills       integer,
  missions_cleared integer
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
         round(s.kills::numeric / greatest(1, s.deaths), 2) as kd,
         case when s.shots_fired > 0
              then round(100.0 * s.shots_hit / s.shots_fired, 1)
              else 0 end as accuracy,
         s.best_wave,
         s.waves_cleared,
         s.headshots,
         s.best_score,
         s.best_wave_at,
         s.melee_kills,
         s.grenade_kills,
         s.damage_dealt,
         s.playtime_seconds,
         s.best_kills,
         (select count(*)::int from public.mission_runs r where r.user_id = s.user_id) as missions_cleared
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
  'Public per-game career leaderboard: callsign + aggregate stats only.';
