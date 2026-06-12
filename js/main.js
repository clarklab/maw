// MAW — bootstrap & render loop.
// PS5-flavoured ambitions on a phone budget: physical materials, real-time
// shadows through the lip aperture, environment reflections on every wet
// surface, ACES tone mapping, bloom, and adaptive exposure that mimics
// your eyes adjusting when the jaw clamps shut.

import * as THREE from 'three';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

import { buildMouth, MOUTH } from './anatomy.js';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { VoiceEngine } from './voice.js';
import { Lasso } from './lasso.js';
import { Lane } from './lane.js';

// ------------------------------------------------------------------- setup

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 900);
camera.position.copy(MOUTH.cameraPos);
camera.lookAt(MOUTH.cameraLook);

// Keep a constant *horizontal* field of view so portrait phones see the
// full width of the dental arches.
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const hFov = THREE.MathUtils.degToRad(80);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hFov / 2) / Math.max(aspect, 0.6)));
  camera.fov = Math.min(camera.fov, 98);
  camera.updateProjectionMatrix();
}
fitCamera();

// ------------------------------------------------------------ environment

// A tiny synthetic sky baked through PMREM gives every wet surface in the
// mouth something real to reflect: bright sky ahead, warm dark flesh behind.
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0.0, '#6e9fd0');
  g.addColorStop(0.45, '#cfe0e9');
  g.addColorStop(0.55, '#7a4a40');
  g.addColorStop(1.0, '#2a0e0c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 16, 12),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })
  );
  envScene.add(dome);
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(3, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  sunBall.material.color.setRGB(18, 16, 13); // HDR-bright
  sunBall.position.set(12, 18, 28);
  envScene.add(sunBall);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.08);
  scene.environment = envRT.texture;
  pmrem.dispose();
}
buildEnvironment();

// ---------------------------------------------------------------- lighting

const sunDir = new THREE.Vector3(0.16, 0.34, 0.93).normalize();

const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.copy(sunDir).multiplyScalar(30);
sun.target.position.set(0, -0.6, 1.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -7;
sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 14;
sun.shadow.camera.far = 48;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// sky bounce through the open lips — intensity tracks the jaw
const skyFill = new THREE.PointLight(0xbcd8ff, 0, 0, 2);
skyFill.position.set(0, 1.0, 8.2);
scene.add(skyFill);

// warm bounce off the tablecloth below the lips
const seaBounce = new THREE.PointLight(0xffdfae, 0, 0, 2);
seaBounce.position.set(0, -2.4, 7.2);
scene.add(seaBounce);

// blood-warm translucency inside the cheeks, pulsing with the heart
const fleshL = new THREE.PointLight(0xff3a26, 1.3, 7, 2);
fleshL.position.set(-2.4, 0.3, 1.8);
const fleshR = new THREE.PointLight(0xff3a26, 1.3, 7, 2);
fleshR.position.set(2.4, 0.3, 1.8);
scene.add(fleshL, fleshR);

const hemi = new THREE.HemisphereLight(0xbcd4e8, 0x4a1512, 0.55);
scene.add(hemi);

const ambient = new THREE.AmbientLight(0x3a1512, 2.6);
scene.add(ambient);

// faked light bounce off the wet dorsum — lifts the palate and inner teeth
const tongueBounce = new THREE.PointLight(0xff9a7a, 1.2, 6, 2);
tongueBounce.position.set(0, 0.85, 2.6);
scene.add(tongueBounce);

// warm wash up into the palate vault so the rugae read instead of
// disappearing into shadow
const palateWash = new THREE.PointLight(0xffb59a, 1.6, 6, 2);
palateWash.position.set(0, 1.0, 1.3);
scene.add(palateWash);

// soft fill in the pocket behind the front teeth — lingual gums and the
// front of the vault otherwise sit in a dead shadow
const vestibuleGlow = new THREE.PointLight(0xffc4a4, 0.9, 2.8, 2);
vestibuleGlow.position.set(0, 0.95, 4.0);
scene.add(vestibuleGlow);

// soft glow near the camera so the throat-side anatomy never goes pitch black
const throatGlow = new THREE.PointLight(0xff6a50, 0.5, 4.5, 2);
throatGlow.position.set(0, 0.7, -1.0);
scene.add(throatGlow);

// gleam on the front of both dental arches — the smile is the frame
const toothGleam = new THREE.PointLight(0xfff6e2, 1.0, 4.2, 2);
toothGleam.position.set(0, 0.3, 4.4);
scene.add(toothGleam);

// the lower row catches its own light, or it reads as rotten stumps
const lowerGleam = new THREE.PointLight(0xfff0da, 0.8, 3.6, 2);
lowerGleam.position.set(0, -0.55, 4.0);
scene.add(lowerGleam);

// ----------------------------------------------------------------- modules

const ui = new UI();
const audio = new AudioEngine();
const voice = new VoiceEngine();
voice.preload(); // start fetching narration clips behind the title screen
audio.attachVoice(voice);
const mouth = buildMouth(scene);
const world = buildWorld(scene, sunDir);
const game = new Game({ scene, mouth, ui, audio });
const lasso = new Lasso(document.getElementById('lasso'));
const lane = new Lane(document.getElementById('lane'));

// ------------------------------------------------------------------ postfx

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.85
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------- input

// One finger bites. When something's stuck in the teeth, holding slips you
// into bullet time and a SECOND finger becomes the glowing pencil.

let primaryId = null;   // the biting finger
let lassoId = null;     // the drawing finger (bullet time only)
let spaceHeld = false;  // desktop: space bites, the mouse draws

window.addEventListener('pointerdown', (e) => {
  if (game.state !== 'playing') return;
  e.preventDefault();
  audio.resume();
  if (game.bulletTime && lassoId === null && e.pointerId !== primaryId) {
    lassoId = e.pointerId;
    lasso.start(e.clientX, e.clientY);
    return;
  }
  if (primaryId === null) {
    primaryId = e.pointerId;
    game.pointerDown();
  }
}, { passive: false });

window.addEventListener('pointermove', (e) => {
  if (e.pointerId === lassoId) lasso.add(e.clientX, e.clientY);
});

function finishLasso(pts) {
  if (!pts || !game.bulletTime || !game.stuck) {
    lasso.fizzle(pts);
    return;
  }
  const hull = lasso.hullOf(game.stuck.mesh, camera);
  if (lasso.encloses(pts, game.stuck.mesh, camera) &&
      lasso.snapTo(pts, hull, () => game.clearStuck())) {
    game.highlightStuck();
  } else {
    lasso.fizzle(pts);
    audio.fizzle();
  }
}

function liftPointer(e, cancelled) {
  if (e.pointerId === lassoId) {
    lassoId = null;
    if (cancelled) lasso.cancel();
    else finishLasso(lasso.end());
    return;
  }
  if (e.pointerId === primaryId) {
    primaryId = null;
    if (!spaceHeld) game.pointerUp();
  }
}
window.addEventListener('pointerup', (e) => liftPointer(e, false));
window.addEventListener('pointercancel', (e) => liftPointer(e, true));
// long-pressing is a core input — never show a context menu
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    spaceHeld = true;
    game.pointerDown();
    audio.resume();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    if (primaryId === null) game.pointerUp();
  }
});

