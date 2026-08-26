# Desktop Architecture and Security Boundaries

## Process model

The React webview presents configuration and status. It can call only registered Tauri commands. Rust owns configuration, Keychain access, directory authorization, model downloads, the menu bar, autostart, updates and Sidecar lifecycle.

The bridge remains a separate Node Sidecar so Feishu long-connection and queue behavior can be tested independently. Desktop builds package it into a Node 22 arm64 executable. Rust exchanges newline-delimited JSON on standard input/output; there is no general-purpose local RPC or Shell command.

## IPC v1

```json
{"version":1,"id":"request-id","type":"status","payload":{}}
{"version":1,"id":"request-id","ok":true,"result":{}}
{"version":1,"type":"approvalRequired","payload":{}}
```

Frames are limited to 1 MB and support partial or multiple chunks. Unknown versions and command types are rejected. The only Sidecar requests are bootstrap, status, approval resolution and shutdown.

## Directory authorization

Vault and Codex directories originate from the system picker. Rust requires absolute existing directories and stores their canonical paths. Before creating a note directory it canonicalizes the final parent and confirms it remains below the selected Vault. This rejects `..` traversal and symlinks to outside directories.

The daily note name is derived internally from an IANA time zone and the current date; external messages cannot choose a file name. Node also retains its own path and input validation as defense in depth.

## Codex approval model

Read-only roots run with the Codex read-only sandbox. A root configured as writable still uses workspace-write sandboxing, and every request creates an approval containing the Feishu sender, prompt summary, canonical root and expiration. Rust stores it for five minutes and accepts one decision. Approval IDs cannot be reused.

The Sidecar strips dangerous bypass flags from inherited configuration. The desktop protocol offers no way to supply arbitrary executables or command-line arguments.

## Update trust

Tauri update archives use an independent Minisign key. The public key and Beta metadata endpoint are compiled into the App. `desktop-beta/latest.json` points to a versioned release archive and includes its signature. Apple code signing is a separate platform trust layer and becomes mandatory for stable releases.

## Migration

Legacy `.env` files are parsed line by line without evaluation, interpolation or command substitution. Non-sensitive fields are previewed. Secrets move to Keychain and the source is backed up with owner-only permissions. The legacy LaunchAgent is disabled only through the exact known path and only after explicit user action.
