// Runs Theme Check without the Shopify CLI: `npm run check:node` (pass `all` to include info-level offenses).
import { check } from '@shopify/theme-check-node';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const level = process.argv[2] === 'all' ? 2 : 1;
const names = ['ERROR', 'WARN', 'INFO'];
const offenses = (await check(root)).filter((o) => o.severity <= level);
for (const o of offenses) {
  console.log(`${names[o.severity]} ${o.uri.replace(`file://${root}/`, '')}:${(o.start?.line ?? 0) + 1} [${o.check}] ${o.message}`);
}
const errors = offenses.filter((o) => o.severity === 0).length;
console.log(`\n${errors} errors, ${offenses.length - errors} warnings`);
process.exit(errors ? 1 : 0);
