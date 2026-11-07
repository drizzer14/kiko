import {
  type ChargeGroups,
  type RecurringMark,
  type seriesOfGroups,
  chargeGroupsOf,
  groupKeyOf,
} from '@kiko/recurring/detection';
import {
  at,
  nowOf,
  weekly,
  monthly,
  ledgerOf,
  chargeOf,
  holdingOf,
  type Ledger,
} from '@kiko/test-support/recurring-ledger';
import type { Currency } from '@kiko/currency/currency';
import type { RecurringMerchantChoice } from '@kiko/settings';
import { entryOf, type MarkSpec } from '@kiko/test-support/marked-series-world';

import { type RowRecurrence, rowRecurrenceOf } from './row-recurrence';

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;
type Where = { key?: string; currency?: Currency };
type Entry = { name: string; marks?: MarkSpec[]; isHidden?: boolean };

const seriesCalls: ChargeGroups[] = [];

jest.mock('@kiko/recurring/detection', () => {
  const actual = jest.requireActual('@kiko/recurring/detection') as {
    seriesOfGroups: typeof seriesOfGroups;
  };

  return {
    ...actual,
    seriesOfGroups: (...args: Parameters<typeof seriesOfGroups>) => {
      seriesCalls.push(args[0]);

      return actual.seriesOfGroups(...args);
    },
  };
});

beforeEach(() => {
  seriesCalls.length = 0;
});

const NOW = nowOf();
const NO_CHOICES: Choices = new Map();
const NETFLIX_HIDDEN: Entry = { name: 'Netflix', isHidden: true };
const YEARLY_MARK_AT_999: RecurringMark = {
  currency: 'UAH',
  amountMinorUnits: 999,
  period: 'yearly',
};

const choicesOf = (entries: Record<string, Entry>): Choices =>
  new Map(
    Object.entries(entries).map(
      ([key, { name, marks = [], isHidden = false }]): [string, RecurringMerchantChoice] => [
        key,
        {
          name,
          ...(isHidden ? { hidden: true as const } : {}),
          ...(marks.length > 0 ? { marks: [...entryOf(name, marks).marks] } : {}),
        },
      ],
    ),
  );

const recurrenceOf = (
  ledger: Ledger,
  rowId: string,
  choices: Choices = NO_CHOICES,
  { key = 'netflix', currency = 'UAH' }: Where = {},
): RowRecurrence =>
  rowRecurrenceOf({
    chargeGroups: chargeGroupsOf(ledger, NOW),
    key,
    currency,
    rowId,
    choices,
    today: NOW,
  });

// A yearly mark keeps charges more than 182.6 days apart. Six monthly charges and the five 100s
// of RISE span under that, so the amounts tie and the newest stays; ten Apple 99s span 273 days,
// so the oldest and the newest both stay.
const KEPT_YEARLY_ROW = 'charge-0';
const DROPPED_YEARLY_ROW = 'charge-2';
const APPLE_KEPT_YEARLY_ROW = 'cheap-0';
const RISE_KEPT_YEARLY_ROW = 'rise-3';

const MONTHLY = ledgerOf(monthly(6, 15, 9.99));
const WEEKLY = ledgerOf(weekly(8, [2026, 10, 30], 150, { description: 'Gym' }));
const YEARLY = ledgerOf([
  chargeOf('visit-0', at(2026, 4, 14), 2100, { description: 'Clinic' }),
  chargeOf('visit-1', at(2025, 4, 10), 2000, { description: 'Clinic' }),
]);
const OUTLIER = ledgerOf([...monthly(6, 15, 9.99), chargeOf('outlier', at(2026, 9, 20), 500)]);
// 130 for the newest three and 100 before: a rise past 25 percent cuts the chain at 100.
const RISE = ledgerOf(monthly(8, 7, (index) => (index < 3 ? 130 : 100), { prefix: 'rise' }));
const APPLE_TWO_PRICES = ledgerOf([
  ...monthly(10, 5, 99, { description: 'Apple', prefix: 'cheap' }),
  ...monthly(10, 20, 399, { description: 'Apple', prefix: 'dear' }),
]);
const TWO_CURRENCIES = ledgerOf(
  [
    ...monthly(6, 3, 400, { prefix: 'uah' }),
    ...monthly(6, 3, 400, { prefix: 'usd', holdingId: 'usd' }),
  ],
  { holdings: [holdingOf('usd', 'USD')] },
);

