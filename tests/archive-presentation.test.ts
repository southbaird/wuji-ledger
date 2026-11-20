import { describe, expect, it } from 'vitest';

import { getArchiveCardVariant } from '../src/archive-presentation';
import type { LedgerRecord } from '../src/domain';

function archivedRecord(cover?: string): LedgerRecord {
  return {
    id: 'archived-camera',
    type: 'item',
    name: '归档相机',
    purchaseCost: 2_999,
    purchaseDate: '2024-01-01',
    archiveDate: '2026-08-20',
    cover,
  };
}

describe('archive card presentation', () => {
  it('uses a media card only when a real cover is available', () => {
    expect(getArchiveCardVariant(archivedRecord('assets/user/camera-sticker.png')))
      .toBe('media');
    expect(getArchiveCardVariant(archivedRecord('   '))).toBe('classic');
    expect(getArchiveCardVariant(archivedRecord())).toBe('classic');
  });
});
