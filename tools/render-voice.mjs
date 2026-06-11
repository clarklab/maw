// MAW — render the story narration with ElevenLabs.
//
// Renders every unique word of the story as its own CLEAN, isolated clip
// (no sentence-context conditioning — conditioned words come out sounding
// like cut-off mid-sentence fragments), plus the whole story as a single
// track, into assets/voice/. Duplicate words share one file via the
// manifest's files[] mapping. Idempotent: existing files are skipped, so a
// partial run can simply be re-run. Pass --fresh to discard old word clips.
//
// The API key is NEVER stored in the repo. Run with:
//   ELEVENLABS_API_KEY=sk_… node tools/render-voice.mjs [--fresh]
//
// Optional env:
//   ELEVENLABS_VOICE_ID  (default: Debbie Irwin — warm, worldly, mature)

import { mkdir, writeFile, access, rm } from 'fs/promises';
import { join } from 'path';
import { WORDS, STORY } from '../js/story.js';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY in the environment (never commit it).');
  process.exit(1);
}

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'VboXAcrVA3F7il0TZHdP'; // Debbie Irwin
const VOICE_NAME = 'Debbie Irwin';
const MODEL = 'eleven_multilingual_v2';
const WORD_FORMAT = 'mp3_44100_64';   // single words: small files
const STORY_FORMAT = 'mp3_44100_128'; // the full telling: full quality
const OUT = new URL('../assets/voice/', import.meta.url).pathname;
// a touch more stability for single words — consistent, clean reads
const WORD_SETTINGS = { stability: 0.6, similarity_boost: 0.75 };
const STORY_SETTINGS = { stability: 0.45, similarity_boost: 0.75 };

const exists = (p) => access(p).then(() => true, () => false);

// What the narrator actually says for a token: the bare word, no clinging
// punctuation (keeps internal apostrophes/hyphens, e.g. "fishermen's").
const spoken = (token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Hand-tuned retakes: tiny function words can drift in voice/gender when
// rendered bare — anchor them with a closing period and firmer settings.
const RETAKES = {
  its: { say: 'its.', settings: { stability: 0.7, similarity_boost: 0.85 } },
};

async function tts(text, format, settings) {
  const body = { text, model_id: MODEL, voice_settings: settings };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${format}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const detail = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const wait = 2000 * (attempt + 1);
      console.warn(`  ${res.status} — retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`TTS ${res.status}: ${detail.slice(0, 300)}`);
  }
  throw new Error('TTS: too many retries');
}

if (process.argv.includes('--fresh')) {
  await rm(join(OUT, 'words'), { recursive: true, force: true });
}
await mkdir(join(OUT, 'words'), { recursive: true });

// ---- every unique word, isolated and clean; duplicates share a file
const fileFor = new Map(); // spoken text (lowercased) → filename
const files = [];          // per token index → filename
let rendered = 0, skipped = 0;
for (let i = 0; i < WORDS.length; i++) {
  const say = spoken(WORDS[i]);
  const dedupeKey = say.toLowerCase();
  const retake = RETAKES[dedupeKey];
  let name = fileFor.get(dedupeKey);
  if (!name) {
    name = `${String(i).padStart(3, '0')}.mp3`; // named for first occurrence
    fileFor.set(dedupeKey, name);
    const file = join(OUT, 'words', name);
    if (await exists(file)) {
      skipped++;
    } else {
      await writeFile(file, await tts(
        retake ? retake.say : say,
        WORD_FORMAT,
        retake ? retake.settings : WORD_SETTINGS
      ));
      rendered++;
      process.stdout.write(`\r  words: ${i + 1}/${WORDS.length} (${say})${' '.repeat(20)}`);
    }
  }
  files.push(name);
}
console.log(`\n  words done — ${fileFor.size} unique clips (${rendered} rendered, ${skipped} already present) for ${WORDS.length} tokens`);

// ---- the whole story as one telling
const storyFile = join(OUT, 'story.mp3');
if (await exists(storyFile)) {
  console.log('  story.mp3 already present');
} else {
  console.log('  rendering full story…');
  await writeFile(storyFile, await tts(STORY.replace(/\s+/g, ' '), STORY_FORMAT, STORY_SETTINGS));
  console.log('  story.mp3 done');
}

// ---- manifest the game loads at runtime
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({
  voice: VOICE_NAME,
  model: MODEL,
  words: WORDS,
  files,
  story: 'story.mp3',
}, null, 1));
console.log(`manifest written — ${WORDS.length} words, voice: ${VOICE_NAME}`);
