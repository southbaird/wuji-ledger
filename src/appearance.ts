/**
 * Legacy appearance IDs remain in the stored-data envelope so older ledgers
 * stay readable. The title mark uses local Bloub SVG animation, while the two
 * summary cards use the original static dog illustrations.
 */
export const BLOUB_APPEARANCE_ID = 'bloub' as const;
export const ACTIVE_DOG_ART_ID = 'active-dog' as const;
export const ARCHIVED_DOG_ART_ID = 'archived-dog' as const;

export const BLOUB_SHAPE_OPTIONS = [
  { id: 'cercle', label: '圆形' },
  { id: 'galet', label: '鹅卵石' },
  { id: 'squircle', label: '圆角方形' },
  { id: 'capsule', label: '胶囊' },
  { id: 'triangle', label: '三角形' },
  { id: 'hexagone', label: '六边形' },
  { id: 'nuage', label: '云朵' },
  { id: 'goutte', label: '水滴' },
] as const;

export const BLOUB_TONE_OPTIONS = [
  { id: 'ink', label: '墨黑', description: '经典黑色' },
  { id: 'primary', label: '主题色', description: '跟随当前主题' },
  { id: 'secondary', label: '辅助色', description: '跟随当前主题' },
] as const;

export type PageIconId = typeof BLOUB_APPEARANCE_ID;
export type SummaryArtId = typeof ACTIVE_DOG_ART_ID | typeof ARCHIVED_DOG_ART_ID;
export type PageAvatarShape = (typeof BLOUB_SHAPE_OPTIONS)[number]['id'];
export type PageAvatarTone = (typeof BLOUB_TONE_OPTIONS)[number]['id'];

export const DEFAULT_PAGE_ICON_ID: PageIconId = BLOUB_APPEARANCE_ID;
export const DEFAULT_PAGE_AVATAR_SHAPE: PageAvatarShape = 'cercle';
export const DEFAULT_PAGE_AVATAR_TONE: PageAvatarTone = 'ink';
export const DEFAULT_ACTIVE_SUMMARY_ART_ID: SummaryArtId = ACTIVE_DOG_ART_ID;
export const DEFAULT_ARCHIVED_SUMMARY_ART_ID: SummaryArtId = ARCHIVED_DOG_ART_ID;

export function isPageIconId(value: unknown): value is PageIconId {
  return value === BLOUB_APPEARANCE_ID;
}

export function isSummaryArtId(value: unknown): value is SummaryArtId {
  return value === ACTIVE_DOG_ART_ID || value === ARCHIVED_DOG_ART_ID;
}

export function isPageAvatarShape(value: unknown): value is PageAvatarShape {
  return BLOUB_SHAPE_OPTIONS.some((option) => option.id === value);
}

export function isPageAvatarTone(value: unknown): value is PageAvatarTone {
  return BLOUB_TONE_OPTIONS.some((option) => option.id === value);
}

export function normalizePageIconId(_value: unknown): PageIconId {
  return BLOUB_APPEARANCE_ID;
}

export function normalizeSummaryArtId(
  value: unknown,
  fallback: SummaryArtId = DEFAULT_ACTIVE_SUMMARY_ART_ID,
): SummaryArtId {
  return isSummaryArtId(value) ? value : fallback;
}

export function normalizePageAvatarShape(value: unknown): PageAvatarShape {
  return isPageAvatarShape(value) ? value : DEFAULT_PAGE_AVATAR_SHAPE;
}

export function normalizePageAvatarTone(value: unknown): PageAvatarTone {
  return isPageAvatarTone(value) ? value : DEFAULT_PAGE_AVATAR_TONE;
}
