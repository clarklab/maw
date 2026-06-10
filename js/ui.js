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
