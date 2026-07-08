function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function getImagesGenerationUrl(config) {
  if (config.imageGenerationUrl) {
    return config.imageGenerationUrl;
  }

  return new URL("images/generations", normalizeBaseUrl(config.imageGenerationBaseUrl)).toString();
}

function truncateBody(body) {
  const text = String(body || "");
  return text.length > 1500 ? `${text.slice(0, 1500)}...` : text;
}

function inferMimeTypeFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();

  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

async function downloadImage(url) {
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to download generated image ${response.status}: ${truncateBody(text)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || inferMimeTypeFromUrl(url);

  return {
    bytes: Buffer.from(arrayBuffer),
    mimeType
  };
}

function buildImageGenerationRequest(config, prompt) {
  const body = {
    model: config.imageGenerationModel,
    prompt,
    size: config.imageGenerationSize,
    n: 1
  };

  if (config.imageGenerationQuality) {
    body.quality = config.imageGenerationQuality;
  }

  return body;
}

export async function generateImage(config, prompt) {
  if (!config.imageGenerationApiKey) {
    throw new Error(`Missing ${config.imageGenerationApiKeyEnvName} for image generation`);
  }

  if (!config.imageGenerationModel) {
    throw new Error("Missing IMAGE_GENERATION_MODEL for image generation");
  }

  const response = await fetch(getImagesGenerationUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.imageGenerationApiKey}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(buildImageGenerationRequest(config, prompt))
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Image generation API error ${response.status}: ${truncateBody(text)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Image generation API returned non-JSON response: ${truncateBody(text)}`);
  }

  const firstImage = data?.data?.[0];

  if (!firstImage) {
    throw new Error(`Image generation API returned no images: ${truncateBody(text)}`);
  }

  let image;
  if (firstImage.b64_json) {
    image = {
      bytes: Buffer.from(firstImage.b64_json, "base64"),
      mimeType: `image/${data.output_format || "png"}`
    };
  } else if (firstImage.url) {
    image = await downloadImage(firstImage.url);
  } else {
    throw new Error(`Image generation API returned unsupported image payload: ${truncateBody(text)}`);
  }

  return {
    ...image,
    revisedPrompt: firstImage.revised_prompt || "",
    provider: config.imageGenerationProvider,
    model: config.imageGenerationModel
  };
}
