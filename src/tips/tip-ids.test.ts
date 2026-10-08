import { dismissedTipIds, isTipId, RETIRED_TIP_IDS, TIP_IDS } from './tip-ids';

describe('tip registry', () => {
  it('has unique ids', () => {
    expect(new Set(TIP_IDS).size).toBe(TIP_IDS.length);
  });

  it('never reuses a retired id', () => {
    for (const retired of RETIRED_TIP_IDS) {
      expect(TIP_IDS).not.toContain(retired);
    }
  });

  it('recognises only registered ids', () => {
    expect(isTipId('nope')).toBe(false);
    expect(isTipId('settings.categories')).toBe(true);
  });

  it('drops unknown stored ids', () => {
    expect(dismissedTipIds(['future.tip', 'settings.categories'])).toEqual(
      new Set(['settings.categories']),
    );
  });
});
