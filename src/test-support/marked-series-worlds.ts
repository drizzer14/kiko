import type { RowRecurrence } from '@kiko/recurring/row-recurrence';

import {
  at,
  weekly,
  monthly,
  ledgerOf,
  chargeOf,
  holdingOf,
  bankAccountOf,
  CRYPTO_EXTRAS,
  fundingPurchasesOf,
  type Ledger,
  type LedgerRow,
  type ExpectedSeries,
  type RecurrenceView,
} from './recurring-ledger';
import { seededRandom } from './seeded-random';
import type { MarkSpec, ExpectedChain, ExpectedShown } from './marked-series-world';

export type MarkedWorld = {
  title: string;
  ledger: () => Ledger;
  // The name the stored entry carries; Netflix when absent.
  name?: string;
  marks: MarkSpec[];
  // The detected series of the same rows with no entry.
  noEntry: ExpectedSeries[];
  shown: ExpectedShown[];
  withoutCharges?: ExpectedChain[];
  // Rows the marked series leaves out of a period that already holds a charge of it: what the
  // form reads on them, and what the marked series has paid in major units.
  dropped?: {
    rowIds: string[];
    reads: Exclude<RowRecurrence, { kind: 'marked' }>;
    paidSoFar: number;
  };
};

type ExclusionWorld = MarkedWorld & { rowId: string; isExcluded: boolean };

type Day = readonly [year: number, month: number, day: number];
type DayAmount = readonly [year: number, month: number, day: number, amount: number];
type ChargeShape = NonNullable<Parameters<typeof chargeOf>[3]>;
type ExclusionBuild = (excluded: boolean) => { ledger: Ledger; name: string; rowId?: string };

const SEED_SPREAD = 104_729;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const FUNDING_DELAY_MS = 10 * MINUTE_MS;
const BEYOND_FUNDING_WINDOW_MS = 5 * HOUR_MS;
const OWN_IBAN = 'UA213223130000026007233566001';
const THIRD_PARTY_IBAN = 'UA903052992990004149123456789';
const CASH_OUT_MCC = 6011;
const TRANSFER_MCC = 4829;
const GROCERY_MCC = 5411;
const ARCHIVED_AT = 1_700_000_000_000;
const EXCLUSION_AMOUNT = 250;
const DAILY_ROWS = 500;
// The daily rows run from 22 Jun 2025 to 3 Nov 2026, and the newest row is the stored amount's own,
// so the rhythm sits on the 3rd: one charge for each of the 17 thirds from 3 Jul 2025.
const DAILY_SLOTS = 17;

export const MARKED_LINE: RecurrenceView = { kind: 'marked' };

export const onDay = (day: number): RecurrenceView => ({ kind: 'onDay', day });
export const onDate = (month: number, day: number): RecurrenceView => ({
  kind: 'onDate',
  month,
  day,
});
const onWeekday = (weekday: number): RecurrenceView => ({ kind: 'onWeekday', weekday });

export const series = (
  period: ExpectedSeries['period'],
  count: number,
  recurrence?: RecurrenceView,
  extra: Partial<ExpectedSeries> = {},
): ExpectedSeries => ({ period, count, recurrence, ...extra });

export const marked = (
  period: ExpectedSeries['period'],
  count: number,
  recurrence?: RecurrenceView,
  extra: Partial<ExpectedShown> = {},
): ExpectedShown => ({ ...series(period, count, recurrence), isMarked: true, ...extra });

export const detected = (
  period: ExpectedSeries['period'],
  count: number,
  recurrence?: RecurrenceView,
  extra: Partial<ExpectedShown> = {},
): ExpectedShown => ({ ...series(period, count, recurrence), isMarked: false, ...extra });

const quietAt = (since: number, holdingName = 'card') => ({ since, holdingName });

export const chain = (period: ExpectedChain['period'], ...amounts: number[]): ExpectedChain => ({
  period,
  amounts,
});

const chargesOn = (
  prefix: string,
  amount: number,
  days: readonly Day[],
  shape: ChargeShape = {},
): LedgerRow[] =>
  days.map(([year, month, day], index) =>
    chargeOf(`${prefix}-${index}`, at(year, month, day), amount, shape),
  );

