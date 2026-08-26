# Contributing

Thank you for helping improve Feishu Codex.

## Development setup

Use Node.js 22 or newer, Rust stable and macOS for desktop changes. Install dependencies with `npm ci`; do not commit `node_modules`, generated Sidecar binaries, models, logs, `.env` files or signing keys.

Before opening a pull request, run:

```bash
npm run check
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

Changes to message routing, path handling, IPC, configuration migration, approvals or model downloads should include tests that fail before the implementation and pass afterward.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Preserve the local-first and explicit-authorization boundaries.
- Update README, changelog or architecture documentation when a public workflow, config field or security rule changes.
- Do not add telemetry, cloud transcription, arbitrary Shell bridges or silent privilege escalation.
- Do not weaken signature verification to make an unsigned update pass.

By contributing, you agree that your contribution is licensed under the project's MIT License.
