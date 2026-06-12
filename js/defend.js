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

// Where the dinner guest sits: just across the table, eye to lip.
const OUT_POS = new THREE.Vector3(0, 0.1, 9.9);
const OUT_LOOK = new THREE.Vector3(0, 0.12, 6.15);

// The cough-flight: duck under the incisors, out past the cheek, then the
// whip-around that turns the mouth you were into the mouth you face.
const FLY_POS = [
  MOUTH.cameraPos.clone(),
  new THREE.Vector3(0, -0.95, 5.2),
  new THREE.Vector3(1.9, -0.1, 9.3),
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

// ------------------------------------------------------------------- face
// The outside of the face exists only for these ten seconds: an annular
// skin plate ringing the lip roll — lower nose, philtrum, cheeks, upper
// chin — whose lower half rides the mandible so the coughing fit reads
// from the guest's side of the table too.

const FACE = {
  nu: 96, nv: 24,
  holeRx: 2.55, holeRy: 0.6,    // tucked just behind the lip roll
  outRx: 8.0, outRy: 7.0, outCy: 0.3,
};

const g2 = (dx, dy, sx, sy) => Math.exp(-((dx / sx) * (dx / sx) + (dy / sy) * (dy / sy)));

// Skin relief, modelled as bumps over the base dome (+z is toward the guest).
function faceRelief(x, y) {
  const ax = Math.abs(x);
  let dz = 0;
  // nose: a ridge climbing out of frame, the tip, alar flares, nostril pits
  dz += 0.5 * Math.exp(-((x / 0.55) ** 2)) * sstep(0.7, 1.4, y);
  dz += 0.8 * g2(x, y - 1.7, 0.6, 0.55);
  dz += 0.42 * g2(ax - 0.78, y - 1.18, 0.36, 0.3);
  dz -= 0.3 * g2(ax - 0.4, y - 1.02, 0.17, 0.13);
  // philtrum groove between nose and lip
  dz -= 0.13 * Math.exp(-((x / 0.2) ** 2)) * sstep(0.45, 0.75, y) * (1 - sstep(0.95, 1.2, y));
  // chin boss and the mentolabial crease above it
  dz += 0.85 * g2(x, y + 2.0, 1.15, 0.85);
  dz -= 0.2 * Math.exp(-(((y + 1.32) / 0.3) ** 2)) * Math.exp(-((x / 1.5) ** 2));
  // cheek mass and nasolabial folds
  dz += 0.55 * g2(ax - 3.3, y - 0.5, 1.8, 2.5);
  dz -= 0.1 * g2(ax - 2.55, y + 0.2, 0.28, 1.2);
  return dz;
}

const SKIN = new THREE.Color(0xd2a184);   // matches the shell's lip-roll skin
const VERM = new THREE.Color(0xb05156);
const FLUSH = new THREE.Color(0xc9836b);
const STUBBLE = new THREE.Color(0xb18a6d);
const NOSTRIL = new THREE.Color(0x49201a);
const RIM = new THREE.Color(0x5c4234);

function faceColor(x, y, v, tmp) {
  const ax = Math.abs(x);
  tmp.copy(VERM).lerp(SKIN, sstep(0.0, 0.12, v)); // vermilion ring at the lips
  tmp.lerp(FLUSH, clamp(0.4 * g2(ax - 3.0, y - 0.6, 2.0, 2.4) + 0.3 * g2(x, y - 1.6, 0.8, 0.7), 0, 1));
  tmp.lerp(STUBBLE, 0.4 * sstep(-0.7, -2.2, y));
  tmp.lerp(NOSTRIL, clamp(1.4 * g2(ax - 0.4, y - 1.02, 0.18, 0.14), 0, 1));
  tmp.lerp(RIM, 0.6 * sstep(0.72, 1.0, v)); // fade into the dark of the konoba
  return tmp;
}

function buildFaceGeometry() {
  const { nu, nv } = FACE;
  const count = (nv + 1) * nu;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const tmp = new THREE.Color();

  for (let iv = 0; iv <= nv; iv++) {
    const v = iv / nv;
    const ease = Math.pow(v, 1.2);
    for (let iu = 0; iu < nu; iu++) {
      const th = (iu / nu) * Math.PI * 2;
      let cx = Math.cos(th), cy = Math.sin(th);
      // superellipse — squarer mouth corners, like the shell's rings
      cx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.85);
      cy = Math.sign(cy) * Math.pow(Math.abs(cy), 0.9);
      const x = cx * lerp(FACE.holeRx, FACE.outRx, ease);
      const y = cy * lerp(FACE.holeRy, FACE.outRy, ease) + FACE.outCy * ease;
      let z = 6.32 - 2.9 * Math.pow(ease, 1.6);
      z += faceRelief(x, y) * sstep(0.02, 0.12, v); // relief eases in off the lip ring

      const k = iv * nu + iu;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      faceColor(x, y, v, tmp);
      colors[k * 3] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
      // chin and jawline ride the mandible, fading out toward the ears
      weights[k] = sstep(0.25, -0.55, y) * (1 - 0.6 * sstep(3.4, 7.2, Math.abs(x)));
    }
  }

  const indices = [];
  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * nu + iu;
      const b = iv * nu + (iu + 1) % nu;
      const c = a + nu, d = b + nu;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.userData.base = positions.slice();
  geo.userData.jawWeights = weights;
  return geo;
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
    this._faceJaw = -1;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    this.faceGeo = buildFaceGeometry();
    const skinMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.55, clearcoat: 0.12, clearcoatRoughness: 0.5,
      sheen: 0.25, sheenColor: new THREE.Color(0xffc0a0), envMapIntensity: 0.35,
      side: THREE.DoubleSide,
    });
    this.face = new THREE.Group();
    const plate = new THREE.Mesh(this.faceGeo, skinMat);
    plate.frustumCulled = false;
    this.face.add(plate);
    // candlelight from the guest's side so the face reads against the dark
    const glow = new THREE.PointLight(0xffd9b8, 1.4, 9, 2);
    glow.position.set(0, 0.6, 9.2);
    this.face.add(glow);
    this.face.visible = false;
    scene.add(this.face);
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
    this._faceJaw = -1;
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
    const T = 1.45 + Math.random() * 0.5;
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
        this._removeFoods();
      }
    }

    if (this.face.visible) this._deformFace();
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

  // The chin half of the face plate rides the mandible, like the shell.
  _deformFace() {
    const jaw = this.mouth.state.jawAngle;
    if (Math.abs(jaw - this._faceJaw) < 0.0006) return;
    this._faceJaw = jaw;
    const pos = this.faceGeo.attributes.position;
    const arr = pos.array;
    const base = this.faceGeo.userData.base;
    const weights = this.faceGeo.userData.jawWeights;
    const pivotY = MOUTH.jawPivot.y, pivotZ = MOUTH.jawPivot.z;
    for (let i = 0; i < pos.count; i++) {
      const w = weights[i];
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      if (w < 0.001) {
        arr[i * 3] = bx; arr[i * 3 + 1] = by; arr[i * 3 + 2] = bz;
        continue;
      }
      const ang = jaw * w;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dy = by - pivotY, dz = bz - pivotZ;
      arr[i * 3] = bx;
      arr[i * 3 + 1] = pivotY + dy * ca - dz * sa;
      arr[i * 3 + 2] = pivotZ + dy * sa + dz * ca;
    }
    pos.needsUpdate = true;
    this.faceGeo.computeVertexNormals();
  }
}
