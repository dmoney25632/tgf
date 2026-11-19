import { AuthForm } from "@/components/auth/auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "Sign up · TGF" };

export default function SignupPage() {
  return <AuthForm mode="signup" offline={!isSupabaseConfigured} />;
}
