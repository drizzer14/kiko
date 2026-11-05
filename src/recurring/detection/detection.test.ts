import { maxOf } from '@kiko/numbers';
import {
  merchantNameOf,
  tidiedNameOf,
  smallestSpelling,
  merchantSpellingOf,
} from '@kiko/transactions/merchant-name';
import {
  at,
  weekly,
  nowOf,
  monthly,
  rangeOf,
  holdingOf,
  ledgerOf,
  chargeOf,
  viewsOf,
  timesOf,
  shuffled,
  dayKeyOf,
  dayViewsOf,
  steppedAmount,
  foldBucketsOf,
  bankAccountOf,
  randomLedgerOf,
  CRYPTO_EXTRAS,
  expectedViewsOf,
  fundingPurchasesOf,
  type Ledger,
  type LedgerRow,
  type ExpectedSeries,
  type RecurrenceView,
} from '@kiko/test-support/recurring-ledger';
import { sweep } from '@kiko/test-support/property-sweep';
import { seededRandom } from '@kiko/test-support/seeded-random';
import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';

import { detectRecurringSeries } from './detection';
import type { RecurringSeries } from './detection.types.d';

type MatrixRow = [title: string, world: () => Ledger, expected: ExpectedSeries[]];
type ExclusionWorld = [title: string, build: (excluded: boolean) => Ledger];

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
const APPLE = { description: 'Apple' };
const PURCHASE_DAYS = [3, 9, 17, 22, 28, 2, 11, 19, 25, 7, 13, 21, 27, 1, 16];
const MONTH_NAMES = ['жовтень', 'вересень', 'серпень', 'липень', 'червень', 'травень'];
const SEASONAL_AMOUNTS = [130, 100, 105, 110, 100, 108, 400, 700, 900, 800, 500, 300];

const onDay = (day: number): RecurrenceView => ({ kind: 'onDay', day });

const monthlySeries = (
  count: number,
  day: number,
  extra: Partial<ExpectedSeries> = {},
): ExpectedSeries => ({ period: 'monthly', count, recurrence: onDay(day), ...extra });

const quietAt = (since: number, holdingName = 'card') => ({ since, holdingName });

const coffeeOf = (id: string, time: number, shape: Partial<LedgerRow> = {}): LedgerRow =>
  chargeOf(id, time, 85, { description: 'Coffee House', overrides: shape });

const lastTimeOf = (rows: readonly LedgerRow[]): number => maxOf(rows.map(({ time }) => time));

const oneOffsOf = (): LedgerRow[] => [
  chargeOf('purchase-a', at(2026, 3, 2), 4500, APPLE),
  chargeOf('purchase-b', at(2026, 5, 22), 1200, APPLE),
  chargeOf('purchase-c', at(2026, 8, 1), 7000, APPLE),
];

// One purchase a month back from October, on the listed days, at the listed amounts by turn.
const purchasesOf = (amounts: readonly number[]): LedgerRow[] =>
  monthly(15, 1, (index) => amounts[index % amounts.length], {
    ...APPLE,
    prefix: 'purchase',
    dayOf: (index) => PURCHASE_DAYS[index],
  });

const secondCardExtras = (iban: string) => ({
  holdings: [holdingOf('card-b', 'UAH', 'bank-account-b', { iban })],
  accounts: [bankAccountOf('bank-account-b')],
});

const billsOf = (overrides: Partial<LedgerRow>): LedgerRow[] =>
  monthly(12, 5, 1000, { prefix: 'bill', overrides });

const STRUCTURAL_EXCLUSIONS: ExclusionWorld[] = [
  [
    'an exchange pair',
    (excluded) => ledgerOf(billsOf(excluded ? { exchangePairId: 'pair-1' } : {})),
  ],
  [
    'an exchange counterpart holding',
    (excluded) => ledgerOf(billsOf(excluded ? { exchangeCounterpartHoldingId: 'usdt' } : {})),
  ],
  [
    'an untracked counterpart',
    (excluded) => ledgerOf(billsOf(excluded ? { untrackedCounterpart: 'wallet:abc' } : {})),
  ],
  ['a balance set', (excluded) => ledgerOf(billsOf({ setsBalance: excluded }))],
  [
    'a change group',
    (excluded) => ledgerOf(billsOf(excluded ? { changeGroupId: 'change-1' } : {})),
  ],
  ['a linked loan', (excluded) => ledgerOf(billsOf(excluded ? { loanHoldingId: 'loan-1' } : {}))],
  [
    'a crypto holding',
    (excluded) =>
      ledgerOf(
        monthly(12, 5, 1000, {
          prefix: 'bill',
          description: 'USDT',
          holdingId: excluded ? 'usdt' : 'card',
        }),
        CRYPTO_EXTRAS,
      ),
  ],
];

