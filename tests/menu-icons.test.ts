import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

describe('toolbar menu icons', () => {
  it('uses Obsidian-compatible icons for every sort option', () => {
    const sortMenu = sourceBetween(
      'this.renderMenuControl<SortMode>',
      '], this.sortMode',
    );

    expect(sortMenu).toContain("label: '最近购买',\n        icon: 'clock-3'");
    expect(sortMenu).toContain("label: '价值从高到低',\n        icon: 'arrow-down-10'");
    expect(sortMenu).toContain("label: '每日成本从高到低',\n        icon: 'gauge'");
    expect(sortMenu).toContain("label: '名称升序',\n        icon: 'arrow-down-az'");
    expect(sortMenu).not.toMatch(/arrow-down-(?:1-0|a-z)/);
  });

  it('gives each rendered menu item an accessible name', () => {
    const menuControl = sourceBetween(
      'private renderMenuControl',
      'startOnboarding(): void',
    );

    expect(menuControl).toContain("menuLabel.className = 'celtis-ledger-control-menu-label'");
    expect(menuControl).toContain("menuLabel.setAttribute('aria-label', option.accessibleLabel ?? option.label)");
    expect(menuControl).toContain('.setTitle(title)');
    expect(menuControl).not.toContain("host.querySelectorAll<HTMLElement>('.menu-item')");
  });
});
