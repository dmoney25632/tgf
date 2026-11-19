"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ENABLED_OAUTH_PROVIDERS, isSupabaseConfigured } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/supabase/site-url";
import {
  authErrorMessage,
  safeNext,
  validateCallsign,
  validateEmail,
  validateNewPassword,
  type OAuthProvider,
} from "@/lib/supabase/validation";

export type AuthState = {
  error?: string;
  message?: string;
  /** Login failed because the email isn't confirmed yet: offer a resend. */
  unconfirmed?: boolean;
  /** Sign-up (or resend) succeeded: show the "check your email" screen for this address. */
  checkEmail?: string;
  /** Echo non-secret inputs back so the form keeps them after an error. */
  fields?: { email?: string; callsign?: string };
};

const NOT_CONFIGURED: AuthState = {
  error: "Accounts aren't available: Supabase isn't configured (see .env.example). You can still play solo as a guest.",
};

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

// Log in ---------------------------------------------------------------------

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const { email, error: emailError } = validateEmail(formData.get("email"));
  const password = str(formData.get("password"));
  const fields = { email: str(formData.get("email")).trim() };
  if (emailError || !email) return { error: emailError, fields };
  if (!password) return { error: "Enter your password.", fields };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error: authErrorMessage(error),
      unconfirmed: error.code === "email_not_confirmed",
      fields,
    };
  }

  redirect(safeNext(formData.get("next")));
}

// Sign up ----------------------------------------------------------------------

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const fields = { email: str(formData.get("email")).trim(), callsign: str(formData.get("callsign")).trim() };
  const { callsign, error: callsignError } = validateCallsign(formData.get("callsign"));
  if (callsignError || !callsign) return { error: callsignError, fields };
  const { email, error: emailError } = validateEmail(formData.get("email"));
  if (emailError || !email) return { error: emailError, fields };
  const { password, error: passwordError } = validateNewPassword(formData.get("password"), formData.get("confirm"));
  if (passwordError || !password) return { error: passwordError, fields };

  const supabase = await createClient();

  // Friendly early check; the DB trigger still guarantees uniqueness.
  const { data: available, error: rpcError } = await supabase.rpc("is_callsign_available", { p_callsign: callsign });
  if (!rpcError && available === false) return { error: "That callsign is taken. Pick another.", fields };

  const site = await getSiteUrl();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { callsign }, // copied into public.profiles by the handle_new_user trigger
      emailRedirectTo: `${site}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) return { error: authErrorMessage(error), fields };

  // Email confirmation turned off in the dashboard: already signed in.
  if (data.session) redirect("/dashboard");

  // Note: for an email that already has an account Supabase returns a fake
  // success (no email sent) so accounts can't be enumerated. Same screen.
  return { checkEmail: email };
}

// Resend confirmation ------------------------------------------------------------

export async function resendConfirmation(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const { email, error: emailError } = validateEmail(formData.get("email"));
  if (emailError || !email) return { error: emailError, fields: { email: str(formData.get("email")) } };

  const supabase = await createClient();
  const site = await getSiteUrl();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${site}/auth/confirm?next=/dashboard` },
  });
  // Only surface rate limits; anything else gets the generic reply so the
  // form can't be used to probe which emails are registered.
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
    return { error: authErrorMessage(error), checkEmail: email };
  }
  return {
    checkEmail: email,
    message: "If that address has an unconfirmed account, a new link is on its way.",
  };
}

// Forgot / reset password -----------------------------------------------------------

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const { email, error: emailError } = validateEmail(formData.get("email"));
  if (emailError || !email) return { error: emailError, fields: { email: str(formData.get("email")) } };

  const supabase = await createClient();
  const site = await getSiteUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${site}/auth/confirm?next=/reset-password`,
  });
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
    return { error: authErrorMessage(error), fields: { email } };
  }
  return {
    checkEmail: email,
    message: "If an account exists for that address, a password reset link is on its way.",
  };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;

  const { password, error: passwordError } = validateNewPassword(formData.get("password"), formData.get("confirm"));
  if (passwordError || !password) return { error: passwordError };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { error: "Your reset link has expired. Request a new one from “Forgot password”." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error) };

  redirect("/account?updated=password");
}

// OAuth (optional) -------------------------------------------------------------------

export async function signInWithOAuth(formData: FormData) {
  if (!isSupabaseConfigured) redirect("/login");

  const raw = str(formData.get("provider"));
  // Whitelisted in code AND explicitly enabled via NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS.
  if (!ENABLED_OAUTH_PROVIDERS.includes(raw as OAuthProvider)) {
    redirect("/login?error=provider");
  }
  const provider = raw as OAuthProvider;
  const next = safeNext(formData.get("next"));
  const site = await getSiteUrl();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${site}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}
