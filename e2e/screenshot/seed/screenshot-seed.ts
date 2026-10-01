// DEV/TEST-ONLY. Lives under `e2e/`, OUTSIDE `src/` (App Store Guideline 5.6
// remediation, 2026-09-18): the fabricated real-brand demo dataset this module
// builds (Сільпо, Rozetka, Монобанк, ПриватБанк, and other real Ukrainian
// merchant/bank names) must not sit in app source at all. This is now a PURE
// dataset builder — no DB, no repos, no `@env` — whose only consumer is the
// demo-`.kiko` generator under `e2e/screenshot/fixtures/`, reached through
// Jest and never through the app. It still imports `../../../src/*` type
// helpers (schema row types, `Currency`, `AppLanguage`, the palette) because
// the shape it builds mirrors the real app's own types.
import type {
  Metal,
  BondMeta,
  LoanMeta,
  MetalMeta,
  ShareMeta,
  BondPayment,
  PropertyMeta,
  TermDepositMeta,
} from '@kiko/holdings/holding-metadata';
import type { Currency } from '@kiko/currency/currency';
import type { AppLanguage } from '@kiko/i18n/device-language';
import { entityColorsDark } from '@kiko/design-system/palette';
import type { AccountRow, BondRegisterRow, HoldingRow } from '@kiko/db';
import type { ReminderKind, ReminderSchedule } from '@kiko/reminders/schedule';

// ---------------------------------------------------------------------------
// Fixed constants. Every timestamp derives from ANCHOR (a literal Date.UTC, NOT
// Date.now()), so re-running the seed yields a byte-identical dataset and the
// screenshots are stable run to run. ANCHOR is the "now" the demo data is
// anchored to; set the capture device's clock at or just after this day so the
// default 30-day chart window is populated (ops/qa).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * The fixed "now" the whole dataset is anchored to: 2026-09-10 09:00 UTC.
 * Exported so `fixtures/build-demo-snapshot.ts` can stamp every row's
 * `createdAt` from the same fixed instant instead of `Date.now()`.
 */
export const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);

/** UTC midnight of ANCHOR's day — the epoch convention `currency_rate_history.day` uses. */
const ANCHOR_DAY = Date.UTC(2026, 8, 10);

/** A fixed timestamp `daysAgo` days before ANCHOR. */
const at = (daysAgo: number): number => ANCHOR - daysAgo * DAY_MS;

/**
 * 09:00 UTC on a calendar date — the same time of day as ANCHOR, so the
 * instant falls on that date in every timezone from UTC-9 to UTC+14.
 */
const on = (year: number, monthIndex: number, day: number): number =>
  Date.UTC(year, monthIndex, day, 9);

/** A `price_points.day`-style key: UTC midnight standing for a calendar date. */
const dayKey = (year: number, monthIndex: number, day: number): number =>
  Date.UTC(year, monthIndex, day);

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
  // The `key` of the loan holding this payment pays down, linked manually.
  loanHoldingKey?: string;
};

type SeedHoldingMeta = TermDepositMeta | BondMeta | PropertyMeta | MetalMeta | LoanMeta | ShareMeta;

type SeedHolding = {
  // Lets a transaction link or a price point name this holding before the
  // snapshot builder assigns it an id.
  key?: string;
  name: string;
  type: HoldingRow['type'];
  currency: Currency;
  color: string;
  transactions: SeedTransaction[];
  metadata?: SeedHoldingMeta;
};

type SeedInstrument = { kind: 'holding'; holdingKey: string } | { kind: 'metal'; metal: Metal };

type SeedPricePoint = {
  instrument: SeedInstrument;
  day: number;
  price: string;
  currency: Currency;
  source: 'manual' | 'nbu';
};

type SeedReminder = {
  kind: ReminderKind;
  schedule: ReminderSchedule;
};

