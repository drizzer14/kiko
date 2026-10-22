import { match } from 'ts-pattern';
import type { Currency } from '@kiko/currency/currency';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';
import { untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';
import { BinanceWalkStop, rowMinorUnits } from '@kiko/crypto-sync/exchange/walk';

import { holdingKeyOf } from './binance.holding-keys';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceMyTrade, BinanceHistoryParseError } from './binance.history-client';

/** The stop of an amount text that is below zero: Binance sends none, so the order is not read. */
const TRADE_AMOUNT_INVALID = 'trade-amount-invalid';

/** The stop of a coin whose ticker cannot be written as an `asset:` code. */
const TRADE_ROW_UNREADABLE = 'trade-row-unreadable';

const AMOUNT_FIELDS = ['qty', 'quoteQty', 'commission'] as const;

/**
 * A row mapped from an order, before its wallets are turned into holdings: `wallet` is the key of
 * the coin's Spot holding, `counterpartWallet` the other leg's. A lone leg has
 * `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedTradeRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: 'trade' | 'trade-fee';
};

type TrackedSide = { kind: 'tracked'; coin: Currency; units: number };

/** One coin of an order: a tracked one with its signed units, or the ticker of one that is not. */
type TradeSide = TrackedSide | { kind: 'untracked'; ticker: string };

type RowContext = { pairId: string; time: number };

const unitsOf = (coin: Currency, amountText: string): number => {
  const units = rowMinorUnits(coin, amountText);

  if (units < 0) {
    throw new BinanceWalkStop(TRADE_AMOUNT_INVALID);
  }

  return units;
};

/** The `asset:` marker of a coin the account does not track. */
const assetMarkerOf = (ticker: string): string => {
  const marker = untrackedAssetCode(ticker);

  if (marker === undefined) {
    throw new BinanceWalkStop(TRADE_ROW_UNREADABLE);
  }

  return marker;
};

/**
 * The side of one coin. A tracked coin is converted here, once, from the order's summed text, with
 * `sign` giving the direction of the money (-1 spent, 1 received); an untracked coin's amount is
 * never read.
 */
const sideOf = (coin: string, amountText: string, sign: -1 | 1): TradeSide =>
  match(coin)
    .returnType<TradeSide>()
    .when(isTrackedBinanceAsset, (tracked) => ({
      kind: 'tracked',
      coin: tracked,
      units: sign * unitsOf(tracked, amountText),
    }))
    .otherwise((ticker) => ({ kind: 'untracked', ticker }));

const legOf = ({ pairId, time }: RowContext, { coin, units }: TrackedSide): PlannedTradeRow => ({
  wallet: holdingKeyOf(coin, 'spot'),
  amountMinorUnits: units,
  time,
  externalId: `${pairId}:${holdingKeyOf(coin, 'spot')}`,
  description: '',
  operation: 'trade',
});

const loneLegOf = (
  context: RowContext,
  tracked: TrackedSide,
  untrackedTicker: string,
): PlannedTradeRow[] =>
  tracked.units === 0
    ? []
    : [{ ...legOf(context, tracked), untrackedCounterpart: assetMarkerOf(untrackedTicker) }];

/** The legs of an order: a pair when both coins are tracked, else the tracked leg alone, if any. */
const legsOf = (context: RowContext, spent: TradeSide, received: TradeSide): PlannedTradeRow[] =>
  match([spent, received] as const)
    .returnType<PlannedTradeRow[]>()
    .with([{ kind: 'tracked' }, { kind: 'tracked' }], ([spentSide, receivedSide]) =>
      spentSide.units === 0 || receivedSide.units === 0
        ? []
        : [
            {
              ...legOf(context, spentSide),
              counterpartWallet: holdingKeyOf(receivedSide.coin, 'spot'),
              exchangePairId: context.pairId,
            },
            {
              ...legOf(context, receivedSide),
              counterpartWallet: holdingKeyOf(spentSide.coin, 'spot'),
              exchangePairId: context.pairId,
            },
          ],
    )
    .with([{ kind: 'tracked' }, { kind: 'untracked' }], ([tracked, other]) =>
      loneLegOf(context, tracked, other.ticker),
    )
    .with([{ kind: 'untracked' }, { kind: 'tracked' }], ([other, tracked]) =>
      loneLegOf(context, tracked, other.ticker),
    )
    .with([{ kind: 'untracked' }, { kind: 'untracked' }], () => [])
    .exhaustive();

type FeeCounterpart = Pick<PlannedTradeRow, 'counterpartWallet' | 'untrackedCounterpart'>;

