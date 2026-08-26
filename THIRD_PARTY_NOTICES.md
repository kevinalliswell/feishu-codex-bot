# Third-Party Notices

Release artifacts include a machine-readable `third-party-licenses.json` and SPDX SBOM generated from the exact dependency graph used for that release. The main bundled native components are:

## FFmpeg 9.0.1

Feishu Codex builds a minimal, static FFmpeg executable with GPL and nonfree components disabled. It is distributed under LGPL-2.1-or-later. Source: <https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz>.

The build configuration is reproducible from `scripts/build-native-sidecars.sh`. Recipients may replace or rebuild this executable from the corresponding source under the terms of the LGPL.

## whisper.cpp 1.9.2

whisper.cpp is distributed under the MIT License. Source: <https://github.com/ggml-org/whisper.cpp/tree/v1.9.2>.

## Tauri and Rust dependencies

Tauri, its plugins and the Rust crates used by the desktop process retain their respective licenses. Exact names, versions, licenses and repository links are included in each release's generated dependency manifest and SPDX SBOM.

## Node.js dependencies

The Feishu SDK and other npm packages are embedded into the Node Sidecar by `@yao-pkg/pkg`. Exact dependency versions and declared licenses are included in each release's generated dependency manifest and SPDX SBOM.

This notice is informational and does not replace the complete license texts distributed by each upstream project.
