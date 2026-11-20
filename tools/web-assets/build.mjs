import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const out = path.join(root, 'src/main/resources/markmap/vendor');
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(dir, 'entry.js')], outfile: path.join(out, 'markmap-bundle.js'),
  bundle: true, minify: true, format: 'iife', platform: 'browser',
  legalComments: 'none',
});
const packages = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')).packages;
let notices = 'Third-party licenses for bundled Markmap resources.\n\n';
for (const [key, info] of Object.entries(packages)) {
  if (!key.startsWith('node_modules/') || info.dev) continue;
  const pkg = path.join(dir, key);
  if (!fs.existsSync(pkg)) continue;
  const license = fs.readdirSync(pkg).find(name => /^(LICENSE|LICENCE)(\.|$)/i.test(name));
  if (license) notices += `\n--- ${key.slice(13)} ${info.version} ---\n${fs.readFileSync(path.join(pkg, license), 'utf8')}\n`;
}
fs.writeFileSync(path.join(out, 'THIRD_PARTY_LICENSES.txt'), notices);
