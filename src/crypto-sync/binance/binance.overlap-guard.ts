import type { HoldingRow, TransactionRow } from '@kiko/db';

import { binanceKeyOf, EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';

/**
 * How far apart in time a capital row and a Pay row of the same size can be and still read
 * as one movement. The two histories stamp one movement seconds apart, never minutes.
 */
export const OVERLAP_GUARD_MS = 10 * 60_000;

/** The slice of a stored or planned row the pairing reads. */
export type Movement = { externalId: string; amountMinorUnits: number; time: number };

/** Which walk wrote a row, read from its key: deposits and withdrawals, or Pay orders. */
type MovementKind = 'capital' | 'pay';

/** What a walk reads back of a stored transaction row. */
export type StoredMovementRow = Pick<TransactionRow, 'externalId' | 'amountMinorUnits' | 'time'>;

type Movements = Record<MovementKind, Movement[]>;

const BTC_WALLET_KEYS = new Set<string | undefined>([SPOT_KEY, FUNDING_KEY, EARN_KEY]);

const kindOf = (accountId: string, externalId: string): MovementKind | undefined => {
  if (
    [`${accountId}:deposit:`, `${accountId}:withdraw:`].some((prefix) =>
      externalId.startsWith(prefix),
    )
  ) {
    return 'capital';
  }

  return externalId.startsWith(`${accountId}:pay:`) ? 'pay' : undefined;
};

const addMovement = (accountId: string, movements: Movements, row: Movement): void => {
  const kind = kindOf(accountId, row.externalId);

  if (kind !== undefined) {
    movements[kind].push(row);
  }
};

/**
 * The capital and Pay rows already stored on every Binance BTC holding of the account, read
 * once per walk run. Both histories can put one movement on different wallets (a deposit on
 * Spot, the same transfer on Funding), so the pairing never looks at one holding alone.
 */
export const createMovementLedger = (input: {
  accountId: string;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  listHoldingTransactions: (holdingId: string) => Promise<StoredMovementRow[]>;
}) => {
  const { accountId, listHoldings, listHoldingTransactions } = input;
  let movements: Movements | undefined;

  const load = async (): Promise<Movements> => {
    const wallets = (await listHoldings(accountId)).filter((holding) =>
      BTC_WALLET_KEYS.has(binanceKeyOf(holding)),
    );
    const rows = (
      await Promise.all(wallets.map((wallet) => listHoldingTransactions(wallet.id)))
    ).flat();
    const loaded: Movements = { capital: [], pay: [] };

    for (const { externalId, amountMinorUnits, time } of rows) {
      if (externalId !== null) {
        addMovement(accountId, loaded, { externalId, amountMinorUnits, time });
      }
    }

    return loaded;
  };

  return {
    read: async (): Promise<Movements> => {
      movements ??= await load();

      return movements;
    },
    /** Rows this run has just written, so a later window pairs against them without a re-read. */
    remember: (rows: Movement[]): void => {
      if (movements !== undefined) {
        for (const row of rows) {
          addMovement(accountId, movements, row);
        }
      }
    },
  };
};

export type MovementLedger = ReturnType<typeof createMovementLedger>;

type Pair = { own: Movement; other: Movement; gap: number };

const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

/**
 * The candidates that are the twin of a stored row of the other walk, to be left out.
 *
 * Each row pairs with at most one row of the other walk: the closest in time, ties broken by
 * external id (capital id first, then Pay id, so both walks pair the same rows). Stored rows
 * of the candidates' own walk take part, so a stored row that already holds a twin is not
 * paired again; only a candidate that is not stored yet can be left out.
 */
export const twinsOf = (input: {
  kind: MovementKind;
  candidates: Movement[];
  sameKind: Movement[];
  otherKind: Movement[];
}): Set<string> => {
  const { kind, candidates, sameKind, otherKind } = input;
  const storedIds = new Set(sameKind.map((row) => row.externalId));
  const fresh = [...new Map(candidates.map((row) => [row.externalId, row])).values()].filter(
    (row) => !storedIds.has(row.externalId),
  );
  const otherBySize = new Map<number, Movement[]>();

  for (const row of otherKind) {
    otherBySize.set(row.amountMinorUnits, [...(otherBySize.get(row.amountMinorUnits) ?? []), row]);
  }

  const pairs = [...sameKind, ...fresh].flatMap((own): Pair[] =>
    (otherBySize.get(own.amountMinorUnits) ?? [])
      .map((other) => ({ own, other, gap: Math.abs(own.time - other.time) }))
      .filter((pair) => pair.gap <= OVERLAP_GUARD_MS),
  );
  const capitalIdOf = (pair: Pair): string =>
    kind === 'capital' ? pair.own.externalId : pair.other.externalId;
  const payIdOf = (pair: Pair): string =>
    kind === 'capital' ? pair.other.externalId : pair.own.externalId;
  const ordered = pairs.sort(
    (left, right) =>
      left.gap - right.gap ||
      compareText(capitalIdOf(left), capitalIdOf(right)) ||
      compareText(payIdOf(left), payIdOf(right)),
  );
  const freshIds = new Set(fresh.map((row) => row.externalId));
  const paired = new Set<string>();
  const twins = new Set<string>();

  for (const { own, other } of ordered) {
    if (!paired.has(own.externalId) && !paired.has(other.externalId)) {
      paired.add(own.externalId);
      paired.add(other.externalId);

      if (freshIds.has(own.externalId)) {
        twins.add(own.externalId);
      }
    }
  }

  return twins;
};
