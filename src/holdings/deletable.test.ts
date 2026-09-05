import { isSyncedAccount, isSyncedHolding, isSyncedTransaction } from './deletable';

describe('synced predicates', () => {
  it('flags every non-manual transaction source', () => {
    expect(isSyncedTransaction({ source: 'monobank' })).toBe(true);
    expect(isSyncedTransaction({ source: 'btc_wallet' })).toBe(true);
    expect(isSyncedTransaction({ source: 'binance' })).toBe(true);
    expect(isSyncedTransaction({ source: 'manual' })).toBe(false);
  });

  it('flags a holding carrying a monobankId', () => {
    expect(isSyncedHolding({ metadata: { monobankId: 'abc' } })).toBe(true);
    expect(isSyncedHolding({ metadata: { iban: 'UA...' } })).toBe(false);
    expect(isSyncedHolding({ metadata: null })).toBe(false);
  });

  it('flags a holding carrying a walletAddress or a binanceAsset', () => {
    expect(
      isSyncedHolding({
        metadata: { walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
      }),
    ).toBe(true);
    expect(isSyncedHolding({ metadata: { binanceAsset: 'BTC' } })).toBe(true);
  });

  it('does not flag a non-string sync key', () => {
    expect(isSyncedHolding({ metadata: { walletAddress: 1 } })).toBe(false);
    expect(isSyncedHolding({ metadata: { syncedAt: 1_704_326_400_000 } })).toBe(false);
  });

  it('flags every synced institution', () => {
    expect(isSyncedAccount({ institution: 'monobank' })).toBe(true);
    expect(isSyncedAccount({ institution: 'btc_wallet' })).toBe(true);
    expect(isSyncedAccount({ institution: 'binance' })).toBe(true);
    expect(isSyncedAccount({ institution: null })).toBe(false);
    expect(isSyncedAccount({ institution: 'kraken' })).toBe(false);
  });
});