// ------------------------------------------------------ story explainer
// Three taps of table-setting between the title and the first bite. The
// middle card runs a live miniature of the rhythm board.

const EXPLAINER_STEPS = [
  { text: 'Dinner in Dalmatia. You are the mouth — and the story of your travels simply must be told, mid-bite.' },
  {
    text: 'Your words ride the board to your lips — be open when each arrives. TAP to bite when food makes its run, and chew in the green gaps.',
    lane: true,
  },
  { text: 'Something stuck in your teeth? HOLD a finger — the world slows — then circle it with a second. The table is watching.' },
];
const explainerEl = document.getElementById('explainer');
const expText = document.getElementById('exp-text');
const expLaneCanvas = document.getElementById('exp-lane');
const expLane = new Lane(expLaneCanvas, true);
let expStep = -1;

function showExplainerStep(i) {
  expStep = i;
  expText.textContent = EXPLAINER_STEPS[i].text;
  expLaneCanvas.classList.toggle('hidden', !EXPLAINER_STEPS[i].lane);
  const inner = explainerEl.querySelector('.exp-inner');
  inner.classList.remove('pop');
  void inner.offsetWidth;
  inner.classList.add('pop');
}

// A looping six-and-a-half-second demo chart: a phrase of words, a green
// bite window with a tomato making its run, then the next phrase.
function explainerDemo(now) {
  const clk = now % 6.5;
  const H = 5;
  const items = [];
  const word = (time, w, p) => {
    const eta = time - clk;
    if (eta > -0.1 && eta < H) items.push({ type: 'word', t: 1 - eta / H, p, word: w });
  };
  word(1.0, 'We', 1); word(1.45, 'sailed', 1); word(1.8, 'out', 1);
  word(2.15, 'of', 1); word(2.5, 'Split', 1);
  if (4.1 - clk > 0 && 2.9 - clk < H) {
    items.push({ type: 'gap', t0: 1 - (2.9 - clk) / H, t1: 1 - (4.1 - clk) / H });
  }
  word(4.45, 'at', 2); word(4.8, 'dawn,', 2);
  const eta = 3.5 - clk;
  if (eta > -0.1 && eta < H) {
    items.push({ type: 'food', t: 1 - eta / H, color: '#d84a30', warn: eta < 1.2 ? 1 - eta / 1.2 : 0 });
  }
  for (let s = Math.ceil(clk); s - clk <= H; s++) {
    items.push({ type: 'tick', t: 1 - (s - clk) / H });
  }
  return items;
}

