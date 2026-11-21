-- Nightjar (stealth operation at Greywater Depot) joins the mission
-- fastest-clear boards. Runs after 20261121100000_leaderboard_v2.sql.
--
-- Re-creates record_mission_run() exactly as 20261121000000_mission_runs.sql
-- defined it, with one more known mission id and its floor time (180 s:
-- the shortest humanly possible ghost-free sprint from the insertion to the
-- office and out to the jetty). mission_board() needs no change: it reads
-- whatever ids the table holds. Signature, security definer, search_path and
-- grants are unchanged.

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
    when 'nightjar'      then 180
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
