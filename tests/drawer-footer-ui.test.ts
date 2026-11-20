import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('drawer footer actions', () => {
  it('uses a width-safe grid so every action remains inside the drawer', () => {
    expect(styles).toMatch(
      /\.celtis-ledger-drawer-footer\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(118px,\s*100%\),\s*1fr\)\);[^}]*overflow:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /\.celtis-ledger-drawer-footer > \.celtis-ledger-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
  });

  it('gives the primary action a full row on phone-sized screens', () => {
    expect(styles).toMatch(
      /@container celtis-ledger \(max-width: 639px\)[\s\S]*\.celtis-ledger-drawer-footer > \.celtis-ledger-button\.is-primary:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
  });
});
