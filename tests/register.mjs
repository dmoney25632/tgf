// Lets `node --test` run the game's TypeScript modules directly (Node 22's
// built-in type stripping) by resolving extensionless relative imports
// ("./config") to their .ts files. No extra test dependencies needed.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      export async function resolve(spec, ctx, next) {
        if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[cm]?[jt]s$/.test(spec) && ctx.parentURL) {
          const url = new URL(spec + ".ts", ctx.parentURL);
          if (existsSync(fileURLToPath(url))) return next(url.href, ctx);
        }
        return next(spec, ctx);
      }
    `),
);
