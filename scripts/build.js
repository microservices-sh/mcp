import { chmod, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  external: ["node:*"],
  logLevel: "info",
});

await chmod("dist/index.js", 0o755);
