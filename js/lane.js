// MAW — the exit lane. A rhythm-game style telegraph on the left edge of
// the screen: everything heading for the lips rides this vertical track
// toward the exit line at the top. Gold dots are words (you want the mouth
// OPEN when they arrive); colored dots are food (you want it SHUT). A food
// about to lunge winds up with a pulsing ring before it surges.

const TRACK_X = 44;       // css px from the left edge
const WORD_X = TRACK_X - 9;  // words ride the left rail…
const FOOD_X = TRACK_X + 9;  // …food rides the right
const TOP_F = 0.20;       // exit line, fraction of viewport height
const BOT_F = 0.78;       // larynx end of the track

export class Lane {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.flashes = [];   // gate feedback: { kind: 'hit'|'miss', age }
    this.alpha = 0;
    this.targetAlpha = 0;
    this.time = 0;
    this.resize();
  }

  // Gate feedback ring: gold burst on a word out, red on a muffle.
  flash(kind) {
    this.flashes.push({ kind, age: 0 });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 96;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // items: [{ type: 'word'|'food', t: 0..1, color?: '#rrggbb', warn?: 0..1 }]
  set(items, active) {
    this.items = items;
    this.targetAlpha = active && items.length ? 1 : 0;
  }

  update(dt) {
    this.time += dt;
    this.alpha += (this.targetAlpha - this.alpha) * (1 - Math.exp(-dt * 6));
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].age += dt;
      if (this.flashes[i].age > 0.45) this.flashes.splice(i, 1);
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.alpha < 0.02) return;

    const yTop = this.h * TOP_F;
    const yBot = this.h * BOT_F;
    const yAt = (t) => yBot + (yTop - yBot) * Math.min(Math.max(t, 0), 1);
    ctx.globalAlpha = this.alpha;
    ctx.lineCap = 'round';

    // the track, with step ticks marking the climb
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TRACK_X, yBot);
    ctx.lineTo(TRACK_X, yTop);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.24)';
    for (let k = 1; k <= 3; k++) {
      const y = yAt(k / 4);
      ctx.beginPath();
      ctx.moveTo(TRACK_X - 5, y);
      ctx.lineTo(TRACK_X + 5, y);
      ctx.stroke();
    }

    // what's incoming at the gate?
    let wordNear = 0, foodNear = 0;
    for (const it of this.items) {
      const near = (it.t - 0.72) / 0.28;
      if (near > 0) {
        if (it.type === 'word') wordNear = Math.max(wordNear, near);
        else foodNear = Math.max(foodNear, near);
      }
    }

    // the exit: a pair of lip lines that part for words, clamp for food
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const gape = 3.5 + wordNear * 5 * pulse - foodNear * 2.5;
    const lipGlow = wordNear > foodNear
      ? `rgba(255, 206, 100, ${0.35 + 0.6 * wordNear})`
      : `rgba(255, 90, 50, ${0.35 + 0.6 * foodNear})`;
    ctx.strokeStyle = (wordNear || foodNear) ? lipGlow : 'rgba(255, 240, 220, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = (wordNear || foodNear) ? 10 : 0;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(TRACK_X - 16, yTop);
      ctx.quadraticCurveTo(TRACK_X, yTop + dir * Math.max(gape, 1.5), TRACK_X + 16, yTop);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // gate verdicts: chevrons = open up; tooth clamp = bite down
    if (wordNear > 0.05) {
      ctx.strokeStyle = `rgba(255, 214, 120, ${0.5 + 0.5 * wordNear * pulse})`;
      ctx.lineWidth = 2.5;
      for (let c = 0; c < 2; c++) {
        const y = yTop - 16 - c * 9 - wordNear * pulse * 3;
        ctx.beginPath();
        ctx.moveTo(TRACK_X - 7, y + 5);
        ctx.lineTo(TRACK_X, y);
        ctx.lineTo(TRACK_X + 7, y + 5);
        ctx.stroke();
      }
    }
    if (foodNear > 0.05) {
      // a little zigzag of clamped teeth above the gate
      ctx.strokeStyle = `rgba(255, 110, 70, ${0.5 + 0.5 * foodNear * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const y = yTop - 20;
      ctx.moveTo(TRACK_X - 12, y);
      for (let k = 0; k < 4; k++) {
        ctx.lineTo(TRACK_X - 9 + k * 6, y + 6);
        ctx.lineTo(TRACK_X - 6 + k * 6, y);
      }
      ctx.stroke();
    }

    // moving second-gridlines (performance mode) — the conveyor's rhythm
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.10)';
    ctx.lineWidth = 1;
    for (const it of this.items) {
      if (it.type !== 'tick') continue;
      const y = yAt(it.t);
      ctx.beginPath();
      ctx.moveTo(TRACK_X - 14, y);
      ctx.lineTo(TRACK_X + 14, y);
      ctx.stroke();
    }

    // bite windows: the breath gaps between phrases — safe to chomp here
    for (const it of this.items) {
      if (it.type !== 'gap') continue;
      const y0 = yAt(it.t0), y1 = yAt(it.t1);
      if (y1 > y0 - 3) continue; // too small to show
      const grad = ctx.createLinearGradient(0, y1, 0, y0);
      grad.addColorStop(0, 'rgba(150, 235, 185, 0.05)');
      grad.addColorStop(0.5, 'rgba(150, 235, 185, 0.22)');
      grad.addColorStop(1, 'rgba(150, 235, 185, 0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(WORD_X - 8, y1, 16, y0 - y1);
      ctx.strokeStyle = 'rgba(150, 235, 185, 0.55)';
      ctx.lineWidth = 1.6;
      for (const yy of [y0, y1]) {
        ctx.beginPath();
        ctx.moveTo(WORD_X - 8, yy);
        ctx.lineTo(WORD_X + 8, yy);
        ctx.stroke();
      }
      // tiny tooth-zigzag: this is your chance to bite
      const ym = (y0 + y1) / 2;
      ctx.beginPath();
      ctx.moveTo(WORD_X - 6, ym);
      for (let k = 0; k < 3; k++) {
        ctx.lineTo(WORD_X - 4 + k * 4, ym + 4);
        ctx.lineTo(WORD_X - 2 + k * 4, ym);
      }
      ctx.stroke();
    }

    // phrase beams: hold the mouth open through a connected run of words
    let prev = null;
    ctx.lineWidth = 2.5;
    for (const it of this.items) {
      if (it.type !== 'word') continue;
      if (prev && prev.p !== undefined && prev.p === it.p) {
        const ya = yAt(prev.t), yb = yAt(it.t);
        ctx.strokeStyle = 'rgba(255, 206, 100, 0.3)';
        ctx.beginPath();
        ctx.moveTo(WORD_X, ya);
        ctx.lineTo(WORD_X, yb);
        ctx.stroke();
      }
      prev = it;
    }

    // the riders
    for (const it of this.items) {
      if (it.type !== 'word' && it.type !== 'food') continue;
      const y = yAt(it.t);
      if (it.type === 'word') {
        // brighter and bigger as it nears the gate
        const near = Math.max(0, (it.t - 0.55) / 0.45);
        if (near > 0.4) {
          const tail = ctx.createLinearGradient(0, y, 0, y + 26);
          tail.addColorStop(0, `rgba(255, 214, 120, ${0.5 * near})`);
          tail.addColorStop(1, 'rgba(255, 214, 120, 0)');
          ctx.strokeStyle = tail;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(WORD_X, y + 4);
          ctx.lineTo(WORD_X, y + 26);
          ctx.stroke();
        }
        const r = 4 + near * 3;
        ctx.shadowColor = 'rgba(255, 214, 120, 0.9)';
        ctx.shadowBlur = 6 + near * 8;
        ctx.fillStyle = '#ffd878';
        ctx.beginPath(); ctx.arc(WORD_X, y, r, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff8ea';
        ctx.beginPath(); ctx.arc(WORD_X, y, r * 0.4, 0, 7); ctx.fill();
      } else {
        const wob = it.warn ? Math.sin(this.time * 30) * 2 * it.warn : 0;
        if (it.warn) {
          // winding up — pulsing warning ring
          const ringT = (this.time * 1.8) % 1;
          ctx.strokeStyle = `rgba(255, 90, 50, ${(1 - ringT) * 0.8 * it.warn})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 8 + ringT * 9, 0, 7); ctx.stroke();
        }
        ctx.shadowColor = 'rgba(255, 90, 50, 0.7)';
        ctx.shadowBlur = it.warn ? 10 : 6;
        ctx.fillStyle = it.color || '#c84a30';
        ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 6, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 245, 235, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 6, 0, 7); ctx.stroke();
      }
    }

    // gate feedback rings
    for (const f of this.flashes) {
      const k = f.age / 0.45;
      const col = f.kind === 'hit'
        ? `rgba(255, 220, 130, ${(1 - k) * 0.9})`
        : `rgba(255, 70, 40, ${(1 - k) * 0.9})`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(TRACK_X, yTop, 6 + k * 22, 0, 7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