type SeedAccount = {
  name: string;
  kind: AccountRow['kind'];
  color: string;
  holdings: SeedHolding[];
  reminders?: SeedReminder[];
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

export type ScreenshotDataset = {
  language: AppLanguage;
  baseCurrency: Currency;
  accounts: SeedAccount[];
  rates: SeedRate[];
  history: SeedHistoryRow[];
  pricePoints: SeedPricePoint[];
  bondRegister: BondRegisterRow[];
};

// ---------------------------------------------------------------------------
// Rates. Every currency is priced in UAH major units at ANCHOR; the live rate
// table is every ordered cross pair composed from those anchors (the same shape
// `rates/rates-refresh.ts` produces), so any screen's conversion resolves.
// ---------------------------------------------------------------------------

// The seed only prices the handful of currencies the screenshot dataset holds,
// not the full supported set (Monobank quotes ~100 fiats; seeding a UAH anchor
// for every one would add nothing to the fixtures). A local subset type keeps
// this map exhaustive over exactly what the seed uses, so it never has to grow
// when a new currency is added to `currencyOptions`.
type SeededCurrency = 'UAH' | 'USD' | 'EUR' | 'GBP' | 'CHF' | 'BTC';

/** Value of one major unit of each seeded currency in UAH at ANCHOR. */
const PRICE_IN_UAH: Record<SeededCurrency, number> = {
  UAH: 1,
  USD: 41,
  EUR: 44.5,
  GBP: 52,
  CHF: 46,
  BTC: 2_665_000,
};

const CURRENCIES: SeededCurrency[] = ['UAH', 'USD', 'EUR', 'BTC'];

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

const CAR_LOAN_KEY = 'car-loan';
const PERSONAL_DEBT_KEY = 'personal-debt';
const APARTMENT_KEY = 'apartment';
const CAR_KEY = 'car';
const SHARE_KEY = 'share';

// A fabricated government bond: 1,000.00 nominal, a 16.2% coupon paid twice a
// year (81.00 per bond each time). Its ISIN carries a valid check digit, so a
// reviewer can save the bond after an edit, and sits far above the live NBU
// issue range (UA40002391xx in 2026-09), so it never matches a real bond.
const BOND_ISIN = 'UA4000999015';
const BOND_FACE_VALUE_MINOR_UNITS = 100_000;
const BOND_COUPON_PCT = 16.2;
const BOND_MATURITY = on(2027, 7, 18);

// The register's cash flows for ONE bond: a coupon every half year and the
// face value back at maturity. The holding keeps them too, since the ISIN is
// invented and leaves the cache on the first online register refresh.
const BOND_PAYMENTS: BondPayment[] = [
  { date: on(2026, 7, 19), kind: 'coupon', amount: '81' },
  { date: on(2027, 1, 17), kind: 'coupon', amount: '81' },
  { date: BOND_MATURITY, kind: 'coupon', amount: '81' },
  { date: BOND_MATURITY, kind: 'redemption', amount: '1000' },
];

// The car loan's two latest installments, paid from the main card and linked
// to the loan; its earlier installments predate the card's own history.
const CAR_LOAN_PAYMENTS: SeedTransaction[] = [on(2026, 6, 15), on(2026, 7, 15)].map((time) => ({
  amountMinorUnits: -1_040_000,
  time,
  category: 'other',
  description: 'Погашення автокредиту',
  loanHoldingKey: CAR_LOAN_KEY,
}));

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

  return [...list, ...CAR_LOAN_PAYMENTS];
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
      {
        name: 'Банка «Відпустка»',
        type: 'jar',
        currency: 'UAH',
        color: entityColorsDark.pink,
        transactions: [80, 50, 20].map((daysAgo) => ({
          amountMinorUnits: 200_000,
          time: at(daysAgo),
          category: null,
          description: 'Поповнення банки',
        })),
      },
      {
        name: 'Депозит',
        type: 'term_deposit',
        currency: 'UAH',
        color: entityColorsDark.mint,
        transactions: [],
        metadata: {
          contributions: [{ amountMinorUnits: 5_000_000, date: on(2026, 2, 1) }],
          annualRatePct: 13.5,
          termMonths: 12,
          recapitalization: true,
          compounding: 'monthly',
        },
      },
      {
        name: 'ОВДП',
        type: 'bond',
        currency: 'UAH',
        color: entityColorsDark.green,
        transactions: [],
        metadata: {
          quantity: 30,
          faceValueMinorUnits: BOND_FACE_VALUE_MINOR_UNITS,
          couponPct: BOND_COUPON_PCT,
          purchaseDate: on(2026, 1, 18),
          purchasePriceMinorUnits: 3_060_000,
          maturityDate: BOND_MATURITY,
          bondKind: 'government',
          couponFrequency: 'semiannually',
          isin: BOND_ISIN,
          payments: BOND_PAYMENTS,
        },
      },
    ],
  },
  {
    name: 'Готівка',
    kind: 'cash',
    color: entityColorsDark.green,
    reminders: [
      {
        kind: 'add_transactions',
        schedule: { frequency: 'weekly', minuteOfDay: 20 * 60, weekdays: [0] },
      },
    ],
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
    reminders: [
      {
        kind: 'statement_import',
        schedule: { frequency: 'monthly', minuteOfDay: 10 * 60, dayOfMonth: 1 },
      },
    ],
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
  {
    name: 'Брокер',
    kind: 'broker',
    color: entityColorsDark.violet,
    holdings: [
      {
        name: 'Долари',
        type: 'cash',
        currency: 'USD',
        color: entityColorsDark.violet,
        transactions: [
          {
            amountMinorUnits: 50_000,
            time: at(100),
            category: null,
            description: 'Поповнення брокерського рахунку',
          },
        ],
      },
      // A manual share, so the demo needs no EODHD key and makes no network call.
      {
        key: SHARE_KEY,
        name: 'Apple',
        type: 'share',
        currency: 'USD',
        color: entityColorsDark.teal,
        transactions: [],
        metadata: {
          quoteSource: 'manual',
          isin: 'US0378331005',
          lots: [{ day: dayKey(2026, 1, 2), quantityDelta: '4', costMinorUnits: 92_000 }],
        },
      },
    ],
  },
  {
    name: 'Нерухомість',
    kind: 'property',
    color: entityColorsDark.brown,
    holdings: [
      {
        key: APARTMENT_KEY,
        name: 'Квартира',
        type: 'property_item',
        currency: 'UAH',
        color: entityColorsDark.brown,
        transactions: [],
        metadata: {
          category: 'real_estate',
          lots: [{ day: dayKey(2023, 5, 1), quantityDelta: '1', costMinorUnits: 320_000_000 }],
          ownership: [{ day: dayKey(2023, 5, 1), numerator: 1, denominator: 2 }],
          ownershipInput: 'fraction',
        },
      },
      {
        key: CAR_KEY,
        name: 'Автомобіль',
        type: 'property_item',
        currency: 'UAH',
        color: entityColorsDark.khaki,
        transactions: [],
        metadata: {
          category: 'vehicle',
          lots: [{ day: dayKey(2026, 0, 15), quantityDelta: '1', costMinorUnits: 62_000_000 }],
        },
      },
    ],
  },
  {
    name: 'Метали',
    kind: 'metals',
    color: entityColorsDark.yellow,
    holdings: [
      {
        name: 'Золото',
        type: 'metal',
        currency: 'UAH',
        color: entityColorsDark.yellow,
        transactions: [],
        metadata: {
          metal: 'XAU',
          form: 'bar',
          unit: 'g',
          purity: '0.9999',
          lots: [{ day: dayKey(2025, 10, 20), quantityDelta: '50', costMinorUnits: 21_500_000 }],
        },
      },
    ],
  },
  {
    name: 'Борги',
    kind: 'debt',
    color: entityColorsDark.red,
    holdings: [
      {
        key: CAR_LOAN_KEY,
        name: 'Автокредит',
        type: 'loan',
        currency: 'UAH',
        color: entityColorsDark.red,
        transactions: [],
        metadata: {
          kind: 'car_loan',
          principalMinorUnits: 30_000_000,
          startDate: on(2026, 0, 15),
          annualRatePct: 15,
          termMonths: 36,
          schedule: 'annuity',
        },
      },
      {
        key: PERSONAL_DEBT_KEY,
        name: 'Борг Андрію',
        type: 'loan',
        currency: 'UAH',
        color: entityColorsDark.orange,
        transactions: [],
        metadata: {
          kind: 'personal',
          principalMinorUnits: 2_000_000,
          startDate: on(2026, 4, 1),
          schedule: 'none',
        },
      },
    ],
  },
];

