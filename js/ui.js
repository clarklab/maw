// MAW — DOM HUD. The 3D scene tells the story; this just keeps score,
// counts your remaining dignity, and types the story out as it escapes.

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      storyText: document.getElementById('story-text'),
      score: document.getElementById('score'),
      manners: document.getElementById('manners'),
      hint: document.getElementById('hint'),
      callout: document.getElementById('callout'),
      chapter: document.getElementById('chapter-toast'),
      breathMeter: document.getElementById('breath-meter'),
      breathFill: document.getElementById('breath-fill'),
      redflash: document.getElementById('redflash'),
      stuckTip: document.getElementById('stuck-tip'),
      bulletVignette: document.getElementById('bullet-vignette'),
      cueWord: document.getElementById('cue-word'),
      cueFood: document.getElementById('cue-food'),
      defendBanner: document.getElementById('defend-banner'),
      splats: document.getElementById('splats'),
      title: document.getElementById('title-screen'),
      end: document.getElementById('end-screen'),
      endTitle: document.getElementById('end-title'),
      endSub: document.getElementById('end-sub'),
      endStory: document.getElementById('end-story'),
      endScore: document.getElementById('end-score'),
      loading: document.getElementById('loading'),
    };
    this._calloutTimer = null;
    this._hintShown = 0;
    // teaching captions on the edge cues fade away after a few showings
    this._cueTeach = { word: 3, food: 3 };
    this._cueWasOn = { word: false, food: false };
    this._cueLast = { word: -1, food: -1 };
  }

  // Edge-glow cues, 0..1: gold from the top while a word needs out,
  // red from the bottom while food is closing on the lips.
  cues(word, food) {
    for (const [kind, v, el] of [
      ['word', word, this.el.cueWord],
      ['food', food, this.el.cueFood],
    ]) {
      if (Math.abs(v - this._cueLast[kind]) > 0.01) {
        el.style.opacity = v.toFixed(2);
        this._cueLast[kind] = v;
      }
      const on = v > 0.55;
      if (on && !this._cueWasOn[kind] && this._cueTeach[kind] > 0) {
        this._cueTeach[kind]--;
        if (this._cueTeach[kind] === 0) el.classList.add('no-label');
      }
      this._cueWasOn[kind] = on;
    }
  }

  ready() { this.el.loading.classList.add('done'); }

  showHUD() {
    this.el.hud.classList.remove('hidden');
    this._hintShown = performance.now();
  }

  hideTitle() { this.el.title.classList.add('fading'); }

  appendWord(word) {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = word;
    this.el.storyText.appendChild(span);
    // keep only the most recent words visible
    while (this.el.storyText.children.length > 26) {
      this.el.storyText.removeChild(this.el.storyText.firstChild);
    }
  }

  setScore(n) { this.el.score.textContent = String(n); }

  setManners(n, total = 3) {
    const el = this.el.manners;
    if (el.children.length !== total) {
      el.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const pip = document.createElement('div');
        pip.className = 'manner-pip';
        el.appendChild(pip);
      }
    }
    [...el.children].forEach((pip, i) => {
      pip.classList.toggle('lost', i >= n);
    });
  }

  callout(text, bad = false) {
    const c = this.el.callout;
    c.textContent = text;
    c.classList.remove('hidden', 'pop', 'bad');
    void c.offsetWidth; // restart animation
    if (bad) c.classList.add('bad');
    c.classList.add('pop');
  }

  chapterToast(name) {
    const c = this.el.chapter;
    c.textContent = name;
    c.classList.remove('hidden');
    c.classList.add('show');
    clearTimeout(this._chapterTimer);
    this._chapterTimer = setTimeout(() => c.classList.remove('show'), 2600);
  }

  // Persistent nag while food is stuck in the teeth. Pass null to hide.
  stuckTip(text) {
    const el = this.el.stuckTip;
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  bulletTime(on) {
    this.el.bulletVignette.classList.toggle('on', !!on);
  }

  // DEFEND YOURSELF — the bonus-round card (it fades itself out).
  defendBanner(on) {
    const el = this.el.defendBanner;
    if (!on) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden', 'go');
    void el.offsetWidth; // restart the animation
    el.classList.add('go');
  }

  // Juice across the lens when a morsel lands on your face.
  splat(color) {
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('div');
      b.className = 'splat-blob';
      const size = 16 + Math.random() * 26;
      b.style.width = b.style.height = `${size}vmin`;
      b.style.left = `${15 + Math.random() * 60}%`;
      b.style.top = `${12 + Math.random() * 60}%`;
      b.style.background =
        `radial-gradient(circle at 40% 35%, ${color}e6, ${color}88 55%, transparent 72%)`;
      b.style.animationDelay = `${(Math.random() * 0.08).toFixed(3)}s`;
      b.addEventListener('animationend', () => b.remove());
      this.el.splats.appendChild(b);
    }
  }

  redFlash() {
    const r = this.el.redflash;
    r.classList.add('flash');
    setTimeout(() => r.classList.remove('flash'), 180);
  }

  breath(t01, urgent) {
    this.el.breathMeter.classList.toggle('urgent', urgent);
    this.el.breathFill.style.width = `${Math.max(0, (1 - t01) * 100)}%`;
  }

  fadeHintMaybe() {
    if (this._hintShown && performance.now() - this._hintShown > 9000) {
      this.el.hint.classList.add('faded');
      this._hintShown = 0;
    }
  }

  showEnd(won, lines, story, score) {
    this.el.endTitle.textContent = won ? 'FIN.' : 'MORTIFYING.';
    this.el.endSub.textContent = lines;
    this.el.endStory.textContent = story;
    this.el.endScore.textContent = `${score} points`;
    this.el.end.classList.remove('hidden', 'fading');
  }

  hideEnd() { this.el.end.classList.add('fading'); }

  resetStory() { this.el.storyText.innerHTML = ''; }
}
