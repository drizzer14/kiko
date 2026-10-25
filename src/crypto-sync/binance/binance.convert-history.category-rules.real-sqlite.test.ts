// A name rule judged against Binance exchange legs the way the user hit it: the Convert and
// Transfer walks write the legs through the production mappers onto a real `node:sqlite` engine,
// the legs store no description and show "Exchange from X" only through their markers, and the
// rule is counted and applied through the real repo. The legs are rewritten by the label they
// show, in the language the app runs in, and the spending totals do not move.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import {
  type BreakdownTransaction,
  buildCategoryBreakdown,
} from '@kiko/statistics/category-breakdown';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import type {
  BinanceUniversalTransfer,
  TotalPage,
  UniversalTransferType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { syncBinanceTransferHistory } from './binance.transfer-history';
import { convertRecordOf, convertServerOf } from './binance.convert-test-fixtures';

const ACCOUNT_ID = 'acc-1';
const HOUR_MS = 3_600_000;
const RULE_CATEGORY = 'crypto';
const CHANGED_INCOMING_AMOUNT = 2_420_000_000;

type StoredLeg = { holding: string; amount: number; category: string | null };

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');
  rawDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', 'binance')",
    )
    .run();
  seedWalkMarks(rawDatabase, ACCOUNT_ID, 'convert', { cursor: NOW - HOUR_MS });
  seedWalkMarks(rawDatabase, ACCOUNT_ID, 'transfer', { cursor: NOW - 5 * DAY_MS });

  return rawDatabase;
};

const requestOf = () => ({
  targetAccountId: ACCOUNT_ID,
  run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
});

const CREDENTIALS = {
  now: () => NOW,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
};

const SMALL_CONVERT = convertRecordOf({
  recordId: 'quote-2',
  fromAmount: '500',
  toAmount: '12',
});

const walkConversions = (toAmount = '24.1') =>
  syncBinanceConvertHistory(requestOf(), {
    ...CREDENTIALS,
    fetchConvertHistory: convertServerOf([convertRecordOf({ toAmount }), SMALL_CONVERT]),
  });

const TRANSFER: BinanceUniversalTransfer = {
  asset: 'BTC',
  amount: '0.5',
  type: 'MAIN_FUNDING',
  status: 'CONFIRMED',
  tranId: 'transfer-1',
  timestamp: NOW - 2 * DAY_MS,
};

const fetchTransfers = async (
  _apiKey: string,
  _secret: string,
  query: { type: UniversalTransferType },
): Promise<TotalPage<BinanceUniversalTransfer>> => {
  const rows = TRANSFER.type === query.type ? [TRANSFER] : [];

  return {
    rows,
    unreadable: [],
    untracked: [],
    gathered: rows.length,
    total: rows.length,
    usedUidWeight1m: undefined,
    usedIpWeight1m: undefined,
  };
};

const walkTransfer = () =>
  syncBinanceTransferHistory(requestOf(), {
    ...CREDENTIALS,
    fetchUniversalTransfers: fetchTransfers,
  });

const legs = (): StoredLeg[] =>
  mockDatabase
    .prepare(
      `SELECT holdings.name AS holding, amount_minor_units AS amount, category
         FROM transactions JOIN holdings ON holdings.id = transactions.holding_id
         ORDER BY external_id`,
    )
    .all() as StoredLeg[];

const categoryOfLegs = (isLeg: (leg: StoredLeg) => boolean): (string | null)[] =>
  legs()
    .filter(isLeg)
    .map((leg) => leg.category);

const isIncomingConvertLeg = (leg: StoredLeg): boolean =>
  leg.holding.endsWith('USDT') && leg.amount > 0;

const isOutgoingConvertLeg = (leg: StoredLeg): boolean => leg.holding.endsWith('UAH');

const isTransferLeg = (leg: StoredLeg): boolean => leg.holding.endsWith('BTC');

const startingWith = (text: string) => ({
  id: null,
  category: RULE_CATEGORY,
  matchers: [{ type: 'nameStartsWith' as const, text }],
});

