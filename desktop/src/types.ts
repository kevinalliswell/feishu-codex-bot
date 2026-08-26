export type ServiceState = "needs-setup" | "connected" | "busy" | "error" | "paused";
export type RootAccess = "read" | "write";

export interface CodexRoot {
  path: string;
  access: RootAccess;
}

export interface AppConfig {
  version: 1;
  onboardingComplete: boolean;
  paused: boolean;
  launchAtLogin: boolean;
  feishu: {
    appId: string;
    allowedChatIds: string[];
  };
  obsidian: {
    vaultPath: string;
    relativeDir: string;
    timeZone: string;
  };
  transcription: {
    enabled: boolean;
    language: string;
    modelName: string;
  };
  codex: {
    enabled: boolean;
    mode: "codex_exec" | "openai_compatible";
    provider: string;
    baseUrl: string;
    model: string;
    roots: CodexRoot[];
  };
  image: {
    enabled: boolean;
    provider: "xingwan" | "custom";
    baseUrl: string;
    model: string;
    size: string;
  };
}

export interface SecretStatus {
  feishuAppSecret: boolean;
  assistantApiKey: boolean;
  imageApiKey: boolean;
}

export interface RuntimeStatus {
  state: ServiceState;
  message: string;
  sidecarRunning: boolean;
  feishuConnected: boolean;
  modelReady: boolean;
  queueDepth: number;
  todayNotePath: string;
  version: string;
}

export interface PendingApproval {
  id: string;
  requester: string;
  prompt: string;
  rootPath: string;
  expiresAtMs: number;
}
