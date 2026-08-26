import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDesktopEnvironment,
  createApprovalCoordinator,
  parseProtocolLine
} from "../src/desktop-sidecar.mjs";

const desktopConfig = {
  version: 1,
  onboardingComplete: true,
  paused: false,
  feishu: { appId: "cli_test", allowedChatIds: ["oc_owner"] },
  obsidian: {
    vaultPath: "/Users/example/Vault",
    relativeDir: "00_Inbox/feishu/每日口述",
    timeZone: "Asia/Shanghai"
  },
  transcription: { enabled: true, language: "zh", modelName: "model.bin" },
  codex: {
    enabled: true,
    mode: "codex_exec",
    roots: [{ path: "/Users/example/project", access: "write" }]
  },
  image: {
    enabled: true,
    provider: "xingwan",
    baseUrl: "https://xingwan.store/v1",
    model: "gpt-image-2",
    size: "1024x1024"
  }
};

test("desktop bootstrap maps configuration without dangerous Codex flags", () => {
  const env = buildDesktopEnvironment(desktopConfig, {
    feishuAppSecret: "feishu-secret",
    assistantApiKey: "assistant-key",
    imageApiKey: "image-key"
  }, {
    dataDir: "/Users/example/AppData",
    modelPath: "/Users/example/AppData/models/model.bin",
    ffmpegPath: "/Applications/Feishu Codex.app/ffmpeg",
    whisperPath: "/Applications/Feishu Codex.app/whisper-cli"
  });

  assert.equal(env.FEISHU_APP_ID, "cli_test");
  assert.equal(env.VOICE_NOTE_ALLOWED_CHAT_IDS, "oc_owner");
  assert.equal(env.CODEX_EXEC_WORKDIR, "/Users/example/project");
  assert.equal(env.CODEX_EXEC_ARGS, "exec,--skip-git-repo-check,--sandbox,workspace-write");
  assert.doesNotMatch(env.CODEX_EXEC_ARGS, /dangerously|bypass/);
});

test("protocol rejects unknown versions and oversized lines", () => {
  assert.throws(() => parseProtocolLine(JSON.stringify({ version: 2, id: "1", type: "status" })), /version/);
  assert.throws(() => parseProtocolLine("x".repeat(1_000_001)), /too large/);
});

test("approval coordinator resolves a pending write once", async () => {
  const events = [];
  const coordinator = createApprovalCoordinator((event) => events.push(event), { timeoutMs: 1000 });
  const decision = coordinator.request({
    id: "approval-1",
    requester: "ou_owner",
    prompt: "更新 README",
    rootPath: "/Users/example/project"
  });

  assert.equal(events[0].type, "approvalRequired");
  assert.equal(coordinator.resolve("approval-1", true), true);
  assert.equal(await decision, true);
  assert.equal(coordinator.resolve("approval-1", true), false);
});
