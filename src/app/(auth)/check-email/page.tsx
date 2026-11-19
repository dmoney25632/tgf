import { CheckEmailCard } from "@/components/auth/check-email";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "Resend confirmation · TGF" };

/** Standalone "resend confirmation email" screen (linked from login errors). */
export default function CheckEmailPage() {
  return <CheckEmailCard reason="resend" offline={!isSupabaseConfigured} />;
}
