// MAW — the real voice. The story is narrated by a warm, worldly storyteller
// (clips rendered offline by tools/render-voice.mjs — the API key never
// ships); each escaping word plays its own clip, conditioned on the
// surrounding text so consecutive words flow like one telling, and the whole
// story plays over the win screen.
//
// Everything degrades gracefully: if the assets are missing or still
// downloading, the old synthesized formant vowels carry the word instead.

// A gap of breath between words longer than this starts a new phrase —
// those gaps are the player's safe windows to bite.
const PHRASE_GAP = 0.28;

export class VoiceEngine {
  constructor(base = 'assets/voice/') {
    this.base = base;
    this.manifest = null;
    this.timings = null;       // { duration, words: [{ s, e, p }] }
    this.raw = new Map();      // filename | 'story' → ArrayBuffer
    this.buffers = new Map();  // filename | 'story' → AudioBuffer
    this.ctx = null;
    this.out = null;
    this.storySource = null;
    this.narrGain = null;
    this.narrLow = null;
  }

  // The clip filename for word i (duplicate words share one clip).
  _file(i) {
    if (!this.manifest) return null;
    if (this.manifest.files) return this.manifest.files[i] || null;
    return `${String(i).padStart(3, '0')}.mp3`; // older manifests
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
    // word timestamps for performance mode (optional — classic mode without)
    try {
      const r = await fetch(this.base + 'timings.json');
      if (r.ok) {
        const t = await r.json();
        const words = t.words.map(([s, e]) => ({ s, e, p: 0 }));
        let p = 0;
        for (let i = 1; i < words.length; i++) {
          if (words[i].s - words[i - 1].e > PHRASE_GAP) p++;
          words[i].p = p;
        }
        this.timings = { duration: t.duration, words };
      }
    } catch { /* no timings — classic mode */ }
    const fetchOne = async (key, path) => {
      try {
        const r = await fetch(path);
        if (r.ok) this.raw.set(key, await r.arrayBuffer());
      } catch { /* offline — the synth voice covers it */ }
    };
    // early words first: the player hears them within seconds of starting
    const seen = new Set();
    const queue = [];
    for (let i = 0; i < this.manifest.words.length; i++) {
      const name = this._file(i);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      queue.push(() => fetchOne(name, `${this.base}words/${name}`));
    }
    queue.push(() => fetchOne('story', this.base + this.manifest.story));
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) await queue.shift()();
    }));
  }

  // Called once the AudioEngine has a context (user gesture).
  bind(audio) {
    this.ctx = audio.ctx;
    this.out = audio.master;
    // decode the narration eagerly — performance mode needs it at start
    if (this.raw.has('story')) this._buffer('story');
  }

  // Can the game run the story as a timed performance?
  performanceReady() {
    return !!(this.timings && this.buffers.has('story'));
  }

  // ------------------------------------------------- narration (performance)

  // The continuous telling, with live rate control (bullet time slows the
  // narrator's actual voice) and a duck for words mumbled through a bite.
  startNarration() {
    if (!this.performanceReady()) return false;
    this.stopStory();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get('story');
    this.narrLow = this.ctx.createBiquadFilter();
    this.narrLow.type = 'lowpass';
    this.narrLow.frequency.value = 9500;
    this.narrGain = this.ctx.createGain();
    this.narrGain.gain.value = 0.9;
    src.connect(this.narrLow);
    this.narrLow.connect(this.narrGain);
    this.narrGain.connect(this.out);
    src.start();
    this.storySource = src;
    return true;
  }

  setNarrationRate(r) {
    if (this.storySource) this.storySource.playbackRate.value = r;
  }

  // A word hit closed lips: the narration smothers for its duration.
  duckNarration(dur = 0.35) {
    if (!this.narrGain) return;
    const t = this.ctx.currentTime;
    this.narrGain.gain.cancelScheduledValues(t);
    this.narrGain.gain.setTargetAtTime(0.1, t, 0.015);
    this.narrGain.gain.setTargetAtTime(0.9, t + dur, 0.07);
    this.narrLow.frequency.cancelScheduledValues(t);
    this.narrLow.frequency.setTargetAtTime(380, t, 0.015);
    this.narrLow.frequency.setTargetAtTime(9500, t + dur, 0.09);
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
    const file = this._file(i);
    if (!this.ctx || !file || !this.has(file)) return false;
    this._buffer(file).then((buf) => {
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
    for (let k = 1; k <= 3; k++) {
      const f = this._file(i + k);
      if (f && this.raw.has(f)) this._buffer(f);
    }
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
