import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withTimeout(promise, ms, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function invokeHttp(config, prompt, context) {
  if (!config.codexHttpUrl) {
    throw new Error("Missing CODEX_HTTP_URL for CODEX_MODE=http");
  }

  const headers = {
    "Content-Type": "application/json; charset=utf-8"
  };

  if (config.codexHttpAuthHeader && config.codexHttpAuthToken) {
    headers[config.codexHttpAuthHeader] = config.codexHttpAuthToken;
  }

  const request = fetch(config.codexHttpUrl, {
    method: config.codexHttpMethod,
    headers,
    body: JSON.stringify({
      prompt,
      source: "feishu",
      context
    })
  }).then(async (response) => {
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Codex HTTP error ${response.status}: ${text}`);
    }

    try {
      const data = JSON.parse(text);
      return data.reply || data.output || data.result || text;
    } catch {
      return text;
    }
  });

  return withTimeout(request, config.codexHttpTimeoutMs, "Codex HTTP request");
}

async function invokeCli(config, prompt) {
  return withTimeout(new Promise((resolve, reject) => {
    const child = spawn(config.codexCliCommand, config.codexCliArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`));
        return;
      }

      resolve(stdout.trim() || stderr.trim() || "Codex CLI completed with empty output.");
    });

    child.stdin.write(prompt);
    child.stdin.end();
  }), config.codexCliTimeoutMs, "Codex CLI");
}

async function invokeCodexExec(config, prompt) {
  const tempDir = await mkdtemp(join(tmpdir(), "feishu-codex-"));
  const outputFile = join(tempDir, "last-message.txt");
  const args = [
    ...config.codexExecArgs,
    "-C",
    config.codexExecWorkdir,
    "--output-last-message",
    outputFile,
    "-"
  ];

  try {
    await withTimeout(new Promise((resolve, reject) => {
      const child = spawn(config.codexExecCommand, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`codex exec exited with code ${code}: ${stderr || stdout}`));
          return;
        }

        resolve();
      });

      child.stdin.write(prompt);
      child.stdin.end();
    }), config.codexExecTimeoutMs, "codex exec");

    const output = await readFile(outputFile, "utf8").catch(() => "");
    return output.trim() || "codex exec completed with empty output.";
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runCodex(config, prompt, context) {
  if (config.codexMode === "mock") {
    return `Mock Codex received:\n${prompt}`;
  }

  if (config.codexMode === "codex_exec") {
    return invokeCodexExec(config, prompt, context);
  }

  if (config.codexMode === "cli") {
    return invokeCli(config, prompt);
  }

  if (config.codexMode === "http") {
    return invokeHttp(config, prompt, context);
  }

  throw new Error(`Unsupported CODEX_MODE: ${config.codexMode}`);
}
