// Visual check: boot the game in headless Chromium (SwiftShader WebGL),
// capture console errors, and screenshot title + gameplay states.
// Run: node test/shot.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } }); // phone portrait

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4173/');
await page.waitForTimeout(4500);
await page.screenshot({ path: 'test/shot-title.png' });

await page.click('#start-btn');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'test/shot-open.png' });

// bite down
await page.mouse.move(215, 500);
await page.mouse.down();
await page.waitForTimeout(900);
await page.screenshot({ path: 'test/shot-closed.png' });
await page.mouse.up();

// let some story escape
await page.waitForTimeout(7000);
await page.screenshot({ path: 'test/shot-play.png' });

// ----- stuck food + bullet-time lasso -----
await page.evaluate(() => {
  const { game } = window.__maw;
  game._spawnFood();
  const f = game.foods[game.foods.length - 1];
  f.mesh.position.set(0, 0, 3);
  game.bitesUntilStuck = 1;
  game._chomp();
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'test/shot-stuck.png' });

// hold the bite to drop into bullet time (poll: SwiftShader frames are slow,
// so the long-press timer accumulates game-time over many real seconds)
await page.mouse.move(215, 700);
await page.mouse.down();
try {
  await page.waitForFunction(() => window.__maw.game.bulletTime, { timeout: 60000 });
} catch {
  errors.push('bullet time did not engage on long press');
}
await page.screenshot({ path: 'test/shot-bullet.png' });

// circle the stuck piece with the "second finger" (drive the picker directly)
await page.evaluate(() => {
  const { game, picker, camera } = window.__maw;
  const v = game.stuck.mesh.position.clone().project(camera);
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (-v.y * 0.5 + 0.5) * innerHeight;
  picker.start(x + 85, y);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    picker.move(x + Math.cos(a) * 85, y + Math.sin(a) * 85);
  }
});
await page.waitForTimeout(250);
await page.screenshot({ path: 'test/shot-lasso.png' });

await page.evaluate(() => window.__maw.finishLasso());
await page.waitForTimeout(250);
await page.screenshot({ path: 'test/shot-snap.png' });
try {
  await page.waitForFunction(
    () => !window.__maw.game.stuck && !window.__maw.game.bulletTime,
    { timeout: 60000 }
  );
} catch {
  errors.push('lasso did not clear the stuck food');
}
await page.screenshot({ path: 'test/shot-picked.png' });
await page.mouse.up();

// landscape too
await page.setViewportSize({ width: 932, height: 430 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-landscape.png' });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
