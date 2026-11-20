import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// Community installs download only main.js, manifest.json and styles.css.
// Font data and notices therefore travel in those files, without a CDN.
const licenses = await Promise.all([
  'LICENSE',
  'assets/appearance/LICENSE-bloub.txt',
  'assets/appearance/LICENSE-smiley-sans.txt',
].map((file) => readFile(file, 'utf8')));
const notice = `/*!\n${licenses.join('\n\n').replaceAll('*/', '* /')}\n*/`;
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2018',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: false,
  minify: false,
  banner: { js: notice },
  logLevel: 'info',
});
const font = await readFile('assets/appearance/SmileySans-Oblique.ttf.woff2');
const css = await readFile('src/styles.css', 'utf8');
const bundledCss = css.replace(
  'url("assets/appearance/SmileySans-Oblique.ttf.woff2")',
  `url("data:font/woff2;base64,${font.toString('base64')}")`,
);
if (bundledCss === css) throw new Error('Font embedding failed');
await writeFile('styles.css', `${notice}\n${bundledCss}`);
