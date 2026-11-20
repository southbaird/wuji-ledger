import { execFile } from 'node:child_process';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

// Explicit developer command, never run by the plugin or its default build.
if (process.platform !== 'darwin') throw new Error('Build the optional helper on macOS.');
const exec = promisify(execFile);
await mkdir('dist/native', { recursive: true });
for (const arch of ['arm64', 'x86_64']) {
  await exec('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos14.0`,
    'native/WujiCutout.swift', '-o', `dist/native/wuji-cutout-${arch}`]);
}
await exec('xcrun', ['lipo', '-create', 'dist/native/wuji-cutout-arm64',
  'dist/native/wuji-cutout-x86_64', '-output', 'dist/native/wuji-cutout']);
await exec('codesign', ['--force', '--sign', '-', '--timestamp=none', 'dist/native/wuji-cutout']);
await chmod('dist/native/wuji-cutout', 0o755);
const result = await exec('dist/native/wuji-cutout', ['--check']);
console.log(result.stdout);
await rm('dist/native/wuji-cutout-arm64');
await rm('dist/native/wuji-cutout-x86_64');
