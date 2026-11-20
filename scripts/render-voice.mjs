// Author: Ariel Anders
// Copyright (c) 2026 Ariel Anders. All rights reserved.
//
// Renders every line in docs/app/voice-lines.js to MP3 with Kokoro-82M
// (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M) via kokoro-js, for
// each voice in VOICES, and writes docs/app/voice/manifest.json mapping text to
// files. Run in CI (.github/workflows/voice-clips.yml): needs kokoro-js,
// ffmpeg, and network access to download the ONNX model (~330 MB fp32).
//
//   npm install --no-save kokoro-js@1 && node scripts/render-voice.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import { ALL_LINES, VOICES } from "../docs/app/voice-lines.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/app/voice");
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

const slug = (text) => {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${words}-${createHash("sha1").update(text).digest("hex").slice(0, 6)}`;
};

const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "cpu" });
const manifest = { model: MODEL, license: "Apache-2.0", voices: {} };
const tmp = path.join(tmpdir(), "pg-voice");
mkdirSync(tmp, { recursive: true });

for (const voice of Object.keys(VOICES)) {
  const dir = path.join(OUT, voice);
  rmSync(dir, { recursive: true, force: true }); // drop clips for removed lines
  mkdirSync(dir, { recursive: true });
  manifest.voices[voice] = {};
  for (const text of ALL_LINES) {
    const name = `${slug(text)}.mp3`;
    const wav = path.join(tmp, `${voice}-${name}.wav`);
    const audio = await tts.generate(text, { voice });
    audio.save(wav);
    // Trim leading/trailing silence, mono 48 kbps MP3 (plays in every browser).
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y", "-i", wav,
      "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse," +
             "silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.05",
      "-ac", "1", "-b:a", "48k", path.join(dir, name),
    ]);
    manifest.voices[voice][text] = `${voice}/${name}`;
    console.log(`${voice}: ${text}`);
  }
  console.log(`${voice}: ${readdirSync(dir).length} clips`);
}
writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
