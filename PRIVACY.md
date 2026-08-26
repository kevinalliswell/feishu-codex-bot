# Privacy Notice

Feishu Codex is a local-first desktop application. It does not include product analytics or a project-operated cloud backend.

## Data stored on the Mac

- Configuration, queue state and downloaded models under `~/Library/Application Support/Feishu Codex/`.
- App Secret and API Keys in macOS Keychain.
- Redacted operational logs under `~/Library/Logs/Feishu Codex/`.
- User notes in the Obsidian Vault selected through the macOS directory picker.

Queued text can temporarily appear in owner-only local job files while waiting or retrying. Successful jobs remove the body from queue state. Temporary audio and transcription files are deleted after processing.

## Network connections

- Feishu receives and stores messages according to the user's Feishu account and application configuration. The desktop App uses Feishu APIs to receive events, download voice files and send confirmations or results.
- Whisper model downloads use the project's GitHub Release as the primary source and the official whisper.cpp Hugging Face repository as fallback.
- The updater requests signed metadata and release files from this project's GitHub Releases.
- Codex, OpenAI-compatible and image generation features contact only the services the user enables. Prompts sent to those services are governed by their privacy policies.

Voice transcription itself runs locally through FFmpeg and whisper.cpp. Feishu Codex does not send voice content to a separate cloud transcription provider.

## User control

The user chooses every Vault and Codex directory, can pause message reception, remove credentials from Keychain, disable login launch, delete models/logs/queue state, or uninstall the App. Uninstalling the App does not delete the user's Obsidian notes.
