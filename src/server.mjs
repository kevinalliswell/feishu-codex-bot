import { createServer } from "node:http";
import * as Lark from "@larksuiteoapi/node-sdk";
import { processFeishuEvent } from "./bridge.mjs";
import { loadConfig } from "./config.mjs";
import { isUrlVerification, sendFeishuTextMessage } from "./feishu.mjs";
import { createVoiceNoteProcessor } from "./voice-note-processor.mjs";
import { createVoiceNoteQueue } from "./voice-note-queue.mjs";

const config = loadConfig();
const voiceNoteQueue = config.voiceNotesEnabled
  ? createVoiceNoteQueue({
      queueDir: config.voiceNoteQueueDir,
      processJob: createVoiceNoteProcessor(config),
      onJobError: async (_error, job) => {
        try {
          await sendFeishuTextMessage(
            config,
            job.chatId,
            "语音笔记保存失败，请稍后重新发送这条语音。"
          );
        } catch (replyError) {
          console.error(`[voice-note-error-reply] ${String(replyError?.message || replyError)}`);
        }
      }
    })
  : null;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk.toString();
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

async function handleWebhookPayload(payload) {
  if (isUrlVerification(payload)) {
    return { statusCode: 200, body: { challenge: payload.challenge } };
  }

  const result = await processFeishuEvent(config, payload, { voiceNoteQueue });

  return {
    statusCode: result.statusCode,
    body: result.ok
      ? { ok: true, skipped: result.skipped }
      : { ok: false, error: result.error || result.skipped }
  };
}

function createHealthServer() {
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
        const result = await handleWebhookPayload(payload);
        writeJson(res, result.statusCode, result.body);
        return;
      } catch (error) {
        console.error("[request-error]", error);
        writeJson(res, 400, { ok: false, error: "invalid request body" });
        return;
      }
    }

    writeJson(res, 404, { ok: false, error: "not found" });
  });
}

async function startLongConnection() {
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
      const result = await processFeishuEvent(config, data, { voiceNoteQueue });

      if (result.skipped) {
        console.log(`[feishu-skip] ${result.skipped}`);
        return;
      }

      if (result.ok) {
        console.log("[feishu-ok] processed im.message.receive_v1");
        return;
      }

      console.error(`[feishu-error] ${result.error || "unknown error"}`);
    }
  });

  await wsClient.start({ eventDispatcher });

  const close = () => {
    wsClient.close();
  };

  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  console.log("Feishu long connection is active.");
}

async function main() {
  const healthServer = createHealthServer();

  if (voiceNoteQueue) {
    voiceNoteQueue.start().catch((error) => {
      console.error(`[voice-note-queue-startup] ${String(error?.message || error)}`);
    });
  }

  healthServer.listen(config.port, () => {
    console.log(`Feishu Codex bridge listening on http://127.0.0.1:${config.port}`);

    if (config.feishuDeliveryMode === "webhook") {
      console.log(`Webhook endpoint: http://127.0.0.1:${config.port}/webhook/feishu`);
      return;
    }

    console.log("Health endpoint: /healthz");
    console.log("Delivery mode: long_connection");
  });

  if (config.feishuDeliveryMode === "webhook") {
    return;
  }

  await startLongConnection();
}

main().catch((error) => {
  console.error("[startup-error]", error);
  process.exitCode = 1;
});
