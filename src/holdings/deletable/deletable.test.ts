import {
  hasSyncedKey,
  isSyncedAccount,
  isSyncedHolding,
  syncedHoldingIds,
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

  // PrivatBank, bunq, and Starling have no bank-CONNECT (Guideline 2.5.19), so
  // their institution ids are not synced.
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

  it('flags a holding carrying a bybitAsset', () => {
    expect(
      isSyncedHolding({ metadata: { bybitAsset: 'BTC:unified' } }, { institution: 'bybit' }),
    ).toBe(true);
  });

  // Each pair is a synced key and the institution that owns it: a connect writes both.
  const OWN_PAIRS = [
    ['monobankId', 'monobank'],
    ['walletAddress', 'btc_wallet'],
    ['binanceAsset', 'binance'],
    ['bybitAsset', 'bybit'],
  ] as const;
  const EARLIER_PROVIDER_PAIRS = OWN_PAIRS.flatMap(([key, owner]) =>
    OWN_PAIRS.filter(([, institution]) => institution !== owner).map(
      ([, institution]) => [key, institution] as const,
    ),
  );

  it.each(OWN_PAIRS)('a %s key is synced on an account connected to %s', (key, institution) => {
    expect(isSyncedHolding({ metadata: { [key]: 'key-1' } }, { institution })).toBe(true);
  });

  it.each(EARLIER_PROVIDER_PAIRS)(
    '%s is not synced on an account connected to %s',
    (key, institution) => {
      expect(isSyncedHolding({ metadata: { [key]: 'key-1' } }, { institution })).toBe(false);
    },
  );

  it('a holding with two keys is synced when one is the current provider’s', () => {
    const metadata = { walletAddress: 'bc1q', binanceAsset: 'BTC' };

    expect(isSyncedHolding({ metadata }, { institution: 'binance' })).toBe(true);
    expect(isSyncedHolding({ metadata }, { institution: 'btc_wallet' })).toBe(true);
  });

  // A map read with no institution check turns a miss into the key "undefined" or "null". Each
  // metadata below holds that key, so only the check makes the holding manual.
  it('an institution that names no provider makes no holding synced', () => {
    expect(isSyncedHolding({ metadata: { undefined: 'x' } }, { institution: 'kraken' })).toBe(
      false,
    );
    expect(isSyncedHolding({ metadata: { null: 'x' } }, { institution: null })).toBe(false);
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

describe('hasSyncedKey', () => {
  it.each(['monobankId', 'walletAddress', 'binanceAsset', 'bybitAsset'])(
    'is true for a %s key',
    (field) => {
      expect(hasSyncedKey({ [field]: 'key-1' })).toBe(true);
    },
  );

  it('is false for no metadata, a non-object and a key that is not a string', () => {
    expect(hasSyncedKey(null)).toBe(false);
    expect(hasSyncedKey(undefined)).toBe(false);
    expect(hasSyncedKey('bybitAsset')).toBe(false);
    expect(hasSyncedKey({ bybitAsset: 1 })).toBe(false);
    expect(hasSyncedKey({ iban: 'UA00' })).toBe(false);
  });
});

describe('syncedHoldingIds', () => {
  it('names the keyed holdings of a connected account and no other', () => {
    const accountById = new Map([
      ['connected', { institution: 'bybit' }],
      ['detached', { institution: null }],
    ]);
    const holdings = [
      { id: 'keyed', accountId: 'connected', metadata: { bybitAsset: 'BTC:unified' } },
      { id: 'plain', accountId: 'connected', metadata: null },
      { id: 'kept-key', accountId: 'detached', metadata: { bybitAsset: 'ETH:unified' } },
      { id: 'orphan', accountId: 'gone', metadata: { bybitAsset: 'SOL:unified' } },
    ];

    expect(syncedHoldingIds(holdings, accountById)).toEqual(new Set(['keyed']));
  });

  it('leaves out no holding with an earlier provider’s key', () => {
    const accountById = new Map([
      ['binance-account', { institution: 'binance' }],
      ['wallet-account', { institution: 'btc_wallet' }],
    ]);
    const holdings = [
      {
        id: 'wallet-on-binance',
        accountId: 'binance-account',
        metadata: { walletAddress: 'bc1q' },
      },
      { id: 'binance-on-wallet', accountId: 'wallet-account', metadata: { binanceAsset: 'BTC' } },
      { id: 'binance-on-binance', accountId: 'binance-account', metadata: { binanceAsset: 'ETH' } },
    ];

    expect(syncedHoldingIds(holdings, accountById)).toEqual(new Set(['binance-on-binance']));
  });
});
