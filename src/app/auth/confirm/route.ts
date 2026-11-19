import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { defaultNextFor, parseConfirmType, safeNext } from "@/lib/supabase/validation";

/**
 * Landing route for links in Supabase auth emails (sign-up confirmation,
 * password recovery, email change, invites, magic links).
 *
 * The email templates link here as
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 * and we verify server-side with verifyOtp, which sets the session cookies.
 * This works even if the link is opened in a different browser than the one
 * that signed up (unlike the PKCE `?code=` flow, also accepted as a fallback).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = parseConfirmType(searchParams.get("type"));

  // Always redirect to a path on this origin (safeNext guarantees a relative path).
  const go = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const fail = () => go("/login?error=link");

  if (!isSupabaseConfigured) return go("/login");

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail();
    return go(safeNext(searchParams.get("next"), defaultNextFor(type)));
  }

  // Fallback: the default Supabase templates ({{ .ConfirmationURL }}) verify
  // the link themselves and redirect here with a PKCE code. That only works
  // in the browser that started the flow.
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail();
    return go(safeNext(searchParams.get("next")));
  }

  return fail();
}
