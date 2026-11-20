import { readFileSync } from 'node:fs';
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

describe('item relationship UI', () => {
  it('shows only positive accessory counts at the right of the gallery date row', () => {
    const card = sourceBetween('private renderItemCard(', 'private renderEditTable(');
    const nameAt = card.indexOf("name.createEl('strong', { text: item.name })");
    const metadataAt = card.indexOf("cls: 'celtis-ledger-item-meta'");
    const dateAt = card.indexOf("cls: 'celtis-ledger-item-date'");
    const countAt = card.indexOf('renderAccessoryCount(metadata, accessoryCount)');
    const valueAt = card.indexOf("renderMetricRow(body, '价值'");

    expect(card).toContain('const accessoryCount = getLinkedAccessories(item.id, records).length');
    expect(card).toContain("const relationLabel = accessoryCount > 0");
    expect(card).toContain('if (accessoryCount > 0)');
    expect(nameAt).toBeGreaterThanOrEqual(0);
    expect(metadataAt).toBeGreaterThan(nameAt);
    expect(dateAt).toBeGreaterThan(metadataAt);
    expect(countAt).toBeGreaterThan(dateAt);
    expect(valueAt).toBeGreaterThan(countAt);
    expect(source).toMatch(
      /function renderAccessoryCount\([\s\S]*?if \(count <= 0\) \{\s*return;\s*\}/,
    );
  });

  it('adds a bottom detail action that opens a prelinked accessory form for active items', () => {
    const drawer = sourceBetween('private renderDrawer(', 'private renderDetailMetrics(');

    expect(drawer).toContain("cls: 'celtis-ledger-linked-actions'");
    expect(drawer).toContain("createActionButton(linkedActions, 'wrench', '添加配件'");
    expect(drawer).toContain("this.plugin.openCreateModal('accessory', { linkedItemId: record.id })");
    expect(drawer).toContain("new Notice('请先保存当前修改，再添加配件')");
    expect(drawer).toContain('if (!isArchived(record))');
  });

  it('uses a media archive card with a cover and the classic icon layout without one', () => {
    const archiveCard = sourceBetween('private renderArchiveCard(', 'private renderSectionHeader(');
    expect(archiveCard).toContain('const variant = getArchiveCardVariant(record)');
    expect(archiveCard).toContain("variant === 'media'");
    expect(archiveCard).toContain("card.addClass('has-cover')");
    expect(archiveCard).toContain("card.addClass('is-classic')");
    expect(archiveCard).toContain("setIcon(name.createSpan(), record.type === 'item' ? 'package' : 'wrench')");
    expect(styles).toContain('.celtis-ledger-record-thumbnail.is-archive-cover');
    expect(styles).toMatch(
      /\.celtis-ledger-archive-card\.has-cover[^}]*grid-template-columns:\s*76px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-archive-card\.is-classic[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
  });

  it('preselects a valid active parent and immediately inherits its purchase date', () => {
    const editor = sourceBetween('class RecordEditorModal extends Modal', 'class ArchiveRecordModal');

    expect(source).toContain('interface CreateRecordOptions');
    expect(source).toContain('openCreateModal(type: LedgerRecordType, options: CreateRecordOptions = {})');
    expect(editor).toContain('private readonly options: CreateRecordOptions');
    expect(editor).toContain('record.id === this.options.linkedItemId');
    expect(editor).toContain('linkedItemId: linkedItem?.id');
    expect(editor).toContain("form.linkedItemId.addEventListener('change', syncInheritedPurchaseDate)");
    expect(editor).toContain('syncInheritedPurchaseDate();');
  });

  it('keeps accessory metadata compact and makes the detail action responsive', () => {
    expect(styles).toContain('.celtis-ledger-item-meta');
    expect(styles).toMatch(/\.celtis-ledger-item-meta[^}]*justify-content:\s*space-between;/s);
    expect(styles).toContain('.celtis-ledger-item-accessories');
    expect(styles).toMatch(
      /\.celtis-ledger-item-meta\s*>\s*\.celtis-ledger-item-accessories[^}]*margin-inline-start:\s*auto;/s,
    );
    expect(styles).toMatch(/\.celtis-ledger-item-accessories[^}]*font-variant-numeric:\s*tabular-nums;/s);
    expect(styles).toMatch(/\.celtis-ledger-item-accessories[^}]*white-space:\s*nowrap;/s);
    expect(styles).toContain('.celtis-ledger-linked-actions');
    expect(styles).toMatch(/@container celtis-ledger \(max-width: 639px\)[\s\S]*\.celtis-ledger-linked-actions \.celtis-ledger-button[^{]*\{[^}]*width:\s*100%;/s);
  });
});
