// Row 35 of the design (O93): the old key of one Bybit account reads X 1 and Y 2, a main key of
// another account then comes to the same Kiko account. The key is refused while the account keeps
// its Bybit holdings, so the old account stays as it was; a new crypto account takes the new key
// and reads X 5. Every read and the disconnect run over the REAL repositories on a real
// `node:sqlite` engine (the shipped migrations), through the real client over a fake `fetch`. The
// user ids are made up, and no read of the key shows how a live account answers with its own.
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
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  clearCredentials: async () => undefined,
}));
jest.mock('./bybit.credentials', () => ({
  ...jest.requireActual('./bybit.credentials'),
  clearBybitCredentials: async () => undefined,
}));

import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { signQuery } from '@kiko/crypto-sync/exchange/signing';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  okAnswer,
  routedDeps,
} from './bybit.provider-test-fixtures';
import { bybitProvider } from './bybit.provider';
import { bybitKeyRefusalOf } from './bybit.key-check';
import { API_KEY, SECRET } from './bybit.client-test-fixtures';
import { KEY_INFO_RESULT, keyCheckFetch } from './bybit.key-check-test-fixtures';
import { fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

const OLD_ACCOUNT_ID = 'old-account';
const NEW_ACCOUNT_ID = 'new-account';
const OLD_USER_ID = 424242424242;
const NEW_USER_ID = 737373737373;

// A local calendar day of January 2026 at an hour: the line samples at local midnight.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const TODAY = at(2);

type Coins = readonly (readonly [coin: string, amount: string])[];

const insertAccount = (accountId: string): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
    )
    .run(accountId);
};

// One good sync as the arm runs it: the balance read of the key of `userID`, then the write of the
// state patches that read returned.
const syncAccount = async (
  accountId: string,
  userID: number,
  coins: Coins,
  time: number,
): Promise<void> => {
  const { deps } = routedDeps({
    [KEY_INFO_PATH]: okAnswer({ readOnly: 1, isMaster: true, userID }),
    [UNIFIED_PATH]: okAnswer(
      unifiedResult(coins.map(([coin, amount]) => unifiedCoin(coin, amount))),
    ),
    [FUND_PATH]: okAnswer(fundResult([])),
  });
  const { exchangeState } = await runBalanceSync(
    bybitProvider,
    { ...deps, now: () => time },
    { targetAccountId: accountId, now: () => time },
  );

  await exchangeStateDepsOf('bybit').patchExchangeState(accountId, exchangeState ?? []);
};

// The balance of each currency in whole coins: BTC and ETH both keep 8 decimals.
const MINOR_UNITS_PER_COIN = 100_000_000;

const balancesOf = async (accountId: string): Promise<Record<string, number>> =>
  Object.fromEntries(
    (await holdingsRepo.listByAccountQuery(accountId)).map(({ currency, balanceMinorUnits }) => [
      currency,
      balanceMinorUnits / MINOR_UNITS_PER_COIN,
    ]),
  );

