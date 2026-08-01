const FEISHU_BASE_URL = "https://open.feishu.cn";

let tokenCache = {
  value: "",
  expiresAt: 0
};

export function extractTextMessage(eventBody) {
  const event = eventBody?.event || eventBody;
  const message = event?.message;

  if (!message || message.message_type !== "text") {
    return null;
  }

  try {
    const content = JSON.parse(message.content);
    return {
      chatId: message.chat_id,
      messageId: message.message_id,
      chatType: message.chat_type,
      text: String(content.text || "").trim(),
      eventId: eventBody?.header?.event_id || event?.event_id || "",
      eventType: eventBody?.header?.event_type || event?.event_type || "",
      token: eventBody?.token || event?.token || "",
      mentions: message.mentions || []
    };
  } catch {
    return null;
  }
}

export function extractAudioMessage(eventBody) {
  const event = eventBody?.event || eventBody;
  const message = event?.message;

  if (!message || message.message_type !== "audio") {
    return null;
  }

  try {
    const content = JSON.parse(message.content);
    const createdAtMs = Number(message.create_time || eventBody?.header?.create_time || 0);

    if (!message.message_id || !message.chat_id || !content.file_key) {
      return null;
    }

    return {
      chatId: message.chat_id,
      messageId: message.message_id,
      chatType: message.chat_type,
      fileKey: content.file_key,
      durationMs: Number(content.duration || 0),
      createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : Date.now(),
      senderOpenId: event?.sender?.sender_id?.open_id || "",
      eventId: eventBody?.header?.event_id || event?.event_id || "",
      eventType: eventBody?.header?.event_type || event?.event_type || ""
    };
  } catch {
    return null;
  }
}

export function isUrlVerification(payload) {
  return payload?.type === "url_verification" && typeof payload?.challenge === "string";
}

export function verifyFeishuToken(payload, expectedToken) {
  if (!expectedToken) {
    return true;
  }

  const providedToken = payload?.token || payload?.header?.token || "";
  return providedToken === expectedToken;
}

async function fetchTenantAccessToken(config) {
  const now = Date.now();

  if (tokenCache.value && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.value;
  }

  const response = await fetch(`${FEISHU_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      app_id: config.feishuAppId,
      app_secret: config.feishuAppSecret
    })
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: ${JSON.stringify(data)}`);
  }

  tokenCache = {
    value: data.tenant_access_token,
    expiresAt: now + ((data.expire || 7200) * 1000)
  };

  return tokenCache.value;
}

function chunkText(text, chunkSize = 3500, maxChunks = 8) {
  const chunks = [];
  const normalizedText = String(text || "");

  for (let index = 0; index < normalizedText.length && chunks.length < maxChunks; index += chunkSize) {
    chunks.push(normalizedText.slice(index, index + chunkSize));
  }

  if (normalizedText.length > chunkSize * maxChunks) {
    chunks.push(`\n\n_内容过长，已截断。完整输出长度：${normalizedText.length} 字符。_`);
  }

  return chunks.length ? chunks : [""];
}

function buildCodexCard(text, options = {}) {
  return {
    config: {
      wide_screen_mode: true
    },
    elements: chunkText(text).map((chunk) => ({
      tag: "markdown",
      content: chunk
    })),
    header: {
      template: options.template || "blue",
      title: {
        content: options.title || "Codex",
        tag: "plain_text"
      }
    }
  };
}

export function buildFeishuMessagePayload(config, chatId, text, options = {}) {
  if (config.feishuReplyFormat === "text") {
    return {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text })
    };
  }

  return {
    receive_id: chatId,
    msg_type: "interactive",
    content: JSON.stringify(buildCodexCard(text, options))
  };
}

export async function sendFeishuTextMessage(config, chatId, text) {
  if (config.mockFeishuSend) {
    console.log(`[mock-feishu-send:${config.feishuReplyFormat}] chat_id=${chatId}\n${text}`);
    return;
  }

  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const token = await fetchTenantAccessToken(config);
  const response = await fetch(`${FEISHU_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(buildFeishuMessagePayload(config, chatId, text))
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new Error(`Failed to send Feishu message: ${JSON.stringify(data)}`);
  }

  return data.data || data;
}

export async function uploadFeishuImage(config, image) {
  if (config.mockFeishuSend) {
    console.log(`[mock-feishu-upload-image] bytes=${image.bytes.length} mime=${image.mimeType}`);
    return "mock_image_key";
  }

  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const token = await fetchTenantAccessToken(config);
  const formData = new FormData();
  const blob = new Blob([image.bytes], {
    type: image.mimeType || "image/png"
  });

  formData.append("image_type", "message");
  formData.append("image", blob, "codex-generated-image.png");

  const response = await fetch(`${FEISHU_BASE_URL}/open-apis/im/v1/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });
  const data = await response.json();

  if (!response.ok || data.code !== 0 || !data.data?.image_key) {
    throw new Error(`Failed to upload Feishu image: ${JSON.stringify(data)}`);
  }

  return data.data.image_key;
}

export async function sendFeishuImageMessage(config, chatId, imageKey) {
  if (config.mockFeishuSend) {
    console.log(`[mock-feishu-send:image] chat_id=${chatId} image_key=${imageKey}`);
    return;
  }

  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const token = await fetchTenantAccessToken(config);
  const response = await fetch(`${FEISHU_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey })
    })
  });
  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new Error(`Failed to send Feishu image message: ${JSON.stringify(data)}`);
  }

  return data.data || data;
}
