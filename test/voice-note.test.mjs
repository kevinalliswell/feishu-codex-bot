import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { downloadFeishuMessageResource, extractAudioMessage } from "../src/feishu.mjs";
import { appendVoiceNote } from "../src/obsidian-writer.mjs";
import { transcribeAudio } from "../src/transcription-adapter.mjs";
import { createVoiceNoteQueue } from "../src/voice-note-queue.mjs";

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
    VOICE_NOTE_LANGUAGE: "zh",
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
  assert.equal(config.voiceNoteLanguage, "zh");
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

test("downloadFeishuMessageResource downloads the audio resource with a bounded size", async () => {
  const calls = [];
  const bytes = Buffer.from("fake-opus-audio");

  const result = await downloadFeishuMessageResource(
    {
      feishuAppId: "cli_test",
      feishuAppSecret: "secret"
    },
    {
      messageId: "om_audio_3",
      fileKey: "file_audio_3",
      maxBytes: 1024
    },
    {
      accessTokenProvider: async () => "tenant-token",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.length),
            "Content-Type": "audio/ogg"
          }
        });
      }
    }
  );

  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.contentType, "audio/ogg");
  assert.equal(
    calls[0].url,
    "https://open.feishu.cn/open-apis/im/v1/messages/om_audio_3/resources/file_audio_3?type=file"
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer tenant-token");
});

test("downloadFeishuMessageResource rejects resources above the configured limit", async () => {
  await assert.rejects(() => downloadFeishuMessageResource(
    {},
    {
      messageId: "om_audio_4",
      fileKey: "file_audio_4",
      maxBytes: 4
    },
    {
      accessTokenProvider: async () => "tenant-token",
      fetchImpl: async () => new Response(Buffer.from("too large"), {
        status: 200,
        headers: {
          "Content-Length": "9",
          "Content-Type": "audio/ogg"
        }
      })
    }
  ), /exceeds the configured limit/);
});

test("transcribeAudio converts input to WAV and reads whisper.cpp text output", async () => {
  const testDir = await mkdtemp(join(tmpdir(), "voice-note-transcribe-"));
  const modelPath = join(testDir, "ggml-small.bin");
  const commands = [];

  try {
    await writeFile(modelPath, "model-placeholder");

    const transcript = await transcribeAudio(
      {
        ffmpegCommand: "ffmpeg-test",
        whisperCommand: "whisper-test",
        whisperModelPath: modelPath,
        voiceNoteLanguage: "zh",
        voiceNoteTranscribeTimeoutMs: 90_000
      },
      Buffer.from("fake-audio"),
      {
        runCommand: async (command, args) => {
          commands.push({ command, args });

          if (command === "whisper-test") {
            const outputBase = args[args.indexOf("-of") + 1];
            await writeFile(`${outputBase}.txt`, "今天记录了一件重要的事情。\n", "utf8");
          }
        }
      }
    );

    assert.equal(transcript, "今天记录了一件重要的事情。");
    assert.equal(commands[0].command, "ffmpeg-test");
    assert.equal(commands[0].args[commands[0].args.indexOf("-ar") + 1], "16000");
    assert.equal(commands[0].args[commands[0].args.indexOf("-ac") + 1], "1");
    assert.equal(commands[0].args[commands[0].args.indexOf("-c:a") + 1], "pcm_s16le");
    assert.match(commands[0].args.at(-1), /\.wav$/);
    assert.equal(commands[1].command, "whisper-test");
    assert.ok(commands[1].args.includes("-otxt"));
    assert.ok(commands[1].args.includes("-nt"));
    assert.equal(commands[1].args[commands[1].args.indexOf("-l") + 1], "zh");
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});

test("createVoiceNoteQueue persists jobs and processes each message once", async () => {
  const queueDir = await mkdtemp(join(tmpdir(), "voice-note-queue-"));
  const processed = [];
  const job = {
    messageId: "om_audio_5",
    chatId: "oc_owner",
    chatType: "p2p",
    fileKey: "file_audio_5",
    durationMs: 5000,
    createdAtMs: Date.parse("2026-08-01T13:35:00.000Z")
  };

  try {
    const queue = createVoiceNoteQueue({
      queueDir,
      processJob: async (queuedJob) => {
        processed.push(queuedJob.messageId);
      }
    });

    const first = await queue.enqueue(job);
    await queue.drain();
    const second = await queue.enqueue(job);
    await queue.drain();

    const storedJob = JSON.parse(await readFile(join(queueDir, "om_audio_5.json"), "utf8"));
    const restartedQueue = createVoiceNoteQueue({
      queueDir,
      processJob: async (queuedJob) => {
        processed.push(`restarted:${queuedJob.messageId}`);
      }
    });
    await restartedQueue.drain();

    assert.equal(first.queued, true);
    assert.equal(second.queued, false);
    assert.deepEqual(processed, ["om_audio_5"]);
    assert.equal(storedJob.status, "done");
    assert.equal(storedJob.fileKey, undefined);
  } finally {
    await rm(queueDir, { recursive: true, force: true });
  }
});
