import { i18n } from '@kiko/i18n/init';
import type { TimeClock } from '@kiko/dates';
import { act } from '@testing-library/react-native';
import type { Currency } from '@kiko/currency/currency';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { ruleSummary } from './rule-summary';

const CLOCK_24: TimeClock = { uses24Hour: true };
const CLOCK_12: TimeClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };

const MINUTES_AT_18 = 18 * 60;

const formatAmount = (minorUnits: number, currency: Currency): string =>
  `${(minorUnits / 100).toFixed(2)} ${currency}`;

const summaryOf = (matchers: CategoryRuleMatcher[], clock: TimeClock = CLOCK_24): string =>
  ruleSummary(matchers, { t: i18n.t, clock, formatAmount });

describe('ruleSummary', () => {
  it('joins the matchers with a middle dot in the order they are stored', () => {
    expect(
      summaryOf([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        { type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 },
      ]),
    ).toBe('Name is "Silpo" · Expense · More than 500.00 UAH · After 18:00');
  });

  it('keeps the stored order when a time comes before a name', () => {
    expect(
      summaryOf([
        { type: 'time', operator: 'before', minuteOfDay: 9 * 60 },
        { type: 'nameStartsWith', text: 'Sil' },
      ]),
    ).toBe('Before 09:00 · Name starts with "Sil"');
  });

  it('reads a time on the 12-hour clock with its mark', () => {
    expect(
      summaryOf([{ type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 }], CLOCK_12),
    ).toBe('After 6:00 PM');
  });

  it.each([
    ['eq', 'Equal to'],
    ['gt', 'More than'],
    ['gte', 'At least'],
    ['lt', 'Less than'],
    ['lte', 'At most'],
  ] as const)('labels the %s amount operator %s', (operator, label) => {
    expect(summaryOf([{ type: 'amount', operator, minorUnits: 100, currency: 'USD' }])).toBe(
      `${label} 1.00 USD`,
    );
  });

  it('labels both directions and both time operators', () => {
    expect(summaryOf([{ type: 'direction', direction: 'income' }])).toBe('Income');
    expect(summaryOf([{ type: 'time', operator: 'before', minuteOfDay: 0 }])).toBe('Before 00:00');
    expect(summaryOf([{ type: 'time', operator: 'after', minuteOfDay: 1439 }])).toBe('After 23:59');
  });

  it('hands the stored minor units and currency to the amount formatter untouched', () => {
    const received: [number, Currency][] = [];

    ruleSummary([{ type: 'amount', operator: 'eq', minorUnits: 100000, currency: 'BTC' }], {
      t: i18n.t,
      clock: CLOCK_24,
      formatAmount: (minorUnits, currency) => {
        received.push([minorUnits, currency]);

        return '0.00100000 BTC';
      },
    });

    expect(received).toEqual([[100000, 'BTC']]);
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
      ).toBe('Назва дорівнює «Silpo» · Витрата · Щонайбільше 500.00 UAH · До 18:00');
    });
  });
});