const holdingPoint = (
  holdingKey: string,
  day: number,
  price: string,
  currency: Currency = 'UAH',
): SeedPricePoint => ({
  instrument: { kind: 'holding', holdingKey },
  day,
  price,
  currency,
  source: 'manual',
});

// Monthly NBU gold quotes (UAH per troy ounce), rising from 130,000 to
// 152,000 over the ten months to ANCHOR's month.
const GOLD_QUOTE_MONTHS = 10;

const goldQuotes = (): SeedPricePoint[] =>
  Array.from({ length: GOLD_QUOTE_MONTHS + 1 }, (_, month) => ({
    instrument: { kind: 'metal', metal: 'XAU' },
    day: dayKey(2025, 10 + month, 10),
    price: `${130_000 + month * 2_200}.00`,
    currency: 'UAH',
    source: 'nbu',
  }));

// A property's value series and an informal debt's outstanding are manual
// `holding:<id>` points: each starts at the purchase or the loan day and is
// revised once later.
const buildPricePoints = (): SeedPricePoint[] => [
  holdingPoint(APARTMENT_KEY, dayKey(2023, 5, 1), '3200000.00'),
  holdingPoint(APARTMENT_KEY, dayKey(2026, 2, 1), '3450000.00'),
  holdingPoint(CAR_KEY, dayKey(2026, 0, 15), '620000.00'),
  holdingPoint(CAR_KEY, dayKey(2026, 6, 1), '590000.00'),
  holdingPoint(PERSONAL_DEBT_KEY, dayKey(2026, 4, 1), '20000.00'),
  holdingPoint(PERSONAL_DEBT_KEY, dayKey(2026, 7, 1), '12000.00'),
  holdingPoint(SHARE_KEY, dayKey(2026, 1, 2), '230', 'USD'),
  holdingPoint(SHARE_KEY, dayKey(2026, 7, 3), '248.5', 'USD'),
  ...goldQuotes(),
];

const buildBondRegister = (): BondRegisterRow[] => [
  {
    isin: BOND_ISIN,
    terms: {
      isin: BOND_ISIN,
      currency: 'UAH',
      faceValueMinorUnits: BOND_FACE_VALUE_MINOR_UNITS,
      couponPct: BOND_COUPON_PCT,
      maturityDate: BOND_MATURITY,
      couponFrequency: 'semiannually',
      name: 'ОВДП',
      payments: BOND_PAYMENTS,
    },
    fetchedAt: ANCHOR,
  },
];

/**
 * The complete deterministic screenshot dataset. Pure: it reads no clock, no
 * `@env`, and no database, so its shape (counts, sums, fixed times, pinned
 * rates) is fully unit-testable. Its only consumer is the demo-`.kiko`
 * generator under `e2e/screenshot/fixtures/`, reached through Jest and never
 * through the app.
 */
export const buildScreenshotDataset = (language: AppLanguage): ScreenshotDataset => ({
  language,
  baseCurrency: BASE_CURRENCY,
  accounts: buildAccounts(),
  rates: buildRates(),
  history: buildHistory(),
  pricePoints: buildPricePoints(),
  bondRegister: buildBondRegister(),
});
