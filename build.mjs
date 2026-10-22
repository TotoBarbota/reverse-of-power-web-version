// Builds the two deliverables:
//   dist/index.html      the whole phone app in one file (CSS, JS, artwork inlined)
//   dist/kip-relay.mjs   the relay, with index.html embedded, runnable with plain Node.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const include = (text) => text.replace(/\/\*@@include ([^@]+)@@\*\//g, (_, rel) => read(rel.trim()));

const icon = fs.readFileSync(path.join(src, 'web', 'generated', 'icon.png')).toString('base64');
let html = include(read('web/index.html')).replace('@@ICON@@', icon);

const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
const checkFile = path.join(dist, '.check-page.js');
fs.writeFileSync(checkFile, scriptMatch[1]);
execFileSync(process.execPath, ['--check', checkFile], { stdio: 'inherit' });
fs.unlinkSync(checkFile);

fs.writeFileSync(path.join(dist, 'index.html'), html);

const relay = include(read('relay.mjs')).replace('/*@@EMBEDDED@@*/ null', () => JSON.stringify({ html, icon }));
fs.writeFileSync(path.join(dist, 'kip-relay.mjs'), relay);
execFileSync(process.execPath, ['--check', path.join(dist, 'kip-relay.mjs')], { stdio: 'inherit' });

const kb = (f) => `${Math.round(fs.statSync(path.join(dist, f)).size / 1024)} KB`;
console.log(`dist/index.html     ${kb('index.html')}`);
console.log(`dist/kip-relay.mjs  ${kb('kip-relay.mjs')}`);
