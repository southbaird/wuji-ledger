import type { LedgerRecord } from './domain';
import {
  DEFAULT_ACTIVE_SUMMARY_ART_ID,
  DEFAULT_ARCHIVED_SUMMARY_ART_ID,
  DEFAULT_PAGE_AVATAR_SHAPE,
  DEFAULT_PAGE_AVATAR_TONE,
  DEFAULT_PAGE_ICON_ID,
  normalizePageIconId,
  normalizePageAvatarShape,
  normalizePageAvatarTone,
  normalizeSummaryArtId,
  type PageAvatarShape,
  type PageAvatarTone,
  type PageIconId,
  type SummaryArtId,
} from './appearance';
import {
  DEFAULT_WIDGET_LAYOUT,
  DEFAULT_WIDGET_THEME,
  WIDGET_LAYOUT_OPTIONS,
  WIDGET_THEME_OPTIONS,
  type WidgetLayout,
  type WidgetTheme,
} from './mobile-widget';
import {
  DEFAULT_LEDGER_COLOR_THEME,
  normalizeLedgerColorTheme,
  type LedgerColorTheme,
} from './product-theme';

export type ViewMode = 'gallery' | 'table';
export type SortMode = 'purchase-desc' | 'value-desc' | 'daily-desc' | 'name-asc';

export interface LedgerPreferences {
  viewMode: ViewMode;
  sortMode: SortMode;
  pageIconId: PageIconId;
  pageAvatarShape: PageAvatarShape;
  pageAvatarTone: PageAvatarTone;
  activeSummaryArtId: SummaryArtId;
  archivedSummaryArtId: SummaryArtId;
  widgetLayout: WidgetLayout;
  widgetTheme: WidgetTheme;
  colorTheme: LedgerColorTheme;
  onboardingCompleted: boolean;
}

export interface StoredLedgerData {
  schemaVersion: number;
  title: string;
  records: LedgerRecord[];
  preferences: LedgerPreferences;
}

export interface StoredDataResolution {
  data: StoredLedgerData;
  source: 'primary' | 'backup' | 'default';
}

const SCHEMA_VERSION = 7;

const DEFAULT_PREFERENCES: LedgerPreferences = {
  viewMode: 'gallery',
  sortMode: 'purchase-desc',
  pageIconId: DEFAULT_PAGE_ICON_ID,
  pageAvatarShape: DEFAULT_PAGE_AVATAR_SHAPE,
  pageAvatarTone: DEFAULT_PAGE_AVATAR_TONE,
  activeSummaryArtId: DEFAULT_ACTIVE_SUMMARY_ART_ID,
  archivedSummaryArtId: DEFAULT_ARCHIVED_SUMMARY_ART_ID,
  widgetLayout: DEFAULT_WIDGET_LAYOUT,
  widgetTheme: DEFAULT_WIDGET_THEME,
  colorTheme: DEFAULT_LEDGER_COLOR_THEME,
  onboardingCompleted: false,
};

export function normalizeStoredData(value: unknown): StoredLedgerData {
  if (!hasStoredDataEnvelope(value)) {
    return createDefaultStoredData();
  }

  const records = value.records.filter(isLedgerRecord);
  const preferences: LedgerPreferences = isPlainObject(value.preferences)
    ? {
        viewMode: value.preferences.viewMode === 'table' ? 'table' : 'gallery',
        sortMode: isSortMode(value.preferences.sortMode)
          ? value.preferences.sortMode
          : DEFAULT_PREFERENCES.sortMode,
        pageIconId: normalizePageIconId(value.preferences.pageIconId),
        pageAvatarShape: normalizePageAvatarShape(value.preferences.pageAvatarShape),
        pageAvatarTone: normalizePageAvatarTone(value.preferences.pageAvatarTone),
        activeSummaryArtId: normalizeSummaryArtId(
          value.preferences.activeSummaryArtId,
          DEFAULT_ACTIVE_SUMMARY_ART_ID,
        ),
        archivedSummaryArtId: normalizeSummaryArtId(
          value.preferences.archivedSummaryArtId,
          DEFAULT_ARCHIVED_SUMMARY_ART_ID,
        ),
        widgetLayout: normalizeWidgetLayout(value.preferences.widgetLayout),
        widgetTheme: normalizeWidgetTheme(value.preferences.widgetTheme),
        colorTheme: normalizeLedgerColorTheme(value.preferences.colorTheme),
        onboardingCompleted: typeof value.preferences.onboardingCompleted === 'boolean'
          ? value.preferences.onboardingCompleted
          : records.length > 0,
      }
    : {
        ...DEFAULT_PREFERENCES,
        onboardingCompleted: records.length > 0,
      };

  return {
    schemaVersion: SCHEMA_VERSION,
    title: typeof value.title === 'string' && value.title.trim()
      ? value.title.trim()
      : '我的小玩意',
    records,
    preferences,
  };
}

export function resolveStoredData(primary: unknown, backup: unknown): StoredDataResolution {
  if (hasStoredDataEnvelope(primary)) {
    return { data: normalizeStoredData(primary), source: 'primary' };
  }

  if (hasStoredDataEnvelope(backup)) {
    return { data: normalizeStoredData(backup), source: 'backup' };
  }

  return { data: createDefaultStoredData(), source: 'default' };
}

export function hasStoredDataEnvelope(value: unknown): value is Record<string, unknown> & {
  records: unknown[];
} {
  return isPlainObject(value)
    && Array.isArray(value.records)
    && value.records.every(isLedgerRecord);
}

function createDefaultStoredData(): StoredLedgerData {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: '我的小玩意',
    records: [],
    preferences: { ...DEFAULT_PREFERENCES },
  };
}

function isLedgerRecord(value: unknown): value is LedgerRecord {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string'
    && (value.type === 'item' || value.type === 'accessory')
    && typeof value.name === 'string'
    && typeof value.purchaseCost === 'number'
    && Number.isFinite(value.purchaseCost)
    && isOptionalString(value.purchaseDate)
    && isOptionalFiniteNumber(value.saleIncome)
    && isOptionalString(value.archiveDate)
    && isOptionalString(value.linkedItemId)
    && isOptionalString(value.cover)
    && isOptionalString(value.notes)
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'purchase-desc'
    || value === 'value-desc'
    || value === 'daily-desc'
    || value === 'name-asc';
}

function normalizeWidgetLayout(value: unknown): WidgetLayout {
  return WIDGET_LAYOUT_OPTIONS.find((option) => option.id === value)?.id
    ?? DEFAULT_WIDGET_LAYOUT;
}

function normalizeWidgetTheme(value: unknown): WidgetTheme {
  return WIDGET_THEME_OPTIONS.find((option) => option.id === value)?.id
    ?? DEFAULT_WIDGET_THEME;
}
