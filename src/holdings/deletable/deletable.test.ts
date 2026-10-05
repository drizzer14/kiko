import {
  isSyncedAccount,
  isSyncedHolding,
  isSyncedTransaction,
  isImportedTransaction,
  isDeletableTransaction,
} from './deletable';

describe('isImportedTransaction', () => {
  it('names a row a statement file wrote and no other', () => {
    expect(isImportedTransaction({ source: 'import' })).toBe(true);
    expect(isImportedTransaction({ source: 'manual' })).toBe(false);
    expect(isImportedTransaction({ source: 'monobank' })).toBe(false);
  });
});

describe('isDeletableTransaction', () => {
  it('offers delete for a row the user wrote and a row the user imported', () => {
    expect(isDeletableTransaction({ source: 'manual' })).toBe(true);
    expect(isDeletableTransaction({ source: 'import' })).toBe(true);
  });

  it('refuses a row a sync owns', () => {
    expect(isDeletableTransaction({ source: 'monobank' })).toBe(false);
    expect(isDeletableTransaction({ source: 'btc_wallet' })).toBe(false);
    expect(isDeletableTransaction({ source: 'binance' })).toBe(false);
  });

  it('keeps flagging an imported row as read-only', () => {
    expect(isSyncedTransaction({ source: 'import' })).toBe(true);
  });
});

describe('synced predicates', () => {
  it('flags every non-manual transaction source', () => {
    expect(isSyncedTransaction({ source: 'monobank' })).toBe(true);
    expect(isSyncedTransaction({ source: 'btc_wallet' })).toBe(true);
    expect(isSyncedTransaction({ source: 'binance' })).toBe(true);
    expect(isSyncedTransaction({ source: 'manual' })).toBe(false);
  });

  it('flags every synced institution', () => {
    expect(isSyncedAccount({ institution: 'monobank' })).toBe(true);
    expect(isSyncedAccount({ institution: 'btc_wallet' })).toBe(true);
    expect(isSyncedAccount({ institution: 'binance' })).toBe(true);
    expect(isSyncedAccount({ institution: null })).toBe(false);
    expect(isSyncedAccount({ institution: 'kraken' })).toBe(false);
  });

  // Guideline 5.6 remediation: PrivatBank, bunq, and Starling bank-CONNECT
  // were removed entirely — their institution ids are no longer synced.
  it('rejects every removed provider institution', () => {
    expect(isSyncedAccount({ institution: 'privatbank' })).toBe(false);
    expect(isSyncedAccount({ institution: 'bunq' })).toBe(false);
    expect(isSyncedAccount({ institution: 'starling' })).toBe(false);
  });
});

describe('isSyncedHolding', () => {
  const holding = { metadata: { monobankId: 'mono-1' } };

  it('is synced while its account is connected', () => {
    expect(isSyncedHolding(holding, { institution: 'monobank' })).toBe(true);
  });

  it('is NOT synced once its account is disconnected, even with the key kept', () => {
    expect(isSyncedHolding(holding, { institution: null })).toBe(false);
  });

  it('is not synced when the account is missing', () => {
    expect(isSyncedHolding(holding, undefined)).toBe(false);
  });

  it('is not synced for a manual holding under a connected account', () => {
    expect(isSyncedHolding({ metadata: null }, { institution: 'monobank' })).toBe(false);
    expect(isSyncedHolding({ metadata: { iban: 'UA...' } }, { institution: 'monobank' })).toBe(
      false,
    );
  });

  it('flags a holding carrying a walletAddress or a binanceAsset', () => {
    expect(
      isSyncedHolding(
        { metadata: { walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' } },
        { institution: 'btc_wallet' },
      ),
    ).toBe(true);
    expect(isSyncedHolding({ metadata: { binanceAsset: 'BTC' } }, { institution: 'binance' })).toBe(
      true,
    );
  });

  it('does not flag a non-string sync key', () => {
    expect(isSyncedHolding({ metadata: { walletAddress: 1 } }, { institution: 'btc_wallet' })).toBe(
      false,
    );
    expect(
      isSyncedHolding({ metadata: { syncedAt: 1_704_326_400_000 } }, { institution: 'btc_wallet' }),
    ).toBe(false);
  });
});
