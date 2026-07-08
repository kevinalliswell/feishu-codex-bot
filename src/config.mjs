import { spawnSync } from "node:child_process";

function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveGitRoot(fallbackDir) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: fallbackDir,
    encoding: "utf8"
  });

  if (result.status === 0) {
    return result.stdout.trim() || fallbackDir;
  }

  return fallbackDir;
}

export function loadConfig(env = process.env) {
  const launchDir = process.cwd();
  const defaultCodexWorkdir = resolveGitRoot(launchDir);

  return {
    port: parseNumber(env.PORT, 3000),
    feishuAppId: env.FEISHU_APP_ID || "",
    feishuAppSecret: env.FEISHU_APP_SECRET || "",
    feishuVerificationToken: env.FEISHU_VERIFICATION_TOKEN || "",
    feishuEncryptKey: env.FEISHU_ENCRYPT_KEY || "",
    feishuDeliveryMode: env.FEISHU_DELIVERY_MODE || "long_connection",
    feishuTriggerMode: env.FEISHU_TRIGGER_MODE || "mention_or_prefix",
    feishuReplyFormat: env.FEISHU_REPLY_FORMAT || "card",
    feishuAllowedChatIds: parseList(env.FEISHU_ALLOWED_CHAT_IDS),
    commandPrefix: env.COMMAND_PREFIX || "",
    codexMode: env.CODEX_MODE || "http",
    codexHttpUrl: env.CODEX_HTTP_URL || "",
    codexHttpMethod: (env.CODEX_HTTP_METHOD || "POST").toUpperCase(),
    codexHttpTimeoutMs: parseNumber(env.CODEX_HTTP_TIMEOUT_MS, 10 * 60 * 1000),
    codexHttpAuthHeader: env.CODEX_HTTP_AUTH_HEADER || "",
    codexHttpAuthToken: env.CODEX_HTTP_AUTH_TOKEN || "",
    codexCliCommand: env.CODEX_CLI_COMMAND || "codex",
    codexCliArgs: parseList(env.CODEX_CLI_ARGS),
    codexCliTimeoutMs: parseNumber(env.CODEX_CLI_TIMEOUT_MS, 10 * 60 * 1000),
    codexExecCommand: env.CODEX_EXEC_COMMAND || "codex",
    codexExecWorkdir: env.CODEX_EXEC_WORKDIR || defaultCodexWorkdir,
    codexExecArgs: parseList(env.CODEX_EXEC_ARGS || "exec,--skip-git-repo-check"),
    codexExecTimeoutMs: parseNumber(env.CODEX_EXEC_TIMEOUT_MS, 10 * 60 * 1000),
    mockFeishuSend: parseBool(env.MOCK_FEISHU_SEND, false)
  };
}
