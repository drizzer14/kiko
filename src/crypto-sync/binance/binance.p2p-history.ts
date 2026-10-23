import { match, P } from 'ts-pattern';
import { bifoldMap } from 'fnts/either';
import type { Currency } from '@kiko/currency/currency';
import { fiatTotalCode } from '@kiko/transactions/untracked-counterpart';
import { type NotImportedKind, notImportedEntry } from '@kiko/crypto-sync/exchange/walk-state';
import { AMOUNT_STOP_CODES, BinanceWalkStop, rowMinorUnits } from '@kiko/crypto-sync/exchange/walk';

import { holdingKeyOf } from './binance.holding-keys';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import type { BinanceP2pOrder } from './binance.history-client';

/**
 * The statuses of an order that waits on Binance: its point is owed until it is final, whatever
 * its side or role. The raw Binance docs list no `orderStatus` value, so the five words are the
 * spec's ("### P2P", step 1); `.superpowers/sdd/binance-set12/fiat-doc-quote.md` records that
 * no doc text was found for them.
 */
export const P2P_OPEN_STATUSES = [
  'PENDING',
  'TRADING',
  'BUYER_PAYED',
  'DISTRIBUTING',
  'IN_APPEAL',
] as const;

/** The stop of an order that waits on Binance: its point is owed until it is final. */
const P2P_NOT_SETTLED = 'p2p-not-settled';

/** The stop of a page order the client could not place, such as one with no order number. */
const P2P_ORDER_UNREADABLE = 'p2p-order-unreadable';

/**
 * The stops of one order that the forward pass owes and goes past: the order stays owed at its own
 * point until it is final or the floor drops it, and holding the cursor behind it would keep every
 * newer order from importing. Like Convert, it applies only to an order with a usable time.
 */
export const P2P_FORWARD_OWES: readonly string[] = [
  P2P_NOT_SETTLED,
  P2P_ORDER_UNREADABLE,
  ...AMOUNT_STOP_CODES,
];

/**
 * A row mapped from a completed taker buy, before its wallet is turned into a holding: `wallet`
 * is the key of the coin's Funding holding.
 */
type PlannedP2pRow = {
  wallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
  comment: string;
  untrackedCounterpart: string;
  operation: 'p2p';
};

/**
 * What one order comes to: its row (`row`), the entry of an order a rule refuses for good
 * (`refused`), an order that waits on Binance (`owed`), nothing at all (`none`, an order that
 * was cancelled), or the ticker of a coin Kiko does not track (`untracked`, counted, no row).
 */
type P2pOutcome =
  | { kind: 'row'; row: PlannedP2pRow }
  | { kind: 'refused'; entry: string }
  | { kind: 'owed' }
  | { kind: 'none' }
  | { kind: 'untracked'; ticker: string };

/** The amount fields an order gives: its taker amount, or the pair that makes one. */
type AmountFields =
  | { kind: 'taker'; takerAmount: string; amount?: string; takerCommission?: string }
  | { kind: 'net'; amount: string; takerCommission: string };

const refusedOutcomeOf = (kind: NotImportedKind, order: BinanceP2pOrder): P2pOutcome => ({
  kind: 'refused',
  entry: notImportedEntry(kind, order.orderNumber, order.createTime),
});

const amountFieldsOf = (order: BinanceP2pOrder): AmountFields | undefined =>
  match(order)
    .returnType<AmountFields | undefined>()
    .with({ takerAmount: P.string }, ({ takerAmount, amount, takerCommission }) => ({
      kind: 'taker',
      takerAmount,
      amount,
      takerCommission,
    }))
    .with({ amount: P.string, takerCommission: P.string }, ({ amount, takerCommission }) => ({
      kind: 'net',
      amount,
      takerCommission,
    }))
    .otherwise(() => undefined);

/**
 * The exact minor units of the row: the taker amount, which must equal the amount less the
 * commission when both are given (`undefined` when they differ), or that difference. Each text
 * is parsed at the coin's own scale and the two are subtracted as integers.
 */
const unitsOf = (asset: Currency, fields: AmountFields): number | undefined =>
  match(fields)
    .returnType<number | undefined>()
    .with(
      { kind: 'taker', amount: P.string, takerCommission: P.string },
      ({ takerAmount, amount, takerCommission }) => {
        const taker = rowMinorUnits(asset, takerAmount);
        const net = rowMinorUnits(asset, amount) - rowMinorUnits(asset, takerCommission);

        return net === taker ? taker : undefined;
      },
    )
    .with({ kind: 'taker' }, ({ takerAmount }) => rowMinorUnits(asset, takerAmount))
    .with(
      { kind: 'net' },
      ({ amount, takerCommission }) =>
        rowMinorUnits(asset, amount) - rowMinorUnits(asset, takerCommission),
    )
    .exhaustive();

