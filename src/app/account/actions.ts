"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { validateCallsign } from "@/lib/supabase/validation";

export type CallsignState = { error?: string; message?: string; callsign?: string };

/** Changes the signed-in player's callsign (RLS: own row, callsign column only). */
export async function updateCallsign(_: CallsignState, formData: FormData): Promise<CallsignState> {
  if (!isSupabaseConfigured) return { error: "Accounts aren't available in guest mode." };

  const { callsign, error: invalid } = validateCallsign(formData.get("callsign"));
  if (invalid || !callsign) return { error: invalid };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Your session expired. Please log in again." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ callsign })
    .eq("id", auth.user.id)
    .select("callsign")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { error: "That callsign is taken. Pick another." };
    if (error.code === "23514") return { error: "Callsign must be 3–16 letters, numbers, _ or -." };
    return { error: "Couldn't save your callsign. Please try again." };
  }
  if (!data) return { error: "Profile not found. Try logging out and back in." };

  revalidatePath("/account");
  revalidatePath("/dashboard");
  return { message: "Callsign updated.", callsign: data.callsign };
}
