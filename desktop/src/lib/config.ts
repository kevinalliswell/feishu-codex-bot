import type { AppConfig, CodexRoot } from "../types";

export function createDefaultConfig(): AppConfig {
  return {
    version: 1,
    onboardingComplete: false,
    paused: false,
    launchAtLogin: true,
    feishu: { appId: "", allowedChatIds: [] },
    obsidian: {
      vaultPath: "",
      relativeDir: "00_Inbox/feishu/每日口述",
      timeZone: "Asia/Shanghai"
    },
    transcription: {
      enabled: true,
      language: "zh",
      modelName: "ggml-large-v3-turbo-q5_0.bin"
    },
    codex: {
      enabled: true,
      mode: "codex_exec",
      provider: "custom",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
      roots: []
    },
    image: {
      enabled: true,
      provider: "xingwan",
      baseUrl: "https://xingwan.store/v1",
      model: "gpt-image-2",
      size: "1024x1024"
    }
  };
}

function normalizedRoot(root: CodexRoot): string {
  return root.path.trim().replace(/\/+$/, "");
}

function rootsOverlap(left: CodexRoot, right: CodexRoot): boolean {
  const leftPath = normalizedRoot(left);
  const rightPath = normalizedRoot(right);
  return leftPath === rightPath
    || leftPath.startsWith(`${rightPath}/`)
    || rightPath.startsWith(`${leftPath}/`);
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  const relativeSegments = config.obsidian.relativeDir.split("/").filter(Boolean);

  if (config.obsidian.relativeDir.startsWith("/") || relativeSegments.includes("..")) {
    errors.push("笔记目录必须是 Vault 内的相对路径");
  }

  const roots = config.codex.roots.filter((root) => normalizedRoot(root));
  if (roots.some((root) => !normalizedRoot(root).startsWith("/"))) {
    errors.push("Codex 授权目录必须使用绝对路径");
  }

  if (roots.some((root, index) => roots.slice(index + 1).some((other) => rootsOverlap(root, other)))) {
    errors.push("Codex 授权目录不能互相包含");
  }

  if (config.feishu.appId && !config.feishu.appId.startsWith("cli_")) {
    errors.push("飞书 App ID 应以 cli_ 开头");
  }

  return errors;
}
