import {
  extractAudioMessage,
  extractTextMessage,
  sendFeishuImageMessage,
  sendFeishuTextMessage,
  uploadFeishuImage,
  verifyFeishuToken
} from "./feishu.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { generateImage } from "./image-adapter.mjs";

const seenEventIds = new Map();

function pruneSeenEvents(now) {
  for (const [eventId, expiresAt] of seenEventIds.entries()) {
    if (expiresAt <= now) {
      seenEventIds.delete(eventId);
    }
  }
}

function rememberEvent(eventId) {
  if (!eventId) {
    return false;
  }

  pruneSeenEvents(Date.now());

  if (seenEventIds.has(eventId)) {
    return true;
  }

  seenEventIds.set(eventId, Date.now() + 10 * 60 * 1000);
  return false;
}

function stripLeadingMentions(text, mentions = []) {
  if (!text) {
    return "";
  }

  let remainingText = text.trim();
  const mentionTokens = mentions
    .flatMap((mention) => [
      mention.key,
      mention.key && !mention.key.startsWith("@") ? `@${mention.key}` : "",
      mention.name,
      mention.name ? `@${mention.name}` : ""
    ])
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  let removedMention = false;

  for (const token of mentionTokens) {
    if (remainingText.startsWith(token)) {
      remainingText = remainingText.slice(token.length).trim();
      removedMention = true;
      break;
    }
  }

  if (!removedMention && /^@\S+/.test(remainingText)) {
    remainingText = remainingText.replace(/^@\S+\s*/, "").trim();
    removedMention = true;
  }

  return {
    promptText: remainingText,
    hadLeadingMention: removedMention
  };
}

function extractPrompt(textMessage, config) {
  const { promptText, hadLeadingMention } = stripLeadingMentions(textMessage.text, textMessage.mentions);
  const commandPrefix = config.commandPrefix;
  const triggerMode = config.feishuTriggerMode || "mention_or_prefix";

  if (!commandPrefix) {
    return promptText;
  }

  const prefixIndex = promptText.indexOf(commandPrefix);

  if (prefixIndex !== -1) {
    const textBeforePrefix = promptText.slice(0, prefixIndex).trim();

    if (!textBeforePrefix) {
      return promptText.slice(prefixIndex + commandPrefix.length).trim();
    }
  }

  if (triggerMode === "all") {
    return promptText;
  }

  if (triggerMode === "mention_or_prefix") {
    if (textMessage.chatType === "p2p" || hadLeadingMention || textMessage.mentions?.length) {
      return promptText;
    }
  }

  return "";
}

function isChatAllowed(chatId, allowedChatIds) {
  if (!allowedChatIds.length) {
    return true;
  }

  return allowedChatIds.includes(chatId);
}

function formatErrorMessage(error) {
  return [
    "Codex bridge failed.",
    "",
    String(error?.message || error)
  ].join("\n");
}

function extractImagePrompt(prompt) {
  const trimmedPrompt = String(prompt || "").trim();

  if (!trimmedPrompt) {
    return { isImageRequest: false, prompt: "" };
  }

  const commandMatch = trimmedPrompt.match(/^\/(?:image|img|draw|画图|生图)\s+(.+)/i);
  if (commandMatch) {
    return { isImageRequest: true, prompt: commandMatch[1].trim() };
  }

  const imageIntentPattern = /(画|绘制|生成|做|设计).{0,12}(图|图片|照片|风景照|海报|插画|头像|壁纸|封面|图标|logo)/i;

  if (imageIntentPattern.test(trimmedPrompt)) {
    return { isImageRequest: true, prompt: trimmedPrompt };
  }

  return { isImageRequest: false, prompt: trimmedPrompt };
}

function summarizeText(text, maxLength = 160) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function logMessage(stage, details) {
  console.log(`[bridge-${stage}] ${JSON.stringify(details)}`);
}

function buildMessageLogContext(textMessage) {
  return {
    eventId: textMessage.eventId,
    messageId: textMessage.messageId,
    chatId: textMessage.chatId,
    chatType: textMessage.chatType
  };
}

function logSkip(reason, textMessage, extra = {}) {
  if (!textMessage) {
    logMessage("skip", { reason, ...extra });
    return;
  }

  logMessage("skip", {
    ...buildMessageLogContext(textMessage),
    reason,
    textChars: String(textMessage.text || "").length,
    ...extra
  });
}