/** The marker for the fiat total as Binance sent it; a total no code can carry owes the point. */
const markerOf = (fiat: string, totalPrice: string): string =>
  bifoldMap(
    fiatTotalCode('p2p', fiat, totalPrice),
    (code): string => {
      throw new BinanceWalkStop(code);
    },
    (marker) => marker,
  );

const rowOutcomeOf = (input: {
  accountId: string;
  order: BinanceP2pOrder;
  asset: Currency;
  fields: AmountFields;
}): P2pOutcome => {
  const { accountId, order, asset, fields } = input;
  const { fiat, totalPrice } = order;

  // No row or marker can be made without the fiat and its total, and a re-read cannot change it.
  if (fiat === undefined || totalPrice === undefined) {
    return refusedOutcomeOf('p2p-unrecognized', order);
  }

  const units = unitsOf(asset, fields);

  if (units === undefined || units <= 0) {
    return refusedOutcomeOf('p2p-amount', order);
  }

  const wallet = holdingKeyOf(asset, 'funding');

  return {
    kind: 'row',
    row: {
      wallet,
      amountMinorUnits: units,
      time: order.createTime,
      externalId: `${accountId}:p2p:${order.orderNumber}:${wallet}`,
      description: '',
      comment: `${totalPrice} ${fiat}`,
      untrackedCounterpart: markerOf(fiat, totalPrice),
      operation: 'p2p',
    },
  };
};

const assetOutcomeOf = (input: {
  accountId: string;
  order: BinanceP2pOrder;
  fields: AmountFields;
}): P2pOutcome => {
  const { order } = input;
  const { asset } = order;

  if (asset === undefined || asset === '') {
    return refusedOutcomeOf('p2p-unrecognized', order);
  }

  return isTrackedBinanceAsset(asset)
    ? rowOutcomeOf({ ...input, asset })
    : { kind: 'untracked', ticker: asset };
};

const takerOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(amountFieldsOf(order))
    .returnType<P2pOutcome>()
    .with(P.nullish, () => refusedOutcomeOf('p2p-amount', order))
    .otherwise((fields) => assetOutcomeOf({ accountId, order, fields }));

const completedBuyOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(order.advertisementRole)
    .returnType<P2pOutcome>()
    .with('MAKER', () => refusedOutcomeOf('p2p-advertiser', order))
    .with('TAKER', () => takerOutcomeOf(accountId, order))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));

const completedOutcomeOf = (accountId: string, order: BinanceP2pOrder): P2pOutcome =>
  match(order.tradeType)
    .returnType<P2pOutcome>()
    .with('SELL', () => refusedOutcomeOf('p2p-sale', order))
    .with('BUY', () => completedBuyOutcomeOf(accountId, order))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));

/**
 * What one P2P order comes to, decided in the order the status, the side, the role, the amount
 * and the coin (spec "### P2P"). Only a `COMPLETED` order goes on; a cancelled one is nothing,
 * one that waits on Binance (`P2P_OPEN_STATUSES`) is owed whatever else it says, and any other
 * word is refused for good. A sale wins over every role. A buy as a taker gives the row
 * `takerAmount` (or the amount less the commission), on the Funding holding of its coin, marked
 * with the total Binance sent; an order whose amounts cannot be told is refused, and one whose
 * text the parser refuses throws a `BinanceWalkStop` and owes its point. An order of a coin Kiko
 * does not track is counted and gives no row.
 */
export const p2pOutcomeOf = (input: { accountId: string; order: BinanceP2pOrder }): P2pOutcome => {
  const { accountId, order } = input;

  return match(order.orderStatus)
    .returnType<P2pOutcome>()
    .with('COMPLETED', () => completedOutcomeOf(accountId, order))
    .with('CANCELLED', 'CANCELLED_BY_SYSTEM', () => ({ kind: 'none' }))
    .with(P.union(...P2P_OPEN_STATUSES), () => ({ kind: 'owed' }))
    .otherwise(() => refusedOutcomeOf('p2p-unrecognized', order));
};
