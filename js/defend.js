// MAW — DEFEND YOURSELF: the bonus round where the table turns. Mid-story
// the mouth slips into a coughing fit and the camera is blasted out past
// the lips: for ten seconds you are the dinner guest across the table,
// nose to nose with somebody else's mouth — lips, teeth, nose-tip and
// chin — as it sprays its half-chewed konoba order straight at you.
// Circle a morsel mid-air to swat it down; swipe left or right to lean
// out of the line of fire. The story holds its breath; the coughing and
// smacking, regrettably, do not.

import * as THREE from 'three';
import { MOUTH } from './anatomy.js';
import { FOODS } from './story.js';
import { foodGeometry, foodMaterial } from './game.js';
import { buildGuestFace } from './face.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const ENTER_S = 1.15;     // coughed out through the lips
const EXIT_S = 1.0;       // ducking back inside
const LAUNCH_SPAN = 5.2;  // the volley is spread over this many seconds
const GRAVITY = 1.8;      // gentle — spittle arcs, not cannonballs
const HIT_R = 0.9;        // how close a morsel must pass to splat your face
const LEAN = 1.7;         // how far a dodge throws your head sideways

// Where the dinner guest sits: across the table, far enough back that the
// whole face — brows, eyes, nose, mouth, chin — fills the frame.
const OUT_POS = new THREE.Vector3(0, 0.6, 13.0);
const OUT_LOOK = new THREE.Vector3(0, 1.1, 6.2);

// The cough-flight: duck under the incisors, out past the cheek, then the
// whip-around that turns the mouth you were into the mouth you face.
const FLY_POS = [
  MOUTH.cameraPos.clone(),
  new THREE.Vector3(0, -0.95, 5.2),
  new THREE.Vector3(2.1, 0.0, 11.6),
  OUT_POS.clone(),
];
const FLY_LOOK = [
  MOUTH.cameraLook.clone(),
  new THREE.Vector3(0, -0.4, 16),
  OUT_LOOK.clone(),
];

function cubic(p0, p1, p2, p3, t, out) {
  const it = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, it * it * it)
    .addScaledVector(p1, 3 * it * it * t)
    .addScaledVector(p2, 3 * it * t * t)
    .addScaledVector(p3, t * t * t);
}

function quad(p0, p1, p2, t, out) {
  const it = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, it * it)
    .addScaledVector(p1, 2 * it * t)
    .addScaledVector(p2, t * t);
}

// ============================================================ DefendRound ==

export class DefendRound {
  constructor({ scene, mouth, ui, audio, lasso, camera }) {
    this.scene = scene;
    this.mouth = mouth;
    this.ui = ui;
    this.audio = audio;
    this.lasso = lasso;
    this.camera = camera;
    this.game = null; // wired by Game.attachDefend

    this.phase = 'idle'; // idle | enter | active | exit
    this.t = 0;
    this.time = 0;
    this.jawTarget = MOUTH.maxJawAngle * 0.6;

    this.lean = 0;
    this.leanDir = 0;
    this.dodgeTimer = 0;
    this.coughPulse = 0;
    this.smackPulse = 0;
    this.shake = 0;

    this.foods = [];
    this.total = 0;
    this.launched = 0;
    this.stats = { blocked: 0, dodged: 0, splats: 0 };
    this.camPos = OUT_POS.clone();

    this.pointerId = null;
    this.gesture = null;

    this._launchTimer = 0;
    this._smackTimer = 0;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    // the dinner guest — the fully sculpted head the player wears.
    // Its lights stay in the scene permanently (a light-count change would
    // recompile every shader mid-game); setLit just turns them up.
    this.faceRig = buildGuestFace();
    this.face = this.faceRig.group;
    scene.add(this.face);
    scene.add(this.faceRig.lights);
  }

  get active() { return this.phase === 'active'; }

