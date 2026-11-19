import { headers } from "next/headers";

/**
 * Base URL used in auth emails and OAuth redirects. Prefer the explicit
 * NEXT_PUBLIC_SITE_URL; fall back to the request origin (Supabase only
 * redirects to URLs on its allow-list, so a spoofed Host can't hijack links).
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;

  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
