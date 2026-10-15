// Reports asset sizes against the performance budget: `npm run size`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const budget = { 'base.css': 32 * 1024, js: 48 * 1024 };
const assets = path.join(root, 'assets');
const rows = fs
  .readdirSync(assets)
  .filter((f) => /\.(css|js)$/.test(f))
  .map((f) => {
    const buf = fs.readFileSync(path.join(assets, f));
    return { file: f, raw: buf.length, gzip: zlib.gzipSync(buf).length };
  })
  .sort((a, b) => b.raw - a.raw);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const r of rows) console.log(`${r.file.padEnd(32)} ${kb(r.raw).padStart(9)}  gzip ${kb(r.gzip).padStart(8)}`);
const js = rows.filter((r) => r.file.endsWith('.js')).reduce((s, r) => s + r.raw, 0);
const css = rows.find((r) => r.file === 'base.css')?.raw ?? 0;
console.log(`\nAll JS: ${kb(js)} (budget ${kb(budget.js)})  base.css: ${kb(css)} (budget ${kb(budget['base.css'])})`);
let over = false;
if (js > budget.js) (over = true), console.log('JS is over budget');
if (css > budget['base.css']) (over = true), console.log('base.css is over budget');
process.exit(over ? 1 : 0);