describe('rowRecurrenceOf on a detected series', () => {
  it.each([
    ['monthly', MONTHLY, 'charge-0', {}],
    ['monthly', MONTHLY, 'charge-5', {}],
    ['weekly', WEEKLY, 'charge-3', { key: 'gym' }],
    ['yearly', YEARLY, 'visit-1', { key: 'clinic' }],
  ] as [string, Ledger, string, Where][])(
    'gives %s to row %#, the series it is in',
    (period, ledger, rowId, where) => {
      expect(recurrenceOf(ledger, rowId, NO_CHOICES, where)).toEqual({ kind: 'detected', period });
    },
  );

  it('gives none to a row of the group outside the found series', () => {
    expect(recurrenceOf(OUTLIER, 'charge-0')).toEqual({ kind: 'detected', period: 'monthly' });
    expect(recurrenceOf(OUTLIER, 'outlier')).toEqual({ kind: 'none' });
  });

  it('gives none to a row that is in no group', () => {
    expect(recurrenceOf(MONTHLY, 'not-a-row')).toEqual({ kind: 'none' });
  });

  it('reads the group of the key it is asked for, not another name', () => {
    expect(recurrenceOf(WEEKLY, 'charge-3', NO_CHOICES, { key: 'netflix' })).toEqual({
      kind: 'none',
    });
  });
});

describe('rowRecurrenceOf on a hidden key', () => {
  it('gives none to a row of a detected series', () => {
    expect(recurrenceOf(MONTHLY, 'charge-0', choicesOf({ netflix: NETFLIX_HIDDEN }))).toEqual({
      kind: 'none',
    });
  });

  it('hides only its own key', () => {
    const choices = choicesOf({ netflix: NETFLIX_HIDDEN });

    expect(recurrenceOf(WEEKLY, 'charge-3', choices, { key: 'gym' })).toEqual({
      kind: 'detected',
      period: 'weekly',
    });
  });

  it('still gives the marked period to a row in a marked chain: a hide affects detected series only', () => {
    const choices = choicesOf({ netflix: { ...NETFLIX_HIDDEN, marks: [['yearly', 9.99]] } });

    expect(recurrenceOf(MONTHLY, KEPT_YEARLY_ROW, choices)).toEqual({
      kind: 'marked',
      period: 'yearly',
      marks: [YEARLY_MARK_AT_999],
    });
  });

  it('gives none to the detected row beside the marked chain of a hidden key', () => {
    const choices = choicesOf({
      apple: { name: 'Apple', isHidden: true, marks: [['yearly', 99]] },
    });
    const apple = { key: 'apple' };

    expect(recurrenceOf(APPLE_TWO_PRICES, APPLE_KEPT_YEARLY_ROW, choices, apple).kind).toBe(
      'marked',
    );
    expect(recurrenceOf(APPLE_TWO_PRICES, 'dear-0', choices, apple)).toEqual({ kind: 'none' });
  });
});

describe('rowRecurrenceOf on a marked chain', () => {
  it('gives the marked period, with the marks of the chain, to a row it holds', () => {
    const choices = choicesOf({ netflix: { name: 'Netflix', marks: [['yearly', 9.99]] } });

    expect(recurrenceOf(MONTHLY, KEPT_YEARLY_ROW, choices)).toEqual({
      kind: 'marked',
      period: 'yearly',
      marks: [YEARLY_MARK_AT_999],
    });
  });

  it('gives none to a row its chain drops: one charge per period slot', () => {
    const choices = choicesOf({ netflix: { name: 'Netflix', marks: [['yearly', 9.99]] } });

    expect(recurrenceOf(MONTHLY, DROPPED_YEARLY_ROW, choices)).toEqual({ kind: 'none' });
  });

  it('gives the marked period on the shared row and none on the other rows of the detected series it removes', () => {
    const choices = choicesOf({ netflix: { name: 'Netflix', marks: [['yearly', 100]] } });

    expect(recurrenceOf(RISE, RISE_KEPT_YEARLY_ROW, choices)).toMatchObject({
      kind: 'marked',
      period: 'yearly',
    });
    expect(recurrenceOf(RISE, 'rise-0', choices)).toEqual({ kind: 'none' });
    expect(recurrenceOf(RISE, 'rise-0')).toEqual({ kind: 'detected', period: 'monthly' });
  });

  it('keeps Apple 399 detected beside a marked Apple 99', () => {
    const choices = choicesOf({ apple: { name: 'Apple', marks: [['yearly', 99]] } });
    const apple = { key: 'apple' };

    expect(recurrenceOf(APPLE_TWO_PRICES, 'dear-3', choices, apple)).toEqual({
      kind: 'detected',
      period: 'monthly',
    });
    expect(recurrenceOf(APPLE_TWO_PRICES, APPLE_KEPT_YEARLY_ROW, choices, apple)).toMatchObject({
      kind: 'marked',
      period: 'yearly',
    });
  });
});

