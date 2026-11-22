#!/usr/bin/env node
// Third-person guns for the soldiers: one decimated, atlas-baked copy of
// every real first-person long gun, in the soldier rifle frame, plus the
// anchors the soldier IK grips (see extract.ts and build_tp.py).
//
//   node art/blender/tpguns/build.mjs                 # every gun REAL_GUNS has a model for
//   node art/blender/tpguns/build.mjs --no-encode     # skip the KTX2 / meshopt step
//
// Re-run it whenever a first-person gun is added or changed (the Blender art
// pipeline's new guns appear automatically once they are in REAL_GUNS): all
// guns share one texture atlas, so the whole set is rebuilt.
//
// Writes public/assets/weapons/tp/: model.gltf (+ .bin, atlas JPEG / KTX2;
// nodes <kind>, <kind>_mag, <kind>_lod1) and guns.json (anchors, see
// src/game/ai/humanoid/rifle.ts TpGunInfo). Previews: art/previews/tp_guns.png.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(ROOT, "public/assets/weapons/tp");
const flags = new Set(process.argv.slice(2));
const BLENDER = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/opt/homebrew/bin/blender"].find((p) => p && existsSync(p));
if (!BLENDER) {
  console.error("Blender not found (set BLENDER=/path/to/blender)");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "tgf-tpguns-"));
try {
  // 1. Real fp guns -> third-person frame (node + the game's own mounting code).
  execFileSync(process.execPath, ["--experimental-transform-types", "--no-warnings", "--import", "./tests/register.mjs", "art/blender/tpguns/extract.ts", join(work, "src")], { cwd: ROOT, stdio: "inherit" });

  // 2. Decimate, atlas, bake, export, previews.
  if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (/\.(ktx2|bin|png|jpg|gltf|json)$/.test(f)) rmSync(join(OUT, f));
  mkdirSync(OUT, { recursive: true });
  const report = join(work, "report.json");
  const r = spawnSync(BLENDER, ["-b", "--factory-startup", "-noaudio", "-P", join(ROOT, "art/blender/tpguns/build_tp.py"), "--",
    "--src", join(work, "src"), "--out", join(OUT, "model.gltf"), "--previews", join(ROOT, "art/previews"), "--report", report], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const log = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  for (const l of log.split("\n")) if (l.startsWith("[tpguns]")) console.log(l);
  if (r.status !== 0 || !existsSync(report)) {
    console.error(log.split("\n").filter((l) => /TP_ERROR|Error|Traceback|line \d+/.test(l)).slice(-20).join("\n"));
    process.exit(1);
  }

  // 3. PNG -> JPEG (the encoder's source format), glTF pointed at them.
  const gltf = join(OUT, "model.gltf");
  let txt = readFileSync(gltf, "utf8");
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith(".png")) continue;
    const p = join(OUT, f);
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", /normal/i.test(f) ? "88" : "82", p, "--out", p.replace(/\.png$/, ".jpg")], { stdio: "ignore" });
    txt = txt.replaceAll(`"${f}"`, `"${f.replace(/\.png$/, ".jpg")}"`);
    rmSync(p);
  }
  writeFileSync(gltf, txt.replaceAll('"image/png"', '"image/jpeg"'));

  // 4. Anchors + budgets.
  const idx = JSON.parse(readFileSync(join(work, "src", "index.json"), "utf8"));
  const tris = JSON.parse(readFileSync(report, "utf8"));
  const guns = {};
  for (const [kind, g] of Object.entries(idx.guns)) {
    if (!tris[kind]) continue;
    guns[kind] = { ...g, srcTris: undefined, tris: tris[kind] };
  }
  writeFileSync(join(OUT, "guns.json"), JSON.stringify({ version: 1, frame: "butt at origin, +Z muzzle, +Y up, metres", guns, alias: idx.alias }, null, 1) + "\n");
  // Licences: each third-person gun is a derivative of its first-person model (same terms, same credit).
  const lic = ["Third-person soldier guns: decimated, re-textured derivatives of the first-person models", "in public/assets/weapons/<kind>/ (built by art/blender/tpguns/build.mjs). Each keeps its source's licence:", ""];
  for (const kind of Object.keys(guns)) {
    const src = join(ROOT, "public/assets/weapons", kind, "LICENSE.txt");
    lic.push(`== ${kind} ==`, existsSync(src) ? readFileSync(src, "utf8").trim() : "Original work for this project (art/blender/assets), same licence as the game.", "");
  }
  writeFileSync(join(OUT, "LICENSE.txt"), lic.join("\n"));
  for (const [k, g] of Object.entries(guns)) console.log(`  ${k.padEnd(6)} ${g.tris.tris} + mag ${g.tris.magTris} tris, lod1 ${g.tris.lod1Tris}, ${g.length} m`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// 5. KTX2 textures + meshopt geometry, like every shipped weapon.
if (!flags.has("--no-encode")) execFileSync(process.execPath, [join(ROOT, "scripts/encode-ktx2.mjs"), "--write"], { cwd: ROOT, stdio: "inherit" });