beforeEach(async () => {
  mockDatabase = openDatabase();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await walkConversions();
  await walkTransfer();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('a name rule over Binance exchange legs, in Ukrainian', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('uk');
  });

  it('counts the incoming conversion legs a rule on "Обмін з" matches', async () => {
    expect(await categoryRulesRepo.countRuleRewrite(startingWith('Обмін з'))).toBe(2);
  });

  it('gives the incoming legs the category, and leaves the outgoing legs and the transfer alone', async () => {
    const saved = await categoryRulesRepo.saveRule({
      ...startingWith('Обмін з'),
      applyToExisting: true,
    });

    expect(saved.changed).toBe(2);
    expect(categoryOfLegs(isIncomingConvertLeg)).toEqual([RULE_CATEGORY, RULE_CATEGORY]);
    expect(categoryOfLegs(isOutgoingConvertLeg)).toEqual([null, null]);
    expect(categoryOfLegs(isTransferLeg)).toEqual([null, null]);
  });

  it('names the outgoing legs by "Обмін на" and the holding they went to', async () => {
    const saved = await categoryRulesRepo.saveRule({
      ...startingWith('Обмін на Binance Funding · USDT'),
      applyToExisting: true,
    });

    expect(saved.changed).toBe(2);
    expect(categoryOfLegs(isOutgoingConvertLeg)).toEqual([RULE_CATEGORY, RULE_CATEGORY]);
    expect(categoryOfLegs(isIncomingConvertLeg)).toEqual([null, null]);
  });

  it('reads the leg between two wallets of one coin as a transfer, not an exchange', async () => {
    expect(await categoryRulesRepo.countRuleRewrite(startingWith('Переказ з'))).toBe(1);

    await categoryRulesRepo.saveRule({ ...startingWith('Переказ з'), applyToExisting: true });

    expect(categoryOfLegs(isTransferLeg).sort()).toEqual([RULE_CATEGORY, null]);
    expect(categoryOfLegs(isIncomingConvertLeg)).toEqual([null, null]);
  });
});

describe('a name rule over Binance exchange legs, in English', () => {
  it('counts and gives the incoming legs the category of a rule on "Exchange from"', async () => {
    const draft = startingWith('Exchange from');

    const counted = await categoryRulesRepo.countRuleRewrite(draft);
    const saved = await categoryRulesRepo.saveRule({ ...draft, applyToExisting: true });

    expect([counted, saved.changed]).toEqual([2, 2]);
    expect(categoryOfLegs(isIncomingConvertLeg)).toEqual([RULE_CATEGORY, RULE_CATEGORY]);
    expect(categoryOfLegs(isOutgoingConvertLeg)).toEqual([null, null]);
    expect(categoryOfLegs(isTransferLeg)).toEqual([null, null]);
  });
});

describe('a leg a rule reached, at a re-sync', () => {
  beforeEach(async () => {
    await categoryRulesRepo.saveRule({ ...startingWith('Exchange from'), applyToExisting: true });
  });

  it('keeps the rule category when the same legs are read again', async () => {
    await walkConversions();

    expect(categoryOfLegs(isIncomingConvertLeg)).toEqual([RULE_CATEGORY, RULE_CATEGORY]);
  });

  it('gives a leg whose amount changed the category of the rule that wins it', async () => {
    mockDatabase
      .prepare("UPDATE transactions SET category = 'shops' WHERE amount_minor_units > 0")
      .run();

    await walkConversions('24.2');

    const changedLeg = (leg: StoredLeg): boolean =>
      isIncomingConvertLeg(leg) && leg.amount === CHANGED_INCOMING_AMOUNT;

    expect(categoryOfLegs(changedLeg)).toEqual([RULE_CATEGORY]);
  });
});

describe('the spending totals when a rule reaches exchange legs', () => {
  const DISPLAY = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart' },
    { key: RULE_CATEGORY, title: 'Crypto', icon: 'bitcoinsign' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);

  const spendingTotals = () => {
    const transactions = mockDatabase
      .prepare(
        `SELECT transactions.id, category, amount_minor_units AS amountMinorUnits, mcc,
                counter_iban AS counterIban, description,
                exchange_counterpart_holding_id AS exchangeCounterpartHoldingId,
                untracked_counterpart AS untrackedCounterpart,
                change_group_id AS changeGroupId, holdings.currency AS currency
           FROM transactions JOIN holdings ON holdings.id = transactions.holding_id`,
      )
      .all() as BreakdownTransaction[];

    return buildCategoryBreakdown({
      transactions,
      categoryDisplay: DISPLAY,
      rateTable: { USDT: 41.5, BTC: 4_000_000 },
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      excludedTransactionIds: exchangeExcludedTransactionIds(transactions),
    });
  };

  it('are the same before and after a rule gives the legs a category', async () => {
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency)
         VALUES ('card', 'acc-1', 'Card', 'card', 'UAH')`,
      )
      .run();
    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
           source)
         VALUES ('silpo', 'card', -5000, 1000, 'Silpo', 'groceries', 'manual')`,
      )
      .run();
    const before = spendingTotals();

    const saved = await categoryRulesRepo.saveRule({
      ...startingWith('Exchange'),
      applyToExisting: true,
    });

    expect(saved.changed).toBe(4);
    expect(categoryOfLegs(isOutgoingConvertLeg)).toEqual([RULE_CATEGORY, RULE_CATEGORY]);
    expect(before.map((slice) => slice.key)).toEqual(['groceries']);
    expect(spendingTotals()).toEqual(before);
  });
});
