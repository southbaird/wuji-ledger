import { describe, expect, it } from 'vitest';

import type { LedgerRecord } from '../src/domain';
import {
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_THEME,
  WIDGET_LAYOUT_OPTIONS,
  WIDGET_THEME_OPTIONS,
  getMobileWidgetModel,
} from '../src/mobile-widget';

describe('mobile widget choices', () => {
  it('offers three labelled layouts and themes with overview cream defaults', () => {
    expect(DEFAULT_WIDGET_LAYOUT).toBe('overview');
    expect(DEFAULT_WIDGET_THEME).toBe('cream');
    expect(WIDGET_LAYOUT_OPTIONS).toEqual([
      {
        id: 'glance',
        label: '一瞥',
        icon: 'eye',
        description: '用一张卡快速查看最重要的资产数字。',
      },
      {
        id: 'overview',
        label: '概览',
        icon: 'layout-dashboard',
        description: '兼顾资产摘要、重点物品和最近购买。',
      },
      {
        id: 'collection',
        label: '收藏',
        icon: 'images',
        description: '以贴纸商品为主，适合快速浏览收藏。',
      },
    ]);
    expect(WIDGET_THEME_OPTIONS).toEqual([
      {
        id: 'cream',
        label: '奶油贴纸',
        icon: 'sparkles',
        description: '暖白、莓红与浅蓝组成的柔和贴纸风格。',
      },
      {
        id: 'minimal',
        label: '极简账单',
        icon: 'receipt-text',
        description: '弱化插画，用规整数字突出资产信息。',
      },
      {
        id: 'midnight',
        label: '午夜玻璃',
        icon: 'moon-star',
        description: '适合深色模式的克制深灰蓝风格。',
      },
    ]);
  });
});

describe('getMobileWidgetModel', () => {
  it('returns an explicit empty state without fabricating product highlights', () => {
    expect(getMobileWidgetModel([], '2026-08-25')).toEqual({
      isEmpty: true,
      summary: {
        activeItems: 0,
        archivedItems: 0,
        activeValue: 0,
        activeDaily: 0,
        archivedValue: 0,
        archivedDaily: 0,
      },
      highestDailyCost: null,
      recentPurchase: null,
      collectionItems: [],
    });
  });

  it('summarizes the ledger and selects active-item highlights with accessory rollups', () => {
    const records: LedgerRecord[] = [
      item('alpha', 'Alpha', 50, '2026-08-20', 'alpha.webp'),
      {
        id: 'alpha-accessory',
        type: 'accessory',
        name: 'Alpha accessory',
        purchaseDate: '2026-08-20',
        purchaseCost: 10,
        linkedItemId: 'alpha',
      },
      item('beta', 'Beta', 20, '2026-08-24', 'beta.webp'),
      {
        ...item('archived', 'Archived', 1_000, '2026-08-23', 'archived.webp'),
        saleIncome: 900,
        archiveDate: '2026-08-24',
      },
    ];

    const model = getMobileWidgetModel(records, '2026-08-24');

    expect(model.isEmpty).toBe(false);
    expect(model.summary).toEqual({
      activeItems: 2,
      archivedItems: 1,
      activeValue: 80,
      activeDaily: 32,
      archivedValue: 100,
      archivedDaily: 50,
    });
    expect(model.highestDailyCost).toEqual({
      id: 'beta',
      name: 'Beta',
      cover: 'beta.webp',
      purchaseDate: '2026-08-24',
      value: 20,
      daily: 20,
      accessoryCount: 0,
    });
    expect(model.recentPurchase).toEqual(model.highestDailyCost);
  });

  it('returns at most five active collection items ranked by whole-item value with stable ties', () => {
    const records: LedgerRecord[] = [
      item('alpha', 'Alpha', 100, '2026-08-20', 'alpha.webp'),
      item('bravo', 'Bravo', 100, '2026-08-21'),
      item('charlie', 'Charlie', 80, '2026-08-22', 'charlie.webp'),
      item('delta', 'Delta', 60, '2026-08-23'),
      item('echo', 'Echo', 40, '2026-08-24'),
      item('foxtrot', 'Foxtrot', 10, '2026-08-25'),
      {
        id: 'charlie-accessory',
        type: 'accessory',
        name: 'Charlie accessory',
        purchaseDate: '2026-08-22',
        purchaseCost: 30,
        linkedItemId: 'charlie',
      },
      {
        ...item('archived', 'Archived', 1_000),
        archiveDate: '2026-08-25',
      },
    ];

    expect(
      getMobileWidgetModel(records, '2026-08-25').collectionItems.map(
        ({ id, value }) => ({ id, value }),
      ),
    ).toEqual([
      { id: 'charlie', value: 110 },
      { id: 'alpha', value: 100 },
      { id: 'bravo', value: 100 },
      { id: 'delta', value: 60 },
      { id: 'echo', value: 40 },
    ]);
  });

  it('keeps source order for equal highlight ranks without mutating the records', () => {
    const records: LedgerRecord[] = [
      item('bravo', 'Bravo', 100, '2026-08-25'),
      item('alpha', 'Alpha', 100, '2026-08-25'),
    ];
    const before = structuredClone(records);

    const model = getMobileWidgetModel(records, '2026-08-25');

    expect(model.highestDailyCost?.id).toBe('bravo');
    expect(model.recentPurchase?.id).toBe('bravo');
    expect(model.collectionItems.map(({ id }) => id)).toEqual(['bravo', 'alpha']);
    expect(records).toEqual(before);
  });
});

function item(
  id: string,
  name: string,
  purchaseCost: number,
  purchaseDate = '2026-08-24',
  cover?: string,
): LedgerRecord {
  return {
    id,
    type: 'item',
    name,
    purchaseDate,
    purchaseCost,
    cover,
  };
}
