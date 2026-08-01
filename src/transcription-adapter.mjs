import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const MAX_COMMAND_OUTPUT_CHARS = 20_000;

function appendBounded(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length > MAX_COMMAND_OUTPUT_CHARS
    ? combined.slice(-MAX_COMMAND_OUTPUT_CHARS)
    : combined;
}

export function runCommand(command, args, { timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code}: ${stderr || stdout}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function transcribeAudio(config, audioBytes, {
  runCommand: commandRunner = runCommand
} = {}) {
  if (!Buffer.isBuffer(audioBytes) || audioBytes.length === 0) {
    throw new Error("Audio input is empty");
  }

  if (!config.whisperModelPath) {
    throw new Error("WHISPER_MODEL_PATH is required for voice notes");
  }

  await access(config.whisperModelPath);

  const workingDir = await mkdtemp(join(tmpdir(), "feishu-voice-note-"));
  const inputPath = join(workingDir, "input.audio");
  const wavPath = join(workingDir, "input.wav");
  const outputBase = join(workingDir, "transcript");

  try {
    await writeFile(inputPath, audioBytes, { mode: 0o600 });

    // whisper.cpp documents 16 kHz mono PCM WAV as its portable CLI input.
    // Source: https://github.com/ggml-org/whisper.cpp/blob/master/README.md#quick-start
    await commandRunner(config.ffmpegCommand, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath
    ], {
      timeoutMs: config.voiceNoteTranscribeTimeoutMs,
      label: "ffmpeg audio conversion"
    });

    // CLI flags follow the official whisper.cpp example reference.
    // Source: https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md
    await commandRunner(config.whisperCommand, [
      "-m",
      config.whisperModelPath,
      "-f",
      wavPath,
      "-l",
      config.voiceNoteLanguage || "zh",
      "-otxt",
      "-of",
      outputBase,
      "-np",
      "-nt"
    ], {
      timeoutMs: config.voiceNoteTranscribeTimeoutMs,
      label: "whisper.cpp transcription"
    });

    const transcript = (await readFile(`${outputBase}.txt`, "utf8")).trim();
    if (!transcript) {
      throw new Error("whisper.cpp returned an empty transcript");
    }

    return transcript;
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}
