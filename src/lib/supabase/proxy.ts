import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * Routes that require a signed-in user (when Supabase is configured; in
 * offline/guest mode nothing is gated here and pages decide for themselves).
 */
const PROTECTED_PREFIXES = ["/dashboard", "/play", "/account", "/coop", "/leaderboard"];
/** Routes a signed-in user should skip. */
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password", "/check-email"];

const matchesPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Refreshes the Supabase session cookie on every request and does the
 * optimistic auth redirects. Pages still verify the user server-side.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) return response; // offline dev mode

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // Do not put code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;

  // Redirects must carry any refreshed session cookies, or the user is
  // silently signed out on the next request.
  const redirect = (url: URL) => {
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
    return res;
  };

  if (!signedIn && PROTECTED_PREFIXES.some((p) => matchesPrefix(path, p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return redirect(url);
  }

  if (signedIn && AUTH_ROUTES.includes(path)) {
    // A JWT can outlive its user (account deleted, session revoked). Confirm
    // with the Auth server before bouncing away from the login form, or the
    // page's real check sends them back here and the two redirect forever.
    // Only auth pages pay for this round trip.
    const { data: verified, error } = await supabase.auth.getUser();
    if (error || !verified.user) {
      await supabase.auth.signOut({ scope: "local" });
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirect(url);
  }

  return response;
}