const MATCHER_EXCLUSIONS: ExclusionWorld[] = [
  [
    'a cash-out MCC',
    (excluded) => ledgerOf(billsOf({ mcc: excluded ? CASH_OUT_MCC : GROCERY_MCC })),
  ],
  [
    'a transfer to an own IBAN',
    (excluded) =>
      ledgerOf(
        billsOf({ mcc: TRANSFER_MCC, counterIban: excluded ? OWN_IBAN : THIRD_PARTY_IBAN }),
        secondCardExtras(OWN_IBAN),
      ),
  ],
  [
    'the deposit wording',
    (excluded) =>
      ledgerOf(
        monthly(12, 5, 1000, {
          prefix: 'bill',
          description: excluded ? 'Поповнення депозиту' : 'Netflix',
        }),
      ),
  ],
  [
    'a matched pair across two own cards',
    (excluded) => {
      const debits = monthly(12, 5, 1000, { prefix: 'bill' });
      const credits = debits.map((debit) =>
        chargeOf(`credit-${debit.id}`, debit.time + (excluded ? MINUTE_MS : HOUR_MS), -1000, {
          holdingId: 'card-b',
        }),
      );

      return ledgerOf([...debits, ...credits], secondCardExtras(THIRD_PARTY_IBAN));
    },
  ],
  [
    'a debit that funded an exchange purchase',
    (excluded) => {
      const debits = monthly(12, 5, 1000, { prefix: 'bill' });
      const delay = excluded ? FUNDING_DELAY_MS : BEYOND_FUNDING_WINDOW_MS;

      return ledgerOf([...debits, ...fundingPurchasesOf(debits, delay)], CRYPTO_EXTRAS);
    },
  ],
];

const exclusionRowsOf = (worlds: readonly ExclusionWorld[]): MatrixRow[] =>
  worlds.flatMap(([title, build]): MatrixRow[] => [
    [`${title}, one merchant`, () => build(true), []],
    [`${title}, the rule no longer applying`, () => build(false), [monthlySeries(12, 5)]],
  ]);

const dailyShopWorld = (): Ledger => {
  const random = seededRandom(SEED_SPREAD);

  return ledgerOf(
    Array.from({ length: 500 }, (_unused, day) =>
      chargeOf(`shop-${day}`, at(2026, 11, 3 - day), 100 + Math.floor(random() * 1501), {
        description: 'Silpo',
      }),
    ),
  );
};

const weeklyShopWorld = (): Ledger => {
  const random = seededRandom(2 * SEED_SPREAD);

  return ledgerOf(
    weekly(20, [2026, 10, 26], () => 600 + Math.floor(random() * 901), {
      description: 'Fora',
      prefix: 'shop',
    }),
  );
};

const randomDayVisitWorld = (): Ledger => {
  const random = seededRandom(3 * SEED_SPREAD);

  return ledgerOf(
    monthly(12, 1, 600, {
      description: 'Rozetka',
      prefix: 'visit',
      dayOf: () => 1 + Math.floor(random() * 27),
    }),
  );
};

const thirtyFirstWorld = (): Ledger =>
  ledgerOf(monthly(10, 31, 5000, { description: 'Rent', prefix: 'rent' }));

const fridayAcrossDaylightSavingWorld = (): Ledger =>
  ledgerOf(weekly(8, [2026, 10, 30], 150, { description: 'Gym', prefix: 'friday' }));

const THIRTY_FIRST_EXPECTED: ExpectedSeries[] = [
  { period: 'monthly', count: 10, recurrence: { kind: 'lastDay' } },
];
const FRIDAY_EXPECTED: ExpectedSeries[] = [
  { period: 'weekly', count: 8, recurrence: { kind: 'onWeekday', weekday: 5 } },
];

const oneAccountTwoCardsWorld = (): Ledger =>
  ledgerOf(
    [
      ...monthly(9, 3, 199, { prefix: 'black', holdingId: 'black', without: [0, 1, 2, 3] }),
      coffeeOf('coffee-black', at(2026, 6, 20), { holdingId: 'black' }),
      ...monthly(6, 4, 99, { prefix: 'white', holdingId: 'white', description: 'Spotify' }),
    ],
    { holdings: [holdingOf('black'), holdingOf('white')] },
  );

const cancelledBills = (): LedgerRow[] =>
  monthly(12, 3, 199, { prefix: 'netflix', without: [0, 1, 2, 3] });

