import { describe, expect, it } from 'vitest';

import {
  MOBILE_SUMMARY_MARKER,
  isManagedMobileSummary,
} from '../src/mobile-summary';

describe('mobile summary ownership', () => {
  it('accepts the current plugin-owned frontmatter and adjacent marker', () => {
    expect(isManagedMobileSummary([
      '---',
      'wuji_ledger_managed: true',
      'cssclasses:',
      '  - wuji-ledger-summary-note',
      '---',
      MOBILE_SUMMARY_MARKER,
      '',
      '# 随身摘要',
    ].join('\n'))).toBe(true);
  });

  it('keeps accepting the legacy ownership marker during the rename migration', () => {
    expect(isManagedMobileSummary([
      '---',
      'celtis_asset_ledger_managed: true',
      '---',
      '<!-- celtis-asset-ledger-managed -->',
      '',
      '# 旧版随身摘要',
    ].join('\n'))).toBe(true);
  });

  it('rejects a normal note that only contains a copied marker in its body', () => {
    expect(isManagedMobileSummary([
      '---',
      'tags: [assets]',
      '---',
      '',
      '# 普通笔记',
      MOBILE_SUMMARY_MARKER,
    ].join('\n'))).toBe(false);
  });

  it('rejects a false ownership flag or a detached marker', () => {
    expect(isManagedMobileSummary([
      '---',
      'wuji_ledger_managed: false',
      '---',
      MOBILE_SUMMARY_MARKER,
    ].join('\n'))).toBe(false);
    expect(isManagedMobileSummary([
      '---',
      'wuji_ledger_managed: true',
      '---',
      '',
      MOBILE_SUMMARY_MARKER,
    ].join('\n'))).toBe(false);
  });
});
