import { describe, expect, it } from 'vitest';
import { applyArchiveDraft } from '../src/quick-archive';
import { getRecordCost, type LedgerRecord } from '../src/domain';

const item: LedgerRecord = {
  id: 'phone', type: 'item', name: '手机', purchaseDate: '2026-09-01',
  purchaseCost: 3000, cover: 'assets/phone.png', notes: '保修到明年',
};
const accessory: LedgerRecord = {
  id: 'case', type: 'accessory', name: '保护壳', purchaseCost: 60, linkedItemId: item.id,
};
const records = [item, accessory];

describe('quick archive confirmation', () => {
  it('archives one record and retains the cover, notes, and accessory state', () => {
    const result = applyArchiveDraft(item, records, { archiveDate: '2026-09-12', saleIncome: '2500.50' });
    expect(result).toEqual({ ...item, archiveDate: '2026-09-12', saleIncome: 2500.5 });
    expect(item.archiveDate).toBeUndefined();
    expect(accessory.archiveDate).toBeUndefined();
    expect(getRecordCost(result, '2026-10-01', records)).toEqual({ net: 499.5, days: 12, daily: 41.63 });
  });

  it.each(['', '  '])('can archive without a sale, preserving the distinction from zero (%j)', (saleIncome) => {
    expect(applyArchiveDraft(item, records, { archiveDate: '2026-09-12', saleIncome }).saleIncome).toBeUndefined();
    expect(applyArchiveDraft(item, records, { archiveDate: '2026-09-12', saleIncome: '0' }).saleIncome).toBe(0);
  });

  it('allows a sale above purchase cost and preserves negative actual cost', () => {
    const result = applyArchiveDraft(item, records, { archiveDate: '2026-09-12', saleIncome: '3200' });
    expect(getRecordCost(result, '2026-09-12', records).net).toBe(-200);
  });

  it.each(['-1', 'not a number', 'Infinity', 'NaN'])('rejects invalid sale amount %s', (saleIncome) => {
    expect(() => applyArchiveDraft(item, records, { archiveDate: '2026-09-12', saleIncome })).toThrow('卖出价格');
  });

  it.each(['', '2026-02-30', '2026-13-01', 'invalid'])('rejects invalid archive date %s', (archiveDate) => {
    expect(() => applyArchiveDraft(item, records, { archiveDate, saleIncome: '' })).toThrow('归档日期');
  });

  it('checks inherited purchase dates when archiving an accessory', () => {
    expect(() => applyArchiveDraft(accessory, records, { archiveDate: '2026-08-31', saleIncome: '10' })).toThrow('早于购买日期');
    const result = applyArchiveDraft(accessory, records, { archiveDate: '2026-09-12', saleIncome: '10' });
    expect(result.linkedItemId).toBe(item.id);
    expect(getRecordCost(result, '2026-09-12', records).days).toBe(12);
  });

  it('revalidates the latest purchase date and rejects a repeated archive', () => {
    const changed = { ...item, purchaseDate: '2026-09-15' };
    expect(() => applyArchiveDraft(changed, [changed, accessory], { archiveDate: '2026-09-12', saleIncome: '100' })).toThrow('早于购买日期');
    const archived = { ...item, archiveDate: '2026-09-11', saleIncome: 2000 };
    expect(() => applyArchiveDraft(archived, [archived], { archiveDate: '2026-09-12', saleIncome: '100' })).toThrow('已经归档');
    expect(archived.saleIncome).toBe(2000);
  });
});
