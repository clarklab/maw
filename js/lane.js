// MAW — the exit lane. A rhythm-game note highway on the left edge of the
// screen: everything heading for the lips rides this vertical track toward
// the hit line at the top. Gold notes are words (mouth OPEN on the beat) —
// the next few carry their text so you can read the story coming. Phrase
// runs are beamed like sustains; the breath gaps between them are marked
// as BITE windows. Food rides a parallel rail with warning rings before it
// lunges. The whole thing sits on a dark glass strip so it reads against
// the bright aperture.

const LANE_X = 46;          // centre of the lane, css px from the left
const LANE_W = 58;          // width of the glass strip
const WORD_X = LANE_X - 12; // words ride the left rail…
const FOOD_X = LANE_X + 14; // …food rides the right
const LABEL_X = LANE_X + LANE_W / 2 + 8; // upcoming-word text
const TOP_F = 0.20;         // hit line, fraction of viewport height
const BOT_F = 0.78;         // larynx end of the track

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

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 150;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // items: [{ type: 'word', t, p?, word? } | { type: 'food', t, color?, warn? }
  //         | { type: 'gap', t0, t1 } | { type: 'tick', t }]
  set(items, active) {
    this.items = items;
    this.targetAlpha = active && items.length ? 1 : 0;
  }

  // Gate feedback ring: gold burst on a word out, red on a muffle.
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

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.alpha < 0.02 && !this.flashes.length) return;

    const yTop = this.h * TOP_F;
    const yBot = this.h * BOT_F;
    const yAt = (t) => yBot + (yTop - yBot) * Math.min(Math.max(t, 0), 1);
    ctx.globalAlpha = this.alpha;
    ctx.lineCap = ctx.lineJoin = 'round';

    // ---- the glass strip the highway lives on
    const gx = LANE_X - LANE_W / 2;
    const strip = ctx.createLinearGradient(gx, 0, gx + LANE_W, 0);
    strip.addColorStop(0, 'rgba(12, 4, 4, 0.0)');
    strip.addColorStop(0.25, 'rgba(12, 4, 4, 0.42)');
    strip.addColorStop(0.75, 'rgba(12, 4, 4, 0.42)');
    strip.addColorStop(1, 'rgba(12, 4, 4, 0.0)');
    ctx.fillStyle = strip;
    ctx.fillRect(gx, yTop - 34, LANE_W, yBot - yTop + 52);

    // rails
    for (const [x, col] of [
      [WORD_X, 'rgba(255, 226, 170, 0.22)'],
      [FOOD_X, 'rgba(255, 140, 110, 0.18)'],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, yBot);
      ctx.lineTo(x, yTop);
      ctx.stroke();
    }

    // moving second-gridlines — the conveyor's tempo
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.13)';
    ctx.lineWidth = 1;
    for (const it of this.items) {
      if (it.type !== 'tick') continue;
      const y = yAt(it.t);
      ctx.beginPath();
      ctx.moveTo(gx + 6, y);
      ctx.lineTo(gx + LANE_W - 6, y);
      ctx.stroke();
    }

    // ---- bite windows: breath gaps — the safe moments to chomp
    for (const it of this.items) {
      if (it.type !== 'gap') continue;
      const ya = yAt(it.t0), yb = yAt(it.t1);
      const top = Math.min(ya, yb);
      const hgt = Math.abs(yb - ya);
      if (hgt < 6) continue;
      ctx.fillStyle = 'rgba(110, 220, 165, 0.30)';
      ctx.strokeStyle = 'rgba(150, 245, 190, 0.9)';
      ctx.lineWidth = 2;
      this._round(gx + 4, top, LANE_W - 8, hgt, 5);
      ctx.fill();
      ctx.stroke();
      if (hgt > 20) {
        ctx.shadowColor = 'rgba(0, 40, 20, 0.9)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = 'rgba(195, 255, 220, 1)';
        ctx.font = '700 10px Futura, "Avenir Next", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('B I T E', LANE_X, top + hgt / 2 + 3.5);
        ctx.shadowBlur = 0;
      }
    }

    // ---- phrase sustains: hold the mouth open through the whole bar
    let runStart = null, prev = null;
    const closeRun = (a, b) => {
      const ya = yAt(a.t), yb = yAt(b.t);
      ctx.fillStyle = 'rgba(255, 206, 100, 0.20)';
      this._round(WORD_X - 5, yb - 5, 10, ya - yb + 10, 5);
      ctx.fill();
    };
    for (const it of this.items) {
      if (it.type !== 'word') continue;
      if (prev && prev.p !== undefined && prev.p === it.p) {
        if (!runStart) runStart = prev;
      } else {
        if (runStart && prev) closeRun(runStart, prev);
        runStart = null;
      }
      prev = it;
    }
    if (runStart && prev) closeRun(runStart, prev);

    // ---- word notes, with the next few words readable as text
    let labeled = 0;
    for (const it of this.items) {
      if (it.type !== 'word') continue;
      const y = yAt(it.t);
      const near = Math.max(0, (it.t - 0.45) / 0.55);
      const r = 5 + near * 4;
      ctx.shadowColor = 'rgba(255, 214, 120, 0.95)';
      ctx.shadowBlur = 5 + near * 11;
      ctx.fillStyle = near > 0.8 ? '#ffe9b0' : '#ffd878';
      ctx.beginPath(); ctx.arc(WORD_X, y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff8ea';
      ctx.beginPath(); ctx.arc(WORD_X, y, r * 0.42, 0, 7); ctx.fill();
      // the story you're about to tell, riding the lane
      if (it.word && labeled < 4 && it.t > 0.25) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = 5;
        ctx.fillStyle = `rgba(255, 240, 214, ${0.6 + 0.4 * near})`;
        ctx.font = `italic ${11 + near * 2}px Georgia, serif`;
        ctx.textAlign = 'left';
        ctx.fillText(it.word, LABEL_X, y + 4);
        ctx.shadowBlur = 0;
        labeled++;
      }
    }

    // ---- food notes on their rail
    for (const it of this.items) {
      if (it.type !== 'food') continue;
      const y = yAt(it.t);
      const wob = it.warn ? Math.sin(this.time * 30) * 2 * it.warn : 0;
      if (it.warn) {
        const ringT = (this.time * 1.8) % 1;
        ctx.strokeStyle = `rgba(255, 90, 50, ${(1 - ringT) * 0.85 * it.warn})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 8 + ringT * 10, 0, 7); ctx.stroke();
      }
      ctx.shadowColor = 'rgba(255, 90, 50, 0.8)';
      ctx.shadowBlur = it.warn ? 11 : 6;
      ctx.fillStyle = it.color || '#c84a30';
      ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 6.5, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 245, 235, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(FOOD_X + wob, y, 6.5, 0, 7); ctx.stroke();
    }

    // ---- the hit line + lip gate
    let wordNear = 0, foodNear = 0;
    for (const it of this.items) {
      if (it.type !== 'word' && it.type !== 'food') continue;
      const near = (it.t - 0.72) / 0.28;
      if (near > 0) {
        if (it.type === 'word') wordNear = Math.max(wordNear, near);
        else foodNear = Math.max(foodNear, near);
      }
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const lit = Math.max(wordNear, foodNear);
    ctx.strokeStyle = `rgba(255, 244, 224, ${0.5 + 0.4 * lit})`;
    ctx.lineWidth = 2 + lit * 1.5;
    ctx.shadowColor = wordNear >= foodNear
      ? 'rgba(255, 206, 100, 0.9)'
      : 'rgba(255, 80, 45, 0.9)';
    ctx.shadowBlur = 4 + lit * 12;
    ctx.beginPath();
    ctx.moveTo(gx + 3, yTop);
    ctx.lineTo(gx + LANE_W - 3, yTop);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // the lips on the hit line: they part for words, clamp for food
    const gape = 3.5 + wordNear * 5 * pulse - foodNear * 2.5;
    const lipGlow = wordNear >= foodNear
      ? `rgba(255, 206, 100, ${0.45 + 0.55 * wordNear})`
      : `rgba(255, 90, 50, ${0.45 + 0.55 * foodNear})`;
    ctx.strokeStyle = lit ? lipGlow : 'rgba(255, 240, 220, 0.6)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = lit ? 10 : 0;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(LANE_X - 15, yTop - 20);
      ctx.quadraticCurveTo(LANE_X, yTop - 20 + dir * Math.max(gape, 1.5), LANE_X + 15, yTop - 20);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // verdicts above the gate: chevrons = open up; tooth clamp = bite down
    if (wordNear > 0.05) {
      ctx.strokeStyle = `rgba(255, 214, 120, ${0.5 + 0.5 * wordNear * pulse})`;
      ctx.lineWidth = 2.5;
      for (let c = 0; c < 2; c++) {
        const y = yTop - 36 - c * 9 - wordNear * pulse * 3;
        ctx.beginPath();
        ctx.moveTo(LANE_X - 7, y + 5);
        ctx.lineTo(LANE_X, y);
        ctx.lineTo(LANE_X + 7, y + 5);
        ctx.stroke();
      }
    }
    if (foodNear > 0.05) {
      ctx.strokeStyle = `rgba(255, 110, 70, ${0.5 + 0.5 * foodNear * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const y = yTop - 40;
      ctx.moveTo(LANE_X - 12, y);
      for (let k = 0; k < 4; k++) {
        ctx.lineTo(LANE_X - 9 + k * 6, y + 6);
        ctx.lineTo(LANE_X - 6 + k * 6, y);
      }
      ctx.stroke();
    }

    // ---- gate feedback rings
    ctx.globalAlpha = 1;
    for (const f of this.flashes) {
      const k = f.age / 0.5;
      const col = f.kind === 'hit'
        ? `rgba(255, 220, 130, ${(1 - k) * 0.95})`
        : `rgba(255, 70, 40, ${(1 - k) * 0.95})`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(f.kind === 'hit' ? WORD_X : LANE_X, yTop, 7 + k * 26, 0, 7);
      ctx.stroke();
    }
  }

  _round(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
