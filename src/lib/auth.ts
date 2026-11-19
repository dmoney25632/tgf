import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type SessionUser = {
  id: string;
  email: string | null;
  callsign: string;
  /** True for the local guest in offline mode (no Supabase env vars). */
  offline: boolean;
};

const OFFLINE_GUEST: SessionUser = { id: "offline", email: null, callsign: "Recruit", offline: true };

/**
 * The current user, verified with the Auth server (getUser, not just the
 * cookie). Returns the offline guest when Supabase isn't configured and null
 * when nobody is signed in. Deduplicated per request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseConfigured) return OFFLINE_GUEST;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("callsign")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    callsign:
      profile?.callsign ??
      (data.user.user_metadata?.callsign as string | undefined) ??
      data.user.email?.split("@")[0] ??
      "Operator",
    offline: false,
  };
});

const loginUrl = (next: string, reason?: string) =>
  `/login?next=${encodeURIComponent(next)}${reason ? `&reason=${reason}` : ""}`;

/**
 * Returns the signed-in user, or redirects to /login.
 * In offline mode it returns the local guest (solo play keeps working).
 */
export async function requireUser(next = "/dashboard"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(next));
  return user;
}

/**
 * Like requireUser, but guests are not enough: co-op and anything that
 * writes to the database need a real account. In offline mode this sends the
 * player to /login, which explains that Supabase isn't configured.
 */
export async function requireAccount(next = "/dashboard"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || user.offline) redirect(loginUrl(next, "account"));
  return user;
}
