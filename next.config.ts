import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const isDev = process.env.NODE_ENV === "development";
const isVercelPreview = process.env.VERCEL_ENV === "preview";

/**
 * Content hash of public/assets. Game assets are requested under
 * /assets/v/<hash>/... (rewritten to /assets/...) so they can be cached as
 * immutable: the hash only changes when an asset file changes, so returning
 * players keep their cache across deploys that don't touch assets.
 */
function assetVersion(): string {
  const root = join(process.cwd(), "public", "assets");
  const hash = createHash("sha1");
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else hash.update(relative(root, p)).update(readFileSync(p));
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 10);
}

const ASSET_VERSION = assetVersion();

/**
 * Content-Security-Policy. Next inlines its RSC payload as inline scripts on
 * statically prerendered pages, so script-src needs 'unsafe-inline' unless
 * every page is made dynamic for nonces (which would give up PPR/static
 * shells). 'wasm-unsafe-eval' allows WebAssembly decoders (Basis/KTX2,
 * meshopt) without allowing JS eval.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}${isVercelPreview ? " https://vercel.live" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.supabase.co https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co${isDev ? " ws: http://localhost:*" : ""}${isVercelPreview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  `frame-src ${isVercelPreview ? "https://vercel.live" : "'none'"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.supabase.co https://github.com https://accounts.google.com https://discord.com",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "gamepad=(self), fullscreen=(self), autoplay=(self), " +
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const ASSET_TYPES: Record<string, string> = {
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  bin: "application/octet-stream",
  ktx2: "image/ktx2",
  hdr: "image/vnd.radiance",
  wasm: "application/wasm",
};

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Dev only: lets a second local player use http://127.0.0.1:3000 (its own
  // cookie jar) alongside http://localhost:3000 when testing co-op.
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_ASSET_VERSION: ASSET_VERSION,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Retired routes. The lobby is home; query strings carry over, so old
  // /coop?room=CODE invite links still land in that party. /dashboard stays
  // because the Supabase confirm-signup email template links to it.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/play/iron-horizon", permanent: false },
      { source: "/coop", destination: "/play/iron-horizon", permanent: false },
      { source: "/missions", destination: "/play/iron-horizon", permanent: false },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/assets/v/:version/:path*", destination: "/assets/:path*" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Explicit types for 3D formats some servers don't know. text-like
      // types (gltf JSON) get Brotli/gzip on Vercel; binary ones may not (see
      // docs/PERFORMANCE.md), which is why geometry should be meshopt-encoded.
      ...Object.entries(ASSET_TYPES).map(([ext, type]) => ({
        source: `/assets/:path(.*\\.${ext})`,
        headers: [{ key: "Content-Type", value: type }],
      })),
      // Unversioned asset URLs (credits, direct links): short cache, revalidate.
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
      // Versioned asset URLs (what the game requests): content-addressed by
      // the asset hash, so they never change.
      {
        source: "/assets/v/:version/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
