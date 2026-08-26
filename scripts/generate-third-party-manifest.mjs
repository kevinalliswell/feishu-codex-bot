import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputIndex = process.argv.indexOf("--out");
const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : "artifacts/third-party-licenses.json");
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const nodePackages = Object.entries(lock.packages || {})
  .filter(([location]) => location.startsWith("node_modules/"))
  .map(([location, metadata]) => ({
    ecosystem: "npm",
    name: metadata.name || location.replace(/^node_modules\//, ""),
    version: metadata.version || "unknown",
    license: metadata.license || "NOASSERTION"
  }));
const cargo = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", "desktop/src-tauri/Cargo.toml"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }));
const rustPackages = cargo.packages.map((metadata) => ({
  ecosystem: "cargo",
  name: metadata.name,
  version: metadata.version,
  license: metadata.license || "NOASSERTION",
  repository: metadata.repository || undefined
}));
const nativePackages = [
  { ecosystem: "native", name: "FFmpeg", version: "9.0.1", license: "LGPL-2.1-or-later", source: "https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz" },
  { ecosystem: "native", name: "whisper.cpp", version: "1.9.2", license: "MIT", source: "https://github.com/ggml-org/whisper.cpp" }
];

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify([...nodePackages, ...rustPackages, ...nativePackages], null, 2)}\n`, { mode: 0o644 });
console.log(`Wrote ${nodePackages.length + rustPackages.length + nativePackages.length} dependency records to ${outputPath}`);
