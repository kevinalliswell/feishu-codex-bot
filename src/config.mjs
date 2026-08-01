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

const openAICompatibleProviderPresets = {
  custom: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvName: "OPENAI_COMPAT_API_KEY"
  },
  xingwan: {
    baseUrl: "https://xingwan.store/v1",
    model: "gpt-5.4-mini",
    apiKeyEnvName: "XINGWAN_API_KEY"
  },
  qhaigc: {
    baseUrl: "https://api.qhaigc.net/v1",
    model: "deepseek-chat",
    apiKeyEnvName: "QHAIGC_API_KEY"
  }
};

const imageGenerationProviderPresets = {
  custom: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-2",
    apiKeyEnvName: "IMAGE_GENERATION_API_KEY"
  },
  xingwan: {
    baseUrl: "https://xingwan.store/v1",
    model: "gpt-image-2",
    apiKeyEnvName: "XINGWAN_API_KEY"
  }
};

function resolveOpenAICompatibleProvider(env) {
  const provider = env.OPENAI_COMPAT_PROVIDER || "custom";
  const preset = openAICompatibleProviderPresets[provider] || openAICompatibleProviderPresets.custom;
  const providerApiKey = env[preset.apiKeyEnvName] || "";

  return {
    provider,
    baseUrl: env.OPENAI_COMPAT_BASE_URL || preset.baseUrl,
    model: env.OPENAI_COMPAT_MODEL || preset.model,
    apiKey: env.OPENAI_COMPAT_API_KEY || providerApiKey,
    apiKeyEnvName: preset.apiKeyEnvName
  };
}

function resolveImageGenerationProvider(env) {
  const provider = env.IMAGE_GENERATION_PROVIDER || "xingwan";
  const preset = imageGenerationProviderPresets[provider] || imageGenerationProviderPresets.custom;
  const providerApiKey = env[preset.apiKeyEnvName] || "";

  return {
    provider,
    baseUrl: env.IMAGE_GENERATION_BASE_URL || preset.baseUrl,
    model: env.IMAGE_GENERATION_MODEL || preset.model,
    apiKey: env.IMAGE_GENERATION_API_KEY || providerApiKey,
    apiKeyEnvName: preset.apiKeyEnvName
  };
}

export function loadConfig(env = process.env) {
  const launchDir = process.cwd();
  const defaultCodexWorkdir = resolveGitRoot(launchDir);
  const openAICompatibleProvider = resolveOpenAICompatibleProvider(env);
  const imageGenerationProvider = resolveImageGenerationProvider(env);

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
    openaiCompatProvider: openAICompatibleProvider.provider,
    openaiCompatApiKey: openAICompatibleProvider.apiKey,
    openaiCompatApiKeyEnvName: openAICompatibleProvider.apiKeyEnvName,
    openaiCompatBaseUrl: openAICompatibleProvider.baseUrl,
    openaiCompatChatCompletionsUrl: env.OPENAI_COMPAT_CHAT_COMPLETIONS_URL || "",
    openaiCompatModel: openAICompatibleProvider.model,
    openaiCompatSystemPrompt: env.OPENAI_COMPAT_SYSTEM_PROMPT || "You are a concise assistant replying to Feishu messages.",
    openaiCompatTemperature: parseNumber(env.OPENAI_COMPAT_TEMPERATURE, 0.2),
    openaiCompatMaxTokens: parseNumber(env.OPENAI_COMPAT_MAX_TOKENS, 2000),
    openaiCompatTimeoutMs: parseNumber(env.OPENAI_COMPAT_TIMEOUT_MS, 2 * 60 * 1000),
    imageGenerationProvider: imageGenerationProvider.provider,
    imageGenerationApiKey: imageGenerationProvider.apiKey,
    imageGenerationApiKeyEnvName: imageGenerationProvider.apiKeyEnvName,
    imageGenerationBaseUrl: imageGenerationProvider.baseUrl,
    imageGenerationUrl: env.IMAGE_GENERATION_URL || "",
    imageGenerationModel: imageGenerationProvider.model,
    imageGenerationSize: env.IMAGE_GENERATION_SIZE || "1024x1024",
    imageGenerationQuality: env.IMAGE_GENERATION_QUALITY || "",
    voiceNotesEnabled: parseBool(env.VOICE_NOTES_ENABLED, false),
    obsidianVaultPath: env.OBSIDIAN_VAULT_PATH || "",
    voiceNoteRelativeDir: env.VOICE_NOTE_RELATIVE_DIR || "00_Inbox/feishu/每日口述",
    voiceNoteAllowedChatIds: parseList(env.VOICE_NOTE_ALLOWED_CHAT_IDS),
    voiceNoteTimeZone: env.VOICE_NOTE_TIME_ZONE || "Asia/Shanghai",
    voiceNoteMaxAudioBytes: parseNumber(env.VOICE_NOTE_MAX_AUDIO_BYTES, 25 * 1024 * 1024),
    voiceNoteMaxDurationMs: parseNumber(env.VOICE_NOTE_MAX_DURATION_MS, 30 * 60 * 1000),
    voiceNoteQueueDir: env.VOICE_NOTE_QUEUE_DIR || ".data/voice-note-jobs",
    ffmpegCommand: env.FFMPEG_COMMAND || "ffmpeg",
    whisperCommand: env.WHISPER_COMMAND || "whisper-cli",
    whisperModelPath: env.WHISPER_MODEL_PATH || "",
    voiceNoteTranscribeTimeoutMs: parseNumber(env.VOICE_NOTE_TRANSCRIBE_TIMEOUT_MS, 30 * 60 * 1000),
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
