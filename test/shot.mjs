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
// tap through the story explainer
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `test/shot-explainer-${i}.png` });
  await page.click('#explainer');
}
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

// landscape too
await page.setViewportSize({ width: 932, height: 430 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-landscape.png' });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
