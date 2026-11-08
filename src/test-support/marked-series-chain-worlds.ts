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

// Six 100s on the 5th, May (charge-5) to Oct (charge-0), with a 98 on 20 Aug and a 102 on 12 Oct.
const worldARows = (): Ledger =>
  ledgerOf([
    ...monthly(6, 5, 100),
    chargeOf('extra-aug', at(2026, 8, 20), 98),
    chargeOf('extra-oct', at(2026, 10, 12), 102),
  ]);

const worldAShown = [
  marked('monthly', 6, onDay(5), { from: 'charge', lastCharge: at(2026, 10, 5), lastAmount: 100 }),
];

const NONE_READ = { kind: 'none' } as const;

// Three charges inside one month: the edges at their amounts, the middle one the row to tap.
const monthRows = (middleAmount: number, edgeAmounts: readonly [number, number]): Ledger =>
  ledgerOf(
    chargesAt('month', [
      [2026, 9, 1, edgeAmounts[0]],
      [2026, 9, 15, middleAmount],
      [2026, 9, 30, edgeAmounts[1]],
    ]),
  );

// A mark tapped on a row keeps that row in its series and drops the rows half a step or less from
// it. A mark without the id, or with an id no row holds, reads by the other keys alone.
const TAPPED_ROW_WORLDS: readonly MarkedWorld[] = [
  {
    title: 'world A marked at 102, tapped 12 Oct: the tapped row stays and 5 Oct drops',
    ledger: worldARows,
    marks: [['monthly', 102, 'UAH', 'extra-oct']],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: [
      marked('monthly', 6, onDay(5), {
        from: 'charge+extra',
        lastCharge: at(2026, 10, 12),
        lastAmount: 102,
      }),
    ],
    dropped: { rowIds: ['charge-0', 'extra-aug'], reads: NONE_READ, paidSoFar: 602 },
  },
  {
    title: 'world A marked at 98, tapped 20 Aug: the tapped row stays and 5 Aug drops',
    ledger: worldARows,
    marks: [['monthly', 98, 'UAH', 'extra-aug']],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: [
      marked('monthly', 6, MARKED_LINE, {
        from: 'charge+extra',
        lastCharge: at(2026, 10, 5),
        lastAmount: 100,
      }),
    ],
    dropped: { rowIds: ['charge-2', 'extra-oct'], reads: NONE_READ, paidSoFar: 598 },
  },
  {
    title: 'world A marked at 100, tapped a 100: the tapped row is kept already',
    ledger: worldARows,
    marks: [['monthly', 100, 'UAH', 'charge-3']],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: worldAShown,
    dropped: { rowIds: ['extra-aug', 'extra-oct'], reads: NONE_READ, paidSoFar: 600 },
  },
  {
    title: 'world A marked at 102, tapped a row that is gone: the id changes nothing',
    ledger: worldARows,
    marks: [['monthly', 102, 'UAH', 'deleted-row']],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: worldAShown,
    dropped: { rowIds: ['extra-aug', 'extra-oct'], reads: NONE_READ, paidSoFar: 600 },
  },
  {
    title: 'world A, 100 tapped 5 Oct and 102 tapped 12 Oct: 5 Oct stays, 12 Oct drops',
    ledger: worldARows,
    marks: [
      ['monthly', 100, 'UAH', 'charge-0'],
      ['monthly', 102, 'UAH', 'extra-oct'],
    ],
    noEntry: [series('monthly', 6, onDay(5), { from: 'charge' })],
    shown: worldAShown,
    dropped: { rowIds: ['extra-aug', 'extra-oct'], reads: NONE_READ, paidSoFar: 600 },
  },
  {
    title: 'an FX series, tapped 21 Sep: the tapped charge stays and 5 Oct drops',
    ledger: () =>
      ledgerOf(
        chargesAt('fx', [
          [2026, 4, 5, 412],
          [2026, 5, 5, 415],
          [2026, 6, 6, 410],
          [2026, 7, 5, 417],
          [2026, 8, 5, 413],
          [2026, 9, 21, 414],
          [2026, 10, 5, 415],
        ]),
      ),
    marks: [['monthly', 414, 'UAH', 'fx-5']],
    noEntry: [],
    shown: [
      marked('monthly', 6, onDay(5), {
        lastCharge: at(2026, 9, 21),
        lastAmount: 414,
        isStopped: true,
      }),
    ],
    dropped: { rowIds: ['fx-6'], reads: NONE_READ, paidSoFar: 2481 },
  },
  {
    title: 'a month with a 100, a 103 and a 100, marked 103 with no tapped row: the 103 drops',
    ledger: () => monthRows(103, [100, 100]),
    marks: [['monthly', 103]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE, { lastCharge: at(2026, 9, 30), lastAmount: 100 })],
    dropped: { rowIds: ['month-1'], reads: NONE_READ, paidSoFar: 200 },
  },
  {
    title: 'a month with a 100, a 103 and a 100, marked 103 tapped on the 103: it stays alone',
    ledger: () => monthRows(103, [100, 100]),
    marks: [['monthly', 103, 'UAH', 'month-1']],
    noEntry: [],
    shown: [
      marked('monthly', 1, MARKED_LINE, {
        lastCharge: at(2026, 9, 15),
        lastAmount: 103,
        isStopped: true,
      }),
    ],
    dropped: { rowIds: ['month-0', 'month-2'], reads: NONE_READ, paidSoFar: 103 },
  },
  {
    title: 'a month with a 101, a 100 and a 120, marked 100 with no tapped row: the 100 drops',
    ledger: () => monthRows(100, [101, 120]),
    marks: [['monthly', 100]],
    noEntry: [],
    shown: [marked('monthly', 2, MARKED_LINE, { lastCharge: at(2026, 9, 30), lastAmount: 120 })],
    dropped: { rowIds: ['month-1'], reads: NONE_READ, paidSoFar: 221 },
  },
  {
    title: 'a month with a 101, a 100 and a 120, marked 100 tapped on the 100: it stays alone',
    ledger: () => monthRows(100, [101, 120]),
    marks: [['monthly', 100, 'UAH', 'month-1']],
    noEntry: [],
    shown: [
      marked('monthly', 1, MARKED_LINE, {
        lastCharge: at(2026, 9, 15),
        lastAmount: 100,
        isStopped: true,
      }),
    ],
    dropped: { rowIds: ['month-0', 'month-2'], reads: NONE_READ, paidSoFar: 100 },
  },
  {
    title: 'two detected series at one price, marked at 99 tapped on a 5th: the fifths win',
    ledger: () => twoApples(99),
    name: 'Apple',
    marks: [['monthly', 99, 'UAH', 'a-4']],
    noEntry: APPLES_DETECTED,
    shown: [
      marked('monthly', 10, onDay(5), { from: 'a' }),
      detected('monthly', 10, onDay(20), { from: 'b' }),
    ],
  },
];

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
      marked('everyThreeMonths', 2, MARKED_LINE),
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
    title: 'a 98 and a 102 in a month of a marked 102: the tapped row drops',
    ledger: () =>
      ledgerOf([
        ...monthly(6, 5, 100),
        chargeOf('extra-aug', at(2026, 8, 20), 98),
        chargeOf('extra-oct', at(2026, 10, 12), 102),
      ]),
    marks: [['monthly', 102]],
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
  {
    title: 'a billing day moved from the 5th to the 20th keeps every charge',
    ledger: () =>
      ledgerOf([
        ...monthly(6, 5, 100, { prefix: 'early', newest: [2026, 4] }),
        ...monthly(6, 20, 100, { prefix: 'late' }),
      ]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 12)],
    shown: [
      marked('monthly', 12, onDay(20), {
        lastCharge: at(2026, 10, 20),
        lastAmount: 100,
      }),
    ],
  },
  {
    title: 'a billing day moved from the 20th to the 5th drops the 20th 15 days before it',
    ledger: () =>
      ledgerOf([
        ...monthly(6, 20, 100, { prefix: 'early', newest: [2026, 4] }),
        ...monthly(6, 5, 100, { prefix: 'late' }),
      ]),
    marks: [['monthly', 100]],
    noEntry: [series('monthly', 12)],
    shown: [
      marked('monthly', 11, onDay(5), {
        lastCharge: at(2026, 10, 5),
        lastAmount: 100,
      }),
    ],
    dropped: { rowIds: ['early-0'], reads: { kind: 'none' }, paidSoFar: 1100 },
  },
  ...[1150, 1385, 1099].map(
    (tapped): MarkedWorld => ({
      title: `seven bills 17 days apart and more all stay, marked at ${tapped}`,
      ledger: () =>
        ledgerOf(
          chargesAt('bill', [
            [2026, 4, 3, 1210],
            [2026, 5, 10, 1385],
            [2026, 6, 3, 1302],
            [2026, 7, 25, 1150],
            [2026, 8, 12, 1099],
            [2026, 9, 2, 1240],
            [2026, 10, 20, 1330],
          ]),
        ),
      marks: [['monthly', tapped]],
      noEntry: [],
      shown: [
        marked('monthly', 7, MARKED_LINE, { lastCharge: at(2026, 10, 20), lastAmount: 1330 }),
      ],
    }),
  ),
  {
    title: 'an FX series: the tapped charge 16 days late drops beside the next one on its day',
    ledger: () =>
      ledgerOf(
        chargesAt('fx', [
          [2026, 4, 5, 412],
          [2026, 5, 5, 415],
          [2026, 6, 6, 410],
          [2026, 7, 5, 417],
          [2026, 8, 5, 413],
          [2026, 9, 21, 414],
          [2026, 10, 5, 415],
        ]),
      ),
    marks: [['monthly', 414]],
    noEntry: [],
    shown: [marked('monthly', 6, onDay(5), { lastCharge: at(2026, 10, 5), lastAmount: 415 })],
    dropped: { rowIds: ['fx-5'], reads: { kind: 'none' }, paidSoFar: 2482 },
  },
  ...TAPPED_ROW_WORLDS,
];