/** What a fee row names as the other side: the received leg's wallet, or its `asset:` marker. */
const feeCounterpartOf = (received: TradeSide): FeeCounterpart =>
  match(received)
    .returnType<FeeCounterpart>()
    .with({ kind: 'tracked' }, ({ coin }) => ({ counterpartWallet: holdingKeyOf(coin, 'spot') }))
    .with({ kind: 'untracked' }, ({ ticker }) => ({ untrackedCounterpart: assetMarkerOf(ticker) }))
    .exhaustive();

/** A fee row, unless the fee comes to no units of its coin. It carries the pair id of the order. */
const feeRowsOf = (
  { pairId, time }: RowContext,
  received: TradeSide,
  coin: Currency,
  amountText: string,
): PlannedTradeRow[] => {
  const units = unitsOf(coin, amountText);

  return units === 0
    ? []
    : [
        {
          wallet: holdingKeyOf(coin, 'spot'),
          ...feeCounterpartOf(received),
          amountMinorUnits: -units,
          time,
          externalId: `${pairId}:fee:${holdingKeyOf(coin, 'spot')}`,
          exchangePairId: pairId,
          description: '',
          operation: 'trade-fee',
        },
      ];
};

const sumOf = (fills: BinanceMyTrade[], field: (typeof AMOUNT_FIELDS)[number]): string =>
  fills.reduce((sum, fill) => addDecimal(sum, fill[field]), '0');

const commissionIn = (fills: BinanceMyTrade[], coin: string): string =>
  sumOf(
    fills.filter((fill) => fill.commissionAsset === coin),
    'commission',
  );

/** The fill an order starts at: the one with the lowest id, whatever order the fills came in. */
const firstFillOf = (fills: BinanceMyTrade[]): BinanceMyTrade => {
  const [head, ...rest] = fills;

  if (head === undefined) {
    throw new BinanceHistoryParseError();
  }

  return rest.reduce((first, fill) => (Number(fill.id) < Number(first.id) ? fill : first), head);
};

/**
 * The rows of one spot order, from every fill of it that was read. Each amount's text is summed
 * exactly over the fills and converted to minor units once, so a coin stored at a reduced scale
 * rounds once per order, never per fill. A fill's commission in the coin the order spent is added
 * to the spent leg, in the coin it received is taken off the received leg, and in a third coin
 * becomes one fee row per coin; a third coin that is not tracked is listed in `untracked`, as is
 * an untracked coin of the order. A leg that comes to 0 units is not written, nor is its pair
 * partner. A `BinanceHistoryParseError` means the fills cannot be one order; a `BinanceWalkStop`
 * means an amount or ticker the rules refuse.
 */
export const tradeOrderRowsOf = (input: {
  accountId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  orderId: number;
  fills: BinanceMyTrade[];
}): { rows: PlannedTradeRow[]; untracked: string[] } => {
  const { accountId, symbol, baseAsset, quoteAsset, orderId, fills } = input;
  const first = firstFillOf(fills);

  if (fills.some((fill) => fill.isBuyer !== first.isBuyer)) {
    throw new BinanceHistoryParseError();
  }

  if (fills.some((fill) => AMOUNT_FIELDS.some((field) => compareDecimal(fill[field], '0') < 0))) {
    throw new BinanceWalkStop(TRADE_AMOUNT_INVALID);
  }

  const context: RowContext = {
    pairId: `${accountId}:trade:${symbol}:${orderId}`,
    time: first.time,
  };
  const [spentCoin, receivedCoin] = first.isBuyer
    ? [quoteAsset, baseAsset]
    : [baseAsset, quoteAsset];
  const [spentGross, receivedGross] = first.isBuyer
    ? [sumOf(fills, 'quoteQty'), sumOf(fills, 'qty')]
    : [sumOf(fills, 'qty'), sumOf(fills, 'quoteQty')];
  const spent = sideOf(spentCoin, addDecimal(spentGross, commissionIn(fills, spentCoin)), -1);
  const received = sideOf(
    receivedCoin,
    addDecimal(receivedGross, `-${commissionIn(fills, receivedCoin)}`),
    1,
  );
  const thirdCoins = [...new Set(fills.map((fill) => fill.commissionAsset))]
    .filter((coin) => coin !== baseAsset && coin !== quoteAsset)
    .sort()
    .map((coin) => ({ coin, amountText: commissionIn(fills, coin) }))
    .filter(({ amountText }) => compareDecimal(amountText, '0') !== 0);
  const feeRows = thirdCoins.flatMap(({ coin, amountText }) =>
    match(coin)
      .returnType<PlannedTradeRow[]>()
      .when(isTrackedBinanceAsset, (tracked) => feeRowsOf(context, received, tracked, amountText))
      .otherwise(() => []),
  );

  return {
    rows: [...legsOf(context, spent, received), ...feeRows],
    untracked: [baseAsset, quoteAsset, ...thirdCoins.map(({ coin }) => coin)].filter(
      (coin) => !isTrackedBinanceAsset(coin),
    ),
  };
};
