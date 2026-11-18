// Smoke harness: node tests/smoke.mjs [--w 1440 --h 900] [--chapters a,b,c]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'out');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const W = parseInt(opt('w', '1440'), 10);
const H = parseInt(opt('h', '900'), 10);
const suffix = opt('url-suffix', '');
const tag = opt('tag', 'boot');
const chapterArg = opt('chapters', '');
const ALL = ['hero','case','tray','color','taper','tips','tape','labels','configure'];
const chapters = chapterArg ? chapterArg.split(',').filter(Boolean) : null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

fs.mkdirSync(outDir, { recursive: true });
const errors = [];
let browser;
let code = 0;
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(600000);
  // The CI box reports 4 cores, which the page treats as low-power (no bokeh, half the fibres). Pretend to be a normal desktop.
  await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}/index.html${suffix}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

  const hasStory = await page.evaluate(() => !!window.__story);
  const shots = hasStory ? (chapters || ALL) : [tag];

  for (const id of shots) {
    if (id !== tag) {
      await page.evaluate((c) => window.__story.goTo(c), id);
      await page.waitForTimeout(2500);
    }
    // Let a couple of software-GL frames land.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(700); // callout label swap + fade
    const file = path.join(outDir, `${W}x${H}-${id}.png`);
    await page.screenshot({ path: file });
    const box = await page.evaluate(() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const png = await page.screenshot({ clip: box });
    // Canvas pixel std-dev, computed in the page from the screenshot.
    const sd = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, s = 0, s2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        s += l; s2 += l * l; n++;
      }
      const m = s / n;
      return Math.sqrt(Math.max(0, s2 / n - m * m));
    }, png.toString('base64'));
    console.log(`${path.relative(root, file)}  std-dev=${sd.toFixed(2)}`);
    if (!(sd > 6)) errors.push(`blank frame "${id}" (std-dev ${sd.toFixed(2)} <= 6)`);
  }

  // Configurator: click every bend, then each thickness, then settle on D / 0.1. Geometry count must not grow
  // (old geometries are disposed on rebuild) and nothing may log an error.
  if (hasStory && (!chapters || chapters.includes('configure'))) {
    await page.evaluate(() => window.__story.goTo('configure'));
    await page.waitForTimeout(1500);
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const settle = async () => {
      await frames();
      await page.waitForFunction(() => !window.__debug.pendingConfig());
    };
    await frames();
    const before = await page.evaluate(() => window.__debug.geometries());
    const bends = await page.$$eval('#seg-curl button', (bs) => bs.map((b) => b.dataset.curl));
    const thicks = await page.$$eval('#seg-thick button', (bs) => bs.map((b) => b.dataset.thick));
    if (bends.length !== 9 || thicks.length !== 3) errors.push(`configurator options: ${bends.length} bends, ${thicks.length} thicknesses`);
    let worst = 0;
    for (const b of bends) {
      await page.click(`#seg-curl button[data-curl="${b}"]`);
      await settle();
      worst = Math.max(worst, await page.evaluate(() => window.__debug.lastRebuildMs()));
    }
    for (const t of thicks) {
      await page.click(`#seg-thick button[data-thick="${t}"]`);
      await settle();
      worst = Math.max(worst, await page.evaluate(() => window.__debug.lastRebuildMs()));
    }
    await page.click('#seg-curl button[data-curl="D"]');
    await settle();
    await page.click('#seg-thick button[data-thick="0.1"]');
    await settle();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.__debug.geometries());
    const href = await page.$eval('.buy a', (a) => `${a.href}|${a.target}|${a.rel}`);
    await page.screenshot({ path: path.join(outDir, `${W}x${H}-configure-D-0.1.png`) });
    console.log(`configure: geometries before=${before} after=${after}, worst rebuild ${worst.toFixed(0)} ms, buy=${href}`);
    if (Math.abs(after - before) > 2) errors.push(`geometry leak on configure: ${before} -> ${after}`);
    if (!href.startsWith('https://effect-expert.com/products/balance-mix-brunette|_blank|noopener')) errors.push('buy link wrong: ' + href);
  }
} catch (e) {
  errors.push(String(e && e.message || e));
} finally {
  if (browser) await browser.close();
  server.close();
}
if (errors.length) {
  console.error('SMOKE FAIL:\n  ' + errors.join('\n  '));
  code = 1;
} else console.log('SMOKE PASS');
process.exit(code);
