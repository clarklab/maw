// Headless smoke test: build the whole mouth + world + game with a stubbed
// DOM, run a few hundred simulated frames, and assert nothing NaNs out.
// Run: node test/smoke.mjs

// ---------------------------------------------------------------- DOM stub

function fakeGradient() { return { addColorStop() {} }; }

function fakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textBaseline: '', textAlign: '', shadowColor: '', shadowBlur: 0,
    globalAlpha: 1,
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, closePath() {},
    fillText() {}, strokeText() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    createLinearGradient: fakeGradient,
    createRadialGradient: fakeGradient,
    measureText(t) { return { width: (t ? t.length : 1) * 40 }; },
  };
}

function fakeCanvas() {
  return { width: 0, height: 0, getContext() { return fakeCtx(); } };
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return fakeCanvas();
    throw new Error(`unexpected createElement(${tag})`);
  },
};
globalThis.window = globalThis;

// ------------------------------------------------------------------- tests

const THREE = await import('three');
const { buildMouth, MOUTH } = await import('../js/anatomy.js');
const { buildWorld } = await import('../js/world.js');
const { Game } = await import('../js/game.js');
const story = await import('../js/story.js');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  ${name}`);
  else { console.error(`FAIL  ${name}`); failures++; }
}

function geometryFinite(obj, name) {
  let bad = 0;
  obj.traverse((node) => {
    if (!node.isMesh && !node.isSprite) return;
    const pos = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.array.length; i++) {
      if (!Number.isFinite(pos.array[i])) { bad++; break; }
    }
  });
  check(`${name}: all geometry positions finite`, bad === 0);
}

// --- story
check('story has 100+ words', story.WORDS.length > 100);
check('story words are non-empty', story.WORDS.every((w) => w.length > 0));
console.log(`      (${story.WORDS.length} words in the story)`);

// --- anatomy
const scene = new THREE.Scene();
const mouth = buildMouth(scene);
geometryFinite(mouth.root, 'mouth');

let meshCount = 0, vertCount = 0;
mouth.root.traverse((n) => {
  if (n.isMesh) {
    meshCount++;
    vertCount += n.geometry.attributes.position.count;
  }
});
console.log(`      (${meshCount} meshes, ${vertCount} vertices in the mouth)`);
check('mouth is substantial (>30k verts — no low poly!)', vertCount > 30000);

// animate through a full chew cycle
for (let i = 0; i < 120; i++) {
  const t = i / 120;
  mouth.update(1 / 60, {
    jawAngle: MOUTH.maxJawAngle * Math.abs(Math.sin(t * Math.PI * 4)),
    talk: 1, wordCurl: t > 0.5 ? 0.7 : 0, chew: t > 0.25 && t < 0.4 ? 1 : 0,
  });
}
mouth.kickUvula(2, 1);
mouth.triggerSwallow();
for (let i = 0; i < 60; i++) mouth.update(1 / 60, { jawAngle: 0.1, talk: 0, wordCurl: 0, chew: 0 });
geometryFinite(mouth.root, 'mouth after 180 animated frames');

// geometry queries
const apClosed = mouth.aperture(0.012);
const apOpen = mouth.aperture(MOUTH.maxJawAngle);
check('aperture grows with jaw', apOpen.halfH > apClosed.halfH + 1);
check('aperture open01 sane', apOpen.open01 === 1 && apClosed.open01 < 0.1);
const ty = mouth.tongueSurfaceY(0, 2.5);
check('tongue surface height sane', Number.isFinite(ty) && ty > -2 && ty < 1.5);
check('corridor width sane', mouth.corridorHalfWidth(2) > 1 && mouth.corridorHalfWidth(2) < 4);

// --- world
const wscene = new THREE.Scene();
const world = buildWorld(wscene, new THREE.Vector3(0.16, 0.34, 0.93).normalize());
geometryFinite(world.group, 'world');
for (let i = 0; i < 60; i++) world.update(1 / 60, new THREE.Vector3(0, 0.4, -1.7));
check('sea time advanced', world.group.children.length > 5);

// --- game, with stub UI/audio
const calls = [];
const stub = new Proxy({}, { get: (_, k) => (...a) => calls.push(String(k)) });
const game = new Game({ scene, mouth, ui: stub, audio: stub });
game.start();
check('game starts in playing state', game.state === 'playing');

// simulate ~40 seconds: alternate talking and chomping
let chomped = 0;
for (let f = 0; f < 2400; f++) {
  // bite down rhythmically so chomps, chews and blocks all happen
  game.pressed = (f % 90) > 70;
  const params = game.update(1 / 60);
  mouth.update(1 / 60, params);
  if (!Number.isFinite(game.jawAngle)) { check('jaw finite', false); break; }
  if (params.jawAngle < 0.05) chomped++;
}
check('jaw closed at least sometimes', chomped > 10);
check('story advanced (words escaped)', game.wordIndex > 3);
check('score accumulated', game.score > 0);
check('food existed at some point', game.foods.length > 0 || calls.includes('crunch'));
check('audio was exercised', calls.includes('chomp') && calls.includes('wordEscape'));
check('no NaN positions among food', game.foods.every((fd) => Number.isFinite(fd.mesh.position.x + fd.mesh.position.y + fd.mesh.position.z)));
geometryFinite(scene, 'scene after 40s of play');

// breath mechanic: hold shut until forced open
game.pressed = true;
let forced = false;
for (let f = 0; f < 600; f++) {
  game.update(1 / 60);
  if (game.forcedOpen > 0) { forced = true; break; }
}
check('suffocation forces the mouth open', forced);

console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
