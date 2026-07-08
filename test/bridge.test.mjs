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

test("loadConfig parses lists and booleans", () => {
  const config = loadConfig({
    FEISHU_ALLOWED_CHAT_IDS: "oc_1, oc_2",
    FEISHU_DELIVERY_MODE: "long_connection",
    FEISHU_ENCRYPT_KEY: "encrypt-key",
    FEISHU_REPLY_FORMAT: "card",
    FEISHU_TRIGGER_MODE: "mention_or_prefix",
    MOCK_FEISHU_SEND: "true",
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
  assert.deepEqual(config.codexCliArgs, ["--json", "--quiet"]);
  assert.deepEqual(config.codexExecArgs, [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox"
  ]);
  assert.equal(config.codexExecWorkdir, "/tmp/project");
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
    mentions: []
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
    mentions: []
  });
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
