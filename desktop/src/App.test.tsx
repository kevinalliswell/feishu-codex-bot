import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createDefaultConfig } from "./lib/config";
import type { DesktopApi, DesktopSnapshot } from "./lib/desktop-api";

function createFakeApi(onboardingComplete = false): DesktopApi & { saveConfig: ReturnType<typeof vi.fn>; setSecret: ReturnType<typeof vi.fn> } {
  const config = createDefaultConfig();
  config.onboardingComplete = onboardingComplete;
  const snapshot: DesktopSnapshot = {
    config,
    secrets: { feishuAppSecret: false, assistantApiKey: false, imageApiKey: false },
    status: {
      state: onboardingComplete ? "connected" : "needs-setup",
      message: onboardingComplete ? "飞书长连接正常" : "完成配置后即可连接飞书",
      sidecarRunning: onboardingComplete,
      feishuConnected: onboardingComplete,
      modelReady: false,
      queueDepth: 0,
      todayNotePath: "",
      version: "0.2.0-beta.1"
    },
    approvals: onboardingComplete ? [{
      id: "approval-1",
      requester: "ou_owner",
      prompt: "更新项目 README",
      rootPath: "/Users/example/project",
      expiresAtMs: Date.now() + 60_000
    }] : []
  };

  return {
    getSnapshot: vi.fn(async () => snapshot),
    saveConfig: vi.fn(async (config) => config),
    setSecret: vi.fn(async () => undefined),
    deleteSecret: vi.fn(async () => undefined),
    testFeishu: vi.fn(async () => undefined),
    chooseDirectory: vi.fn(async () => "/Users/example/Obsidian Vault"),
    downloadModel: vi.fn(async () => "/Users/example/model.bin"),
    restartSidecar: vi.fn(async () => undefined),
    pauseSidecar: vi.fn(async () => undefined),
    resolveApproval: vi.fn(async () => undefined),
    runDiagnostics: vi.fn(async () => ({ ok: true, checks: [] })),
    openTodayNote: vi.fn(async () => undefined),
    inspectLegacy: vi.fn(async () => ({ found: false, sourcePath: "", appId: "", vaultPath: "", relativeDir: "", allowedChatIds: [], hasFeishuSecret: false, hasAssistantApiKey: false, hasImageApiKey: false, launchAgentFound: false })),
    chooseLegacyEnv: vi.fn(async () => null),
    importLegacy: vi.fn(async () => config),
    disableLegacyService: vi.fn(async () => undefined)
  };
}

describe("desktop onboarding", () => {
  it("stores the Feishu secret separately and advances to Obsidian", async () => {
    const api = createFakeApi();
    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "把随口一说，变成日后可复盘的笔记" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "开始配置" }));

    fireEvent.change(screen.getByLabelText("App ID"), { target: { value: "cli_test" } });
    fireEvent.change(screen.getByLabelText("App Secret"), { target: { value: "secret-value" } });
    fireEvent.change(screen.getByLabelText("允许的飞书会话"), { target: { value: "oc_owner" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接并继续" }));

    await waitFor(() => expect(api.setSecret).toHaveBeenCalledWith("feishuAppSecret", "secret-value"));
    await waitFor(() => expect(api.testFeishu).toHaveBeenCalled());
    expect(api.saveConfig).toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "选择你的 Obsidian Vault" })).toBeVisible();
    expect(screen.queryByDisplayValue("secret-value")).not.toBeInTheDocument();
  });

  it("shows every settings area and pending local approvals", async () => {
    const api = createFakeApi(true);
    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "运行概览" })).toBeVisible();
    for (const label of ["运行概览", "飞书连接", "Obsidian", "语音转写", "Codex 与图片", "安全与目录", "诊断与更新"]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByText("更新项目 README")).toBeVisible();
    expect(screen.getByRole("button", { name: "允许一次" })).toBeVisible();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeVisible();
  });
});
