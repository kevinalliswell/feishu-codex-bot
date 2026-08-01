import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { extractAudioMessage } from "../src/feishu.mjs";
import { appendVoiceNote } from "../src/obsidian-writer.mjs";

test("loadConfig parses voice-note settings", () => {
  const config = loadConfig({
    VOICE_NOTES_ENABLED: "true",
    OBSIDIAN_VAULT_PATH: "/tmp/My Vault",
    VOICE_NOTE_RELATIVE_DIR: "00_Inbox/feishu/每日口述",
    VOICE_NOTE_ALLOWED_CHAT_IDS: "oc_1, oc_2",
    VOICE_NOTE_TIME_ZONE: "Asia/Shanghai",
    VOICE_NOTE_MAX_AUDIO_BYTES: "1048576",
    VOICE_NOTE_MAX_DURATION_MS: "600000",
    VOICE_NOTE_QUEUE_DIR: "/tmp/voice-jobs",
    FFMPEG_COMMAND: "/opt/homebrew/bin/ffmpeg",
    WHISPER_COMMAND: "/opt/homebrew/bin/whisper-cli",
    WHISPER_MODEL_PATH: "/tmp/ggml-small.bin",
    VOICE_NOTE_TRANSCRIBE_TIMEOUT_MS: "90000"
  });

  assert.equal(config.voiceNotesEnabled, true);
  assert.equal(config.obsidianVaultPath, "/tmp/My Vault");
  assert.equal(config.voiceNoteRelativeDir, "00_Inbox/feishu/每日口述");
  assert.deepEqual(config.voiceNoteAllowedChatIds, ["oc_1", "oc_2"]);
  assert.equal(config.voiceNoteTimeZone, "Asia/Shanghai");
  assert.equal(config.voiceNoteMaxAudioBytes, 1048576);
  assert.equal(config.voiceNoteMaxDurationMs, 600000);
  assert.equal(config.voiceNoteQueueDir, "/tmp/voice-jobs");
  assert.equal(config.ffmpegCommand, "/opt/homebrew/bin/ffmpeg");
  assert.equal(config.whisperCommand, "/opt/homebrew/bin/whisper-cli");
  assert.equal(config.whisperModelPath, "/tmp/ggml-small.bin");
  assert.equal(config.voiceNoteTranscribeTimeoutMs, 90000);
});

test("extractAudioMessage parses Feishu long-connection audio events", () => {
  const message = extractAudioMessage({
    event_id: "evt_audio",
    event_type: "im.message.receive_v1",
    sender: {
      sender_id: {
        open_id: "ou_owner"
      }
    },
    message: {
      message_id: "om_audio",
      chat_id: "oc_owner",
      chat_type: "p2p",
      message_type: "audio",
      create_time: "1785591300000",
      content: JSON.stringify({
        file_key: "file_audio",
        duration: 4321
      })
    }
  });

  assert.deepEqual(message, {
    chatId: "oc_owner",
    messageId: "om_audio",
    chatType: "p2p",
    fileKey: "file_audio",
    durationMs: 4321,
    createdAtMs: 1785591300000,
    senderOpenId: "ou_owner",
    eventId: "evt_audio",
    eventType: "im.message.receive_v1"
  });
});

test("extractAudioMessage rejects malformed audio events", () => {
  assert.equal(extractAudioMessage({
    message: {
      message_id: "om_audio",
      chat_id: "oc_owner",
      chat_type: "p2p",
      message_type: "audio",
      content: JSON.stringify({ duration: 1000 })
    }
  }), null);
});

test("appendVoiceNote creates a daily note and deduplicates by message id", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "voice-note-vault-"));

  try {
    const input = {
      vaultPath,
      relativeDir: "00_Inbox/feishu/每日口述",
      transcript: "今天重新梳理了每周复盘的流程。",
      messageId: "om_audio_1",
      createdAtMs: Date.parse("2026-08-01T13:35:00.000Z"),
      timeZone: "Asia/Shanghai"
    };

    const first = await appendVoiceNote(input);
    const firstContents = await readFile(first.filePath, "utf8");
    const second = await appendVoiceNote(input);
    const secondContents = await readFile(second.filePath, "utf8");

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(first.filePath, join(vaultPath, "00_Inbox/feishu/每日口述/2026-08-01.md"));
    assert.match(firstContents, /# 每日口述 2026-08-01/);
    assert.match(firstContents, /## 21:35/);
    assert.match(firstContents, /今天重新梳理了每周复盘的流程。/);
    assert.match(firstContents, /<!-- feishu-message-id: om_audio_1 -->/);
    assert.equal(secondContents, firstContents);
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
});

test("appendVoiceNote rejects paths outside the configured vault", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "voice-note-vault-"));

  try {
    await assert.rejects(() => appendVoiceNote({
      vaultPath,
      relativeDir: "../outside",
      transcript: "不应写入",
      messageId: "om_audio_2",
      createdAtMs: Date.now(),
      timeZone: "Asia/Shanghai"
    }), /inside the Obsidian vault/);
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
});
