import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { bifoldMap, eitherSync } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';
import { BinanceWalkStop, rowMinorUnits } from '@kiko/crypto-sync/exchange/walk';

import { holdingKeyOf } from './binance.holding-keys';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import type { BinanceDustEntry, BinanceDustRecord } from './binance.history-client';

/** The stop of an entry the rules cannot read, and of a page record the client could not read. */
const DUST_ROW_UNREADABLE = 'dust-row-unreadable';

const DUST_AMOUNT_INVALID = 'dust-amount-invalid';

/** The one coin Binance converts dust into: an entry that names another is not read. */
const DUST_TARGET: Currency = 'BNB';

/**
 * A row mapped from a dust entry, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's Spot holding, `counterpartWallet` the other leg's. A lone BNB leg (the coin is not
 * tracked) has `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedDustRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'dust';
};

/**
 * What one entry of a record comes to: its rows with the ticker of a coin Kiko does not track
 * (`rows`), a stop the entry owes a log line (`stopped`, with the coin when its amount was past
 * the safe integer), or nothing at all (`none`, an entry that comes to 0 units).
 */
export type DustEntryOutcome =
  | { kind: 'rows'; rows: PlannedDustRow[]; untracked: string[] }
  | { kind: 'stopped'; code: string; oversizedTicker?: string }
  | { kind: 'none' };

const NONE: DustEntryOutcome = { kind: 'none' };

const unitsOf = (currency: Currency, amountText: string | undefined): number => {
  if (amountText === undefined) {
    throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
  }

  const units = rowMinorUnits(currency, amountText);

  if (units < 0) {
    throw new BinanceWalkStop(DUST_AMOUNT_INVALID);
  }

  return units;
};

/**
 * The identity of an entry is settled before any amount is read: the coin it converts must be one
 * and only one entry of the record (two entries of a coin would share a pair id, and neither is
 * the right one), and it must be converted into BNB. A record is read again while it is among the
 * newest 100 and none of this changes, so an entry that fails it is left out, not owed.
 */
const readableFromAsset = (record: BinanceDustRecord, entry: BinanceDustEntry): string => {
  const { fromAsset = '', targetAsset } = entry;
  const isRepeated = record.entries.filter((other) => other.fromAsset === fromAsset).length > 1;

  if (fromAsset === '' || fromAsset === DUST_TARGET || targetAsset !== DUST_TARGET || isRepeated) {
    throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
  }

  return fromAsset;
};

/**
 * The rows of one entry, or a `BinanceWalkStop`. A coin Kiko tracks pairs with BNB on Spot; one it
 * does not track leaves the BNB leg alone, marked with the coin, and its amount is never read.
 */
const rowsOfEntry = (
  accountId: string,
  record: BinanceDustRecord,
  entry: BinanceDustEntry,
): DustEntryOutcome => {
  const fromAsset = readableFromAsset(record, entry);
  const pairId = `${accountId}:dust:${record.transId}:${fromAsset}`;
  const keyOf = (coin: Currency): string => holdingKeyOf(coin, 'spot');
  const legOf = (coin: Currency, amountMinorUnits: number) => ({
    wallet: keyOf(coin),
    amountMinorUnits,
    time: record.operateTime,
    externalId: `${pairId}:${keyOf(coin)}`,
    description: '',
    operation: 'dust' as const,
  });

  return match(fromAsset)
    .returnType<DustEntryOutcome>()
    .when(isTrackedBinanceAsset, (coin) => {
      const given = unitsOf(coin, entry.amount);
      const received = unitsOf(DUST_TARGET, entry.transferedAmount);

      if (given === 0 || received === 0) {
        return NONE;
      }

      return {
        kind: 'rows',
        untracked: [],
        rows: [
          {
            ...legOf(coin, -given),
            counterpartWallet: keyOf(DUST_TARGET),
            exchangePairId: pairId,
          },
          {
            ...legOf(DUST_TARGET, received),
            counterpartWallet: keyOf(coin),
            exchangePairId: pairId,
          },
        ],
      };
    })
    .otherwise((ticker) => {
      const untrackedCounterpart = untrackedAssetCode(ticker);

      if (untrackedCounterpart === undefined) {
        throw new BinanceWalkStop(DUST_ROW_UNREADABLE);
      }

      const received = unitsOf(DUST_TARGET, entry.transferedAmount);

      return received === 0
        ? NONE
        : {
            kind: 'rows',
            untracked: [ticker],
            rows: [{ ...legOf(DUST_TARGET, received), untrackedCounterpart }],
          };
    });
};

/**
 * What each entry of a dust record comes to, on its own: an entry the rules cannot read, or whose
 * amount the parser refuses, is a `stopped` outcome with its code and never throws past the record,
 * so its sibling entries still map. An entry whose amounts come to 0 units gives nothing (`none`).
 * The record's own `transId` and `operateTime` are already usable: the client leaves a record
 * without them out of the page.
 */
export const dustRowsOf = (input: {
  accountId: string;
  record: BinanceDustRecord;
}): DustEntryOutcome[] => {
  const { accountId, record } = input;

  return record.entries.map((entry) =>
    bifoldMap(
      eitherSync<unknown, DustEntryOutcome>(() => rowsOfEntry(accountId, record, entry)),
      (error): DustEntryOutcome => {
        if (!(error instanceof BinanceWalkStop)) {
          throw error;
        }

        return {
          kind: 'stopped',
          code: error.code,
          ...foldMap(maybe(error.oversizedTicker), (ticker) => ({ oversizedTicker: ticker })),
        };
      },
      (outcome) => outcome,
    ),
  );
};
