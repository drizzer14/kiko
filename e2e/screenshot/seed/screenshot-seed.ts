// DEV/TEST-ONLY. Lives under `e2e/`, OUTSIDE `src/` (App Store Guideline 2.3.1(a) remediation,
// 2026-09-18): the fabricated real-brand demo dataset this module
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
import type { BankId } from '@kiko/bank-sync/bank-catalog';
import type { AppLanguage } from '@kiko/i18n/device-language';
import { entityColorsDark } from '@kiko/design-system/palette';
import { isCrypto, type Currency } from '@kiko/currency/currency';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import type { ReminderKind, ReminderSchedule } from '@kiko/reminders/schedule';
import type { AccountRow, BondRegisterRow, HoldingRow, TransactionRow } from '@kiko/db';

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
  // One row of an exchange: the pair `key` every row of that exchange shares, and the `key` of the
  // holding the row names as its counterpart (the other leg's; a fee row's is the received leg's).
  // The snapshot builder swaps both for stored ids.
  pair?: { key: string; counterpartHoldingKey: string };
  // The stored code of a counterpart Kiko does not track (`p2p:`, `card:`, `bank:` ...).
  untrackedCounterpart?: string;
  // The label an exchange operation row shows at render time, in place of a description.
  operation?: NonNullable<TransactionRow['operation']>;
  comment?: string;
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
type SeededCurrency = 'UAH' | 'EUR' | 'BTC' | 'USDT';

/** Value of one major unit of each seeded currency in UAH at the anchor. */
const PRICE_IN_UAH: Record<SeededCurrency, number> = {
  UAH: 1,
  EUR: 44.5,
  BTC: 2_665_000,
  USDT: 41,
};

const CURRENCIES: SeededCurrency[] = ['UAH', 'EUR', 'BTC', 'USDT'];

const BINANCE_BTC_KEY = 'binance-btc';
const BINANCE_USDT_KEY = 'binance-usdt';
const BINANCE_UAH_KEY = 'binance-uah';
const BINANCE_EUR_KEY = 'binance-eur';

type ExchangeOperationFields = Pick<
  SeedTransaction,
  'pair' | 'untrackedCounterpart' | 'operation' | 'comment'
>;

