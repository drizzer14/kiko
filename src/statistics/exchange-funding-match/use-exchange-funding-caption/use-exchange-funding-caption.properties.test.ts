// The caption reads one bucket of the ledger; the statistics screen runs the matcher over all of
// it. This property proves the two agree for every debit of random worlds that chain same-amount
// rows across days, on a real database and through the hook itself.
let mockDatabase: DatabaseSync;

const mockServed = {
  candidatesByAmount: new Map<number, unknown[]>(),
  holdings: [] as unknown[],
  accounts: [] as unknown[],
};

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (
    query: { toSQL: () => { sql: string; params: unknown[] } },
    _tables: string[],
    enabled?: boolean,
  ) => {
    const { sql, params } = query.toSQL();
    const amount = params.find((param) => mockServed.candidatesByAmount.has(param as number));
    let data = mockServed.candidatesByAmount.get(amount as number);

    if (sql.includes('from "holdings"')) {
      data = mockServed.holdings;
    } else if (sql.includes('from "accounts"')) {
      data = mockServed.accounts;
    }

    if (data === undefined) {
      throw new Error(`no served rows for: ${sql} ${JSON.stringify(params)}`);
    }

    return { data: enabled === false ? [] : data, isLoading: false };
  },
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { sweep } from '@kiko/test-support/property-sweep';
import { renderHook } from '@testing-library/react-native';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { exchangeFundingMatches } from '../exchange-funding-match';

import { useExchangeFundingCaption } from './use-exchange-funding-caption';

const FULL_SEEDS = Array.from({ length: 12 }, (_unused, position) => 3 + position * 7);
const SEEDS = sweep(FULL_SEEDS);
const SEED_SPREAD = 1_000_003;
const FIRST_TIME = Date.UTC(2026, 5, 1, 9);
const HOUR_MS = 60 * 60 * 1000;
const WIDE_CHAIN_MS = 5 * DAY_MS;
const TOTALS = [415_000, 260_000, 10_050];
const FIATS = ['UAH', 'EUR'];
const KINDS = ['p2p', 'card', 'bank', 'card', 'bank'];

const HOLDINGS = [
  { id: 'card', accountId: 'bank', name: 'Card', type: 'card', currency: 'UAH' },
  { id: 'card-second', accountId: 'bank', name: 'Second', type: 'card', currency: 'UAH' },
  { id: 'card-eur', accountId: 'bank', name: 'Euro', type: 'card', currency: 'EUR' },
  { id: 'wallet', accountId: 'exchange', name: 'Wallet', type: 'spot', currency: 'USDT' },
];
const DEBIT_HOLDINGS_BY_FIAT: Record<string, string[]> = {
  UAH: ['card', 'card', 'card-second'],
  EUR: ['card-eur'],
};
const GONE_HOLDING = 'gone';

type WorldRow = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  mcc: number | null;
  categorySetByHand: boolean;
  setsBalance: boolean;
  untrackedCounterpart: string | null;
};

type LedgerRow = WorldRow & { currency: string };

const integerBelow = (random: Random, limit: number): number => Math.floor(random() * limit);

const pickOf = <Item>(random: Random, items: readonly Item[]): Item =>
  items[integerBelow(random, items.length)];

const shuffled = <Item>(random: Random, items: readonly Item[]): Item[] => {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = integerBelow(random, index + 1);

    [result[index], result[other]] = [result[other], result[index]];
  }

  return result;
};

const debitHoldingOf = (random: Random, fiat: string): string => {
  const place = random();

  if (place < 0.08) {
    return GONE_HOLDING;
  }

  return place < 0.16 ? 'wallet' : pickOf(random, DEBIT_HOLDINGS_BY_FIAT[fiat]);
};

const debitOf = (
  random: Random,
  id: string,
  fiat: string,
  total: number,
  time: number,
): WorldRow => {
  const transferLike = random() < 0.25;

  return {
    id,
    holdingId: debitHoldingOf(random, fiat),
    amountMinorUnits: -total,
    time,
    description: transferLike && random() < 0.5 ? 'Binance transfer' : 'Shop',
    mcc: transferLike ? pickOf(random, [4829, 6012]) : null,
    categorySetByHand: random() < 0.15,
    setsBalance: random() < 0.12,
    untrackedCounterpart: null,
  };
};

const exchangeOf = (
  random: Random,
  id: string,
  fiat: string,
  total: number,
  time: number,
): WorldRow => ({
  id,
  holdingId: random() < 0.1 ? GONE_HOLDING : 'wallet',
  amountMinorUnits: 1_000 + integerBelow(random, 9_000),
  time,
  description: '',
  mcc: null,
  categorySetByHand: false,
  setsBalance: random() < 0.1,
  untrackedCounterpart: `${pickOf(random, KINDS)}:${fiat}:${(total / 100).toFixed(2)}`,
});

const stepOf = (random: Random): number =>
  Math.round((0.6 + random() * 2.2) * DAY_MS) + integerBelow(random, 6) * HOUR_MS;

