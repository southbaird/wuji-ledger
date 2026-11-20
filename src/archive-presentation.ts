import type { LedgerRecord } from './domain';

export type ArchiveCardVariant = 'media' | 'classic';

export function getArchiveCardVariant(record: LedgerRecord): ArchiveCardVariant {
  return record.cover?.trim() ? 'media' : 'classic';
}
