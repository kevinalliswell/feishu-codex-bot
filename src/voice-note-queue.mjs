import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,240}$/;

function validateJob(job) {
  for (const [field, value] of [
    ["messageId", job?.messageId],
    ["chatId", job?.chatId],
    ["fileKey", job?.fileKey]
  ]) {
    if (!IDENTIFIER_PATTERN.test(String(value || ""))) {
      throw new Error(`Invalid voice-note job ${field}`);
    }
  }

  if (job.chatType !== "p2p") {
    throw new Error("Voice notes are only accepted from private chats");
  }

  if (!Number.isFinite(job.durationMs) || job.durationMs < 0) {
    throw new Error("Invalid voice-note duration");
  }

  if (!Number.isFinite(job.createdAtMs) || job.createdAtMs <= 0) {
    throw new Error("Invalid voice-note creation time");
  }
}

function pendingRecord(job) {
  return {
    status: "pending",
    attempts: 0,
    messageId: job.messageId,
    chatId: job.chatId,
    chatType: job.chatType,
    fileKey: job.fileKey,
    durationMs: job.durationMs,
    createdAtMs: job.createdAtMs
  };
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(tempPath, filePath);
}

function safeErrorMessage(error) {
  return String(error?.message || error).replaceAll("\n", " ").slice(0, 500);
}

export function createVoiceNoteQueue({
  queueDir,
  processJob,
  onJobError = () => {},
  onDrainError = (error) => console.error("[voice-note-queue-error]", error)
}) {
  if (typeof processJob !== "function") {
    throw new Error("Voice-note queue requires a processJob function");
  }

  const resolvedQueueDir = resolve(queueDir);
  let drainingPromise = null;

  async function ensureQueueDir() {
    await mkdir(resolvedQueueDir, { recursive: true, mode: 0o700 });
  }

  function jobPath(messageId) {
    return join(resolvedQueueDir, `${messageId}.json`);
  }

  function scheduleDrain() {
    queueMicrotask(() => {
      drain().catch(onDrainError);
    });
  }

  async function enqueue(job) {
    validateJob(job);
    await ensureQueueDir();

    try {
      await writeFile(jobPath(job.messageId), `${JSON.stringify(pendingRecord(job))}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      scheduleDrain();
      return { queued: true };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      scheduleDrain();
      return { queued: false };
    }
  }

  async function processFile(fileName) {
    if (!/^om_[A-Za-z0-9_-]{1,160}\.json$/.test(fileName)) {
      return;
    }

    const filePath = join(resolvedQueueDir, fileName);
    const job = JSON.parse(await readFile(filePath, "utf8"));
    if (job.status === "done") {
      return;
    }

    validateJob(job);

    try {
      await processJob(job);
      await writeJsonAtomic(filePath, {
        status: "done",
        messageId: job.messageId,
        completedAtMs: Date.now()
      });
    } catch (error) {
      await writeJsonAtomic(filePath, {
        ...job,
        status: "pending",
        attempts: Number(job.attempts || 0) + 1,
        lastError: safeErrorMessage(error)
      });
      await onJobError(error, job);
    }
  }

  async function runDrain() {
    await ensureQueueDir();
    const fileNames = (await readdir(resolvedQueueDir)).sort();

    for (const fileName of fileNames) {
      await processFile(fileName);
    }
  }

  async function drain() {
    if (drainingPromise) {
      return drainingPromise;
    }

    drainingPromise = runDrain();
    try {
      return await drainingPromise;
    } finally {
      drainingPromise = null;
    }
  }

  return {
    enqueue,
    drain,
    start: drain
  };
}