export const chargesAt = (
  prefix: string,
  entries: readonly DayAmount[],
  shape: ChargeShape = {},
): LedgerRow[] =>
  entries.map(([year, month, day, amount], index) =>
    chargeOf(`${prefix}-${index}`, at(year, month, day), amount, shape),
  );

const secondCardExtras = (iban: string) => ({
  holdings: [holdingOf('card-b', 'UAH', 'bank-account-b', { iban })],
  accounts: [bankAccountOf('bank-account-b')],
});

const dailyShopLedger = (): Ledger => {
  const random = seededRandom(SEED_SPREAD);

  return ledgerOf(
    Array.from({ length: DAILY_ROWS }, (_unused, day) =>
      chargeOf(`shop-${day}`, at(2026, 11, 3 - day), 100 + Math.floor(random() * 1501), {
        description: 'Silpo',
      }),
    ),
  );
};

const dailyFirstAmount = (): number => -(dailyShopLedger().rows[0]?.amountMinorUnits ?? 0) / 100;

const syncDeadLedger = (): Ledger =>
  ledgerOf([
    ...monthly(4, 15, 199, { prefix: 'netflix', newest: [2026, 8] }),
    ...monthly(4, 18, 149, { prefix: 'spotify', description: 'Spotify', newest: [2026, 8] }),
    chargeOf('coffee-0', at(2026, 8, 20), 85, { description: 'Coffee House' }),
  ]);

const withLoanOnTwo = (): LedgerRow[] =>
  monthly(6, 3, 700).map((row, index) =>
    [1, 4].includes(index) ? { ...row, loanHoldingId: 'loan-1' } : row,
  );

const matchedPairLedger = (creditDelayMs: number): Ledger =>
  ledgerOf(
    [
      chargeOf('debit-0', at(2026, 10, 15), EXCLUSION_AMOUNT),
      chargeOf('credit-0', at(2026, 10, 15) + creditDelayMs, -EXCLUSION_AMOUNT, {
        holdingId: 'card-b',
      }),
    ],
    secondCardExtras(THIRD_PARTY_IBAN),
  );

