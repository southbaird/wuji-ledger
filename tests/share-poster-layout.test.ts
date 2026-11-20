import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/share-image.ts', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

describe('single-record share poster layout', () => {
  it('uses a frameless sticker composition with artwork followed by text facts', () => {
    const poster = sourceBetween(
      'export async function renderRecordSharePoster(',
      'export async function renderLedgerSharePoster(',
    );

    expect(poster).toContain('createCanvas(1200, 1400)');
    expect(poster).toContain('drawFloatingImage(');
    expect(poster).toContain('drawStickerText(context, model.name');
    expect(poster).toContain("['买入价格', formatMoney(model.purchasePrice)]");
    expect(poster).toContain("['卖出价格', model.salePrice == null ? '未卖出' : formatMoney(model.salePrice)]");
    expect(poster).toContain("['使用天数', model.days == null ? '未设置' : `${model.days} 天`]");
    expect(poster).not.toContain('drawPosterBackground(');
    expect(poster).not.toContain('drawRoundedRect(');
    expect(poster).not.toContain('drawPill(');
    expect(poster).not.toContain('drawFactSticker(');
  });
});

describe('full-ledger share poster layout', () => {
  it('uses the current ledger canvas instead of the old accent gradient', () => {
    const poster = sourceBetween(
      'export async function renderLedgerSharePoster(',
      'async function drawLedgerRecordCard(',
    );
    const background = sourceBetween(
      'function drawLedgerCanvasBackground(',
      'function drawImageSticker(',
    );

    expect(poster).toContain('drawLedgerCanvasBackground(context, width, height, palette)');
    expect(poster).toContain('getLedgerShareScopeLabel(model.scope)');
    expect(background).toContain('context.fillStyle = palette.canvas');
    expect(background).toContain('context.fillStyle = palette.gridDot');
    expect(background).not.toContain('createLinearGradient');
  });
});
