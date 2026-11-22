#!/usr/bin/env node
// Blender art pipeline runner. See art/README.md.
//
//   npm run art:build                 # build every asset in art/assets.json
//   npm run art:build -- stanag_mag   # build one (or several) by id
//   npm run art:build -- --no-previews
//   npm run art:check                 # Blender found? manifest valid? outputs present?
//
// For each asset: runs Blender headless with art/blender/build_asset.py and the
// asset's build script, writes the glTF to its `out` path, renders previews to
// art/previews/<id>_*.png (gitignored), then runs the KTX2 / meshopt encoder so
// the output matches every other shipped asset.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "art", "assets.json");
const argv = process.argv.slice(2);
const mode = argv[0] === "check" ? "check" : "build";
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const ids = argv.filter((a) => !a.startsWith("--") && a !== "check");

function blender() {
  const candidates = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/usr/local/bin/blender", "/opt/homebrew/bin/blender"];
  for (const c of candidates) if (c && existsSync(c)) return c;
  try {
    return execFileSync("which", ["blender"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function load() {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const problems = [];
  for (const a of m.assets) {
    for (const k of ["id", "script", "out", "license", "author"]) if (!a[k]) problems.push(`${a.id ?? "?"}: missing "${k}"`);
    if (a.script && !existsSync(join(ROOT, a.script))) problems.push(`${a.id}: script not found: ${a.script}`);
    if (a.source && !a.source.startsWith("http") && !existsSync(join(ROOT, a.source))) problems.push(`${a.id}: source not found: ${a.source}`);
    if (a.out && !/^public\/assets\//.test(a.out)) problems.push(`${a.id}: out must be under public/assets/`);
  }
  return { assets: m.assets, problems };
}

const bin = blender();
const { assets, problems } = load();

if (mode === "check") {
  console.log(`Blender: ${bin ?? "NOT FOUND (install: brew install --cask blender, or set BLENDER=/path/to/blender)"}`);
  if (bin) console.log(execFileSync(bin, ["-b", "--version"], { encoding: "utf8" }).split("\n")[0]);
  for (const a of assets) console.log(`${existsSync(join(ROOT, a.out)) ? "built " : "MISSING"}  ${a.id.padEnd(16)} ${a.out}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  process.exit(bin ? 0 : 1);
}

if (!bin) {
  console.error("Blender not found. Install it (brew install --cask blender) or set BLENDER=/path/to/blender.");
  process.exit(1);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const todo = ids.length ? assets.filter((a) => ids.includes(a.id)) : assets;
const unknown = ids.filter((id) => !assets.some((a) => a.id === id));
if (unknown.length) {
  console.error(`unknown asset id(s): ${unknown.join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const a of todo) {
  const out = join(ROOT, a.out);
  // Fresh output folder contents: stale .ktx2 / .bin siblings would be reused by the encoder.
  if (existsSync(dirname(out)))
    for (const f of readdirSync(dirname(out))) if (/\.(ktx2|bin|png|jpg|gltf)$/.test(f)) rmSync(join(dirname(out), f));
  const t0 = Date.now();
  const r = spawnSync(
    bin,
    ["-b", "--factory-startup", "-noaudio", "-P", join(ROOT, "art/blender/build_asset.py"), "--",
      "--id", a.id, "--script", join(ROOT, a.script), "--out", out,
      "--previews", join(ROOT, "art/previews"), "--report", join(ROOT, "art/previews", `${a.id}.json`),
      ...(a.source ? ["--source", a.source.startsWith("http") ? a.source : join(ROOT, a.source)] : []),
      ...(flags.has("--no-previews") ? ["--no-previews"] : [])],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const log = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const rep = log.split("\n").find((l) => l.startsWith("TGF_REPORT "));
  if (r.status !== 0 || !rep) {
    failed++;
    console.error(`✗ ${a.id} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n${log.split("\n").filter((l) => /TGF_ERROR|Error|Traceback|line \d+/.test(l)).slice(-15).join("\n")}`);
    continue;
  }
  const info = JSON.parse(rep.slice("TGF_REPORT ".length));
  console.log(`✓ ${a.id}: ${info.triangles} tris, ${info.size_m.join(" × ")} m, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const p of info.previews ?? []) console.log(`    preview ${p.replace(ROOT + "/", "")}`);
}

if (todo.length - failed > 0) {
  // Textures → JPEG + KTX2, geometry → meshopt (same as every shipped asset).
  for (const a of todo) {
    const dir = dirname(join(ROOT, a.out));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir))
      if (f.endsWith(".png")) {
        const p = join(dir, f);
        execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", /normal/i.test(f) ? "85" : "80", p, "--out", p.replace(/\.png$/, ".jpg")], { stdio: "ignore" });
        // Point the glTF at the JPEG.
        const g = a.out && join(ROOT, a.out);
        const txt = readFileSync(g, "utf8").replaceAll(`"${f}"`, `"${f.replace(/\.png$/, ".jpg")}"`).replaceAll('"image/png"', '"image/jpeg"');
        execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(g)}, ${JSON.stringify(txt)})`]);
        rmSync(p);
      }
  }
  execFileSync("node", [join(ROOT, "scripts/encode-ktx2.mjs"), "--write"], { stdio: "inherit", cwd: ROOT });
  for (const a of todo) {
    const dir = dirname(join(ROOT, a.out));
    if (!existsSync(dir)) continue;
    const kb = readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0) / 1024;
    console.log(`  ${a.id}: ${kb.toFixed(0)} kB on disk`);
  }
}
process.exit(failed ? 1 : 0);
