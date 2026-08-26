import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, PendingApproval, RuntimeStatus, SecretStatus } from "../types";
import { createDefaultConfig } from "./config";

export interface DesktopSnapshot {
  config: AppConfig;
  secrets: SecretStatus;
  status: RuntimeStatus;
  approvals: PendingApproval[];
}

export interface DiagnosticResult {
  ok: boolean;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

export interface LegacyPreview {
  found: boolean;
  sourcePath: string;
  appId: string;
  vaultPath: string;
  relativeDir: string;
  allowedChatIds: string[];
  hasFeishuSecret: boolean;
  hasAssistantApiKey: boolean;
  hasImageApiKey: boolean;
  launchAgentFound: boolean;
}

export interface DesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  saveConfig(config: AppConfig): Promise<AppConfig>;
  setSecret(kind: keyof SecretStatus, value: string): Promise<void>;
  deleteSecret(kind: keyof SecretStatus): Promise<void>;
  testFeishu(): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  downloadModel(): Promise<string>;
  restartSidecar(): Promise<void>;
  pauseSidecar(paused: boolean): Promise<void>;
  resolveApproval(id: string, approved: boolean): Promise<void>;
  runDiagnostics(): Promise<DiagnosticResult>;
  openTodayNote(): Promise<void>;
  inspectLegacy(sourcePath?: string): Promise<LegacyPreview>;
  chooseLegacyEnv(): Promise<string | null>;
  importLegacy(sourcePath: string): Promise<AppConfig>;
  disableLegacyService(): Promise<void>;
}

function browserFallback(): DesktopApi {
  let config = createDefaultConfig();
  const previewDashboard = new URLSearchParams(window.location.search).get("preview") === "dashboard";
  config.onboardingComplete = previewDashboard;
  const secrets: SecretStatus = {
    feishuAppSecret: false,
    assistantApiKey: false,
    imageApiKey: false
  };
  const status: RuntimeStatus = {
    state: previewDashboard ? "connected" : "needs-setup",
    message: previewDashboard ? "飞书长连接正常，正在等待新消息" : "浏览器预览模式：完成配置后桌面服务将自动启动",
    sidecarRunning: previewDashboard,
    feishuConnected: previewDashboard,
    modelReady: false,
    queueDepth: 0,
    todayNotePath: "",
    version: "0.2.0-beta.1"
  };

  return {
    async getSnapshot() {
      return {
        config: structuredClone(config),
        secrets: { ...secrets },
        status: { ...status },
        approvals: previewDashboard ? [{
          id: "preview-approval",
          requester: "飞书用户",
          prompt: "整理并更新本周复盘",
          rootPath: "/Users/example/Notes",
          expiresAtMs: Date.now() + 60_000
        }] : []
      };
    },
    async saveConfig(next) {
      config = structuredClone(next);
      return structuredClone(config);
    },
    async setSecret(kind) {
      secrets[kind] = true;
    },
    async deleteSecret(kind) {
      secrets[kind] = false;
    },
    async testFeishu() {},
    async chooseDirectory() {
      return "/Users/kevin/Documents/Obsidian Vault";
    },
    async downloadModel() {
      status.modelReady = true;
      return "~/Library/Application Support/Feishu Codex/models/ggml-large-v3-turbo-q5_0.bin";
    },
    async restartSidecar() {
      status.state = "connected";
      status.sidecarRunning = true;
      status.feishuConnected = true;
    },
    async pauseSidecar(paused) {
      status.state = paused ? "paused" : "connected";
    },
    async resolveApproval() {},
    async runDiagnostics() {
      return { ok: true, checks: [{ label: "界面预览", ok: true, detail: "桌面命令将在 Tauri 中执行" }] };
    },
    async openTodayNote() {},
    async inspectLegacy() {
      return { found: false, sourcePath: "", appId: "", vaultPath: "", relativeDir: "", allowedChatIds: [], hasFeishuSecret: false, hasAssistantApiKey: false, hasImageApiKey: false, launchAgentFound: false };
    },
    async chooseLegacyEnv() { return null; },
    async importLegacy() { return structuredClone(config); },
    async disableLegacyService() {}
  };
}

export function createDesktopApi(): DesktopApi {
  if (!("__TAURI_INTERNALS__" in window)) {
    return browserFallback();
  }

  return {
    getSnapshot: () => invoke("get_snapshot"),
    saveConfig: (config) => invoke("save_config", { config }),
    setSecret: (kind, value) => invoke("set_secret", { kind, value }),
    deleteSecret: (kind) => invoke("delete_secret", { kind }),
    testFeishu: () => invoke("test_feishu"),
    async chooseDirectory() {
      const selection = await open({ directory: true, multiple: false, canCreateDirectories: true });
      return typeof selection === "string" ? selection : null;
    },
    downloadModel: () => invoke("download_model"),
    restartSidecar: () => invoke("restart_sidecar"),
    pauseSidecar: (paused) => invoke("set_paused", { paused }),
    resolveApproval: (id, approved) => invoke("resolve_approval", { id, approved }),
    runDiagnostics: () => invoke("run_diagnostics"),
    openTodayNote: () => invoke("open_today_note"),
    inspectLegacy: (sourcePath) => invoke("inspect_legacy", { sourcePath }),
    async chooseLegacyEnv() {
      const selection = await open({ multiple: false, directory: false, title: "选择旧版 .env 配置" });
      return typeof selection === "string" ? selection : null;
    },
    importLegacy: (sourcePath) => invoke("import_legacy", { sourcePath }),
    disableLegacyService: () => invoke("disable_legacy_service")
  };
}
