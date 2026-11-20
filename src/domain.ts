export type LedgerRecordType = 'item' | 'accessory';

export interface LedgerRecord {
  id: string;
  type: LedgerRecordType;
  name: string;
  purchaseDate?: string;
  purchaseCost: number;
  saleIncome?: number;
  archiveDate?: string;
  linkedItemId?: string;
  cover?: string;
  notes?: string;
}

export interface RecordCost {
  net: number;
  days: number | null;
  daily: number;
}

export type ItemRecord = LedgerRecord & { type: 'item' };
export type AccessoryRecord = LedgerRecord & { type: 'accessory' };

export interface ItemCost {
  itemId: string;
  net: number;
  days: number | null;
  baseDaily: number;
  accessoryNet: number;
  accessoryDaily: number;
  value: number;
  daily: number;
}

export interface LedgerSummary {
  activeItems: number;
  archivedItems: number;
  activeValue: number;
  activeDaily: number;
  archivedValue: number;
  archivedDaily: number;
}

export type DayInput = Date | string;

const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function round2(value: number): number {
  const scaled = value * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  const rounded =
    scaled < 0
      ? Math.ceil(scaled - 0.5 - tolerance)
      : Math.floor(scaled + 0.5 + tolerance);

  return normalizeZero(rounded / 100);
}

export function ceil2(value: number): number {
  const scaled = value * 100;
  const nearestInteger = Math.round(scaled);
  const stableScaled =
    Math.abs(scaled - nearestInteger) < 1e-10 ? nearestInteger : scaled;

  return normalizeZero(Math.ceil(stableScaled) / 100);
}

export function inclusiveDays(startDate: string, endDate: DayInput = new Date()): number {
  const startDay = parseCalendarDay(startDate);
  const endDay = parseCalendarDay(toShanghaiDate(endDate));
  const elapsedDays = Math.floor((endDay - startDay) / DAY_IN_MS);

  return Math.max(1, elapsedDays + 1);
}

export function isArchived(record: LedgerRecord): boolean {
  return Boolean(record.archiveDate?.trim());
}

export function getLinkedAccessories(
  itemId: string,
  records: readonly LedgerRecord[],
): AccessoryRecord[] {
  return records.filter(
    (record): record is AccessoryRecord =>
      record.type === 'accessory' && record.linkedItemId === itemId,
  );
}

export function getEffectivePurchaseDate(
  record: LedgerRecord,
  records: readonly LedgerRecord[],
): string | undefined {
  if (record.purchaseDate?.trim()) {
    return record.purchaseDate;
  }

  if (record.type !== 'accessory' || !record.linkedItemId) {
    return undefined;
  }

  const linkedItem = records.find(
    (candidate) => candidate.type === 'item' && candidate.id === record.linkedItemId,
  );
  return linkedItem?.purchaseDate?.trim() ? linkedItem.purchaseDate : undefined;
}

export function isArchiveDateBeforePurchase(
  record: LedgerRecord,
  archiveDate: string | undefined,
  records: readonly LedgerRecord[],
): boolean {
  const purchaseDate = getEffectivePurchaseDate(record, records);
  return Boolean(purchaseDate && archiveDate && archiveDate < purchaseDate);
}

export function resolvePurchaseDateForSave(
  operation: 'create' | 'edit',
  record: LedgerRecord,
  records: readonly LedgerRecord[],
): string | undefined {
  if (operation !== 'create' || record.type !== 'accessory') {
    return record.purchaseDate;
  }

  return getEffectivePurchaseDate(record, records);
}

export function getRecordCost(
  record: LedgerRecord,
  now: DayInput = new Date(),
  records: readonly LedgerRecord[] = [],
): RecordCost {
  const net = round2(record.purchaseCost - (record.saleIncome || 0));
  const purchaseDate = getEffectivePurchaseDate(record, records);

  if (!purchaseDate) {
    return { net, days: null, daily: 0 };
  }

  const days = inclusiveDays(
    purchaseDate,
    isArchived(record) ? record.archiveDate! : now,
  );
  const daily =
    record.type === 'item' && !isArchived(record)
      ? round2(net / days)
      : ceil2(net / days);

  return { net, days, daily };
}

export function getItemCost(
  item: LedgerRecord,
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
): ItemCost {
  if (item.type !== 'item') {
    throw new TypeError(`Expected an item record, received "${item.type}"`);
  }

  const base = getRecordCost(item, now, records);
  const accessories = getLinkedAccessories(item.id, records);
  const accessoryNet = round2(
    accessories.reduce(
      (total, accessory) => total + getRecordCost(accessory, now, records).net,
      0,
    ),
  );
  const accessoryDaily = round2(
    accessories.reduce((total, accessory) => {
      if (isArchived(accessory)) {
        return total;
      }

      const cost = getRecordCost(accessory, now, records);
      return cost.days === null ? total : total + cost.daily;
    }, 0),
  );

  return {
    itemId: item.id,
    net: base.net,
    days: base.days,
    baseDaily: base.daily,
    accessoryNet,
    accessoryDaily,
    value: round2(base.net + accessoryNet),
    daily: round2(base.daily + accessoryDaily),
  };
}

export function getLedgerSummary(
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
): LedgerSummary {
  const summary: LedgerSummary = {
    activeItems: 0,
    archivedItems: 0,
    activeValue: 0,
    activeDaily: 0,
    archivedValue: 0,
    archivedDaily: 0,
  };

  for (const record of records) {
    if (record.type !== 'item') {
      continue;
    }

    const itemCost = getItemCost(record, records, now);
    if (isArchived(record)) {
      summary.archivedItems += 1;
      summary.archivedValue += itemCost.value;
      summary.archivedDaily += itemCost.daily;
    } else {
      summary.activeItems += 1;
      summary.activeValue += itemCost.value;
      summary.activeDaily += itemCost.daily;
    }
  }

  summary.activeValue = round2(summary.activeValue);
  summary.activeDaily = round2(summary.activeDaily);
  summary.archivedValue = round2(summary.archivedValue);
  summary.archivedDaily = round2(summary.archivedDaily);

  return summary;
}

function toShanghaiDate(input: DayInput): string {
  if (typeof input === 'string') {
    parseCalendarDay(input);
    return input;
  }

  if (Number.isNaN(input.getTime())) {
    throw new RangeError('Invalid date');
  }

  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(input);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function parseCalendarDay(value: string): number {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}"`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utcTime = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcTime);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date "${value}"`);
  }

  return utcTime;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
