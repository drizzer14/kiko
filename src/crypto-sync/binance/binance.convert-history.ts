import { match, P } from 'ts-pattern';
import type { Currency } from '@kiko/currency/currency';
import { notImportedEntry } from '@kiko/crypto-sync/exchange/walk-state';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';
import { AMOUNT_STOP_CODES, BinanceWalkStop, rowMinorUnits } from '@kiko/crypto-sync/exchange/walk';

import { isTrackedBinanceAsset } from './binance.tracked-coin';
import type { BinanceConvertRecord } from './binance.history-client';
import { type BinanceWallet, holdingKeyOf } from './binance.holding-keys';

/** The stop of a conversion that waits on Binance: its point is owed until it settles. */
const CONVERT_NOT_SETTLED = 'convert-not-settled';

/** The stop of a settled conversion that lacks a coin, an amount, or a code to mark a lone leg. */
const CONVERT_ROW_UNREADABLE = 'convert-row-unreadable';

const CONVERT_AMOUNT_INVALID = 'convert-amount-invalid';

/**
 * The stops of one conversion that the forward pass owes and goes past: the conversion stays owed
 * at its own point until it settles or the floor drops it, and holding the cursor behind it would
 * keep every newer conversion from importing. Like Transfer, it applies only to a conversion with
 * a usable time; a stop that is no one conversion's is not in this list.
 */
export const CONVERT_FORWARD_OWES: readonly string[] = [
  CONVERT_NOT_SETTLED,
  CONVERT_ROW_UNREADABLE,
  CONVERT_AMOUNT_INVALID,
  ...AMOUNT_STOP_CODES,
];

/**
 * A row mapped from a conversion, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's holding it sits on, `counterpartWallet` the other leg's. A lone leg (the other coin
 * is not tracked) has `untrackedCounterpart` instead of a counterpart and a pair id.
 */
export type PlannedConvertRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'convert';
};

/**
 * What one conversion comes to: its rows with the tickers of the coins Kiko does not track
 * (`rows`, none when neither side is tracked), the entry of a record a rule refuses for good
 * (`refused`), or nothing at all (`none`, a conversion that failed).
 */
export type ConvertOutcome =
  | { kind: 'rows'; rows: PlannedConvertRow[]; untracked: string[] }
  | { kind: 'refused'; entry: string }
  | { kind: 'none' };

type ConvertSide = { asset: string; amountText: string | undefined; sign: 1 | -1 };

type TrackedSide = ConvertSide & { asset: Currency };

type ConvertLeg = TrackedSide & { units: number };

const refusedOutcomeOf = (record: BinanceConvertRecord): ConvertOutcome => ({
  kind: 'refused',
  entry: notImportedEntry('convert-unrecognized', record.recordId, record.createTime),
});

const walletOf = (walletType: string | undefined): BinanceWallet | undefined =>
  match(walletType)
    .returnType<BinanceWallet | undefined>()
    .with('FUNDING', () => 'funding')
    .with('SPOT', () => 'spot')
    .otherwise(() => undefined);

// The client keeps '' for a ticker that trims to nothing, so a blank one reads like an absent one.
const requiredAsset = (asset: string | undefined): string => {
  if (asset === undefined || asset === '') {
    throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
  }

  return asset;
};

const isTracked = (side: ConvertSide): side is TrackedSide => isTrackedBinanceAsset(side.asset);

const legOf = (side: TrackedSide): ConvertLeg => {
  if (side.amountText === undefined) {
    throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
  }

  const units = rowMinorUnits(side.asset, side.amountText);

  if (units <= 0) {
    throw new BinanceWalkStop(CONVERT_AMOUNT_INVALID);
  }

  return { ...side, units };
};

const settledOutcomeOf = (accountId: string, record: BinanceConvertRecord): ConvertOutcome => {
  const wallet = walletOf(record.walletType);

  if (wallet === undefined) {
    return refusedOutcomeOf(record);
  }

  const fromAsset = requiredAsset(record.fromAsset);
  const toAsset = requiredAsset(record.toAsset);

  if (fromAsset === toAsset) {
    return refusedOutcomeOf(record);
  }

  const sides: ConvertSide[] = [
    { asset: fromAsset, amountText: record.fromAmount, sign: -1 },
    { asset: toAsset, amountText: record.toAmount, sign: 1 },
  ];
  const legs = sides.filter(isTracked).map(legOf);
  const untracked = sides.filter((side) => !isTracked(side)).map(({ asset }) => asset);
  const pairId = `${accountId}:convert:${record.recordId}`;
  const keyOf = (leg: ConvertLeg): string => holdingKeyOf(leg.asset, wallet);
  const baseOf = (leg: ConvertLeg) => ({
    wallet: keyOf(leg),
    amountMinorUnits: leg.sign * leg.units,
    time: record.createTime,
    externalId: `${pairId}:${keyOf(leg)}`,
    description: '',
    operation: 'convert' as const,
  });
  const pairedLegOf = (leg: ConvertLeg, other: ConvertLeg): PlannedConvertRow => ({
    ...baseOf(leg),
    counterpartWallet: keyOf(other),
    exchangePairId: pairId,
  });
  const [otherTicker = ''] = untracked;

  const rows = match(legs)
    .returnType<PlannedConvertRow[]>()
    .with([P._, P._], ([first, second]) => [pairedLegOf(first, second), pairedLegOf(second, first)])
    .with([P._], ([only]) => {
      const untrackedCounterpart = untrackedAssetCode(otherTicker);

      if (untrackedCounterpart === undefined) {
        throw new BinanceWalkStop(CONVERT_ROW_UNREADABLE);
      }

      return [{ ...baseOf(only), untrackedCounterpart }];
    })
    .otherwise(() => []);

  return { kind: 'rows', rows, untracked };
};

/**
 * What one Convert record comes to, decided in the order the status, the wallet, the coins (spec
 * "Convert"). `FAIL` is nothing; a conversion that waits on Binance, or one the walk cannot trust
 * (a coin or amount missing or not above zero on a tracked side), throws a `BinanceWalkStop` and
 * owes its point, because a skipped one would be silent loss; a status or wallet outside the
 * allowlist, and a conversion of a coin into itself, are refused for good into one entry. A side
 * whose coin is not tracked is never read for its amount: the tracked leg stands alone, marked with
 * the other coin, and a conversion of two such coins gives no row.
 */
export const convertOutcomeOf = (input: {
  accountId: string;
  record: BinanceConvertRecord;
}): ConvertOutcome => {
  const { accountId, record } = input;

  return match(record.orderStatus)
    .returnType<ConvertOutcome>()
    .with('SUCCESS', () => settledOutcomeOf(accountId, record))
    .with('PROCESS', 'ACCEPT_SUCCESS', () => {
      throw new BinanceWalkStop(CONVERT_NOT_SETTLED);
    })
    .with('FAIL', () => ({ kind: 'none' }))
    .otherwise(() => refusedOutcomeOf(record));
};
