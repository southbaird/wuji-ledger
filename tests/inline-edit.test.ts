import { describe, expect, it } from 'vitest';

import type { LedgerRecord } from '../src/domain';
import {
  buildInlineEditGroups,
  matchesInlineEditQuery,
} from '../src/inline-edit';

const records: LedgerRecord[] = [
  {
    id: 'phone',
    type: 'item',
    name: '三星 S25',
    notes: '主力手机',
    purchaseCost: 4000,
  },
  {
    id: 'camera',
    type: 'item',
    name: 'Sony Alpha 7 IV',
    notes: '旅行相机',
    purchaseCost: 22000,
  },
  {
    id: 'archived-console',
    type: 'item',
    name: '旧游戏机',
    purchaseCost: 2000,
    archiveDate: '2026-08-20',
  },
  {
    id: 'phone-case',
    type: 'accessory',
    name: '透明手机壳',
    notes: '轻薄',
    purchaseCost: 30,
    linkedItemId: 'phone',
  },
  {
    id: 'phone-film',
    type: 'accessory',
    name: 'AR 膜',
    notes: '防反光',
    purchaseCost: 20,
    linkedItemId: 'phone',
  },
  {
    id: 'archived-phone-cable',
    type: 'accessory',
    name: '旧充电线',
    purchaseCost: 10,
    archiveDate: '2026-08-21',
    linkedItemId: 'phone',
  },
  {
    id: 'camera-tripod',
    type: 'accessory',
    name: '碳纤维三脚架',
    purchaseCost: 1000,
    linkedItemId: 'camera',
  },
  {
    id: 'unlinked-bag',
    type: 'accessory',
    name: '收纳包',
    notes: '通用配件',
    purchaseCost: 50,
  },
  {
    id: 'archived-parent-controller',
    type: 'accessory',
    name: '游戏手柄',
    purchaseCost: 300,
    linkedItemId: 'archived-console',
  },
  {
    id: 'missing-parent-adapter',
    type: 'accessory',
    name: '转接环',
    purchaseCost: 100,
    linkedItemId: 'missing-item',
  },
  {
    id: 'hidden-item',
    type: 'item',
    name: '未列出的显示器',
    purchaseCost: 1500,
  },
  {
    id: 'hidden-item-cable',
    type: 'accessory',
    name: '显示器线材',
    purchaseCost: 60,
    linkedItemId: 'hidden-item',
  },
];

const sortedItems: LedgerRecord[] = [records[1]!, records[0]!, records[2]!, records[0]!];

describe('inline edit grouping', () => {
  it('keeps the supplied item order and places active accessories immediately under each item', () => {
    const result = buildInlineEditGroups(records, sortedItems, '');

    expect(result.groups.map((group) => group.item.id)).toEqual(['camera', 'phone']);
    expect(result.groups.map((group) => group.accessories.map((accessory) => accessory.id))).toEqual([
      ['camera-tripod'],
      ['phone-case', 'phone-film'],
    ]);
    expect(result.otherAccessories.map((accessory) => accessory.id)).toEqual([
      'unlinked-bag',
      'archived-parent-controller',
      'missing-parent-adapter',
      'hidden-item-cable',
    ]);
  });

  it('shows every active child when the parent item matches the search', () => {
    const result = buildInlineEditGroups(records, sortedItems, '主力手机');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.item.id).toBe('phone');
    expect(result.groups[0]?.accessories.map((accessory) => accessory.id)).toEqual([
      'phone-case',
      'phone-film',
    ]);
    expect(result.otherAccessories).toEqual([]);
  });

  it('shows the parent and only matching active children when an accessory matches', () => {
    const result = buildInlineEditGroups(records, sortedItems, '防反光');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.item.id).toBe('phone');
    expect(result.groups[0]?.accessories.map((accessory) => accessory.id)).toEqual([
      'phone-film',
    ]);
    expect(result.otherAccessories).toEqual([]);
  });

  it('puts only matching active ungrouped accessories into otherAccessories during search', () => {
    const result = buildInlineEditGroups(records, sortedItems, '通用配件');

    expect(result.groups).toEqual([]);
    expect(result.otherAccessories.map((accessory) => accessory.id)).toEqual(['unlinked-bag']);
  });

  it('never returns archived accessories or archived and duplicate item rows', () => {
    const result = buildInlineEditGroups(records, sortedItems, '旧');

    expect(result.groups).toEqual([]);
    expect(result.otherAccessories).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('archived-phone-cable');
    expect(JSON.stringify(result)).not.toContain('archived-console');
  });
});

describe('inline edit search matching', () => {
  it('matches name and notes with the same trimmed locale-insensitive behavior as the view', () => {
    expect(matchesInlineEditQuery(records[1]!, '  sony alpha  ')).toBe(true);
    expect(matchesInlineEditQuery(records[0]!, '主力')).toBe(true);
    expect(matchesInlineEditQuery(records[0]!, '相机')).toBe(false);
    expect(matchesInlineEditQuery(records[0]!, '   ')).toBe(true);
  });
});
