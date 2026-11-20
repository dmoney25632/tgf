import { parseOAuthProviders } from "./validation";

/**
 * Supabase env config. When the env vars are missing the platform runs in
 * "offline dev mode" (guest mode): auth is skipped and the lobby + solo
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

/**
 * Server-side fetch for Supabase with a hard timeout, so an unreachable
 * project fails fast with an error the UI can explain instead of hanging the
 * request. (The browser client keeps the default fetch: Realtime manages its
 * own sockets.)
 */
const SERVER_TIMEOUT_MS = 8000;
export const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SERVER_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};
