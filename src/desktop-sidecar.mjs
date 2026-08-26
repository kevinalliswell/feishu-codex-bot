import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import readline from "node:readline";

const MAX_PROTOCOL_LINE_BYTES = 1_000_000;

function list(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function buildDesktopEnvironment(config, secrets, paths) {
  if (config?.version !== 1) {
    throw new Error("Unsupported desktop config version");
  }
  const root = config.codex?.roots?.[0];
  const codexAccess = root?.access === "write" ? "workspace-write" : "read-only";
  const allowedChatIds = list(config.feishu?.allowedChatIds).join(",");
  if (!allowedChatIds) {
    throw new Error("Desktop mode requires at least one allowed Feishu chat");
  }
  if (!String(config.feishu?.appId || "") || !String(secrets.feishuAppSecret || "")) {
    throw new Error("Desktop mode requires Feishu credentials");
  }
  if (!String(config.obsidian?.vaultPath || "")) {
    throw new Error("Desktop mode requires an authorized Obsidian Vault");
  }

  return {
    PORT: "0",
    FEISHU_APP_ID: String(config.feishu?.appId || ""),
    FEISHU_APP_SECRET: String(secrets.feishuAppSecret || ""),
    FEISHU_DELIVERY_MODE: "long_connection",
    FEISHU_TRIGGER_MODE: "prefix",
    FEISHU_REPLY_FORMAT: "card",
    FEISHU_ALLOWED_CHAT_IDS: allowedChatIds,
    COMMAND_PREFIX: "/codex",
    VOICE_NOTES_ENABLED: String(Boolean(config.transcription?.enabled)),
    OBSIDIAN_VAULT_PATH: String(config.obsidian?.vaultPath || ""),
    VOICE_NOTE_RELATIVE_DIR: String(config.obsidian?.relativeDir || ""),
    VOICE_NOTE_ALLOWED_CHAT_IDS: allowedChatIds,
    VOICE_NOTE_TIME_ZONE: String(config.obsidian?.timeZone || "Asia/Shanghai"),
    VOICE_NOTE_QUEUE_DIR: `${paths.dataDir}/voice-note-jobs`,
    VOICE_NOTE_LANGUAGE: String(config.transcription?.language || "zh"),
    FFMPEG_COMMAND: String(paths.ffmpegPath || "ffmpeg"),
    WHISPER_COMMAND: String(paths.whisperPath || "whisper-cli"),
    WHISPER_MODEL_PATH: String(paths.modelPath || ""),
    CODEX_MODE: config.codex?.enabled ? String(config.codex.mode || "codex_exec") : "mock",
    CODEX_EXEC_WORKDIR: String(root?.path || ""),
    CODEX_EXEC_ARGS: `exec,--skip-git-repo-check,--sandbox,${codexAccess}`,
    OPENAI_COMPAT_API_KEY: String(secrets.assistantApiKey || ""),
    OPENAI_COMPAT_PROVIDER: String(config.codex?.provider || "custom"),
    OPENAI_COMPAT_BASE_URL: String(config.codex?.baseUrl || ""),
    OPENAI_COMPAT_MODEL: String(config.codex?.model || ""),
    IMAGE_GENERATION_PROVIDER: String(config.image?.provider || "custom"),
    IMAGE_GENERATION_API_KEY: String(secrets.imageApiKey || ""),
    IMAGE_GENERATION_BASE_URL: String(config.image?.baseUrl || ""),
    IMAGE_GENERATION_MODEL: String(config.image?.model || "gpt-image-2"),
    IMAGE_GENERATION_SIZE: String(config.image?.size || "1024x1024"),
    DESKTOP_CODEX_ACCESS: root?.access || "read"
  };
}

export function parseProtocolLine(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
    throw new Error("Protocol line is too large");
  }
  const message = JSON.parse(line);
  if (!message || message.version !== 1) {
    throw new Error("Unsupported protocol version");
  }
  if (typeof message.type !== "string" || !message.type || message.type.length > 80) {
    throw new Error("Invalid protocol message type");
  }
  return message;
}

export function createApprovalCoordinator(emit, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const pending = new Map();

  function request(input) {
    const id = input.id || randomUUID();
    const expiresAtMs = Date.now() + timeoutMs;
    emit({ version: 1, type: "approvalRequired", payload: { ...input, id, expiresAtMs } });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, timer });
    });
  }

  function resolve(id, approved) {
    const approval = pending.get(id);
    if (!approval) {
      return false;
    }
    pending.delete(id);
    clearTimeout(approval.timer);
    approval.resolve(Boolean(approved));
    return true;
  }

  return { request, resolve };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function safeLog(value) {
  return String(value || "")
    .replace(/(secret|token|api[_-]?key)=[^\s,]+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[^\s,]+/gi, "Bearer [redacted]")
    .replace(/\bsk[-_][A-Za-z0-9_-]{10,}\b/g, "[redacted-api-key]")
    .slice(0, 2_000);
}

export async function runSidecar() {
  let runtime = null;
  let state = "needs-setup";
  const coordinator = createApprovalCoordinator(writeMessage);
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  console.log = (...values) => writeMessage({ version: 1, type: "log", payload: { level: "info", message: safeLog(values.join(" ")) } });
  console.error = (...values) => writeMessage({ version: 1, type: "log", payload: { level: "error", message: safeLog(values.join(" ")) } });

  for await (const line of input) {
    let message;
    try {
      message = parseProtocolLine(line);
      let result = {};

      if (message.type === "bootstrap") {
        if (runtime) {
          throw new Error("Sidecar is already bootstrapped");
        }
        const env = buildDesktopEnvironment(message.payload.config, message.payload.secrets, message.payload.paths);
        Object.assign(process.env, env);
        const { startBridge } = await import("./server.mjs");
        state = "busy";
        runtime = await startBridge({
          requestCodexApproval: (request) => coordinator.request(request),
          onStatus: (nextState) => {
            state = nextState;
            writeMessage({ version: 1, type: "status", payload: { state } });
          }
        });
        state = "connected";
        result = { state };
      } else if (message.type === "status") {
        result = { state, running: Boolean(runtime) };
      } else if (message.type === "resolveApproval") {
        result = { resolved: coordinator.resolve(message.payload?.id, message.payload?.approved) };
      } else if (message.type === "shutdown") {
        await runtime?.close?.();
        result = { stopped: true };
      } else {
        throw new Error("Unsupported protocol command");
      }

      writeMessage({ version: 1, id: message.id, ok: true, result });
      if (message.type === "shutdown") {
        return;
      }
    } catch (error) {
      writeMessage({
        version: 1,
        id: message?.id,
        ok: false,
        error: { code: "SIDECAR_COMMAND_FAILED", message: safeLog(error?.message || error) }
      });
    }
  }
}

const isMain = Boolean(process.pkg)
  || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) {
  runSidecar().catch((error) => {
    writeMessage({ version: 1, type: "fatal", payload: { message: safeLog(error?.message || error) } });
    process.exitCode = 1;
  });
}