  begin() {
    this.phase = 'enter';
    this.t = 0;
    this.total = 7 + ((Math.random() * 6) | 0); // 7–12 pieces
    this.launched = 0;
    this.stats = { blocked: 0, dodged: 0, splats: 0 };
    this.lean = 0;
    this.dodgeTimer = 0;
    this.coughPulse = 1;
    this.smackPulse = 0;
    this.shake = 0.6;
    this.camPos.copy(OUT_POS);
    this.face.visible = true;
    this.faceRig.setLit(true);
    this.jawTarget = MOUTH.maxJawAngle * 0.95;
    this.ui.defendBanner(true);
    this.audio.cough(1.2);
  }

  reset() {
    this.phase = 'idle';
    this.pointerId = null;
    this.gesture = null;
    this.lean = 0;
    this._removeFoods();
    this.face.visible = false;
    this.faceRig.setLit(false);
    this.ui.defendBanner(false);
  }

  // ------------------------------------------------------------------ input

  pointerDown(id, x, y) {
    if (this.phase !== 'active' || this.pointerId !== null) return;
    this.pointerId = id;
    this.gesture = {
      x0: x, y0: y, lx: x, ly: y,
      t0: performance.now(), prevAng: null, turn: 0,
      circle: false, done: false,
    };
    this.lasso.start(x, y);
  }

  pointerMove(id, x, y) {
    if (id !== this.pointerId || !this.gesture || this.gesture.done) return;
    const g = this.gesture;
    const sx = x - g.lx, sy = y - g.ly;
    if (Math.hypot(sx, sy) < 4) return;
    // accumulate heading change — circles turn, swipes don't
    const ang = Math.atan2(sy, sx);
    if (g.prevAng !== null) {
      let d = ang - g.prevAng;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.turn += Math.abs(d);
      if (g.turn > 0.5) g.circle = true;
    }
    g.prevAng = ang;
    g.lx = x; g.ly = y;

    const dx = x - g.x0, dy = y - g.y0;
    if (!g.circle && performance.now() - g.t0 < 240
      && Math.abs(dx) > 90 && Math.abs(dx) > 2 * Math.abs(dy)) {
      // a fast straight horizontal flick — that's a dodge, not a circle
      g.done = true;
      this.lasso.cancel();
      this.dodge(Math.sign(dx));
      return;
    }
    this.lasso.add(x, y);
    this._tryEnclose();
  }

  // Returns true if the lift belonged to this round.
  pointerUp(id) {
    if (id !== this.pointerId) return false;
    if (this.gesture && !this.gesture.done) {
      const pts = this.lasso.end();
      this.lasso.fizzle(pts);
      if (this.audio.fizzle && pts && pts.length > 8) this.audio.fizzle();
    }
    this.pointerId = null;
    this.gesture = null;
    return true;
  }

  dodge(dir) {
    if (this.phase !== 'active') return;
    this.leanDir = Math.sign(dir) || 1;
    this.dodgeTimer = 0.6;
    this.audio.wordPass(); // the whoosh of a near thing
  }

  _tryEnclose() {
    const pts = this.lasso.stroke;
    if (!pts || pts.length < 8) return;
    for (const f of this.foods) {
      if (f.state !== 'fly') continue;
      if (f.mesh.position.z > this.camPos.z - 0.7) continue; // too late — duck!
      if (this.lasso.encloses(pts, f.mesh, this.camera)) {
        this._block(f);
        return;
      }
    }
  }

  // ------------------------------------------------------------- the volley