explainerEl.addEventListener('click', () => {
  if (expStep < 0) return;
  if (expStep < EXPLAINER_STEPS.length - 1) {
    showExplainerStep(expStep + 1);
  } else {
    expStep = -1;
    explainerEl.classList.add('fading');
    setTimeout(() => game.start(), 250);
  }
});

document.getElementById('start-btn').addEventListener('click', () => {
  audio.init();
  audio.resume();
  lasso.reset();
  ui.hideTitle();
  explainerEl.classList.remove('hidden', 'fading');
  showExplainerStep(0);
});

document.getElementById('retry-btn').addEventListener('click', () => {
  ui.hideEnd();
  audio.resume();
  lasso.reset();
  game.start();
});

window.addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  lasso.resize();
  lane.resize();
});

document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.ctx.resume();
});

// -------------------------------------------------------------------- loop

const clock = new THREE.Clock();
let elapsed = 0;
let exposure = 1.0;
const camBase = MOUTH.cameraPos.clone();
const camLook = MOUTH.cameraLook.clone();

function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.05);
  const rawDt = dt;

  // gameplay first (it returns the jaw + articulation state)
  const params = game.update(dt);
  dt *= game.timeScale;
  elapsed += dt;

  // idle chewing demo behind the title screen
  if (game.state === 'title') {
    params.jawAngle = 0.16 + 0.12 * Math.sin(elapsed * 1.5) + 0.04 * Math.sin(elapsed * 4.7);
    params.talk = 0.4;
  }

  mouth.update(dt, params);
  world.update(dt, camera.position);

  const open01 = params.jawAngle / MOUTH.maxJawAngle;

  // lights follow the jaw: more sky pours in as the mouth opens
  skyFill.intensity = 10 * open01 * open01;
  seaBounce.intensity = 6 * open01;
  const pulse = 0.85 + 0.3 * Math.max(0, Math.sin(elapsed * 3.4)) ** 6;
  fleshL.intensity = 1.3 * pulse;
  fleshR.intensity = 1.3 * pulse * 0.94;
  toothGleam.intensity = 0.8 + 2.2 * open01;
  lowerGleam.intensity = 0.5 + 1.6 * open01;
  palateWash.intensity = 1.2 + 1.6 * open01;

  // adaptive exposure — eyes adjust to the dark when the mouth shuts
  const targetExposure = 1.08 + (1 - open01) * 0.5;
  exposure = THREE.MathUtils.lerp(exposure, targetExposure, 1 - Math.exp(-dt * 2.2));
  renderer.toneMappingExposure = exposure;

  // audio hears the world through the aperture
  if (audio.enabled) audio.setMouthOpen(open01);

  // camera: breathing sway + chomp shake, hanging back by the uvula
  const sway = 0.03;
  camera.position.set(
    camBase.x + Math.sin(elapsed * 0.9) * sway + (Math.random() - 0.5) * 0.05 * game.shake,
    camBase.y + Math.sin(elapsed * 1.3) * sway * 0.7 + (Math.random() - 0.5) * 0.06 * game.shake,
    camBase.z + (Math.random() - 0.5) * 0.03 * game.shake
  );
  camLook.set(
    Math.sin(elapsed * 0.4) * 0.15,
    -0.2 + Math.sin(elapsed * 0.6) * 0.08 - open01 * 0.18,
    6.0
  );
  camera.lookAt(camLook);

  composer.render();

  // the lasso overlay runs on real time, above the slowed 3D scene
  if (!game.bulletTime && lassoId !== null) {
    lassoId = null;
    lasso.cancel();
  }
  lasso.update(rawDt);
  lasso.render();

  // the exit highway is persistent during play, dimmed in bullet time
  for (const kind of game.laneEvents) lane.flash(kind);
  game.laneEvents.length = 0;
  lane.set(game.laneItems, game.state === 'playing' ? (game.bulletTime ? 0.35 : 1) : 0);
  lane.update(rawDt);
  lane.render();

  // the explainer's live miniature board
  if (expStep >= 0 && EXPLAINER_STEPS[expStep].lane) {
    expLane.set(explainerDemo(elapsed), 1);
    expLane.alpha = 1; // the diagram is always solid
    expLane.update(rawDt);
    expLane.render();
  }
}

// debug / test handle
window.MAW = { game, mouth, lasso, lane, camera, audio, voice };

ui.ready();
frame();
