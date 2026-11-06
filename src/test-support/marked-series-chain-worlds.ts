import {
  at,
  monthly,
  ledgerOf,
  chargeOf,
  holdingOf,
  type Ledger,
  type LedgerRow,
  type ExpectedSeries,
} from './recurring-ledger';
import {
  chain,
  onDay,
  onDate,
  series,
  marked,
  detected,
  chargesAt,
  MARKED_LINE,
  type MarkedWorld,
} from './marked-series-worlds';

const APPLE = { description: 'Apple' };
const PURCHASE_DAYS = [3, 9, 17, 22, 28, 2, 11, 19, 25, 7, 13, 21, 27, 1, 16];
const NEAR_PRICE_AMOUNTS = [89, 109, 119, 399, 29];

// A rise past 25 percent: 130 for the newest three charges, else 100, on the 7th.
const riseRows = (): LedgerRow[] => monthly(8, 7, (index) => (index < 3 ? 130 : 100));

const bridgeRow = (): LedgerRow => chargeOf('bridge-0', at(2026, 2, 7), 115);

const purchasesOf = (amounts: readonly number[]): LedgerRow[] =>
  monthly(15, 1, (index) => amounts[index % amounts.length] ?? 0, {
    ...APPLE,
    prefix: 'purchase',
    dayOf: (index) => PURCHASE_DAYS[index] ?? 1,
  });

const oneOffsOf = (): LedgerRow[] => [
  chargeOf('one-off-0', at(2026, 3, 2), 4500, APPLE),
  chargeOf('one-off-1', at(2026, 5, 22), 1200, APPLE),
  chargeOf('one-off-2', at(2026, 8, 1), 7000, APPLE),
];

const twoApples = (secondAmount: number): Ledger =>
  ledgerOf([
    ...monthly(10, 5, 99, { ...APPLE, prefix: 'a' }),
    ...monthly(10, 20, secondAmount, { ...APPLE, prefix: 'b' }),
  ]);

const APPLES_DETECTED: ExpectedSeries[] = [
  series('monthly', 10, onDay(5), { from: 'a' }),
  series('monthly', 10, onDay(20), { from: 'b' }),
];

const usdExtras = { holdings: [holdingOf('usd', 'USD')] };

