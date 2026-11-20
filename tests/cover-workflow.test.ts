import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../src/cover-tools.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('cover editing workflow', () => {
  it('lets the drawer finish its exit motion before refreshing saved data underneath it', () => {
    expect(main).toMatch(
      /upsertRecord\(updated,\s*\{[\s\S]{0,420}?refresh:\s*false[\s\S]{0,1200}?await this\.closeDrawer\(\)[\s\S]{0,180}?this\.plugin\.refreshDataViews\(\)/,
    );
    expect(main).toContain('private closeDrawer(): Promise<void>');
    expect(main).toContain("event.propertyName === 'transform'");
    expect(main).toMatch(
      /!overlay\.isConnected[\s\S]{0,180}?this\.drawerOverlay\s*!==\s*overlay[\s\S]{0,180}?this\.selectedRecordId\s*!==\s*record\.id/,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-drawer-overlay\.is-closing\s+\.celtis-ledger-drawer[^}]*transform:\s*translate3d\(100%, 0, 0\);/s,
    );
  });

  it('accepts pasted image files without hijacking normal URL paste', () => {
    expect(tools).toContain("cover.addEventListener('paste'");
    expect(tools).toContain("item.kind !== 'file'");
    expect(tools).toContain("startsWith('image/')");
    expect(tools).toMatch(
      /if \(files\.length === 0\) \{\s*return;\s*\}\s*event\.preventDefault\(\)/,
    );
    expect(tools).toContain('plugin.importCoverImage(file)');
  });

  it('keeps automatic subject lifting Mac-only while offering ordinary image input on mobile', () => {
    expect(tools).toContain('if (canUseAppleStickerUI())');
    expect(tools).toContain('Platform.isIosApp');
    expect(tools).toContain('自动抠图仅支持 Mac');
    expect(tools.indexOf("type: 'file'")).toBeLessThan(tools.indexOf('if (canUseAppleStickerUI())'));
  });

  it('offers a reusable-cover picker from the shared form used by archived records', () => {
    expect(tools).toContain('复用台账图片');
    expect(tools).toContain('plugin.openExistingCoverPicker');
    expect(main).toContain('class ExistingCoverPickerModal extends Modal');
    expect(main).toContain('getReusableCoverOptions(this.plugin.data.records)');
  });

  it('explicitly centers ordinary previews and reuse thumbnails', () => {
    expect(styles).toMatch(
      /\.celtis-ledger-cover-preview img\s*\{[^}]*display:\s*block;[^}]*place-self:\s*center;[^}]*object-fit:\s*contain;[^}]*object-position:\s*50% 50%;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-cover-library-thumbnail img\s*\{[^}]*place-self:\s*center;[^}]*object-fit:\s*contain;[^}]*object-position:\s*50% 50%;/s,
    );
  });

  it('keeps reusable-cover cards from inheriting Obsidian\'s compact button height', () => {
    expect(styles).toMatch(
      /button\.celtis-ledger-cover-library-option\s*\{[^}]*height:\s*auto\s*!important;[^}]*min-height:\s*164px;[^}]*max-height:\s*none\s*!important;[^}]*block-size:\s*auto\s*!important;/s,
    );
  });

  it('softly settles successful confirmation modals before Obsidian removes them', () => {
    expect(main).toContain('function closeModalAfterConfirm(modal: Modal): Promise<void>');
    expect(main).toMatch(/class RecordEditorModal[\s\S]*?await closeModalAfterConfirm\(this\);/);
    expect(main).toMatch(/class ArchiveRecordModal[\s\S]*?await closeModalAfterConfirm\(this\);/);
    expect(main).toMatch(/class RestoreRecordModal[\s\S]*?await closeModalAfterConfirm\(this\);/);
    expect(styles).toMatch(
      /\.modal\.celtis-ledger-modal-shell\.is-confirm-closing[^}]*opacity:\s*0;[^}]*transform:\s*translate3d\(0, 10px, 0\) scale\(0\.985\);/s,
    );
  });
});
