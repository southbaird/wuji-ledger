import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as { isDesktopOnly?: boolean };
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function mobileStyles(): string {
  const start = styles.indexOf('@container celtis-ledger (max-width: 639px)');
  const end = styles.indexOf('@container celtis-ledger (max-width: 359px)', start);
  if (start < 0 || end < 0) {
    throw new Error('Could not locate the mobile ledger container rules');
  }
  return styles.slice(start, end);
}

describe('mobile ledger entry points', () => {
  it('keeps the plugin available on Obsidian mobile', () => {
    expect(manifest.isDesktopOnly).toBe(false);
  });

  it('registers a dedicated view and command for the pocket dashboard', () => {
    expect(source).toMatch(
      /const\s+WIDGET_VIEW_TYPE\s*=\s*['"]celtis-asset-ledger-widget-view['"]/,
    );
    expect(source).toMatch(/registerView\(\s*WIDGET_VIEW_TYPE\s*,/);
    expect(source).toMatch(/name:\s*['"][^'"]*随身看板[^'"]*['"]/);
    expect(source).toMatch(/activateWidgetView\s*\(/);
  });

  it('adds a mobile-only ribbon entry instead of relying on the desktop ribbon', () => {
    expect(source).toContain('Platform');
    expect(source).toMatch(
      /if\s*\(Platform\.isMobileApp\)\s*\{[\s\S]{0,1200}?addRibbonIcon\([\s\S]{0,500}?['"]layout-dashboard['"][\s\S]{0,500}?随身看板[\s\S]{0,500}?activateWidgetView\s*\(/,
    );
  });

  it('exposes the pocket dashboard through an Obsidian protocol link', () => {
    expect(source).toMatch(
      /registerObsidianProtocolHandler\(\s*['"]wuji-ledger-widget['"]\s*,/,
    );
    expect(source).toMatch(
      /registerObsidianProtocolHandler\(\s*['"]celtis-asset-widget['"]\s*,/,
    );
    expect(source).toMatch(/registerObsidianProtocolHandler[\s\S]*activateWidgetView\s*\(/);
  });

  it('offers a command that updates and opens the native-widget summary note', () => {
    expect(source).toMatch(
      /name:\s*['"][^'"]*(?:更新并打开|打开并更新)[^'"]*(?:手机摘要|小组件摘要)[^'"]*['"]/,
    );
    expect(source).toMatch(/updateMobileSummary\s*\(/);
    expect(source).toMatch(
      /const lines = \[\s*['"]---['"],\s*['"]wuji_ledger_managed: true['"]/,
    );
    expect(source).toMatch(
      /onload\(\)[\s\S]*onLayoutReady\([\s\S]*migrateLegacyMobileSummary\(\)[\s\S]*refreshManagedMobileSummary\(\)/,
    );
  });
});

describe('pocket dashboard responsive styling', () => {
  it('has a dedicated widget root and three selectable visual themes', () => {
    expect(styles).toContain('.celtis-ledger-widget-root');
    expect(styles).toMatch(/(?:is-theme-|widget-theme-)cream/);
    expect(styles).toMatch(/(?:is-theme-|widget-theme-)minimal/);
    expect(styles).toMatch(/(?:is-theme-|widget-theme-)midnight/);
    expect(styles).not.toMatch(
      /data-type="celtis-asset-ledger-widget-view"\] \.view-content\s*\{[^}]*background:\s*#f1f3f4/s,
    );
    expect(styles).toContain('color: var(--celtis-widget-blue)');
  });

  it('styles all three content layouts', () => {
    expect(styles).toMatch(/(?:is-layout-|widget-layout-)glance/);
    expect(styles).toMatch(/(?:is-layout-|widget-layout-)overview/);
    expect(styles).toMatch(/(?:is-layout-|widget-layout-)collection/);
  });

  it('respects mobile safe areas and 44px touch targets', () => {
    expect(styles).toMatch(/env\(safe-area-inset-(?:top|bottom)\)/);
    expect(styles).toMatch(/min-height:\s*44px/);
  });

  it('contains a narrow-screen widget layout', () => {
    expect(styles).toMatch(
      /@(?:container|media)[^{]*(?:max-width:\s*(?:520|639)px)[\s\S]*\.celtis-ledger-widget-root/,
    );
  });

  it('keeps the existing inline editor card-based on narrow screens', () => {
    const mobile = mobileStyles();

    expect(mobile).toMatch(/\.celtis-ledger-table\s*\{[^}]*min-width:\s*0;/s);
    expect(mobile).toMatch(/\.celtis-ledger-table thead\s*\{[^}]*display:\s*none;/s);
    expect(mobile).toMatch(
      /\.celtis-ledger-table \.celtis-ledger-inline-row\s*\{[^}]*display:\s*grid;/s,
    );
  });
});