// The Bybit row a history walk wrote for the coins the balance read lists: the account's own
// history, which the walks of this account read and no other account's walk does. The walks
// themselves have their own suites; this seeds the row they would leave.
const insertBybitRow = (accountId: string, currency: string, coins: number, time: number): void => {
  const holding = mockDatabase
    .prepare('SELECT id FROM holdings WHERE account_id = ? AND currency = ?')
    .get(accountId, currency) as { id: string };

  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
       VALUES (?, ?, ?, ?, 'bybit', ?)`,
    )
    .run(
      `${accountId}-${currency}-row`,
      holding.id,
      coins * MINOR_UNITS_PER_COIN,
      time,
      `${currency}:unified:fill-1`,
    );
};

const storedOwnerOf = (accountId: string): unknown => {
  const row = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(accountId) as { exchange_state: string };

  return JSON.parse(row.exchange_state).keyOwner;
};

// The check of a connect with the key of `userID`; `ownerCheck` is set when the account keeps its
// Bybit holdings, as the field sets it.
const connectCheck = (userID: number, ownerCheck?: { accountId: string }) => {
  const { fetchImpl, asked } = keyCheckFetch({
    '/v5/user/query-api': okAnswer({ ...KEY_INFO_RESULT, userID }),
  });

  return {
    asked,
    refusal: bybitKeyRefusalOf(API_KEY, SECRET, { fetchImpl, now: () => TODAY, ownerCheck }),
  };
};

// The line of the account's holdings in BTC at local midnight of each day, as the Statistics
// screen draws it from what the database holds; the last point is the live balance.
const lineOfAccount = async (accountId: string): Promise<number[]> => {
  const holdings = await holdingsRepo.listByAccountQuery(accountId);
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
    historyRows: [],
    baseCurrency: 'BTC',
    range: { from: at(0, 0), to: at(2, 0) },
    liveRateTable: { BTC: 1 },
    today: TODAY,
  });

  return points.map(({ amount }) => amount);
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  insertAccount(OLD_ACCOUNT_ID);
});

// The old key, read once and then disconnected: the account keeps X (BTC) and Y (ETH).
const disconnectedOldAccount = async (): Promise<void> => {
  await syncAccount(
    OLD_ACCOUNT_ID,
    OLD_USER_ID,
    [
      ['BTC', '1'],
      ['ETH', '2'],
    ],
    at(0),
  );
  await disconnectCryptoAccount(OLD_ACCOUNT_ID, 'bybit');
};

describe('a key of another Bybit account, on real SQLite, O93', () => {
  it('the old account keeps X 1 and Y 2, and a new crypto account reads X 5 with line 0, 0, 5', async () => {
    await disconnectedOldAccount();
    const kept = await balancesOf(OLD_ACCOUNT_ID);

    expect(kept).toEqual({ BTC: 1, ETH: 2 });
    expect(storedOwnerOf(OLD_ACCOUNT_ID)).toBe(signQuery(OLD_ACCOUNT_ID, String(OLD_USER_ID)));

    // The old account keeps Bybit holdings, so the key of the other account is refused at its
    // first call, and nothing is stored or read for it.
    const refused = connectCheck(NEW_USER_ID, { accountId: OLD_ACCOUNT_ID });

    await expect(refused.refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyOtherAccount'));
    expect(refused.asked).toHaveLength(1);
    expect(await balancesOf(OLD_ACCOUNT_ID)).toEqual(kept);

    // A new crypto account has no holding, so the same key connects there in 10 calls.
    insertAccount(NEW_ACCOUNT_ID);
    const accepted = connectCheck(NEW_USER_ID);

    await expect(accepted.refusal).resolves.toBeUndefined();
    expect(accepted.asked).toHaveLength(10);

    await syncAccount(NEW_ACCOUNT_ID, NEW_USER_ID, [['BTC', '5']], TODAY);
    insertBybitRow(NEW_ACCOUNT_ID, 'BTC', 5, at(2, 10));

    expect(await balancesOf(NEW_ACCOUNT_ID)).toEqual({ BTC: 5 });
    expect(await lineOfAccount(NEW_ACCOUNT_ID)).toEqual([0, 0, 5]);
    expect(storedOwnerOf(NEW_ACCOUNT_ID)).toBe(signQuery(NEW_ACCOUNT_ID, String(NEW_USER_ID)));
    expect(await balancesOf(OLD_ACCOUNT_ID)).toEqual({ BTC: 1, ETH: 2 });
  });

  it('a delete of the holdings, then a connect on this account, reads X 5 and writes the new owner value at the next good read', async () => {
    await disconnectedOldAccount();
    const oldValue = signQuery(OLD_ACCOUNT_ID, String(OLD_USER_ID));

    mockDatabase
      .prepare(
        'DELETE FROM transactions WHERE holding_id IN (SELECT id FROM holdings WHERE account_id = ?)',
      )
      .run(OLD_ACCOUNT_ID);
    mockDatabase.prepare('DELETE FROM holdings WHERE account_id = ?').run(OLD_ACCOUNT_ID);

    expect(await balancesOf(OLD_ACCOUNT_ID)).toEqual({});
    expect(storedOwnerOf(OLD_ACCOUNT_ID)).toBe(oldValue);

    // No Bybit holding is left, so any key connects here: the field makes no owner check.
    const accepted = connectCheck(NEW_USER_ID);

    await expect(accepted.refusal).resolves.toBeUndefined();
    expect(accepted.asked).toHaveLength(10);

    await syncAccount(OLD_ACCOUNT_ID, NEW_USER_ID, [['BTC', '5']], TODAY);

    expect(await balancesOf(OLD_ACCOUNT_ID)).toEqual({ BTC: 5 });
    expect(storedOwnerOf(OLD_ACCOUNT_ID)).toBe(signQuery(OLD_ACCOUNT_ID, String(NEW_USER_ID)));
    expect(storedOwnerOf(OLD_ACCOUNT_ID)).not.toBe(oldValue);
  });
});
