-- Mission fastest-completion leaderboard (solo and co-op kept separate).
-- Runs after 20261119120000_leaderboard_waves.sql. Same model as matches:
--   * clients never write the table directly; record_mission_run() (security
--     definer) takes the user id from the JWT and validates every field;
--   * players read only their own rows; the public board goes through
--     mission_board(), which returns callsigns and times only (no ids).

-- 1. Table ----------------------------------------------------------------------
create table if not exists public.mission_runs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  mission_id  text not null,
  mode        text not null,
  difficulty  text not null,
  seconds     integer not null,
  stars       smallint not null,
  deaths      integer not null default 0,
  squad_size  smallint not null default 1,
  played_at   timestamptz not null default now(),
  constraint mission_runs_mission_len check (char_length(mission_id) between 1 and 64),
  constraint mission_runs_mode_ok     check (mode in ('solo', 'coop')),
  constraint mission_runs_diff_ok     check (difficulty in ('recruit', 'regular', 'veteran')),
  constraint mission_runs_seconds_ok  check (seconds between 1 and 21600),
  constraint mission_runs_stars_ok    check (stars between 1 and 3),
  constraint mission_runs_deaths_ok   check (deaths between 0 and 1000),
  constraint mission_runs_squad_ok    check (squad_size between 1 and 4)
);

create index if not exists mission_runs_board_idx on public.mission_runs (mission_id, mode, seconds, played_at);
create index if not exists mission_runs_user_idx on public.mission_runs (user_id, played_at desc);

alter table public.mission_runs enable row level security;

revoke all on table public.mission_runs from anon;
revoke insert, update, delete, truncate, references, trigger on table public.mission_runs from authenticated;
grant select on table public.mission_runs to authenticated;

drop policy if exists "Users read their own mission runs" on public.mission_runs;
create policy "Users read their own mission runs"
  on public.mission_runs for select to authenticated
  using ((select auth.uid()) = user_id);

-- 2. Recording a run -------------------------------------------------------------
-- Only completed runs are recorded (a failed mission has no time). The
-- server action in src/app/play/[gameId]/actions.ts calls this with these
-- exact parameters. Validation mirrors src/game/missions: known mission ids,
-- a per-mission floor below which a clear is not humanly possible, star
-- counts 1–3, and co-op squads of 2–4.
create or replace function public.record_mission_run(
  p_mission_id text, p_mode text, p_difficulty text,
  p_seconds int, p_stars int, p_deaths int, p_squad int
) returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  min_seconds int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  min_seconds := case p_mission_id
    when 'iron-crossing' then 240
    when 'dry-season'    then 120
    when 'black-pipe'    then 150
    when 'long-shadow'   then 150
    else null
  end;
  if min_seconds is null then raise exception 'unknown mission' using errcode = '22023'; end if;
  if p_mode not in ('solo', 'coop') then raise exception 'invalid mode' using errcode = '22023'; end if;
  if p_difficulty not in ('recruit', 'regular', 'veteran') then raise exception 'invalid difficulty' using errcode = '22023'; end if;
  if p_seconds is null or p_seconds < min_seconds or p_seconds > 21600 then raise exception 'implausible time' using errcode = '22023'; end if;
  if p_stars is null or p_stars not between 1 and 3 then raise exception 'invalid stars' using errcode = '22023'; end if;
  if p_deaths is null or p_deaths not between 0 and 1000 then raise exception 'invalid deaths' using errcode = '22023'; end if;
  if p_squad is null or p_squad not between 1 and 4
     or (p_mode = 'solo' and p_squad <> 1)
     or (p_mode = 'coop' and p_squad < 2) then
    raise exception 'invalid squad' using errcode = '22023';
  end if;
  -- Recruit caps at two stars (src/game/missions/rating.ts).
  if p_difficulty = 'recruit' and p_stars > 2 then raise exception 'invalid stars' using errcode = '22023'; end if;

  -- Flood guard: a mission can't be finished twice inside its own floor time.
  if exists (
    select 1 from public.mission_runs r
    where r.user_id = uid and r.played_at > now() - make_interval(secs => min_seconds)
  ) then
    raise exception 'too many runs, slow down' using errcode = '54000';
  end if;

  insert into public.mission_runs (user_id, mission_id, mode, difficulty, seconds, stars, deaths, squad_size)
  values (uid, p_mission_id, p_mode, p_difficulty, p_seconds, p_stars, p_deaths, p_squad);
end;
$$;

revoke execute on function public.record_mission_run(text, text, text, int, int, int, int) from public, anon;
grant execute on function public.record_mission_run(text, text, text, int, int, int, int) to authenticated;

-- 3. Public board -------------------------------------------------------------------
-- Each player's fastest clear of a mission in a mode, fastest first. Returns
-- only safe columns. Ties go to whoever set the time first.
create or replace function public.mission_board(p_mission_id text, p_mode text, p_limit int default 10)
returns table (
  callsign   text,
  seconds    integer,
  stars      smallint,
  difficulty text,
  deaths     integer,
  squad_size smallint,
  played_at  timestamptz
)
language sql
stable
security definer set search_path = ''
as $$
  select b.callsign, b.seconds, b.stars, b.difficulty, b.deaths, b.squad_size, b.played_at
  from (
    select distinct on (r.user_id)
      p.callsign, r.seconds, r.stars, r.difficulty, r.deaths, r.squad_size, r.played_at
    from public.mission_runs r
    join public.profiles p on p.id = r.user_id
    where r.mission_id = p_mission_id and r.mode = p_mode
    order by r.user_id, r.seconds asc, r.played_at asc
  ) b
  order by b.seconds asc, b.played_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke execute on function public.mission_board(text, text, int) from public, anon;
grant execute on function public.mission_board(text, text, int) to authenticated;
