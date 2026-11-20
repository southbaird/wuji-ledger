import { describe, expect, it } from 'vitest';

import type { LedgerRecord } from '../src/domain';
import {
  buildLedgerShareModel,
  buildRecordShareModel,
  copyPngBlob,
} from '../src/share-image';

const records: LedgerRecord[] = [
  {
    id: 'camera',
    type: 'item',
    name: '随身相机',
    purchaseDate: '2026-08-01',
    purchaseCost: 3_000,
    cover: 'assets/user/camera-sticker.png',
  },
  {
    id: 'strap',
    type: 'accessory',
    name: '相机腕带',
    purchaseCost: 100,
    linkedItemId: 'camera',
  },
  {
    id: 'phone',
    type: 'item',
    name: '旧手机',
    purchaseDate: '2026-07-01',
    purchaseCost: 5_000,
    saleIncome: 3_500,
    archiveDate: '2026-08-20',
  },
];

describe('image sharing models', () => {
  it('builds one image-only share card from the requested record facts', () => {
    expect(buildRecordShareModel(records[0]!, records, '2026-08-26')).toEqual({
      id: 'camera',
      name: '随身相机',
      type: 'item',
      state: 'owned',
      cover: 'assets/user/camera-sticker.png',
      purchasePrice: 3_000,
      salePrice: null,
      days: 26,
      dailyCost: 119.23,
    });
  });

  it('keeps every record in the full-ledger poster, including records without images', () => {
    const model = buildLedgerShareModel('我的物迹', records, '2026-08-26');

    expect(model.title).toBe('我的物迹');
    expect(model.records.map((record) => record.id)).toEqual(['camera', 'strap', 'phone']);
    expect(model.records.filter((record) => !record.cover)).toHaveLength(2);
    expect(model.counts).toEqual({ total: 3, owned: 2, archived: 1 });
    expect(model.summary.activeItems).toBe(1);
    expect(model.summary.archivedItems).toBe(1);
  });

  it('builds owned and archived sharing scopes from the same ledger', () => {
    const owned = buildLedgerShareModel('我的物迹', records, '2026-08-26', 'owned');
    const archived = buildLedgerShareModel('我的物迹', records, '2026-08-26', 'archived');

    expect(owned.scope).toBe('owned');
    expect(owned.records.map((record) => record.id)).toEqual(['camera', 'strap']);
    expect(owned.counts).toEqual({ total: 2, owned: 2, archived: 0 });
    expect(owned.summary.activeItems).toBe(1);
    expect(owned.summary.archivedItems).toBe(0);

    expect(archived.scope).toBe('archived');
    expect(archived.records.map((record) => record.id)).toEqual(['phone']);
    expect(archived.counts).toEqual({ total: 1, owned: 0, archived: 1 });
    expect(archived.summary.activeItems).toBe(0);
    expect(archived.summary.archivedItems).toBe(1);
  });

  it('copies PNG binary data to the clipboard instead of copying a URL or text', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' });
    const writes: unknown[][] = [];

    await copyPngBlob(png, {
      clipboard: {
        write: async (items) => {
          writes.push(items);
        },
      },
      createClipboardItem: (payload) => payload,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toHaveLength(1);
    expect(writes[0]?.[0]).toEqual({ 'image/png': png });
  });
});
