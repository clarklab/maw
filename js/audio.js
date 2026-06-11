// MAW — audio. The chomps, gulps and ambience are synthesized; the words
// are real: one ElevenLabs narration of the whole story (audio/story.mp3,
// rendered by tools/render-voice.mjs) sliced per word as each one escapes.
// If the narration files are missing, every word falls back to the old
// formant-filtered vowels.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muffle = null;       // lowpass that closes with the jaw
    this.ambienceGain = null;
    this.enabled = false;
    this._noiseBuf = null;
    this.voiceBuffer = null;  // decoded narration
    this.voiceWords = null;   // [{ w, s, e }] seconds into voiceBuffer
    this._voiceFetch = null;
    this._storySource = null; // full-narration playback (win screen)
  }

  // Fetch the narration early (no AudioContext needed yet); decode in init().
  preload(base = 'audio/') {
    this._voiceFetch = (async () => {
      const [meta, data] = await Promise.all([
        fetch(`${base}story-words.json`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}story.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)),
      ]);
      return meta && data ? { meta, data } : null;
    })().catch(() => null);
  }

  async _decodeVoice() {
    const v = this._voiceFetch ? await this._voiceFetch : null;
    if (!v || !this.ctx) return;
    try {
      this.voiceBuffer = await this.ctx.decodeAudioData(v.data);
      this.voiceWords = v.meta.words;
    } catch { /* keep the synth fallback */ }
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this._decodeVoice();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    // Gentle limiter so chomp stacks don't clip.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;

    // bullet-time lowpass — wide open until time slows
    this._bulletLP = this.ctx.createBiquadFilter();
    this._bulletLP.type = 'lowpass';
    this._bulletLP.frequency.value = 18000;
    this._bulletLP.Q.value = 0.4;

    this.master.connect(this._bulletLP);
    this._bulletLP.connect(comp);
    comp.connect(this.ctx.destination);

    this._noiseBuf = this._makeNoise(2.0);
    this._startAmbience();
    this._startHeartbeat();
    this.enabled = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = this._noiseBuf.duration;
    return src;
  }

  // ------------------------------------------------------------------ ambience
  // Waves + breeze, heard through the open mouth. The game drives `setMouthOpen`
  // so the outside world muffles when the jaw clamps shut.
  _startAmbience() {
    const ctx = this.ctx;
    const src = this._noiseSource();

    const sea = ctx.createBiquadFilter();
    sea.type = 'lowpass';
    sea.frequency.value = 380;
    sea.Q.value = 0.6;

    // Slow swell of the waves.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(sea.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.067;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.05;

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 4000;
    this.muffle.Q.value = 0.5;

    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0.11;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(this.ambienceGain.gain);
    lfo2.start();

    src.connect(sea);
    sea.connect(this.muffle);
    this.muffle.connect(this.ambienceGain);
    this.ambienceGain.connect(this.master);
    src.start();
  }

  setMouthOpen(open01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 250 + open01 * open01 * 5200;
    this.muffle.frequency.setTargetAtTime(f, t, 0.06);
    this.ambienceGain.gain.setTargetAtTime(0.035 + open01 * 0.11, t, 0.1);
  }

  // Soft interior pulse — you are, after all, inside a living thing.
  _startHeartbeat() {
    const ctx = this.ctx;
    const beat = () => {
      if (!this.ctx) return;
      this._thump(0.045, 52);
      setTimeout(() => this._thump(0.03, 44), 320);
      setTimeout(beat, 1900 + Math.random() * 250);
    };
    setTimeout(beat, 1200);
  }

  _thump(vol, freq) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ------------------------------------------------------------------- events

  // Jaw slams shut: bone thud + wet squelch.
  chomp(hard = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // bone-on-bone thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * hard, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.16);

    // wet squelch — resonant lowpass sweeping down over noise
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.12);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.32 * hard, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(f); f.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.2);
  }

  // Teeth meet food: crunch layered over the chomp.
  crunch(crispness = 0.5) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + crispness * 2400;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    // a few rapid transients = fibrous crunch
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.022;
      g.gain.setValueAtTime(0.26 * (1 - i / 6), tt);
      g.gain.exponentialRampToValueAtTime(0.01, tt + 0.018);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.2);
  }

  // Swallow: descending wet formant blips down the hatch.
  gulp() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.34);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.34);
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.04);
    g.gain.setValueAtTime(0.4, t + 0.12);
    g.gain.linearRampToValueAtTime(0.05, t + 0.18);
    g.gain.linearRampToValueAtTime(0.35, t + 0.24);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.45);
  }

  // Play one word of the narration. `through` optionally inserts a filter
  // between the voice and the master bus. Returns false if no voice loaded.
  _speakWord(index, { gain = 0.9, through = null } = {}) {
    if (!this.voiceBuffer || !this.voiceWords) return false;
    const cue = this.voiceWords[index];
    if (!cue) return false;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const lead = 0.02, tail = 0.07;
    const start = Math.max(0, cue.s - lead);
    const dur = Math.min(this.voiceBuffer.duration - start, cue.e - cue.s + lead + tail);
    if (dur <= 0) return false;

    const src = ctx.createBufferSource();
    src.buffer = this.voiceBuffer;
    const g = ctx.createGain();
    // micro fades so cuts from the continuous narration don't click
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + Math.max(0.012, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t + dur);
    if (through) { src.connect(through); through.connect(g); }
    else src.connect(g);
    g.connect(this.master);
    src.start(t, start, dur + 0.02);
    return true;
  }

  // A word makes it out: airy whoosh + the real spoken word (or, if the
  // narration isn't available, a brief synthesized vowel pitched per word).
  wordEscape(pitch = 1, wordIndex = -1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const spoke = this._speakWord(wordIndex);

    // breath
    const n = this._noiseSource();
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.setValueAtTime(700, t);
    bf.frequency.exponentialRampToValueAtTime(3200, t + 0.25);
    bf.Q.value = 0.8;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.001, t);
    bg.gain.exponentialRampToValueAtTime(spoke ? 0.06 : 0.12, t + 0.06);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(bf); bf.connect(bg); bg.connect(this.master);
    n.start(t); n.stop(t + 0.35);
    if (spoke) return;

    // vowel — glottal source through two formant filters
    const vowels = [
      [600, 1000], [400, 1900], [250, 2300], [450, 800], [350, 1300],
    ];
    const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    const base = (105 + Math.random() * 30) * pitch;
    src.frequency.setValueAtTime(base * 1.06, t);
    src.frequency.linearRampToValueAtTime(base * 0.94, t + 0.22);

    const make = (freq, q, vol) => {
      const ff = ctx.createBiquadFilter();
      ff.type = 'bandpass';
      ff.frequency.value = freq;
      ff.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = vol;
      src.connect(ff); ff.connect(fg); fg.connect(env);
    };
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.34, t + 0.035);
    env.gain.setTargetAtTime(0.0001, t + 0.16, 0.05);
    env.connect(this.master);
    make(f1, 9, 1.0);
    make(f2, 11, 0.55);
    src.start(t); src.stop(t + 0.4);
  }

  // A word hits closed lips: pressed, nasal "mmph" — with the real word
  // trapped behind it, lowpassed into the cheeks.
  muffled(wordIndex = -1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const trap = ctx.createBiquadFilter();
    trap.type = 'lowpass';
    trap.frequency.value = 320;
    trap.Q.value = 2;
    this._speakWord(wordIndex, { gain: 0.7, through: trap });
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(130, t);
    src.frequency.linearRampToValueAtTime(95, t + 0.28);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.03);
    g.gain.setValueAtTime(0.42, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.35);
  }

  // Food gets past the lips. Social catastrophe: wet pop + distant clatter.
  foodEscape() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.14);

    // plate clatter, far away
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.28 + i * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1800 + Math.random() * 2600;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.07, tt);
      og.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
      o.connect(og); og.connect(this.master);
      o.start(tt); o.stop(tt + 0.12);
    }
  }

  // Held shut too long — the gasp when the mouth is forced open.
  gasp() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
    f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(f); f.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.55);
  }

  // The whole story, told properly — start to finish (win screen victory lap).
  playStory() {
    if (!this.enabled || !this.voiceBuffer) return;
    this.stopStory();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.voiceBuffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.4);
    src.connect(g);
    g.connect(this.master);
    src.start(t + 0.6);
    this._storySource = { src, g };
  }

  stopStory() {
    if (!this._storySource) return;
    const { src, g } = this._storySource;
    this._storySource = null;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.08);
    try { src.stop(t + 0.4); } catch { /* already ended */ }
  }

  // Food wedges itself between two teeth: a rubbery rising squeak.
  stuckSqueak() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(1900, t + 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(f); f.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.22);
  }

  // Time dilates while you concentrate on the wedged piece: the whole mix
  // sinks underwater (and surfaces again on the way out).
  bulletTime(on) {
    if (!this.enabled || !this._bulletLP) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this._bulletLP.frequency.setTargetAtTime(on ? 480 : 18000, t, on ? 0.15 : 0.08);

    // a soft whoosh marks the threshold
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(on ? 2600 : 300, t);
    f.frequency.exponentialRampToValueAtTime(on ? 300 : 2600, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(f); f.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.45);
  }

  // The stuck piece pops free: bright ascending sparkle + a wet pop.
  pickSuccess() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [880, 1175, 1760].forEach((freq, i) => {
      const tt = t + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.16, tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.35);
      o.connect(g); g.connect(this.master);
      o.start(tt); o.stop(tt + 0.4);
    });
    // the pop of the piece coming loose
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  // Story chapter chime — a warm distant bell (church bells over the harbor).
  chime() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [520, 779, 1041].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12 / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 - i * 0.4);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 2.3);
    });
  }
}
