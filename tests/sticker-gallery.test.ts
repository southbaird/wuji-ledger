import { describe, expect, it } from 'vitest';

import type { LedgerRecord } from '../src/domain';
import {
  getStickerCollectionRecords,
  getStickerDetailModel,
} from '../src/sticker-gallery';

const records: LedgerRecord[] = [
  {
    id: 'active-item',
    type: 'item',
    name: '在用相机',
    purchaseDate: '2026-08-01',
    purchaseCost: 5200,
    cover: 'assets/user/camera-sticker.png',
  },
  {
    id: 'archived-item',
    type: 'item',
    name: '已归档主机',
    purchaseDate: '2025-01-01',
    purchaseCost: 8999,
    saleIncome: 6200,
    archiveDate: '2026-07-01',
    cover: 'assets/user/console-sticker.png',
  },
  {
    id: 'active-accessory',
    type: 'accessory',
    name: '在用镜头',
    purchaseDate: '2026-06-10',
    purchaseCost: 1800,
    cover: ' https://example.com/lens.webp ',
  },
  {
    id: 'without-cover',
    type: 'item',
    name: '没有贴纸',
    purchaseDate: '2026-08-02',
    purchaseCost: 100,
  },
];

describe('sticker collection', () => {
  it('shows only records with artwork and filters them as all, owned, or archived', () => {
    expect(getStickerCollectionRecords(records, 'all').map((record) => record.id)).toEqual([
      'active-item',
      'archived-item',
      'active-accessory',
    ]);
    expect(getStickerCollectionRecords(records, 'owned').map((record) => record.id)).toEqual([
      'active-item',
      'active-accessory',
    ]);
    expect(getStickerCollectionRecords(records, 'archived').map((record) => record.id)).toEqual([
      'archived-item',
    ]);
  });

  it('exposes only the purchase price, sale price, and lived days needed by sticker details', () => {
    const archived = records[1]!;
    expect(getStickerDetailModel(archived, records, '2026-08-26')).toEqual({
      name: '已归档主机',
      cover: 'assets/user/console-sticker.png',
      state: 'archived',
      purchasePrice: 8999,
      salePrice: 6200,
      days: 547,
    });

    const active = records[0]!;
    expect(getStickerDetailModel(active, records, '2026-08-26')).toEqual({
      name: '在用相机',
      cover: 'assets/user/camera-sticker.png',
      state: 'owned',
      purchasePrice: 5200,
      salePrice: null,
      days: 26,
    });
  });
});
