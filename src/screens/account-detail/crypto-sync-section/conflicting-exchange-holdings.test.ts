import type { HoldingRow } from '@kiko/db';
import { balanceProviderIds } from '@kiko/crypto-sync/provider';
import { exchangeCatalog } from '@kiko/crypto-sync/exchange-catalog';
import { type ExchangeMetadataField, syncedMetadataFields } from '@kiko/holdings/holding-metadata';

import { conflictingExchangeHoldings } from './conflicting-exchange-holdings';

type PickedId = (typeof balanceProviderIds)[number] | 'other';

const holdingWith = (metadata: unknown, id = 'h'): HoldingRow => ({ id, metadata }) as HoldingRow;

const holdingKeyedBy = (field: string): HoldingRow => holdingWith({ [field]: 'KEY', syncedAt: 1 });

// O11 and PLANNER CALL 13: a Bybit pick conflicts with a Binance or wallet key, a Binance or
// wallet pick conflicts with a Bybit key, and Binance to wallet (either way) stays as it was.
// Written out for every pick against every metadata key, so a new provider id fails here.
const CONFLICTS: Record<PickedId, readonly (ExchangeMetadataField | 'monobankId')[]> = {
  bybit: ['binanceAsset', 'walletAddress'],
  binance: ['bybitAsset'],
  btc_wallet: ['bybitAsset'],
  other: [],
};

const PICKS: readonly PickedId[] = [...balanceProviderIds, 'other'];

describe('conflictingExchangeHoldings', () => {
  it('holds a row for every catalog entry', () => {
    for (const { id } of exchangeCatalog) {
      expect(CONFLICTS).toHaveProperty(id);
    }
  });

  it.each(
    PICKS.flatMap((pick) =>
      syncedMetadataFields.map((field) => ({
        pick,
        field,
        refused: CONFLICTS[pick].includes(field),
      })),
    ),
  )('$pick against a holding keyed by $field: refused is $refused', ({ pick, field, refused }) => {
    const holding = holdingKeyedBy(field);

    expect(conflictingExchangeHoldings(pick, [holding])).toEqual(refused ? [holding] : []);
  });

  it('refuses a pick that conflicts with a stored holding', () => {
    const bybitHolding = holdingWith({ bybitAsset: 'BTC:UNIFIED' }, 'bybit-holding');
    const manualHolding = holdingWith(null, 'manual-holding');

    expect(conflictingExchangeHoldings('binance', [manualHolding, bybitHolding])).toEqual([
      bybitHolding,
    ]);
    expect(conflictingExchangeHoldings('btc_wallet', [manualHolding, bybitHolding])).toEqual([
      bybitHolding,
    ]);
  });

  it('returns every conflicting holding and no other', () => {
    const binanceHolding = holdingKeyedBy('binanceAsset');
    const walletHolding = holdingKeyedBy('walletAddress');
    const bybitHolding = holdingKeyedBy('bybitAsset');
    const monobankHolding = holdingKeyedBy('monobankId');

    expect(
      conflictingExchangeHoldings('bybit', [
        binanceHolding,
        bybitHolding,
        walletHolding,
        monobankHolding,
        holdingWith({}),
      ]),
    ).toEqual([binanceHolding, walletHolding]);
  });

  it('leaves a Binance user alone: a Binance pick and a wallet pick refuse no Binance holding', () => {
    const binanceHoldings = [holdingKeyedBy('binanceAsset'), holdingWith(null), holdingWith({})];

    expect(conflictingExchangeHoldings('binance', binanceHoldings)).toEqual([]);
    expect(conflictingExchangeHoldings('btc_wallet', binanceHoldings)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'bybitAsset'],
    ['a number', 7],
    ['an array', ['bybitAsset']],
    ['an object without a key', { syncedAt: 1 }],
    ['a key that is not text', { bybitAsset: 1 }],
    ['a key that is null', { bybitAsset: null }],
  ])('reads %s as no key', (_name, metadata) => {
    expect(conflictingExchangeHoldings('binance', [holdingWith(metadata)])).toEqual([]);
  });

  it('refuses nothing for an account with no holding', () => {
    expect(conflictingExchangeHoldings('bybit', [])).toEqual([]);
  });

  it('refuses nothing for a pick that names no provider', () => {
    expect(conflictingExchangeHoldings('some-other-id', [holdingKeyedBy('bybitAsset')])).toEqual(
      [],
    );
  });
});