// One bucket is a chain: exchange rows and debits of one (fiat, total), each spaced a day or two
// from the last, so a row's candidates overlap its neighbours' and the chain runs past five days.
const bucketRowsOf = (random: Random, fiat: string, total: number, offset: number): WorldRow[] => {
  const exchangeCount = 4 + integerBelow(random, 4);
  const debitCount = Math.max(2, exchangeCount + integerBelow(random, 4) - 1);
  const start = FIRST_TIME + offset * 30 * DAY_MS;
  const rows: WorldRow[] = [];
  let time = start;

  for (let index = 0; index < exchangeCount; index += 1) {
    time += stepOf(random);
    rows.push(exchangeOf(random, `exchange-${fiat}-${total}-${index}`, fiat, total, time));
  }

  time = start + integerBelow(random, 3) * DAY_MS;

  for (let index = 0; index < debitCount; index += 1) {
    time += stepOf(random);
    rows.push(debitOf(random, `debit-${fiat}-${total}-${index}`, fiat, total, time));
  }

  return rows;
};

const noiseRowsOf = (random: Random): WorldRow[] =>
  Array.from({ length: 6 + integerBelow(random, 6) }, (_unused, index) => ({
    id: `noise-${index}`,
    holdingId: pickOf(random, ['card', 'wallet']),
    amountMinorUnits: pickOf(random, [-1_234, 5_500, -77_000, 9_999]),
    time: FIRST_TIME + integerBelow(random, 60) * DAY_MS,
    description: 'Noise',
    mcc: null,
    categorySetByHand: false,
    setsBalance: false,
    untrackedCounterpart: pickOf(random, [null, 'wallet:FUTURES', 'asset:PEPE', 'p2p']),
  }));

const worldOf = (seed: number): WorldRow[] => {
  const random = seededRandom(seed * SEED_SPREAD);
  const buckets = shuffled(
    random,
    TOTALS.flatMap((total) => FIATS.map((fiat) => [fiat, total] as const)),
  ).slice(0, 3 + integerBelow(random, 3));

  return shuffled(random, [
    ...buckets.flatMap(([fiat, total], offset) => bucketRowsOf(random, fiat, total, offset)),
    ...noiseRowsOf(random),
  ]);
};

