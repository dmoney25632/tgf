import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Signs out (POST only, from a form). Cross-site POSTs are ignored so another
 * site can't log players out.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const crossSite =
    (origin !== null && origin !== request.nextUrl.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site";

  if (isSupabaseConfigured && !crossSite) {
    const supabase = await createClient();
    // "local" ends this browser's session only; other devices stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