/** Worlds whose rows hold several amounts under one name, or none at the stored amount. */
export const AMOUNT_CHAIN_WORLDS: readonly MarkedWorld[] = [
  {
    title: 'a chain stays together, marked at its first amount',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 8, 15, 100],
          [2026, 9, 15, 120],
          [2026, 10, 15, 144],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 3, onDay(15))],
    shown: [marked('monthly', 3, onDay(15))],
  },
  {
    title: 'a chain stays together, marked at its last amount',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 8, 15, 100],
          [2026, 9, 15, 120],
          [2026, 10, 15, 144],
        ]),
      ),
    marks: [['monthly', 144]],
    noEntry: [series('monthly', 3, onDay(15))],
    shown: [marked('monthly', 3, onDay(15))],
  },
  {
    title: 'a rise of exactly 1.25 joins',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 100],
          [2026, 10, 15, 125],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'a rise past 1.25 cuts',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 100],
          [2026, 10, 15, 126],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { isStopped: true, lastCharge: at(2026, 9, 15) })],
  },
  {
    title: 'a rise over 25 percent, marked at the old price',
    ledger: () => ledgerOf(riseRows()),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 8, onDay(7))],
    shown: [
      marked('monthly', 5, onDay(7), {
        isStopped: true,
        lastCharge: at(2026, 7, 7),
        lastAmount: 100,
      }),
    ],
  },
  {
    title: 'a rise over 25 percent, marked at the new price',
    ledger: () => ledgerOf(riseRows()),
    marks: [['monthly', 130]],
    noEntry: [series('monthly', 8, onDay(7))],
    shown: [marked('monthly', 3, onDay(7), { lastCharge: at(2026, 10, 7), lastAmount: 130 })],
  },
  {
    title: 'a re-mark after a rise gives two series that share no row',
    ledger: () => ledgerOf(riseRows()),
    marks: [
      ['monthly', 100],
      ['monthly', 130],
    ],
    noEntry: [series('monthly', 8, onDay(7))],
    shown: [
      marked('monthly', 5, onDay(7), { isStopped: true, markAmounts: [10_000] }),
      marked('monthly', 3, onDay(7), { markAmounts: [13_000] }),
    ],
  },
  {
    title: 'a later row bridges the rise',
    ledger: () => ledgerOf([...riseRows(), bridgeRow()]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 9, onDay(7))],
    shown: [marked('monthly', 9, onDay(7))],
  },
  {
    title: 'two marks in one piece take the lowest stored amount period',
    ledger: () => ledgerOf([...riseRows(), bridgeRow()]),
    marks: [
      ['monthly', 100],
      ['everyThreeMonths', 130],
    ],
    noEntry: [series('monthly', 9, onDay(7))],
    shown: [marked('monthly', 9, onDay(7), { markAmounts: [10_000, 13_000] })],
  },
  {
    title: 'two marks in two pieces without the bridging row',
    ledger: () => ledgerOf(riseRows()),
    marks: [
      ['monthly', 100],
      ['everyThreeMonths', 130],
    ],
    noEntry: [series('monthly', 8, onDay(7))],
    shown: [
      marked('monthly', 5, onDay(7), { isStopped: true }),
      marked('everyThreeMonths', 3, MARKED_LINE),
    ],
  },
  {
    title: 'stored amounts share one cut',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 80],
          [2026, 10, 15, 120],
        ]),
      ),
    marks: [
      ['monthly', 100],
      ['yearly', 150],
    ],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE, { markAmounts: [10_000, 15_000] })],
  },
  {
    title: 'two chains, one marked',
    ledger: () => twoApples(399),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(5), { from: 'a' }),
      detected('monthly', 10, onDay(20), { from: 'b' }),
    ],
  },
  {
    title: 'two chains, both marked',
    ledger: () => twoApples(399),
    name: 'Apple',
    marks: [
      ['monthly', 99],
      ['monthly', 399],
    ],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(5), { from: 'a' }),
      marked('monthly', 10, onDay(20), { from: 'b' }),
    ],
  },
  {
    title: 'two detected series in one chain, marked at the lower price',
    ledger: () => twoApples(119),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(5), { from: 'a' }),
      detected('monthly', 10, onDay(20), { from: 'b' }),
    ],
  },
  {
    title: 'two detected series in one chain, marked at the higher price',
    ledger: () => twoApples(119),
    name: 'Apple',
    marks: [['monthly', 119]],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(20), { from: 'b' }),
      detected('monthly', 10, onDay(5), { from: 'a' }),
    ],
  },
  {
    // Every key ties, so the newest charge, on the 20th, sets the rhythm and the 5th shares a slot.
    title: 'two detected series at one price',
    ledger: () => twoApples(99),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(20), { from: 'b' }),
      detected('monthly', 10, onDay(5), { from: 'a' }),
    ],
  },
  {
    title: 'a marked yearly beside a detected monthly',
    ledger: () =>
      ledgerOf([
        ...monthly(24, 5, 99, { ...APPLE, prefix: 'month' }),
        chargeOf('year-0', at(2026, 3, 12), 999, APPLE),
        chargeOf('year-1', at(2025, 3, 12), 999, APPLE),
      ]),
    name: 'Apple',
    marks: [['yearly', 999]],
    noEntry: [
      series('monthly', 24, onDay(5), { from: 'month' }),
      series('yearly', 2, onDate(3, 12), { from: 'year' }),
    ],
    shown: [
      marked('yearly', 2, onDate(3, 12), { from: 'year' }),
      detected('monthly', 24, onDay(5), { from: 'month' }),
    ],
  },
  {
    title: 'rarer one-offs stay out of the chain',
    ledger: () => ledgerOf([...monthly(12, 14, 99, { ...APPLE, prefix: 'apple' }), ...oneOffsOf()]),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: [series('monthly', 12, onDay(14))],
    shown: [marked('monthly', 12, onDay(14))],
  },
  {
    title: 'a later purchase is not the last charge',
    ledger: () =>
      ledgerOf([
        ...monthly(12, 14, 99, { ...APPLE, prefix: 'apple' }),
        ...oneOffsOf(),
        chargeOf('one-off-3', at(2026, 11, 1), 4500, APPLE),
      ]),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: [series('monthly', 12, onDay(14))],
    shown: [marked('monthly', 12, onDay(14), { lastCharge: at(2026, 10, 14), lastAmount: 99 })],
  },
  {
    title: 'cancelled while purchases go on',
    ledger: () =>
      ledgerOf([
        ...monthly(12, 14, 99, { ...APPLE, prefix: 'apple', without: [0, 1, 2, 3] }),
        chargeOf('one-off-0', at(2026, 10, 28), 4500, APPLE),
        chargeOf('one-off-1', at(2026, 10, 30), 7000, APPLE),
      ]),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: [series('monthly', 8, onDay(14), { isStopped: true })],
    shown: [marked('monthly', 8, onDay(14), { isStopped: true, lastCharge: at(2026, 6, 14) })],
  },
  {
    title: 'purchases in reach link',
    ledger: () =>
      ledgerOf([
        ...monthly(12, 5, 99, { ...APPLE, prefix: 'apple' }),
        ...purchasesOf(NEAR_PRICE_AMOUNTS),
      ]),
    name: 'Apple',
    marks: [['monthly', 99]],
    noEntry: [series('monthly', 12, onDay(5))],
    shown: [marked('monthly', 12, onDay(5), { lastCharge: at(2026, 10, 5), lastAmount: 99 })],
  },
  {
    title: 'the same digits in two currencies',
    ledger: () =>
      ledgerOf(
        [
          ...monthly(1, 3, 400, { holdingId: 'usd', prefix: 'usd' }),
          ...monthly(1, 3, 400, { prefix: 'uah' }),
        ],
        usdExtras,
      ),
    marks: [['monthly', 400]],
    noEntry: [],
    shown: [marked('monthly', 1, MARKED_LINE, { from: 'uah' })],
  },
  {
    title: 'two currencies, one marked',
    ledger: () =>
      ledgerOf(
        [
          ...monthly(6, 3, 10, { holdingId: 'usd', prefix: 'usd' }),
          ...monthly(6, 3, 400, { prefix: 'uah' }),
        ],
        usdExtras,
      ),
    marks: [['monthly', 400]],
    noEntry: [
      series('monthly', 6, onDay(3), { from: 'uah' }),
      series('monthly', 6, onDay(3), { from: 'usd', currency: 'USD' }),
    ],
    shown: [
      marked('monthly', 6, onDay(3), { from: 'uah' }),
      detected('monthly', 6, onDay(3), { from: 'usd', currency: 'USD' }),
    ],
  },
  {
    title: 'two currencies, both marked',
    ledger: () =>
      ledgerOf(
        [
          ...monthly(1, 3, 10, { holdingId: 'usd', prefix: 'usd' }),
          ...monthly(1, 3, 400, { prefix: 'uah' }),
        ],
        usdExtras,
      ),
    marks: [
      ['monthly', 10, 'USD'],
      ['monthly', 400],
    ],
    noEntry: [],
    shown: [
      marked('monthly', 1, MARKED_LINE, { from: 'uah' }),
      marked('monthly', 1, MARKED_LINE, { from: 'usd', currency: 'USD' }),
    ],
  },
  {
    title: 'the marked row deleted',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 120],
          [2026, 10, 15, 144],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'the marked row edited out of reach',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 8, 15, 500],
          [2026, 9, 15, 120],
          [2026, 10, 15, 144],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 3, onDay(15))],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'a stored amount bridges, its row deleted',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 99],
          [2026, 10, 15, 130],
        ]),
      ),
    marks: [['monthly', 115]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'a stored amount bridges, its row edited',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 8, 15, 80],
          [2026, 9, 15, 120],
          [2026, 10, 15, 500],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE, { isStopped: true, lastCharge: at(2026, 9, 15) })],
  },
  {
    title: 'a hold settled at another amount',
    ledger: () =>
      ledgerOf(
        chargesAt('chain', [
          [2026, 9, 15, 800],
          [2026, 10, 15, 838],
        ]),
      ),
    marks: [['monthly', 835]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE)],
  },
  {
    title: 'nothing in reach',
    ledger: () => ledgerOf(monthly(6, 3, 700)),
    marks: [['monthly', 400]],
    noEntry: [series('monthly', 6, onDay(3))],
    shown: [detected('monthly', 6, onDay(3))],
    withoutCharges: [chain('monthly', 400)],
  },
  {
    title: 'no rows, two marks in one piece',
    ledger: () => ledgerOf([]),
    marks: [
      ['monthly', 100],
      ['yearly', 120],
    ],
    noEntry: [],
    shown: [],
    withoutCharges: [chain('monthly', 100, 120)],
  },
  {
    title: 'no rows, two pieces',
    ledger: () => ledgerOf([]),
    marks: [
      ['monthly', 100],
      ['yearly', 400],
    ],
    noEntry: [],
    shown: [],
    withoutCharges: [chain('monthly', 100), chain('yearly', 400)],
  },
  {
    title: 'a credit at the stored amount',
    ledger: () =>
      ledgerOf([
        ...monthly(3, 3, -500, { prefix: 'credit' }),
        ...monthly(3, 3, 900, { prefix: 'debit' }),
      ]),
    marks: [['monthly', 500]],
    noEntry: [series('monthly', 3, onDay(3), { from: 'debit' })],
    shown: [detected('monthly', 3, onDay(3), { from: 'debit' })],
    withoutCharges: [chain('monthly', 500)],
  },
  {
    title: 'a 98 and a 102 in a month of a marked 100',
    ledger: () =>
      ledgerOf([
        ...monthly(6, 5, 100),
        chargeOf('extra-aug', at(2026, 8, 20), 98),
        chargeOf('extra-oct', at(2026, 10, 12), 102),
      ]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: [
      marked('monthly', 6, onDay(5), {
        from: 'charge',
        lastCharge: at(2026, 10, 5),
        lastAmount: 100,
      }),
    ],
    dropped: { rowIds: ['extra-aug', 'extra-oct'], reads: { kind: 'none' }, paidSoFar: 600 },
  },
  {
    title: 'twelve marked 100 and a 98 in one of their months',
    ledger: () => ledgerOf([...monthly(12, 5, 100), chargeOf('extra-aug', at(2026, 8, 20), 98)]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 13, onDay(5), { from: 'charge+extra' })],
    shown: [marked('monthly', 12, onDay(5), { from: 'charge', lastAmount: 100 })],
    dropped: { rowIds: ['extra-aug'], reads: { kind: 'none' }, paidSoFar: 1200 },
  },
  {
    title: 'a 100 on the 20th of the newest month beside three on the 5th',
    ledger: () => ledgerOf([...monthly(3, 5, 100), chargeOf('extra-oct', at(2026, 10, 20), 100)]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 3, onDay(5), { from: 'charge' })],
    shown: [
      marked('monthly', 3, onDay(5), {
        from: 'charge',
        lastCharge: at(2026, 10, 5),
        lastAmount: 100,
      }),
    ],
    dropped: { rowIds: ['extra-oct'], reads: { kind: 'none' }, paidSoFar: 300 },
  },
  {
    title: 'a second subscription at 98 on the 20th beside a marked 100 on the 5th',
    ledger: () => ledgerOf([...monthly(12, 5, 100), ...monthly(12, 20, 98, { prefix: 'extra' })]),
    marks: [['monthly', 100]],
    noEntry: [
      series('monthly', 12, onDay(5), { from: 'charge' }),
      series('monthly', 12, onDay(20), { from: 'extra' }),
    ],
    shown: [
      marked('monthly', 12, onDay(5), { from: 'charge', lastAmount: 100 }),
      detected('monthly', 12, onDay(20), { from: 'extra', lastAmount: 98 }),
    ],
    dropped: {
      rowIds: Array.from({ length: 12 }, (_unused, index) => `extra-${index}`),
      reads: { kind: 'detected', period: 'monthly' },
      paidSoFar: 1200,
    },
  },
  {
    title: 'a due date drifting at a month end keeps every charge',
    ledger: () =>
      ledgerOf(
        chargesAt('bill', [
          [2026, 6, 30, 100],
          [2026, 7, 31, 100],
          [2026, 9, 1, 100],
          [2026, 9, 30, 100],
          [2026, 10, 31, 100],
        ]),
      ),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 5)],
    shown: [marked('monthly', 5, MARKED_LINE, { lastCharge: at(2026, 10, 31) })],
  },
];
