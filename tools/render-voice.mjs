// MAW — render the story narration with ElevenLabs.
//
// Renders every word token of the story as its own clip (conditioned on the
// surrounding text so the prosody flows like one telling), plus the whole
// story as a single track, into assets/voice/. Idempotent: existing files
// are skipped, so a partial run can simply be re-run.
//
// The API key is NEVER stored in the repo. Run with:
//   ELEVENLABS_API_KEY=sk_… node tools/render-voice.mjs
//
// Optional env:
//   ELEVENLABS_VOICE_ID  (default: Debbie Irwin — warm, worldly, mature)

import { mkdir, writeFile, access, readFile } from 'fs/promises';
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
const SETTINGS = { stability: 0.45, similarity_boost: 0.75 };

const exists = (p) => access(p).then(() => true, () => false);

async function tts(text, { format, previousText, nextText }) {
  const body = {
    text,
    model_id: MODEL,
    voice_settings: SETTINGS,
  };
  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;

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

await mkdir(join(OUT, 'words'), { recursive: true });

// ---- every word, conditioned on its neighbourhood so the line flows
const CONTEXT = 30; // words of context either side
let rendered = 0, skipped = 0;
for (let i = 0; i < WORDS.length; i++) {
  const file = join(OUT, 'words', `${String(i).padStart(3, '0')}.mp3`);
  if (await exists(file)) { skipped++; continue; }
  const audio = await tts(WORDS[i], {
    format: WORD_FORMAT,
    previousText: WORDS.slice(Math.max(0, i - CONTEXT), i).join(' ') || undefined,
    nextText: WORDS.slice(i + 1, i + 1 + CONTEXT).join(' ') || undefined,
  });
  await writeFile(file, audio);
  rendered++;
  process.stdout.write(`\r  words: ${i + 1}/${WORDS.length} (${WORDS[i]})${' '.repeat(20)}`);
}
console.log(`\n  words done — ${rendered} rendered, ${skipped} already present`);

// ---- the whole story as one telling
const storyFile = join(OUT, 'story.mp3');
if (await exists(storyFile)) {
  console.log('  story.mp3 already present');
} else {
  console.log('  rendering full story…');
  await writeFile(storyFile, await tts(STORY.replace(/\s+/g, ' '), { format: STORY_FORMAT }));
  console.log('  story.mp3 done');
}

// ---- manifest the game loads at runtime
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({
  voice: VOICE_NAME,
  model: MODEL,
  words: WORDS,
  story: 'story.mp3',
}, null, 1));
console.log(`manifest written — ${WORDS.length} words, voice: ${VOICE_NAME}`);
