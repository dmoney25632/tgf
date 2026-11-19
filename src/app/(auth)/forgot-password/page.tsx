import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "Forgot password · TGF" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm offline={!isSupabaseConfigured} />;
}
