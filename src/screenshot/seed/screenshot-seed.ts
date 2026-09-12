import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo } from '@kiko/holdings/repo';
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';
import { ratesRepo } from '@kiko/rates/repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { transactionsRepo } from '@kiko/transactions/repo';

import type { Currency } from '../../currency/currency';
import { write } from '../../db/client';
import {
  type AccountRow,
  accounts,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  type HoldingRow,
  holdings,
  syncState,
  transactions,
} from '../../db/schema';
import { entityColorsDark } from '../../design-system/palette';
import type { AppLanguage } from '../../i18n';
import { screenshotLanguage } from '../screenshot-mode';

// ---------------------------------------------------------------------------
// Fixed constants. Every timestamp derives from ANCHOR (a literal Date.UTC, NOT
// Date.now()), so re-running the seed yields a byte-identical dataset and the
// screenshots are stable run to run. ANCHOR is the "now" the demo data is
// anchored to; set the capture device's clock at or just after this day so the
// default 30-day chart window is populated (ops/qa).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The fixed "now" the whole dataset is anchored to: 2026-09-10 09:00 UTC. */
const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);

/** UTC midnight of ANCHOR's day — the epoch convention `currency_rate_history.day` uses. */
const ANCHOR_DAY = Date.UTC(2026, 8, 10);

/** A fixed timestamp `daysAgo` days before ANCHOR. */
const at = (daysAgo: number): number => ANCHOR - daysAgo * DAY_MS;

const BASE_CURRENCY: Currency = 'UAH';

// The number of whole months of monthly ledger activity on the main card. Six
// months of dated salary + category spending fills the net-worth line, the
// category pie, and the per-category trend chart.
const LEDGER_MONTHS = 6;
const MONTH_DAYS = 30;

// ---------------------------------------------------------------------------
// Dataset shape (pure data — no DB). Kept separate from the writer so the whole
// dataset can be unit-tested for determinism without a live database, which the
// Jest harness has no op-sqlite backend for.
// ---------------------------------------------------------------------------

type SeedTransaction = {
  amountMinorUnits: number;
  time: number;
  category: string | null;
  // A realistic Ukrainian merchant/operation label so the ledger reads like a
  // real account instead of the generic "expense/income" fallback. Persisted
  // verbatim (it is demo data, not localized), so a UK or EN screenshot set
  // both show the same institution names.
  description: string;
};

type SeedHolding = {
  name: string;
  type: HoldingRow['type'];
  currency: Currency;
  color: string;
  transactions: SeedTransaction[];
};

type SeedAccount = {
  name: string;
  kind: AccountRow['kind'];
  color: string;
  holdings: SeedHolding[];
};

type SeedRate = {
  base: Currency;
  quote: Currency;
  rate: string;
  source: 'monobank' | 'coingecko';
  fetchedAt: number;
};

type SeedHistoryRow = {
  base: Currency;
  quote: Currency;
  day: number;
  rate: string;
  source: 'monobank' | 'coingecko' | 'nbu';
};

type ScreenshotDataset = {
  language: AppLanguage;
  baseCurrency: Currency;
  accounts: SeedAccount[];
  rates: SeedRate[];
  history: SeedHistoryRow[];
};

// ---------------------------------------------------------------------------
// Rates. Every currency is priced in UAH major units at ANCHOR; the live rate
// table is every ordered cross pair composed from those anchors (the same shape
// `rates/rates-refresh.ts` produces), so any screen's conversion resolves.
// ---------------------------------------------------------------------------

/** Value of one major unit of each currency in UAH at ANCHOR. */
const PRICE_IN_UAH: Record<Currency, number> = {
  UAH: 1,
  USD: 41,
  EUR: 44.5,
  BTC: 2_665_000,
};

const CURRENCIES: Currency[] = ['UAH', 'USD', 'EUR', 'BTC'];

const rateSource = (base: Currency, quote: Currency): 'monobank' | 'coingecko' =>
  base === 'BTC' || quote === 'BTC' ? 'coingecko' : 'monobank';

/** Every ordered distinct pair, priced from the UAH anchors, stamped at ANCHOR. */
const buildRates = (): SeedRate[] => {
  const rates: SeedRate[] = [];

  for (const base of CURRENCIES) {
    for (const quote of CURRENCIES) {
      if (base === quote) {
        continue;
      }

      rates.push({
        base,
        quote,
        rate: String(PRICE_IN_UAH[base] / PRICE_IN_UAH[quote]),
        source: rateSource(base, quote),
        fetchedAt: ANCHOR,
      });
    }
  }

  return rates;
};

// The net-worth line chart reads currency_rate_history and draws nothing when it
// is empty, so history is seeded for each foreign holding's currency against the
// UAH base. Rates trend gently upward over ~26 weeks so the line has attractive
// movement; a UAH holding needs no rate (base == base).
const HISTORY_WEEKS = 26;

