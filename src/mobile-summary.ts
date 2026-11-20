export const MOBILE_SUMMARY_MARKER = '<!-- wuji-ledger-managed -->';
const LEGACY_MOBILE_SUMMARY_MARKER = '<!-- celtis-asset-ledger-managed -->';

export function isManagedMobileSummary(content: string): boolean {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== '---') {
    return false;
  }

  const frontmatterEnd = lines.indexOf('---', 1);
  if (frontmatterEnd < 2) {
    return false;
  }

  const hasOwnershipFlag = lines
    .slice(1, frontmatterEnd)
    .some((line) => /^(?:wuji_ledger_managed|celtis_asset_ledger_managed):\s*true\s*$/.test(line));

  return hasOwnershipFlag && [MOBILE_SUMMARY_MARKER, LEGACY_MOBILE_SUMMARY_MARKER]
    .includes(lines[frontmatterEnd + 1] ?? '');
}
