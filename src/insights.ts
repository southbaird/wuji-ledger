import {
  getItemCost,
  isArchived,
  round2,
  type DayInput,
  type LedgerRecord,
} from './domain';

export interface ValueRankingEntry {
  itemId: string;
  name: string;
  value: number;
  share: number;
  sharePercent: number;
}

export interface DailyRankingEntry {
  itemId: string;
  name: string;
  daily: number;
}

export interface PurchaseYearEntry {
  year: number;
  count: number;
  /** Sum of item purchaseCost; sale income and accessories do not alter it. */
  totalCost: number;
}

export type HighlightKind =
  | 'highest-value'
  | 'highest-daily'
  | 'longest-held';
export type HighlightUnit = 'cny' | 'cny-per-day' | 'days';

export interface InsightHighlight {
  kind: HighlightKind;
  itemId: string;
  name: string;
  metric: number;
  unit: HighlightUnit;
  explanation: string;
}

export interface LedgerHighlights {
  highestValue: InsightHighlight | null;
  highestDaily: InsightHighlight | null;
  longestHeld: InsightHighlight | null;
}

/**
 * Chart-ready ledger data. Rankings and highlights contain active items only;
 * purchaseYears contains every dated item, including archived items. An
 * undated item still participates in value/daily rankings, but not purchase
 * years or longest-held. Unlinked accessories never participate on their own.
 * Shares are signed contributions to active net value and are zero when that
 * total is zero.
 */
export interface LedgerInsights {
  valueTop5: ValueRankingEntry[];
  dailyTop5: DailyRankingEntry[];
  purchaseYears: PurchaseYearEntry[];
  highlights: LedgerHighlights;
}

export function getLedgerInsights(
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
): LedgerInsights {
  const activeItems = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.type === 'item' && !isArchived(record))
    .map(({ record, index }) => {
      const cost = getItemCost(record, records, now);

      return {
        itemId: record.id,
        name: record.name,
        value: cost.value,
        daily: cost.daily,
        days: cost.days,
        index,
      };
    });
  const activeTotalValue = round2(
    activeItems.reduce((total, item) => total + item.value, 0),
  );
  const valueRanking = [...activeItems].sort(
    (left, right) => right.value - left.value || left.index - right.index,
  );
  const valueTop5 = valueRanking
    .slice(0, 5)
    .map(({ itemId, name, value }) => {
      const share =
        activeTotalValue === 0 || value === 0 ? 0 : value / activeTotalValue;

      return {
        itemId,
        name,
        value,
        share,
        sharePercent: round2(share * 100),
      };
    });
  const dailyRanking = [...activeItems].sort(
    (left, right) => right.daily - left.daily || left.index - right.index,
  );
  const dailyTop5 = dailyRanking
    .slice(0, 5)
    .map(({ itemId, name, daily }) => ({ itemId, name, daily }));
  const yearGroups = new Map<number, { count: number; totalCost: number }>();

  for (const record of records) {
    if (record.type !== 'item' || !record.purchaseDate) {
      continue;
    }

    const year = purchaseYear(record.purchaseDate);
    const group = yearGroups.get(year) ?? { count: 0, totalCost: 0 };
    group.count += 1;
    group.totalCost += record.purchaseCost;
    yearGroups.set(year, group);
  }

  const purchaseYears = [...yearGroups.entries()]
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .map(([year, group]) => ({
      year,
      count: group.count,
      totalCost: round2(group.totalCost),
    }));
  const valueLeader = valueRanking[0];
  const dailyLeader = dailyRanking[0];
  const longestHeld = [...activeItems]
    .filter(
      (item): item is typeof item & { days: number } => item.days !== null,
    )
    .sort((left, right) => right.days - left.days || left.index - right.index)[0];
  const highlights: LedgerHighlights = {
    highestValue: valueLeader
      ? {
          kind: 'highest-value',
          itemId: valueLeader.itemId,
          name: valueLeader.name,
          metric: valueLeader.value,
          unit: 'cny',
          explanation: `${valueLeader.name} 的整套净价值为 ¥${valueLeader.value.toFixed(2)}，是在用物品中最高的。`,
        }
      : null,
    highestDaily: dailyLeader
      ? {
          kind: 'highest-daily',
          itemId: dailyLeader.itemId,
          name: dailyLeader.name,
          metric: dailyLeader.daily,
          unit: 'cny-per-day',
          explanation: `${dailyLeader.name} 的每日成本为 ¥${dailyLeader.daily.toFixed(2)}/天，是在用物品中最高的。`,
        }
      : null,
    longestHeld: longestHeld
      ? {
          kind: 'longest-held',
          itemId: longestHeld.itemId,
          name: longestHeld.name,
          metric: longestHeld.days,
          unit: 'days',
          explanation: `${longestHeld.name} 已持有 ${longestHeld.days} 天，是有购买日期的在用物品中最长的。`,
        }
      : null,
  };

  return { valueTop5, dailyTop5, purchaseYears, highlights };
}

function purchaseYear(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${date}"`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date "${date}"`);
  }

  return year;
}
