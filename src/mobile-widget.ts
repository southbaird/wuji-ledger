import {
  getItemCost,
  getLedgerSummary,
  getLinkedAccessories,
  isArchived,
  type DayInput,
  type LedgerRecord,
  type LedgerSummary,
} from './domain';

export type WidgetLayout = 'glance' | 'overview' | 'collection';
export type WidgetTheme = 'cream' | 'minimal' | 'midnight';

export interface WidgetOption<T extends string> {
  id: T;
  label: string;
  icon: string;
  description: string;
}

export const WIDGET_LAYOUT_OPTIONS = [
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
] as const satisfies readonly WidgetOption<WidgetLayout>[];

export const WIDGET_THEME_OPTIONS = [
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
] as const satisfies readonly WidgetOption<WidgetTheme>[];

export const DEFAULT_WIDGET_LAYOUT: WidgetLayout = 'overview';
export const DEFAULT_WIDGET_THEME: WidgetTheme = 'cream';

export interface MobileWidgetItem {
  id: string;
  name: string;
  cover?: string;
  purchaseDate?: string;
  value: number;
  daily: number;
  accessoryCount: number;
}

export interface MobileWidgetModel {
  isEmpty: boolean;
  summary: LedgerSummary;
  highestDailyCost: MobileWidgetItem | null;
  recentPurchase: MobileWidgetItem | null;
  collectionItems: MobileWidgetItem[];
}

export function getMobileWidgetModel(
  records: readonly LedgerRecord[],
  now: DayInput,
): MobileWidgetModel {
  const activeItems = records
    .map((record, sourceIndex) => ({ record, sourceIndex }))
    .filter(
      ({ record }) => record.type === 'item' && !isArchived(record),
    )
    .map(({ record, sourceIndex }) => {
      const cost = getItemCost(record, records, now);
      const cover = record.cover?.trim();
      const purchaseDate = record.purchaseDate?.trim();

      return {
        sourceIndex,
        item: {
          id: record.id,
          name: record.name,
          ...(cover ? { cover } : {}),
          ...(purchaseDate ? { purchaseDate } : {}),
          value: cost.value,
          daily: cost.daily,
          accessoryCount: getLinkedAccessories(record.id, records).length,
        } satisfies MobileWidgetItem,
      };
    });
  const highestDailyCost = [...activeItems].sort(
    (left, right) =>
      right.item.daily - left.item.daily || left.sourceIndex - right.sourceIndex,
  )[0]?.item ?? null;
  const recentPurchase = [...activeItems]
    .filter(({ item }) => item.purchaseDate !== undefined)
    .sort(
      (left, right) =>
        right.item.purchaseDate!.localeCompare(left.item.purchaseDate!) ||
        left.sourceIndex - right.sourceIndex,
    )[0]?.item ?? null;
  const collectionItems = [...activeItems]
    .sort(
      (left, right) =>
        right.item.value - left.item.value || left.sourceIndex - right.sourceIndex,
    )
    .slice(0, 5)
    .map(({ item }) => item);

  return {
    isEmpty: !records.some((record) => record.type === 'item'),
    summary: getLedgerSummary(records, now),
    highestDailyCost,
    recentPurchase,
    collectionItems,
  };
}
