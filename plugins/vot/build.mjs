// Build the vot plugin: our code + @vot.js/core into one browser script (dist/vot.js).
//   node plugins/vot/build.mjs        (needs `npm install` in the repo root)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'src/index.js')],
  outfile: path.join(here, 'dist/vot.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100'],
  minifySyntax: true,
  // vot.js imports node:crypto only when running in Node; in the page it uses crypto.subtle
  external: ['node:crypto'],
  legalComments: 'inline',
  charset: 'utf8',
  banner: { js: '/* vot plugin: built from plugins/vot/src with @vot.js/core (MIT, FOSWLY). Do not edit. */' },
  logLevel: 'warning',
});
console.log('built', path.relative(process.cwd(), path.join(here, 'dist/vot.js')));