  _launchFood() {
    this.launched++;
    this.coughPulse = 1;
    this.shake = Math.max(this.shake, 0.5);
    this.audio.cough(0.7 + Math.random() * 0.5);

    const spec = FOODS[(Math.random() * FOODS.length) | 0];
    const mesh = new THREE.Mesh(foodGeometry(spec, Math.random), foodMaterial(spec));
    mesh.castShadow = true;
    mesh.scale.setScalar(spec.radius * 1.05);
    mesh.position.set((Math.random() - 0.5) * 2.0, -0.5 + Math.random() * 0.5, 4.9);
    this.scene.add(mesh);

    // aimed at wherever your face is right now — move it or wear it
    const T = 1.7 + Math.random() * 0.6;
    const aim = this._v1.set(
      this.camPos.x + (Math.random() - 0.5) * 1.2,
      this.camPos.y + (Math.random() - 0.5) * 0.8,
      this.camPos.z
    );
    const vel = aim.clone().sub(mesh.position).divideScalar(T);
    vel.y += 0.5 * GRAVITY * T; // arc compensation

    this.foods.push({
      spec, mesh, vel, state: 'fly',
      spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
    });
    // spittle at the lips
    if (this.game) this.game._burst(this._v2.set(mesh.position.x * 0.5, -0.2, 5.7), 0xd9a0a0, 4);
  }

