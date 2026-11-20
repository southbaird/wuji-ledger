import {
  isArchived,
  type AccessoryRecord,
  type ItemRecord,
  type LedgerRecord,
} from './domain';

export interface InlineEditGroup {
  item: ItemRecord;
  accessories: AccessoryRecord[];
}

export interface InlineEditGrouping {
  groups: InlineEditGroup[];
  otherAccessories: AccessoryRecord[];
}

/**
 * Builds the parent/child structure used by the inline editing view.
 *
 * `sortedItems` is the full, already-sorted active-item list. Search is applied
 * here so an accessory match can keep its parent visible even when the parent
 * itself does not match the query.
 */
export function buildInlineEditGroups(
  records: readonly LedgerRecord[],
  sortedItems: readonly LedgerRecord[],
  query: string,
): InlineEditGrouping {
  const activeAccessories = records.filter(
    (record): record is AccessoryRecord => record.type === 'accessory' && !isArchived(record),
  );
  const accessoriesByItemId = groupAccessoriesByItemId(activeAccessories);
  const eligibleItemIds = new Set<string>();
  const seenItemIds = new Set<string>();
  const groups: InlineEditGroup[] = [];
  const hasQuery = Boolean(query.trim());

  for (const record of sortedItems) {
    if (record.type !== 'item' || isArchived(record) || seenItemIds.has(record.id)) {
      continue;
    }

    const item = record as ItemRecord;
    seenItemIds.add(item.id);
    eligibleItemIds.add(item.id);

    const linkedAccessories = accessoriesByItemId.get(item.id) ?? [];
    const itemMatches = matchesInlineEditQuery(item, query);
    const matchingAccessories = hasQuery
      ? linkedAccessories.filter((accessory) => matchesInlineEditQuery(accessory, query))
      : linkedAccessories;

    if (hasQuery && !itemMatches && matchingAccessories.length === 0) {
      continue;
    }

    groups.push({
      item,
      accessories: itemMatches || !hasQuery ? linkedAccessories : matchingAccessories,
    });
  }

  const otherAccessories = activeAccessories.filter((accessory) => {
    if (accessory.linkedItemId && eligibleItemIds.has(accessory.linkedItemId)) {
      return false;
    }

    return !hasQuery || matchesInlineEditQuery(accessory, query);
  });

  return { groups, otherAccessories };
}

export function matchesInlineEditQuery(record: LedgerRecord, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) {
    return true;
  }

  return [record.name, record.notes ?? '']
    .join('\n')
    .toLocaleLowerCase('zh-CN')
    .includes(normalized);
}

function groupAccessoriesByItemId(
  accessories: readonly AccessoryRecord[],
): Map<string, AccessoryRecord[]> {
  const grouped = new Map<string, AccessoryRecord[]>();

  for (const accessory of accessories) {
    if (!accessory.linkedItemId) {
      continue;
    }

    const linked = grouped.get(accessory.linkedItemId);
    if (linked) {
      linked.push(accessory);
    } else {
      grouped.set(accessory.linkedItemId, [accessory]);
    }
  }

  return grouped;
}
