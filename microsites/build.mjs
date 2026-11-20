#!/usr/bin/env node
// Build the microsites.
//
//   node microsites/build.mjs                      preview every site      -> microsites/dist/preview/<domain>/
//   node microsites/build.mjs <slug> --live        preview in call mode with a sample phone number and partner
//   node microsites/build.mjs <slug> --production  strict build to publish -> microsites/dist/<domain>/
//
// Preview builds are marked noindex and show a ribbon. A production build refuses
// to run while anything is missing or still a placeholder, and lists what to fix.

import path from 'node:path';
import { buildAll } from './lib/build.mjs';

const args = process.argv.slice(2);
const known = new Set(['--production', '--live', '--help']);
const unknown = args.filter((a) => a.startsWith('--') && !known.has(a));

if (args.includes('--help') || unknown.length) {
  if (unknown.length) console.error(`Unknown option: ${unknown.join(', ')}\n`);
  console.log('Usage: node microsites/build.mjs [site-slug ...] [--production] [--live]');
  process.exit(unknown.length ? 1 : 0);
}

const { results, failures } = await buildAll({
  only: args.filter((a) => !a.startsWith('--')),
  production: args.includes('--production'),
  forceLive: args.includes('--live'),
});

const rel = (p) => path.relative(process.cwd(), p) || '.';
for (const r of results) {
  const kind = r.production ? 'production' : 'preview';
  console.log(`✔ ${r.domain}  ${kind}, ${r.mode} mode, ${r.files.length} files -> ${rel(r.outDir)}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
}
for (const f of failures) {
  console.error(`✖ ${f.site}`);
  for (const p of f.problems) console.error(`  - ${p}`);
}
process.exit(failures.length ? 1 : 0);
