import { match, P } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { parseUntrackedCounterpart } from '@kiko/transactions/untracked-counterpart';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long before and after an exchange row its bank debit may be dated, both edges inclusive.
 * The sides differ because the cash moves in a different order for each kind: a P2P seller
 * releases the coin soon after the bank transfer, a card purchase posts to the bank statement
 * days later, and a fiat deposit is usually sent from the bank well before Binance books it.
 */
type FundingWindow = { beforeMs: number; afterMs: number };

const P2P_FUNDING_WINDOW: FundingWindow = { beforeMs: HOUR_MS, afterMs: 2 * HOUR_MS };
const CARD_FUNDING_WINDOW: FundingWindow = { beforeMs: DAY_MS, afterMs: 3 * DAY_MS };
const FIAT_DEPOSIT_FUNDING_WINDOW: FundingWindow = { beforeMs: 5 * DAY_MS, afterMs: HOUR_MS };

type FundingKind = 'p2p' | 'card' | 'bank';

/**
 * The minimal row shape the matcher needs. `currency` is the parent HOLDING's currency (a
 * transaction row carries none of its own), joined in by the caller.
 */
type FundingLedgerRow = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: Currency;
  untrackedCounterpart: string | null;
  description: string;
  mcc: number | null;
  categorySetByHand: boolean;
};

type FundingMatch = { exchangeId: string; kind: FundingKind };

type ExchangeFundingMatches = {
  matches: Map<string, FundingMatch>;
  excludedIds: Set<string>;
};

type Funding = {
  exchange: FundingLedgerRow;
  kind: FundingKind;
  fiat: string;
  totalMinorUnits: number;
};

type FundingPair = { bank: FundingLedgerRow; funding: Funding };

const fundingWindowOf = (kind: FundingKind): FundingWindow =>
  match(kind)
    .with('p2p', () => P2P_FUNDING_WINDOW)
    .with('card', () => CARD_FUNDING_WINDOW)
    .with('bank', () => FIAT_DEPOSIT_FUNDING_WINDOW)
    .exhaustive();

// The total and its fiat come from the stored code only, never from the row's own amount: the
// exchange row is in the coin it bought, so only the code knows what the bank was asked to pay.
const fundingOf = (exchange: FundingLedgerRow): Funding | undefined => {
  if (exchange.amountMinorUnits <= 0) {
    return undefined;
  }

  return foldMap(maybe(parseUntrackedCounterpart(exchange.untrackedCounterpart)), (parsed) =>
    match(parsed)
      .with(
        { kind: P.union('p2p', 'card', 'bank'), totalMinorUnits: P.number },
        ({ kind, fiat, totalMinorUnits }): Funding => ({ exchange, kind, fiat, totalMinorUnits }),
      )
      .otherwise(() => undefined),
  );
};

const bucketKey = (fiat: string, totalMinorUnits: number): string => `${fiat}:${totalMinorUnits}`;

// A holding with no account, or one the map does not know, counts as not crypto: only a crypto
// account's own rows are an exchange's books, never the bank statement that funded them.
const isBankSide = (
  row: FundingLedgerRow,
  accountKindByHoldingId: ReadonlyMap<string, AccountRow['kind']>,
): boolean => row.amountMinorUnits < 0 && accountKindByHoldingId.get(row.holdingId) !== 'crypto';

// Every bank-side debit grouped by (fiat, amount) and time-sorted, so an exchange row's candidate
// debits are one binary-searchable slice instead of a scan over the whole ledger.
const buildBankBuckets = (
  ledger: readonly FundingLedgerRow[],
  accountKindByHoldingId: ReadonlyMap<string, AccountRow['kind']>,
): Map<string, FundingLedgerRow[]> => {
  const buckets = new Map<string, FundingLedgerRow[]>();

  for (const row of ledger) {
    if (!isBankSide(row, accountKindByHoldingId)) {
      continue;
    }

    const key = bucketKey(row.currency, -row.amountMinorUnits);
    const bucket = buckets.get(key) ?? [];

    bucket.push(row);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.time - b.time);
  }

  return buckets;
};

