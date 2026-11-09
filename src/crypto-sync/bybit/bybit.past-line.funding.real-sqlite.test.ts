// The failure the user named, proved by number: the past line of an account whose Funding ledger
// is read. Deposits, withdrawals and transfers go through the real capital and transfer walks, the
// ledger rows through the real ledger walk, and the reconcile lists what no source explains, all
// on a real `node:sqlite` engine (the shipped migrations). The line is the one
// `buildNetWorthSeries` draws from what the database holds, in USDT at one pivot unit. No page with
// a ledger row was read live: each row is built on the field words of the docs page's sample.
// "Truth" is what the account held on each day, which no read of Bybit can show.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DatabaseSync } from 'node:sqlite';
import { dayKeyOf } from '@kiko/prices/price-book';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  okAnswer,
  routedDeps,
} from './bybit.provider-test-fixtures';
import { syncBybitLogHistory } from './bybit.log-history';
import { transferAt } from './bybit.transfer-test-fixtures';
import { API_KEY, SECRET } from './bybit.client-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { quoteLegAt, spotAt } from './bybit.log-test-fixtures';
import type { FundingEarnClause } from './bybit.funding-match';
import { ledgerAt } from './bybit.funding-ledger-test-fixtures';
import { syncBybitFundingLedger } from './bybit.funding-ledger';
import { type BybitDeps, bybitProvider } from './bybit.provider';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { fakeBybit, served } from './bybit.capital-test-fixtures';
import { syncBybitTransferHistory } from './bybit.transfer-history';
import { reconcileBybitFundingLedger } from './bybit.funding-reconcile';
import { depositRow, withdrawalRow } from './bybit.history-test-fixtures';
import { fundCoin, fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

const ACCOUNT_ID = 'acc-1';

// A local calendar day of January 2026 at an hour, built from local fields: the line samples at
// local midnight, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const MOVE_HOUR = 10;

const HOUR_MS = 3_600_000;

const USDT_MINOR_UNITS_PER_COIN = 100_000_000;

// 1 USDT is one pivot unit, so the line reads in USDT. BTC matters only to the worked example.
const PIVOT_PRICE_OF_USDT = '1';
const BITCOIN_PRICE_ON = [60, 60, 60, 60, 70, 80];
const BITCOIN_PRICE_AFTER = 80;
const BITCOIN_PRICE_TODAY = 200;

// A ledger row of a word on no list, as a P2P credit or a stake from Funding reads. The page
// prints no word for either.
const UNSEEN_WORDS = { showBusiType: 'fundingAccountRecordUnseen', description: 'unseen' };

// A stake under the one principal word of `EARN_PRINCIPAL_WORDS`.
const EARN_STAKE_WORDS = {
  showBusiType: 'fundingAccountRecordEarn',
  description: 'fundingAccountRecordFlexSavingSubscribe',
};

type Move = { id: string; day: number; amount: string };

type LedgerEntry = {
  key: string;
  day: number;
  direction: 'I' | 'O';
  amount: string;
  words?: Record<string, string>;
};

type World = {
  /** The day the line ends on: the last sync reads here. */
  today: number;
  /** What the account holds today, which the truth and the line share. */
  fundingToday: string;
  unifiedToday?: { bitcoin?: string; tether?: string };
  deposits?: Move[];
  withdrawals?: (Move & { fee: string })[];
  /** Funding to Unified. */
  transfers?: Move[];
  ledger?: LedgerEntry[];
  /** The trade of the worked example: 1 BTC bought on Unified with 100 USDT. */
  trade?: boolean;
  /** An Earn holding with a balance and no rows: it exists only where a clause reads Earn. */
  earnToday?: string;
  earnClause?: FundingEarnClause;
};

const balanceDeps = (world: World, time: number): BybitDeps => ({
  ...routedDeps({
    [KEY_INFO_PATH]: okAnswer({}),
    [UNIFIED_PATH]: okAnswer(
      unifiedResult([
        unifiedCoin('BTC', world.unifiedToday?.bitcoin ?? '0'),
        unifiedCoin('USDT', world.unifiedToday?.tether ?? '0'),
      ]),
    ),
    [FUND_PATH]: okAnswer(fundResult([fundCoin('USDT', world.fundingToday)])),
  }).deps,
  now: () => time,
});

// Two syncs, each as the arm runs it: the balance read, then every walk and the reconcile. The
// first read makes the holdings, and a row of a holding with no read date never counts, so the
// rows count from the second read.
const syncWorld = async (world: World): Promise<void> => {
  const now = at(world.today);
  const bybit = fakeBybit();
  const timeOf = (day: number): number => at(day, MOVE_HOUR);

  bybit.world.deposit = (world.deposits ?? []).map(({ id, day, amount }) =>
    served(timeOf(day), depositRow({ id, coin: 'USDT', amount, successAt: String(timeOf(day)) })),
  );
  bybit.world.withdraw = (world.withdrawals ?? []).map(({ id, day, amount, fee }) =>
    served(
      timeOf(day),
      withdrawalRow({
        withdrawId: id,
        coin: 'USDT',
        amount,
        withdrawFee: fee,
        createTime: String(timeOf(day)),
        updateTime: String(timeOf(day)),
      }),
    ),
  );
  bybit.world.transfer = (world.transfers ?? []).map(({ id, day, amount }) =>
    transferAt(timeOf(day), {
      transferId: id,
      coin: 'USDT',
      amount,
      fromAccountType: 'FUND',
      toAccountType: 'UNIFIED',
    }),
  );
  bybit.world.log = world.trade
    ? [
        spotAt(timeOf(4), { id: 'buy', orderId: 'order-1', qty: '1', fee: '0', change: '1' }),
        quoteLegAt(timeOf(4), {
          id: 'pay',
          orderId: 'order-1',
          qty: '-100',
          fee: '0',
          change: '-100',
        }),
      ]
    : [];
  bybit.world.fundingLedger = (world.ledger ?? []).map(
    ({ key, day, direction, amount, words = UNSEEN_WORDS }) =>
      ledgerAt(timeOf(day), {
        currcCursor: key,
        ioDirection: direction,
        txnAmt: amount,
        ...words,
      }),
  );

  for (const walkName of ['capital', 'transfer', 'log', 'fundingLedger'] as const) {
    seedWalkMarks(mockDatabase, ACCOUNT_ID, walkName, { cursor: at(0, 0) });
  }

  // The convert list is not under test: its walk has ended a pass and owes nothing.
  seedWalkMarks(mockDatabase, ACCOUNT_ID, 'convert', { cursor: now, pending: [] });

  const readBalances = (time: number) =>
    runBalanceSync(bybitProvider, balanceDeps(world, time), {
      targetAccountId: ACCOUNT_ID,
      now: () => time,
    });

  await readBalances(now);

  const run = createBybitHistoryRun({ now: () => now, sleep: async () => undefined });
  const overrides = {
    now: () => now,
    fetchImpl: bybit.fetchImpl,
    readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
  };

  await syncBybitCapitalHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);
  await syncBybitTransferHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);
  await syncBybitLogHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);
  await syncBybitFundingLedger({ targetAccountId: ACCOUNT_ID, run }, overrides);
  await readBalances(now + HOUR_MS);

  if (world.earnToday !== undefined) {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('earn', ?, 'Earn', 'crypto_asset', 'USDT', ?, '{}')`,
      )
      .run(ACCOUNT_ID, Number(world.earnToday) * USDT_MINOR_UNITS_PER_COIN);
  }

  await reconcileBybitFundingLedger(
    { targetAccountId: ACCOUNT_ID },
    { now: () => now, earnClause: world.earnClause ?? 'notCounted' },
  );
};

type HistoryRows = Parameters<typeof buildNetWorthSeries>[0]['historyRows'];

const priceRowsUpTo = (today: number): HistoryRows =>
  Array.from({ length: today + 1 }, (_, day) => day).flatMap((day) => [
    {
      base: 'BTC',
      quote: 'UAH',
      day: dayKeyOf(at(day)),
      rate: String(BITCOIN_PRICE_ON[day] ?? BITCOIN_PRICE_AFTER),
    },
    { base: 'USDT', quote: 'UAH', day: dayKeyOf(at(day)), rate: PIVOT_PRICE_OF_USDT },
  ]);

// The net-worth line of the whole account in USDT at local midnight of each day, from the first
// day to today, as `buildNetWorthSeries` draws it from the stored holdings and rows.
const lineOfAccount = async (today: number): Promise<number[]> => {
  const holdings = await holdingsRepo.listByAccountQuery(ACCOUNT_ID);
  const rows = mockDatabase
    .prepare(
      `SELECT id, holding_id AS holdingId, time, amount_minor_units AS amountMinorUnits, source
         FROM transactions`,
    )
    .all() as (SeriesTransaction & { holdingId: string })[];
  const { points } = buildNetWorthSeries({
    holdings,
    transactionsByHolding: new Map(
      holdings.map(({ id }) => [id, rows.filter(({ holdingId }) => holdingId === id)]),
    ),
    historyRows: priceRowsUpTo(today),
    baseCurrency: 'USDT',
    range: { from: at(0, 0), to: at(today, 0) },
    liveRateTable: { BTC: BITCOIN_PRICE_TODAY, USDT: Number(PIVOT_PRICE_OF_USDT) },
    today: at(today),
  });

  return points.map(({ amount }) => amount);
};

const lineOf = async (world: World): Promise<number[]> => {
  await syncWorld(world);

  return lineOfAccount(world.today);
};

const heldCountOf = (): unknown => {
  const stored = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(ACCOUNT_ID) as { exchange_state: string } | undefined;

  return JSON.parse(stored?.exchange_state ?? '{}').fundingHeld;
};

const listedKeys = (): string[] =>
  (
    mockDatabase
      .prepare(
        "SELECT external_id FROM transactions WHERE untracked_counterpart = 'ledger:funding'",
      )
      .all() as { external_id: string }[]
  ).map(({ external_id }) => external_id);

const ledgerKey = (name: string): string => `${ACCOUNT_ID}:funding:${name}:USDT`;

const repeated = (value: number, times: number): number[] =>
  Array.from({ length: times }, () => value);

const difference = (line: number[], truth: number[]): number[] =>
  line.map((value, index) => value - (truth[index] ?? 0));

const resetDatabase = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
    )
    .run(ACCOUNT_ID);
};

beforeEach(resetDatabase);

describe('the past line of an account with the Funding ledger on, on real SQLite', () => {
  it('a ledger row past the window and a stake under an unseen word each double by the amount shown', async () => {
    // The deposit's own ledger row comes 8 days after it, one day past the window of 7.
    const lateRow = await lineOf({
      today: 14,
      fundingToday: '100',
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
      ledger: [{ key: 'late', day: 10, direction: 'I', amount: '100' }],
    });
    const truthOfLateRow = [...repeated(0, 2), ...repeated(100, 13)];

    expect(lateRow).toEqual([...repeated(-100, 2), ...repeated(0, 8), ...repeated(100, 5)]);
    expect(difference(lateRow, truthOfLateRow)).toEqual([...repeated(-100, 10), ...repeated(0, 5)]);
    expect(listedKeys()).toEqual([ledgerKey('late')]);

    resetDatabase();

    // The stake of a deposit into a product Kiko reads, under a word on no list.
    const stake = {
      today: 8,
      fundingToday: '0',
      earnToday: '100',
      earnClause: 'read',
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
    } satisfies World;
    const unseenStake = await lineOf({
      ...stake,
      ledger: [{ key: 'stake', day: 5, direction: 'O', amount: '100' }],
    });
    const truthOfStake = [...repeated(0, 2), ...repeated(100, 7)];

    expect(unseenStake).toEqual([...repeated(100, 2), ...repeated(200, 3), ...repeated(100, 4)]);
    expect(difference(unseenStake, truthOfStake)).toEqual([...repeated(100, 5), ...repeated(0, 4)]);
    expect(listedKeys()).toEqual([ledgerKey('stake')]);

    resetDatabase();

    // The same world under the principal word reads as the truth, so the world is the one the
    // double count is measured in.
    expect(
      await lineOf({
        ...stake,
        ledger: [{ key: 'stake', day: 5, direction: 'O', amount: '100', words: EARN_STAKE_WORDS }],
      }),
    ).toEqual(truthOfStake);
    expect(listedKeys()).toEqual([]);
  });

  it('a false match and a held row each read as with no ledger', async () => {
    // The deposit landed on Unified, and a credit of the same amount reaches Funding 3 days later.
    // The deposit explains the credit, so the credit is a lost row.
    const falseMatch = {
      today: 10,
      fundingToday: '100',
      unifiedToday: { tether: '100' },
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
    } satisfies World;
    const withCredit = await lineOf({
      ...falseMatch,
      ledger: [{ key: 'credit', day: 5, direction: 'I', amount: '100' }],
    });

    expect(listedKeys()).toEqual([]);

    resetDatabase();

    const withoutLedger = await lineOf(falseMatch);

    expect(withCredit).toEqual(withoutLedger);
    // The deposit sits on Funding in the line and on Unified in the truth, so the line is 100
    // before the credit where the truth is 0, then 200.
    expect(withCredit).toEqual([...repeated(100, 2), ...repeated(200, 9)]);

    resetDatabase();

    // A credit of 99, which no form of the deposit shows: it is held, counted, and not listed.
    const heldCredit = {
      today: 10,
      fundingToday: '99',
      unifiedToday: { tether: '100' },
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
    } satisfies World;
    const held = await lineOf({
      ...heldCredit,
      ledger: [{ key: 'credit', day: 5, direction: 'I', amount: '99' }],
    });

    expect(listedKeys()).toEqual([]);
    expect(heldCountOf()).toBe(1);

    resetDatabase();

    expect(held).toEqual(await lineOf(heldCredit));
    expect(held).toEqual([...repeated(99, 2), ...repeated(199, 9)]);
  });

  it('the past of the worked example equals the truth with the ledger on, paired or held', async () => {
    // 100 USDT deposited to Funding on day 2, moved to Unified on day 3, and 1 BTC bought with it
    // on day 4. The truth is 0, then 100, then the price of BTC on each day.
    const example = {
      today: 6,
      fundingToday: '0',
      unifiedToday: { bitcoin: '1' },
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
      transfers: [{ id: 'transfer-1', day: 3, amount: '100' }],
      trade: true,
    } satisfies World;
    const truth = [0, 0, 100, 100, 70, 80, BITCOIN_PRICE_TODAY];

    // The deposit and the transfer explain the two rows, so no row lists.
    expect(
      await lineOf({
        ...example,
        ledger: [
          { key: 'in', day: 2, direction: 'I', amount: '100' },
          { key: 'out', day: 3, direction: 'O', amount: '100' },
        ],
      }),
    ).toEqual(truth);
    expect(listedKeys()).toEqual([]);
    expect(heldCountOf()).toBeUndefined();

    resetDatabase();

    // Neither row pairs, because `txnAmt` has some other form: both are held, and the line is the
    // same.
    expect(
      await lineOf({
        ...example,
        ledger: [
          { key: 'in', day: 2, direction: 'I', amount: '99.5' },
          { key: 'out', day: 3, direction: 'O', amount: '99.5' },
        ],
      }),
    ).toEqual(truth);
    expect(listedKeys()).toEqual([]);
    expect(heldCountOf()).toBe(2);
  });

  it("a credit of an unknown word lists and closes its offset, and a late rollback's Out cancels the stale row", async () => {
    // A credit with no source: Funding holds 100 today, so with no row the line starts at 100.
    const credit = { today: 8, fundingToday: '100' } satisfies World;
    const withRow = await lineOf({
      ...credit,
      ledger: [{ key: 'credit', day: 5, direction: 'I', amount: '100' }],
    });

    expect(withRow).toEqual([...repeated(0, 5), ...repeated(100, 4)]);
    expect(listedKeys()).toEqual([ledgerKey('credit')]);

    resetDatabase();

    expect(await lineOf(credit)).toEqual(repeated(100, 9));

    resetDatabase();

    // A deposit that Bybit rolled back after the re-scan: its row stays and pairs with the In, and
    // the Out of the rollback lists alone, so the two rows net to 0.
    const rolledBack = {
      today: 8,
      fundingToday: '0',
      deposits: [{ id: 'deposit-1', day: 2, amount: '100' }],
    } satisfies World;
    const withOut = await lineOf({
      ...rolledBack,
      ledger: [
        { key: 'in', day: 2, direction: 'I', amount: '100' },
        { key: 'out', day: 4, direction: 'O', amount: '100' },
      ],
    });

    expect(withOut).toEqual([...repeated(0, 2), ...repeated(100, 2), ...repeated(0, 5)]);
    expect(listedKeys()).toEqual([ledgerKey('out')]);

    resetDatabase();

    expect(await lineOf(rolledBack)).toEqual([...repeated(-100, 2), ...repeated(0, 7)]);
  });

  it('two equal sources days apart read the truth, a fee form moves by repair, and a credit that takes a source shows its row late with a true opening', async () => {
    // The nearest source of the first row is the second source, so the row first pairs with the
    // wrong one and repair moves it. Both rows are explained and the line is the truth.
    const equalSources = await lineOf({
      today: 12,
      fundingToday: '200',
      deposits: [
        { id: 'deposit-a', day: 1, amount: '100' },
        { id: 'deposit-b', day: 5, amount: '100' },
      ],
      ledger: [
        { key: 'a', day: 5, direction: 'I', amount: '100' },
        { key: 'b', day: 9, direction: 'I', amount: '100' },
      ],
    });

    expect(equalSources).toEqual([0, ...repeated(100, 4), ...repeated(200, 8)]);
    expect(listedKeys()).toEqual([]);

    resetDatabase();

    // The first withdrawal pays a fee of 5, so its row shows 105 and moves to that form when the
    // second row needs the second withdrawal. The line is off by the fee, before the first.
    const feeForm = await lineOf({
      today: 12,
      fundingToday: '0',
      withdrawals: [
        { id: 'withdrawal-a', day: 1, amount: '100', fee: '5' },
        { id: 'withdrawal-b', day: 4, amount: '105', fee: '0' },
      ],
      ledger: [
        { key: 'a', day: 4, direction: 'O', amount: '105' },
        { key: 'b', day: 9, direction: 'O', amount: '105' },
      ],
    });
    const truthOfFeeForm = [210, ...repeated(105, 3), ...repeated(0, 9)];

    expect(feeForm).toEqual([205, ...repeated(105, 3), ...repeated(0, 9)]);
    expect(difference(feeForm, truthOfFeeForm)).toEqual([-5, ...repeated(0, 12)]);
    expect(listedKeys()).toEqual([]);

    resetDatabase();

    // A credit one day after the deposit is nearer than the deposit's own row, so it takes the
    // deposit and the deposit's own row lists. The row shows late, and the sum and the opening are
    // true.
    const takenSource = await lineOf({
      today: 12,
      fundingToday: '200',
      deposits: [{ id: 'deposit-1', day: 1, amount: '100' }],
      ledger: [
        { key: 'credit', day: 2, direction: 'I', amount: '100' },
        { key: 'own', day: 6, direction: 'I', amount: '100' },
      ],
    });
    const truthOfTakenSource = [0, 100, ...repeated(200, 11)];

    expect(takenSource).toEqual([0, ...repeated(100, 5), ...repeated(200, 7)]);
    expect(difference(takenSource, truthOfTakenSource)).toEqual([
      0,
      0,
      ...repeated(-100, 4),
      ...repeated(0, 7),
    ]);
    expect(listedKeys()).toEqual([ledgerKey('own')]);
  });
});
