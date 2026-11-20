import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LEDGER_COLOR_THEME,
  LEDGER_COLOR_THEME_OPTIONS,
  applyLedgerColorTheme,
  getLedgerColorThemeOption,
  normalizeLedgerColorTheme,
} from '../src/product-theme';

describe('main-ledger color themes', () => {
  it('keeps the current palette as the initial theme and offers three additional themes', () => {
    expect(DEFAULT_LEDGER_COLOR_THEME).toBe('initial');
    expect(LEDGER_COLOR_THEME_OPTIONS.map(({ id }) => id)).toEqual([
      'initial',
      'almond',
      'celadon',
      'midnight',
    ]);
    expect(LEDGER_COLOR_THEME_OPTIONS[0]).toMatchObject({
      label: '初始配色',
      colors: ['#a83961', '#356f9f', '#f1f3f4'],
    });
  });

  it.each(LEDGER_COLOR_THEME_OPTIONS)(
    '$label exposes exactly three unique, valid palette colors',
    ({ colors }) => {
      expect(colors).toHaveLength(3);
      expect(new Set(colors).size).toBe(3);
      for (const color of colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    },
  );

  it('normalizes unknown or missing theme values back to the initial palette', () => {
    expect(normalizeLedgerColorTheme('celadon')).toBe('celadon');
    expect(normalizeLedgerColorTheme('unknown-theme')).toBe('initial');
    expect(normalizeLedgerColorTheme(undefined)).toBe('initial');
    expect(normalizeLedgerColorTheme(null)).toBe('initial');
  });

  it('resolves each registered theme and safely falls back for stale callers', () => {
    for (const option of LEDGER_COLOR_THEME_OPTIONS) {
      expect(getLedgerColorThemeOption(option.id)).toBe(option);
    }
    expect(getLedgerColorThemeOption('removed-theme' as never)).toBe(
      LEDGER_COLOR_THEME_OPTIONS[0],
    );
  });

  it('replaces the previous theme class in place and updates the theme dataset', () => {
    const classes = new Set<string>([
      'celtis-asset-ledger-root',
      'is-ledger-theme-initial',
      'is-ledger-theme-almond',
    ]);
    const element = {
      classList: {
        add: (...tokens: string[]) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
      },
      dataset: {} as DOMStringMap,
    } as unknown as HTMLElement;

    applyLedgerColorTheme(element, 'midnight');

    expect([...classes].sort()).toEqual([
      'celtis-asset-ledger-root',
      'is-ledger-theme-midnight',
    ]);
    expect(element.dataset.celtisTheme).toBe('midnight');
  });
});
