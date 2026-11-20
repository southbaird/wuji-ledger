import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import { initializeAppleSticker, canUseAppleStickerUI } from '../src/mac-sticker';

const state = vi.hoisted(() => ({ isDesktopApp: true, isMacOS: true }));
vi.mock('obsidian', () => ({
  Platform: state, FileSystemAdapter: class {}, TFile: class {}, normalizePath: (path: string) => path, requestUrl: vi.fn(),
}));
const manifest = { id: 'wuji-ledger' } as PluginManifest;
describe('explicitly installed optional helper', () => {
  beforeEach(() => { state.isDesktopApp = true; state.isMacOS = true; });
  function host(exists: ReturnType<typeof vi.fn>): App {
    return { vault: { configDir: 'custom-config', adapter: { exists } } } as unknown as App;
  }
  it('keeps conversion unavailable on a fresh market install', async () => {
    await initializeAppleSticker(host(vi.fn().mockResolvedValue(false)), manifest);
    expect(canUseAppleStickerUI()).toBe(false);
  });
  it('enables an existing helper without installing or downloading it', async () => {
    const exists = vi.fn().mockResolvedValue(true);
    await initializeAppleSticker(host(exists), manifest);
    expect(exists).toHaveBeenCalledWith('custom-config/plugins/wuji-ledger/native/wuji-cutout');
    expect(canUseAppleStickerUI()).toBe(true);
  });
  it('never probes native files on mobile and resets cached availability', async () => {
    const exists = vi.fn().mockResolvedValue(true);
    await initializeAppleSticker(host(exists), manifest);
    state.isDesktopApp = false;
    exists.mockClear();
    await initializeAppleSticker(host(exists), manifest);
    expect(exists).not.toHaveBeenCalled();
    expect(canUseAppleStickerUI()).toBe(false);
  });
  it('survives an inaccessible optional helper', async () => {
    await initializeAppleSticker(host(vi.fn().mockRejectedValue(new Error('denied'))), manifest);
    expect(canUseAppleStickerUI()).toBe(false);
  });
});
