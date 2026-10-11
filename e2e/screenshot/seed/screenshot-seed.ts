// DEV/TEST-ONLY. Lives under `e2e/`, OUTSIDE `src/` (App Store Guideline 5.6
// remediation, 2026-09-18): the fabricated real-brand demo dataset this module
// builds (Сільпо, Rozetka, Монобанк, ПриватБанк, and other real Ukrainian
// merchant/bank names) must not sit in app source at all. This is now a PURE
// dataset builder — no DB, no repos, no `@env` — whose only consumer is the
// demo-`.kiko` generator under `e2e/screenshot/fixtures/`, reached through
// Jest and never through the app. It still imports `../../../src/*` type
// helpers (schema row types, `Currency`, `AppLanguage`, the palette) because the
// shape it builds mirrors the real app's own types.
import type {
  Metal,
  BondMeta,
  LoanMeta,
  MetalMeta,
  BondPayment,
  PropertyMeta,
  TermDepositMeta,
} from '@kiko/holdings/holding-metadata';
import type { Currency } from '@kiko/currency/currency';
import type { BankId } from '@kiko/bank-sync/bank-catalog';
import type { AppLanguage } from '@kiko/i18n/device-language';
import { entityColorsDark } from '@kiko/design-system/palette';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import type { AccountRow, BondRegisterRow, HoldingRow } from '@kiko/db';
import type { ReminderKind, ReminderSchedule } from '@kiko/reminders/schedule';

import { demoText, type DemoText } from './demo-text';
import { buildDemoCalendar, type DemoCalendar } from './demo-calendar';

// ---------------------------------------------------------------------------
// Every timestamp derives from the ANCHOR the builder is given (a plain number,
// NOT Date.now()), so building twice with the same anchor yields a byte-identical
// dataset. The committed `.kiko` files are built with the day they were
// regenerated as the anchor, because the app opens on the 30 days before the
// device's date: a dataset anchored far in the past shows an empty Home list and
// empty charts (see `fixtures/README.md`).
// ---------------------------------------------------------------------------

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
  // A realistic merchant/operation label so the ledger reads like a real
  // account instead of the generic "expense/income" fallback. Persisted
  // verbatim (it is demo data, not localized): the Ukrainian file carries
  // Ukrainian labels, the English file English ones.
  description: string;
  // The `key` of the loan holding this payment pays down, linked manually.
  loanHoldingKey?: string;
};

type SeedHoldingMeta = TermDepositMeta | BondMeta | PropertyMeta | MetalMeta | LoanMeta;

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

// A saved transaction form. The snapshot builder swaps every holding `key` in `draft` for that
// holding's id, so the draft is written here against the keyed holdings of this dataset.
type SeedTemplate = {
  name: string;
  draft: TemplateDraft;
};

type SeedAccount = {
  name: string;
  kind: AccountRow['kind'];
  color: string;
  // A bank account only; a bank id the account form's required pick would
  // store. Absent reads as `other`.
  bankId?: BankId;
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
  // The "now" every date in the dataset is measured from.
  anchor: number;
  baseCurrency: Currency;
  accounts: SeedAccount[];
  rates: SeedRate[];
  history: SeedHistoryRow[];
  pricePoints: SeedPricePoint[];
  bondRegister: BondRegisterRow[];
  templates: SeedTemplate[];
};

// ---------------------------------------------------------------------------
// Rates. Every currency is priced in UAH major units at the anchor; the live
// rate table is every ordered cross pair composed from those anchors (the same
// shape `rates/rates-refresh.ts` produces), so any screen's conversion resolves.
// ---------------------------------------------------------------------------

// The seed only prices the handful of currencies the screenshot dataset holds,
// not the full supported set (Monobank quotes ~100 fiats; seeding a UAH anchor
// for every one would add nothing to the fixtures). A local subset type keeps
// this map exhaustive over exactly what the seed uses, so it never has to grow
// when a new currency is added to `currencyOptions`.
type SeededCurrency = 'UAH' | 'USD' | 'EUR' | 'GBP' | 'CHF' | 'BTC';

