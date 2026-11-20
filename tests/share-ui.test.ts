import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return main.slice(from, to);
}

describe('image sharing UI', () => {
  it('offers a full-ledger image poster from the header', () => {
    const header = sourceBetween('private renderHeader(', 'private renderColorThemeControl(');

    expect(header).toContain("'share-2', '分享全部'");
    expect(header).toContain("new ShareImageModal(this.app, this.plugin, { kind: 'ledger' }).open()");
  });

  it('offers direct image copy only for covered records and a poster for every record', () => {
    const drawer = sourceBetween('private renderDrawer(', 'private renderDetailMetrics(');

    expect(drawer).toContain('if (record.cover?.trim())');
    expect(drawer).toContain("'copy', '复制原图'");
    expect(drawer).toContain('this.plugin.copyRecordCover(record)');
    expect(drawer).toContain("'share-2', '分享卡片'");
    expect(drawer).toContain("new ShareImageModal(this.app, this.plugin, { kind: 'record'");
  });

  it('previews a generated PNG and exposes only image copy and system share actions', () => {
    const modal = sourceBetween('class ShareImageModal extends Modal', 'class AssetWidgetView');

    expect(modal).toContain("cls: 'celtis-ledger-share-preview'");
    expect(modal).toContain("cls: 'celtis-ledger-share-caption'");
    expect(modal).toContain("cls: 'celtis-ledger-share-actions'");
    expect(modal).toMatch(/this\.modalEl\.setAttr\(\s*'aria-label'/);
    expect(modal).toContain("'copy', '复制图片'");
    expect(modal).toContain("'share-2', '系统分享'");
    expect(modal).toContain('copyPngBlob(this.poster)');
    expect(modal).toContain('sharePngBlob(this.poster');
    expect(modal).not.toContain('writeText');
    expect(modal).not.toContain('celtis-ledger-share-heading');

    expect(styles).toMatch(
      /\.modal\.celtis-asset-ledger-root\.celtis-ledger-share-shell\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-preview\s*\{[^}]*overflow:\s*visible;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-preview img\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*min\(72dvh,\s*760px\);[^}]*object-fit:\s*contain;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-actions \.celtis-ledger-button\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;/s,
    );
  });

  it('lets full-ledger sharing switch between all, owned items, and archived records', () => {
    const modal = sourceBetween('class ShareImageModal extends Modal', 'class AssetWidgetView');

    expect(modal).toContain("private ledgerScope: LedgerShareScope = 'all'");
    expect(modal).toContain("attr: { role: 'tablist', 'aria-label': '分享范围' }");
    expect(modal).toContain("{ value: 'all', label: '全部'");
    expect(modal).toContain("{ value: 'owned', label: '物品'");
    expect(modal).toContain("{ value: 'archived', label: '归档'");
    expect(modal).toContain("role: 'tab'");
    expect(modal).toContain("'aria-selected': String(this.ledgerScope === option.value)");
    expect(modal).toContain('this.ledgerScope = option.value');
    expect(modal).toContain('this.plugin.createLedgerSharePoster(this.ledgerScope)');

    expect(styles).toMatch(
      /\.celtis-ledger-share-stage\s*\{[^}]*grid-template-columns:\s*92px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-scope\s*\{[^}]*position:\s*sticky;[^}]*display:\s*grid;/s,
    );
  });

  it('uses the ledger canvas and theme-aware ink throughout the share preview', () => {
    expect(styles).toMatch(
      /\.modal-container\.celtis-ledger-share-layer \.modal-bg\s*\{[^}]*background-color:\s*#f1f3f4;[^}]*background-image:\s*radial-gradient/s,
    );
    expect(styles).toMatch(
      /\.modal-container\.celtis-ledger-share-layer:has\(\.is-ledger-theme-almond\) \.modal-bg\s*\{[^}]*background-color:\s*#f3efe8;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-caption\s*\{[^}]*color:\s*var\(--celtis-ink\);/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-share-actions \.celtis-ledger-button\s*\{[^}]*color:\s*var\(--celtis-ink-soft\)\s*!important;/s,
    );
    expect(styles).not.toContain('background: rgb(77 44 59 / 0.68)');
  });
});
