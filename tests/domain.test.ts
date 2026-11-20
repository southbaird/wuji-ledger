import { describe, expect, it } from 'vitest';
import { getItemCost, getRecordCost, getLedgerSummary, getEffectivePurchaseDate,
  inclusiveDays, resolvePurchaseDateForSave, isArchiveDateBeforePurchase, type LedgerRecord } from '../src/domain';

// Invented regression examples, never copied from an actual ledger.
const item: LedgerRecord = { id: 'demo-item', type: 'item', name: '示例物品', purchaseCost: 100, purchaseDate: '2024-01-01' };
const extra: LedgerRecord = { id: 'demo-extra', type: 'accessory', name: '示例配件', purchaseCost: 20, linkedItemId: item.id };
const now = '2024-01-10';

describe('cost and relationship rules with synthetic data', () => {
  it('counts both calendar endpoints', () => expect(inclusiveDays(item.purchaseDate!, now)).toBe(10));
  it('uses Shanghai natural days at a UTC boundary', () => {
    expect(inclusiveDays('2024-01-01', new Date('2024-01-01T16:01:00Z'))).toBe(2);
  });
  it('uses the parent date without mutating an accessory', () => {
    expect(getEffectivePurchaseDate(extra, [item, extra])).toBe(item.purchaseDate);
    expect(getRecordCost(extra, now, [item, extra])).toEqual({ net: 20, days: 10, daily: 2 });
    expect(extra.purchaseDate).toBeUndefined();
  });
  it('prefers an explicit accessory date', () => {
    expect(getRecordCost({ ...extra, purchaseDate: '2024-01-09' }, now, [item])).toEqual({ net: 20, days: 2, daily: 10 });
  });
  it('leaves unlinked and orphan dates empty', () => {
    expect(getEffectivePurchaseDate(extra, [])).toBeUndefined();
    expect(getRecordCost({ ...extra, linkedItemId: undefined }, now)).toEqual({ net: 20, days: null, daily: 0 });
  });
  it('rolls accessories into their item without double counting', () => {
    const records = [item, extra, { ...extra, id: 'unlinked', linkedItemId: undefined, purchaseCost: 300 }];
    expect(getItemCost(item, records, now)).toMatchObject({ value: 120, daily: 12 });
    expect(getLedgerSummary(records, now)).toMatchObject({ activeItems: 1, activeValue: 120, activeDaily: 12 });
  });
  it('stops archived cost on its archive date and allows profit', () => {
    const archived = { ...item, saleIncome: 130, archiveDate: '2024-01-03' };
    expect(getRecordCost(archived, now)).toEqual({ net: -30, days: 3, daily: -10 });
    expect(getLedgerSummary([archived], now)).toMatchObject({ activeItems: 0, archivedItems: 1, archivedValue: -30 });
  });
  it('rounds active item halves and rounds accessory costs up', () => {
    expect(getRecordCost({ ...item, purchaseCost: 4.27, purchaseDate: '2024-01-09' }, now).daily).toBe(2.14);
    expect(getRecordCost({ ...extra, purchaseCost: 1, purchaseDate: '2024-01-08' }, now).daily).toBe(0.34);
  });
  it('inherits a date only on creation, never silently during editing', () => {
    expect(resolvePurchaseDateForSave('create', extra, [item])).toBe(item.purchaseDate);
    expect(resolvePurchaseDateForSave('edit', extra, [item])).toBeUndefined();
  });
  it('validates archive dates against an inherited purchase date', () => {
    expect(isArchiveDateBeforePurchase(extra, '2023-12-31', [item])).toBe(true);
    expect(isArchiveDateBeforePurchase(extra, item.purchaseDate, [item])).toBe(false);
  });
});
