// Ad-hoc verification of the stuck-food / bullet-time / lasso mechanic:
// force a morsel to stick, long-press with one touch, circle it with a
// second touch via CDP multi-touch, and assert it gets cleared.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg',
};
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(4174, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4174/');
await page.waitForTimeout(4000);
await page.click('#start-btn');
await page.waitForTimeout(2000);

// Force a stuck morsel
await page.evaluate(() => {
  const g = window.MAW.game;
  g.nextStuckAt = 1;
  g._spawnFood();
  g.foods[0].mesh.position.set(0, 0, 3);
  g._chomp();
});
const hasStuck = await page.evaluate(() => !!window.MAW.game.stuck);
console.log('stuck spawned:', hasStuck);

// Where is it on screen?
const spot = await page.evaluate(() => {
  const { game, camera } = window.MAW;
  const v = game.stuck.mesh.position.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
});
console.log('stuck screen pos:', spot);

// CDP touch: ids must be explicit — touchEnd's touchPoints are the RELEASED points.
const cdp = await page.context().newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
});

// Finger 1: long press bottom of screen
// NOTE: headless SwiftShader renders at ~2fps, so everything below waits on
// game state rather than wall-clock time.
const f1 = { x: 215, y: 820, id: 0 };
await touch('touchStart', [f1]);
let inBullet = false;
try {
  await page.waitForFunction(() => window.MAW.game.bulletTime, null, { timeout: 30000 });
  inBullet = true;
} catch { /* stayed false */ }
console.log('bullet time engaged:', inBullet);
await page.screenshot({ path: 'test/shot-bullettime.png' });

// Finger 2: draw a circle around the morsel
const r = 70;
const steps = 28;
const circleAt = (k) => ({
  x: spot.x + Math.cos((k / steps) * Math.PI * 2) * r,
  y: spot.y + Math.sin((k / steps) * Math.PI * 2) * r,
  id: 1,
});
await touch('touchStart', [f1, circleAt(0)]);
for (let k = 1; k <= steps; k++) {
  await touch('touchMove', [f1, circleAt(k)]);
  await page.waitForTimeout(40);
}
await page.screenshot({ path: 'test/shot-lasso.png' });
await touch('touchEnd', [circleAt(steps)]); // lift finger 2 only
await page.screenshot({ path: 'test/shot-snap.png' });
let pickedClean = false;
try {
  await page.waitForFunction(() => !window.MAW.game.stuck, null, { timeout: 30000 });
  pickedClean = true;
} catch { /* still stuck */ }
const cleared = await page.evaluate(() => ({
  stuck: !!window.MAW.game.stuck,
  bullet: window.MAW.game.bulletTime,
  score: window.MAW.game.score,
}));
console.log('after circling:', cleared, 'picked clean:', pickedClean);
await page.screenshot({ path: 'test/shot-cleared.png' });
await touch('touchEnd', [f1]);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
server.close();
const ok = hasStuck && inBullet && !cleared.stuck && !cleared.bullet && errors.length === 0;
console.log(ok ? 'MECHANIC OK' : 'MECHANIC FAILED');
process.exit(ok ? 0 : 1);
