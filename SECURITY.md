# Security Policy

## Supported versions

Security fixes are provided for the latest published Beta and the latest stable release. Source-only `v0.1.x` installations receive critical fixes when a safe patch is practical, but users should migrate to the desktop line.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or send a private security advisory to the repository maintainers. Do not open a public Issue for leaked credentials, directory escape, approval bypass, arbitrary command execution or update-signature problems.

Include the affected version, macOS version, reproduction steps and the smallest non-sensitive diagnostic output that demonstrates the issue. Never include a real Feishu App Secret, API Key, note body, updater private key or complete user path unless it is essential and explicitly redacted.

We aim to acknowledge a report within seven days. Timelines for a fix and disclosure depend on severity and whether coordinated changes are required upstream.

## Security invariants

- Desktop mode refuses to start without an explicit Feishu chat allowlist.
- Secrets are stored in Keychain and must not appear in config, logs, diagnostics, crash reports or release artifacts.
- All Vault and Codex roots are canonicalized before use; symlink escapes are rejected.
- Workspace-write Codex requests require a fresh, one-time, five-minute local approval.
- No supported configuration may enable flags that bypass the Codex sandbox or approval system.
- Update artifacts are rejected unless their independent Tauri signature verifies.
- Release workflows scan full Git history before publishing artifacts.
