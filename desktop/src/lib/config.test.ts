import { describe, expect, it } from "vitest";
import { createDefaultConfig, validateConfig } from "./config";

describe("desktop configuration", () => {
  it("enables product modules but leaves privileged paths unconfigured", () => {
    const config = createDefaultConfig();

    expect(config.version).toBe(1);
    expect(config.transcription.enabled).toBe(true);
    expect(config.codex.enabled).toBe(true);
    expect(config.image.enabled).toBe(true);
    expect(config.codex.roots).toEqual([]);
    expect(config.onboardingComplete).toBe(false);
  });

  it("rejects an absolute Obsidian relative directory", () => {
    const config = createDefaultConfig();
    config.obsidian.vaultPath = "/Users/example/Vault";
    config.obsidian.relativeDir = "/tmp/outside";

    expect(validateConfig(config)).toContain("笔记目录必须是 Vault 内的相对路径");
  });

  it("rejects duplicate or nested codex roots", () => {
    const config = createDefaultConfig();
    config.codex.roots = [
      { path: "/Users/example/Code", access: "read" },
      { path: "/Users/example/Code/project", access: "write" }
    ];

    expect(validateConfig(config)).toContain("Codex 授权目录不能互相包含");
  });
});
