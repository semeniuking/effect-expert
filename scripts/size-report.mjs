// Reports asset sizes against the performance budget: `npm run size`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
// Budgets are gzip sizes. JS is the sum of ALL modules; each page loads only the modules its sections use.
const budget = { 'base.css': 8 * 1024, js: 32 * 1024 };
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
const js = rows.filter((r) => r.file.endsWith('.js')).reduce((s, r) => s + r.gzip, 0);
const css = rows.find((r) => r.file === 'base.css')?.gzip ?? 0;
console.log(`\nAll JS modules (gzip): ${kb(js)} (budget ${kb(budget.js)})  base.css (gzip): ${kb(css)} (budget ${kb(budget['base.css'])})`);
let over = false;
if (js > budget.js) (over = true), console.log('JS is over budget');
if (css > budget['base.css']) (over = true), console.log('base.css is over budget');
process.exit(over ? 1 : 0);