// First index in a time-sorted bucket whose `time` is >= `lowTime`.
const lowerBoundByTime = (bucket: readonly FundingLedgerRow[], lowTime: number): number => {
  let low = 0;
  let high = bucket.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (bucket[mid].time < lowTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

const candidatePairsOf = (
  funding: Funding,
  buckets: ReadonlyMap<string, readonly FundingLedgerRow[]>,
): FundingPair[] => {
  const bucket = buckets.get(bucketKey(funding.fiat, funding.totalMinorUnits)) ?? [];
  const { beforeMs, afterMs } = fundingWindowOf(funding.kind);
  const highTime = funding.exchange.time + afterMs;
  const pairs: FundingPair[] = [];

  for (
    let cursor = lowerBoundByTime(bucket, funding.exchange.time - beforeMs);
    cursor < bucket.length && bucket[cursor].time <= highTime;
    cursor += 1
  ) {
    pairs.push({ bank: bucket[cursor], funding });
  }

  return pairs;
};

// How a card payment to an exchange shows on a bank statement: a wire transfer (4829) or a
// top-up at a financial institution (6012). A debit like this is the likelier funding than a shop
// purchase of the same amount, so it takes the match first.
const TRANSFER_LIKE_MCCS: readonly (number | null)[] = [4829, 6012];
const EXCHANGE_NAME = 'binance';

// The stored description, not the one a category rule matches on: a bank debit is not an exchange
// leg, and a blank manual row's label is a category or default text, never the exchange's name.
const isTransferLike = ({ mcc, description }: FundingLedgerRow): boolean =>
  TRANSFER_LIKE_MCCS.includes(mcc) || description.toLowerCase().includes(EXCHANGE_NAME);

const gapOf = ({ bank, funding }: FundingPair): number =>
  Math.abs(bank.time - funding.exchange.time);

const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

// The ids end the order so the same ledger pairs the same rows whatever order it arrives in.
const byPriority = (left: FundingPair, right: FundingPair): number =>
  Number(isTransferLike(right.bank)) - Number(isTransferLike(left.bank)) ||
  gapOf(left) - gapOf(right) ||
  compareText(left.bank.id, right.bank.id) ||
  compareText(left.funding.exchange.id, right.funding.exchange.id);

// The best pair of ALL candidates is taken first and each bank row and each exchange row is used
// at most once, so a debit another rule already leaves out of spending still takes its match
// instead of handing it to a later, genuine purchase.
const pairOneToOne = (pairs: readonly FundingPair[]): FundingPair[] => {
  const consumedBankIds = new Set<string>();
  const consumedExchangeIds = new Set<string>();
  const taken: FundingPair[] = [];

  for (const pair of [...pairs].sort(byPriority)) {
    if (consumedBankIds.has(pair.bank.id) || consumedExchangeIds.has(pair.funding.exchange.id)) {
      continue;
    }

    consumedBankIds.add(pair.bank.id);
    consumedExchangeIds.add(pair.funding.exchange.id);
    taken.push(pair);
  }

  return taken;
};

/**
 * Pairs every exchange row that records a fiat payment (`p2p:`, `card:` or `bank:` code with a
 * total, positive amount) with the bank debit that funded it: a negative row on a holding of a
 * non-crypto account, in the code's fiat, for exactly minus the total in minor units, dated inside
 * the kind's window around the exchange row. Returns the pairs by bank row id and the ids to leave
 * out of spending: every matched debit except one the user categorized by hand, which stays in
 * spending as set but still takes its match.
 */
export const exchangeFundingMatches = (
  ledger: readonly FundingLedgerRow[],
  accountKindByHoldingId: ReadonlyMap<string, AccountRow['kind']>,
): ExchangeFundingMatches => {
  const buckets = buildBankBuckets(ledger, accountKindByHoldingId);
  const pairs = ledger
    .flatMap((row) => fundingOf(row) ?? [])
    .flatMap((funding) => candidatePairsOf(funding, buckets));
  const taken = pairOneToOne(pairs);

  const matches = new Map<string, FundingMatch>(
    taken.map(({ bank, funding }) => [
      bank.id,
      { exchangeId: funding.exchange.id, kind: funding.kind },
    ]),
  );
  const excludedIds = new Set(
    taken.flatMap(({ bank }) => (bank.categorySetByHand ? [] : [bank.id])),
  );

  return { matches, excludedIds };
};
