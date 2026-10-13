import { i18n } from '@kiko/i18n/init';
import type { TimeClock } from '@kiko/dates';
import { act } from '@testing-library/react-native';
import type { Currency } from '@kiko/currency/currency';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { ruleRows, ruleSummary } from './rule-summary';

const CLOCK_24: TimeClock = { uses24Hour: true };
const CLOCK_12: TimeClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };

const MINUTES_AT_18 = 18 * 60;

const formatAmount = (minorUnits: number, currency: Currency): string =>
  `${(minorUnits / 100).toFixed(2)} ${currency}`;

const rowsOf = (matchers: CategoryRuleMatcher[], clock: TimeClock = CLOCK_24) =>
  ruleRows(matchers, { t: i18n.t, clock, formatAmount });

const summaryOf = (matchers: CategoryRuleMatcher[], clock: TimeClock = CLOCK_24): string =>
  ruleSummary(rowsOf(matchers, clock));

describe('ruleRows', () => {
  it('gives one row per matcher, each with its subject, in the order they are stored', () => {
    expect(
      rowsOf([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        { type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 },
      ]).map(({ label, value }) => ({ label, value })),
    ).toEqual([
      { label: 'Name is', value: '"Silpo"' },
      { label: 'Type', value: 'Expense' },
      { label: 'Amount is more than', value: '500.00 UAH' },
      { label: 'Time is after', value: '18:00' },
    ]);
  });

  it('keeps the stored order when a time comes before a name', () => {
    expect(
      rowsOf([
        { type: 'time', operator: 'before', minuteOfDay: 9 * 60 },
        { type: 'nameStartsWith', text: 'Sil' },
      ]).map(({ label, value }) => ({ label, value })),
    ).toEqual([
      { label: 'Time is before', value: '09:00' },
      { label: 'Name starts with', value: '"Sil"' },
    ]);
  });

  it('gives every row a key of its own, even for two conditions of one kind', () => {
    const keys = rowsOf([
      { type: 'nameIs', text: 'Silpo' },
      { type: 'nameIs', text: 'Atb' },
      { type: 'amount', operator: 'gt', minorUnits: 100, currency: 'UAH' },
    ]).map((row) => row.key);

    expect(new Set(keys).size).toBe(3);
  });

  it('reads a time on the 12-hour clock with its mark', () => {
    expect(
      rowsOf([{ type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 }], CLOCK_12).map(
        (row) => row.value,
      ),
    ).toEqual(['6:00 PM']);
  });

  it.each([
    ['eq', 'Amount equals'],
    ['gt', 'Amount is more than'],
    ['gte', 'Amount is at least'],
    ['lt', 'Amount is less than'],
    ['lte', 'Amount is at most'],
  ] as const)('labels the %s amount operator %s', (operator, label) => {
    expect(
      rowsOf([{ type: 'amount', operator, minorUnits: 100, currency: 'USD' }]).map(
        ({ label: rowLabel, value }) => ({ label: rowLabel, value }),
      ),
    ).toEqual([{ label, value: '1.00 USD' }]);
  });

  it('labels both directions and both time operators', () => {
    expect(rowsOf([{ type: 'direction', direction: 'income' }]).map((row) => row.value)).toEqual([
      'Income',
    ]);
    expect(
      rowsOf([{ type: 'time', operator: 'before', minuteOfDay: 0 }]).map(
        ({ label, value }) => `${label} ${value}`,
      ),
    ).toEqual(['Time is before 00:00']);
    expect(
      rowsOf([{ type: 'time', operator: 'after', minuteOfDay: 1439 }]).map(
        ({ label, value }) => `${label} ${value}`,
      ),
    ).toEqual(['Time is after 23:59']);
  });

  it('hands the stored minor units and currency to the amount formatter untouched', () => {
    const received: [number, Currency][] = [];

    ruleRows([{ type: 'amount', operator: 'eq', minorUnits: 100000, currency: 'BTC' }], {
      t: i18n.t,
      clock: CLOCK_24,
      formatAmount: (minorUnits, currency) => {
        received.push([minorUnits, currency]);

        return '0.00100000 BTC';
      },
    });

    expect(received).toEqual([[100000, 'BTC']]);
  });
});

describe('ruleSummary', () => {
  it('reads the rows it is given, so the line can not differ from the table', () => {
    expect(
      ruleSummary([
        { key: 'first', label: 'Label one', value: 'Value one' },
        { key: 'second', label: 'Label two', value: 'Value two' },
      ]),
    ).toBe('Label one Value one · Label two Value two');
  });

  it('joins the rows, each as its label then its value, with a middle dot', () => {
    expect(
      summaryOf([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        { type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 },
      ]),
    ).toBe('Name is "Silpo" · Type Expense · Amount is more than 500.00 UAH · Time is after 18:00');
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('reads the labels and the quoted name in Ukrainian', () => {
      expect(
        summaryOf([
          { type: 'nameIs', text: 'Silpo' },
          { type: 'direction', direction: 'expense' },
          { type: 'amount', operator: 'lte', minorUnits: 50000, currency: 'UAH' },
          { type: 'time', operator: 'before', minuteOfDay: MINUTES_AT_18 },
        ]),
      ).toBe('Назва дорівнює «Silpo» · Тип Витрата · Сума щонайбільше 500.00 UAH · Час до 18:00');
    });
  });
});