// What the Binance account holds: BTC under the account's own name, USDT, and a UAH and a EUR
// balance, since an exchange wallet keeps fiat as a `crypto_asset` holding in a fiat currency.
// The exchange operation rows (a convert, a trade with its fee, a trade with a coin not held, a
// USDT dust sweep into BTC, a P2P, card purchase, card sale and bank rows) are all dated 33 days
// or more before the anchor, outside the default 30-day window, so Home and the 30-day charts show
// none of these rows. Each holding's deposits are cut by what its operation rows add, so each
// holding ends at its pinned balance.
// The coin names are brand names and stay Latin in both languages; the two fiat names are text.
const buildExchangeHoldings = (calendar: DemoCalendar, text: DemoText): SeedHolding[] => {
  const exchangeHolding = (
    fields: Pick<SeedHolding, 'key' | 'name' | 'currency' | 'transactions'>,
  ): SeedHolding => ({ ...fields, type: 'crypto_asset', color: entityColorsDark.orange });
  // Money paid into the exchange is a transfer between the user's own places, not spending.
  const deposit = (
    currency: SeededCurrency,
    amountMinorUnits: number,
    daysAgo: number,
  ): SeedTransaction => ({
    amountMinorUnits,
    time: calendar.at(daysAgo),
    category: 'transfers',
    description: isCrypto(currency) ? text.cryptoPurchase : text.accountTopUp,
  });
  const bitcoinPurchase = (amountMinorUnits: number, daysAgo: number): SeedTransaction => ({
    amountMinorUnits,
    time: calendar.at(daysAgo),
    category: 'transfers',
    description: text.bitcoinPurchase,
  });
  // An operation row stores no description: its label renders from the operation and the code.
  const operationRow = (
    daysAgo: number,
    amountMinorUnits: number,
    fields: ExchangeOperationFields,
  ): SeedTransaction => ({
    amountMinorUnits,
    time: calendar.at(daysAgo),
    category: null,
    description: '',
    ...fields,
  });

  return [
    exchangeHolding({
      key: BINANCE_BTC_KEY,
      name: 'Binance',
      currency: 'BTC',
      transactions: [
        bitcoinPurchase(789_000, 140),
        bitcoinPurchase(200_000, 130),
        operationRow(45, 110_000, {
          pair: { key: 'trade', counterpartHoldingKey: BINANCE_USDT_KEY },
          operation: 'trade',
        }),
        operationRow(40, 1_000, {
          pair: { key: 'dust', counterpartHoldingKey: BINANCE_USDT_KEY },
          operation: 'dust',
        }),
        operationRow(35, 100_000, {
          untrackedCounterpart: 'card:UAH:2600.00',
          operation: 'card',
          comment: '2600 UAH',
        }),
      ],
    }),
    exchangeHolding({
      key: BINANCE_USDT_KEY,
      name: 'USDT',
      currency: 'USDT',
      transactions: [
        deposit('USDT', 3_455_000_000, 120),
        operationRow(38, -3_170_000_000, {
          untrackedCounterpart: 'card:UAH:1300.00',
          operation: 'card',
          comment: '1300 UAH',
        }),
        operationRow(110, 9_990_000_000, {
          untrackedCounterpart: 'p2p:UAH:4150.00',
          operation: 'p2p',
          comment: '4150 UAH',
        }),
        operationRow(50, 2_400_000_000, {
          pair: { key: 'convert', counterpartHoldingKey: BINANCE_UAH_KEY },
          operation: 'convert',
        }),
        operationRow(45, -7_390_000_000, {
          pair: { key: 'trade', counterpartHoldingKey: BINANCE_BTC_KEY },
          operation: 'trade',
        }),
        operationRow(45, -5_000_000, {
          pair: { key: 'trade', counterpartHoldingKey: BINANCE_BTC_KEY },
          operation: 'trade-fee',
        }),
        // PEPE is a coin the demo does not hold: one tracked leg and an asset code.
        operationRow(42, -200_000_000, { untrackedCounterpart: 'asset:PEPE', operation: 'trade' }),
        operationRow(40, -80_000_000, {
          pair: { key: 'dust', counterpartHoldingKey: BINANCE_BTC_KEY },
          operation: 'dust',
        }),
      ],
    }),
    exchangeHolding({
      key: BINANCE_UAH_KEY,
      name: text.hryvnia,
      currency: 'UAH',
      transactions: [
        deposit('UAH', 200_000, 70),
        operationRow(50, -100_000, {
          pair: { key: 'convert', counterpartHoldingKey: BINANCE_USDT_KEY },
          operation: 'convert',
        }),
      ],
    }),
    exchangeHolding({
      key: BINANCE_EUR_KEY,
      name: text.euro,
      currency: 'EUR',
      transactions: [
        operationRow(60, 10_000, {
          untrackedCounterpart: 'bank:EUR:100.00',
          operation: 'fiat',
          comment: '100 EUR',
        }),
        operationRow(33, -5_000, {
          untrackedCounterpart: 'bank:EUR:50.00',
          operation: 'fiat',
          comment: '50 EUR',
        }),
      ],
    }),
  ];
};

const rateSource = (base: Currency, quote: Currency): 'monobank' | 'coingecko' =>
  isCrypto(base) || isCrypto(quote) ? 'coingecko' : 'monobank';

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
  { base: 'EUR', startUah: 43.0, endUah: PRICE_IN_UAH.EUR },
  { base: 'BTC', startUah: 2_000_000, endUah: PRICE_IN_UAH.BTC },
  { base: 'USDT', startUah: 40.0, endUah: PRICE_IN_UAH.USDT },
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
  // The recurring merchant the monthly spend reads as. Several per category, each a real
  // Ukrainian merchant matched to its category, so the ledger reads like a real card.
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
// A Latin brand name stays a literal in both languages; the others come from the demo text. Each
// category's merchants split that category's monthly spend between them.
const buildMonthlyExpenses = (text: DemoText): MonthlyExpense[] => {
  // category, merchant, base, monthly drift, day of the month, and for a health row, the months
  // between two charges.
  const rows: [string, string, number, number, number, number?][] = [
    ['groceries', text.groceryStore, 160_000, 3_000, 4],
    ['groceries', text.discountSupermarket, 90_000, 2_000, 11],
    ['groceries', text.fora, 40_000, 1_000, 19],
    ['groceries', 'Novus', 30_000, 0, 26],
    ['dining', text.restaurant, 70_000, 2_000, 7],
    ['dining', text.lvivCroissants, 35_000, 1_000, 13],
    ['dining', 'Aroma Kava', 25_000, 1_000, 21],
    ['dining', 'Salateira', 20_000, 1_000, 27],
    ['transport', 'Uklon', 20_000, 1_000, 5],
    ['transport', 'Bolt', 12_000, 0, 16],
    ['transport', text.metro, 2_000, 0, 9],
    ['transport', text.okko, 28_000, 1_000, 23],
    ['utilities', text.kyivteploenergo, 95_000, 2_000, 13],
    ['utilities', 'YASNO', 65_000, 1_000, 14],
    ['utilities', text.kyivvodokanal, 25_000, 1_000, 15],
    ['utilities', text.kyivstar, 25_000, 0, 17],
    ['entertainment', text.cinema, 45_000, 2_000, 16],
    ['entertainment', 'Netflix', 30_000, 1_000, 24],
    ['entertainment', 'Multiplex', 15_000, 0, 10],
    ['shopping', 'Rozetka', 130_000, 5_000, 19],
    ['shopping', text.epicentr, 70_000, 2_000, 22],
    ['shopping', text.avrora, 40_000, 1_000, 8],
    ['health', text.gym, 90_000, 0, 22, 2],
    ['health', text.podorozhnyk, 30_000, 0, 12, 2],
    ['health', text.apteka911, 20_000, 0, 18, 2],
    ['other', text.courier, 30_000, 1_000, 25],
    ['other', text.ukrposhta, 18_000, 0, 28],
  ];

  return rows.map(
    ([
      category,
      description,
      baseMinorUnits,
      monthlyDriftMinorUnits,
      dayOfMonth,
      everyNthMonth,
    ]): MonthlyExpense => ({
      category,
      description,
      baseMinorUnits,
      monthlyDriftMinorUnits,
      dayOfMonth,
      everyNthMonth,
    }),
  );
};

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