describe('rowRecurrenceOf across currencies', () => {
  const DOLLARS: Where = { currency: 'USD' };

  it('reads each currency group on its own', () => {
    expect(recurrenceOf(TWO_CURRENCIES, 'uah-0')).toEqual({ kind: 'detected', period: 'monthly' });
    expect(recurrenceOf(TWO_CURRENCIES, 'usd-0', NO_CHOICES, DOLLARS)).toEqual({
      kind: 'detected',
      period: 'monthly',
    });
  });

  it('gives none to a row asked under the other currency', () => {
    expect(recurrenceOf(TWO_CURRENCIES, 'usd-0')).toEqual({ kind: 'none' });
  });

  it('lets a mark in hryvnias reach no dollar row of the same digits', () => {
    const choices = choicesOf({ netflix: { name: 'Netflix', marks: [['yearly', 400, 'UAH']] } });

    expect(recurrenceOf(TWO_CURRENCIES, 'uah-0', choices)).toMatchObject({
      kind: 'marked',
      period: 'yearly',
    });
    expect(recurrenceOf(TWO_CURRENCIES, 'usd-0', choices, DOLLARS)).toEqual({
      kind: 'detected',
      period: 'monthly',
    });
  });

  it('lets a mark in dollars reach no hryvnia row of the same digits', () => {
    const choices = choicesOf({ netflix: { name: 'Netflix', marks: [['yearly', 400, 'USD']] } });

    expect(recurrenceOf(TWO_CURRENCIES, 'usd-0', choices, DOLLARS)).toMatchObject({
      kind: 'marked',
      period: 'yearly',
    });
    expect(recurrenceOf(TWO_CURRENCIES, 'uah-0', choices)).toEqual({
      kind: 'detected',
      period: 'monthly',
    });
  });

  it('lets one hide cover both currencies of the key', () => {
    const choices = choicesOf({ netflix: NETFLIX_HIDDEN });

    expect(recurrenceOf(TWO_CURRENCIES, 'usd-0', choices, DOLLARS)).toEqual({ kind: 'none' });
    expect(recurrenceOf(TWO_CURRENCIES, 'uah-0', choices)).toEqual({ kind: 'none' });
  });
});

describe('the work rowRecurrenceOf does', () => {
  it('runs the series rule once, on a map holding the group of the row alone', () => {
    const ledger = ledgerOf([
      ...monthly(6, 15, 9.99),
      ...monthly(6, 10, 150, { description: 'Apple' }),
    ]);
    const full = chargeGroupsOf(ledger, NOW);

    expect(full.groups.size).toBe(2);

    rowRecurrenceOf({
      chargeGroups: full,
      key: 'netflix',
      currency: 'UAH',
      rowId: 'charge-0',
      choices: NO_CHOICES,
      today: NOW,
    });

    expect(seriesCalls).toHaveLength(1);
    expect([...(seriesCalls[0]?.groups.keys() ?? [])]).toEqual([groupKeyOf('netflix', 'UAH')]);
    expect(seriesCalls[0]?.newestTimeByHoldingId).toEqual(full.newestTimeByHoldingId);
  });

  it('hands the series rule an empty map for a key the ledger does not hold', () => {
    recurrenceOf(MONTHLY, 'charge-0', NO_CHOICES, { key: 'nothing' });

    expect(seriesCalls.map(({ groups }) => groups.size)).toEqual([0]);
  });
});