/** Worlds of one amount, where the chain is the whole group. */
export const ONE_AMOUNT_WORLDS: readonly MarkedWorld[] = [
  {
    title: 'quarterly',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 300, [
          [2026, 1, 12],
          [2026, 4, 12],
          [2026, 7, 12],
          [2026, 10, 10],
        ]),
      ),
    marks: [['everyThreeMonths', 300]],
    noEntry: [],
    shown: [marked('everyThreeMonths', 4, MARKED_LINE)],
  },
  {
    title: 'half-yearly',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 900, [
          [2025, 10, 5],
          [2026, 4, 5],
          [2026, 10, 5],
        ]),
      ),
    marks: [['everySixMonths', 900]],
    noEntry: [],
    shown: [marked('everySixMonths', 3, MARKED_LINE)],
  },
  {
    title: 'one charge',
    ledger: () => ledgerOf(chargesOn('bill', 250, [[2026, 10, 15]])),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { lastCharge: at(2026, 10, 15) })],
  },
  {
    title: 'two charges',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 250, [
          [2026, 9, 15],
          [2026, 10, 15],
        ]),
      ),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'three on one day',
    ledger: () => ledgerOf(monthly(3, 15, 250)),
    marks: [['monthly', 250]],
    noEntry: [series('monthly', 3, onDay(15))],
    shown: [marked('monthly', 3, onDay(15))],
  },
  {
    title: 'three on spread days',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 250, [
          [2026, 8, 2],
          [2026, 9, 19],
          [2026, 10, 28],
        ]),
      ),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 3, MARKED_LINE)],
  },
  {
    title: 'yearly, one charge',
    ledger: () => ledgerOf(chargesOn('bill', 400, [[2026, 3, 12]])),
    marks: [['yearly', 400]],
    noEntry: [],
    shown: [marked('yearly', 1, MARKED_LINE)],
  },
  {
    title: 'yearly, two charges',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 400, [
          [2025, 3, 12],
          [2026, 3, 12],
        ]),
      ),
    marks: [['yearly', 400]],
    noEntry: [series('yearly', 2, onDate(3, 12))],
    shown: [marked('yearly', 2, onDate(3, 12))],
  },
  {
    title: 'weekly, three charges',
    ledger: () => ledgerOf(weekly(3, [2026, 10, 26], 100)),
    marks: [['weekly', 100]],
    noEntry: [],
    shown: [marked('weekly', 3, MARKED_LINE)],
  },
  {
    title: 'weekly, four charges',
    ledger: () => ledgerOf(weekly(4, [2026, 10, 26], 100)),
    marks: [['weekly', 100]],
    noEntry: [],
    shown: [marked('weekly', 4, MARKED_LINE)],
  },
  {
    title: 'weekly, five charges',
    ledger: () => ledgerOf(weekly(5, [2026, 10, 26], 100)),
    marks: [['weekly', 100]],
    noEntry: [series('weekly', 5, onWeekday(1))],
    shown: [marked('weekly', 5, onWeekday(1))],
  },
  {
    title: 'quarterly charges marked monthly',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 300, [
          [2026, 1, 12],
          [2026, 4, 12],
          [2026, 7, 12],
        ]),
      ),
    marks: [['monthly', 300]],
    noEntry: [],
    shown: [
      marked('monthly', 3, MARKED_LINE, { isStopped: true, quiet: quietAt(at(2026, 7, 12)) }),
    ],
  },
  {
    title: 'a month apart, marked yearly',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 400, [
          [2025, 12, 20],
          [2026, 1, 15],
        ]),
      ),
    marks: [['yearly', 400]],
    noEntry: [],
    shown: [marked('yearly', 1, MARKED_LINE, { lastCharge: at(2026, 1, 15) })],
  },
  {
    title: 'monthly with one month skipped',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 250, [
          [2026, 7, 15],
          [2026, 9, 15],
          [2026, 10, 15],
        ]),
      ),
    marks: [['monthly', 250]],
    noEntry: [series('monthly', 3, onDay(15))],
    shown: [marked('monthly', 3, onDay(15))],
  },
  {
    title: 'monthly fit with no honest day',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 250, [
          [2026, 8, 1],
          [2026, 9, 5],
          [2026, 10, 9],
        ]),
      ),
    marks: [['monthly', 250]],
    noEntry: [series('monthly', 3, { kind: 'none' })],
    shown: [marked('monthly', 3, MARKED_LINE)],
  },
  {
    title: 'a daily shop',
    ledger: dailyShopLedger,
    name: 'Silpo',
    marks: [['monthly', dailyFirstAmount()]],
    noEntry: [],
    shown: [marked('monthly', DAILY_SLOTS, MARKED_LINE, { lastCharge: at(2026, 11, 3) })],
  },
  {
    title: 'a period that conflicts with the charges',
    ledger: () => ledgerOf(monthly(12, 3, 199)),
    marks: [['yearly', 199]],
    noEntry: [series('monthly', 12, onDay(3))],
    shown: [marked('yearly', 2, MARKED_LINE, { lastCharge: at(2026, 10, 3) })],
  },
  {
    title: 'stopped by the period of the mark',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 199, [
          [2026, 1, 3],
          [2026, 4, 3],
          [2026, 7, 3],
        ]),
      ),
    marks: [['everyThreeMonths', 199]],
    noEntry: [],
    shown: [
      marked('everyThreeMonths', 3, MARKED_LINE, {
        isStopped: true,
        quiet: quietAt(at(2026, 7, 3)),
      }),
    ],
  },
  {
    title: 'not stopped, one day inside the cutoff',
    ledger: () =>
      ledgerOf(
        chargesOn('bill', 199, [
          [2026, 1, 3],
          [2026, 4, 3],
          [2026, 7, 21],
        ]),
      ),
    marks: [['everyThreeMonths', 199]],
    noEntry: [],
    shown: [marked('everyThreeMonths', 3, MARKED_LINE)],
  },
  {
    title: 'quiet, with a sync that died',
    ledger: syncDeadLedger,
    marks: [['monthly', 199]],
    noEntry: [
      series('monthly', 4, onDay(15), {
        from: 'netflix',
        isStopped: true,
        quiet: quietAt(at(2026, 8, 20)),
      }),
      series('monthly', 4, onDay(18), {
        from: 'spotify',
        isStopped: true,
        quiet: quietAt(at(2026, 8, 20)),
      }),
    ],
    shown: [
      marked('monthly', 4, onDay(15), {
        from: 'netflix',
        isStopped: true,
        quiet: quietAt(at(2026, 8, 20)),
      }),
      detected('monthly', 4, onDay(18), {
        from: 'spotify',
        isStopped: true,
        quiet: quietAt(at(2026, 8, 20)),
      }),
    ],
  },
  {
    title: 'a name holding a month',
    ledger: () =>
      ledgerOf([
        chargeOf('october-0', at(2026, 10, 15), 15_000, { description: 'Оренда за жовтень' }),
        chargeOf('september-0', at(2026, 9, 15), 15_000, { description: 'Оренда за вересень' }),
      ]),
    name: 'Оренда за жовтень',
    marks: [['monthly', 15_000]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { from: 'october' })],
  },
  {
    title: 'an import twin',
    ledger: () =>
      ledgerOf([
        ...monthly(2, 2, 250, { prefix: 'bank' }),
        ...monthly(2, 2, 250, { prefix: 'file', source: 'import' }),
      ]),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'a future-dated manual row',
    ledger: () =>
      ledgerOf(
        chargesOn(
          'manual',
          250,
          [
            [2026, 10, 15],
            [2026, 11, 15],
          ],
          { source: 'manual' },
        ),
      ),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { lastCharge: at(2026, 10, 15) })],
  },
  {
    title: 'a row later today',
    ledger: () =>
      ledgerOf([chargeOf('bill-0', at(2026, 11, 3, 23, 50), 250, { source: 'manual' })]),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { lastCharge: at(2026, 11, 3, 23, 50) })],
  },
  {
    title: 'past the leave bound',
    ledger: () => ledgerOf(chargesOn('bill', 300, [[2024, 5, 3]])),
    marks: [['monthly', 300]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { isStopped: true, quiet: quietAt(at(2024, 5, 3)) })],
  },
  {
    title: 'some rows excluded',
    ledger: () => ledgerOf(withLoanOnTwo()),
    marks: [['monthly', 700]],
    noEntry: [],
    shown: [marked('monthly', 4, MARKED_LINE)],
  },
  {
    title: 'credits only',
    ledger: () => ledgerOf(monthly(3, 3, -500)),
    marks: [['monthly', 500]],
    noEntry: [],
    shown: [],
    withoutCharges: [chain('monthly', 500)],
  },
  {
    title: 'debits where the credits were',
    ledger: () => ledgerOf(monthly(3, 3, 500)),
    marks: [['monthly', 500]],
    noEntry: [series('monthly', 3, onDay(3))],
    shown: [marked('monthly', 3, onDay(3))],
  },
  {
    title: 'a row on a later day only',
    ledger: () => ledgerOf([chargeOf('bill-0', at(2026, 11, 15), 250, { source: 'manual' })]),
    marks: [['monthly', 250]],
    noEntry: [],
    shown: [],
    withoutCharges: [chain('monthly', 250)],
  },
  {
    title: 'no rows',
    ledger: () => ledgerOf([]),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [],
    withoutCharges: [chain('monthly', 100)],
  },
  {
    title: 'a hidden key with no mark',
    ledger: () => ledgerOf(monthly(6, 3, 700)),
    marks: [],
    noEntry: [series('monthly', 6, onDay(3))],
    shown: [detected('monthly', 6, onDay(3))],
  },
  {
    title: 'a hidden key with a mark',
    ledger: () => ledgerOf(monthly(6, 3, 700)),
    marks: [['monthly', 700]],
    noEntry: [series('monthly', 6, onDay(3))],
    shown: [marked('monthly', 6, onDay(3))],
  },
];

