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
    fillRect() {}, beginPath() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, closePath() {},
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

// simulate ~60 seconds: alternate talking and chomping
// (crisis slow-mo genuinely dilates the game clock now, so give it room)
let chomped = 0;
for (let f = 0; f < 3600; f++) {
  // bite down rhythmically so chomps, chews and blocks all happen
  // (short bites — long holds muffle too many words for a stable check)
  game.pressed = (f % 90) > 76;
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
// (fresh game, and forbid sticking — holding with food stuck enters bullet
// time instead of suffocating)
game.start();
game.stickAfterMisChews = Infinity;
game.pressed = true;
let forced = false;
for (let f = 0; f < 600; f++) {
  game.update(1 / 60);
  if (game.forcedOpen > 0) { forced = true; break; }
}
check('suffocation forces the mouth open', forced);
game.pressed = false;

// --- the sliding chew zone
game.start();
game.stickAfterMisChews = Infinity;
game._spawnFood();
game.foods[0].mesh.position.set(0, 0, 3);
game.update(1 / 60); // sweeps the zone and publishes it to the lane
check('chew zone rides the lane', game.laneItems.some((it) => it.type === 'zone'));
game.zoneHalf = 0.5; // a barn-door zone — the next bite must land clean
const zoneScore = game.score;
game._chomp();
check('clean bite scores the bonus', game.score >= zoneScore + 15); // 5 chomp + 10 clean
check('clean bite chews double', game.foods.length === 0 || game.foods[0].chews !== 1);

// sloppy bites (outside the zone) are what wedge food in the teeth
game.start();
game.zoneHalf = 0;  // every bite is sloppy
game.misChews = game.stickAfterMisChews - 1; // the next one wedges in
game._spawnFood();
game.foods[0].mesh.position.set(0, 0, 3);
game._chomp();
check('third sloppy bite sticks the morsel', !!game.stuck);
check('mis-chew counter resets after sticking', game.misChews === 0);
game.zoneHalf = 0.12; // restore a real zone so the shrink is measurable
const halfBefore = game.zoneHalf;
// (generous loop — crisis slow-mo legitimately stretches the 3s window)
for (let f = 0; f < 60 * 9 && game.stuck; f++) game.update(1 / 60);
check('unpicked morsel festers away within ~3s', !game.stuck);
check('festering shrinks the chew zone', game.zoneHalf < halfBefore);

// --- food stuck in teeth + bullet time
game.start();
game.zoneHalf = 0;
game.misChews = game.stickAfterMisChews - 1; // force the next bite to stick
game._spawnFood();
game.foods[0].mesh.position.set(0, 0, 3); // right between the teeth
game._chomp();
check('chomps are counted', game.chompedCount >= 1);
check('food got stuck in the teeth', !!game.stuck);
check('stuck morsel geometry finite', (() => {
  const p = game.stuck.mesh.position;
  return Number.isFinite(p.x + p.y + p.z);
})());

game.pressed = true;
for (let f = 0; f < 90 && !game.bulletTime; f++) game.update(1 / 60);
check('long press enters bullet time', game.bulletTime === true);
for (let f = 0; f < 40; f++) game.update(1 / 60);
check('bullet time slows the clock', game.timeScale < 0.3);

game.highlightStuck();
game.update(1 / 60);
check('highlighted morsel glows', game.stuck.mesh.material.emissiveIntensity > 0);

const scoreBefore = game.score;
const halfBeforePick = game.zoneHalf;
game.clearStuck();
check('cleared morsel scores and unsticks', !game.stuck && game.score > scoreBefore);
check('picking clean grows the chew zone', game.zoneHalf > halfBeforePick);
check('bullet time releases after cleaning', game.bulletTime === false);
game.pressed = false;
for (let f = 0; f < 60; f++) game.update(1 / 60);
check('time returns to normal', game.timeScale > 0.8);

// releasing the finger also cancels bullet time
game._stickFood(story.FOODS[0]);
game.pressed = true;
for (let f = 0; f < 90 && !game.bulletTime; f++) game.update(1 / 60);
check('re-stuck food re-enters bullet time', game.bulletTime === true);
game.pointerUp();
check('lifting the finger cancels bullet time', game.bulletTime === false);

// --- performance mode: timed narration drives the words as notes
{
  const fakeTimings = {
    duration: story.WORDS.length * 0.4 + 0.3,
    words: story.WORDS.map((w, i) => ({ s: i * 0.4, e: i * 0.4 + 0.3, p: (i / 8) | 0 })),
  };
  const perfCalls = [];
  const perfTarget = {
    narrationTimings: () => fakeTimings,
    narrationReady: () => true,
  };
  const perfAudio = new Proxy(perfTarget, {
    get: (t, k) => t[k] || ((...a) => perfCalls.push(String(k))),
  });
  const game2 = new Game({ scene, mouth, ui: stub, audio: perfAudio });
  game2.start();
  check('performance mode engages with timings', game2.mode === 'performance');
  game2.biteTimer = Infinity; // no food — keep the run deterministic
  for (const f of game2.foods) game2.scene.remove(f.mesh);
  game2.foods.length = 0;

  for (let f = 0; f < 6500 && game2.state === 'playing'; f++) {
    // co-prime cycle vs the 0.4s word grid, so bites drift across the beat
    game2.pressed = (f % 97) > 70;
    game2.update(1 / 60);
    if (game2.foods.length) { // food snuck in: remove, keep it word-only
      for (const fd of game2.foods) game2.scene.remove(fd.mesh);
      game2.foods.length = 0;
    }
  }
  check('performance run reached the end', game2.state === 'won');
  check('every word was performed', game2.wordIndex === story.WORDS.length);
  check('most words escaped', game2.wordIndex - game2.missedWords > story.WORDS.length * 0.5);
  check('bites muffled some words', game2.missedWords > 0);
  check('narration was started', perfCalls.includes('startNarration'));
  console.log(`      (${game2.wordIndex - game2.missedWords}/${story.WORDS.length} escaped, ${game2.missedWords} muffled, score ${game2.score})`);
}

// --- DEFEND YOURSELF: the coughing-fit bonus round
{
  const { DefendRound } = await import('../js/defend.js');
  const dscene = new THREE.Scene();
  const dmouth = buildMouth(dscene);
  const dcalls = [];
  const dstub = new Proxy({}, { get: (_, k) => (...a) => dcalls.push(String(k)) });
  const dcamera = new THREE.PerspectiveCamera(78, 0.6, 0.05, 900);

  const dgame = new Game({ scene: dscene, mouth: dmouth, ui: dstub, audio: dstub });
  const defend = new DefendRound({
    scene: dscene, mouth: dmouth, ui: dstub, audio: dstub, lasso: dstub, camera: dcamera,
  });
  dgame.attachDefend(defend);
  geometryFinite(defend.face, 'outside face');

  dgame.start();
  dgame.defendAt = 0; // cough fit immediately
  dgame.update(1 / 60);
  check('defend round begins with the fit', defend.phase === 'enter');
  check('outside face appears', defend.face.visible === true);

  const wordsBefore = dgame.wordIndex;
  let sawActive = false;
  let frames = 0;
  for (let f = 0; f < 60 * 20 && defend.phase !== 'idle'; f++) {
    const params = dgame.update(1 / 60);
    dmouth.update(1 / 60, params);
    defend.cameraPose(dcamera);
    if (defend.active) sawActive = true;
    if (f === 130) defend.dodge(1); // lean once, mid-volley
    frames++;
  }
  check('defend ran its active phase', sawActive);
  check('launched 7-12 pieces', defend.total >= 7 && defend.total <= 12
    && defend.launched === defend.total);
  check('every piece resolved (blocked / dodged / splat)',
    defend.stats.blocked + defend.stats.dodged + defend.stats.splats === defend.total);
  check('round lasted roughly ten seconds', frames / 60 > 6 && frames / 60 < 14);
  check('the story froze during the fit', dgame.wordIndex === wordsBefore);
  check('coughing and smacking played', dcalls.includes('cough') && dcalls.includes('smack'));
  check('face hidden again after the fit', defend.face.visible === false);
  check('guest camera stayed finite', Number.isFinite(
    dcamera.position.x + dcamera.position.y + dcamera.position.z));
  geometryFinite(defend.face, 'outside face after the fit');
  console.log(`      (${defend.total} pieces: ${defend.stats.blocked} blocked, `
    + `${defend.stats.dodged} dodged, ${defend.stats.splats} splats, ${(frames / 60).toFixed(1)}s)`);

  // a fresh start resets the round
  dgame.start();
  check('retry resets the defend round', defend.phase === 'idle' && defend.foods.length === 0);
}

// --- voice assets, if rendered: the manifest must match the story exactly
try {
  const { readFile } = await import('fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('../assets/voice/manifest.json', import.meta.url), 'utf8')
  );
  check('voice manifest matches story words',
    manifest.words.length === story.WORDS.length &&
    manifest.words.every((w, i) => w === story.WORDS[i]));
  check('voice manifest maps every word to a clip',
    Array.isArray(manifest.files) && manifest.files.length === story.WORDS.length);
  const { access } = await import('fs/promises');
  let missing = 0;
  for (const name of new Set(manifest.files)) {
    await access(new URL(`../assets/voice/words/${name}`, import.meta.url))
      .catch(() => missing++);
  }
  await access(new URL('../assets/voice/story.mp3', import.meta.url)).catch(() => missing++);
  check('all narration clips present', missing === 0);
} catch {
  console.log('      (no voice assets rendered — skipping narration checks)');
}

console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
