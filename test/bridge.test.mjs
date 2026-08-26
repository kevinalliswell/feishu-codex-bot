import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import {
  buildFeishuMessagePayload,
  extractTextMessage,
  isUrlVerification,
  verifyFeishuToken
} from "../src/feishu.mjs";
import { processFeishuTextEvent } from "../src/bridge.mjs";
import { runCodex } from "../src/codex-adapter.mjs";
import { generateImage } from "../src/image-adapter.mjs";

test("loadConfig parses lists and booleans", () => {
  const config = loadConfig({
    FEISHU_ALLOWED_CHAT_IDS: "oc_1, oc_2",
    FEISHU_DELIVERY_MODE: "long_connection",
    FEISHU_ENCRYPT_KEY: "encrypt-key",
    FEISHU_REPLY_FORMAT: "card",
    FEISHU_TRIGGER_MODE: "mention_or_prefix",
    MOCK_FEISHU_SEND: "true",
    OPENAI_COMPAT_PROVIDER: "qhaigc",
    QHAIGC_API_KEY: "qhaigc-test-key",
    XINGWAN_API_KEY: "xingwan-test-key",
    IMAGE_GENERATION_PROVIDER: "xingwan",
    DESKTOP_CODEX_ACCESS: "write",
    CODEX_EXEC_WORKDIR: "/tmp/project",
    CODEX_CLI_ARGS: "--json,--quiet",
    CODEX_EXEC_ARGS: "exec,--skip-git-repo-check,--dangerously-bypass-approvals-and-sandbox"
  });

  assert.deepEqual(config.feishuAllowedChatIds, ["oc_1", "oc_2"]);
  assert.equal(config.feishuDeliveryMode, "long_connection");
  assert.equal(config.feishuEncryptKey, "encrypt-key");
  assert.equal(config.feishuReplyFormat, "card");
  assert.equal(config.feishuTriggerMode, "mention_or_prefix");
  assert.equal(config.mockFeishuSend, true);
  assert.equal(config.openaiCompatProvider, "qhaigc");
  assert.equal(config.openaiCompatApiKey, "qhaigc-test-key");
  assert.equal(config.openaiCompatApiKeyEnvName, "QHAIGC_API_KEY");
  assert.equal(config.openaiCompatBaseUrl, "https://api.qhaigc.net/v1");
  assert.equal(config.openaiCompatModel, "deepseek-chat");
  assert.equal(config.imageGenerationProvider, "xingwan");
  assert.equal(config.imageGenerationApiKey, "xingwan-test-key");
  assert.equal(config.imageGenerationApiKeyEnvName, "XINGWAN_API_KEY");
  assert.equal(config.imageGenerationBaseUrl, "https://xingwan.store/v1");
  assert.equal(config.imageGenerationModel, "gpt-image-2");
  assert.deepEqual(config.codexCliArgs, ["--json", "--quiet"]);
  assert.deepEqual(config.codexExecArgs, [
    "exec",
    "--skip-git-repo-check"
  ]);
  assert.equal(config.codexExecWorkdir, "/tmp/project");
  assert.equal(config.desktopCodexAccess, "write");
});

test("isUrlVerification detects challenge payload", () => {
  assert.equal(isUrlVerification({ type: "url_verification", challenge: "abc" }), true);
  assert.equal(isUrlVerification({ type: "event_callback" }), false);
});

test("verifyFeishuToken accepts matching token", () => {
  assert.equal(verifyFeishuToken({ token: "expected" }, "expected"), true);
  assert.equal(verifyFeishuToken({ header: { token: "expected" } }, "expected"), true);
  assert.equal(verifyFeishuToken({ token: "wrong" }, "expected"), false);
});

