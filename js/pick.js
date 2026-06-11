// MAW — the toothpick minigame. Something's wedged between your teeth;
// hold your bite to drop into bullet time, then circle the culprit with a
// second finger. The hand-drawn lasso is a glowing pencil stroke; when it
// catches the food, the loose circle snaps to the exact projected
// silhouette of the 3D piece, flares, and the piece poofs.

import * as THREE from 'three';

// ----------------------------------------------------------- pure geometry
// (exported separately so the smoke test can exercise them headless)

// Ray-casting point-in-polygon. The polygon is implicitly closed, which is
// what makes a sloppy, not-quite-joined circle still count.
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Andrew's monotone chain convex hull. points: [[x,y],...] → hull ccw.
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Does the drawn stroke circle the hull? Forgiving on purpose: the stroke
// must be a real gesture (some length) and most of the food must be inside.
export function lassoCatches(stroke, hull) {
  if (stroke.length < 8 || hull.length < 3) return false;
  let len = 0;
  for (let i = 1; i < stroke.length; i++) {
    len += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  }
  if (len < 60) return false;
  let cx = 0, cy = 0;
  for (const p of hull) { cx += p[0]; cy += p[1]; }
  cx /= hull.length; cy /= hull.length;
  if (!pointInPolygon(cx, cy, stroke)) return false;
  let inside = 0;
  for (const p of hull) if (pointInPolygon(p[0], p[1], stroke)) inside++;
  return inside >= hull.length * 0.5;
}

// Project a mesh's geometry into CSS-pixel screen space and return the
// convex hull of the silhouette — "the exact bounds of the 3D piece".
export function projectMeshHull(mesh, camera, width, height) {
  const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
  if (!pos) return null;
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const pts = [];
  const stride = Math.max(1, Math.floor(pos.count / 160));
  for (let i = 0; i < pos.count; i += stride) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera);
    if (v.z > 1) continue; // behind the camera
    pts.push([(v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height]);
  }
  if (pts.length < 3) return null;
  return convexHull(pts);
}

// ------------------------------------------------------------- the overlay

const PENCIL = '#ffe9b0';
const GLOW = 'rgba(255, 214, 120, 0.9)';

export class LassoPicker {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';        // idle | drawing | snap | fail
    this.points = [];
    this.hull = null;
    this.t = 0;
    this.onSnapDone = null;
    this.bulletTime = 0;        // eased 0..1 for the cool-down wash
    this._dpr = 1;
    this.resize();
  }

  resize() {
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * this._dpr;
    this.canvas.height = window.innerHeight * this._dpr;
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
  }

  get drawing() { return this.state === 'drawing'; }

  start(x, y) {
    this.state = 'drawing';
    this.points = [[x, y]];
    this.t = 0;
  }

  move(x, y) {
    if (this.state !== 'drawing') return;
    const last = this.points[this.points.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) > 3) this.points.push([x, y]);
  }

  // Lift the finger: hand the stroke back for the hit test.
  end() {
    if (this.state !== 'drawing') return null;
    this.state = 'idle';
    return this.points;
  }

  cancel() {
    if (this.state === 'drawing' || this.state === 'fail') {
      this.state = 'idle';
      this.points = [];
    }
  }

  // The lasso caught it: the loose stroke snaps to the food's silhouette.
  // getHull is re-queried every frame so the highlight tracks the camera.
  snap(getHull, onDone) {
    this.state = 'snap';
    this.getHull = getHull;
    this.hull = getHull();
    this.t = 0;
    this.onSnapDone = onDone;
  }

  fail() {
    this.state = 'fail';
    this.t = 0;
  }

  setBulletTime(on) { this._bulletTarget = on ? 1 : 0; }

  update(dt) {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    this.bulletTime += ((this._bulletTarget || 0) - this.bulletTime) * Math.min(1, dt * 7);
    ctx.clearRect(0, 0, w, h);

    // cold, held-breath wash while time is slowed
    if (this.bulletTime > 0.01) {
      ctx.fillStyle = `rgba(40, 62, 96, ${0.16 * this.bulletTime})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.state === 'drawing' && this.points.length > 0) {
      this._stroke(this.points, 1, 3.5, 14);
      // bright pencil tip
      const tip = this.points[this.points.length - 1];
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff7df';
      ctx.shadowColor = GLOW;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (this.state === 'snap') {
      this.t += dt;
      const k = Math.min(this.t / 0.45, 1);
      this.hull = (this.getHull && this.getHull()) || this.hull;
      // the highlight tightens onto the silhouette and flares
      const pulse = 1 + Math.sin(k * Math.PI) * 0.4;
      this._stroke(this.hull, 1 - k * 0.25, 3 + pulse * 3, 22 + pulse * 16, true);
      if (k >= 1) {
        this.state = 'idle';
        const cb = this.onSnapDone;
        this.onSnapDone = null;
        if (cb) cb();
      }
    } else if (this.state === 'fail') {
      this.t += dt;
      const k = Math.min(this.t / 0.3, 1);
      this._stroke(this.points, 1 - k, 3.5, 10);
      if (k >= 1) { this.state = 'idle'; this.points = []; }
    }
  }

  _stroke(pts, alpha, width, blur, close = false) {
    if (!pts || pts.length < 2) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PENCIL;
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}