type HistoryPair = { base: Currency; startUah: number; endUah: number };

const HISTORY_PAIRS: HistoryPair[] = [
  { base: 'USD', startUah: 40.0, endUah: PRICE_IN_UAH.USD },
  { base: 'EUR', startUah: 43.0, endUah: PRICE_IN_UAH.EUR },
  { base: 'BTC', startUah: 2_000_000, endUah: PRICE_IN_UAH.BTC },
];

/** Weekly history points per foreign:UAH pair, linearly trending start -> end. */
const buildHistory = (): SeedHistoryRow[] => {
  const rows: SeedHistoryRow[] = [];

  for (const { base, startUah, endUah } of HISTORY_PAIRS) {
    for (let week = 0; week <= HISTORY_WEEKS; week += 1) {
      // week 0 is the newest (ANCHOR day) at endUah; the oldest is startUah.
      const progress = (HISTORY_WEEKS - week) / HISTORY_WEEKS;
      const value = startUah + (endUah - startUah) * progress;

      rows.push({
        base,
        quote: BASE_CURRENCY,
        day: ANCHOR_DAY - week * 7 * DAY_MS,
        rate: String(value),
        source: rateSource(base, BASE_CURRENCY),
      });
    }
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Ledger. A monthly rhythm on the main UAH card (salary + recurring category
// spending) over LEDGER_MONTHS, so the category pie and per-category trend both
// render full. Amounts are minor units; a small per-month drift keeps the trend
// lines from being perfectly flat.
// ---------------------------------------------------------------------------

type MonthlyExpense = {
  category: string;
  // The recurring merchant/operation the monthly spend reads as. One per
  // category so each ledger row names a real Ukrainian merchant matched to its
  // category (the category chart stays accurate — only the label changed).
  description: string;
  baseMinorUnits: number;
  monthlyDriftMinorUnits: number;
  dayOfMonth: number;
  everyNthMonth?: number;
};

// An irregular big-ticket spend that lands in only ONE of the ledger months.
type OneOffExpense = {
  // Which month it lands in (0 = the most recent month, LEDGER_MONTHS-1 = oldest).
  month: number;
  category: string;
  description: string;
  minorUnits: number;
  dayOfMonth: number;
};

// Categories reference the 10 seeded slugs (src/db/__fixtures__/seeded-categories.ts).
const MONTHLY_EXPENSES: MonthlyExpense[] = [
  {
    category: 'groceries',
    description: 'Сільпо',
    baseMinorUnits: 320_000,
    monthlyDriftMinorUnits: 6_000,
    dayOfMonth: 4,
  },
  {
    category: 'dining',
    description: 'Пузата Хата',
    baseMinorUnits: 150_000,
    monthlyDriftMinorUnits: 5_000,
    dayOfMonth: 7,
  },
  {
    category: 'transport',
    description: 'Uklon',
    baseMinorUnits: 62_000,
    monthlyDriftMinorUnits: 2_000,
    dayOfMonth: 10,
  },
  {
    category: 'utilities',
    description: 'Комунальні послуги',
    baseMinorUnits: 210_000,
    monthlyDriftMinorUnits: 4_000,
    dayOfMonth: 13,
  },
  {
    category: 'entertainment',
    description: 'Планета Кіно',
    baseMinorUnits: 90_000,
    monthlyDriftMinorUnits: 3_000,
    dayOfMonth: 16,
  },
  {
    category: 'shopping',
    description: 'Rozetka',
    baseMinorUnits: 240_000,
    monthlyDriftMinorUnits: 8_000,
    dayOfMonth: 19,
  },
  {
    category: 'health',
    description: 'Спортзал «Sport Life»',
    baseMinorUnits: 140_000,
    monthlyDriftMinorUnits: 0,
    dayOfMonth: 22,
    everyNthMonth: 2,
  },
  {
    category: 'other',
    description: 'Нова Пошта',
    baseMinorUnits: 48_000,
    monthlyDriftMinorUnits: 1_000,
    dayOfMonth: 25,
  },
];

// Monthly take-home pay, indexed by month (0 = the most recent month,
// LEDGER_MONTHS-1 = the oldest). Deliberately UNEVEN and, in the three months a
// one-off big-ticket buy lands (see ONE_OFF_EXPENSES), SMALLER than that month's
// total spending — so the net-worth line FALLS month-over-month in those months
// instead of climbing in a straight line. Fixed literals derived from nothing
// but the month index, so the dataset stays byte-identical run to run.
const MONTHLY_INCOME_MINOR_UNITS = [
  2_500_000, // month 0 (newest): ₴25,000
  2_300_000, // month 1:          ₴23,000
  2_600_000, // month 2:          ₴26,000
  2_100_000, // month 3:          ₴21,000
  2_400_000, // month 4:          ₴24,000
  2_200_000, // month 5 (oldest): ₴22,000
];

// Irregular big-ticket spends, one per listed month. Each is large enough that,
// stacked on that month's recurring spending, it OUTWEIGHS the month's income —
// these are the deliberate down/red segments on the net-worth line. Categorized
// against the real seeded slugs so the pie/trend stay accurate.
const ONE_OFF_EXPENSES: OneOffExpense[] = [
  {
    month: 1,
    category: 'other',
    description: 'Ремонт квартири',
    minorUnits: 1_800_000,
    dayOfMonth: 15,
  },
  {
    month: 2,
    category: 'entertainment',
    description: 'Відпустка (Буковель)',
    minorUnits: 1_600_000,
    dayOfMonth: 12,
  },
  {
    month: 3,
    category: 'shopping',
    description: 'Купівля ноутбука',
    minorUnits: 1_400_000,
    dayOfMonth: 9,
  },
];

const CARD_OPENING_MINOR_UNITS = 2_000_000;

/** The main UAH card ledger: an opening deposit, then a monthly salary + spends. */
const buildMainCardTransactions = (): SeedTransaction[] => {
  const list: SeedTransaction[] = [
    // The opening deposit predates all monthly activity so the line starts from
    // a positive base and rises. No category: an opening balance is not spending.
    {
      amountMinorUnits: CARD_OPENING_MINOR_UNITS,
      time: at(LEDGER_MONTHS * MONTH_DAYS + 5),
      category: null,
      description: 'Поповнення рахунку',
    },
  ];

  for (let month = 0; month < LEDGER_MONTHS; month += 1) {
    const monthStart = month * MONTH_DAYS;

    list.push({
      amountMinorUnits: MONTHLY_INCOME_MINOR_UNITS[month],
      time: at(monthStart + 2),
      category: null,
      description: 'Зарплата',
    });

    for (const expense of MONTHLY_EXPENSES) {
      if (expense.everyNthMonth !== undefined && month % expense.everyNthMonth !== 0) {
        continue;
      }

      list.push({
        amountMinorUnits: -(expense.baseMinorUnits + month * expense.monthlyDriftMinorUnits),
        time: at(monthStart + expense.dayOfMonth),
        category: expense.category,
        description: expense.description,
      });
    }

    for (const oneOff of ONE_OFF_EXPENSES) {
      if (oneOff.month !== month) {
        continue;
      }

      list.push({
        amountMinorUnits: -oneOff.minorUnits,
        time: at(monthStart + oneOff.dayOfMonth),
        category: oneOff.category,
        description: oneOff.description,
      });
    }
  }

  return list;
};

// ---------------------------------------------------------------------------
// Accounts. All plain manual (no institution) so useAutoSync never runs and the
// pinned rates stay stable. A spread across UAH/USD/EUR/BTC populates the
// currency breakdown and the account-contribution pie.
// ---------------------------------------------------------------------------

const buildAccounts = (): SeedAccount[] => [
  {
    name: 'Монобанк',
    kind: 'bank',
    color: entityColorsDark.blue,
    holdings: [
      {
        name: 'Монобанк',
        type: 'card',
        currency: 'UAH',
        color: entityColorsDark.blue,
        transactions: buildMainCardTransactions(),
      },
    ],
  },
  {
    name: 'Готівка',
    kind: 'cash',
    color: entityColorsDark.green,
    holdings: [
      {
        name: 'Готівка',
        type: 'cash',
        currency: 'UAH',
        color: entityColorsDark.green,
        transactions: [
          {
            amountMinorUnits: 800_000,
            time: at(170),
            category: null,
            description: 'Зняття готівки в банкоматі',
          },
          { amountMinorUnits: -150_000, time: at(60), category: 'cash', description: 'Ринок' },
          { amountMinorUnits: -60_000, time: at(40), category: 'groceries', description: 'АТБ' },
          {
            amountMinorUnits: -40_000,
            time: at(12),
            category: 'transport',
            description: 'Київський метрополітен',
          },
        ],
      },
    ],
  },
  {
    name: 'ПриватБанк',
    kind: 'bank',
    color: entityColorsDark.teal,
    holdings: [
      {
        name: 'ПриватБанк',
        type: 'card',
        currency: 'USD',
        color: entityColorsDark.teal,
        transactions: [
          {
            amountMinorUnits: 140_000,
            time: at(150),
            category: null,
            description: 'Поповнення рахунку',
          },
          {
            amountMinorUnits: 8_000,
            time: at(90),
            category: null,
            description: 'Фріланс-проєкт',
          },
          { amountMinorUnits: -26_000, time: at(25), category: 'shopping', description: 'Amazon' },
        ],
      },
    ],
  },
  {
    name: 'Wise',
    kind: 'bank',
    color: entityColorsDark.indigo,
    holdings: [
      {
        name: 'Wise',
        type: 'card',
        currency: 'EUR',
        color: entityColorsDark.indigo,
        transactions: [
          {
            amountMinorUnits: 80_000,
            time: at(120),
            category: null,
            description: 'Поповнення рахунку',
          },
          {
            amountMinorUnits: -20_000,
            time: at(35),
            category: 'shopping',
            description: 'Booking.com',
          },
        ],
      },
    ],
  },
  {
    name: 'Binance',
    kind: 'crypto',
    color: entityColorsDark.orange,
    holdings: [
      {
        name: 'Binance',
        type: 'crypto_asset',
        currency: 'BTC',
        color: entityColorsDark.orange,
        transactions: [
          {
            amountMinorUnits: 1_000_000,
            time: at(140),
            category: null,
            description: 'Купівля BTC',
          },
          {
            amountMinorUnits: 200_000,
            time: at(130),
            category: null,
            description: 'Купівля BTC',
          },
        ],
      },
    ],
  },
];

/**
 * The complete deterministic screenshot dataset. Pure: it reads no clock and no
 * database, so its shape (counts, sums, fixed times, pinned rates) is fully
 * unit-testable. `seedScreenshotData` is the thin writer that persists it.
 */
export const buildScreenshotDataset = (language: AppLanguage): ScreenshotDataset => ({
  language,
  baseCurrency: BASE_CURRENCY,
  accounts: buildAccounts(),
  rates: buildRates(),
  history: buildHistory(),
});

// ---------------------------------------------------------------------------
// Writer. Uses the existing repos + the sanctioned write() path only.
// ---------------------------------------------------------------------------

/**
 * Delete every row the seed owns, in foreign-key order (children before
 * parents), inside ONE sanctioned write transaction — so re-running the seed
 * yields identical state. The 10 default categories (migration 0002) and the
 * single settings row are KEPT; everything else is rebuilt.
 */
const purge = (): Promise<void> =>
  write(async (tx) => {
    await tx.delete(transactions);
    await tx.delete(syncState);
    await tx.delete(holdings);
    await tx.delete(accounts);
    await tx.delete(currencyRates);
    await tx.delete(currencyRateHistory);
    await tx.delete(categoryOverrides);
  });

const applySettings = async (dataset: ScreenshotDataset): Promise<void> => {
  await settingsRepo.setBaseCurrency(dataset.baseCurrency);
  await settingsRepo.setLanguage(dataset.language);
  // Defensive: a fresh seeded DB is already lock-off (the column defaults
  // false), but a re-seed over a DB where the user enabled the lock must not
  // leave a Face ID gate in front of the screenshots.
  await settingsRepo.setLockEnabled(false);
};

const seedHolding = async (accountId: string, holding: SeedHolding): Promise<void> => {
  const holdingId = await holdingsRepo.create({
    accountId,
    name: holding.name,
    type: holding.type,
    currency: holding.currency,
    color: holding.color,
  });

  for (const transaction of holding.transactions) {
    // recordManual adjusts the holding balance by the amount, so the holding's
    // final balance is the sum of its seeded transactions (the holding was
    // created with a zero opening balance, emitting no clock-stamped opening
    // row of its own). Each row persists a realistic merchant/operation
    // description so the ledger reads like a real account rather than the
    // generic "expense/income" fallback used when the description is blank.
    await transactionsRepo.recordManual({
      holdingId,
      amountMinorUnits: transaction.amountMinorUnits,
      time: transaction.time,
      category: transaction.category ?? undefined,
      description: transaction.description,
    });
  }
};

const seedAccounts = async (dataset: ScreenshotDataset): Promise<void> => {
  for (const account of dataset.accounts) {
    const accountId = await accountsRepo.create({
      name: account.name,
      kind: account.kind,
      color: account.color,
    });

    for (const holding of account.holdings) {
      await seedHolding(accountId, holding);
    }
  }
};

/**
 * DEV/TEST-ONLY. Rebuild a deterministic, attractive demo dataset for App Store
 * marketing screenshots, idempotently. Called from `MigrationsGate` ONLY when
 * `isScreenshotMode()` is true (a dead branch in production). Order: purge, then
 * settings, then accounts + holdings + ledger, then the pinned live rates and
 * the rate history the charts need.
 */
export const seedScreenshotData = async (): Promise<void> => {
  const dataset = buildScreenshotDataset(screenshotLanguage());

  await purge();
  await applySettings(dataset);
  await seedAccounts(dataset);
  await ratesRepo.upsertMany(dataset.rates);
  await rateHistoryRepo.upsertMany(dataset.history);
};