test("extractTextMessage parses text events", () => {
  const message = extractTextMessage({
    header: {
      event_id: "evt_1",
      event_type: "im.message.receive_v1"
    },
    event: {
      message: {
        message_id: "om_x",
        chat_id: "oc_x",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "/codex hello" })
      }
    }
  });

  assert.deepEqual(message, {
    chatId: "oc_x",
    messageId: "om_x",
    chatType: "p2p",
    text: "/codex hello",
    eventId: "evt_1",
    eventType: "im.message.receive_v1",
    token: "",
    mentions: [],
    senderOpenId: ""
  });
});

test("extractTextMessage parses long connection events", () => {
  const message = extractTextMessage({
    event_id: "evt_ws",
    event_type: "im.message.receive_v1",
    token: "token_1",
    message: {
      message_id: "om_ws",
      chat_id: "oc_ws",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "/codex ws hello" })
    }
  });

  assert.deepEqual(message, {
    chatId: "oc_ws",
    messageId: "om_ws",
    chatType: "group",
    text: "/codex ws hello",
    eventId: "evt_ws",
    eventType: "im.message.receive_v1",
    token: "token_1",
    mentions: [],
    senderOpenId: ""
  });
});

test("desktop write Codex requests require local approval", async () => {
  const approvals = [];
  const result = await processFeishuTextEvent(
    loadConfig({
      COMMAND_PREFIX: "/codex",
      CODEX_MODE: "mock",
      CODEX_EXEC_WORKDIR: "/tmp/project",
      DESKTOP_CODEX_ACCESS: "write",
      MOCK_FEISHU_SEND: "true",
      FEISHU_DELIVERY_MODE: "long_connection"
    }),
    {
      event_id: "evt_write_approval",
      event_type: "im.message.receive_v1",
      sender: { sender_id: { open_id: "ou_owner" } },
      message: {
        message_id: "om_write_approval",
        chat_id: "oc_owner",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "/codex 更新 README" })
      }
    },
    {
      requestCodexApproval: async (approval) => {
        approvals.push(approval);
        return false;
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, "codex write rejected");
  assert.deepEqual(approvals, [{
    requester: "ou_owner",
    prompt: "更新 README",
    rootPath: "/tmp/project"
  }]);
});

