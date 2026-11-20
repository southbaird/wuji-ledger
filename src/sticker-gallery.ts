import {
  getRecordCost,
  isArchived,
  type DayInput,
  type LedgerRecord,
} from './domain';

export type StickerCollectionFilter = 'all' | 'owned' | 'archived';

export interface StickerDetailModel {
  name: string;
  cover: string;
  state: Exclude<StickerCollectionFilter, 'all'>;
  purchasePrice: number;
  salePrice: number | null;
  days: number | null;
}

export function getStickerCollectionRecords(
  records: readonly LedgerRecord[],
  filter: StickerCollectionFilter,
): LedgerRecord[] {
  return records.filter((record) => {
    if (!record.cover?.trim()) {
      return false;
    }
    if (filter === 'owned') {
      return !isArchived(record);
    }
    if (filter === 'archived') {
      return isArchived(record);
    }
    return true;
  });
}

export function getStickerDetailModel(
  record: LedgerRecord,
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
): StickerDetailModel {
  return {
    name: record.name,
    cover: record.cover?.trim() ?? '',
    state: isArchived(record) ? 'archived' : 'owned',
    purchasePrice: record.purchaseCost,
    salePrice: record.saleIncome ?? null,
    days: getRecordCost(record, now, records).days,
  };
}
