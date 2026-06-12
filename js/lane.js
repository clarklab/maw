// MAW — the exit highway. A Guitar-Hero-style fretboard pinned to the left
// side of the screen: a perspective highway recedes to a vanishing point,
// and everything heading for the lips slides DOWN it, growing as it comes,
// toward a glowing strike line. Two lanes: words (gold, left) and food
// (red, right), each with its own receptor on the strike line. Phrase runs
// are sustain ribbons, and the green CHEW zone sweeps the board like a
// kicking meter — bite food while it crosses the band. Persistent while
// playing.

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const lerp = (a, b, t) => a + (b - a) * t;

const PERSPECTIVE = 0.62; // foreshortening exponent (smaller = deeper)

export class Lane {
  // compact = small fixed-size board (the explainer's live diagram)
  constructor(canvas, compact = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compact = compact;
    this.items = [];
    this.flashes = [];   // strike feedback: { kind: 'hit'|'miss', age }
    this.alpha = 0;
    this.targetAlpha = 0;
    this.time = 0;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.compact) {
      this.w = 210;
      this.h = 290;
      this.yNear = this.h * 0.88;
      this.yFar = this.h * 0.07;
      this.xNear = this.xFar = 92;
      this.wNear = 118;
      this.wFar = 34;
    } else {
      this.w = 190;
      this.h = window.innerHeight;
      // board geometry: near edge (strike line) wide at the bottom,
      // far edge narrow up top — a symmetric trapezoid, dead-on perspective
      this.yNear = this.h * 0.72;
      this.yFar = this.h * 0.27;
      this.xNear = this.xFar = 78;
      this.wNear = 124;
      this.wFar = 34;
    }
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // Perspective sample along the board. t: 0 = far (just spawned),
  // 1 = on the strike line. Returns centre x, y, half-width, scale.
  _at(t) {
    const p = Math.pow(1 - clamp01(t), PERSPECTIVE);
    return {
      y: lerp(this.yNear, this.yFar, p),
      cx: lerp(this.xNear, this.xFar, p),
      hw: lerp(this.wNear, this.wFar, p) / 2,
      s: lerp(1, this.wFar / this.wNear, p),
    };
  }

  _laneX(at, lane) { // lane: -1 words, +1 food
    return at.cx + lane * at.hw * 0.45;
  }

  // items: [{ type: 'word', t, p? } | { type: 'food', t, color?, warn?, inZone? }
  //         | { type: 'zone', t0, t1, hot? } | { type: 'tick', t }]
  // visibility: 0 hidden, 1 full, fractions dim (bullet time)
  set(items, visibility) {
    this.items = items;
    this.targetAlpha = visibility;
  }

  flash(kind) {
    this.flashes.push({ kind, age: 0 });
  }