// The bank debits that fund the Binance P2P and card rows (`p2p:UAH:4150.00`, `card:UAH:2600.00`)
// and the Wise one that funds its fiat deposit (`bank:EUR:100.00`): the totals equal the exchange
// rows' codes, so each debit pairs with its row and the matched-funding caption is reachable in
// the demo (Guideline 2.5.19).
const P2P_FUNDING_MINOR_UNITS = 415_000;
const CARD_FUNDING_MINOR_UNITS = 260_000;
const FIAT_DEPOSIT_FUNDING_MINOR_UNITS = 10_000;

// Raised by the two UAH funding debits, so the card keeps its end balance.
const CARD_OPENING_MINOR_UNITS = 2_000_000 + P2P_FUNDING_MINOR_UNITS + CARD_FUNDING_MINOR_UNITS;
// Raised by the fiat funding debit and by the three card purchases below, so Wise keeps its end
// balance.
const WISE_PURCHASES_MINOR_UNITS = 4_500 + 3_900 + 2_200;
const WISE_OPENING_MINOR_UNITS =
  80_000 + FIAT_DEPOSIT_FUNDING_MINOR_UNITS + WISE_PURCHASES_MINOR_UNITS;

const CAR_LOAN_KEY = 'car-loan';
const PERSONAL_DEBT_KEY = 'personal-debt';
const APARTMENT_KEY = 'apartment';
const CAR_KEY = 'car';
const MAIN_CARD_KEY = 'main-card';
const PRIVAT_CARD_KEY = 'privat-card';
const CASH_KEY = 'cash';
const BROKER_EURO_KEY = 'broker-euro';

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

// Six rows left in the default category, which no stored rule claims, so a rule typed live in
// the app has something to move: "Name starts with" KFC, "Amount" less than 800, "Type" Expense
// takes the three KFC orders under 800. Each of the other three fails one condition (an income,
// another name, an amount of 800 or more) and stays, which shows that every condition must match.
// The merchants are ones the reviewer's fake Monobank statement never names, so importing that
// statement does not add rows the live rule would move.
const buildFoodDeliveryTransactions = (calendar: DemoCalendar, text: DemoText): SeedTransaction[] =>
  [
    { amountMinorUnits: -48_000, daysAgo: 7, description: 'KFC' },
    { amountMinorUnits: 35_000, daysAgo: 10, description: text.kfcRefund },
    { amountMinorUnits: -62_000, daysAgo: 14, description: 'KFC' },
    { amountMinorUnits: -39_500, daysAgo: 18, description: 'KFC' },
    { amountMinorUnits: -52_000, daysAgo: 12, description: 'Sushi Master' },
    { amountMinorUnits: -145_000, daysAgo: 24, description: 'KFC' },
  ].map(({ amountMinorUnits, daysAgo, description }) => ({
    amountMinorUnits,
    time: calendar.at(daysAgo),
    category: 'other',
    description,
  }));

