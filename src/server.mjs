import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import { processFeishuEvent } from "./bridge.mjs";
import { loadConfig } from "./config.mjs";
import { isUrlVerification, sendFeishuTextMessage } from "./feishu.mjs";
import { createVoiceNoteProcessor } from "./voice-note-processor.mjs";
import { createVoiceNoteQueue } from "./voice-note-queue.mjs";

function createNoteQueue(config) {
  if (!config.voiceNotesEnabled) {
    return null;
  }

  return createVoiceNoteQueue({
    queueDir: config.voiceNoteQueueDir,
    processJob: createVoiceNoteProcessor(config),
    onJobError: async (_error, job) => {
      try {
        const noteType = job.kind === "text" ? "文字笔记" : "语音笔记";
        await sendFeishuTextMessage(config, job.chatId, `${noteType}保存失败，请稍后重新发送这条笔记。`);
      } catch (replyError) {
        console.error(`[voice-note-error-reply] ${String(replyError?.message || replyError)}`);
      }
    }
  });
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function createHealthServer(config, voiceNoteQueue, requestCodexApproval) {
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      writeJson(res, 200, {
        ok: true,
        deliveryMode: config.feishuDeliveryMode,
        voiceNotesEnabled: config.voiceNotesEnabled
      });
      return;
    }

    if (config.feishuDeliveryMode === "webhook" && req.method === "POST" && req.url === "/webhook/feishu") {
      try {
        const payload = await readJsonBody(req);
        if (isUrlVerification(payload)) {
          writeJson(res, 200, { challenge: payload.challenge });
          return;
        }
        const result = await processFeishuEvent(config, payload, { voiceNoteQueue, requestCodexApproval });
        writeJson(res, result.statusCode, result.ok
          ? { ok: true, skipped: result.skipped }
          : { ok: false, error: result.error || result.skipped });
        return;
      } catch (error) {
        console.error(`[request-error] ${String(error?.message || error)}`);
        writeJson(res, 400, { ok: false, error: "invalid request body" });
        return;
      }
    }

    writeJson(res, 404, { ok: false, error: "not found" });
  });
}

async function startLongConnection(config, voiceNoteQueue, requestCodexApproval) {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const wsClient = new Lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    loggerLevel: Lark.LoggerLevel.info
  });
  const eventDispatcher = new Lark.EventDispatcher({
    encryptKey: config.feishuEncryptKey || undefined
  }).register({
    "im.message.receive_v1": async (data) => {
      const result = await processFeishuEvent(config, data, { voiceNoteQueue, requestCodexApproval });
      if (result.skipped) {
        console.log(`[feishu-skip] ${result.skipped}`);
      } else if (result.ok) {
        console.log("[feishu-ok] processed im.message.receive_v1");
      } else {
        console.error(`[feishu-error] ${result.error || "unknown error"}`);
      }
    }
  });

  await wsClient.start({ eventDispatcher });
  return wsClient;
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

export async function startBridge({
  config = loadConfig(),
  requestCodexApproval,
  onStatus = () => {}
} = {}) {
  let currentStatus = "busy";
  let wsClient = null;
  let closed = false;
  onStatus(currentStatus);

  const voiceNoteQueue = createNoteQueue(config);
  const healthServer = createHealthServer(config, voiceNoteQueue, requestCodexApproval);

  try {
    await voiceNoteQueue?.start();
    await listen(healthServer, config.port);
    if (config.feishuDeliveryMode !== "webhook") {
      wsClient = await startLongConnection(config, voiceNoteQueue, requestCodexApproval);
    }
    currentStatus = "connected";
    onStatus(currentStatus);
  } catch (error) {
    currentStatus = "error";
    onStatus(currentStatus);
    if (healthServer.listening) {
      await closeServer(healthServer).catch(() => {});
    }
    throw error;
  }

  const address = healthServer.address();
  return {
    port: typeof address === "object" && address ? address.port : config.port,
    status: () => currentStatus,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      wsClient?.close();
      if (healthServer.listening) {
        await closeServer(healthServer);
      }
      currentStatus = "stopped";
      onStatus(currentStatus);
    }
  };
}

async function main() {
  const runtime = await startBridge();
  const close = () => runtime.close().catch((error) => {
    console.error(`[shutdown-error] ${String(error?.message || error)}`);
  });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  console.log(`Feishu Codex bridge listening on http://127.0.0.1:${runtime.port}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(`[startup-error] ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}
