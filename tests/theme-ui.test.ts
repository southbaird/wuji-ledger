import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const datePickerSource = readFileSync(new URL('../src/date-picker.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

describe('main-ledger theme switcher UI', () => {
  it('renders the compact theme control in the upper-right header before auxiliary actions', () => {
    const header = sourceBetween('private renderHeader', 'private renderColorThemeControl');
    const themeAt = header.indexOf('this.renderColorThemeControl(status)');
    const pocketAt = header.indexOf("cls: 'celtis-ledger-guide-entry is-pocket-entry'");
    const localBadgeAt = header.indexOf("cls: 'celtis-ledger-badge'");

    expect(header).toContain("cls: 'celtis-ledger-header-status'");
    expect(themeAt).toBeGreaterThanOrEqual(0);
    expect(pocketAt).toBeGreaterThan(themeAt);
    expect(localBadgeAt).toBeGreaterThan(pocketAt);
  });

  it('shows named three-color choices, checked state, accessible menu state, and opens below the trigger', () => {
    const control = sourceBetween('private renderColorThemeControl', 'private renderThemePalette');
    const palette = sourceBetween('private renderThemePalette', 'private renderToolbar');

    expect(control).toContain("'aria-haspopup': 'menu'");
    expect(control).toContain("'aria-expanded': 'false'");
    expect(control).toContain('LEDGER_COLOR_THEME_OPTIONS');
    expect(control).toContain('this.createThemeMenuTitle(trigger.ownerDocument, option)');
    expect(control).not.toContain("host.querySelectorAll<HTMLElement>('.menu-item')");
    expect(control).toContain('.setChecked(option.id === currentTheme)');
    expect(control).toContain('option.paletteLabel');
    expect(control).toContain('aria-label');
    expect(control).toContain('y: rect.bottom + 5');
    expect(control).toContain("if (this.activeMenu && host.hasClass('is-open'))");
    expect(control).toContain('this.activeMenu.hide()');
    expect(palette).toContain("['primary', 'secondary', 'canvas'] as const");
    expect(palette).toContain('celtis-ledger-theme-swatch is-${tone}');
  });

  it('switches and persists the palette in place without rebuilding the view', () => {
    const selection = sourceBetween(
      'async selectColorTheme',
      'private applyColorThemeToOpenRoots',
    );

    expect(selection).toContain('this.applyColorThemeToOpenRoots(theme)');
    expect(selection).toContain('await this.updatePreferences({ colorTheme: theme }, false)');
    expect(selection).toContain('this.appliedColorTheme = theme');
    expect(selection).toContain('selectionVersion === this.colorThemeSelectionVersion');
    expect(selection).toContain('this.appliedColorTheme = this.data.preferences.colorTheme');
    expect(selection).toContain('this.applyColorThemeToOpenRoots(this.colorTheme)');
    expect(selection).not.toContain('this.render(');
    expect(selection).not.toContain('refreshViews(');
  });

  it('applies the saved main theme before content appears and propagates it to dialogs and dates', () => {
    const viewRender = sourceBetween(
      'render(): void {\n    const root = this.contentEl;',
      'private renderHeader',
    );

    expect(viewRender).toContain("root.addClass('celtis-asset-ledger-root')");
    expect(viewRender).toContain('this.plugin.applyColorTheme(root)');
    expect(source.match(/this\.plugin\.applyColorTheme\(this\.modalEl\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
    expect(datePickerSource).toContain('this.doc = anchor.ownerDocument');
    expect(datePickerSource).toContain("anchor.closest<HTMLElement>('.modal-container')");
    expect(datePickerSource).toContain('this.portalHost.appendChild(this.root)');
    expect(datePickerSource).not.toContain('this.doc.body.appendChild(this.root)');
    expect(datePickerSource).toContain("anchor.closest<HTMLElement>('.celtis-asset-ledger-root')");
    expect(datePickerSource).toContain('applyLedgerColorTheme(');
  });

  it('defines all additional theme scopes plus compact, role-based color previews', () => {
    for (const theme of ['almond', 'celadon', 'midnight']) {
      expect(styles).toContain(`.is-ledger-theme-${theme}`);
      expect(styles).toContain(`[data-theme="${theme}"]`);
    }
    expect(styles).toContain('[data-theme="initial"]');
    expect(styles).toContain('.celtis-ledger-theme-trigger');
    expect(styles).toContain('.menu:has(.celtis-ledger-theme-menu-palette)');
    expect(styles).toContain('.celtis-ledger-theme-swatch.is-primary');
    expect(styles).toContain('.celtis-ledger-theme-swatch.is-secondary');
    expect(styles).toContain('.celtis-ledger-theme-swatch.is-canvas');
    expect(styles).toMatch(
      /@container celtis-ledger \(max-width: 639px\)[\s\S]*\.celtis-ledger-theme-trigger[\s\S]*min-width:\s*44px;/,
    );
    expect(styles).toMatch(
      /@container celtis-ledger \(max-width: 639px\)[\s\S]*\.celtis-ledger-theme-control[\s\S]*position:\s*absolute;[\s\S]*right:\s*0;/,
    );
  });
});
