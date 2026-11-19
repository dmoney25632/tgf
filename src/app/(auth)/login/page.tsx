import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { ENABLED_OAUTH_PROVIDERS, isSupabaseConfigured } from "@/lib/supabase/config";
import { loginErrorMessage, safeNext } from "@/lib/supabase/validation";

export const metadata = { title: "Log in · TGF" };

const NOTICES: Record<string, string> = {
  account: "Co-op and saved stats need an account. Log in or sign up to continue.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<div className="h-[420px] w-full max-w-sm rounded-xl border border-border bg-card" />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next, error, reason } = await searchParams;
  return (
    <AuthForm
      mode="login"
      next={safeNext(next)}
      initialError={loginErrorMessage(error)}
      notice={typeof reason === "string" ? NOTICES[reason] : undefined}
      offline={!isSupabaseConfigured}
      oauthProviders={ENABLED_OAUTH_PROVIDERS}
    />
  );
}
