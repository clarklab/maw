// MAW — the cleaning lasso. When food is stuck in your teeth you long-press
// into bullet time and circle the morsel with a second finger. This module
// owns the screen-space Canvas2D layer above the WebGL scene: the glowing
// pencil trail under the finger, the hit test, and the snap — the loose
// hand-drawn loop tightening onto the morsel's exact projected silhouette
// and glowing before the piece poofs.

import * as THREE from 'three';

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Andrew's monotone chain convex hull.
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Resample a closed loop to n evenly spaced points (by arc length).
function resampleClosed(pts, n) {
  const m = pts.length;
  const cum = [0];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  if (total < 1e-3) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total;
    while (cum[seg + 1] < d) seg++;
    const a = pts[seg % m], b = pts[(seg + 1) % m];
    const t = (d - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-6);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const SNAP_N = 96;        // points per loop during the morph
const MORPH_S = 0.30;     // loose loop → silhouette
const GLOW_S = 0.28;      // hold the glow on the exact bounds
const FADE_S = 0.40;      // outline dissolves with the poof

export class Lasso {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stroke = null;   // active trail: [{x, y}, …]
    this.fades = [];      // dying trails: { pts, life, max }
    this.snap = null;     // success morph: { from, to, phase, … }
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // ------------------------------------------------------------ the stroke

  start(x, y) { this.stroke = [{ x, y }]; }

  add(x, y) {
    if (!this.stroke) return;
    const last = this.stroke[this.stroke.length - 1];
    if (Math.hypot(x - last.x, y - last.y) > 2.5) this.stroke.push({ x, y });
  }

  end() {
    const pts = this.stroke;
    this.stroke = null;
    return pts;
  }

  cancel() {
    if (this.stroke) this.fizzle(this.stroke);
    this.stroke = null;
  }

  // A miss — the trail fizzles out where it was drawn.
  fizzle(pts) {
    if (pts && pts.length > 1) this.fades.push({ pts, life: 0.45, max: 0.45 });
  }

  reset() {
    this.stroke = null;
    this.fades.length = 0;
    this.snap = null;
  }

  // --------------------------------------------------- screen-space queries

  _toScreen(v) {
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h };
  }

  // Did the drawn loop encircle the mesh's centre on screen?
  encloses(pts, mesh, camera) {
    if (!pts || pts.length < 8 || pathLength(pts) < 80) return false;
    mesh.updateWorldMatrix(true, false);
    const v = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).project(camera);
    if (v.z > 1) return false; // behind the camera
    const c = this._toScreen(v);
    return pointInPolygon(c.x, c.y, pts);
  }

  // The mesh's exact projected silhouette: convex hull of its vertices on
  // screen, inflated a few pixels so the highlight rings it.
  hullOf(mesh, camera, inflate = 6) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    const pts = [];
    const step = Math.max(1, Math.floor(pos.count / 220));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera);
      pts.push(this._toScreen(v));
    }
    const hull = convexHull(pts);
    if (hull.length < 3) return hull;
    let cx = 0, cy = 0;
    for (const p of hull) { cx += p.x; cy += p.y; }
    cx /= hull.length; cy /= hull.length;
    return hull.map((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * inflate, y: p.y + (dy / d) * inflate };
    });
  }

  // ---------------------------------------------------------------- the snap

  // Morph the drawn loop onto the silhouette, glow, call onPeak (the poof),
  // then fade. Returns false if the target is degenerate.
  snapTo(fromPts, hullPts, onPeak) {
    if (!fromPts || fromPts.length < 3 || !hullPts || hullPts.length < 3) return false;
    const from = resampleClosed(fromPts, SNAP_N);
    let to = resampleClosed(hullPts, SNAP_N);
    if (signedArea(from) * signedArea(to) < 0) to.reverse();
    // rotate the target's start point to minimise travel during the morph
    let best = 0, bestD = Infinity;
    for (let k = 0; k < SNAP_N; k += 2) {
      let d = 0;
      for (let i = 0; i < SNAP_N; i += 4) {
        const a = from[i], b = to[(i + k) % SNAP_N];
        d += (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
      }
      if (d < bestD) { bestD = d; best = k; }
    }
    to = to.slice(best).concat(to.slice(0, best));
    this.snap = { from, to, phase: 'morph', t: 0, onPeak };
    return true;
  }

  // ------------------------------------------------------------- frame tick

  update(dt) {
    for (let i = this.fades.length - 1; i >= 0; i--) {
      this.fades[i].life -= dt;
      if (this.fades[i].life <= 0) this.fades.splice(i, 1);
    }
    const s = this.snap;
    if (!s) return;
    s.t += dt / (s.phase === 'morph' ? MORPH_S : s.phase === 'glow' ? GLOW_S : FADE_S);
    if (s.t >= 1) {
      s.t = 0;
      if (s.phase === 'morph') {
        s.phase = 'glow';
      } else if (s.phase === 'glow') {
        s.phase = 'fade';
        if (s.onPeak) { const cb = s.onPeak; s.onPeak = null; cb(); }
      } else {
        this.snap = null;
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.stroke && !this.fades.length && !this.snap) return;
    ctx.lineJoin = ctx.lineCap = 'round';

    for (const f of this.fades) {
      this._glowStroke(f.pts, false, 0.85 * (f.life / f.max), 1);
    }

    if (this.stroke && this.stroke.length > 1) {
      this._glowStroke(this.stroke, false, 0.9, 1);
      // the pencil tip — a hot little spark under the finger
      const tip = this.stroke[this.stroke.length - 1];
      const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 15);
      g.addColorStop(0, 'rgba(255, 250, 230, 0.95)');
      g.addColorStop(0.35, 'rgba(255, 214, 120, 0.5)');
      g.addColorStop(1, 'rgba(255, 214, 120, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }

    const s = this.snap;
    if (s) {
      let pts = s.to, alpha = 1, intensity = 1.5;
      if (s.phase === 'morph') {
        const t = easeOutCubic(s.t);
        pts = s.from.map((p, i) => ({
          x: p.x + (s.to[i].x - p.x) * t,
          y: p.y + (s.to[i].y - p.y) * t,
        }));
        intensity = 1 + t * 0.6;
      } else if (s.phase === 'glow') {
        intensity = 1.6 + 0.8 * Math.sin(s.t * Math.PI);
      } else {
        alpha = 1 - s.t;
        intensity = 1.8 * alpha;
      }
      this._glowStroke(pts, true, alpha, intensity);
    }
  }

  _glowStroke(pts, close, alpha, intensity) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (close) ctx.closePath();
    // halo
    ctx.shadowColor = `rgba(255, 216, 130, ${0.9 * alpha})`;
    ctx.shadowBlur = 16 * intensity;
    ctx.strokeStyle = `rgba(255, 196, 90, ${0.55 * alpha})`;
    ctx.lineWidth = 6 * intensity;
    ctx.stroke();
    // hot core
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 250, 232, ${0.95 * alpha})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
}
