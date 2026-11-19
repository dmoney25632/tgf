"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type AuthState = { error?: string; message?: string };

/** Only allow same-site relative redirects after login. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const NOT_CONFIGURED: AuthState = {
  error:
    "Supabase isn't configured yet. Add your keys to .env.local (see .env.example).",
};

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(safeNext(formData.get("next")));
}

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const callsign = String(formData.get("callsign") ?? "").trim();

  if (!/^[A-Za-z0-9_-]{3,16}$/.test(callsign)) {
    return { error: "Callsign must be 3–16 letters, numbers, _ or -." };
  }
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { callsign }, // copied into public.profiles by a DB trigger
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });
  if (error) return { error: error.message };

  // Email confirmation disabled → session exists, go straight in.
  if (data.session) redirect("/dashboard");

  return { message: "Check your email to confirm your account, then log in." };
}

const OAUTH_PROVIDERS = ["github", "google", "discord"] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export async function signInWithOAuth(formData: FormData) {
  if (!isSupabaseConfigured) redirect("/login");

  const raw = String(formData.get("provider"));
  if (!OAUTH_PROVIDERS.includes(raw as OAuthProvider)) redirect("/login?error=Unsupported%20sign-in%20provider");
  const provider = raw as OAuthProvider;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback?next=/dashboard` },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "OAuth failed")}`);
  redirect(data.url);
}