  _updateFoods(dt) {
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      const p = f.mesh.position;
      f.vel.y -= GRAVITY * dt;
      p.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;

      if (f.state === 'fly' && p.z >= this.camPos.z - 0.45) {
        const miss = Math.hypot(p.x - this.camPos.x, p.y - this.camPos.y);
        if (miss < HIT_R) {
          this._splat(f, i);
          continue;
        }
        f.state = 'passed';
        this.stats.dodged++;
        this.audio.wordPass(); // it whistles past your ear
        if (this.game) {
          this.game.score += 10;
          this.ui.setScore(this.game.score);
        }
      }
      if (p.z > this.camPos.z + 1.6) {
        this.scene.remove(f.mesh);
        this.foods.splice(i, 1);
      }
    }
  }

  _block(f) {
    const idx = this.foods.indexOf(f);
    if (idx < 0) return;
    const hull = this.lasso.hullOf(f.mesh, this.camera);
    const pts = this.lasso.end();
    if (this.gesture) this.gesture.done = true;
    if (!this.lasso.snapTo(pts, hull, null)) this.lasso.fizzle(pts);

    this.stats.blocked++;
    this.audio.smack();
    this.audio.poof();
    if (this.game) {
      this.game._burst(f.mesh.position, f.spec.juice, 12);
      this.game.score += 20;
      this.ui.setScore(this.game.score);
    }
    this.ui.callout('BLOCKED · +20');
    this.scene.remove(f.mesh);
    this.foods.splice(idx, 1);
  }

  _splat(f, i) {
    this.stats.splats++;
    this.shake = Math.max(this.shake, 1.3);
    this.audio.splat();
    this.audio.cough(0.5);
    this.ui.splat('#' + f.spec.juice.toString(16).padStart(6, '0'));
    if (this.stats.splats === 1) this.ui.callout('RIGHT IN THE FACE', true);
    if (this.game) this.game._burst(f.mesh.position, f.spec.juice, 10);
    this.scene.remove(f.mesh);
    this.foods.splice(i, 1);
  }

  _removeFoods() {
    for (const f of this.foods) this.scene.remove(f.mesh);
    this.foods.length = 0;
  }

  _finish() {
    this.phase = 'exit';
    this.t = 0;
    this._removeFoods();
    if (this.pointerId !== null && this.gesture && !this.gesture.done) this.lasso.cancel();
    this.pointerId = null;
    this.gesture = null;
    this.audio.smack(); // the napkin moment

    const { blocked, splats } = this.stats;
    if (splats === 0) {
      if (this.game) {
        this.game.score += 100;
        this.ui.setScore(this.game.score);
      }
      this.ui.callout('SPOTLESS · +100');
    } else {
      this.ui.callout(
        `${blocked} BLOCKED · ${splats} SPLAT${splats === 1 ? '' : 'S'}`,
        splats > blocked
      );
    }
  }

  // ------------------------------------------------------------- frame tick

  update(dt) {
    if (this.phase === 'idle') return;
    this.t += dt;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.coughPulse = Math.max(0, this.coughPulse - dt * 2.8);
    this.smackPulse = Math.max(0, this.smackPulse - dt * 5);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    const leanTarget = this.dodgeTimer > 0 ? this.leanDir * LEAN : 0;
    this.lean = lerp(this.lean, leanTarget, 1 - Math.exp(-dt * 9));

    if (this.phase === 'enter') {
      this.jawTarget = MOUTH.maxJawAngle * 0.95; // coughed out through wide-open lips
      if (this.t >= ENTER_S) {
        this.phase = 'active';
        this.t = 0;
        this._launchTimer = 0.35;
        this._smackTimer = 0.6;
      }
    } else if (this.phase === 'active') {
      // the fit: jaw spasms open on every cough, smacks shut between
      this.jawTarget = MOUTH.maxJawAngle *
        clamp(0.32 + 0.66 * this.coughPulse - 0.5 * this.smackPulse, 0.06, 1);

      if (this.launched < this.total) {
        this._launchTimer -= dt;
        if (this._launchTimer <= 0) {
          this._launchFood();
          this._launchTimer = (LAUNCH_SPAN / this.total) * (0.7 + Math.random() * 0.6);
        }
      }
      this._smackTimer -= dt;
      if (this._smackTimer <= 0) {
        this.audio.smack();
        this.smackPulse = 1;
        this._smackTimer = 0.5 + Math.random() * 0.75;
      }
      this._updateFoods(dt);
      if ((this.launched >= this.total && this.foods.length === 0)
        || this.t > LAUNCH_SPAN + 4) {
        this._finish();
      }
    } else if (this.phase === 'exit') {
      this.jawTarget = MOUTH.maxJawAngle * lerp(0.7, 0.5, this.t / EXIT_S);
      if (this.t >= EXIT_S) {
        this.phase = 'idle';
        this.face.visible = false;
        this.faceRig.setLit(false);
        this._removeFoods();
      }
    }

    if (this.face.visible) {
      // the guest's eyes lock onto whichever morsel is closest to landing
      let look = null, best = Infinity;
      for (const f of this.foods) {
        if (f.state !== 'fly') continue;
        const d = this.camPos.z - f.mesh.position.z;
        if (d > 0.5 && d < best) { best = d; look = f.mesh.position; }
      }
      this.faceRig.update(dt, {
        jaw: this.mouth.state.jawAngle,
        cough: this.coughPulse,
        look: look || this.camPos,
      });
    }
  }

  // The guest's eye. Owns the camera while the round runs.
  cameraPose(camera) {
    let s = 1;
    if (this.phase === 'enter') s = sstep(0, 1, this.t / ENTER_S);
    else if (this.phase === 'exit') s = 1 - sstep(0, 1, this.t / EXIT_S);

    const pos = this._v1, look = this._v2;
    if (s < 1) {
      cubic(FLY_POS[0], FLY_POS[1], FLY_POS[2], FLY_POS[3], s, pos);
      quad(FLY_LOOK[0], FLY_LOOK[1], FLY_LOOK[2], s, look);
    } else {
      // seated across the table, leaning out of the spray
      const bob = Math.sin(this.time * 2.1) * 0.04;
      pos.set(
        OUT_POS.x + this.lean + (Math.random() - 0.5) * 0.07 * this.shake,
        OUT_POS.y + bob - Math.abs(this.lean) * 0.07 + (Math.random() - 0.5) * 0.07 * this.shake,
        OUT_POS.z + (Math.random() - 0.5) * 0.04 * this.shake
      );
      look.set(OUT_LOOK.x + this.lean * 0.3, OUT_LOOK.y, OUT_LOOK.z);
    }
    const roll = -this.lean * 0.1 * Math.min(s * 2, 1); // the lean tilts your head
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.position.copy(pos);
    camera.lookAt(look);
    this.camPos.copy(camera.position);
  }
}
