import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(dir, '../..');
const out = path.join(root, 'src/main/resources/markmap/vendor');
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(dir, 'entry.js')], outfile: path.join(out, 'markmap-bundle.js'),
  bundle: true, minify: true, format: 'iife', platform: 'browser',
  alias: { katex: require.resolve('katex') },
  legalComments: 'none',
});
const katexDir = path.dirname(require.resolve('katex/package.json'));
const css = fs.readFileSync(path.join(katexDir, 'dist/katex.min.css'), 'utf8').replace(/url\(([^)]+)\)/g, (_, name) => {
  const file = path.join(katexDir, 'dist', name.replace(/^['"]|['"]$/g, ''));
  const ext = path.extname(file).slice(1);
  const type = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'font/ttf';
  return `url(data:${type};base64,${fs.readFileSync(file).toString('base64')})`;
});
const highlightCss = fs.readFileSync(require.resolve('highlight.js/styles/github.css'), 'utf8');
fs.writeFileSync(path.join(out, 'katex.css'), css + '\n' + highlightCss);
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
