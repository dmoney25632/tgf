-- TGF initial schema: profiles, per-game stats, loadouts, match history.
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

-- Profiles -------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  callsign    text not null unique check (callsign ~ '^[A-Za-z0-9_-]{3,16}$'),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are readable by signed-in users"
  on public.profiles for select to authenticated using (true);
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Create a profile row whenever a user signs up. Callsign comes from signup
-- metadata; OAuth users get a generated one they can change later.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'callsign';
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_-]{3,16}$'
     or exists (select 1 from public.profiles where callsign = wanted) then
    wanted := 'Op-' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, callsign) values (new.id, wanted);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lifetime stats per game ----------------------------------------------------
create table public.player_stats (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,
  kills        integer not null default 0,
  deaths       integer not null default 0,
  shots_fired  integer not null default 0,
  shots_hit    integer not null default 0,
  matches      integer not null default 0,
  wins         integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.player_stats enable row level security;

create policy "Stats are readable by signed-in users"
  on public.player_stats for select to authenticated using (true);
-- Writes only go through record_match() below, so clients can't set
-- arbitrary totals directly.

-- Match history --------------------------------------------------------------
create table public.matches (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,
  mode         text not null,
  map          text not null,
  kills        integer not null check (kills between 0 and 500),
  deaths       integer not null check (deaths between 0 and 500),
  shots_fired  integer not null check (shots_fired between 0 and 100000),
  shots_hit    integer not null check (shots_hit between 0 and 100000),
  won          boolean not null default false,
  played_at    timestamptz not null default now()
);

create index matches_user_idx on public.matches (user_id, played_at desc);
alter table public.matches enable row level security;

create policy "Users read their own matches"
  on public.matches for select to authenticated
  using ((select auth.uid()) = user_id);

-- Records a finished match and rolls it into lifetime stats atomically.
-- NOTE: bot matches are client-authoritative; once multiplayer lands, results
-- should be reported by the game server instead.
create function public.record_match(
  p_game_id text, p_mode text, p_map text,
  p_kills int, p_deaths int, p_shots_fired int, p_shots_hit int, p_won boolean
) returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_shots_hit > p_shots_fired then raise exception 'invalid stats'; end if;

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

revoke execute on function public.record_match from public, anon;
grant execute on function public.record_match to authenticated;

-- Loadouts -------------------------------------------------------------------
create table public.loadouts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  game_id     text not null,
  slot        smallint not null check (slot between 1 and 5),
  name        text not null default 'Custom',
  primary_weapon   text not null,
  secondary_weapon text not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, game_id, slot)
);

alter table public.loadouts enable row level security;

create policy "Users manage their own loadouts"
  on public.loadouts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
