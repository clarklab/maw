// MAW — render the story narration with ElevenLabs.
//
// Renders the whole 181-word travelogue in one pass (so the prosody flows
// like a real dinner-table story), and keeps the character-level timestamps
// so the game can play each individual word as it escapes the lips.
//
// Usage:
//   ELEVENLABS_API_KEY=sk_... node tools/render-voice.mjs
//
// Writes:
//   audio/story.mp3          — the full narration
//   audio/story-words.json   — per-word [start, end] seconds into story.mp3
//
// The API key is read from the environment only. Never commit it.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STORY, WORDS } from '../js/story.js';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('Set ELEVENLABS_API_KEY in the environment (do not hardcode it).');
  process.exit(1);
}

// "Debbie Irwin" — a worldly, elegant, mature American woman. The closest
// thing on the roster to your aunt in her mid-60s holding the table hostage
// with the story of her Croatian summer.
const VOICE_ID = 'VboXAcrVA3F7il0TZHdP';

const TEXT = STORY.replace(/\s+/g, ' ');

const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
  {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: TEXT,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,        // a little loose — it's a story, not a newscast
        similarity_boost: 0.8,
        style: 0.3,
      },
    }),
  }
);

if (!res.ok) {
  console.error(`ElevenLabs API error ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const { audio_base64, alignment } = await res.json();
if (!audio_base64 || !alignment) {
  console.error('Response missing audio or alignment.');
  process.exit(1);
}

// The alignment echoes the input text character by character, with start/end
// seconds for each. Walk it and cut on the spaces to get one [start, end]
// span per word, in the same order as WORDS in js/story.js.
const chars = alignment.characters;
const starts = alignment.character_start_times_seconds;
const ends = alignment.character_end_times_seconds;
const echoed = chars.join('');
if (echoed !== TEXT) {
  console.warn('Alignment text differs from input; word cuts may drift slightly.');
}

const words = [];
let begin = -1;
for (let i = 0; i <= chars.length; i++) {
  const isSpace = i === chars.length || chars[i] === ' ';
  if (!isSpace && begin < 0) begin = i;
  if (isSpace && begin >= 0) {
    words.push({
      w: chars.slice(begin, i).join(''),
      s: Math.round(starts[begin] * 1000) / 1000,
      e: Math.round(ends[i - 1] * 1000) / 1000,
    });
    begin = -1;
  }
}

if (words.length !== WORDS.length) {
  console.error(`Word count mismatch: alignment has ${words.length}, story has ${WORDS.length}.`);
  process.exit(1);
}
for (let i = 0; i < words.length; i++) {
  if (words[i].w !== WORDS[i]) {
    console.warn(`Word ${i} differs: "${words[i].w}" vs "${WORDS[i]}"`);
  }
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'audio');
await mkdir(outDir, { recursive: true });
const mp3 = Buffer.from(audio_base64, 'base64');
await writeFile(path.join(outDir, 'story.mp3'), mp3);
await writeFile(
  path.join(outDir, 'story-words.json'),
  JSON.stringify({ voice: 'Debbie Irwin', words }, null, 1)
);

const total = words[words.length - 1].e;
console.log(`Rendered ${words.length} words, ${total.toFixed(1)}s, ${(mp3.length / 1024).toFixed(0)} KB → audio/story.mp3`);
