import { parseOAuthProviders } from "./validation";

/**
 * Supabase env config. When the env vars are missing the platform runs in
 * "offline dev mode" (guest mode): auth is skipped and the dashboard + solo
 * game stay reachable, so the game can be worked on without a Supabase
 * project. Co-op and saved stats need a real account.
 *
 * Only NEXT_PUBLIC_* values live here: they are safe for the browser. Never
 * add the service-role / secret key to this app.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** OAuth buttons shown on the login page (opt-in, whitelisted). */
export const ENABLED_OAUTH_PROVIDERS = parseOAuthProviders(process.env.NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS);