test("processFeishuTextEvent accepts command after bot mention", async () => {
  const result = await processFeishuTextEvent(
    loadConfig({
      COMMAND_PREFIX: "/codex",
      CODEX_MODE: "mock",
      MOCK_FEISHU_SEND: "true",
      FEISHU_DELIVERY_MODE: "long_connection"
    }),
    {
      event_id: "evt_mention",
      event_type: "im.message.receive_v1",
      message: {
        message_id: "om_mention",
        chat_id: "oc_mention",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 /codex hello from group" })
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
});

test("processFeishuTextEvent accepts direct private chat without prefix", async () => {
  const result = await processFeishuTextEvent(
    loadConfig({
      COMMAND_PREFIX: "/codex",
      CODEX_MODE: "mock",
      MOCK_FEISHU_SEND: "true",
      FEISHU_DELIVERY_MODE: "long_connection",
      FEISHU_TRIGGER_MODE: "mention_or_prefix"
    }),
    {
      event_id: "evt_p2p_no_prefix",
      event_type: "im.message.receive_v1",
      message: {
        message_id: "om_p2p_no_prefix",
        chat_id: "oc_p2p_no_prefix",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "Summarize recent commits" })
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
});

test("processFeishuTextEvent accepts group mention without prefix", async () => {
  const result = await processFeishuTextEvent(
    loadConfig({
      COMMAND_PREFIX: "/codex",
      CODEX_MODE: "mock",
      MOCK_FEISHU_SEND: "true",
      FEISHU_DELIVERY_MODE: "long_connection",
      FEISHU_TRIGGER_MODE: "mention_or_prefix"
    }),
    {
      event_id: "evt_group_mention_no_prefix",
      event_type: "im.message.receive_v1",
      message: {
        message_id: "om_group_mention_no_prefix",
        chat_id: "oc_group_mention_no_prefix",
        chat_type: "group",
        message_type: "text",
        mentions: [{ key: "@_user_1", name: "Codex Bot" }],
        content: JSON.stringify({ text: "@_user_1 Summarize recent commits" })
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
});

test("buildFeishuMessagePayload sends card replies by default", () => {
  const payload = buildFeishuMessagePayload(
    loadConfig({
      FEISHU_REPLY_FORMAT: "card"
    }),
    "oc_card",
    "**Summary**\n- one"
  );
  const card = JSON.parse(payload.content);

  assert.equal(payload.receive_id, "oc_card");
  assert.equal(payload.msg_type, "interactive");
  assert.equal(card.header.title.content, "Codex");
  assert.equal(card.elements[0].tag, "markdown");
  assert.equal(card.elements[0].content, "**Summary**\n- one");
});

test("runCodex supports OpenAI-compatible chat completions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "provider reply"
          }
        }
      ]
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  };

  try {
    const result = await runCodex(
      loadConfig({
        CODEX_MODE: "openai_compatible",
        OPENAI_COMPAT_PROVIDER: "xingwan",
        XINGWAN_API_KEY: "test-key",
        OPENAI_COMPAT_SYSTEM_PROMPT: "system prompt"
      }),
      "hello provider",
      {
        chatId: "oc_test",
        messageId: "om_test"
      }
    );

    const request = calls[0];
    const body = JSON.parse(request.options.body);

    assert.equal(result, "provider reply");
    assert.equal(request.url, "https://xingwan.store/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.equal(body.model, "gpt-5.4-mini");
    assert.deepEqual(body.messages, [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello provider" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI-compatible explicit config overrides provider preset", () => {
  const config = loadConfig({
    OPENAI_COMPAT_PROVIDER: "qhaigc",
    QHAIGC_API_KEY: "qhaigc-test-key",
    OPENAI_COMPAT_BASE_URL: "https://override.example/v1",
    OPENAI_COMPAT_MODEL: "override-model",
    OPENAI_COMPAT_API_KEY: "override-key"
  });

  assert.equal(config.openaiCompatProvider, "qhaigc");
  assert.equal(config.openaiCompatBaseUrl, "https://override.example/v1");
  assert.equal(config.openaiCompatModel, "override-model");
  assert.equal(config.openaiCompatApiKey, "override-key");
});

test("generateImage supports Xingwan b64 image responses", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const imageBytes = Buffer.from("fake-image");

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return new Response(JSON.stringify({
      output_format: "png",
      data: [
        {
          b64_json: imageBytes.toString("base64"),
          revised_prompt: "revised prompt"
        }
      ]
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  };

  try {
    const image = await generateImage(
      loadConfig({
        IMAGE_GENERATION_PROVIDER: "xingwan",
        XINGWAN_API_KEY: "test-key"
      }),
      "画一张风景照"
    );
    const request = calls[0];
    const body = JSON.parse(request.options.body);

    assert.equal(request.url, "https://xingwan.store/v1/images/generations");
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.equal(body.model, "gpt-image-2");
    assert.equal(body.prompt, "画一张风景照");
    assert.equal(body.size, "1024x1024");
    assert.deepEqual(image.bytes, imageBytes);
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.revisedPrompt, "revised prompt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("processFeishuTextEvent routes image requests to image generation", async () => {
  const originalFetch = globalThis.fetch;
  const imageBytes = Buffer.from("fake-image");

  globalThis.fetch = async () => new Response(JSON.stringify({
    output_format: "png",
    data: [
      {
        b64_json: imageBytes.toString("base64")
      }
    ]
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });

  try {
    const result = await processFeishuTextEvent(
      loadConfig({
        MOCK_FEISHU_SEND: "true",
        FEISHU_DELIVERY_MODE: "long_connection",
        IMAGE_GENERATION_PROVIDER: "xingwan",
        XINGWAN_API_KEY: "test-key"
      }),
      {
        event_id: "evt_image_request",
        event_type: "im.message.receive_v1",
        message: {
          message_id: "om_image_request",
          chat_id: "oc_image_request",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "画一张清晨山湖风景照" })
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
