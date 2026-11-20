import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function firstRuleContaining(selectorFragment: string): string {
  const selectorAt = styles.indexOf(selectorFragment);
  if (selectorAt < 0) {
    throw new Error(`Could not locate CSS selector: ${selectorFragment}`);
  }
  const bodyAt = styles.indexOf('{', selectorAt);
  const bodyEnd = styles.indexOf('}', bodyAt + 1);
  if (bodyAt < 0 || bodyEnd < 0) {
    throw new Error(`Could not read CSS rule: ${selectorFragment}`);
  }
  return styles.slice(bodyAt + 1, bodyEnd);
}

describe('ledger global visual rhythm', () => {
  it('keeps every section header on the same desktop rhythm', () => {
    const header = firstRuleContaining(') .celtis-ledger-section-header');
    const sectionDivider = firstRuleContaining(
      ') .celtis-ledger-section + .celtis-ledger-section',
    );

    expect(header).toContain('min-height: 38px');
    expect(header).toContain('margin-bottom: 15px');
    expect(header).toContain('align-items: center');
    expect(sectionDivider).toContain('margin-top: 30px');
    expect(sectionDivider).toContain('padding-top: 30px');
  });

  it('keeps inline item thumbnails compact and aligned with the shared thumbnail scale', () => {
    const thumbnail = firstRuleContaining('.celtis-ledger-record-thumbnail.is-inline-item');
    const childName = firstRuleContaining('.celtis-ledger-inline-name.is-child');
    const branch = firstRuleContaining('.celtis-ledger-tree-branch');

    expect(thumbnail).toContain('width: 32px');
    expect(thumbnail).toContain('height: 32px');
    expect(thumbnail).toContain('flex-basis: 32px');
    expect(childName).toContain('padding-left: 42px');
    expect(branch).toContain('width: 24px');
    expect(styles).toMatch(
      /\.is-inline-item\.is-sticker\[data-sticker-shape="tall"\][^{]*\{[^}]*width:\s*26px;[^}]*height:\s*26px;/s,
    );
  });

  it('uses stable image boxes in accessory groups instead of intrinsic auto sizing', () => {
    const boardImage = firstRuleContaining(
      '.celtis-ledger-record-thumbnail.is-board-item\n  img',
    );

    expect(boardImage).toContain('width: 28px');
    expect(boardImage).toContain('height: 28px');
    expect(boardImage).not.toContain('width: auto');
    expect(boardImage).not.toContain('height: auto');
  });

  it('does not declare conflicting mobile summary padding', () => {
    const mobileStart = styles.indexOf('@container celtis-ledger (max-width: 639px)');
    const mobileEnd = styles.indexOf('@container celtis-ledger (max-width: 359px)', mobileStart);
    const mobile = styles.slice(mobileStart, mobileEnd);
    const summaryPaddingDeclarations = [
      ...mobile.matchAll(/\.celtis-ledger-summary\s*\{[^}]*padding:\s*([^;]+);/g),
    ];

    expect(summaryPaddingDeclarations.map((match) => match[1]?.trim())).toEqual(['0']);
  });

  it('removes the desktop table width inside the mobile container', () => {
    const mobileStart = styles.indexOf('@container celtis-ledger (max-width: 639px)');
    const mobileEnd = styles.indexOf('@container celtis-ledger (max-width: 359px)', mobileStart);
    const mobile = styles.slice(mobileStart, mobileEnd);

    expect(mobile).toMatch(/\.celtis-ledger-table\s*\{[^}]*min-width:\s*0;/s);
    expect(mobile).toMatch(/\.celtis-ledger-table thead\s*\{[^}]*display:\s*none;/s);
    expect(mobile).toMatch(/\.celtis-ledger-inline-input\s*\{[^}]*min-height:\s*44px;/s);
    expect(mobile).toMatch(
      /\.celtis-ledger-inline-action\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
  });
});
