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
import { LassoPicker, projectMeshHull, lassoCatches } from './pick.js';

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

// soft glow near the camera so the throat-side anatomy never goes pitch black
const throatGlow = new THREE.PointLight(0xff6a50, 0.5, 4.5, 2);
throatGlow.position.set(0, 0.7, -1.0);
scene.add(throatGlow);

// ----------------------------------------------------------------- modules

const ui = new UI();
const audio = new AudioEngine();
audio.preload(); // start fetching the narration before the first tap
const picker = new LassoPicker(document.getElementById('lasso'));
const mouth = buildMouth(scene);
const world = buildWorld(scene, sunDir);
const game = new Game({ scene, mouth, ui, audio });

// ------------------------------------------------------------------ postfx

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.85
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------- input

// One finger holds the bite. In bullet time a second pointer becomes the
// glowing pencil that circles the food stuck in your teeth.
let drawId = null;
let biteId = null;

function finishLasso() {
  const stroke = picker.end();
  const stuck = game.stuck;
  if (!stroke || !stuck || !game.bulletTime) { picker.cancel(); return; }
  const getHull = () =>
    projectMeshHull(stuck.mesh, camera, window.innerWidth, window.innerHeight);
  const hull = getHull();
  if (hull && lassoCatches(stroke, hull)) {
    // snap the loose circle onto the exact silhouette, then poof
    picker.snap(getHull, () => game.clearStuck());
  } else {
    picker.fail();
  }
}

function press(e) {
  if (game.state !== 'playing') return;
  e.preventDefault();
  audio.resume();
  if (game.bulletTime && game.pressed && drawId === null && picker.state === 'idle') {
    drawId = e.pointerId;
    picker.start(e.clientX, e.clientY);
    return;
  }
  if (biteId === null) {
    biteId = e.pointerId;
    game.pointerDown();
  }
}
function move(e) {
  if (e.pointerId === drawId) picker.move(e.clientX, e.clientY);
}
function release(e) {
  if (e.pointerId === drawId) {
    drawId = null;
    finishLasso();
    return;
  }
  if (e.pointerId === biteId) {
    biteId = null;
    game.pointerUp();
  }
}

window.addEventListener('pointerdown', press, { passive: false });
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) { game.pointerDown(); audio.resume(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') game.pointerUp();
});

document.getElementById('start-btn').addEventListener('click', () => {
  audio.init();
  audio.resume();
  ui.hideTitle();
  setTimeout(() => game.start(), 350);
});

document.getElementById('retry-btn').addEventListener('click', () => {
  ui.hideEnd();
  audio.resume();
  game.start();
});

window.addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  picker.resize();
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
  const realDt = Math.min(clock.getDelta(), 0.05);
  let dt = realDt;

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

  // lasso overlay runs on real time (it IS the bullet-time interface)
  if (!game.bulletTime && drawId !== null) { drawId = null; picker.cancel(); }
  picker.setBulletTime(game.bulletTime);
  picker.update(realDt);

  const open01 = params.jawAngle / MOUTH.maxJawAngle;

  // lights follow the jaw: more sky pours in as the mouth opens
  skyFill.intensity = 10 * open01 * open01;
  seaBounce.intensity = 6 * open01;
  const pulse = 0.85 + 0.3 * Math.max(0, Math.sin(elapsed * 3.4)) ** 6;
  fleshL.intensity = 1.3 * pulse;
  fleshR.intensity = 1.3 * pulse * 0.94;

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
    -0.3 + Math.sin(elapsed * 0.6) * 0.08 - open01 * 0.25,
    6.0
  );
  camera.lookAt(camLook);

  composer.render();
}

// exposed for the headless visual harness (test/shot.mjs)
window.__maw = { game, picker, camera, finishLasso };

ui.ready();
frame();
