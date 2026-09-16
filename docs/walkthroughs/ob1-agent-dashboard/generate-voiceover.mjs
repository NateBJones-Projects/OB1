#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { voiceoverScript } from "./walkthrough-content.mjs";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  throw new Error("ELEVENLABS_API_KEY is required to generate voiceover audio.");
}

const outputDir = path.join(import.meta.dirname, "output/audio");
const audioPath = path.join(outputDir, "voiceover.mp3");
const scriptPath = path.join(outputDir, "voiceover-script.txt");
const metaPath = path.join(outputDir, "voiceover-meta.json");

await mkdir(outputDir, { recursive: true });
await writeFile(scriptPath, voiceoverScript, "utf8");

const voice = await pickVoice();
const response = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: voiceoverScript,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.54,
        similarity_boost: 0.82,
        style: 0.22,
        use_speaker_boost: true,
      },
    }),
  }
);

if (!response.ok) {
  throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
}

const buffer = Buffer.from(await response.arrayBuffer());
await writeFile(audioPath, buffer);
await writeFile(
  metaPath,
  JSON.stringify(
    {
      voice_id: voice.voice_id,
      voice_name: voice.name,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      bytes: buffer.length,
      source: "https://api.elevenlabs.io/v1/text-to-speech/:voice_id",
    },
    null,
    2
  )
);

console.log(JSON.stringify({ ok: true, audio: audioPath, voice: voice.name }, null, 2));

async function pickVoice() {
  if (process.env.ELEVENLABS_VOICE_ID) {
    return { voice_id: process.env.ELEVENLABS_VOICE_ID, name: process.env.ELEVENLABS_VOICE_NAME || "configured voice" };
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`Could not list ElevenLabs voices: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const voices = Array.isArray(data.voices) ? data.voices : [];
  if (voices.length === 0) throw new Error("No ElevenLabs voices available on this account.");

  const preferredNames = ["Daniel", "Adam", "Brian", "George", "Antoni", "Rachel", "Chris", "Roger"];
  for (const name of preferredNames) {
    const match = voices.find((voice) => String(voice.name).toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return voices[0];
}