const MATRIX: readonly MatrixRow[] = [
  ['a daily grocery shop', dailyShopWorld, []],
  ['a weekly shop with a moving amount', weeklyShopWorld, []],
  ['one visit a month on a random day at one price', randomDayVisitWorld, []],
  [
    'monthly rent moved by up to two days',
    () =>
      ledgerOf(
        monthly(12, 1, 18_000, {
          description: 'Оренда квартири',
          prefix: 'rent',
          dayOf: (index) => 1 + (index % 3),
          overrides: { mcc: TRANSFER_MCC, counterIban: THIRD_PARTY_IBAN },
        }),
      ),
    [{ period: 'monthly', count: 12, recurrence: { kind: 'aroundDay', day: 2 } }],
  ],
  [
    'Netflix moved from the 15th to the 18th',
    () =>
      ledgerOf([
        ...monthly(6, 18, 249, { prefix: 'netflix' }),
        ...monthly(12, 15, 249, { prefix: 'netflix', indexes: rangeOf(6, 12) }),
      ]),
    [monthlySeries(12, 18, { from: 'netflix' })],
  ],
  [
    'Netflix moved a week once',
    () =>
      ledgerOf([
        ...monthly(6, 3, 249, { prefix: 'netflix' }),
        ...monthly(12, 15, 249, { prefix: 'netflix', indexes: rangeOf(6, 12) }),
      ]),
    [monthlySeries(12, 3, { from: 'netflix' })],
  ],
  [
    'Apple twice, different amounts and days',
    () =>
      ledgerOf([
        ...monthly(10, 5, 99, { ...APPLE, prefix: 'apple-a' }),
        ...monthly(10, 20, 399, { ...APPLE, prefix: 'apple-b' }),
      ]),
    [monthlySeries(10, 5, { from: 'apple-a' }), monthlySeries(10, 20, { from: 'apple-b' })],
  ],
  [
    'Apple twice, close amounts',
    () =>
      ledgerOf([
        ...monthly(10, 5, 99, { ...APPLE, prefix: 'apple-a' }),
        ...monthly(10, 20, 119, { ...APPLE, prefix: 'apple-b' }),
      ]),
    [monthlySeries(10, 5, { from: 'apple-a' }), monthlySeries(10, 20, { from: 'apple-b' })],
  ],
  [
    'Apple twice, the same amount',
    () =>
      ledgerOf([
        ...monthly(10, 5, 99, { ...APPLE, prefix: 'apple-a' }),
        ...monthly(10, 20, 99, { ...APPLE, prefix: 'apple-b' }),
      ]),
    [monthlySeries(10, 5, { from: 'apple-a' }), monthlySeries(10, 20, { from: 'apple-b' })],
  ],
  [
    'Apple twice, the same amount and day',
    () =>
      ledgerOf([
        ...monthly(10, 5, 99, { ...APPLE, prefix: 'apple-a' }),
        ...monthly(10, 5, 99, { ...APPLE, prefix: 'apple-b' }),
      ]),
    [],
  ],
  [
    'Apple monthly and yearly',
    () =>
      ledgerOf([
        ...monthly(24, 5, 99, { ...APPLE, prefix: 'apple-month' }),
        chargeOf('apple-year-0', at(2026, 3, 12), 999, APPLE),
        chargeOf('apple-year-1', at(2025, 3, 12), 999, APPLE),
      ]),
    [
      monthlySeries(24, 5, { from: 'apple-month' }),
      {
        period: 'yearly',
        count: 2,
        from: 'apple-year',
        recurrence: { kind: 'onDate', month: 3, day: 12 },
      },
    ],
  ],
  [
    'a yearly domain with two charges',
    () =>
      ledgerOf([
        chargeOf('domain-0', at(2025, 3, 12), 420, { description: 'Namecheap' }),
        chargeOf('domain-1', at(2024, 3, 12), 400, { description: 'Namecheap' }),
      ]),
    [
      {
        period: 'yearly',
        count: 2,
        recurrence: { kind: 'onDate', month: 3, day: 12 },
        isStopped: true,
        quiet: quietAt(at(2025, 3, 12)),
      },
    ],
  ],
  [
    'a yearly renewal moved by days',
    () =>
      ledgerOf([
        chargeOf('renewal-0', at(2026, 6, 4), 450, { description: 'Insurance' }),
        chargeOf('renewal-1', at(2025, 6, 6), 410, { description: 'Insurance' }),
        chargeOf('renewal-2', at(2024, 6, 2), 400, { description: 'Insurance' }),
      ]),
    [{ period: 'yearly', count: 3, recurrence: { kind: 'onDate', month: 6, day: 4 } }],
  ],
  [
    'two visits a year apart',
    () =>
      ledgerOf([
        chargeOf('visit-0', at(2026, 4, 14), 2100, { description: 'Clinic' }),
        chargeOf('visit-1', at(2025, 4, 10), 2000, { description: 'Clinic' }),
      ]),
    [{ period: 'yearly', count: 2, recurrence: { kind: 'onDate', month: 4, day: 14 } }],
  ],
  [
    'a weekly charge with a two-week gap',
    () =>
      ledgerOf(
        weekly(12, [2026, 10, 26], 500, {
          description: 'Pool',
          prefix: 'pool',
          weeksBackOf: (index) => (index < 6 ? index : index + 1),
        }),
      ),
    [{ period: 'weekly', count: 12, recurrence: { kind: 'onWeekday', weekday: 1 } }],
  ],
  [
    'a skipped month',
    () => ledgerOf(monthly(10, 10, 900, { prefix: 'gym', without: [4] })),
    [monthlySeries(9, 10)],
  ],
  [
    'a price change of 50 percent',
    () => ledgerOf(monthly(8, 7, (index) => (index < 3 ? 299 : 199), { prefix: 'plan' })),
    [monthlySeries(8, 7)],
  ],
  [
    'two price changes in two years',
    () =>
      ledgerOf(
        monthly(
          24,
          8,
          (index) =>
            steppedAmount(
              index,
              [
                [8, 400],
                [16, 300],
              ],
              200,
            ),
          {
            prefix: 'plan',
          },
        ),
      ),
    [monthlySeries(24, 8)],
  ],
  [
    'a stopped subscription',
    () => ledgerOf(cancelledBills()),
    [
      monthlySeries(8, 3, {
        isStopped: true,
        quiet: quietAt(at(2026, 6, 3)),
        lastCharge: at(2026, 6, 3),
      }),
    ],
  ],
  [
    'a foreign charge billed in hryvnia',
    () => ledgerOf(monthly(14, 9, (index) => 800 + 9 * index + 13 * (index % 2))),
    [monthlySeries(14, 9)],
  ],
  ['the 31st against February', thirtyFirstWorld, THIRTY_FIRST_EXPECTED],
  [
    'a card change in one currency',
    () =>
      ledgerOf([
        ...monthly(5, 11, 159, { prefix: 'plan', holdingId: 'card2' }),
        ...monthly(10, 11, 159, { prefix: 'plan', indexes: rangeOf(5, 10) }),
      ]),
    [monthlySeries(10, 11)],
  ],
  [
    'one name in two currencies',
    () =>
      ledgerOf(
        [
          ...monthly(6, 3, 10, { prefix: 'usd', holdingId: 'usd' }),
          ...monthly(6, 3, 400, { prefix: 'uah' }),
        ],
        { holdings: [holdingOf('usd', 'USD')] },
      ),
    [monthlySeries(6, 3, { from: 'uah' }), monthlySeries(6, 3, { from: 'usd', currency: 'USD' })],
  ],
  [
    'an import twin on the same day',
    () =>
      ledgerOf([
        ...monthly(6, 2, 250, { prefix: 'bank' }),
        ...monthly(6, 2, 250, { prefix: 'import', source: 'import' }),
      ]),
    [monthlySeries(6, 2, { from: 'bank' })],
  ],
  ['two charges only', () => ledgerOf(monthly(2, 2, 250)), []],
  [
    'a subscription among rarer one-off purchases',
    () => ledgerOf([...monthly(12, 14, 99, { ...APPLE, prefix: 'apple' }), ...oneOffsOf()]),
    [monthlySeries(12, 14, { from: 'apple' })],
  ],
  [
    'a utility bill with wide amounts',
    () => ledgerOf(monthly(12, 20, (index) => [400, 900, 1500, 600][index % 4])),
    [monthlySeries(12, 20)],
  ],
  ...exclusionRowsOf(STRUCTURAL_EXCLUSIONS),
  ...exclusionRowsOf(MATCHER_EXCLUSIONS),
  [
    'a name holding a month',
    () =>
      ledgerOf(
        monthly(6, 1, 15_000, {
          prefix: 'rent',
          descriptionOf: (index) => `Оренда за ${MONTH_NAMES[index]}`,
        }),
      ),
    [],
  ],
  [
    'a seasonal bill',
    () => ledgerOf(monthly(12, 20, (index) => SEASONAL_AMOUNTS[11 - index], { prefix: 'heat' })),
    [monthlySeries(12, 20)],
  ],
  [
    'a seasonal bill with one moved day',
    () =>
      ledgerOf(
        monthly(12, 20, (index) => SEASONAL_AMOUNTS[11 - index], {
          prefix: 'heat',
          dayOf: (index) => (index === 3 ? 28 : 20),
        }),
      ),
    [monthlySeries(12, 20)],
  ],
  [
    'Apple among more frequent purchases',
    () =>
      ledgerOf([
        ...monthly(12, 5, 99, { ...APPLE, prefix: 'apple' }),
        ...purchasesOf([29, 49, 199, 399, 29]),
      ]),
    [monthlySeries(12, 5, { from: 'apple' })],
  ],
  [
    'Apple, purchases near its price',
    () =>
      ledgerOf([
        ...monthly(12, 5, 99, { ...APPLE, prefix: 'apple' }),
        ...purchasesOf([89, 109, 119, 399, 29]),
      ]),
    [monthlySeries(12, 5, { from: 'apple' })],
  ],
  [
    'Apple, three purchases at its price',
    () =>
      ledgerOf([
        ...monthly(12, 5, 99, { ...APPLE, prefix: 'apple' }),
        ...purchasesOf([99, 109, 119, 399, 29]),
      ]),
    [monthlySeries(14, 5)],
  ],
  [
    'Apple, most purchases at its price',
    () =>
      ledgerOf([...monthly(12, 5, 99, { ...APPLE, prefix: 'apple' }), ...purchasesOf([99, 29])]),
    [],
  ],
  [
    'Apple, too few charges',
    () =>
      ledgerOf([
        ...monthly(5, 5, 99, { ...APPLE, prefix: 'apple' }),
        ...purchasesOf([29, 49, 199, 399, 29]),
      ]),
    [],
  ],
  [
    'two large price changes',
    () =>
      ledgerOf(
        monthly(
          18,
          6,
          (index) =>
            steppedAmount(
              index,
              [
                [4, 170],
                [10, 130],
              ],
              100,
            ),
          {
            prefix: 'plan',
          },
        ),
      ),
    [monthlySeries(18, 6)],
  ],
  [
    'a charge ten days early',
    () =>
      ledgerOf([
        chargeOf('bill-0', at(2026, 10, 5), 90),
        chargeOf('bill-1', at(2026, 9, 15), 90),
        chargeOf('bill-2', at(2026, 8, 15), 90),
      ]),
    [],
  ],
  [
    'a funded debit with no hand category',
    () => {
      const debits = monthly(8, 9, 4100, { prefix: 'bill' });

      return ledgerOf([...debits, ...fundingPurchasesOf(debits, FUNDING_DELAY_MS)], CRYPTO_EXTRAS);
    },
    [],
  ],
  [
    'a funded debit with a hand category',
    () => {
      const debits = monthly(8, 9, 4100, {
        prefix: 'bill',
        overrides: { categorySetByHand: true },
      });

      return ledgerOf([...debits, ...fundingPurchasesOf(debits, FUNDING_DELAY_MS)], CRYPTO_EXTRAS);
    },
    [monthlySeries(8, 9)],
  ],
  [
    'sync dead with a newer other row',
    () =>
      ledgerOf([
        ...monthly(4, 15, 199, { prefix: 'netflix', newest: [2026, 8] }),
        ...monthly(4, 18, 149, { prefix: 'spotify', description: 'Spotify', newest: [2026, 8] }),
        coffeeOf('coffee-0', at(2026, 8, 20)),
      ]),
    [
      monthlySeries(4, 15, { from: 'netflix', isStopped: true, quiet: quietAt(at(2026, 8, 20)) }),
      monthlySeries(4, 18, { from: 'spotify', isStopped: true, quiet: quietAt(at(2026, 8, 20)) }),
    ],
  ],
  [
    'an import-only ledger',
    () =>
      ledgerOf([
        ...monthly(5, 2, 300, {
          prefix: 'internet',
          description: 'Internet',
          source: 'import',
          newest: [2026, 5],
        }),
        coffeeOf('coffee-0', at(2026, 5, 25, 12, 0), { source: 'import' }),
      ]),
    [monthlySeries(5, 2, { isStopped: true, quiet: quietAt(at(2026, 5, 25, 12, 0)) })],
  ],
  [
    'one card idle and another active in one account',
    oneAccountTwoCardsWorld,
    [
      monthlySeries(5, 3, {
        from: 'black',
        isStopped: true,
        quiet: quietAt(at(2026, 6, 20), 'black'),
      }),
      monthlySeries(6, 4, { from: 'white' }),
    ],
  ],
  [
    'stopped, with a debit on the card inside the window',
    () => ledgerOf([...cancelledBills(), coffeeOf('coffee-0', at(2026, 10, 28))]),
    [monthlySeries(8, 3, { isStopped: true })],
  ],
  [
    'stopped, with a credit on the card inside the window',
    () =>
      ledgerOf([
        ...cancelledBills(),
        chargeOf('refund-0', at(2026, 10, 28), -150, { description: 'Salary' }),
      ]),
    [monthlySeries(8, 3, { isStopped: true })],
  ],
  [
    'future-dated manual rows',
    () =>
      ledgerOf([
        ...monthly(8, 15, 15_000, { prefix: 'rent', description: 'Rent', source: 'manual' }),
        chargeOf('future-0', at(2026, 11, 15), 15_000, { description: 'Rent', source: 'manual' }),
        chargeOf('future-1', at(2026, 12, 15), 15_000, { description: 'Rent', source: 'manual' }),
      ]),
    [monthlySeries(8, 15, { from: 'rent', lastCharge: at(2026, 10, 15) })],
  ],
  [
    'a row later today',
    () =>
      ledgerOf([
        ...monthly(5, 3, 99, { prefix: 'netflix' }),
        chargeOf('netflix-today', at(2026, 11, 3, 23, 50), 99),
      ]),
    [monthlySeries(6, 3, { from: 'netflix', lastCharge: at(2026, 11, 3, 23, 50) })],
  ],
  [
    'a fold of one synced row and two import rows',
    () =>
      ledgerOf([
        ...monthly(6, 2, 250, { prefix: 'bank' }),
        ...monthly(6, 2, 250, { prefix: 'import', source: 'import' }),
        chargeOf('import-extra', at(2026, 10, 2, 12, 0), 250, { source: 'import' }),
      ]),
    [monthlySeries(7, 2)],
  ],
  [
    'a date-only twin one day apart',
    () =>
      ledgerOf([
        ...monthly(6, 2, 250, { prefix: 'bank' }),
        ...monthly(6, 3, 250, { prefix: 'import', source: 'import' }),
      ]),
    [monthlySeries(6, 2, { from: 'bank' })],
  ],
  [
    'a twin two days apart',
    () =>
      ledgerOf([
        ...monthly(6, 2, 250, { prefix: 'bank' }),
        ...monthly(6, 4, 250, { prefix: 'import', source: 'import' }),
      ]),
    [],
  ],
  [
    'a weekly charge across the autumn clock change',
    fridayAcrossDaylightSavingWorld,
    FRIDAY_EXPECTED,
  ],
];

