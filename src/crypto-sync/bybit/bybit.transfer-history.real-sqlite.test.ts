// The unit tests in `bybit.transfer-history.test.ts` fake the repositories. This file runs the
// transfer walk over the REAL repositories on a real `node:sqlite` engine (the shipped migrations),
// beside a real `runBalanceSync`: the case is a coin the balance read sets aside for an open order,
// where a transfer is the first thing that gives its Unified wallet a holding. No page with a row
// was read live: the transfer is built from the docs page's sample.
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

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import type { HoldingRow } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  okAnswer,
  routedDeps,
} from './bybit.provider-test-fixtures';
import { bybitProvider } from './bybit.provider';
import { fakeBybit } from './bybit.capital-test-fixtures';
import { transferAt } from './bybit.transfer-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { syncBybitTransferHistory } from './bybit.transfer-history';
import { fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const AT = NOW - 2 * DAY_MS;
const HALF_OF_A_COIN = 50_000_000;
const EIGHT_TENTHS_OF_A_COIN = 80_000_000;

// The fill took part of the coin and a tenth of the rest is held for an open order, so the coin is
// set aside: its balance is never written.
const SET_ASIDE = [unifiedCoin('BTC', '0.8', { locked: '0.1' })];
const GOOD_READ = [unifiedCoin('BTC', '0.8')];

const readBalance = async (coins: typeof SET_ASIDE): Promise<void> => {
  const { deps } = routedDeps({
    [KEY_INFO_PATH]: okAnswer({}),
    [UNIFIED_PATH]: okAnswer(unifiedResult(coins)),
    [FUND_PATH]: okAnswer(fundResult([])),
  });
  const { exchangeState } = await runBalanceSync(bybitProvider, deps, {
    targetAccountId: ACCOUNT_ID,
    now: () => NOW,
  });

  // Written by the arm, after the read, as the arm does.
  if (exchangeState !== undefined) {
    await exchangeStateDepsOf('bybit').patchExchangeState(ACCOUNT_ID, exchangeState);
  }
};

const walkOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitTransferHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      fetchImpl: bybit.fetchImpl,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
    },
  );

const holdingKeyed = async (key: string): Promise<HoldingRow | undefined> =>
  (await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).find(
    (holding) => (holding.metadata as { bybitAsset?: string } | null)?.bybitAsset === key,
  );

const openOrderCoins = (): string[] => {
  const row = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(ACCOUNT_ID) as { exchange_state: string };
  const state = JSON.parse(row.exchange_state) as {
    balanceNotes?: { unified?: { openOrder?: string[] } };
  };

  return state.balanceNotes?.unified?.openOrder ?? [];
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES (?, 'Bybit', 'crypto')")
    .run(ACCOUNT_ID);
});

describe('the transfer walk on real SQLite', () => {
  it('a Unified leg of a set-aside coin creates its holding at zero, the next read leaves it at zero with the line, and the first good read writes it', async () => {
    await readBalance(SET_ASIDE);
    seedWalkMarks(mockDatabase, ACCOUNT_ID, 'transfer', { cursor: NOW - 3 * DAY_MS });

    expect(await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).toEqual([]);
    expect(openOrderCoins()).toEqual(['BTC']);

    const bybit = fakeBybit();
    bybit.world.transfer = [transferAt(AT)];
    const result = await walkOver(bybit);

    expect(result.imported).toBe(2);
    expect((await holdingKeyed('BTC:unified'))?.balanceMinorUnits).toBe(0);
    expect((await holdingKeyed('BTC:fund'))?.balanceMinorUnits).toBe(0);
    expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'transfer').cursor).toBe(NOW);

    await readBalance(SET_ASIDE);

    expect((await holdingKeyed('BTC:unified'))?.balanceMinorUnits).toBe(0);
    expect(openOrderCoins()).toEqual(['BTC']);

    await readBalance(GOOD_READ);

    expect((await holdingKeyed('BTC:unified'))?.balanceMinorUnits).toBe(EIGHT_TENTHS_OF_A_COIN);
    expect(openOrderCoins()).toEqual([]);
  });

  it('writes the legs on the holdings the walk created, and moves no balance with them', async () => {
    await readBalance(SET_ASIDE);
    seedWalkMarks(mockDatabase, ACCOUNT_ID, 'transfer', { cursor: NOW - 3 * DAY_MS });
    const bybit = fakeBybit();
    bybit.world.transfer = [transferAt(AT)];

    await walkOver(bybit);

    const rows = mockDatabase
      .prepare(
        `SELECT external_id, holding_id, amount_minor_units, exchange_pair_id,
                exchange_counterpart_holding_id
           FROM transactions ORDER BY amount_minor_units`,
      )
      .all() as {
      external_id: string;
      holding_id: string;
      amount_minor_units: number;
      exchange_pair_id: string;
      exchange_counterpart_holding_id: string;
    }[];
    const fund = await holdingKeyed('BTC:fund');
    const unified = await holdingKeyed('BTC:unified');

    expect(
      rows.map((row) => [
        row.external_id,
        row.holding_id,
        row.amount_minor_units,
        row.exchange_pair_id,
        row.exchange_counterpart_holding_id,
      ]),
    ).toEqual([
      [
        'acc-1:xfer:transfer-1:BTC:BTC:fund',
        fund?.id,
        -HALF_OF_A_COIN,
        'acc-1:xfer:transfer-1:BTC',
        unified?.id,
      ],
      [
        'acc-1:xfer:transfer-1:BTC:BTC:unified',
        unified?.id,
        HALF_OF_A_COIN,
        'acc-1:xfer:transfer-1:BTC',
        fund?.id,
      ],
    ]);
    expect(fund?.balanceMinorUnits).toBe(0);
    expect(unified?.balanceMinorUnits).toBe(0);
  });
});
