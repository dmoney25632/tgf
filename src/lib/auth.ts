import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type SessionUser = {
  id: string;
  email: string | null;
  callsign: string;
  offline: boolean;
};

/**
 * Returns the signed-in user, or redirects to /login.
 * In offline dev mode (no Supabase env) it returns a local guest.
 */
export async function requireUser(next = "/dashboard"): Promise<SessionUser> {
  if (!isSupabaseConfigured) {
    return { id: "offline", email: null, callsign: "Recruit", offline: true };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(next)}`);

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
}
