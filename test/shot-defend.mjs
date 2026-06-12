// Visual check for the DEFEND YOURSELF bonus round: force the coughing fit
// right away, then screenshot the fly-out, the outside face, a dodge lean,
// and the return. Run: node test/shot-defend.mjs
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
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(4174, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4174/');
await page.waitForTimeout(4500);
await page.click('#start-btn');
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(700);
  await page.click('#explainer');
}
await page.waitForTimeout(800);

// force the fit now
await page.evaluate(() => { window.MAW.game.defendAt = 0; });
await page.waitForTimeout(700); // mid fly-out
await page.screenshot({ path: 'test/shot-defend-flyout.png' });

await page.waitForTimeout(1300); // banner + first cough
await page.screenshot({ path: 'test/shot-defend-face.png' });

await page.waitForTimeout(1500); // food in the air
await page.screenshot({ path: 'test/shot-defend-volley.png' });

// swipe right to dodge
await page.mouse.move(120, 500);
await page.mouse.down();
await page.mouse.move(330, 510, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/shot-defend-dodge.png' });

// draw a circle mid-volley (block attempt)
await page.mouse.move(215, 380);
await page.mouse.down();
for (let a = 0; a <= 14; a++) {
  const th = (a / 14) * Math.PI * 2;
  await page.mouse.move(215 + Math.cos(th) * 110, 460 + Math.sin(th) * 110, { steps: 2 });
}
await page.mouse.up();
await page.screenshot({ path: 'test/shot-defend-circle.png' });

await page.waitForTimeout(5500); // wind-down, back inside
await page.screenshot({ path: 'test/shot-defend-after.png' });

const state = await page.evaluate(() => ({
  phase: window.MAW.defend.phase,
  stats: window.MAW.defend.stats,
  total: window.MAW.defend.total,
  gameState: window.MAW.game.state,
  score: window.MAW.game.score,
}));
console.log('state:', JSON.stringify(state));
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
