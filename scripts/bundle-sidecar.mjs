import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(projectRoot, "desktop/.generated/feishu-codex-sidecar.cjs");

await mkdir(dirname(outputFile), { recursive: true });
await build({
  entryPoints: [resolve(projectRoot, "src/desktop-sidecar.mjs")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  legalComments: "none",
  sourcemap: false,
  minify: false,
  logLevel: "info"
});

console.log(`Bundled desktop sidecar: ${outputFile}`);
