// MAW — gameplay. One input: hold to bite down, release to keep talking.
// Words of the story drift up from the larynx and must escape the lips;
// food gets jostled loose and must NOT. The conflict writes itself.

import * as THREE from 'three';
import { MOUTH, upperLingualSpot } from './anatomy.js';
import { WORDS, FOODS, chapterAt, STORY, WIN_LINES, LOSE_LINES } from './story.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

// ------------------------------------------------------------ word sprites

const wordTexCache = new Map();
function wordTexture(text) {
  if (wordTexCache.has(text)) return wordTexCache.get(text);
  const pad = 28;
  const font = 'italic 86px Georgia, serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = 132;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255, 240, 215, 0.9)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#fdf8ec';
  ctx.fillText(text, w / 2, h / 2 + 4);
  ctx.shadowBlur = 0;
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const entry = { tex, aspect: w / h };
  wordTexCache.set(text, entry);
  return entry;
}

// ------------------------------------------------------------- food meshes

function foodGeometry(spec, rng) {
  let g;
  if (spec.cube) {
    g = new THREE.BoxGeometry(1.5, 1.5, 1.5, 5, 5, 5);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize().multiplyScalar(0.75);
      v.lerp(n, 0.3);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  } else {
    g = new THREE.SphereGeometry(0.78, 22, 18);
  }
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const s1 = rng() * 10, s2 = rng() * 10;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1
      + spec.noise * Math.sin(v.x * 6 + s1) * Math.sin(v.y * 5 + s2)
      + spec.noise * 0.7 * Math.sin(v.z * 9 + s1 * 2);
    let lobe = 1;
    if (spec.lobes) lobe = 1 + 0.12 * Math.sin(Math.atan2(v.z, v.x) * spec.lobes * 2 + s2);
    v.multiplyScalar(n * lobe);
    if (spec.id === 'fig') v.y *= 1.18; // teardrop
    pos.setXYZ(i, v.x, v.y * spec.squash, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function foodMaterial(spec) {
  return new THREE.MeshPhysicalMaterial({
    color: spec.baseColor,
    roughness: spec.rough,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.8,
  });
}

// Arch angles of the gaps between the upper front teeth — candidate spots
// for a morsel to wedge itself into.
const STUCK_ANGLES = [0.16, 0.34, 0.52];
const STUCK_HOLD = 0.55;        // seconds of holding before bullet time
const BULLET_SCALE = 0.12;      // how slow bullet time runs

// =================================================================== Game ==

export class Game {
  constructor({ scene, mouth, ui, audio }) {
    this.scene = scene;
    this.mouth = mouth;
    this.ui = ui;
    this.audio = audio;

    this.state = 'title';
    this.pressed = false;

    // jaw spring
    this.jawAngle = MOUTH.maxJawAngle * 0.55;
    this.jawVel = 0;

    // breath (suffocation while clamped shut)
    this.closedTime = 0;
    this.forcedOpen = 0;

    this.score = 0;
    this.streak = 0;
    this.manners = 3;
    this.wordIndex = 0;

    this.activeWord = null;
    this.foods = [];
    this.particles = [];
    this.escapees = []; // words & food flying off into the world

    this.wordTimer = 2.2;
    this.biteTimer = 4.0;
    this.shake = 0;
    this.timeScale = 1;
    this.endTimer = -1;

    // food stuck in the teeth + bullet time
    this.chompedCount = 0;
    this.nextStuckAt = 5 + ((Math.random() * 6) | 0); // every 5–10 pieces
    this.stuck = null;        // { mesh, spec, highlight }
    this.bulletTime = false;
    this.holdTime = 0;

    this._rng = () => Math.random();

    // shared particle resources
    this._partGeo = new THREE.SphereGeometry(0.07, 6, 5);
    this._salivaMat = new THREE.MeshPhysicalMaterial({
      color: 0xd9a0a0, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85,
    });
  }

  get difficulty() { return clamp(this.wordIndex / WORDS.length, 0, 1); }

  // -------------------------------------------------------------- controls

  pointerDown() { this.pressed = true; }

  pointerUp() {
    this.pressed = false;
    this.holdTime = 0;
    if (this.bulletTime) this._exitBulletTime();
  }

  start() {
    this.state = 'playing';
    this.score = 0;
    this.streak = 1;
    this.manners = 3;
    this.wordIndex = 0;
    this.wordTimer = 2.4;
    this.biteTimer = 1.2;
    this.endTimer = -1;
    this.activeWord = null;
    for (const f of this.foods) this.scene.remove(f.mesh);
    this.foods = [];
    if (this.stuck) { this.scene.remove(this.stuck.mesh); this.stuck = null; }
    this.bulletTime = false;
    this.holdTime = 0;
    this.chompedCount = 0;
    this.nextStuckAt = 5 + ((Math.random() * 6) | 0);
    this.ui.bulletTime(false);
    this.ui.stuckTip(null);
    this.audio.stopStory();
    this.ui.resetStory();
    this.ui.setScore(0);
    this.ui.setManners(3);
    this.ui.showHUD();
  }

  // ------------------------------------------------------------ word logic

  _spawnWord() {
    const text = WORDS[this.wordIndex];
    const { tex, aspect } = wordTexture(text);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: true,
    });
    const sprite = new THREE.Sprite(mat);
    const scale = 0.78 + Math.min(text.length, 9) * 0.015;
    sprite.scale.set(aspect * scale, scale, 1);
    this.scene.add(sprite);

    const duration = lerp(3.4, 2.0, this.difficulty);
    this.activeWord = {
      text, sprite,
      t: 0, duration,
      wobble: Math.random() * Math.PI * 2,
      muffled: false,
    };

    const chapter = chapterAt(this.wordIndex);
    if (chapter) {
      this.ui.chapterToast(chapter.name);
      this.audio.chime();
    }
  }

  // The word's flight path: larynx → over the tongue → out through the lips.
  _wordPos(t, out) {
    const p0 = new THREE.Vector3(0, -0.9, -1.5);
    const p1 = new THREE.Vector3(0, 0.6, 0.6);
    const p2 = new THREE.Vector3(0, 0.1, 4.1);
    const p3 = new THREE.Vector3(0, -0.35, MOUTH.lipsZ + 0.8);
    // cubic bezier
    const it = 1 - t;
    out.set(0, 0, 0)
      .addScaledVector(p0, it * it * it)
      .addScaledVector(p1, 3 * it * it * t)
      .addScaledVector(p2, 3 * it * t * t)
      .addScaledVector(p3, t * t * t);
    out.x += Math.sin(t * 9 + this.activeWord.wobble) * 0.35 * (1 - t);
    out.y += Math.sin(t * 13 + this.activeWord.wobble * 2) * 0.1;
    return out;
  }

  _updateWord(dt) {
    const w = this.activeWord;
    if (!w) {
      this.wordTimer -= dt;
      if (this.wordTimer <= 0 && this.wordIndex < WORDS.length) this._spawnWord();
      return;
    }

    if (w.muffled) {
      // knocked back: sink onto the tongue and dissolve
      w.t -= dt * 1.6;
      w.sprite.material.opacity = Math.max(0, w.sprite.material.opacity - dt * 2.2);
      this._wordPos(Math.max(0.05, w.t), w.sprite.position);
      if (w.sprite.material.opacity <= 0) {
        this.scene.remove(w.sprite);
        this.activeWord = null;
        this.wordTimer = 1.0; // the word tries again shortly
      }
      return;
    }

    w.t += dt / w.duration;
    this._wordPos(Math.min(w.t, 1), w.sprite.position);

    // crossing the lips
    if (w.sprite.position.z >= MOUTH.lipsZ - 0.15) {
      const ap = this.mouth.aperture(this.jawAngle);
      if (ap.open01 > 0.42) {
        // ESCAPED — the story advances
        this._wordEscaped(w);
      } else {
        // MUFFLED
        w.muffled = true;
        this.streak = 1;
        this.audio.muffled();
        this.mouth.kickUvula(1.6, 0.4);
        this.ui.callout('MMMPH', true);
        this.shake = Math.max(this.shake, 0.35);
      }
    }
  }

  _wordEscaped(w) {
    // the narrator speaks the word; it stretches when time is dilated
    this.audio.wordEscape(1 - this.difficulty * 0.25, this.wordIndex, clamp(this.timeScale, 0.5, 1));
    this.ui.appendWord(w.text);
    this.score += 10 * this.streak;
    this.streak = Math.min(this.streak + 1, 5);
    this.ui.setScore(this.score);
    this.mouth.kickUvula(0.8, 0.2);

    this.escapees.push({
      mesh: w.sprite, kind: 'word', life: 1.6,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.6, 9),
    });
    this.activeWord = null;
    this.wordIndex++;
    this.wordTimer = lerp(2.6, 1.3, this.difficulty);

    if (this.wordIndex >= WORDS.length) {
      this.endTimer = 1.6;
    }
  }

  // ------------------------------------------------------------ food logic

  _spawnFood() {
    const spec = FOODS[(Math.random() * FOODS.length) | 0];
    const mesh = new THREE.Mesh(foodGeometry(spec, this._rng), foodMaterial(spec));
    mesh.castShadow = mesh.receiveShadow = true;
    const r = spec.radius;
    mesh.scale.setScalar(r);
    const x = (Math.random() - 0.5) * 1.8;
    const z = 2.6 + Math.random() * 1.6;
    mesh.position.set(x, this.mouth.tongueSurfaceY(x, z) + r + 0.4, z);
    this.scene.add(mesh);

    this.foods.push({
      spec, mesh, r,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1, -1 - Math.random() * 2),
      spin: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2),
      chews: 0,
      state: 'loose',     // loose | swallowing
      urgeTimer: 2.5 + Math.random() * 3,
      blockedAt: -10,
      swallowT: 0,
    });
    this.audio.crunch(0.4);
  }

  _updateFood(dt) {
    // top up the plate
    this.biteTimer -= dt;
    const cap = 1 + Math.round(this.difficulty * 2);
    if (this.biteTimer <= 0 && this.foods.length < cap && this.state === 'playing') {
      this._spawnFood();
      this.biteTimer = lerp(8.5, 4.5, this.difficulty);
    }

    const ap = this.mouth.aperture(this.jawAngle);

    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      const p = f.mesh.position;

      if (f.state === 'swallowing') {
        f.swallowT += dt * 1.5;
        p.lerp(MOUTH.throat, dt * 4);
        f.mesh.scale.multiplyScalar(1 - dt * 1.2);
        if (f.swallowT >= 1) {
          this.scene.remove(f.mesh);
          this.foods.splice(i, 1);
          this.audio.gulp();
          this.mouth.triggerSwallow();
          this.score += 25;
          this.ui.setScore(this.score);
          this.ui.callout('GULP · +25');
        }
        continue;
      }

      // urge to escape: the food gets launched toward the light
      f.urgeTimer -= dt;
      if (f.urgeTimer <= 0) {
        const interval = lerp(6.5, 3.2, this.difficulty);
        f.urgeTimer = interval * (0.7 + Math.random() * 0.6);
        const apNow = this.mouth.aperture(this.jawAngle);
        f.vel.set(
          (0 - p.x) * 0.7 + (Math.random() - 0.5),
          3.2 + Math.random() * 1.6,
          7.5 + Math.random() * 3 + this.difficulty * 2.5
        );
        // aim roughly at the aperture centre height
        f.vel.y += (apNow.centerY + 0.6 - p.y) * 0.5;
        f.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
      }

      // physics
      f.vel.y -= 14 * dt;
      p.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;

      const rNow = f.r * f.mesh.scale.x / f.r; // current world radius ≈ scale
      const rad = f.mesh.scale.x;

      // tongue floor
      const floorY = this.mouth.tongueSurfaceY(p.x, p.z) + rad * 0.55;
      if (p.y < floorY) {
        p.y = floorY;
        if (f.vel.y < 0) f.vel.y = -f.vel.y * 0.3;
        f.vel.x *= 0.86;
        f.vel.z *= 0.86;
        f.spin.multiplyScalar(0.9);
        // talking jiggles food toward the exit — the core menace
        if (this.activeWord && !this.activeWord.muffled) {
          f.vel.z += dt * 6;
          f.vel.x += (Math.random() - 0.5) * dt * 8;
        }
      }

      // cheek walls
      const hw = this.mouth.corridorHalfWidth(p.z) - rad * 0.6;
      if (Math.abs(p.x) > hw) {
        p.x = Math.sign(p.x) * hw;
        f.vel.x = -f.vel.x * 0.5;
      }

      // palate ceiling (rough)
      const ceil = 1.5 - rad * 0.5;
      if (p.y > ceil && p.z > -0.5 && p.z < 5.0) {
        p.y = ceil;
        if (f.vel.y > 0) f.vel.y = -f.vel.y * 0.4;
      }

      // back of the mouth
      if (p.z < -1.0) {
        p.z = -1.0;
        f.vel.z = Math.abs(f.vel.z) * 0.5;
      }

      // THE LIPS
      if (p.z > MOUTH.lipsZ - rad * 0.5) {
        const fits = ap.halfH > rad * 0.72 &&
          Math.abs(p.y - ap.centerY) < ap.halfH &&
          Math.abs(p.x) < ap.halfW;
        if (fits) {
          this._foodEscaped(f, i);
          continue;
        } else {
          // blocked by the lips/teeth — bounce back in
          p.z = MOUTH.lipsZ - rad * 0.5;
          f.vel.z = -Math.abs(f.vel.z) * 0.45;
          f.vel.y *= 0.5;
          f.blockedAt = performance.now();
          this.audio.crunch(0.15);
          if (ap.open01 < 0.3) {
            // player actively slammed the door — close call!
            this.score += 15;
            this.ui.setScore(this.score);
            this.ui.callout('CLOSE CALL · +15');
          }
        }
      }
    }
  }

  _foodEscaped(f, idx) {
    this.foods.splice(idx, 1);
    this.manners--;
    this.ui.setManners(this.manners);
    this.ui.redFlash();
    this.ui.callout('FOOD ESCAPED', true);
    this.audio.foodEscape();
    this.shake = Math.max(this.shake, 1.0);
    this.streak = 1;

    // off it goes, onto the tablecloth
    f.vel.z = Math.max(f.vel.z, 6) + 4;
    this.escapees.push({ mesh: f.mesh, kind: 'food', life: 2.6, vel: f.vel.clone(), spin: f.spin });

    if (this.manners <= 0 && this.state === 'playing') {
      this.endTimer = 1.4;
    }
  }

  // -------------------------------------------------------------- chomping

  _chomp() {
    this.audio.chomp(1);
    this.mouth.kickUvula(2.2, 0.6);
    this.shake = Math.max(this.shake, 0.5);
    this.chewPulse = 1;

    let bit = false;
    let bitSpec = null;
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      const p = f.mesh.position;
      if (f.state !== 'loose') continue;
      if (p.z > 0.4 && p.z < MOUTH.lipsZ && p.y > -2.6 && p.y < 1.6) {
        bit = true;
        bitSpec = f.spec;
        f.chews++;
        this.chompedCount++;
        f.mesh.scale.multiplyScalar(0.76);
        // juice!
        this._burst(p, f.spec.juice, 10);
        // knocked back toward the throat
        f.vel.set((Math.random() - 0.5) * 3, 2.5 + Math.random() * 2, -6 - Math.random() * 4);
        f.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
        this.score += 5;
        if (f.chews >= f.spec.chewsToSwallow) {
          f.state = 'swallowing';
          f.swallowT = 0;
        }
      }
    }
    if (bit) {
      this.audio.crunch(0.7);
      this.ui.setScore(this.score);
      // every so often, a piece wedges itself between the teeth
      if (!this.stuck && this.chompedCount >= this.nextStuckAt && this.state === 'playing') {
        this._stickFood(bitSpec);
      }
    }
    // saliva spray regardless
    this._burst(new THREE.Vector3(0, 0.1, 3.4), 0xd9a0a0, 6, this._salivaMat);
  }

  // ------------------------------------------------ stuck food / bullet time

  _stickFood(spec) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const a = side * STUCK_ANGLES[(Math.random() * STUCK_ANGLES.length) | 0];
    const spot = upperLingualSpot(a, 0.3 + Math.random() * 0.15, 0.26);

    const mesh = new THREE.Mesh(foodGeometry(spec, this._rng), foodMaterial(spec));
    mesh.material.emissive = new THREE.Color(spec.juice);
    mesh.material.emissiveIntensity = 0;
    mesh.scale.set(0.26, 0.26, 0.2); // a shard, squashed into the gap
    mesh.position.copy(spot);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.stuck = { mesh, spec, highlight: false };
    this.ui.callout('STUCK IN YOUR TEETH', true);
    this.ui.stuckTip('something’s stuck · long-press to focus');
    this.audio.stuck();
  }

  _enterBulletTime() {
    this.bulletTime = true;
    this.audio.bulletIn();
    this.ui.bulletTime(true);
    this.ui.callout('BULLET TIME');
    this.ui.stuckTip('keep holding · circle it with a second finger');
  }

  _exitBulletTime() {
    if (!this.bulletTime) return;
    this.bulletTime = false;
    this.audio.bulletOut();
    this.ui.bulletTime(false);
    this.ui.stuckTip(this.stuck ? 'something’s stuck · long-press to focus' : null);
  }

  // The drawn circle landed — make the morsel glow while the lasso snaps.
  highlightStuck() {
    if (this.stuck) this.stuck.highlight = true;
  }

  // The highlight peaked: poof, score, back to dinner.
  clearStuck() {
    const s = this.stuck;
    if (!s) return;
    this.stuck = null;
    this._burst(s.mesh.position, s.spec.juice, 12);
    this._burst(s.mesh.position, 0xfff2d0, 6);
    this.scene.remove(s.mesh);
    s.mesh.material.dispose();
    this.audio.poof();
    this.score += 50;
    this.ui.setScore(this.score);
    this.ui.callout('PICKED CLEAN · +50');
    this.nextStuckAt = this.chompedCount + 5 + ((Math.random() * 6) | 0);
    this._exitBulletTime();
  }

  _burst(at, color, n, material = null) {
    for (let i = 0; i < n; i++) {
      const mat = material || new THREE.MeshPhysicalMaterial({
        color, roughness: 0.15, clearcoat: 0.8, transparent: true, opacity: 0.95,
      });
      const m = new THREE.Mesh(this._partGeo, mat);
      m.position.copy(at);
      m.position.x += (Math.random() - 0.5) * 0.4;
      m.position.y += (Math.random() - 0.5) * 0.3;
      const s = 0.5 + Math.random() * 1.3;
      m.scale.setScalar(s);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7),
        life: 0.5 + Math.random() * 0.35,
        shared: !!material,
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.vel.y -= 22 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.scale.multiplyScalar(1 - dt * 1.4);
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        if (!pt.shared) pt.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.escapees.length - 1; i >= 0; i--) {
      const e = this.escapees[i];
      e.life -= dt;
      e.vel.y -= (e.kind === 'food' ? 9 : 1.2) * dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      if (e.kind === 'word') {
        e.mesh.material.opacity = Math.min(1, e.life);
        const s = 1 + (1.6 - e.life) * 0.4;
        e.mesh.scale.x = e.mesh.scale.x * (1 + dt * 0.3);
        e.mesh.scale.y = e.mesh.scale.y * (1 + dt * 0.3);
      } else if (e.spin) {
        e.mesh.rotation.x += e.spin.x * dt;
        e.mesh.rotation.z += e.spin.z * dt;
        // land on the tablecloth
        if (e.mesh.position.y < -4.9) {
          e.mesh.position.y = -4.9;
          e.vel.set(0, 0, 0);
          if (e.spin) e.spin.set(0, 0, 0);
        }
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.escapees.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    // long press while something's stuck → slip into bullet time
    if (this.pressed && this.stuck && !this.bulletTime && this.state === 'playing') {
      this.holdTime += dt;
      if (this.holdTime > STUCK_HOLD) this._enterBulletTime();
    } else if (!this.pressed) {
      this.holdTime = 0;
    }
    if (this.bulletTime && this.state !== 'playing') this._exitBulletTime();

    // jaw spring — target depends on input + breath
    const openBase = MOUTH.maxJawAngle * 0.6;
    let target;
    if (this.bulletTime) {
      // teeth bared for inspection; the held finger isn't a bite right now
      target = MOUTH.maxJawAngle * 0.62;
    } else if (this.forcedOpen > 0) {
      target = MOUTH.maxJawAngle * 0.85;
      this.forcedOpen -= dt;
    } else if (this.pressed && this.state === 'playing') {
      target = 0.015;
    } else {
      // talking flutter while a word is in flight
      const flutter = this.activeWord && !this.activeWord.muffled
        ? Math.sin(performance.now() * 0.02) * 0.05 + 0.05
        : Math.sin(performance.now() * 0.004) * 0.02;
      target = openBase + flutter;
    }

    const k = 260, damp = 22;
    const prevAngle = this.jawAngle;
    this.jawVel += (k * (target - this.jawAngle) - damp * this.jawVel) * dt;
    this.jawAngle = clamp(this.jawAngle + this.jawVel * dt, 0.012, MOUTH.maxJawAngle);

    // chomp detection: fast crossing into nearly-closed
    if (prevAngle > 0.1 && this.jawAngle <= 0.1 && this.jawVel < -0.8 && this.state === 'playing') {
      this._chomp();
    }

    // breath management
    const open01 = this.jawAngle / MOUTH.maxJawAngle;
    if (open01 < 0.18 && this.state === 'playing') {
      this.closedTime += dt;
      if (this.closedTime > 3.6) {
        this.forcedOpen = 1.3;
        this.closedTime = 0;
        this.pressed = false;
        this.audio.gasp();
        this.ui.callout('BREATHE!', true);
      }
    } else {
      this.closedTime = Math.max(0, this.closedTime - dt * 2.5);
    }
    this.ui.breath(this.closedTime / 3.6, this.closedTime > 1.4);

    this.chewPulse = Math.max(0, (this.chewPulse || 0) - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    // the world runs on dilated time; the jaw and inputs stay realtime
    const gdt = dt * this.timeScale;
    if (this.state === 'playing') {
      this._updateWord(gdt);
      this._updateFood(gdt);
    }
    this._updateParticles(gdt);
    this.ui.fadeHintMaybe();

    // the stuck morsel smoulders in bullet time, flares when highlighted
    if (this.stuck) {
      const m = this.stuck.mesh.material;
      if (this.stuck.highlight) {
        m.emissiveIntensity = Math.min(2.6, m.emissiveIntensity + dt * 7);
      } else {
        const glow = this.bulletTime ? 0.3 + 0.2 * Math.sin(performance.now() * 0.007) : 0;
        m.emissiveIntensity = lerp(m.emissiveIntensity, glow, 1 - Math.exp(-dt * 8));
      }
      // no streak builds while you're talking with food in your teeth
      this.streak = Math.min(this.streak, 1);
    }

    // crisis slow-mo: word and food both near the exit
    let crisis = false;
    if (this.activeWord && this.activeWord.t > 0.7 && !this.activeWord.muffled) {
      for (const f of this.foods) {
        if (f.mesh.position.z > 4.2) { crisis = true; break; }
      }
    }
    const targetScale = this.bulletTime ? BULLET_SCALE : crisis ? 0.55 : 1;
    this.timeScale = lerp(this.timeScale, targetScale, dt * (this.bulletTime ? 10 : 6));

    // end of game
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        const won = this.wordIndex >= WORDS.length;
        this.state = won ? 'won' : 'lost';
        const lines = won
          ? WIN_LINES[(Math.random() * WIN_LINES.length) | 0]
          : LOSE_LINES[(Math.random() * LOSE_LINES.length) | 0];
        this._exitBulletTime();
        this.ui.stuckTip(null);
        this.ui.showEnd(won, lines, won ? STORY.replace(/\s+/g, ' ') : '', this.score);
        if (won) this.audio.playStory(); // the table hears the whole telling
      }
    }

    return {
      jawAngle: this.jawAngle,
      open01,
      talk: this.activeWord && !this.activeWord.muffled ? 1 : 0.18,
      wordCurl: this.activeWord && !this.activeWord.muffled && this.activeWord.t > 0.25 && this.activeWord.t < 0.7 ? 0.7 : 0,
      chew: this.chewPulse || 0,
    };
  }
}
