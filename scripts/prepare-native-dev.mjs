import { copyFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Desktop development currently requires Apple Silicon macOS");
}

const outputDir = path.resolve("desktop/src-tauri/binaries");
await mkdir(outputDir, { recursive: true });

for (const [name, source] of [["ffmpeg", "/opt/homebrew/bin/ffmpeg"], ["whisper-cli", "/opt/homebrew/bin/whisper-cli"]]) {
  const destination = path.join(outputDir, `${name}-aarch64-apple-darwin`);
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", destination], { stdio: "inherit" });
}

console.log("Prepared development-only native tools. Release builds use scripts/build-native-sidecars.sh.");
