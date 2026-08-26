import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedEntry = resolve(projectRoot, "desktop/.generated/feishu-codex-sidecar.cjs");
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || "aarch64-apple-darwin";
const output = resolve(projectRoot, `desktop/src-tauri/binaries/feishu-codex-sidecar-${targetTriple}`);

if (targetTriple !== "aarch64-apple-darwin") {
  throw new Error(`The beta build only supports aarch64-apple-darwin, received ${targetTriple}`);
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} exited with code ${code}`)));
  });
}

await run(process.execPath, [resolve(projectRoot, "scripts/bundle-sidecar.mjs")]);
await mkdir(dirname(output), { recursive: true });
await run(resolve(projectRoot, "node_modules/.bin/pkg"), [
  "--targets", "node22-macos-arm64",
  "--output", output,
  "--compress", "GZip",
  "--no-bytecode",
  "--public",
  generatedEntry
]);

console.log(`Built arm64 sidecar: ${output}`);