  update(dt) {
    this.time += dt;
    this.alpha += (this.targetAlpha - this.alpha) * (1 - Math.exp(-dt * 6));
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].age += dt;
      if (this.flashes[i].age > 0.5) this.flashes.splice(i, 1);
    }
  }

  // A perspective-correct band across the board between t0 and t1.
  _band(t0, t1) {
    const a = this._at(t0), b = this._at(t1);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.cx - a.hw, a.y);
    ctx.lineTo(a.cx + a.hw, a.y);
    ctx.lineTo(b.cx + b.hw, b.y);
    ctx.lineTo(b.cx - b.hw, b.y);
    ctx.closePath();
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.alpha < 0.02 && !this.flashes.length) return;

    ctx.globalAlpha = this.alpha;
    ctx.lineCap = ctx.lineJoin = 'round';
    const near = this._at(1), far = this._at(0);

    // ---------------------------------------------------------- the board
    // glass surface, darker toward the horizon
    const surf = ctx.createLinearGradient(0, near.y, 0, far.y);
    surf.addColorStop(0, 'rgba(10, 3, 6, 0.55)');
    surf.addColorStop(1, 'rgba(10, 3, 6, 0.18)');
    this._band(1, 0);
    ctx.fillStyle = surf;
    ctx.fill();

    // neon edge rails
    for (const side of [-1, 1]) {
      ctx.strokeStyle = 'rgba(255, 196, 110, 0.55)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255, 170, 70, 0.8)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(near.cx + side * near.hw, near.y);
      ctx.lineTo(far.cx + side * far.hw, far.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // lane divider
    ctx.strokeStyle = 'rgba(255, 230, 200, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(near.cx, near.y);
    ctx.lineTo(far.cx, far.y);
    ctx.stroke();

    // horizon glow at the vanishing end
    const hg = ctx.createRadialGradient(far.cx, far.y, 0, far.cx, far.y, 26);
    hg.addColorStop(0, 'rgba(255, 200, 130, 0.35)');
    hg.addColorStop(1, 'rgba(255, 200, 130, 0)');
    ctx.fillStyle = hg;
    ctx.fillRect(far.cx - 26, far.y - 14, 52, 28);

    // moving fret bars — the tempo, sliding toward you
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.16)';
    for (const it of this.items) {
      if (it.type !== 'tick') continue;
      const a = this._at(it.t);
      ctx.lineWidth = 1 + a.s * 0.8;
      ctx.beginPath();
      ctx.moveTo(a.cx - a.hw + 3, a.y);
      ctx.lineTo(a.cx + a.hw - 3, a.y);
      ctx.stroke();
    }

    // ----------------------------------------- the sliding CHEW zone
    // A kicking-meter band sweeping the board: bite food while it's inside.
    for (const it of this.items) {
      if (it.type !== 'zone') continue;
      const tA = clamp01(Math.max(it.t0, it.t1)), tB = clamp01(Math.min(it.t0, it.t1));
      if (Math.abs(this._at(tA).y - this._at(tB).y) < 4) continue;
      const breathe = 0.75 + 0.25 * Math.sin(this.time * (it.hot ? 14 : 5));
      this._band(tA, tB);
      ctx.fillStyle = it.hot ? 'rgba(120, 245, 180, 0.34)' : 'rgba(90, 220, 160, 0.18)';
      ctx.fill();
      ctx.strokeStyle = `rgba(150, 250, 195, ${(it.hot ? 0.8 : 0.55) + 0.2 * breathe})`;
      ctx.lineWidth = it.hot ? 2.2 : 1.6;
      if (it.hot) {
        ctx.shadowColor = 'rgba(110, 250, 180, 0.9)';
        ctx.shadowBlur = 8;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      const mid = this._at((tA + tB) / 2);
      if (Math.abs(this._at(tA).y - this._at(tB).y) > 16) {
        ctx.shadowColor = 'rgba(0, 40, 20, 0.9)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = `rgba(200, 255, 225, ${0.7 + 0.3 * breathe})`;
        ctx.font = `700 ${Math.round(8 + 4 * mid.s)}px Futura, "Avenir Next", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('C H E W', mid.cx, mid.y + 3.5);
        ctx.shadowBlur = 0;
      }
    }

    // ------------------------------------------------ phrase sustain ribbons
    let runStart = null, prev = null;
    const ribbon = (a, b) => {
      const pa = this._at(a.t), pb = this._at(b.t);
      const xa = this._laneX(pa, -1), xb = this._laneX(pb, -1);
      const wa = 5 * pa.s + 3, wb = 5 * pb.s + 3;
      ctx.beginPath();
      ctx.moveTo(xa - wa, pa.y);
      ctx.lineTo(xa + wa, pa.y);
      ctx.lineTo(xb + wb, pb.y);
      ctx.lineTo(xb - wb, pb.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 200, 95, 0.25)';
      ctx.fill();
    };
    for (const it of this.items) {
      if (it.type !== 'word') continue;
      if (prev && prev.p !== undefined && prev.p === it.p) {
        if (!runStart) runStart = prev;
      } else {
        if (runStart && prev) ribbon(runStart, prev);
        runStart = null;
      }
      prev = it;
    }
    if (runStart && prev) ribbon(runStart, prev);

    // ------------------------------------------------------------- notes
    // (no text labels — the big escaping word in the scene carries the story)
    for (const it of this.items) {
      if (it.type !== 'word') continue;
      const a = this._at(it.t);
      const x = this._laneX(a, -1);
      const r = (4 + 6 * a.s) * (it.t > 0.92 ? 1.18 : 1);
      // gem: hot core, gold body, dark rim
      ctx.shadowColor = 'rgba(255, 205, 100, 0.95)';
      ctx.shadowBlur = 5 + 12 * a.s;
      const gem = ctx.createRadialGradient(x, a.y - r * 0.3, 0, x, a.y, r);
      gem.addColorStop(0, '#fff6da');
      gem.addColorStop(0.55, '#ffd062');
      gem.addColorStop(1, '#b97a18');
      ctx.fillStyle = gem;
      ctx.beginPath(); ctx.arc(x, a.y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(80, 40, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, a.y, r, 0, 7); ctx.stroke();
    }

    for (const it of this.items) {
      if (it.type !== 'food') continue;
      const a = this._at(it.t);
      const wob = it.warn ? Math.sin(this.time * 30) * 2.2 * it.warn : 0;
      const x = this._laneX(a, 1) + wob;
      const r = 3.5 + 5.5 * a.s;
      if (it.warn) {
        const ringT = (this.time * 1.8) % 1;
        ctx.strokeStyle = `rgba(255, 90, 50, ${(1 - ringT) * 0.85 * it.warn})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, a.y, r + 2 + ringT * 10, 0, 7); ctx.stroke();
      }
      ctx.shadowColor = 'rgba(255, 80, 45, 0.85)';
      ctx.shadowBlur = it.warn ? 12 : 6;
      const gem = ctx.createRadialGradient(x, a.y - r * 0.3, 0, x, a.y, r);
      gem.addColorStop(0, '#ffd9c8');
      gem.addColorStop(0.45, it.color || '#c84a30');
      gem.addColorStop(1, '#54150a');
      ctx.fillStyle = gem;
      ctx.beginPath(); ctx.arc(x, a.y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 245, 235, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, a.y, r, 0, 7); ctx.stroke();
      // inside the chew zone: a green halo says THIS is the bite
      if (it.inZone) {
        ctx.strokeStyle = 'rgba(140, 250, 190, 0.95)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(110, 250, 180, 0.9)';
        ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(x, a.y, r + 3.5, 0, 7); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // ------------------------------------------------------- strike line
    let wordNear = 0, foodNear = 0;
    for (const it of this.items) {
      if (it.type !== 'word' && it.type !== 'food') continue;
      const n = (it.t - 0.72) / 0.28;
      if (n > 0) {
        if (it.type === 'word') wordNear = Math.max(wordNear, n);
        else foodNear = Math.max(foodNear, n);
      }
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const lit = Math.max(wordNear, foodNear);
    ctx.strokeStyle = `rgba(255, 244, 224, ${0.65 + 0.35 * lit})`;
    ctx.lineWidth = 3 + lit * 2;
    ctx.shadowColor = wordNear >= foodNear
      ? 'rgba(255, 200, 90, 0.95)'
      : 'rgba(255, 75, 40, 0.95)';
    ctx.shadowBlur = 8 + lit * 14;
    ctx.beginPath();
    ctx.moveTo(near.cx - near.hw - 4, near.y);
    ctx.lineTo(near.cx + near.hw + 4, near.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // receptors on the strike line: lips for words, teeth for food
    const rxW = this._laneX(near, -1), rxF = this._laneX(near, 1);
    // word receptor — lips that part when a word is coming
    const gape = 2.5 + wordNear * 5 * pulse;
    ctx.strokeStyle = wordNear
      ? `rgba(255, 206, 100, ${0.6 + 0.4 * wordNear})`
      : 'rgba(255, 226, 170, 0.6)';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = wordNear ? 10 : 3;
    ctx.beginPath(); ctx.arc(rxW, near.y, 11, 0, 7); ctx.stroke();
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(rxW - 7, near.y);
      ctx.quadraticCurveTo(rxW, near.y + dir * Math.max(gape, 1.2), rxW + 7, near.y);
      ctx.stroke();
    }
    // food receptor — a tooth clamp
    ctx.strokeStyle = foodNear
      ? `rgba(255, 100, 60, ${0.6 + 0.4 * foodNear})`
      : 'rgba(255, 150, 120, 0.55)';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = foodNear ? 10 : 3;
    ctx.beginPath(); ctx.arc(rxF, near.y, 11, 0, 7); ctx.stroke();
    const bite = foodNear * pulse * 2;
    ctx.beginPath();
    ctx.moveTo(rxF - 6, near.y - 3 + bite);
    for (let k = 0; k < 3; k++) {
      ctx.lineTo(rxF - 4 + k * 4, near.y + 1 + bite);
      ctx.lineTo(rxF - 2 + k * 4, near.y - 3 + bite);
    }
    ctx.moveTo(rxF - 6, near.y + 4 - bite);
    ctx.lineTo(rxF + 6, near.y + 4 - bite);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ------------------------------------------------- strike feedback
    ctx.globalAlpha = 1;
    for (const f of this.flashes) {
      const k = f.age / 0.5;
      const x = f.kind === 'hit' ? rxW : rxW; // word verdicts land on the lips
      const col = f.kind === 'hit'
        ? `rgba(255, 220, 130, ${(1 - k) * 0.95})`
        : `rgba(255, 70, 40, ${(1 - k) * 0.95})`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(x, near.y, 11 + k * 26, 0, 7);
      ctx.stroke();
    }
  }
}