const insertWorld = (rows: readonly WorldRow[]): void => {
  mockDatabase.exec('PRAGMA foreign_keys = OFF;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES
      ('bank', 'Monobank', 'bank'), ('exchange', 'Binance', 'crypto');
  `);

  const insertHolding = mockDatabase.prepare(
    'INSERT INTO holdings (id, account_id, name, type, currency) VALUES (?, ?, ?, ?, ?)',
  );

  for (const { id, accountId, name, type, currency } of HOLDINGS) {
    insertHolding.run(id, accountId, name, type, currency);
  }

  const insert = mockDatabase.prepare(`
    INSERT INTO transactions
      (id, holding_id, amount_minor_units, time, description, category_set_by_hand, mcc,
       sets_balance, untracked_counterpart, source, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'monobank', ?)
  `);

  for (const row of rows) {
    insert.run(
      row.id,
      row.holdingId,
      row.amountMinorUnits,
      row.time,
      row.description,
      Number(row.categorySetByHand),
      row.mcc,
      Number(row.setsBalance),
      row.untrackedCounterpart,
      row.id,
    );
  }
};

type Matcher = typeof exchangeFundingMatches;

const ACCOUNT_KIND_BY_HOLDING_ID = new Map(
  HOLDINGS.map(({ id, accountId }) => [id, accountId === 'exchange' ? 'crypto' : 'bank'] as const),
) as Parameters<Matcher>[1];
const CURRENCY_BY_HOLDING_ID = new Map(HOLDINGS.map(({ id, currency }) => [id, currency]));
const CAPTION_BY_KIND: Record<string, string> = {
  p2p: 'transactions.matchedP2pPurchase',
  card: 'transactions.matchedCardPurchase',
  bank: 'transactions.matchedExchangeDeposit',
};

// The statistics screen's answer: the matcher over the whole ledger, a row of a gone holding left
// out because it has no currency.
const ledgerOf = (rows: readonly WorldRow[]): LedgerRow[] =>
  rows.flatMap(
    (row) =>
      foldMap(maybe(CURRENCY_BY_HOLDING_ID.get(row.holdingId)), (currency) => [
        { ...row, currency },
      ]) ?? [],
  );

const matchesOf = (ledger: readonly LedgerRow[]) =>
  exchangeFundingMatches(ledger as Parameters<Matcher>[0], ACCOUNT_KIND_BY_HOLDING_ID);

const captionFrom = (ledger: readonly LedgerRow[], id: string): string | undefined => {
  const { matches, excludedIds } = matchesOf(ledger);
  const funding = excludedIds.has(id) ? matches.get(id) : undefined;

  return foldMap(maybe(funding), ({ kind }) => CAPTION_BY_KIND[kind]);
};

const partnersOf = (ledger: readonly LedgerRow[]): Map<string, string> =>
  new Map([...matchesOf(ledger).matches].map(([bankId, { exchangeId }]) => [bankId, exchangeId]));

// A row that moves another debit's partner when it is taken out of the ledger: the greedy pairing
// of the rest flips, so one row's answer depends on a neighbour's.
const flippedPairCount = (ledger: readonly LedgerRow[]): number => {
  const partners = partnersOf(ledger);

  return ledger.filter((removed) => {
    const without = partnersOf(ledger.filter((row) => row.id !== removed.id));

    return [...partners].some(
      ([bankId, exchangeId]) =>
        bankId !== removed.id &&
        exchangeId !== removed.id &&
        without.has(bankId) &&
        without.get(bankId) !== exchangeId,
    );
  }).length;
};

type Shape = {
  fingerprints: Set<string>;
  debits: number;
  captions: number;
  widerThanFiveDays: number;
  flippedPairs: number;
};

// What the worlds are made of, from the whole-ledger matcher alone: no database, no hook.
const shapeOfWorlds = (): Shape => {
  const shape: Shape = {
    fingerprints: new Set(),
    debits: 0,
    captions: 0,
    widerThanFiveDays: 0,
    flippedPairs: 0,
  };

  for (const seed of SEEDS) {
    const world = worldOf(seed);
    const ledger = ledgerOf(world);

    shape.fingerprints.add(JSON.stringify(world.map(({ id, time }) => [id, time])));
    shape.flippedPairs += flippedPairCount(ledger);

    for (const debit of world.filter(({ amountMinorUnits }) => amountMinorUnits < 0)) {
      const expected = captionFrom(ledger, debit.id);
      const nearby = ledger.filter(({ time }) => Math.abs(time - debit.time) <= WIDE_CHAIN_MS);

      shape.debits += 1;
      shape.captions += Number(expected !== undefined);
      shape.widerThanFiveDays += Number(captionFrom(nearby, debit.id) !== expected);
    }
  }

  return shape;
};

const hookCaptionOf = async (row: WorldRow): Promise<string | undefined> => {
  const { id, holdingId, amountMinorUnits } = row;
  const { result } = await renderHook(() =>
    useExchangeFundingCaption({ id, holdingId, amountMinorUnits }),
  );

  return result.current;
};

const seedWorldIntoDatabase = async (world: readonly WorldRow[]): Promise<void> => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  insertWorld(world);
  mockServed.holdings = await holdingsRepo.allQuery();
  mockServed.accounts = await accountsRepo.listQuery();
  mockServed.candidatesByAmount.clear();
};

type Verdicts = { disagreements: string[]; notNarrower: string[] };

// Every debit of every world through the hook, on rows read by the repository from a real database.
const hookVerdicts = async (): Promise<Verdicts> => {
  const verdicts: Verdicts = { disagreements: [], notNarrower: [] };

  for (const seed of SEEDS) {
    const world = worldOf(seed);
    const ledger = ledgerOf(world);
    let widestRead = 0;

    await seedWorldIntoDatabase(world);

    for (const debit of world.filter(({ amountMinorUnits }) => amountMinorUnits < 0)) {
      if (!mockServed.candidatesByAmount.has(debit.amountMinorUnits)) {
        mockServed.candidatesByAmount.set(
          debit.amountMinorUnits,
          await transactionsRepo.fundingMatchCandidatesQuery(debit.amountMinorUnits),
        );
      }

      const expected = captionFrom(ledger, debit.id);
      const actual = await hookCaptionOf(debit);

      widestRead = Math.max(
        widestRead,
        mockServed.candidatesByAmount.get(debit.amountMinorUnits)?.length ?? 0,
      );

      if (actual !== expected) {
        verdicts.disagreements.push(`${seed} ${debit.id}: ${actual} against ${expected}`);
      }
    }

    if (widestRead >= world.length) {
      verdicts.notNarrower.push(`${seed}: read ${widestRead} rows of a ${world.length}-row world`);
    }
  }

  return verdicts;
};

describe('useExchangeFundingCaption parity with the whole-ledger matcher', () => {
  it('gives every debit the caption the whole-ledger matcher gives it, from a read narrower than the ledger', async () => {
    const verdicts = await hookVerdicts();

    expect(verdicts.disagreements).toEqual([]);
    expect(verdicts.notNarrower).toEqual([]);
  });

  it('draws a different world for every seed', () => {
    expect(shapeOfWorlds().fingerprints.size).toBe(SEEDS.length);
  });

  it('draws worlds where the answer is not vacuous: captions, a chain wider than five days, a flipped pair', () => {
    const shape = shapeOfWorlds();

    expect(shape.captions).toBeGreaterThan(0);
    expect(shape.captions).toBeLessThan(shape.debits);
    expect(shape.widerThanFiveDays).toBeGreaterThan(0);
    expect(shape.flippedPairs).toBeGreaterThan(0);
  });
});