describe('detectRecurringSeries', () => {
  describe('the world matrix', () => {
    it.each(MATRIX)('%s: gives the expected series', (_title, world, expected) => {
      expect(viewsOf(detectRecurringSeries(world(), nowOf()))).toEqual(expectedViewsOf(expected));
    });

    it.each(MATRIX)(
      '%s: gives the same result with the rows shuffled',
      (_title, world, expected) => {
        const ledger = world();
        const original = detectRecurringSeries(ledger, nowOf());
        const random = seededRandom(SEED_SPREAD);

        for (const rows of [[...ledger.rows].reverse(), shuffled(ledger.rows, random)]) {
          const reordered = detectRecurringSeries({ ...ledger, rows }, nowOf());

          expect(reordered).toEqual(original);
          expect(viewsOf(reordered)).toEqual(expectedViewsOf(expected));
        }
      },
    );

    it.each(MATRIX)(
      '%s: gives the same result on a device in a fixed-offset zone',
      (_title, world, expected) => {
        const kyiv = detectRecurringSeries(world(), nowOf());
        const fixedOffset = withDeviceZoneOffset(2, () => detectRecurringSeries(world(), nowOf()));

        expect(dayViewsOf(fixedOffset)).toEqual(dayViewsOf(kyiv));
        expect(fixedOffset.map(({ chargeIds }) => chargeIds.length).sort()).toEqual(
          expected.map(({ count }) => count).sort(),
        );
      },
    );
  });

  describe('a device zone without daylight saving', () => {
    it.each<[string, () => Ledger, ExpectedSeries[]]>([
      ['the 31st', thirtyFirstWorld, THIRTY_FIRST_EXPECTED],
      [
        'a weekly series across the autumn change',
        fridayAcrossDaylightSavingWorld,
        FRIDAY_EXPECTED,
      ],
    ])('reads %s as it reads in Kyiv', (_title, world, expected) => {
      const fixedOffset = withDeviceZoneOffset(2, () => detectRecurringSeries(world(), nowOf()));

      expect(viewsOf(fixedOffset)).toEqual(expectedViewsOf(expected));
    });
  });

  describe('stopped, on its cutoff', () => {
    // Cutoffs back from 3 Nov 2026: monthly 26 Sep, weekly 17 Oct, yearly 20 Oct 2025.
    const monthlyOn = (day: number, hour: number, minute: number) =>
      monthly(3, day, 150, { newest: [2026, 9], hour, minute });
    const weeklyOn = (day: number, hour: number, minute: number) =>
      weekly(5, [2026, 10, day], 150, { hour, minute });
    const yearlyOn = (day: number, hour: number, minute: number) => [
      chargeOf('year-0', at(2025, 10, day, hour, minute), 410, { description: 'Hosting' }),
      chargeOf('year-1', at(2024, 10, day, hour, minute), 400, { description: 'Hosting' }),
    ];

    it.each<[string, LedgerRow[], ExpectedSeries['period'], number, boolean]>([
      ['monthly on its cutoff day', monthlyOn(26, 0, 30), 'monthly', 3, false],
      ['monthly a day before its cutoff', monthlyOn(25, 23, 30), 'monthly', 3, true],
      ['weekly on its cutoff day', weeklyOn(17, 0, 30), 'weekly', 5, false],
      ['weekly a day before its cutoff', weeklyOn(16, 23, 30), 'weekly', 5, true],
      ['yearly on its cutoff day', yearlyOn(20, 0, 30), 'yearly', 2, false],
      ['yearly a day before its cutoff', yearlyOn(19, 23, 30), 'yearly', 2, true],
    ])('%s', (_title, rows, period, count, isStopped) => {
      const expected: ExpectedSeries = {
        period,
        count,
        isStopped,
        ...(isStopped ? { quiet: quietAt(lastTimeOf(rows)) } : {}),
      };

      expect(viewsOf(detectRecurringSeries(ledgerOf(rows), nowOf()))).toEqual(
        expectedViewsOf([expected]),
      );
    });
  });

  describe('quiet, on the same cutoff', () => {
    const stoppedMonthly = () => monthly(3, 20, 150, { newest: [2026, 8], description: 'Gym' });
    const stoppedWeekly = () => weekly(5, [2026, 10, 10], 150, { description: 'Gym' });
    const stoppedYearly = () => [
      chargeOf('year-0', at(2025, 6, 1), 410, { description: 'Gym' }),
      chargeOf('year-1', at(2024, 6, 1), 400, { description: 'Gym' }),
    ];

    it.each<[string, LedgerRow[], ExpectedSeries['period'], number, LedgerRow, boolean]>([
      [
        'monthly, a row the day before the cutoff',
        stoppedMonthly(),
        'monthly',
        3,
        coffeeOf('coffee-0', at(2026, 9, 25, 23, 30)),
        true,
      ],
      [
        'monthly, a row on the cutoff day',
        stoppedMonthly(),
        'monthly',
        3,
        coffeeOf('coffee-0', at(2026, 9, 26, 0, 30)),
        false,
      ],
      [
        'weekly, a row the day before the cutoff',
        stoppedWeekly(),
        'weekly',
        5,
        coffeeOf('coffee-0', at(2026, 10, 16, 23, 30)),
        true,
      ],
      [
        'weekly, a row on the cutoff day',
        stoppedWeekly(),
        'weekly',
        5,
        coffeeOf('coffee-0', at(2026, 10, 17, 0, 30)),
        false,
      ],
      [
        'yearly, a row the day before the cutoff',
        stoppedYearly(),
        'yearly',
        2,
        coffeeOf('coffee-0', at(2025, 10, 19, 23, 30)),
        true,
      ],
      [
        'yearly, a row on the cutoff day',
        stoppedYearly(),
        'yearly',
        2,
        coffeeOf('coffee-0', at(2025, 10, 20, 0, 30)),
        false,
      ],
    ])('%s', (_title, rows, period, count, other, isQuiet) => {
      const expected: ExpectedSeries = {
        period,
        count,
        isStopped: true,
        ...(isQuiet ? { quiet: quietAt(other.time) } : {}),
      };

      expect(viewsOf(detectRecurringSeries(ledgerOf([...rows, other]), nowOf()))).toEqual(
        expectedViewsOf([expected]),
      );
    });
  });

  describe('the list bound of 24 months after the last charge', () => {
    it('keeps a series whose last charge is a day inside the bound', () => {
      const rows = monthly(3, 4, 150, { newest: [2024, 11], prefix: 'bill' });

      expect(viewsOf(detectRecurringSeries(ledgerOf(rows), nowOf()))).toEqual(
        expectedViewsOf([
          monthlySeries(3, 4, { isStopped: true, quiet: quietAt(at(2024, 11, 4)) }),
        ]),
      );
    });

    it('keeps a series on the exact day its last charge reaches the bound', () => {
      const rows = monthly(3, 3, 150, { newest: [2024, 11], prefix: 'bill' });

      expect(viewsOf(detectRecurringSeries(ledgerOf(rows), nowOf()))).toEqual(
        expectedViewsOf([
          monthlySeries(3, 3, { isStopped: true, quiet: quietAt(at(2024, 11, 3)) }),
        ]),
      );
    });

    it('drops a series whose last charge is a day outside the bound', () => {
      const rows = monthly(3, 2, 150, { newest: [2024, 11], prefix: 'bill' });

      expect(detectRecurringSeries(ledgerOf(rows), nowOf())).toEqual([]);
    });
  });

  describe('the twin fold', () => {
    const sourceRows = (sources: readonly LedgerRow['source'][]): LedgerRow[] =>
      sources.flatMap((source) => monthly(6, 2, 250, { prefix: source, source }));

    it.each<[string, LedgerRow['source'][], string]>([
      ['synced over manual over import', ['import', 'manual', 'monobank'], 'monobank'],
      ['manual over import', ['import', 'manual'], 'manual'],
      ['synced over manual', ['manual', 'monobank'], 'monobank'],
      ['synced over import', ['import', 'monobank'], 'monobank'],
      ['the source name between two synced sources', ['monobank', 'btc_wallet'], 'btc_wallet'],
    ])('keeps %s, newest first, and leaves the folded rows out', (_title, sources, kept) => {
      const result = detectRecurringSeries(ledgerOf(sourceRows(sources)), nowOf());

      expect(result.map(({ chargeIds }) => chargeIds)).toEqual([
        rangeOf(0, 6).map((index) => `${kept}-${index}`),
      ]);
    });

    it('keeps two rows of one source on one day as two charges', () => {
      const rows = [
        ...monthly(6, 2, 250, { prefix: 'bill' }),
        chargeOf('bill-double', at(2026, 10, 2, 10, 31), 250),
      ];
      const result = detectRecurringSeries(ledgerOf(rows), nowOf());

      expect(result.map(({ chargeIds }) => chargeIds.length)).toEqual([7]);
      expect(result[0]?.chargeIds.slice(0, 2)).toEqual(['bill-double', 'bill-0']);
    });
  });

  describe('one merchant under spellings that normalize alike', () => {
    // The first list holds a decomposed accent, a no-break space and a capital letter; the second
    // a final sigma against a capital one.
    it.each<[string, string[]]>([
      [
        'accents, no-break spaces and case',
        ['Café Plus', 'Café Plus', 'Café Plus', 'CAFÉ PLUS', ' Café  Plus '],
      ],
      ['a final sigma', ['ΟΔΥΣΣΕΥΣ', 'Οδυσσευς', 'οδυσσευς']],
    ])('gives %s one series and one name in any row order', (_title, spellings) => {
      const keys = new Set(spellings.map((spelling) => merchantNameOf(spelling).key));
      const rows = monthly(10, 5, 120, {
        prefix: 'cafe',
        descriptionOf: (index) => spellings[index % spellings.length],
      });
      const name = smallestSpelling(rows.map(({ description }) => merchantSpellingOf(description)));

      expect(keys.size).toBe(1);
      expect(rows.map(({ description }) => tidiedNameOf(description))).toContain(name);

      for (const ordered of [rows, [...rows].reverse()]) {
        const result = detectRecurringSeries(ledgerOf(ordered), nowOf());

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name, merchantKey: [...keys][0] });
        expect(result[0]?.chargeIds).toHaveLength(10);
      }
    });
  });

  describe('the merchant key the hide list stores', () => {
    // These keys are stored in settings.recurringMerchantChoices. If merchantNameOf changes, a
    // stored key may match nothing, so the series shows again and the old line stays in "Hidden"
    // to clear; or it may match more, so the extra series is hidden and "Hidden" names it. No
    // migration rewrites keys. A failure here shows the author of the change this consequence.
    it.each<[string, string, string, string, string]>([
      ['Netflix', 'Netflix', 'Netflix', 'netflix', 'Netflix'],
      ['ATB 0212', 'ATB 0212', 'ATB 0340', 'atb', 'ATB'],
      ['Silpo Market 12', 'Silpo Market 12', 'Silpo Market 340', 'silpo market', 'Silpo Market'],
    ])('keys %s by its real key and names it', (_title, first, second, key, name) => {
      const rows = monthly(8, 6, 150, {
        prefix: 'shop',
        descriptionOf: (index) => (index % 2 === 0 ? first : second),
      });
      const result = detectRecurringSeries(ledgerOf(rows), nowOf());

      expect(merchantNameOf(first).key).toBe(key);
      expect(merchantNameOf(second).key).toBe(key);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ merchantKey: key, name });
    });

    it('lists the charges of a series newest first', () => {
      const result = detectRecurringSeries(
        ledgerOf(monthly(6, 5, 199, { prefix: 'netflix' })),
        nowOf(),
      );

      expect(result.map(({ chargeIds }) => chargeIds)).toEqual([
        rangeOf(0, 6).map((index) => `netflix-${index}`),
      ]);
    });
  });

  describe('over random ledgers', () => {
    const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + 1);
    const SEEDS = sweep(FULL_SEEDS);
    const MIN_SERIES_PER_SEED = 1;
    const MIN_FOLD_BUCKETS_PER_SEED = 1;

    const worlds = SEEDS.map((seed) => ({
      seed,
      ledger: randomLedgerOf(seededRandom(seed * SEED_SPREAD)),
    }));
    const resultsOf = (): RecurringSeries[][] =>
      worlds.map(({ ledger }) => detectRecurringSeries(ledger, nowOf()));
    const todayKey = dayKeyOf(nowOf());

    it('finds series in worlds that differ', () => {
      expect(new Set(worlds.map(({ ledger }) => ledger.rows.length)).size).toBeGreaterThan(1);
      expect(resultsOf().flat().length).toBeGreaterThanOrEqual(SEEDS.length * MIN_SERIES_PER_SEED);
    });

    it('gives a deep-equal result for any row order', () => {
      const results = resultsOf();

      for (const [index, { seed, ledger }] of worlds.entries()) {
        for (const rows of [
          [...ledger.rows].reverse(),
          shuffled(ledger.rows, seededRandom(seed * SEED_SPREAD)),
        ]) {
          expect(detectRecurringSeries({ ...ledger, rows }, nowOf())).toEqual(results[index]);
        }
      }
    });

    it('puts no time of a later local day than today in its output', () => {
      const results = resultsOf();

      for (const [index, { ledger }] of worlds.entries()) {
        const sides = ledger.rows.map(({ time }) => Math.sign(dayKeyOf(time) - todayKey));
        const outputKeys = (results[index] ?? []).flatMap(timesOf).map(dayKeyOf);

        expect(sides).toEqual(expect.arrayContaining([-1, 0, 1]));
        expect(outputKeys.filter((key) => key > todayKey)).toEqual([]);
      }
    });

    it('gives one result for any instant of the local day', () => {
      const results = resultsOf();
      const lastInstant = new Date(2026, 10, 3, 23, 59, 59, 999).getTime();

      for (const [index, { ledger }] of worlds.entries()) {
        for (const now of [at(2026, 11, 3, 0, 0), lastInstant]) {
          expect(detectRecurringSeries(ledger, now)).toEqual(results[index]);
        }
      }
    });

    it('shares no charge between two series', () => {
      for (const result of resultsOf()) {
        const ids = result.flatMap(({ chargeIds }) => chargeIds);

        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('keeps the charges of a series in one currency', () => {
      const results = resultsOf();

      for (const [index, { ledger }] of worlds.entries()) {
        const currencyOfHolding = new Map(
          ledger.holdings.map(({ id, currency }) => [id, currency]),
        );
        const holdingOfRow = new Map(ledger.rows.map(({ id, holdingId }) => [id, holdingId]));

        for (const series of results[index] ?? []) {
          const currencies = series.chargeIds.map((id) =>
            currencyOfHolding.get(holdingOfRow.get(id) ?? ''),
          );

          expect(new Set(currencies)).toEqual(new Set([series.currency]));
        }
      }
    });

    // A bucket with a same-amount row a day away is skipped: a fold may pair across one day.
    it('never leaves fewer charges on a day and amount than the largest count of one source', () => {
      const results = resultsOf();
      const buckets = worlds.flatMap(({ ledger }, index) =>
        (results[index] ?? []).flatMap((series) => foldBucketsOf(ledger, series)),
      );

      expect(buckets.filter(({ kept, largestOfOneSource }) => kept < largestOfOneSource)).toEqual(
        [],
      );
      expect(buckets.length).toBeGreaterThanOrEqual(SEEDS.length * MIN_FOLD_BUCKETS_PER_SEED);
    });
  });
});
