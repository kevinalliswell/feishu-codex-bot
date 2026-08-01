import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]{1,160}$/;
const MAX_TRANSCRIPT_CHARS = 200_000;

function dateTimeParts(createdAtMs, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(createdAtMs)).map(({ type, value }) => [type, value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function resolveTargetDir(vaultPath, relativeDir) {
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is required for voice notes");
  }

  if (!relativeDir || isAbsolute(relativeDir)) {
    throw new Error("Voice-note directory must be inside the Obsidian vault");
  }

  const vaultRoot = resolve(vaultPath);
  const targetDir = resolve(vaultRoot, relativeDir);
  const pathFromVault = relative(vaultRoot, targetDir);

  if (pathFromVault === ".." || pathFromVault.startsWith(`..${sep}`) || isAbsolute(pathFromVault)) {
    throw new Error("Voice-note directory must be inside the Obsidian vault");
  }

  return targetDir;
}

function normalizeTranscript(transcript) {
  const normalized = String(transcript || "")
    .replaceAll("\0", "")
    .replaceAll("<!-- feishu-message-id:", "&lt;!-- feishu-message-id:")
    .trim();

  if (!normalized) {
    throw new Error("Voice-note transcript is empty");
  }

  if (normalized.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`Voice-note transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters`);
  }

  return normalized;
}

function initialContents(date) {
  return [
    "---",
    `created: ${date}`,
    `updated: ${date}`,
    "tags:",
    "  - inbox",
    "  - feishu",
    "  - 口述",
    "---",
    "",
    `# 每日口述 ${date}`,
    ""
  ].join("\n");
}

export async function appendVoiceNote({
  vaultPath,
  relativeDir,
  transcript,
  messageId,
  createdAtMs,
  timeZone
}) {
  if (!MESSAGE_ID_PATTERN.test(String(messageId || ""))) {
    throw new Error("Invalid Feishu message id for voice note");
  }

  const normalizedTranscript = normalizeTranscript(transcript);
  const targetDir = resolveTargetDir(vaultPath, relativeDir);
  const { date, time } = dateTimeParts(createdAtMs, timeZone);
  const filePath = join(targetDir, `${date}.md`);
  const marker = `<!-- feishu-message-id: ${messageId} -->`;

  await mkdir(targetDir, { recursive: true });

  try {
    await writeFile(filePath, initialContents(date), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  const existingContents = await readFile(filePath, "utf8");
  if (existingContents.includes(marker)) {
    return { duplicate: true, filePath };
  }

  const entry = [
    `## ${time}`,
    "",
    normalizedTranscript,
    "",
    marker,
    ""
  ].join("\n");

  await appendFile(filePath, `${existingContents.endsWith("\n") ? "" : "\n"}${entry}`, "utf8");
  return { duplicate: false, filePath };
}
