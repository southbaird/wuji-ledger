import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as { id: string; name: string; version: string; description: string };
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const buildConfig = readFileSync(new URL('../esbuild.config.mjs', import.meta.url), 'utf8');
const stickerSource = readFileSync(new URL('../src/mac-sticker.ts', import.meta.url), 'utf8');
const storedData = readFileSync(new URL('../src/stored-data.ts', import.meta.url), 'utf8');
const appearanceNotice = readFileSync(
  new URL('../assets/appearance/NOTICE.md', import.meta.url),
  'utf8',
);

describe('物迹账本 distribution identity', () => {
  it('uses the public name, install id, and matching semantic version everywhere', () => {
    expect(manifest.id).toBe('wuji-ledger');
    expect(manifest.name).toBe('物迹账本');
    expect(manifest.version).toBe('0.5.0');
    expect(manifest.description).toContain('locally');
    expect(packageJson.name).toBe('wuji-ledger');
    expect(packageJson.version).toBe(manifest.version);
    expect(storedData).toContain("title: '我的小玩意'");
  });

  it('removes the former public brand from shipped copy', () => {
    const publicSource = source.replace(
      "const LEGACY_MOBILE_SUMMARY_PATH = 'Celtis Asset Ledger/随身摘要.md';",
      '',
    );
    for (const shippedCopy of [
      JSON.stringify(manifest),
      publicSource,
      readme,
      buildConfig,
      stickerSource,
      appearanceNotice,
    ]) {
      expect(shippedCopy).not.toContain('Celtis Asset Ledger');
    }
    expect(appearanceNotice).not.toContain('Celtis supplies');
    expect(source).toContain("const MOBILE_SUMMARY_FOLDER = '物迹账本'");
    expect(source).toContain("const LEGACY_MOBILE_SUMMARY_PATH = 'Celtis Asset Ledger/随身摘要.md'");
    expect(source).toContain('this.migrateLegacyMobileSummary()');
    expect(source).toContain("registerObsidianProtocolHandler('wuji-ledger-widget'");
  });

  it('ships the renamed Apple cutout helper', () => {
    expect(existsSync(new URL('../native/WujiCutout.swift', import.meta.url))).toBe(true);
    expect(buildConfig).not.toContain('swiftc');
    expect(stickerSource).toContain('native/wuji-cutout');
  });

  it('embeds the licensed font and uses host icons without private artwork', () => {
    expect(buildConfig).toContain('data:font/woff2;base64');
    expect(source).toContain("artIcon: 'package'");
    expect(source).toContain("artIcon: 'archive'");
    expect(source).not.toContain('summary-static.png');
    expect(buildConfig).toContain('assets/appearance');
    expect(buildConfig).not.toContain('cp("assets", "dist/assets"');
  });
});