// A debit stays in the default category: a matched debit leaves spending, so it is no spend to
// categorize. The P2P transfer is dated with its USDT row (day 110) and the card payment posts
// two days after its row (day 35), both inside the matcher's window; both are older than the
// 30-day window, so Home and the 30-day charts show neither.
const buildExchangeFundingDebits = (calendar: DemoCalendar): SeedTransaction[] => [
  {
    amountMinorUnits: -P2P_FUNDING_MINOR_UNITS,
    time: calendar.at(110),
    category: 'other',
    description: 'Binance P2P',
  },
  {
    amountMinorUnits: -CARD_FUNDING_MINOR_UNITS,
    time: calendar.at(33),
    category: 'other',
    description: 'Binance',
  },
];

/** The main UAH card ledger: an opening deposit, then a monthly salary + spends. */
const buildMainCardTransactions = (calendar: DemoCalendar, text: DemoText): SeedTransaction[] => {
  const monthlyExpenses = buildMonthlyExpenses(text);
  const oneOffExpenses = buildOneOffExpenses(text);
  const list: SeedTransaction[] = [
    // The opening deposit predates all monthly activity so the line starts from
    // a positive base and rises. A transfer: an opening balance is not spending.
    {
      amountMinorUnits: CARD_OPENING_MINOR_UNITS,
      time: calendar.at(LEDGER_MONTHS * MONTH_DAYS + 5),
      category: 'transfers',
      description: text.accountTopUp,
    },
  ];

  for (let month = 0; month < LEDGER_MONTHS; month += 1) {
    const monthStart = month * MONTH_DAYS;

    // Day 6, not nearer the anchor: Home lists newest first and shows a row with no category as
    // "Other", so the newest rows must be categorized spending, not the salary.
    list.push({
      amountMinorUnits: MONTHLY_INCOME_MINOR_UNITS[month],
      time: calendar.at(monthStart + 6),
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

  return [
    ...list,
    ...buildCarLoanPayments(calendar, text),
    ...buildFoodDeliveryTransactions(calendar, text),
    ...buildExchangeFundingDebits(calendar),
  ];
};

// ---------------------------------------------------------------------------
// Accounts. All plain manual (no institution) so useAutoSync never runs and the
// pinned rates stay stable. A spread across UAH/EUR/BTC/USDT populates the
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
            category: 'transfers',
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
              amountMinorUnits: 835_000,
              time: calendar.at(170),
              category: 'cash',
              description: text.cashWithdrawal,
            },
            {
              amountMinorUnits: -35_000,
              time: calendar.at(6),
              category: 'groceries',
              description: text.market,
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
          currency: 'EUR',
          color: entityColorsDark.teal,
          transactions: [
            {
              amountMinorUnits: 140_000,
              time: calendar.at(150),
              category: 'transfers',
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
              amountMinorUnits: WISE_OPENING_MINOR_UNITS,
              time: calendar.at(120),
              category: 'transfers',
              description: text.accountTopUp,
            },
            {
              amountMinorUnits: -4_500,
              time: calendar.at(9),
              category: 'groceries',
              description: 'Lidl',
            },
            {
              amountMinorUnits: -3_900,
              time: calendar.at(15),
              category: 'transport',
              description: 'FlixBus',
            },
            {
              amountMinorUnits: -2_200,
              time: calendar.at(20),
              category: 'shopping',
              description: 'Rossmann',
            },
            // Two days before the EUR row it funds (`bank:EUR:100.00`, day 60), inside the
            // matcher's five-day window for a fiat deposit; older than the 30-day window.
            {
              amountMinorUnits: -FIAT_DEPOSIT_FUNDING_MINOR_UNITS,
              time: calendar.at(62),
              category: 'other',
              description: 'Binance',
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
      holdings: buildExchangeHoldings(calendar, text),
    },
    {
      name: text.broker,
      kind: 'broker',
      color: entityColorsDark.violet,
      holdings: [
        {
          key: BROKER_EURO_KEY,
          name: text.euro,
          type: 'cash',
          currency: 'EUR',
          color: entityColorsDark.violet,
          transactions: [
            {
              amountMinorUnits: 50_000,
              time: calendar.at(100),
              category: 'transfers',
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
// 4,450.00 UAH buys 100.00 EUR at 44.5.
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
      name: text.templateBuyEuros,
      draft: {
        ...draft,
        mode: 'exchange',
        holdingId: CASH_KEY,
        amountMinorUnits: 445_000,
        exchange: {
          destinationHoldingId: BROKER_EURO_KEY,
          destinationCurrency: 'EUR',
          valueInMinorUnits: 10_000,
        },
      },
    },
    {
      name: text.templateDinner,
      draft: {
        ...draft,
        mode: 'split',
        holdingId: CASH_KEY,
        amountMinorUnits: 120_000,
        description: text.restaurant,
        category: 'dining',
        returns: [{ holdingId: MAIN_CARD_KEY, amountMinorUnits: 40_000 }],
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
