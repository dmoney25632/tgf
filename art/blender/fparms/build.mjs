#!/usr/bin/env node
// Rebuilds the first-person arms (public/assets/characters/fparms) from the
// Blender pipeline in this folder:
//
//   1. build_fparms.py (Blender, headless): geometry, weights, UVs, bakes,
//      procedural textures -> <work>/arms.json/.bin + PNG textures
//   2. assemble.mjs: glTF with the source skeleton + JPEG textures
//   3. encode.mjs: KTX2 textures + meshopt geometry (the formats of
//      scripts/encode-ktx2.mjs, for this asset only; ORM as UASTC)
//   4. (--previews) render.py: game-pose and stress renders into <work>/renders
//
//   node art/blender/fparms/build.mjs [--work <dir>] [--previews] [--no-encode]
//
// Blender: $BLENDER or /Applications/Blender.app/Contents/MacOS/Blender.
// Source: source/rocketbox_arms.glb (Microsoft Rocketbox Military_Male_01, MIT,
// as converted by scripts/fparms/build.mjs; frozen by extract_source.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const OUT = join(ROOT, "public", "assets", "characters", "fparms");
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const WORK = resolve(opt("--work") ?? join(tmpdir(), "tgf-fparms"));
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER} (set BLENDER)`);
mkdirSync(WORK, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });
run(BLENDER, ["-b", "--factory-startup", "-P", join(HERE, "build_fparms.py"), "--", "--out", WORK]);
run(process.execPath, [join(HERE, "assemble.mjs"), WORK, OUT]);
if (!argv.includes("--no-encode")) {
  run(process.execPath, [join(HERE, "encode.mjs"), OUT]);
}
if (argv.includes("--previews")) {
  const poses = join(WORK, "poses");
  run(process.execPath, ["--experimental-transform-types", "--no-warnings", "--import", "./tests/register.mjs", join(HERE, "game_pose.ts"), poses]);
  run(BLENDER, ["-b", "--factory-startup", "-P", join(HERE, "render.py"), "--", "--arms", join(WORK, "preview.glb"), "--tex", WORK, "--poses", poses, "--out", join(WORK, "renders"), "--stress"]);
}
console.log("fparms built; work files in", WORK);
