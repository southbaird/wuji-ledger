import {
  inclusiveDays,
  isArchived,
  isArchiveDateBeforePurchase,
  type LedgerRecord,
} from './domain';

export interface ArchiveDraft {
  archiveDate: string;
  saleIncome: string;
}

/** Validated again against the current record inside the persistence queue. */
export function applyArchiveDraft(
  record: LedgerRecord,
  records: readonly LedgerRecord[],
  draft: ArchiveDraft,
): LedgerRecord {
  if (isArchived(record)) {
    throw new Error('这件物品已经归档，请关闭窗口后查看最新状态');
  }
  try {
    inclusiveDays(draft.archiveDate, draft.archiveDate);
  } catch {
    throw new Error('请选择有效的归档日期');
  }
  if (isArchiveDateBeforePurchase(record, draft.archiveDate, records)) {
    throw new Error('归档日期不能早于购买日期');
  }
  const value = draft.saleIncome.trim();
  const saleIncome = value ? Number(value) : undefined;
  if (saleIncome !== undefined && (!Number.isFinite(saleIncome) || saleIncome < 0)) {
    throw new Error('卖出价格请输入大于或等于 0 的金额');
  }
  return { ...record, archiveDate: draft.archiveDate, saleIncome };
}
