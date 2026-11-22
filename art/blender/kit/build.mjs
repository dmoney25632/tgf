// Builds public/assets/characters/kit/kit.gltf (the soldier kit) end to end:
//
//   node art/blender/kit/build.mjs [--blender /path/to/Blender] [--only boonie,radio]
//
// 1. extracts the Rocketbox soldier bodies (bind pose OBJs) the pieces are
//    fitted to, into art/previews/kit/body (gitignored),
// 2. runs build_kit.py headless in Blender (LOD0 + LOD1 per piece, vertex-baked
//    occlusion / seams / wear, metric box UVs for the uber shader),
// 3. meshopt-packs the result with gltfpack. -kv keeps TEXCOORD_0 (no material
//    samples it, gltfpack would otherwise drop it) and -vtf keeps it float (the
//    texture-transform dequantisation needs a texture, the kit has none);
//    positions / normals are quantised, the node matrices dequantise them
//    (gear.ts bakes mesh.matrixWorld in). -kn keeps the piece nodes.
//    scripts/encode-ktx2.mjs leaves the file alone afterwards (already meshopt,
//    and the kit has no textures).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const blender = arg("--blender", process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender");
const only = arg("--only", "");
const work = join(ROOT, "art/previews/kit");
const bodies = join(work, "body");
const outDir = join(ROOT, "public/assets/characters/kit");
mkdirSync(bodies, { recursive: true });
mkdirSync(outDir, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });

const ids = "abcdefgh".split("").filter((i) => !existsSync(join(bodies, `soldier_${i}.obj`)));
if (ids.length) run(process.execPath, [join(HERE, "extract_body.mjs"), bodies, ...ids]);

const tmp = mkdtempSync(join(tmpdir(), "tgf-kit-"));
try {
  const raw = join(tmp, "kit.gltf");
  run(blender, ["-b", "--factory-startup", "-P", join(HERE, "build_kit.py"), "--", "--bodies", bodies, "--out", raw, "--report", join(work, "report.json"), ...(only ? ["--only", only] : [])]);
  const packed = join(tmp, "packed", "kit.gltf");
  mkdirSync(dirname(packed));
  run(process.execPath, [join(ROOT, "node_modules/gltfpack/cli.js"), "-i", raw, "-o", packed, "-cc", "-kn", "-km", "-kv", "-vtf"]);
  for (const f of readdirSync(outDir)) rmSync(join(outDir, f));
  for (const f of readdirSync(dirname(packed))) copyFileSync(join(dirname(packed), f), join(outDir, f));
  for (const f of readdirSync(outDir)) console.log(`${f}  ${(statSync(join(outDir, f)).size / 1024).toFixed(1)} KB`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
