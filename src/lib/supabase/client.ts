import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * Supabase client for Client Components (e.g. co-op Realtime channels).
 * Uses only the publishable key; the session comes from the auth cookies the
 * server set. Returns null in offline/guest mode, so callers must handle it.
 * `createBrowserClient` is a singleton in the browser.
 */
export function getBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  // Realtime heartbeats run in a Web Worker (inline blob script) so a co-op
  // host in a hidden tab, where page timers get throttled to once a minute,
  // doesn't time out and stall the whole party.
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { worker: true } });
}
