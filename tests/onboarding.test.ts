import { describe, expect, it } from 'vitest';

import {
  LEDGER_ONBOARDING_STEPS,
  shouldShowLedgerOnboarding,
} from '../src/onboarding';

describe('first-run onboarding', () => {
  it('appears only for an empty ledger that has not completed the guide', () => {
    expect(shouldShowLedgerOnboarding(0, false)).toBe(true);
    expect(shouldShowLedgerOnboarding(0, true)).toBe(false);
    expect(shouldShowLedgerOnboarding(1, false)).toBe(false);
    expect(shouldShowLedgerOnboarding(25, true)).toBe(false);
  });

  it('guides the user through the two creation actions and both view modes', () => {
    expect(LEDGER_ONBOARDING_STEPS.map(({ id }) => id)).toEqual([
      'add-item',
      'add-accessory',
      'view-mode',
    ]);
    expect(LEDGER_ONBOARDING_STEPS).toHaveLength(3);
  });
});
