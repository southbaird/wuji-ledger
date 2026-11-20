import { describe, expect, it } from 'vitest';
import { getLedgerInsights } from '../src/insights';
import type { LedgerRecord } from '../src/domain';

const records: LedgerRecord[] = [
  { id: 'a', type: 'item', name: 'Example A', purchaseCost: 100, purchaseDate: '2024-01-01' },
  { id: 'b', type: 'item', name: 'Example B', purchaseCost: 60, purchaseDate: '2024-01-10' },
  { id: 'x', type: 'accessory', name: 'Example extra', purchaseCost: 20, linkedItemId: 'a' },
  { id: 'old', type: 'item', name: 'Archived example', purchaseCost: 200, purchaseDate: '2023-01-01', archiveDate: '2023-01-02' },
];
describe('insights using invented records', () => {
  it('ranks item rollups and excludes archived items from active leaders', () => {
    const result = getLedgerInsights(records, '2024-01-10');
    expect(result.valueTop5.map((entry) => entry.itemId)).toEqual(['a', 'b']);
    expect(result.valueTop5[0]).toMatchObject({ value: 120, sharePercent: 66.67 });
    expect(result.highlights.highestDaily?.itemId).toBe('b');
    expect(result.highlights.longestHeld?.itemId).toBe('a');
  });
  it('includes archived purchases in yearly totals without accessory duplication', () => {
    expect(getLedgerInsights(records, '2024-01-10').purchaseYears).toEqual([
      { year: 2023, count: 1, totalCost: 200 }, { year: 2024, count: 2, totalCost: 160 },
    ]);
  });
  it('handles an empty ledger', () => {
    const result = getLedgerInsights([], '2024-01-10');
    expect(result.valueTop5).toEqual([]);
    expect(result.highlights).toEqual({ highestValue: null, highestDaily: null, longestHeld: null });
  });
});