/** Value of one major unit of each seeded currency in UAH at the anchor. */
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

/** Every ordered distinct pair, priced from the UAH anchors, stamped at the anchor. */
const buildRates = (calendar: DemoCalendar): SeedRate[] => {
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
        fetchedAt: calendar.anchor,
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
const buildHistory = (calendar: DemoCalendar): SeedHistoryRow[] => {
  const rows: SeedHistoryRow[] = [];

  for (const { base, startUah, endUah } of HISTORY_PAIRS) {
    for (let week = 0; week <= HISTORY_WEEKS; week += 1) {
      // week 0 is the newest (the anchor day) at endUah; the oldest is startUah.
      const progress = (HISTORY_WEEKS - week) / HISTORY_WEEKS;
      const value = startUah + (endUah - startUah) * progress;

      rows.push({
        base,
        quote: BASE_CURRENCY,
        day: calendar.dayKeyAt(week * 7),
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
const buildMonthlyExpenses = (text: DemoText): MonthlyExpense[] => [
  {
    category: 'groceries',
    description: text.groceryStore,
    baseMinorUnits: 320_000,
    monthlyDriftMinorUnits: 6_000,
    dayOfMonth: 4,
  },
  {
    category: 'dining',
    description: text.restaurant,
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
    description: text.utilities,
    baseMinorUnits: 210_000,
    monthlyDriftMinorUnits: 4_000,
    dayOfMonth: 13,
  },
  {
    category: 'entertainment',
    description: text.cinema,
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
    description: text.gym,
    baseMinorUnits: 140_000,
    monthlyDriftMinorUnits: 0,
    dayOfMonth: 22,
    everyNthMonth: 2,
  },
  {
    category: 'other',
    description: text.courier,
    baseMinorUnits: 48_000,
    monthlyDriftMinorUnits: 1_000,
    dayOfMonth: 25,
  },
];

// Monthly take-home pay, indexed by month (0 = the most recent month,
// LEDGER_MONTHS-1 = the oldest). Deliberately UNEVEN and, in the three months a
// one-off big-ticket buy lands (see the one-off expenses), SMALLER than that
// month's total spending — so the net-worth line FALLS month-over-month in those
// months instead of climbing in a straight line. Fixed literals derived from
// nothing but the month index, so the dataset stays byte-identical run to run.
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
const buildOneOffExpenses = (text: DemoText): OneOffExpense[] => [
  {
    month: 1,
    category: 'other',
    description: text.apartmentRenovation,
    minorUnits: 1_800_000,
    dayOfMonth: 15,
  },
  {
    month: 2,
    category: 'entertainment',
    description: text.mountainVacation,
    minorUnits: 1_600_000,
    dayOfMonth: 12,
  },
  {
    month: 3,
    category: 'shopping',
    description: text.laptopPurchase,
    minorUnits: 1_400_000,
    dayOfMonth: 9,
  },
];

const CARD_OPENING_MINOR_UNITS = 2_000_000;

const CAR_LOAN_KEY = 'car-loan';
const PERSONAL_DEBT_KEY = 'personal-debt';
const APARTMENT_KEY = 'apartment';
const CAR_KEY = 'car';
const MAIN_CARD_KEY = 'main-card';
const PRIVAT_CARD_KEY = 'privat-card';
const CASH_KEY = 'cash';

// A fabricated government bond: 1,000.00 nominal, a 16.2% coupon paid twice a
// year (81.00 per bond each time). Its ISIN carries a valid check digit, so a
// reviewer can save the bond after an edit, and sits far above the live NBU
// issue range (UA40002391xx in 2026-09), so it never matches a real bond.
const BOND_ISIN = 'UA4000999015';
const BOND_FACE_VALUE_MINOR_UNITS = 100_000;
const BOND_COUPON_PCT = 16.2;

type BondSchedule = { maturity: number; payments: BondPayment[] };

// The register's cash flows for ONE bond: a coupon every half year and the
// face value back at maturity. The holding keeps them too, since the ISIN is
// invented and leaves the cache on the first online register refresh.
const buildBondSchedule = (calendar: DemoCalendar): BondSchedule => {
  const maturity = calendar.ahead(342);

  return {
    maturity,
    payments: [
      { date: calendar.at(22), kind: 'coupon', amount: '81' },
      { date: calendar.ahead(160), kind: 'coupon', amount: '81' },
      { date: maturity, kind: 'coupon', amount: '81' },
      { date: maturity, kind: 'redemption', amount: '1000' },
    ],
  };
};

// The car loan's two latest installments, paid from the main card and linked
// to the loan; its earlier installments predate the card's own history.
const buildCarLoanPayments = (calendar: DemoCalendar, text: DemoText): SeedTransaction[] =>
  [calendar.at(57), calendar.at(26)].map((time) => ({
    amountMinorUnits: -1_040_000,
    time,
    category: 'other',
    description: text.carLoanPayment,
    loanHoldingKey: CAR_LOAN_KEY,
  }));

/** The main UAH card ledger: an opening deposit, then a monthly salary + spends. */
const buildMainCardTransactions = (calendar: DemoCalendar, text: DemoText): SeedTransaction[] => {
  const monthlyExpenses = buildMonthlyExpenses(text);
  const oneOffExpenses = buildOneOffExpenses(text);
  const list: SeedTransaction[] = [
    // The opening deposit predates all monthly activity so the line starts from
    // a positive base and rises. No category: an opening balance is not spending.
    {
      amountMinorUnits: CARD_OPENING_MINOR_UNITS,
      time: calendar.at(LEDGER_MONTHS * MONTH_DAYS + 5),
      category: null,
      description: text.accountTopUp,
    },
  ];

  for (let month = 0; month < LEDGER_MONTHS; month += 1) {
    const monthStart = month * MONTH_DAYS;

    list.push({
      amountMinorUnits: MONTHLY_INCOME_MINOR_UNITS[month],
      time: calendar.at(monthStart + 2),
      category: null,
      description: text.salary,
    });

    for (const expense of monthlyExpenses) {
      if (expense.everyNthMonth !== undefined && month % expense.everyNthMonth !== 0) {
        continue;
      }

      list.push({
        amountMinorUnits: -(expense.baseMinorUnits + month * expense.monthlyDriftMinorUnits),
        time: calendar.at(monthStart + expense.dayOfMonth),
        category: expense.category,
        description: expense.description,
      });
    }

    for (const oneOff of oneOffExpenses) {
      if (oneOff.month !== month) {
        continue;
      }

      list.push({
        amountMinorUnits: -oneOff.minorUnits,
        time: calendar.at(monthStart + oneOff.dayOfMonth),
        category: oneOff.category,
        description: oneOff.description,
      });
    }
  }

  return [...list, ...buildCarLoanPayments(calendar, text)];
};

// ---------------------------------------------------------------------------
// Accounts. All plain manual (no institution) so useAutoSync never runs and the
// pinned rates stay stable. A spread across UAH/USD/EUR/BTC populates the
// currency breakdown and the account-contribution pie.
// ---------------------------------------------------------------------------

const buildAccounts = (calendar: DemoCalendar, text: DemoText): SeedAccount[] => {
  const bond = buildBondSchedule(calendar);

  return [
    {
      name: text.monobank,
      kind: 'bank',
      // The one connectable bank: its page shows Connect, the reviewer's way in.
      bankId: 'monobank',
      color: entityColorsDark.blue,
      holdings: [
        {
          key: MAIN_CARD_KEY,
          name: text.monobank,
          type: 'card',
          currency: 'UAH',
          color: entityColorsDark.blue,
          transactions: buildMainCardTransactions(calendar, text),
        },
        {
          name: text.vacationJar,
          type: 'jar',
          currency: 'UAH',
          color: entityColorsDark.pink,
          transactions: [80, 50, 20].map((daysAgo) => ({
            amountMinorUnits: 200_000,
            time: calendar.at(daysAgo),
            category: null,
            description: text.jarTopUp,
          })),
        },
        {
          name: text.deposit,
          type: 'term_deposit',
          currency: 'UAH',
          color: entityColorsDark.mint,
          transactions: [],
          metadata: {
            contributions: [{ amountMinorUnits: 5_000_000, date: calendar.at(193) }],
            annualRatePct: 13.5,
            termMonths: 12,
            recapitalization: true,
            compounding: 'monthly',
          },
        },
        {
          name: text.governmentBonds,
          type: 'bond',
          currency: 'UAH',
          color: entityColorsDark.green,
          transactions: [],
          metadata: {
            quantity: 30,
            faceValueMinorUnits: BOND_FACE_VALUE_MINOR_UNITS,
            couponPct: BOND_COUPON_PCT,
            purchaseDate: calendar.at(204),
            purchasePriceMinorUnits: 3_060_000,
            maturityDate: bond.maturity,
            bondKind: 'government',
            couponFrequency: 'semiannually',
            isin: BOND_ISIN,
            payments: bond.payments,
          },
        },
      ],
    },
    {
      name: text.cash,
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
          key: CASH_KEY,
          name: text.cash,
          type: 'cash',
          currency: 'UAH',
          color: entityColorsDark.green,
          transactions: [
            {
              amountMinorUnits: 800_000,
              time: calendar.at(170),
              category: null,
              description: text.cashWithdrawal,
            },
            {
              amountMinorUnits: -150_000,
              time: calendar.at(60),
              category: 'cash',
              description: text.market,
            },
            {
              amountMinorUnits: -60_000,
              time: calendar.at(40),
              category: 'groceries',
              description: text.discountSupermarket,
            },
            {
              amountMinorUnits: -40_000,
              time: calendar.at(12),
              category: 'transport',
              description: text.metro,
            },
          ],
        },
      ],
    },
    {
      name: text.privatBank,
      kind: 'bank',
      bankId: 'privatbank',
      color: entityColorsDark.teal,
      reminders: [
        {
          kind: 'statement_import',
          schedule: { frequency: 'monthly', minuteOfDay: 10 * 60, dayOfMonth: 1 },
        },
      ],
      holdings: [
        {
          key: PRIVAT_CARD_KEY,
          name: text.privatBank,
          type: 'card',
          currency: 'USD',
          color: entityColorsDark.teal,
          transactions: [
            {
              amountMinorUnits: 140_000,
              time: calendar.at(150),
              category: null,
              description: text.accountTopUp,
            },
            {
              amountMinorUnits: 8_000,
              time: calendar.at(90),
              category: null,
              description: text.freelanceProject,
            },
            {
              amountMinorUnits: -26_000,
              time: calendar.at(25),
              category: 'shopping',
              description: 'Amazon',
            },
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
              time: calendar.at(120),
              category: null,
              description: text.accountTopUp,
            },
            {
              amountMinorUnits: -20_000,
              time: calendar.at(35),
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
              time: calendar.at(140),
              category: null,
              description: text.bitcoinPurchase,
            },
            {
              amountMinorUnits: 200_000,
              time: calendar.at(130),
              category: null,
              description: text.bitcoinPurchase,
            },
          ],
        },
      ],
    },
    {
      name: text.broker,
      kind: 'broker',
      color: entityColorsDark.violet,
      holdings: [
        {
          name: text.usDollars,
          type: 'cash',
          currency: 'USD',
          color: entityColorsDark.violet,
          transactions: [
            {
              amountMinorUnits: 50_000,
              time: calendar.at(100),
              category: null,
              description: text.brokerageTopUp,
            },
          ],
        },
        // The same domestic government bond as the bank account's, held through
        // the broker, so a broker account shows a bond beside its cash.
        {
          name: text.governmentBonds,
          type: 'bond',
          currency: 'UAH',
          color: entityColorsDark.green,
          transactions: [],
          metadata: {
            quantity: 10,
            faceValueMinorUnits: BOND_FACE_VALUE_MINOR_UNITS,
            couponPct: BOND_COUPON_PCT,
            purchaseDate: calendar.at(153),
            purchasePriceMinorUnits: 1_015_000,
            maturityDate: bond.maturity,
            bondKind: 'government',
            couponFrequency: 'semiannually',
            isin: BOND_ISIN,
            payments: bond.payments,
          },
        },
      ],
    },
    {
      name: text.realEstate,
      kind: 'property',
      color: entityColorsDark.brown,
      holdings: [
        {
          key: APARTMENT_KEY,
          name: text.apartment,
          type: 'property_item',
          currency: 'UAH',
          color: entityColorsDark.brown,
          transactions: [],
          metadata: {
            category: 'real_estate',
            lots: [
              { day: calendar.dayKeyAt(1197), quantityDelta: '1', costMinorUnits: 320_000_000 },
            ],
            ownership: [{ day: calendar.dayKeyAt(1197), numerator: 1, denominator: 2 }],
            ownershipInput: 'fraction',
          },
        },
        {
          key: CAR_KEY,
          name: text.car,
          type: 'property_item',
          currency: 'UAH',
          color: entityColorsDark.khaki,
          transactions: [],
          metadata: {
            category: 'vehicle',
            lots: [{ day: calendar.dayKeyAt(238), quantityDelta: '1', costMinorUnits: 62_000_000 }],
          },
        },
      ],
    },
    {
      name: text.metals,
      kind: 'metals',
      color: entityColorsDark.yellow,
      holdings: [
        {
          name: text.gold,
          type: 'metal',
          currency: 'UAH',
          color: entityColorsDark.yellow,
          transactions: [],
          metadata: {
            metal: 'XAU',
            form: 'bar',
            unit: 'g',
            purity: '0.9999',
            lots: [
              { day: calendar.dayKeyAt(294), quantityDelta: '50', costMinorUnits: 21_500_000 },
            ],
          },
        },
      ],
    },
    {
      name: text.debts,
      kind: 'debt',
      color: entityColorsDark.red,
      holdings: [
        {
          key: CAR_LOAN_KEY,
          name: text.carLoan,
          type: 'loan',
          currency: 'UAH',
          color: entityColorsDark.red,
          transactions: [],
          metadata: {
            kind: 'car_loan',
            principalMinorUnits: 30_000_000,
            startDate: calendar.at(238),
            annualRatePct: 15,
            termMonths: 36,
            schedule: 'annuity',
          },
        },
        {
          key: PERSONAL_DEBT_KEY,
          name: text.owedToAndrii,
          type: 'loan',
          currency: 'UAH',
          color: entityColorsDark.orange,
          transactions: [],
          metadata: {
            kind: 'personal',
            principalMinorUnits: 2_000_000,
            startDate: calendar.at(132),
            schedule: 'none',
          },
        },
      ],
    },
  ];
};

const holdingPoint = (holdingKey: string, day: number, price: string): SeedPricePoint => ({
  instrument: { kind: 'holding', holdingKey },
  day,
  price,
  currency: 'UAH',
  source: 'manual',
});

// Monthly NBU gold quotes (UAH per troy ounce), rising from 130,000 to
// 152,000 over the ten months to the anchor's month.
const GOLD_QUOTE_MONTHS = 10;

const goldQuotes = (calendar: DemoCalendar): SeedPricePoint[] =>
  Array.from({ length: GOLD_QUOTE_MONTHS + 1 }, (_, month) => ({
    instrument: { kind: 'metal', metal: 'XAU' },
    day: calendar.monthKeyAt(GOLD_QUOTE_MONTHS - month),
    price: `${130_000 + month * 2_200}.00`,
    currency: 'UAH',
    source: 'nbu',
  }));

// A property's value series and an informal debt's outstanding are manual
// `holding:<id>` points: each starts at the purchase or the loan day and is
// revised once later.
const buildPricePoints = (calendar: DemoCalendar): SeedPricePoint[] => [
  holdingPoint(APARTMENT_KEY, calendar.dayKeyAt(1197), '3200000.00'),
  holdingPoint(APARTMENT_KEY, calendar.dayKeyAt(193), '3450000.00'),
  holdingPoint(CAR_KEY, calendar.dayKeyAt(238), '620000.00'),
  holdingPoint(CAR_KEY, calendar.dayKeyAt(71), '590000.00'),
  holdingPoint(PERSONAL_DEBT_KEY, calendar.dayKeyAt(132), '20000.00'),
  holdingPoint(PERSONAL_DEBT_KEY, calendar.dayKeyAt(40), '12000.00'),
  ...goldQuotes(calendar),
];

const buildBondRegister = (calendar: DemoCalendar, text: DemoText): BondRegisterRow[] => {
  const bond = buildBondSchedule(calendar);

  return [
    {
      isin: BOND_ISIN,
      terms: {
        isin: BOND_ISIN,
        currency: 'UAH',
        faceValueMinorUnits: BOND_FACE_VALUE_MINOR_UNITS,
        couponPct: BOND_COUPON_PCT,
        maturityDate: bond.maturity,
        couponFrequency: 'semiannually',
        name: text.governmentBonds,
        payments: bond.payments,
      },
      fetchedAt: calendar.anchor,
    },
  ];
};

// One template per form mode, so the reviewer sees each. The salary template leaves its amount
// empty (the amount is optional), the rest fill it. The prices follow the dataset's own rates:
// 4,100.00 UAH buys 100.00 USD at 41.
const buildTemplates = (text: DemoText): SeedTemplate[] => {
  const draft: TemplateDraft = {
    version: 1,
    mode: 'expense',
    holdingId: MAIN_CARD_KEY,
    currency: 'UAH',
    amountMinorUnits: null,
    description: '',
    category: null,
    exchange: null,
    returns: [],
  };

  return [
    {
      name: text.templateSalary,
      draft: { ...draft, mode: 'income', description: text.salary },
    },
    {
      name: text.templateGroceries,
      draft: {
        ...draft,
        amountMinorUnits: 150_000,
        description: text.groceryStore,
        category: 'groceries',
      },
    },
    {
      name: text.templateBuyDollars,
      draft: {
        ...draft,
        mode: 'exchange',
        amountMinorUnits: 410_000,
        exchange: {
          destinationHoldingId: PRIVAT_CARD_KEY,
          destinationCurrency: 'USD',
          valueInMinorUnits: 10_000,
        },
      },
    },
    {
      name: text.templateDinner,
      draft: {
        ...draft,
        mode: 'split',
        amountMinorUnits: 120_000,
        description: text.restaurant,
        category: 'dining',
        returns: [{ holdingId: CASH_KEY, amountMinorUnits: 40_000 }],
      },
    },
  ];
};

/**
 * The complete deterministic screenshot dataset. Pure: it reads no clock, no
 * `@env`, and no database, so its shape (counts, sums, fixed times, pinned
 * rates) is fully unit-testable. `anchor` is the 09:00 UTC instant every date
 * is measured from. Its only consumer is the demo-`.kiko` generator under
 * `e2e/screenshot/fixtures/`, reached through Jest and never through the app.
 */
export const buildScreenshotDataset = (
  language: AppLanguage,
  anchor: number,
): ScreenshotDataset => {
  const calendar = buildDemoCalendar(anchor);
  const text = demoText[language];

  return {
    language,
    anchor,
    baseCurrency: BASE_CURRENCY,
    accounts: buildAccounts(calendar, text),
    rates: buildRates(calendar),
    history: buildHistory(calendar),
    pricePoints: buildPricePoints(calendar),
    bondRegister: buildBondRegister(calendar, text),
    templates: buildTemplates(text),
  };
};
