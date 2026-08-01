import { relative } from "node:path";
import { downloadFeishuMessageResource, sendFeishuTextMessage } from "./feishu.mjs";
import { appendVoiceNote } from "./obsidian-writer.mjs";
import { transcribeAudio } from "./transcription-adapter.mjs";

export function createVoiceNoteProcessor(config, {
  downloadResource = downloadFeishuMessageResource,
  transcribe = transcribeAudio,
  appendNote = appendVoiceNote,
  sendMessage = sendFeishuTextMessage
} = {}) {
  return async function processVoiceNote(job) {
    const isTextNote = job.kind === "text";
    let transcript = job.text;

    if (!isTextNote) {
      if (job.durationMs > config.voiceNoteMaxDurationMs) {
        throw new Error(`Voice note exceeds the configured duration limit of ${config.voiceNoteMaxDurationMs}ms`);
      }

      const resource = await downloadResource(config, {
        messageId: job.messageId,
        fileKey: job.fileKey,
        maxBytes: config.voiceNoteMaxAudioBytes
      });
      transcript = await transcribe(config, resource.bytes);
    }

    const noteResult = await appendNote({
      vaultPath: config.obsidianVaultPath,
      relativeDir: config.voiceNoteRelativeDir,
      transcript,
      messageId: job.messageId,
      createdAtMs: job.createdAtMs,
      timeZone: config.voiceNoteTimeZone
    });
    const relativePath = relative(config.obsidianVaultPath, noteResult.filePath);
    const confirmation = noteResult.duplicate
      ? `这条${isTextNote ? "文字笔记" : "语音"}已经记录过：\n${relativePath}`
      : `已保存到 Obsidian：\n${relativePath}`;

    await sendMessage(config, job.chatId, confirmation);
    return noteResult;
  };
}
