// MAW — the real voice. The story is narrated by a warm, worldly storyteller
// (clips rendered offline by tools/render-voice.mjs — the API key never
// ships); each escaping word plays its own clip, conditioned on the
// surrounding text so consecutive words flow like one telling, and the whole
// story plays over the win screen.
//
// Everything degrades gracefully: if the assets are missing or still
// downloading, the old synthesized formant vowels carry the word instead.

export class VoiceEngine {
  constructor(base = 'assets/voice/') {
    this.base = base;
    this.manifest = null;
    this.raw = new Map();      // wordIndex | 'story' → ArrayBuffer
    this.buffers = new Map();  // wordIndex | 'story' → AudioBuffer
    this.ctx = null;
    this.out = null;
    this.storySource = null;
  }

  // Fetch the clips in the background. Safe to call at page load — no
  // AudioContext needed yet, and any failure just means synth fallback.
  async preload() {
    try {
      const res = await fetch(this.base + 'manifest.json');
      if (!res.ok) return;
      this.manifest = await res.json();
    } catch {
      return;
    }
    const fetchOne = async (key, path) => {
      try {
        const r = await fetch(path);
        if (r.ok) this.raw.set(key, await r.arrayBuffer());
      } catch { /* offline — the synth voice covers it */ }
    };
    // early words first: the player hears them within seconds of starting
    const queue = this.manifest.words.map((_, i) =>
      () => fetchOne(i, `${this.base}words/${String(i).padStart(3, '0')}.mp3`));
    queue.push(() => fetchOne('story', this.base + this.manifest.story));
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) await queue.shift()();
    }));
  }

  // Called once the AudioEngine has a context (user gesture).
  bind(audio) {
    this.ctx = audio.ctx;
    this.out = audio.master;
  }

  has(key) { return this.buffers.has(key) || this.raw.has(key); }

  async _buffer(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    const raw = this.raw.get(key);
    if (!raw || !this.ctx) return null;
    try {
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(key, buf);
      this.raw.delete(key);
      return buf;
    } catch {
      return null;
    }
  }

  // Speak word i. rate < 1 stretches it during bullet time.
  // Returns true if the clip will play (so the caller can skip its synth).
  playWord(i, rate = 1, volume = 0.9) {
    if (!this.ctx || !this.has(i)) return false;
    this._buffer(i).then((buf) => {
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.out);
      src.start();
    });
    // decode ahead so upcoming words start with no hiccup
    for (let k = 1; k <= 3; k++) if (this.raw.has(i + k)) this._buffer(i + k);
    return true;
  }

  // The whole telling — played over the win screen.
  playStory(volume = 0.75) {
    if (!this.ctx || !this.has('story')) return false;
    this.stopStory();
    this._buffer('story').then((buf) => {
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.out);
      src.start(this.ctx.currentTime + 0.5);
      this.storySource = src;
    });
    return true;
  }

  stopStory() {
    if (this.storySource) {
      try { this.storySource.stop(); } catch { /* already ended */ }
      this.storySource = null;
    }
  }
}
