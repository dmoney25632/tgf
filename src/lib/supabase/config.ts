/**
 * Supabase env config. When the env vars are missing the platform runs in
 * "offline dev mode": auth is skipped and the dashboard + game stay reachable,
 * so the game can be worked on without a Supabase project.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
