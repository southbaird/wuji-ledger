import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

describe('sticker gallery UI', () => {
  it('renders a sticker collection after the archive area for every ledger status view', () => {
    const render = sourceBetween('render(): void', 'private attachBloub(');
    const archiveAt = render.indexOf('this.renderArchive(main, records, now)');
    const stickersAt = render.indexOf('this.renderStickerCollection(main, records, now)');

    expect(archiveAt).toBeGreaterThanOrEqual(0);
    expect(stickersAt).toBeGreaterThan(archiveAt);
    expect(render.slice(stickersAt - 80, stickersAt)).not.toContain("statusFilter !==");
  });

  it('switches All, Owned, and Archived locally without rebuilding the ledger', () => {
    const collection = sourceBetween(
      'private renderStickerCollection(',
      'private renderArchiveCard(',
    );

    expect(collection).toContain("{ value: 'all', label: '全部' }");
    expect(collection).toContain("{ value: 'owned', label: '拥有' }");
    expect(collection).toContain("{ value: 'archived', label: '归档' }");
    expect(collection).toContain("attr: { role: 'tablist', 'aria-label': '贴纸分类' }");
    expect(collection).toContain("button.dataset.stickerFilter = option.value");
    expect(collection).toContain('renderGrid();');
    expect(collection).not.toContain('this.render();');
  });

  it('presents artwork directly on a dark sticker board without permanent card copy', () => {
    const collection = sourceBetween(
      'private renderStickerCollection(',
      'private renderArchiveCard(',
    );
    const card = sourceBetween(
      'private renderStickerCollectionCard(',
      'private renderArchiveCard(',
    );

    expect(collection).toContain("section.createDiv({ cls: 'celtis-ledger-sticker-board' })");
    expect(card).toContain('renderStickerArtwork(card, record, this.plugin)');
    expect(card).not.toContain('celtis-ledger-sticker-card-copy');
    expect(styles).toContain('--celtis-sticker-board: #74475b');
    expect(styles).toContain('--celtis-sticker-board: #765446');
    expect(styles).toContain('--celtis-sticker-board: #356a67');
    expect(styles).toContain('--celtis-sticker-board: #28243a');
    expect(styles).toMatch(
      /\.celtis-ledger-sticker-board\s*\{[^}]*background:[^}]*var\(--celtis-sticker-board\)/s,
    );
    expect(styles).not.toMatch(
      /\.celtis-ledger-sticker-board\s*\{[^}]*#17181d/s,
    );
    expect(styles).toMatch(
      /button\.celtis-ledger-sticker-card\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
  });

  it('opens a frameless floating sticker with one typographic sticker for the requested facts', () => {
    const card = sourceBetween(
      'private renderStickerCollectionCard(',
      'private renderArchiveCard(',
    );
    const modal = sourceBetween(
      'class StickerDetailModal extends Modal',
      'class ShareImageModal extends Modal',
    );

    expect(card).toContain('renderStickerArtwork(card, record, this.plugin)');
    expect(card).toContain('new StickerDetailModal(this.app, this.plugin, record, records, now).open()');
    expect(modal).toContain('getStickerDetailModel(this.record, this.records, this.now)');
    expect(modal).toContain("this.containerEl.addClass('celtis-ledger-sticker-detail-layer')");
    expect(modal).toContain("cls: 'celtis-ledger-sticker-detail-copy'");
    expect(modal).toMatch(/renderStickerFact\(\s*facts,\s*'买入价格'/);
    expect(modal).toMatch(/renderStickerFact\(\s*facts,\s*'卖出价格'/);
    expect(modal).toMatch(/renderStickerFact\(\s*facts,\s*'使用天数'/);
    expect(modal).not.toContain('renderDetailMetric(');
    expect(modal).not.toContain('celtis-ledger-sticker-detail-state');
    expect(modal).not.toContain('celtis-ledger-modal-actions');
    expect(styles).toMatch(
      /\.celtis-ledger-sticker-detail-art[^}]*display:\s*grid;[^}]*place-items:\s*center;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-sticker-detail-name[^}]*text-align:\s*center;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-sticker-detail-name\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*-webkit-text-stroke:/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-sticker-detail-fact\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*-webkit-text-stroke:/s,
    );
    expect(styles).toMatch(
      /\.modal\.celtis-asset-ledger-root\.celtis-ledger-sticker-detail-shell\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
  });

  it('bundles the distinctive sticker-label font locally with its license', () => {
    const fontUrl = new URL(
      '../assets/appearance/SmileySans-Oblique.ttf.woff2',
      import.meta.url,
    );
    const licenseUrl = new URL(
      '../assets/appearance/LICENSE-smiley-sans.txt',
      import.meta.url,
    );

    expect(styles).toContain('@font-face');
    expect(styles).toContain('font-family: "Wuji Smiley Sans"');
    expect(styles).toContain(
      'url("assets/appearance/SmileySans-Oblique.ttf.woff2") format("woff2")',
    );
    expect(styles).toContain('font-display: swap');
    expect(existsSync(fontUrl)).toBe(true);
    expect(statSync(fontUrl).size).toBeGreaterThan(1_000_000);
    expect(existsSync(licenseUrl)).toBe(true);
  });
});