const billOf = (overrides: Partial<LedgerRow>, description = 'Netflix'): LedgerRow =>
  chargeOf('bill-0', at(2026, 10, 15), EXCLUSION_AMOUNT, { description, overrides });

const flagged =
  (overrides: Partial<LedgerRow>): ExclusionBuild =>
  (excluded) => ({ ledger: ledgerOf([billOf(excluded ? overrides : {})]), name: 'Netflix' });

const EXCLUSIONS: readonly (readonly [title: string, build: ExclusionBuild])[] = [
  ['an exchange pair', flagged({ exchangePairId: 'pair-1' })],
  ['an exchange counterpart holding', flagged({ exchangeCounterpartHoldingId: 'usdt' })],
  ['an untracked counterpart', flagged({ untrackedCounterpart: 'wallet:abc' })],
  ['a balance set', flagged({ setsBalance: true })],
  ['a change group', flagged({ changeGroupId: 'change-1' })],
  ['a linked loan', flagged({ loanHoldingId: 'loan-1' })],
  [
    'a crypto holding',
    (excluded) => ({
      ledger: ledgerOf([billOf({ holdingId: excluded ? 'usdt' : 'card' }, 'USDT')], CRYPTO_EXTRAS),
      name: 'USDT',
    }),
  ],
  [
    'a cash-out MCC',
    (excluded) => ({
      ledger: ledgerOf([billOf({ mcc: excluded ? CASH_OUT_MCC : GROCERY_MCC })]),
      name: 'Netflix',
    }),
  ],
  [
    'a transfer to an own IBAN',
    (excluded) => ({
      ledger: ledgerOf(
        [billOf({ mcc: TRANSFER_MCC, counterIban: excluded ? OWN_IBAN : THIRD_PARTY_IBAN })],
        secondCardExtras(OWN_IBAN),
      ),
      name: 'Netflix',
    }),
  ],
  [
    'the deposit wording',
    (excluded) => {
      const name = excluded ? 'Поповнення депозиту' : 'Netflix';

      return { ledger: ledgerOf([billOf({}, name)]), name };
    },
  ],
  [
    'a debit that funded an exchange purchase',
    (excluded) => {
      const debit = billOf({});
      const delay = excluded ? FUNDING_DELAY_MS : BEYOND_FUNDING_WINDOW_MS;

      return {
        ledger: ledgerOf([debit, ...fundingPurchasesOf([debit], delay)], CRYPTO_EXTRAS),
        name: 'Netflix',
      };
    },
  ],
  [
    'an archived account',
    (excluded) => ({
      ledger: ledgerOf([billOf({ holdingId: excluded ? 'old-card' : 'card' })], {
        holdings: [holdingOf('old-card', 'UAH', 'archived-account')],
        accounts: [{ id: 'archived-account', kind: 'bank', archivedAt: ARCHIVED_AT }],
      }),
      name: 'Netflix',
    }),
  ],
  [
    'a missing holding',
    (excluded) => ({
      ledger: ledgerOf([billOf({ holdingId: excluded ? 'ghost' : 'card' })]),
      name: 'Netflix',
    }),
  ],
  [
    'a matched pair across two own cards',
    (excluded) => ({
      ledger: matchedPairLedger(excluded ? MINUTE_MS : HOUR_MS),
      name: 'Netflix',
      rowId: 'debit-0',
    }),
  ],
];

/** One merchant per rule: a world the rule applies to, and its twin with the rule off. */
export const exclusionWorlds = (): ExclusionWorld[] =>
  EXCLUSIONS.flatMap(([title, build]): ExclusionWorld[] =>
    [true, false].map((isExcluded) => {
      const { name, rowId = 'bill-0' } = build(isExcluded);

      return {
        title: `${title}, ${isExcluded ? 'the rule applies' : 'the rule is off'}`,
        ledger: () => build(isExcluded).ledger,
        name,
        marks: [['monthly', EXCLUSION_AMOUNT]],
        noEntry: [],
        shown: isExcluded ? [] : [marked('monthly', 1, MARKED_LINE)],
        withoutCharges: isExcluded ? [chain('monthly', EXCLUSION_AMOUNT)] : [],
        rowId,
        isExcluded,
      };
    }),
  );
