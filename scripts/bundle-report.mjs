#!/usr/bin/env node
/**
 * Prints the initial JavaScript each prerendered route ships (raw + gzip) and
 * flags any route whose initial chunks contain Three.js. Run after
 * `next build`:  npm run analyze
 *
 * Three.js must only appear in lazily loaded chunks of /play/[gameId].
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const NEXT = ".next";
const APP = join(NEXT, "server", "app");
if (!existsSync(APP)) {
  console.error("No .next build found. Run `npm run build` first.");
  process.exit(1);
}

const ROUTES = {
  "/": "index.html",
  "/login": "login.html",
  "/signup": "signup.html",
  "/dashboard": "dashboard.html",
  "/play/[gameId]": "play/[gameId].html",
};

// Polyfills load only in legacy browsers (nomodule), so they are not counted.
const polyfills = new Set(
  JSON.parse(readFileSync(join(NEXT, "build-manifest.json"), "utf8")).polyfillFiles.map((f) => `/_next/${f}`),
);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const cache = new Map();
function chunk(src) {
  if (!cache.has(src)) {
    const file = join(NEXT, src.replace(/^\/_next\//, ""));
    const buf = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
    cache.set(src, { raw: buf.length, gz: gzipSync(buf).length, three: /Context Lost/.test(buf.toString()) });
  }
  return cache.get(src);
}

let failed = false;
console.log("Route                 initial JS (raw / gzip)   three?");
for (const [route, html] of Object.entries(ROUTES)) {
  const file = join(APP, html);
  if (!existsSync(file)) {
    console.log(`${route.padEnd(22)}(not prerendered)`);
    continue;
  }
  const doc = readFileSync(file, "utf8");
  const srcs = [...new Set([...doc.matchAll(/\/_next\/static\/chunks\/[^"'\s)]+\.js/g)].map((m) => m[0]))].filter((s) => !polyfills.has(s));
  let raw = 0;
  let gz = 0;
  let three = false;
  for (const s of srcs) {
    const c = chunk(s);
    raw += c.raw;
    gz += c.gz;
    three ||= c.three;
  }
  if (three) failed = true;
  console.log(`${route.padEnd(22)}${`${kb(raw)} / ${kb(gz)}`.padEnd(26)}${three ? "YES (bad)" : "no"}`);
}

const dir = join(NEXT, "static", "chunks");
const lazy = readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ f, ...chunk(`/_next/static/chunks/${f}`) }))
  .filter((c) => c.three);
console.log("\nLazy chunks containing Three.js:");
for (const c of lazy) console.log(`  ${c.f.padEnd(24)}${kb(c.raw)} / ${kb(c.gz)} gzip`);

if (failed) {
  console.error("\nThree.js leaked into an initial route bundle.");
  process.exit(1);
}
