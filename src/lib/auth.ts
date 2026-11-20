import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isUnreachableError } from "@/lib/supabase/validation";

export type SessionUser = {
  id: string;
  email: string | null;
  callsign: string;
  /** True for the local guest in offline mode (no Supabase env vars). */
  offline: boolean;
};

const OFFLINE_GUEST: SessionUser = { id: "offline", email: null, callsign: "Recruit", offline: true };

type Session = { user: SessionUser | null; unreachable: boolean };

/** Verifies the session with the Auth server once per request. */
const getSession = cache(async (): Promise<Session> => {
  if (!isSupabaseConfigured) return { user: OFFLINE_GUEST, unreachable: false };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { user: null, unreachable: isUnreachableError(error) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("callsign")
    .eq("id", data.user.id)
    .maybeSingle();

  const user: SessionUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    callsign:
      profile?.callsign ??
      (data.user.user_metadata?.callsign as string | undefined) ??
      data.user.email?.split("@")[0] ??
      "Operator",
    offline: false,
  };
  return { user, unreachable: false };
});

/**
 * The current user, verified with the Auth server (getUser, not just the
 * cookie). Returns the offline guest when Supabase isn't configured and null
 * when nobody is signed in. Deduplicated per request.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getSession()).user;
}

const loginUrl = (next: string, error?: "unreachable") =>
  `/login?next=${encodeURIComponent(next)}${error ? `&error=${error}` : ""}`;

/**
 * Returns the signed-in user, or redirects to /login (with a "can't reach
 * the server" message when Supabase is down rather than signed out).
 * In offline mode it returns the local guest (solo play keeps working).
 */
export async function requireUser(next = "/play/iron-horizon"): Promise<SessionUser> {
  const { user, unreachable } = await getSession();
  if (!user) redirect(loginUrl(next, unreachable ? "unreachable" : undefined));
  return user;
}
