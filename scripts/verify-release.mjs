import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const source = await readFile('main.js', 'utf8');
const css = await readFile('styles.css', 'utf8');
assert.equal(manifest.id, 'wuji-ledger');
assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
assert.equal(manifest.isDesktopOnly, false);
assert(!source.includes('summary-static.png'));
assert(!source.includes('src/seed.ts'));
assert(!source.includes('/Users/'));
assert(!css.includes('url("assets/'));
assert(css.includes('data:font/woff2;base64,'));
assert(source.includes('Copyright (c) 2026 Jérémy Perret'));
assert(css.includes('SIL OPEN FONT LICENSE'));

// Exercise the actual published CommonJS file with an isolated in-memory host.
// No user's vault is read, no network is allowed, no native module is loaded.
for (const mobile of [false, true]) {
  const views = new Map();
  const commands = [];
  const writes = new Map();
  const app = {
    vault: { configDir: 'custom-config', adapter: {
      exists: async () => false,
      write: async (path, text) => writes.set(path, text),
      mkdir: async () => {},
    } },
    workspace: { onLayoutReady: () => {} },
  };
  class Plugin {
    constructor() { this.app = app; this.manifest = manifest; }
    loadData() { return Promise.resolve(null); }
    saveData(data) { this.saved = structuredClone(data); return Promise.resolve(); }
    registerView(id, factory) { views.set(id, factory); }
    addRibbonIcon() {}
    addCommand(command) { commands.push(command); }
    registerObsidianProtocolHandler() {}
  }
  const host = {
    Plugin, App: class {}, ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
    FileSystemAdapter: class {}, TFile: class {}, WorkspaceLeaf: class {},
    Platform: { isDesktopApp: !mobile, isMobileApp: mobile, isMacOS: !mobile, isIosApp: mobile },
    normalizePath: (path) => path,
    setIcon() {}, requestUrl() { throw new Error('No network permitted in clean-install test'); },
  };
  const context = { exports: {}, module: { exports: {} }, console, Intl, Date, setTimeout, clearTimeout,
    require(name) { assert.equal(name, 'obsidian', `Unexpected runtime dependency: ${name}`); return host; },
  };
  new Script(source, { filename: 'main.js' }).runInNewContext(context);
  const instance = new context.module.exports.default();
  await instance.onload();
  assert.equal(instance.saved.records.length, 0);
  assert.equal(instance.saved.title, '我的小玩意');
  assert.equal(views.size, 2);
  assert(commands.some((command) => command.name === '打开资产台账'));
  assert.equal(writes.size, 1);
  assert(writes.has('custom-config/plugins/wuji-ledger/data.backup.json'));
  instance.onunload();
}
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  const buffer = await readFile(name);
  console.log(`${createHash('sha256').update(buffer).digest('hex')}  ${name}  (${buffer.length} bytes)`);
}
console.log('Three-file release and isolated desktop/mobile startup passed.');
