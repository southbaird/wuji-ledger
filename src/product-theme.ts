export const LEDGER_COLOR_THEME_OPTIONS = [
  {
    id: 'initial',
    label: '初始配色',
    description: '保留现在的莓果、湖蓝与雾灰。',
    paletteLabel: '莓果 · 湖蓝 · 雾灰',
    colors: ['#a83961', '#356f9f', '#f1f3f4'],
  },
  {
    id: 'almond',
    label: '杏仁陶土',
    description: '陶土红、鼠尾草与杏仁白，温暖耐看。',
    paletteLabel: '陶土 · 鼠尾草 · 杏仁',
    colors: ['#a5503f', '#5e7461', '#f3efe8'],
  },
  {
    id: 'celadon',
    label: '青瓷海盐',
    description: '青瓷绿、暖琥珀与海盐灰，清爽沉稳。',
    paletteLabel: '青瓷 · 琥珀 · 海盐',
    colors: ['#2f6b68', '#b2703d', '#eef3f1'],
  },
  {
    id: 'midnight',
    label: '午夜鸢尾',
    description: '鸢尾紫、月光蓝与夜色黑，克制安静。',
    paletteLabel: '鸢尾 · 月光 · 夜色',
    colors: ['#bd8cff', '#78b7c9', '#171a1e'],
  },
] as const;

export type LedgerColorTheme = (typeof LEDGER_COLOR_THEME_OPTIONS)[number]['id'];

export const DEFAULT_LEDGER_COLOR_THEME: LedgerColorTheme = 'initial';

export function normalizeLedgerColorTheme(value: unknown): LedgerColorTheme {
  return LEDGER_COLOR_THEME_OPTIONS.find((option) => option.id === value)?.id
    ?? DEFAULT_LEDGER_COLOR_THEME;
}

export function getLedgerColorThemeOption(theme: LedgerColorTheme) {
  return LEDGER_COLOR_THEME_OPTIONS.find((option) => option.id === theme)
    ?? LEDGER_COLOR_THEME_OPTIONS[0];
}

export function applyLedgerColorTheme(
  element: HTMLElement,
  theme: LedgerColorTheme,
): void {
  for (const option of LEDGER_COLOR_THEME_OPTIONS) {
    element.classList.remove(`is-ledger-theme-${option.id}`);
  }
  element.classList.add(`is-ledger-theme-${theme}`);
  element.dataset.celtisTheme = theme;
}
