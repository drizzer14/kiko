import * as bybit from '.';

describe('the Bybit barrel', () => {
  it('names the reads, the two refusal errors, the cooldown and the closed list of paths', () => {
    expect(Object.keys(bybit)).toEqual(
      expect.arrayContaining([
        'BYBIT_SIGNED_PATHS',
        'BybitRateLimitError',
        'BybitRefusalError',
        'fetchFundBalance',
        'fetchKeyInfo',
        'fetchUnifiedBalance',
        'isBybitCoolingDown',
        'setBybitCooldownUntil',
        'signedBybitGet',
      ]),
    );
  });
});
