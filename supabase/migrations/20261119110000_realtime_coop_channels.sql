-- Realtime authorization for co-op lobbies (private channels).
--
-- Supabase Realtime checks RLS on realtime.messages when a client joins a
-- channel created with { config: { private: true } }. These policies let any
-- signed-in user join, send and receive Broadcast and Presence on topics that
-- start with 'coop:' (for example 'coop:K7QX2'). Nothing else is allowed:
-- anon users get nothing, and other topic prefixes stay closed until a policy
-- is added for them.
--
-- Client usage (supabase-js v2):
--   const channel = supabase.channel('coop:' + roomCode, {
--     config: { private: true, presence: { key: userId } },
--   });
--
-- Also turn OFF "Allow public access" under Realtime → Settings in the
-- dashboard so that public (non-private) channels are rejected.

-- RLS is already enabled on realtime.messages in every Supabase project
-- (the table is owned by the realtime service, so we don't ALTER it here).

drop policy if exists "coop: authenticated users can receive" on realtime.messages;
create policy "coop: authenticated users can receive"
  on realtime.messages for select to authenticated
  using (
    starts_with((select realtime.topic()), 'coop:')
    and realtime.messages.extension in ('broadcast', 'presence')
  );

drop policy if exists "coop: authenticated users can send" on realtime.messages;
create policy "coop: authenticated users can send"
  on realtime.messages for insert to authenticated
  with check (
    starts_with((select realtime.topic()), 'coop:')
    and realtime.messages.extension in ('broadcast', 'presence')
  );