function logError(stage, error, textMessage) {
  const details = {
    stage,
    error: String(error?.message || error)
  };

  if (textMessage) {
    Object.assign(details, buildMessageLogContext(textMessage));
  }

  console.error(`[bridge-error] ${JSON.stringify(details)}`);
}

function buildResult(ok, statusCode, details = {}) {
  return {
    ok,
    statusCode,
    ...details
  };
}

function skip(reason, statusCode = 200, details = {}) {
  return buildResult(true, statusCode, {
    skipped: reason,
    ...details
  });
}

function failure(error, statusCode = 500, details = {}) {
  return buildResult(false, statusCode, {
    error: String(error?.message || error),
    ...details
  });
}

function shouldVerifyToken(config) {
  return config.feishuDeliveryMode === "webhook";
}

function verifyWebhookToken(config, payload) {
  if (!shouldVerifyToken(config)) {
    return true;
  }

  return verifyFeishuToken(payload, config.feishuVerificationToken);
}

function isVoiceNoteChatAllowed(config, audioMessage) {
  return audioMessage.chatType === "p2p"
    && config.voiceNoteAllowedChatIds.length > 0
    && config.voiceNoteAllowedChatIds.includes(audioMessage.chatId);
}

function extractTextNote(text) {
  const match = String(text || "").trim().match(/^\/(?:note|n)(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return String(match[1] || "").trim();
}

function extractMessageCreatedAtMs(payload) {
  const event = payload?.event || payload;
  const createdAtMs = Number(event?.message?.create_time || payload?.header?.create_time || 0);

  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now();
}

export async function processFeishuEvent(config, payload, { voiceNoteQueue, requestCodexApproval } = {}) {
  if (!verifyWebhookToken(config, payload)) {
    logSkip("invalid verification token", null, { deliveryMode: config.feishuDeliveryMode });
    return failure("invalid verification token", 403, { skipped: "invalid verification token" });
  }

  const audioMessage = extractAudioMessage(payload);
  if (!audioMessage) {
    const textMessage = extractTextMessage(payload);
    const textNote = textMessage ? extractTextNote(textMessage.text) : null;

    if (textNote === null) {
      return processFeishuTextEvent(config, payload, { requestCodexApproval });
    }

    if (!config.voiceNotesEnabled) {
      return skip("voice notes disabled");
    }

    if (!isVoiceNoteChatAllowed(config, textMessage)) {
      logMessage("text-note-skip", {
        ...buildMessageLogContext(textMessage),
        reason: "voice-note chat not allowed"
      });
      return skip("voice-note chat not allowed");
    }

    if (!textNote) {
      return skip("text note is empty");
    }

    if (!voiceNoteQueue) {
      return failure("voice-note queue unavailable");
    }

    const queueResult = await voiceNoteQueue.enqueue({
      kind: "text",
      messageId: textMessage.messageId,
      chatId: textMessage.chatId,
      chatType: textMessage.chatType,
      text: textNote,
      createdAtMs: extractMessageCreatedAtMs(payload)
    });
    logMessage("text-note-queued", {
      ...buildMessageLogContext(textMessage),
      queued: queueResult.queued
    });

    return buildResult(true, 200, {
      queued: queueResult.queued,
      chatId: textMessage.chatId,
      messageId: textMessage.messageId
    });
  }

  if (!config.voiceNotesEnabled) {
    return skip("voice notes disabled");
  }

  if (!isVoiceNoteChatAllowed(config, audioMessage)) {
    logMessage("voice-skip", {
      ...buildMessageLogContext(audioMessage),
      reason: "voice-note chat not allowed"
    });
    return skip("voice-note chat not allowed");
  }

  if (audioMessage.durationMs > config.voiceNoteMaxDurationMs) {
    logMessage("voice-skip", {
      ...buildMessageLogContext(audioMessage),
      durationMs: audioMessage.durationMs,
      reason: "voice note too long"
    });
    return skip("voice note too long");
  }

  if (!voiceNoteQueue) {
    return failure("voice-note queue unavailable");
  }

  const queueResult = await voiceNoteQueue.enqueue(audioMessage);
  logMessage("voice-queued", {
    ...buildMessageLogContext(audioMessage),
    durationMs: audioMessage.durationMs,
    queued: queueResult.queued
  });

  return buildResult(true, 200, {
    queued: queueResult.queued,
    chatId: audioMessage.chatId,
    messageId: audioMessage.messageId
  });
}

export async function processFeishuTextEvent(config, payload, { requestCodexApproval } = {}) {
  if (!verifyWebhookToken(config, payload)) {
    logSkip("invalid verification token", null, { deliveryMode: config.feishuDeliveryMode });
    return failure("invalid verification token", 403, { skipped: "invalid verification token" });
  }

  const textMessage = extractTextMessage(payload);

  if (!textMessage) {
    logSkip("non-text or unsupported event", null);
    return skip("non-text or unsupported event");
  }

  logMessage("receive", {
    ...buildMessageLogContext(textMessage),
    textChars: textMessage.text.length
  });

  if (rememberEvent(textMessage.eventId)) {
    logSkip("duplicate event", textMessage);
    return skip("duplicate event");
  }

  if (!isChatAllowed(textMessage.chatId, config.feishuAllowedChatIds)) {
    logSkip("chat not allowed", textMessage);
    return skip("chat not allowed");
  }

  const prompt = extractPrompt(textMessage, config);

  if (!prompt) {
    logSkip("trigger mismatch or empty prompt", textMessage, {
      commandPrefix: config.commandPrefix,
      triggerMode: config.feishuTriggerMode
    });
    return skip("prefix mismatch or empty prompt");
  }

  try {
    const imageRequest = extractImagePrompt(prompt);

    if (imageRequest.isImageRequest) {
      logMessage("image-start", {
        ...buildMessageLogContext(textMessage),
        provider: config.imageGenerationProvider,
        model: config.imageGenerationModel
      });

      const image = await generateImage(config, imageRequest.prompt);

      logMessage("image-done", {
        ...buildMessageLogContext(textMessage),
        bytes: image.bytes.length,
        mimeType: image.mimeType
      });

      const imageKey = await uploadFeishuImage(config, image);
      const sendResult = await sendFeishuImageMessage(config, textMessage.chatId, imageKey);

      logMessage("send-image-ok", {
        ...buildMessageLogContext(textMessage),
        feishuMessageId: sendResult?.message_id || sendResult?.data?.message_id || ""
      });

      return buildResult(true, 200, {
        chatId: textMessage.chatId,
        messageId: textMessage.messageId
      });
    }

    logMessage("codex-start", {
      ...buildMessageLogContext(textMessage),
      codexMode: config.codexMode
    });

    if (config.desktopCodexAccess === "write" && requestCodexApproval) {
      await sendFeishuTextMessage(config, textMessage.chatId, "这项任务需要写入本机目录，已发送到 Mac 等待确认。");
      const approved = await requestCodexApproval({
        requester: textMessage.senderOpenId || textMessage.chatId,
        prompt,
        rootPath: config.codexExecWorkdir
      });
      if (!approved) {
        await sendFeishuTextMessage(config, textMessage.chatId, "本机写入授权已拒绝或超时，任务没有执行。");
        return skip("codex write rejected");
      }
    }

    const output = await runCodex(config, prompt, textMessage);
    const replyText = String(output).trim() || "Codex returned empty output.";

    logMessage("codex-done", {
      ...buildMessageLogContext(textMessage),
      outputChars: replyText.length
    });

    const sendResult = await sendFeishuTextMessage(config, textMessage.chatId, replyText);

    logMessage("send-ok", {
      ...buildMessageLogContext(textMessage),
      feishuMessageId: sendResult?.message_id || sendResult?.data?.message_id || ""
    });

    return buildResult(true, 200, {
      chatId: textMessage.chatId,
      messageId: textMessage.messageId
    });
  } catch (error) {
    logError("process", error, textMessage);

    try {
      await sendFeishuTextMessage(config, textMessage.chatId, formatErrorMessage(error));
    } catch (replyError) {
      logError("reply-error", replyError, textMessage);
    }

    return failure(error, 500, {
      chatId: textMessage.chatId,
      messageId: textMessage.messageId
    });
  }
}
